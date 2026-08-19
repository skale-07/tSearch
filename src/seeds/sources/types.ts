/**
 * Pluggable seed sources.
 *
 * Every source NOMINATES names; none of them assert identity. LinkedIn
 * resolution remains the only path that establishes who someone actually is,
 * so a source being noisy costs pipeline time, never correctness.
 */

export type SeedSourceKind =
  | "olympiad_csv"
  | "award_roster"
  | "manual_cohort";

export interface SeedCandidateRow {
  name: string;
  country?: string;
  /** Graduating class / award year when the source states one. */
  cohort_year?: number;
  /** Registry award_id when the source is an award roster. */
  award_id?: string;
  /** Stated age at the award/competition, when the source publishes one. */
  age_at_award?: number;
  /** Free-form provenance shown in logs and stored on the person record. */
  source_id: string;
  source_kind: SeedSourceKind;
  /** ISO date the source was read. */
  as_of: string;
}

export interface SeedSource {
  source_id: string;
  kind: SeedSourceKind;
  /** Human-readable, for logs. */
  describe(): string;
  /** Read the source. Must be side-effect free and offline-safe. */
  read(): SeedCandidateRow[];
}
