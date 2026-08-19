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
  return "award_roster";
}

export function groupChannels(channels: ChannelSnapshot[]): {
  olympiad: ChannelSnapshot[];
  scholarships: ChannelSnapshot[];
  manual: ChannelSnapshot[];
} {
  return {
    olympiad: channels.filter((c) => c.kind === "olympiad_csv"),
    scholarships: channels.filter((c) => c.kind === "award_roster"),
    manual: channels.filter((c) => c.kind === "manual_cohort"),
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
