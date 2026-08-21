import type {
  ChannelSnapshot,
  PendingSeedRow,
  SeedSourceKind,
} from "./api";

export const RESOLVE_LIMIT_DEFAULT = 5;

export function pendingKind(seed: PendingSeedRow): SeedSourceKind {
  if (seed.source_kind) return seed.source_kind;
  if (seed.source_id.startsWith("olympiad:")) return "olympiad_csv";
  if (seed.source_id.startsWith("manual")) return "manual_cohort";
  if (seed.source_id.startsWith("website:")) return "website_page";
  return "award_roster";
}

/** Award id or olympiad source (ISEF, IMO, …). */
export function pendingProgramKey(seed: PendingSeedRow): string {
  if (seed.award_id) return seed.award_id;
  const oly = seed.source_id.match(/^olympiad:(.+)$/i);
  if (oly) return oly[1]!.toUpperCase();
  const beforeYear = seed.source_id.split(":")[0] ?? seed.source_id;
  return beforeYear;
}

export interface PendingListFilter {
  kind?: SeedSourceKind | "";
  year?: number | "";
  program?: string;
}

export function matchesPendingFilter(
  seed: PendingSeedRow,
  filter: PendingListFilter
): boolean {
  if (filter.kind && pendingKind(seed) !== filter.kind) return false;
  if (typeof filter.year === "number" && seed.cohort_year !== filter.year) {
    return false;
  }
  if (filter.program) {
    const want = filter.program.trim().toLowerCase();
    if (pendingProgramKey(seed).toLowerCase() !== want) return false;
  }
  return true;
}

export function uniquePendingYears(rows: PendingSeedRow[]): number[] {
  return [
    ...new Set(
      rows
        .map((s) => s.cohort_year)
        .filter((y): y is number => typeof y === "number" && Number.isFinite(y))
    ),
  ].sort((a, b) => b - a);
}

export function uniquePendingPrograms(
  rows: PendingSeedRow[]
): Array<{ id: string; kind: SeedSourceKind }> {
  const seen = new Map<string, SeedSourceKind>();
  for (const row of rows) {
    const id = pendingProgramKey(row);
    if (!id || seen.has(id)) continue;
    seen.set(id, pendingKind(row));
  }
  return [...seen.entries()]
    .map(([id, kind]) => ({ id, kind }))
    .sort((a, b) => a.id.localeCompare(b.id));
}

export function groupChannels(channels: ChannelSnapshot[]): {
  olympiad: ChannelSnapshot[];
  scholarships: ChannelSnapshot[];
  manual: ChannelSnapshot[];
  website: ChannelSnapshot[];
} {
  return {
    olympiad: channels.filter((c) => c.kind === "olympiad_csv"),
    scholarships: channels.filter((c) => c.kind === "award_roster"),
    manual: channels.filter((c) => c.kind === "manual_cohort"),
    website: channels.filter((c) => c.kind === "website_page"),
  };
}

/** Clamp batch size to ≥1 and ≤ maxAvailable (pending / queue size). */
export function clampResolveLimit(
  raw: number,
  maxAvailable = Number.POSITIVE_INFINITY
): number {
  if (!Number.isFinite(raw)) return RESOLVE_LIMIT_DEFAULT;
  const ceiling =
    Number.isFinite(maxAvailable) && maxAvailable >= 1
      ? Math.floor(maxAvailable)
      : Number.POSITIVE_INFINITY;
  return Math.min(ceiling, Math.max(1, Math.floor(raw)));
}

const NOT_ON_LIST = "This person is not on the list";

export function pendingNameKey(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** Exact name match against the visible pending list (case/spacing-insensitive). */
export function findPendingByName(
  rows: PendingSeedRow[],
  query: string
): PendingSeedRow | null {
  const q = pendingNameKey(query);
  if (!q) return null;
  return rows.find((s) => pendingNameKey(s.name) === q) ?? null;
}

export { NOT_ON_LIST as PERSON_NOT_ON_LIST };

/** Filename the pipeline reads. Save the download here, then scan. */
export const MANUAL_COHORT_FILENAME = "manual-cohort.json";

/**
 * Fields `parseManualCohort` actually consumes. Extra keys are ignored.
 * `name` is required; the rest improve LinkedIn match and the pending Age column.
 */
export const MANUAL_COHORT_TEMPLATE: Array<{
  name: string;
  country?: string;
  cohort_year?: number;
  age_at_award?: number;
}> = [
  {
    name: "Ada Lovelace",
    country: "United Kingdom",
    cohort_year: 2026,
    age_at_award: 18,
  },
  {
    name: "Grace Hopper",
    country: "United States",
    cohort_year: 2026,
  },
];

export function manualCohortTemplateJson(): string {
  return `${JSON.stringify(MANUAL_COHORT_TEMPLATE, null, 2)}\n`;
}
