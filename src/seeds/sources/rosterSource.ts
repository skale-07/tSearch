import { existsSync, readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { loadAwardRegistry } from "../../awards/awardRegistry.js";
import type { SeedCandidateRow, SeedSource } from "./types.js";

/**
 * Award/scholarship winner rosters dropped as local files.
 *
 * Rosters are operator-supplied rather than scraped: the publishers vary
 * wildly in format and robots posture, and a roster is a one-off yearly read
 * — not worth a fragile scraper, and not worth the ban risk on the shared
 * network path. Drop a file per roster and this picks it up.
 *
 * Filename convention: <award_id>.<year>.txt|csv   e.g. cameron_impact.2026.csv
 * Contents: one name per line, or CSV with a `name` column
 * (optional `country` column honored).
 */
export const ROSTER_DIR_DEFAULT = "data/rosters";

function parseRosterFile(raw: string): Array<{ name: string; country?: string }> {
  const lines = raw
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("#"));
  if (!lines.length) return [];

  const header = lines[0]!.toLowerCase();
  const isCsv = header.includes(",") && /\bname\b/.test(header);
  if (!isCsv) {
    return lines.map((name) => ({ name }));
  }

  const cols = lines[0]!.split(",").map((c) => c.trim().toLowerCase());
  const nameIdx = cols.indexOf("name");
  const countryIdx = cols.indexOf("country");
  const out: Array<{ name: string; country?: string }> = [];
  for (const line of lines.slice(1)) {
    const cells = line.split(",").map((c) => c.trim());
    const name = cells[nameIdx];
    if (!name) continue;
    const country = countryIdx >= 0 ? cells[countryIdx] : undefined;
    out.push({ name, country: country || undefined });
  }
  return out;
}

/** Parses `<award_id>.<year>.<ext>`; year optional. */
export function parseRosterFilename(
  filename: string
): { award_id: string; year?: number } | null {
  const m = filename.match(/^([a-z0-9_]+?)(?:\.(\d{4}))?\.(txt|csv)$/i);
  if (!m) return null;
  return { award_id: m[1]!, year: m[2] ? Number(m[2]) : undefined };
}

export function createRosterSources(
  dir = resolve(process.cwd(), ROSTER_DIR_DEFAULT)
): SeedSource[] {
  if (!existsSync(dir)) return [];
  const knownIds = new Set(loadAwardRegistry().awards.map((a) => a.award_id));

  return readdirSync(dir)
    .map((file) => ({ file, parsed: parseRosterFilename(file) }))
    .filter((x) => !!x.parsed)
    .map(({ file, parsed }) => {
      const { award_id, year } = parsed!;
      const source_id = year ? `${award_id}:${year}` : award_id;
      return {
        source_id,
        kind: "award_roster" as const,
        describe() {
          const known = knownIds.has(award_id) ? "" : " (not in awards registry)";
          return `award roster ${source_id}${known}`;
        },
        read(): SeedCandidateRow[] {
          const as_of = new Date().toISOString();
          return parseRosterFile(readFileSync(resolve(dir, file), "utf8")).map(
            (row) => ({
              ...row,
              cohort_year: year,
              award_id,
              source_id,
              source_kind: "award_roster" as const,
              as_of,
            })
          );
        },
      };
    });
}
