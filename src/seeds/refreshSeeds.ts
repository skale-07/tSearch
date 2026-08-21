import path from "path";
import { PEOPLE_DIR } from "../config.js";
import { readJson, writeJsonAtomic } from "../storage/jsonStore.js";
import { loadPerson } from "../storage/personStore.js";
import { createRosterSources, listPublicRosterAwards } from "./sources/rosterSource.js";
import { createManualCohortSource } from "./sources/manualCohortSource.js";
import { createOlympiadCsvSource } from "./sources/olympiadCsvSource.js";
import type {
  SeedCandidateRow,
  SeedSource,
  SeedSourceKind,
} from "./sources/types.js";

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
  age_at_award?: number;
  source_id: string;
  source_kind?: SeedSourceKind;
  first_seen: string;
}

export const CHANNEL_META: Record<
  SeedSourceKind,
  { title: string; hint: string }
> = {
  olympiad_csv: {
    title: "Olympiads",
    hint: "Pull IMO / IOI / IPhO / IChO / IBO / ISEF into olympiad_winners.csv, then scan",
  },
  award_roster: {
    title: "Scholarships & awards",
    hint: "Scrape Davidson Fellows, Regeneron STS, and Coca-Cola Scholars. Other awards still need a pasted public roster.",
  },
  manual_cohort: {
    title: "Manual cohort",
    hint: "Download the template, save as data/manual-cohort.json, then scan.",
  },
  website_page: {
    title: "Website page",
    hint: "Names nominated from a seed's lab/personal site. LinkedIn is still identity.",
  },
};

export interface ChannelSnapshot {
  source_id: string;
  kind: SeedSourceKind;
  label: string;
  present: boolean;
  row_count: number;
  error?: string;
}

export function pendingKind(seed: PendingSeed): SeedSourceKind {
  if (seed.source_kind) return seed.source_kind;
  if (seed.source_id.startsWith("olympiad:")) return "olympiad_csv";
  if (seed.source_id.startsWith("manual")) return "manual_cohort";
  if (seed.source_id.startsWith("website:")) return "website_page";
  return "award_roster";
}

export function pendingProgramKey(seed: PendingSeed): string {
  if (seed.award_id) return seed.award_id;
  const oly = seed.source_id.match(/^olympiad:(.+)$/i);
  if (oly) return oly[1]!.toUpperCase();
  return seed.source_id.split(":")[0] ?? seed.source_id;
}

export interface PendingPickOpts {
  kind?: SeedSourceKind;
  cohort_year?: number;
  program?: string;
}

export function seedMatchesPick(
  seed: PendingSeed,
  opts: PendingPickOpts
): boolean {
  if (opts.kind && pendingKind(seed) !== opts.kind) return false;
  if (
    opts.cohort_year != null &&
    seed.cohort_year !== opts.cohort_year
  ) {
    return false;
  }
  if (opts.program) {
    const want = opts.program.trim().toLowerCase();
    if (!want) return true;
    if (pendingProgramKey(seed).toLowerCase() !== want) return false;
  }
  return true;
}

