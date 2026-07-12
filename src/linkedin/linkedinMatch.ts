import type { LinkedInSearchHit } from "./linkedinSearch.js";
import type { OlympiadProfile } from "../types.js";
import { countryMatchesText } from "./countryMatch.js";

export interface MatchContext {
  query_name: string;
  expected_country?: string;
  olympiad?: OlympiadProfile;
  github_username?: string;
  substack_slug?: string;
}

function nameInText(name: string, text: string): boolean {
  const parts = name.toLowerCase().split(/\s+/).filter(Boolean);
  const t = text.toLowerCase();
  return parts.length >= 2 && parts.every((p) => t.includes(p));
}

function countriesToCheck(ctx: MatchContext): string[] {
  const out = new Set<string>();
  if (ctx.expected_country) out.add(ctx.expected_country);
  for (const c of ctx.olympiad?.countries ?? []) {
    if (c) out.add(c);
  }
  return [...out];
}

export function scoreLinkedInHit(
  hit: LinkedInSearchHit,
  ctx: MatchContext
): number {
  let score = 0;
  const nameBlob = `${hit.title}`;
  const locationBlob = hit.location || "";
  const headlineBlob = hit.headline || "";

  if (
    nameInText(ctx.query_name, hit.title) ||
    nameInText(ctx.query_name, nameBlob)
  ) {
    score += 40;
  }

  for (const country of countriesToCheck(ctx)) {
    if (countryMatchesText(country, locationBlob)) {
      score += 35;
      break;
    }
    if (
      locationBlob &&
      countryMatchesText(country, headlineBlob) &&
      !countryMatchesText(country, locationBlob)
    ) {
      score += 5;
    }
  }

  if (ctx.olympiad) {
    for (const prize of ctx.olympiad.prizes) {
      const tokens = ["imo", "ioi", "ipho", "icho", "olympiad", "gold", "silver"];
      const blob = `${headlineBlob} ${locationBlob}`.toLowerCase();
      if (tokens.some((t) => prize.toLowerCase().includes(t) && blob.includes(t))) {
        score += 10;
      }
    }
  }

  if (ctx.github_username) {
    const gh = ctx.github_username.toLowerCase();
    const lower = `${headlineBlob} ${locationBlob}`.toLowerCase();
    if (lower.includes(gh) || lower.includes(`github.com/${gh}`)) score += 25;
  }

  if (ctx.substack_slug) {
    const slug = ctx.substack_slug.toLowerCase();
    const lower = `${headlineBlob} ${locationBlob}`.toLowerCase();
    if (lower.includes(slug) || lower.includes(`${slug}.substack.com`)) score += 20;
  }

  const headlineKeywords = [
    "student",
    "founder",
    "engineer",
    "researcher",
    "intern",
    "phd",
    "undergraduate",
  ];
  if (headlineKeywords.some((k) => headlineBlob.toLowerCase().includes(k))) {
    score += 5;
  }

  return Math.min(score, 100) / 100;
}

export function pickBestLinkedInHit(
  hits: LinkedInSearchHit[],
  ctx: MatchContext
): { hit: LinkedInSearchHit; confidence: number } | null {
  if (!hits.length) return null;

  let best = hits[0];
  let bestScore = scoreLinkedInHit(best, ctx);

  for (const hit of hits.slice(1)) {
    const s = scoreLinkedInHit(hit, ctx);
    if (s > bestScore) {
      best = hit;
      bestScore = s;
    }
  }

  return { hit: best, confidence: bestScore };
}

export const SEARCH_CONFIRM_THRESHOLD = 0.65;

export function isSearchConfirmed(
  hit: LinkedInSearchHit,
  ctx: MatchContext,
  confidence: number
): boolean {
  if (confidence < SEARCH_CONFIRM_THRESHOLD) return false;
  if (!nameInText(ctx.query_name, hit.title)) return false;

  const countries = countriesToCheck(ctx);
  if (countries.length === 0) return true;
  if (!hit.location) return false;

  return countries.some((c) => countryMatchesText(c, hit.location));
}
