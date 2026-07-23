import type { DimensionScoreV2 } from "../types.js";

export function toDimensionScoreV2(n: number): DimensionScoreV2 {
  const clamped = Math.max(0, Math.min(5, Math.round(n)));
  return clamped as DimensionScoreV2;
}

export function averageScores(
  scores: Array<number | null | undefined>
): number | null {
  const vals = scores.filter((s): s is number => typeof s === "number");
  if (!vals.length) return null;
  return vals.reduce((a, b) => a + b, 0) / vals.length;
}
