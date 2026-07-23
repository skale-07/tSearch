/**
 * Identity-surface score for explorer indicators.
 * Weights off-GitHub presence only — everyone already has GitHub.
 *
 * High: LinkedIn, personal website/blog
 * Low: X/Twitter and other socials
 */
export const SURFACE_WEIGHTS = {
  linkedin: 4,
  writing: 4,
  email: 3,
  twitter: 1,
  other_social: 1,
} as const;

/** Practical max used for color normalization (linkedin + writing + email + twitter). */
export const SURFACE_SCORE_MAX =
  SURFACE_WEIGHTS.linkedin +
  SURFACE_WEIGHTS.writing +
  SURFACE_WEIGHTS.email +
  SURFACE_WEIGHTS.twitter;

export interface IdentitySurfaceInput {
  linkedin_url?: string | null;
  website_url?: string | null;
  blog_url?: string | null;
  twitter_url?: string | null;
  twitter_username?: string | null;
  email?: string | null;
  social_accounts?: { provider: string; url: string }[] | null;
}

export function computeIdentitySurfaceScore(input: IdentitySurfaceInput): {
  score: number;
  signals: string[];
} {
  const signals: string[] = [];
  let score = 0;

  const hasLinkedIn =
    !!input.linkedin_url?.trim() ||
    !!input.social_accounts?.some(
      (s) => s.provider.toLowerCase() === "linkedin" && s.url
    );
  if (hasLinkedIn) {
    score += SURFACE_WEIGHTS.linkedin;
    signals.push("linkedin");
  }

  const hasWriting = !!(
    input.website_url?.trim() ||
    input.blog_url?.trim()
  );
  if (hasWriting) {
    score += SURFACE_WEIGHTS.writing;
    signals.push("writing");
  }

  const hasTwitter =
    !!input.twitter_username?.trim() ||
    !!input.twitter_url?.trim() ||
    !!input.social_accounts?.some((s) => {
      const p = s.provider.toLowerCase();
      return (p === "twitter" || p === "x") && !!s.url;
    });
  if (hasTwitter) {
    score += SURFACE_WEIGHTS.twitter;
    signals.push("twitter");
  }

  if (input.email?.trim()) {
    score += SURFACE_WEIGHTS.email;
    signals.push("email");
  }

  const seen = new Set(signals);
  let otherCount = 0;
  for (const s of input.social_accounts ?? []) {
    const p = s.provider.toLowerCase();
    if (!s.url) continue;
    if (
      p === "linkedin" ||
      p === "twitter" ||
      p === "x" ||
      p === "github"
    ) {
      continue;
    }
    if (seen.has(p) || otherCount >= 2) continue;
    score += SURFACE_WEIGHTS.other_social;
    signals.push(p);
    seen.add(p);
    otherCount++;
  }

  return { score, signals };
}

/** Yellow → orange → red. t in [0, 1]. */
export function surfaceScoreToRgb(t: number): { r: number; g: number; b: number } {
  const x = Math.min(1, Math.max(0, t));
  // #e8c56a → #e8873a → #e8453a
  const stops = [
    { t: 0, r: 232, g: 197, b: 106 },
    { t: 0.5, r: 232, g: 135, b: 58 },
    { t: 1, r: 232, g: 69, b: 58 },
  ];
  let i = 0;
  while (i < stops.length - 2 && x > stops[i + 1].t) i++;
  const a = stops[i];
  const b = stops[i + 1];
  const u = (x - a.t) / (b.t - a.t || 1);
  return {
    r: Math.round(a.r + (b.r - a.r) * u),
    g: Math.round(a.g + (b.g - a.g) * u),
    b: Math.round(a.b + (b.b - a.b) * u),
  };
}

export function surfaceScoreToCss(score: number, max = SURFACE_SCORE_MAX): string {
  if (score <= 0) return "rgba(154, 163, 178, 0.35)";
  const t = Math.min(1, score / max);
  const { r, g, b } = surfaceScoreToRgb(t);
  return `rgb(${r}, ${g}, ${b})`;
}