function snapshotOf(source: SeedSource): ChannelSnapshot {
  try {
    const rows = source.read();
    return {
      source_id: source.source_id,
      kind: source.kind,
      label: source.describe(),
      present: true,
      row_count: rows.length,
    };
  } catch (err) {
    return {
      source_id: source.source_id,
      kind: source.kind,
      label: source.describe(),
      present: true,
      row_count: 0,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/** Channel status even when a source file is missing — the UI needs empty states. */
export function inspectSources(): ChannelSnapshot[] {
  const out: ChannelSnapshot[] = [];
  const olympiad = createOlympiadCsvSource();
  out.push(
    olympiad
      ? snapshotOf(olympiad)
      : {
          source_id: "olympiad_csv",
          kind: "olympiad_csv",
          label: CHANNEL_META.olympiad_csv.title,
          present: false,
          row_count: 0,
        }
  );

  const rosters = createRosterSources();
  if (rosters.length) {
    out.push(...rosters.map(snapshotOf));
  } else {
    out.push({
      source_id: "award_roster",
      kind: "award_roster",
      label: CHANNEL_META.award_roster.title,
      present: false,
      row_count: 0,
    });
  }

  const manual = createManualCohortSource();
  out.push(
    manual
      ? snapshotOf(manual)
      : {
          source_id: "manual_cohort",
          kind: "manual_cohort",
          label: CHANNEL_META.manual_cohort.title,
          present: false,
          row_count: 0,
        }
  );
  return out;
}

export interface DiscoverySnapshot {
  channels: ChannelSnapshot[];
  pending: PendingSeed[];
  pending_count: number;
  roster_awards: Array<{ award_id: string; display_name: string }>;
}

export function discoverySnapshot(): DiscoverySnapshot {
  const pending = loadPendingSeeds();
  return {
    channels: inspectSources(),
    pending,
    pending_count: pending.length,
    roster_awards: listPublicRosterAwards(),
  };
}

export function collectSources(): SeedSource[] {
  // Operator-supplied names first so a fresh pending file doesn't bury them
  // under the olympiad CSV (thousands of rows).
  const sources: SeedSource[] = [...createRosterSources()];
  const manual = createManualCohortSource();
  if (manual) sources.push(manual);
  const olympiad = createOlympiadCsvSource();
  if (olympiad) sources.push(olympiad);
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
  const seen = new Set<string>();
  const merged: PendingSeed[] = [];
  let already_known = 0;
  let duplicates_within_run = 0;

  const consider = (name: string, keep: () => PendingSeed): void => {
    const key = normalizeName(name);
    if (!key) return;
    if (seen.has(key)) {
      duplicates_within_run++;
      return;
    }
    if (isKnown(name)) {
      already_known++;
      seen.add(key);
      return;
    }
    seen.add(key);
    merged.push(keep());
  };

  for (const entry of existing) {
    consider(entry.name, () => entry);
  }
  for (const row of rows) {
    consider(row.name, () => ({
      name: row.name,
      country: row.country,
      cohort_year: row.cohort_year,
      award_id: row.award_id,
      age_at_award: row.age_at_award,
      source_id: row.source_id,
      source_kind: row.source_kind,
      first_seen: row.as_of,
    }));
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
  // Resolved identities drop out. Failed LinkedIn attempts stay so autopilot
  // can retry after AUTOPILOT_RETRY_TTL_MS — a person record is not a match.
  const result = diffNewSeeds(
    rows,
    (name) => loadPerson(name)?.identity?.status === "resolved",
    existing
  );
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

export function loadPendingSeeds(
  pendingPath = PENDING_SEEDS_PATH
): PendingSeed[] {
  return readJson<PendingSeed[]>(pendingPath) ?? [];
}

/** Append nominations without re-reading olympiad/roster sources. */
export function appendPendingSeeds(
  rows: Array<{
    name: string;
    country?: string;
    source_id: string;
    source_kind: SeedSourceKind;
  }>,
  pendingPath = PENDING_SEEDS_PATH
): PendingSeed[] {
  const existing = loadPendingSeeds(pendingPath);
  const seen = new Set(existing.map((s) => pendingNameKey(s.name)));
  const now = new Date().toISOString();
  const next = [...existing];
  for (const row of rows) {
    const name = row.name.trim();
    const key = pendingNameKey(name);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    next.push({
      name,
      country: row.country,
      source_id: row.source_id,
      source_kind: row.source_kind,
      first_seen: now,
    });
  }
  writeJsonAtomic(pendingPath, next);
  return next;
}

/** Next unresolved nominations. Skip is for recent LinkedIn failures. */
export function takePendingBatch(
  n: number,
  opts?: {
    pendingPath?: string;
    skip?: (seed: PendingSeed) => boolean;
    kind?: SeedSourceKind;
    cohort_year?: number;
    program?: string;
  }
): PendingSeed[] {
  const skip = opts?.skip ?? (() => false);
  return loadPendingSeeds(opts?.pendingPath)
    .filter((s) => !skip(s))
    .filter((s) =>
      seedMatchesPick(s, {
        kind: opts?.kind,
        cohort_year: opts?.cohort_year,
        program: opts?.program,
      })
    )
    .slice(0, n);
}

export function pendingNameKey(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** Operator-picked seed. Does not skip recent LinkedIn failures. */
export function findPendingSeedByName(
  query: string,
  opts?: PendingPickOpts & { pendingPath?: string }
): PendingSeed | null {
  const q = pendingNameKey(query);
  if (!q) return null;
  return (
    loadPendingSeeds(opts?.pendingPath)
      .filter((s) => seedMatchesPick(s, opts ?? {}))
      .find((s) => pendingNameKey(s.name) === q) ?? null
  );
}
