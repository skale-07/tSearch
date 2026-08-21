/**
 * Chronological age scalar for ranking.
 *
 * Sweet spot is 17–19: anyone in that band gets the same boost. Younger
 * than 17 gets a bit more. 20 and up is a descaling function — not a
 * gentle 22/age slope that left 21 and 23 nearly identical.
 *
 *   15 → ~1.59 · 16 → ~1.49 · 17–19 → 1.40 · 20 → ~0.86 · 21 → ~0.74
 *   23 → ~0.56 · 28 → ~0.31 · 35+ → 0.25
 *
 * Unknown age → 1.0 (no sweet-spot boost, no old-age cut). Infer stage
 * from public text instead of treating unknown as 19.
 */

export const AGE_SWEET_MIN = 17;
export const AGE_SWEET_MAX = 19;
export const AGE_SWEET_BOOST = 1.4;
export const AGE_SCALAR_REF = 19;
export const AGE_SCALAR_EXPONENT = 3;
export const AGE_SCALAR_MIN = 0.25;
export const AGE_SCALAR_MAX = 1.6;

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

export function ageScalar(estimatedAge: number | null | undefined): number {
  if (estimatedAge == null || !Number.isFinite(estimatedAge)) return 1;
  if (estimatedAge < 14 || estimatedAge > 55) return 1;

  if (estimatedAge <= AGE_SWEET_MAX) {
    if (estimatedAge >= AGE_SWEET_MIN) return AGE_SWEET_BOOST;
    const younger = AGE_SWEET_BOOST * (AGE_SWEET_MIN / estimatedAge);
    return round3(Math.min(AGE_SCALAR_MAX, younger));
  }

  const descaled = (AGE_SCALAR_REF / estimatedAge) ** AGE_SCALAR_EXPONENT;
  return round3(Math.max(AGE_SCALAR_MIN, descaled));
}

/**
 * Recruiter-facing 1–10. Maps a 0–100 internal score. Zero stays zero
 * (no evidence); anything positive is at least 1.
 */
export function toOverallScore10(priority100: number): number {
  if (!Number.isFinite(priority100) || priority100 <= 0) return 0;
  const n = Math.round(priority100) / 10;
  return Math.max(1, Math.min(10, Math.round(n * 10) / 10));
}
