import type { GitHubProfile, SubstackProfile, WebsiteProfile } from "../types.js";

/**
 * Followers are fetched with per_page=30 (githubUser.ts), so the count is
 * exact below 30 and saturates above it. That asymmetry is acceptable here:
 * obscurity only needs precision at the undiscovered end.
 */
export const FOLLOWER_FETCH_CAP = 30;

/** Stars across all repos at which someone is plainly "discovered" on GitHub. */
const STAR_VISIBILITY_CEILING = 100;

/** LinkedIn stops reporting exact counts around here anyway. */
const CONNECTION_VISIBILITY_CEILING = 500;

export interface ObscuritySignals {
  github_followers: number | null;
  github_followers_saturated: boolean;
  total_stars: number | null;
  website_present: boolean;
  website_substantive: boolean;
  writing_present: boolean;
  /** Populated once LinkedIn connection capture ships; null until then. */
  linkedin_connections: number | null;
}

export interface ObscurityResult {
  /** 0 = highly visible, 1 = essentially invisible. */
  obscurity: number;
  /** Share of the signal weight that was actually observable. */
  confidence: number;
  /**
   * Whether there is anything to be undiscovered *about*. An empty profile
   * scores maximally obscure, which is meaningless — consumers must gate the
   * obscurity multiplier on this flag.
   */
  substance_present: boolean;
  signals: ObscuritySignals;
}

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}

/** A site is "substantive" when it links outward beyond a bare link-tree. */
function websiteSubstantive(website?: WebsiteProfile): boolean {
  if (!website) return false;
  return (website.all_links?.length ?? 0) >= 8;
}

export function computeObscurity(input: {
  github?: GitHubProfile;
  substack?: SubstackProfile;
  website?: WebsiteProfile;
  /** Optional until LinkedIn connection capture ships. */
  linkedinConnections?: number | null;
}): ObscurityResult {
  const { github, substack, website } = input;

  // Persisted profiles from older runs (and fixtures) may omit these arrays.
  const followers = github ? (github.followers?.length ?? 0) : null;
  const followersSaturated =
    followers !== null && followers >= FOLLOWER_FETCH_CAP;
  const totalStars = github
    ? (github.repos ?? []).reduce((sum, r) => sum + (r.stars ?? 0), 0)
    : null;
  const connections = input.linkedinConnections ?? null;

  const signals: ObscuritySignals = {
    github_followers: followers,
    github_followers_saturated: followersSaturated,
    total_stars: totalStars,
    website_present: !!website,
    website_substantive: websiteSubstantive(website),
    writing_present: !!substack?.active && (substack.posts ?? 0) > 0,
    linkedin_connections: connections,
  };

  // Each term is a visibility score in 0..1 with the weight it carries when
  // observable; unobservable terms drop out and the rest are renormalized so a
  // missing surface never reads as "invisible".
  const terms: Array<{ visibility: number; weight: number }> = [];

  if (followers !== null) {
    terms.push({
      visibility: clamp01(followers / FOLLOWER_FETCH_CAP),
      weight: 0.3,
    });
  }
  if (totalStars !== null) {
    terms.push({
      visibility: clamp01(totalStars / STAR_VISIBILITY_CEILING),
      weight: 0.3,
    });
  }
  // Website/writing are always observable: absence is itself the signal, and
  // absence is exactly what "hasn't built out a presence yet" means.
  terms.push({
    visibility: signals.website_substantive ? 1 : signals.website_present ? 0.5 : 0,
    weight: 0.2,
  });
  terms.push({ visibility: signals.writing_present ? 1 : 0, weight: 0.2 });

  if (connections !== null) {
    terms.push({
      visibility: clamp01(connections / CONNECTION_VISIBILITY_CEILING),
      weight: 0.35,
    });
  }

  const totalWeight = terms.reduce((s, t) => s + t.weight, 0);
  const visibility =
    totalWeight > 0
      ? terms.reduce((s, t) => s + t.visibility * t.weight, 0) / totalWeight
      : 0;

  // Confidence reflects how much of the *possible* signal set we observed.
  const maxWeight = 0.3 + 0.3 + 0.2 + 0.2 + 0.35;
  const confidence = clamp01(totalWeight / maxWeight);

  const substance_present =
    (github?.repos?.length ?? 0) > 0 || (substack?.posts ?? 0) > 0;

  return {
    obscurity: Math.round(clamp01(1 - visibility) * 100) / 100,
    confidence: Math.round(confidence * 100) / 100,
    substance_present,
    signals,
  };
}

/**
 * The surfacing multiplier Grace asked for: undiscovered *and* accomplished.
 * Obscurity alone is degenerate — an empty profile is maximally undiscovered —
 * so this returns null whenever there is no substance to be undiscovered about.
 */
export function upsideMultiplier(o: ObscurityResult): number | null {
  if (!o.substance_present) return null;
  // Low-confidence obscurity is pulled toward neutral rather than trusted.
  const damped = 0.5 + (o.obscurity - 0.5) * Math.max(0.4, o.confidence);
  return Math.round(clamp01(damped) * 100) / 100;
}
