/** Append derived age next to a display name. Stated ages have no tilde. */
export function withAge(
  name: string,
  ageLabel?: string | null
): string {
  return ageLabel ? `${name} · ${ageLabel}` : name;
}

/** Recruiter-facing 1–10. `priority100` is the legacy 0–100 field. */
export function formatOverallScore(
  priority100?: number | null,
  overall?: number | null
): string | null {
  if (overall != null && Number.isFinite(overall)) {
    return `${overall.toFixed(1)}/10`;
  }
  if (priority100 == null || !Number.isFinite(priority100)) return null;
  if (priority100 <= 0) return "0.0/10";
  const n = Math.max(1, Math.min(10, Math.round(priority100) / 10));
  return `${n.toFixed(1)}/10`;
}
