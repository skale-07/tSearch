import { githubUsernameFromUrl } from "../linkedin/linkedinExtract.js";
import type { ResolvedIdentity } from "../types.js";

/**
 * GitHub attachment after LinkedIn (+ personal-site scrape).
 *
 * Only real github.com/<user> URLs already on LinkedIn or that personal
 * site count. No GitHub user name-search — querying by name is not identity.
 * Pages sites (.github.io/…) are not GitHub identity.
 */
export async function attachVerifiedGithub(
  identity: ResolvedIdentity
): Promise<void> {
  const login = githubUsernameFromUrl(identity.github_url);
  if (login) {
    identity.github_url = `https://github.com/${login}`;
    console.log(
      `  [github] using LinkedIn/website URL (${identity.github_url})`
    );
    return;
  }
  if (identity.github_url) {
    console.log(
      `  [github] drop non-profile URL (${identity.github_url})`
    );
    identity.github_url = null;
  } else {
    console.log(`  [github] skip — no GitHub on LinkedIn/website`);
  }
}
