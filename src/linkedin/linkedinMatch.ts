import type { LinkedInSearchHit } from "./linkedinSearch.js";
import type { OlympiadProfile } from "../types.js";

export interface MatchContext {
  query_name: string;
  expected_country?: string;
  school?: string;
  olympiad?: OlympiadProfile;
  olympiad_hints?: string[];
}

/** Strip connection degree and keep only the first line / name portion. */
export function cleanSearchTitle(title: string): string {
  const firstLine = title.split(/\n/)[0]?.trim() ?? title.trim();
  return firstLine
    .replace(/\s*[•·|]\s*(\d+(st|nd|rd)\+?|Following).*$/i, "")
    .replace(/\s*[•·|].*$/, "")
    .trim();
}

export function nameMatchesQuery(queryName: string, hitTitle: string): boolean {
  const title = cleanSearchTitle(hitTitle).toLowerCase();
  const parts = queryName.toLowerCase().split(/\s+/).filter(Boolean);
  if (!title || !parts.length) return false;
  if (parts.length < 2) return title.includes(parts[0]);

  // Every query name part must appear in the name line (not headline/location).
  return parts.every((p) => title.includes(p));
}

/** Name + school and/or country and/or olympiad hints — LinkedIn ranking is the signal. */
export function isTargetedSearch(ctx: MatchContext): boolean {
  return !!(
    ctx.school ||
    ctx.expected_country ||
    (ctx.olympiad_hints && ctx.olympiad_hints.length > 0)
  );
}

/**
 * For targeted searches, trust LinkedIn's top result (query already disambiguates).
 * Only require a loose name match on the card title.
 */
export function pickBestLinkedInHit(
  hits: LinkedInSearchHit[],
  ctx: MatchContext
): { hit: LinkedInSearchHit; confidence: number } | null {
  if (!hits.length) return null;

  if (isTargetedSearch(ctx)) {
    // Trust LinkedIn ranking — first card is almost always right for these queries.
    const first = hits[0];
    if (nameMatchesQuery(ctx.query_name, first.title)) {
      return { hit: first, confidence: 0.85 };
    }
    for (const hit of hits.slice(1)) {
      if (nameMatchesQuery(ctx.query_name, hit.title)) {
        return { hit, confidence: 0.85 };
      }
    }
    return null;
  }

  const first = hits[0];
  if (nameMatchesQuery(ctx.query_name, first.title)) {
    return { hit: first, confidence: 0.5 };
  }
  return null;
}

export function isSearchConfirmed(
  hit: LinkedInSearchHit,
  ctx: MatchContext
): boolean {
  return nameMatchesQuery(ctx.query_name, hit.title) && isTargetedSearch(ctx);
}
