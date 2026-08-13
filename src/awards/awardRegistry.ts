import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parse as parseYaml } from "yaml";
import { z } from "zod";

/**
 * Registry of prestigious pre-college awards. Reference data, no PII.
 *
 * It is deliberately *not* a quality signal on its own — prestige is banned
 * as a rarity shortcut in the experience rubric. What it provides is
 * verifiability (a matched award is externally anchored rather than
 * self-reported) and a stated cohort year for stage derivation.
 */

export type CohortStage = "hs_senior" | "hs_any" | "undergrad" | "young_any";

const awardSchema = z.object({
  award_id: z.string().min(1),
  display_name: z.string().min(1),
  issuer: z.string().min(1),
  aliases: z.array(z.string().min(1)).min(1),
  cohort_stage: z.enum(["hs_senior", "hs_any", "undergrad", "young_any"]),
  prestige_tier: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  winners_per_year: z.number().positive().optional(),
  roster_public: z.boolean(),
  domain_bias: z.enum(["research", "building", "general"]),
});

const registrySchema = z.object({
  registry_version: z.string().min(1),
  awards: z.array(awardSchema).min(1),
});

export type AwardEntry = z.infer<typeof awardSchema>;
export type AwardRegistry = z.infer<typeof registrySchema>;

let cached: AwardRegistry | null = null;

export function loadAwardRegistry(
  filePath = resolve(process.cwd(), "reference", "awards-registry.yaml")
): AwardRegistry {
  if (cached) return cached;
  const parsed: unknown = parseYaml(readFileSync(resolve(filePath), "utf8"));
  const result = registrySchema.safeParse(parsed);
  if (!result.success) {
    throw new Error(`awards-registry.yaml invalid: ${result.error.message}`);
  }
  const ids = new Set<string>();
  for (const a of result.data.awards) {
    if (ids.has(a.award_id)) {
      throw new Error(`awards-registry.yaml duplicate award_id: ${a.award_id}`);
    }
    ids.add(a.award_id);
  }
  cached = result.data;
  return cached;
}

/** Test seam — drops the module-level cache. */
export function resetAwardRegistryCache(): void {
  cached = null;
}

function normalize(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export interface AwardMatch {
  award: AwardEntry;
  /** The raw profile string that matched. */
  matched_text: string;
  /** Four-digit year parsed from the award entry, when present. */
  year: number | null;
}

/** Year of an award as stated on a profile ("2024", "May 2024", "2023-2024"). */
export function parseAwardYear(raw: string | null | undefined): number | null {
  if (!raw) return null;
  const years = [...raw.matchAll(/\b(19|20)\d{2}\b/g)].map((m) => Number(m[0]));
  if (!years.length) return null;
  // A range ("2023–2024") means the award concluded in the later year.
  return Math.max(...years);
}

/**
 * Match stated award/honor strings against the registry. Matching is on
 * normalized alias substrings — deliberately conservative, since a false
 * match would manufacture verifiability that isn't there.
 */
export function matchAwards(
  entries: Array<{ title: string; issuer?: string | null; date?: string | null }>,
  registry = loadAwardRegistry()
): AwardMatch[] {
  const out: AwardMatch[] = [];
  const seen = new Set<string>();
  for (const entry of entries) {
    const haystack = normalize(`${entry.title} ${entry.issuer ?? ""}`);
    if (!haystack) continue;
    for (const award of registry.awards) {
      if (seen.has(award.award_id)) continue;
      const hit = award.aliases.some((alias) =>
        haystack.includes(normalize(alias))
      );
      if (!hit) continue;
      seen.add(award.award_id);
      out.push({
        award,
        matched_text: entry.title,
        year: parseAwardYear(entry.date) ?? parseAwardYear(entry.title),
      });
    }
  }
  return out;
}

/**
 * Age implied by a dated award whose cohort stage is known.
 * Only `hs_senior` awards give a tight band; broader stages are too loose to
 * beat the other stage sources, so they return null rather than guess.
 */
export function ageFromAwardMatch(
  match: AwardMatch,
  currentYear: number
): { age: number; confidence: number } | null {
  if (!match.year) return null;
  if (match.award.cohort_stage !== "hs_senior") return null;
  const elapsed = currentYear - match.year;
  if (elapsed < 0 || elapsed > 40) return null;
  return { age: 18 + elapsed, confidence: 0.85 };
}
