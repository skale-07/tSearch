import path from "path";
import { PEOPLE_DIR } from "../config.js";
import { readJson, writeJsonAtomic } from "../storage/jsonStore.js";
import { loadPerson } from "../storage/personStore.js";
import { createRosterSources } from "./sources/rosterSource.js";
import { createManualCohortSource } from "./sources/manualCohortSource.js";
import type { SeedCandidateRow, SeedSource } from "./sources/types.js";

/**
 * Continuous seed refresh: read every configured source, drop anyone the
 * system already knows, and write the remainder as a pending-seeds file the
 * pipeline can consume directly (same shape as seeds.json).
 *
 * Sources nominate only. Nothing here bypasses LinkedIn resolution, and a
 * name appearing in a roster is not a claim that the person is a match.
 */

export const PENDING_SEEDS_PATH = path.resolve(
  process.cwd(),
  process.env.PENDING_SEEDS_PATH ?? path.join(PEOPLE_DIR, "..", "pending-seeds.json")
);

export interface PendingSeed {
  name: string;
  country?: string;
  cohort_year?: number;
  award_id?: string;
  source_id: string;
  first_seen: string;
}

export function collectSources(): SeedSource[] {
  const sources: SeedSource[] = [...createRosterSources()];
  const manual = createManualCohortSource();
  if (manual) sources.push(manual);
  return sources;
}

function normalizeName(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export interface RefreshResult {
  sources_read: number;
  rows_read: number;
  already_known: number;
  duplicates_within_run: number;
  new_seeds: PendingSeed[];
}

/**
 * Pure core — takes rows and a "do we already know this person" predicate so
 * it can be tested without touching the filesystem.
 */
export function diffNewSeeds(
  rows: SeedCandidateRow[],
  isKnown: (name: string) => boolean,
  existing: PendingSeed[] = []
): RefreshResult {
  const seen = new Set(existing.map((e) => normalizeName(e.name)));
  const merged: PendingSeed[] = [...existing];
  let already_known = 0;
  let duplicates_within_run = 0;

  for (const row of rows) {
    const key = normalizeName(row.name);
    if (!key) continue;
    if (seen.has(key)) {
      duplicates_within_run++;
      continue;
    }
    if (isKnown(row.name)) {
      already_known++;
      seen.add(key);
      continue;
    }
    seen.add(key);
    merged.push({
      name: row.name,
      country: row.country,
      cohort_year: row.cohort_year,
      award_id: row.award_id,
      source_id: row.source_id,
      first_seen: row.as_of,
    });
  }

  return {
    sources_read: 0,
    rows_read: rows.length,
    already_known,
    duplicates_within_run,
    new_seeds: merged,
  };
}

/** Reads every source, merges into the pending-seeds file, returns the delta. */
export function refreshSeeds(
  opts: { sources?: SeedSource[]; pendingPath?: string } = {}
): RefreshResult {
  const sources = opts.sources ?? collectSources();
  const pendingPath = opts.pendingPath ?? PENDING_SEEDS_PATH;
  const existing = readJson<PendingSeed[]>(pendingPath) ?? [];

  const rows: SeedCandidateRow[] = [];
  for (const source of sources) {
    try {
      const read = source.read();
      rows.push(...read);
      console.log(`[seeds] ${source.describe()} → ${read.length} rows`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.log(`[seeds] ${source.describe()} failed: ${msg}`);
    }
  }

  const before = existing.length;
  const result = diffNewSeeds(rows, (name) => !!loadPerson(name), existing);
  result.sources_read = sources.length;

  if (result.new_seeds.length !== before) {
    writeJsonAtomic(pendingPath, result.new_seeds);
  }
  console.log(
    `[seeds] ${rows.length} rows · ${result.already_known} already known · ${
      result.new_seeds.length - before
    } new → ${pendingPath}`
  );
  return result;
}
