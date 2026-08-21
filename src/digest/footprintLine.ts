import type { DigestCandidate } from "./types.js";

function connectionsLabel(
  count: number | null | undefined,
  saturated?: boolean
): string | null {
  if (count == null || !Number.isFinite(count)) return null;
  if (saturated) return "500+ LinkedIn connections";
  return `${Math.round(count)} LinkedIn connections`;
}

/**
 * Recruiter-facing footprint line for digest cards: connection count first,
 * then a short obscurity read. Not part of the 1–10.
 */
export function digestFootprintLine(c: DigestCandidate): string | null {
  const s = c.surfacing;
  const connections = s?.connections ?? c.score_breakdown?.dials.connections;
  const obscurity = s?.obscurity ?? c.score_breakdown?.dials.obscurity ?? null;
  const parts: string[] = [];
  const conn = connectionsLabel(connections, s?.connections_saturated);
  if (conn) parts.push(conn);
  if (obscurity != null) {
    if (obscurity >= 0.8) parts.push("barely visible online");
    else if (obscurity >= 0.6) parts.push("low public profile");
  }
  if (!parts.length) return null;
  return parts.join(" · ");
}
