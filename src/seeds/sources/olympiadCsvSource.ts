import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { loadOlympiadCsv } from "../../olympiad/parseOlympiad.js";
import type { SeedCandidateRow, SeedSource } from "./types.js";

/**
 * Olympiad medalists already pulled into olympiad_winners.csv.
 *
 * This source nominates names only — same contract as award rosters. It does
 * not scrape, does not search GitHub, and does not assert identity. LinkedIn
 * resolution remains the only path that establishes who someone is.
 */
export function createOlympiadCsvSource(
  csvPath = resolve(process.cwd(), process.env.OLYMPIAD_CSV ?? "olympiad_winners.csv")
): SeedSource | null {
  if (!existsSync(csvPath)) return null;
  return {
    source_id: "olympiad_csv",
    kind: "olympiad_csv",
    describe: () => `olympiad CSV (${csvPath})`,
    read(): SeedCandidateRow[] {
      const as_of = new Date().toISOString();
      const ranked = [...loadOlympiadCsv(csvPath).values()].sort((a, b) => {
        const yearA = a.years[0] ?? 0;
        const yearB = b.years[0] ?? 0;
        if (yearB !== yearA) return yearB - yearA;
        if (b.medalScore !== a.medalScore) return b.medalScore - a.medalScore;
        return a.name.localeCompare(b.name);
      });
      return ranked.map((p) => ({
        name: p.name,
        country: p.countries[0],
        cohort_year: p.years[0],
        age_at_award: p.stated_age,
        source_id: `olympiad:${(p.sources[0] ?? "csv").toLowerCase()}`,
        source_kind: "olympiad_csv" as const,
        as_of,
      }));
    },
  };
}
