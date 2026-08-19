import { loadAwardRegistry, type CohortStage } from "../awards/awardRegistry.js";
import type { SeedSourceKind } from "./sources/types.js";

/** Typical competitor age when an olympiad CSV row has no age column. */
const TYPICAL_OLYMPIAD_AGE = 17;

const AGE_AT_AWARD: Record<CohortStage, { age: number; confidence: number }> = {
  hs_senior: { age: 18, confidence: 0.85 },
  hs_any: { age: 17, confidence: 0.55 },
  undergrad: { age: 20, confidence: 0.45 },
  young_any: { age: 20, confidence: 0.35 },
};

export interface SeedAgeEstimate {
  age: number;
  /** 0..1 — how tightly the source pins the birth year. */
  confidence: number;
  /** Display string, always approximate (`~22`). */
  label: string;
}

export function predictSeedAge(
  seed: {
    source_kind?: SeedSourceKind;
    source_id: string;
    award_id?: string;
    cohort_year?: number;
    age_at_award?: number;
  },
  currentYear = new Date().getFullYear()
): SeedAgeEstimate | null {
  const year = seed.cohort_year;
  if (!year || year < 1990 || year > currentYear + 1) return null;
  const elapsed = currentYear - year;
  if (elapsed < 0 || elapsed > 40) return null;

  if (
    seed.age_at_award != null &&
    seed.age_at_award >= 14 &&
    seed.age_at_award <= 30
  ) {
    return pack(seed.age_at_award + elapsed, 0.9);
  }

  const olympiad =
    seed.source_kind === "olympiad_csv" ||
    seed.source_id.startsWith("olympiad:");
  if (olympiad) return pack(TYPICAL_OLYMPIAD_AGE + elapsed, 0.6);

  const awardId = seed.award_id ?? seed.source_id.split(":")[0];
  if (!awardId) return null;
  const award = loadAwardRegistry().awards.find((a) => a.award_id === awardId);
  if (!award) return null;
  const typical = AGE_AT_AWARD[award.cohort_stage];
  return pack(typical.age + elapsed, typical.confidence);
}

function pack(age: number, confidence: number): SeedAgeEstimate | null {
  if (!Number.isFinite(age) || age < 14 || age > 55) return null;
  const rounded = Math.round(age);
  return { age: rounded, confidence, label: `~${rounded}` };
}
