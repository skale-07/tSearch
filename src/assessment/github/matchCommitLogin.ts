/**
 * Phase-A commit identity matching: login-exact only.
 * Richer GitHubIdentityMap (email/history) is Phase D.
 */

export interface CommitAuthorFields {
  author?: { login?: string | null; name?: string | null } | null;
  committer?: { login?: string | null; name?: string | null } | null;
  /** Nested GitHub commit API shape */
  commit?: {
    author?: { name?: string | null; email?: string | null; date?: string | null };
    committer?: { name?: string | null; email?: string | null; date?: string | null };
  };
}

/**
 * A sample commit matches the candidate only when:
 * - author.login exactly matches canonical login, or
 * - committer.login exactly matches AND metadata does not identify a different author.
 * Never match on display name or unverified email. No login → unmatched.
 */
export function commitMatchesCanonicalLogin(
  commit: CommitAuthorFields,
  canonicalLogin: string
): boolean {
  const want = canonicalLogin.trim().toLowerCase();
  if (!want) return false;

  const authorLogin = commit.author?.login?.trim().toLowerCase() || null;
  const committerLogin = commit.committer?.login?.trim().toLowerCase() || null;

  if (authorLogin === want) return true;

  if (committerLogin === want) {
    // Different author login present → do not attribute via committer alone
    if (authorLogin && authorLogin !== want) return false;
    return true;
  }

  return false;
}

export function buildPhaseAIdentityMap(canonicalLogin: string): {
  candidate_id?: string;
  canonical_login: string;
  identity_support: "exact" | "high" | "medium" | "low";
} {
  const login = canonicalLogin.trim().toLowerCase();
  return {
    canonical_login: login,
    identity_support: login ? "exact" : "low",
  };
}
