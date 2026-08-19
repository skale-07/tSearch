import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { loadAwardRegistry } from "../../awards/awardRegistry.js";
import type { SeedCandidateRow, SeedSource } from "./types.js";

/**
 * Award/scholarship winner rosters dropped as local files.
 *
 * Rosters come from a small set of HTML scrapers (Davidson / Regeneron STS /
 * Coca-Cola) or an operator paste. Most publishers still have no scraper —
 * PDFs, JavaScript apps, or no public list. This module only persists files.
 *
 * Filename convention: <award_id>.<year>.txt|csv   e.g. cameron_impact.2026.csv
 * Contents: one name per line, or CSV with a `name` column
 * (optional `country` column honored).
 */
export const ROSTER_DIR_DEFAULT = "data/rosters";

export interface RosterPerson {
  name: string;
  country?: string;
  age_at_award?: number;
}

function parseAgeCell(raw: string | undefined): number | undefined {
  if (!raw) return undefined;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 14 || n > 30) return undefined;
  return n;
}

function csvCell(value: string): string {
  if (/[",\n]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}

function parseRosterFile(raw: string): RosterPerson[] {
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
  const ageIdx = cols.indexOf("age");
  const out: RosterPerson[] = [];
  for (const line of lines.slice(1)) {
    const cells = line.split(",").map((c) => c.trim());
    const name = cells[nameIdx];
    if (!name) continue;
    const country = countryIdx >= 0 ? cells[countryIdx] : undefined;
    out.push({
      name,
      country: country || undefined,
      age_at_award: ageIdx >= 0 ? parseAgeCell(cells[ageIdx]) : undefined,
    });
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

export function listPublicRosterAwards(): Array<{
  award_id: string;
  display_name: string;
}> {
  return loadAwardRegistry()
    .awards.filter((a) => a.roster_public)
    .map((a) => ({ award_id: a.award_id, display_name: a.display_name }));
}

/**
 * Persist a roster file. Used by the HTML scrapers and by operator paste.
 * Filename: <award_id>.<year>.csv
 */
export function writeAwardRosterRows(opts: {
  award_id: string;
  year: number;
  rows: RosterPerson[];
  dir?: string;
}): { file: string; count: number } {
  const award_id = opts.award_id.trim();
  const known = loadAwardRegistry().awards.find((a) => a.award_id === award_id);
  if (!known) {
    throw new Error(`Unknown award_id "${award_id}" — pick one from the awards registry.`);
  }
  if (!Number.isInteger(opts.year) || opts.year < 1990 || opts.year > 2100) {
    throw new Error("Year must be a four-digit cohort year.");
  }
  if (!opts.rows.length) {
    throw new Error("Paste at least one name (one per line).");
  }
  const dir = opts.dir ?? resolve(process.cwd(), ROSTER_DIR_DEFAULT);
  mkdirSync(dir, { recursive: true });
  const file = `${award_id}.${opts.year}.csv`;
  const body =
    "name,country,age\n" +
    opts.rows
      .map((r) =>
        [
          csvCell(r.name),
          csvCell(r.country ?? ""),
          r.age_at_award != null ? String(r.age_at_award) : "",
        ].join(",")
      )
      .join("\n") +
    "\n";
  writeFileSync(resolve(dir, file), body, "utf8");
  return { file, count: opts.rows.length };
}

/** Operator paste → local roster file. Filename: <award_id>.<year>.csv */
export function writeAwardRoster(opts: {
  award_id: string;
  year: number;
  namesText: string;
  dir?: string;
}): { file: string; count: number } {
  const rows = parseRosterFile(opts.namesText);
  return writeAwardRosterRows({ ...opts, rows });
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
