import type { LinkedInSearchHit } from "./linkedinSearch.js";
import type { OlympiadProfile } from "../types.js";

export interface MatchContext {
  query_name: string;
  olympiad?: OlympiadProfile;
  github_username?: string;
  substack_slug?: string;
}

function norm(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function nameInText(name: string, text: string): boolean {
  const parts = name.toLowerCase().split(/\s+/).filter(Boolean);
  const t = text.toLowerCase();
  return parts.length >= 2 && parts.every((p) => t.includes(p));
}

export function scoreLinkedInHit(
  hit: LinkedInSearchHit,
  ctx: MatchContext
): number {
  let score = 0;
  const blob = `${hit.title} ${hit.snippet}`.toLowerCase();

  if (nameInText(ctx.query_name, hit.title) || nameInText(ctx.query_name, blob)) {
    score += 40;
  }

  if (ctx.olympiad) {
    for (const country of ctx.olympiad.countries) {
      if (country && blob.includes(country.toLowerCase())) score += 15;
    }
    for (const prize of ctx.olympiad.prizes) {
      const tokens = ["imo", "ioi", "ipho", "icho", "olympiad", "gold", "silver"];
      if (tokens.some((t) => prize.toLowerCase().includes(t) && blob.includes(t))) {
        score += 10;
      }
    }
  }

  if (ctx.github_username) {
    const gh = ctx.github_username.toLowerCase();
    if (blob.includes(gh) || blob.includes(`github.com/${gh}`)) score += 25;
  }

  if (ctx.substack_slug) {
    const slug = ctx.substack_slug.toLowerCase();
    if (blob.includes(slug) || blob.includes(`${slug}.substack.com`)) score += 20;
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
  if (headlineKeywords.some((k) => blob.includes(k))) score += 5;

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
