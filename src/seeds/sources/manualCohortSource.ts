import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { SeedCandidateRow, SeedSource } from "./types.js";

/**
 * Operator-entered names — the path for cohort announcements that live on
 * platforms we deliberately do not scrape (class-release posts and similar).
 *
 * The operator reads the source themselves and enters names here; the system
 * never fetches from those platforms, stores no post content, and stores no
 * images. What lands in the pipeline is a name and a cohort year, which then
 * goes through the same LinkedIn verification as every other seed.
 *
 * File: data/manual-cohort.json
 *   [{ "name": "...", "cohort_year": 2026, "country": "US", "age_at_award": 18 }]
 *
 * `name` is required. `cohort_year` / `country` / `age_at_award` are optional
 * but `cohort_year` and `age_at_award` are what the pending Age column uses.
 */
export const MANUAL_COHORT_PATH_DEFAULT = "data/manual-cohort.json";

interface ManualEntry {
  name?: unknown;
  cohort_year?: unknown;
  country?: unknown;
  age_at_award?: unknown;
}

function parseOptionalAge(raw: unknown): number | undefined {
  const n = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isInteger(n) || n < 14 || n > 30) return undefined;
  return n;
}

export function parseManualCohort(raw: unknown): SeedCandidateRow[] {
  if (!Array.isArray(raw)) {
    throw new Error("manual-cohort.json must be a JSON array");
  }
  const as_of = new Date().toISOString();
  const out: SeedCandidateRow[] = [];
  for (const entry of raw as ManualEntry[]) {
    const name = typeof entry?.name === "string" ? entry.name.trim() : "";
    if (!name) continue;
    const year =
      typeof entry.cohort_year === "number" && entry.cohort_year > 1900
        ? entry.cohort_year
        : undefined;
    out.push({
      name,
      country:
        typeof entry.country === "string" && entry.country.trim()
          ? entry.country.trim()
          : undefined,
      cohort_year: year,
      age_at_award: parseOptionalAge(entry.age_at_award),
      source_id: year ? `manual:${year}` : "manual",
      source_kind: "manual_cohort",
      as_of,
    });
  }
  return out;
}

export function createManualCohortSource(
  path = resolve(process.cwd(), MANUAL_COHORT_PATH_DEFAULT)
): SeedSource | null {
  if (!existsSync(path)) return null;
  return {
    source_id: "manual_cohort",
    kind: "manual_cohort",
    describe: () => `manual cohort intake (${path})`,
    read: () => parseManualCohort(JSON.parse(readFileSync(path, "utf8"))),
  };
}
