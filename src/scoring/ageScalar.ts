/**
 * Chronological age scalar for ranking.
 *
 * Product rule (Grace/Cory): the same technical/base score must rank higher
 * for a younger person and lower for an older one. Applied as a multiplier on
 * discovery `final_score` and assessment `priority_score`.
 *
 * Curve: unity at AGE_REF (22). `scalar = clamp(AGE_REF / age, MIN, MAX)`.
 *   16 → ~1.38 · 18 → ~1.22 · 22 → 1.00 · 28 → ~0.79 · 35 → ~0.63 · 44+ → 0.50
 *
 * Unknown / garbage age → 1.0 (neutral). That lets age-unknown peers outrank
 * known older candidates — prefer improving `deriveStage` coverage over inventing ages.
 */

export const AGE_SCALAR_REF = 22;
export const AGE_SCALAR_MIN = 0.5;
export const AGE_SCALAR_MAX = 1.4;

export function ageScalar(estimatedAge: number | null | undefined): number {
  if (estimatedAge == null || !Number.isFinite(estimatedAge)) return 1;
  if (estimatedAge < 14 || estimatedAge > 55) return 1;
  const raw = AGE_SCALAR_REF / estimatedAge;
  const clamped = Math.max(AGE_SCALAR_MIN, Math.min(AGE_SCALAR_MAX, raw));
  return Math.round(clamped * 1000) / 1000;
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
