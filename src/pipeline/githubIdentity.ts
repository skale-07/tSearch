import { githubUsernameFromUrl } from "../linkedin/linkedinExtract.js";
import { ghFetch, type GhSearchUser } from "../github/githubSearch.js";
import { nameMatchConfidence } from "./nameMatch.js";
import {
  corroboratingHits,
  githubCitesKnownIdentity,
  githubProfileBlob,
  identityAnchors,
} from "./githubCorroborate.js";
import type { OlympiadProfile, ResolvedIdentity } from "../types.js";

const SEARCH_TOP_N = 5;
/** First+last in login or exact display name — last-name-only is not enough. */
const MIN_NAME_CONFIDENCE = 0.75;

export interface GithubUserSnippet {
  login: string;
  name: string | null;
  bio: string | null;
  company: string | null;
  location: string | null;
  blog: string | null;
}

export interface GithubSocialAccount {
  provider: string;
  url: string;
}

export interface GithubSearchDeps {
  searchUsers: (name: string) => Promise<GhSearchUser[]>;
  fetchUser: (login: string) => Promise<GithubUserSnippet | null>;
  fetchReadme: (login: string) => Promise<string | null>;
  fetchOrgs: (login: string) => Promise<string | null>;
  fetchSocialAccounts?: (login: string) => Promise<GithubSocialAccount[]>;
}

async function defaultSearchUsers(name: string): Promise<GhSearchUser[]> {
  const q = encodeURIComponent(`${name} in:login,name`);
  const data = await ghFetch<{ items?: GhSearchUser[] }>(
    `/search/users?q=${q}&per_page=${SEARCH_TOP_N}`
  );
  return (data?.items ?? [])
    .filter((u) => !u.type || u.type === "User")
    .slice(0, SEARCH_TOP_N);
}

async function defaultFetchUser(
  login: string
): Promise<GithubUserSnippet | null> {
  const user = await ghFetch<GithubUserSnippet>(`/users/${login}`);
  return user?.login ? user : null;
}

async function defaultFetchReadme(login: string): Promise<string | null> {
  const data = await ghFetch<{ content?: string; encoding?: string }>(
    `/repos/${login}/${login}/readme`
  );
  if (!data?.content || data.encoding !== "base64") return null;
  try {
    return Buffer.from(data.content, "base64").toString("utf8");
  } catch {
    return null;
  }
}

async function defaultFetchOrgs(login: string): Promise<string | null> {
  const orgs = await ghFetch<Array<{ login: string; description?: string | null }>>(
    `/users/${login}/orgs?per_page=20`
  );
  if (!orgs?.length) return null;
  return orgs
    .map((o) => `${o.login} ${o.description ?? ""}`)
    .join(" ");
}

async function defaultFetchSocialAccounts(
  login: string
): Promise<GithubSocialAccount[]> {
  const data = await ghFetch<GithubSocialAccount[]>(
    `/users/${login}/social_accounts`
  );
  return data ?? [];
}

const defaultDeps: GithubSearchDeps = {
  searchUsers: defaultSearchUsers,
  fetchUser: defaultFetchUser,
  fetchReadme: defaultFetchReadme,
  fetchOrgs: defaultFetchOrgs,
  fetchSocialAccounts: defaultFetchSocialAccounts,
};

function knownWebsiteUrls(identity: ResolvedIdentity): Array<string | null> {
  return [
    identity.linkedin.personal_website,
    identity.linkedin.website_url,
    identity.website?.url ?? null,
  ];
}

function profileText(parts: Array<string | null | undefined>): string {
  return parts.filter((p) => !!p?.trim()).join("\n");
}

/**
 * GitHub attachment after this person's LinkedIn (+ personal-site scrape).
 * Never runs before LinkedIn for the same identity — there is nothing to
 * verify a GitHub hit against.
 *
 * 1. Keep github.com/<user> already on LinkedIn or that site.
 * 2. Else search the name (login/display name — not school), inspect top 5,
 *    and attach only when the GitHub profile points back at the LinkedIn
 *    URL or personal site we already have (bio, blog, social_accounts, README).
 *    School/college tokens are a last-resort fallback. Name-only is dropped.
 */
export async function attachVerifiedGithub(
  identity: ResolvedIdentity,
  opts?: { olympiad?: OlympiadProfile; deps?: GithubSearchDeps }
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
    console.log(`  [github] drop non-profile URL (${identity.github_url})`);
    identity.github_url = null;
  }

  const anchors = identityAnchors(identity.linkedin, opts?.olympiad);
  const websites = knownWebsiteUrls(identity);
  const hasLinkTarget =
    !!identity.linkedin.url || websites.some((url) => !!url);
  if (!hasLinkTarget && !anchors.length) {
    console.log(
      "  [github] skip search — no LinkedIn/website/school to corroborate against"
    );
    identity.github_url = null;
    return;
  }

  const deps = opts?.deps ?? defaultDeps;
  const hits = await deps.searchUsers(identity.query_name);
  if (!hits.length) {
    console.log("  [github] name search returned no users");
    identity.github_url = null;
    return;
  }

  for (const hit of hits) {
    const user = await deps.fetchUser(hit.login);
    if (!user) continue;
    const nameConf = nameMatchConfidence(
      identity.query_name,
      user.login,
      user.name
    );
    if (nameConf < MIN_NAME_CONFIDENCE) {
      console.log(
        `  [github] drop ${user.login} — weak name match (${nameConf.toFixed(2)})`
      );
      continue;
    }

    const social = deps.fetchSocialAccounts
      ? await deps.fetchSocialAccounts(user.login)
      : [];
    const socialText = social.map((s) => s.url).join("\n");
    let surface = profileText([
      user.bio,
      user.company,
      user.location,
      user.blog,
      socialText,
    ]);

    let cited = githubCitesKnownIdentity(
      surface,
      identity.linkedin.url,
      websites
    );
    let readme: string | null = null;
    if (!cited) {
      readme = await deps.fetchReadme(user.login);
      surface = profileText([surface, readme]);
      cited = githubCitesKnownIdentity(
        surface,
        identity.linkedin.url,
        websites
      );
    }
    if (cited) {
      identity.github_url = `https://github.com/${user.login}`;
      console.log(
        `  [github] verified ${user.login} via ${cited.via} (${cited.detail})`
      );
      return;
    }

    let blob = githubProfileBlob({ ...user, readme });
    let matched = corroboratingHits(anchors, blob);
    if (!matched.length) {
      const orgs = await deps.fetchOrgs(user.login);
      blob = githubProfileBlob({ ...user, readme, orgs });
      matched = corroboratingHits(anchors, blob);
    }
    if (!matched.length) {
      console.log(
        `  [github] drop ${user.login} — name matches, no LinkedIn/website/school overlap`
      );
      continue;
    }

    identity.github_url = `https://github.com/${user.login}`;
    console.log(
      `  [github] verified ${user.login} via school/college (${matched.slice(0, 3).join(", ")})`
    );
    return;
  }

  identity.github_url = null;
  console.log("  [github] no corroborated profile in top search hits — dropped");
}

/** One GitHub identity job at a time — overlaps LinkedIn, does not stampede /search/users. */
let githubQueue: Promise<void> = Promise.resolve();

export function enqueueVerifiedGithub(
  identity: ResolvedIdentity,
  opts?: { olympiad?: OlympiadProfile; deps?: GithubSearchDeps }
): Promise<void> {
  const job = githubQueue.then(() => attachVerifiedGithub(identity, opts));
  githubQueue = job.then(
    () => undefined,
    () => undefined
  );
  return job;
}
