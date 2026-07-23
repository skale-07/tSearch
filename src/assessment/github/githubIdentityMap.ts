export interface GitHubIdentityMap {
  candidate_id: string;
  canonical_login: string;
  github_node_id?: string;
  historical_logins: string[];
  commit_identities: Array<{
    login?: string;
    name?: string;
    normalized_email_hash?: string;
    match_class:
      | "verified_login"
      | "verified_email"
      | "strong_cross_link"
      | "name_only"
      | "rejected";
    evidence_ids: string[];
  }>;
  excluded_bot_logins: string[];
  identity_support: "exact" | "high" | "medium" | "low";
  identity_risks: string[];
}

/** Phase A/D: login-exact map without changing stable candidate_id. */
export function buildGitHubIdentityMap(input: {
  candidate_id: string;
  canonical_login: string;
}): GitHubIdentityMap {
  const login = input.canonical_login.trim().toLowerCase();
  return {
    candidate_id: input.candidate_id,
    canonical_login: login,
    historical_logins: login ? [login] : [],
    commit_identities: login
      ? [
          {
            login,
            match_class: "verified_login",
            evidence_ids: [],
          },
        ]
      : [],
    excluded_bot_logins: ["dependabot[bot]", "github-actions[bot]"],
    identity_support: login ? "exact" : "low",
    identity_risks: login ? [] : ["No canonical GitHub login"],
  };
}
