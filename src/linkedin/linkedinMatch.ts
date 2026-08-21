import type { LinkedInSearchHit } from "./linkedinSearch.js";
import type { OlympiadProfile } from "../types.js";

export interface MatchContext {
  query_name: string;
  expected_country?: string;
  school?: string;
  olympiad?: OlympiadProfile;
  olympiad_hints?: string[];
  award_hint?: string;
  org_hint?: string;
}

/** Strip connection degree and keep only the first line / name portion. */
export function cleanSearchTitle(title: string): string {
  const firstLine = title.split(/\n/)[0]?.trim() ?? title.trim();
  return firstLine
    .replace(/\s*[•·|]\s*(\d+(st|nd|rd)\+?|Following).*$/i, "")
    .replace(/\s*[•·|].*$/, "")
    .trim();
}

function nameTokens(raw: string): string[] {
  return cleanSearchTitle(raw)
    .toLowerCase()
    .split(/\s+/)
    .map((t) => t.replace(/^[^a-z0-9à-ÿ]+|[^a-z0-9à-ÿ.]+$/gi, ""))
    .filter(Boolean);
}

/** True when a card token is the last name or its privacy initial ("Q" / "Q."). */
function lastNameMatchesToken(last: string, token: string): boolean {
  const bare = token.replace(/\./g, "");
  if (!bare) return false;
  if (bare === last) return true;
  // LinkedIn often shows "First L." instead of the full surname.
  return bare.length === 1 && bare === last[0];
}

export function nameMatchesQuery(queryName: string, hitTitle: string): boolean {
  const parts = queryName.toLowerCase().split(/\s+/).filter(Boolean);
  const titleParts = nameTokens(hitTitle);
  if (!titleParts.length || !parts.length) return false;
  if (parts.length < 2) {
    return titleParts.some((t) => t.replace(/\./g, "") === parts[0]);
  }

  const first = parts[0]!;
  const last = parts[parts.length - 1]!;

  const hasFirst = titleParts.some((t) => t.replace(/\./g, "") === first);
  if (!hasFirst) return false;

  // Full last name, or first + last initial (LinkedIn truncation).
  if (titleParts.some((t) => lastNameMatchesToken(last, t))) return true;

  // Middle names present on either side — every query token still must appear.
  return parts.every((p) =>
    titleParts.some((t) => t.replace(/\./g, "") === p || lastNameMatchesToken(p, t))
  );
}

/** Name + school and/or country and/or olympiad/award hints — LinkedIn ranking is the signal. */
export function isTargetedSearch(ctx: MatchContext): boolean {
  return !!(
    ctx.school ||
    ctx.expected_country ||
    (ctx.olympiad_hints && ctx.olympiad_hints.length > 0) ||
    ctx.award_hint ||
    ctx.org_hint
  );
}

/**
 * For targeted searches, trust LinkedIn's top result (query already disambiguates).
 * Only require a loose name match on the card title — or accept #1 when the
 * title scrape failed but we still got a profile URL.
 */
export function pickBestLinkedInHit(
  hits: LinkedInSearchHit[],
  ctx: MatchContext
): { hit: LinkedInSearchHit; confidence: number } | null {
  if (!hits.length) return null;

  if (isTargetedSearch(ctx)) {
    const first = hits[0]!;
    if (!first.url) return null;

    // Title scrape flaked — LinkedIn already ranked this card for our query.
    if (!first.title.trim()) {
      return { hit: first, confidence: 0.75 };
    }
    if (nameMatchesQuery(ctx.query_name, first.title)) {
      return { hit: first, confidence: 0.85 };
    }
    for (const hit of hits.slice(1)) {
      if (hit.title.trim() && nameMatchesQuery(ctx.query_name, hit.title)) {
        return { hit, confidence: 0.85 };
      }
    }
    return null;
  }

  const first = hits[0]!;
  if (first.title.trim() && nameMatchesQuery(ctx.query_name, first.title)) {
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
