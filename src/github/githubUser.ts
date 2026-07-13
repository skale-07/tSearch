import type { GitHubProfile, GitHubSocialLink, Repo } from "../types.js";
import { ghFetch } from "./githubSearch.js";

interface GhRepo {
  name: string;
  topics?: string[];
  language: string | null;
  stargazers_count: number;
  pushed_at: string | null;
}

interface GhUser {
  login: string;
  name: string | null;
  bio: string | null;
  blog: string | null;
  twitter_username: string | null;
  company: string | null;
  location: string | null;
  email: string | null;
  html_url: string;
}

interface GhSocialAccount {
  provider: string;
  url: string;
}

interface GhCommit {
  commit?: { author?: { date?: string } };
}

export function computeGithubContextScore(input: {
  bio: string | null;
  blog: string | null;
  twitter_username: string | null;
  company: string | null;
  location: string | null;
  email: string | null;
  social_accounts: GitHubSocialLink[];
  repos: number;
}): { score: number; signals: string[] } {
  const signals: string[] = [];
  let score = 0;

  if (input.blog?.trim()) {
    score += 3;
    signals.push("blog");
  }
  if (input.twitter_username?.trim()) {
    score += 2;
    signals.push("twitter");
  }
  if (input.email?.trim()) {
    score += 2;
    signals.push("email");
  }
  if (input.bio && input.bio.trim().length >= 20) {
    score += 1;
    signals.push("bio");
  }
  if (input.company?.trim()) {
    score += 1;
    signals.push("company");
  }
  if (input.location?.trim()) {
    score += 1;
    signals.push("location");
  }
  for (const s of input.social_accounts) {
    const p = s.provider.toLowerCase();
    if (signals.includes(p)) continue;
    score += 2;
    signals.push(p);
  }
  if (input.repos >= 5) {
    score += 1;
    signals.push("repos");
  }

  return { score, signals };
}

export async function fetchGithubProfile(
  username: string,
  opts: { includeRecentCommits?: boolean } = {}
): Promise<GitHubProfile | null> {
  const includeRecentCommits = opts.includeRecentCommits ?? true;
  const user = await ghFetch<GhUser>(`/users/${username}`);
  if (!user) return null;

  const reposRaw = await ghFetch<GhRepo[]>(
    `/users/${username}/repos?sort=pushed&per_page=30`
  );
  if (!reposRaw) return null;

  const socialRaw =
    (await ghFetch<GhSocialAccount[]>(
      `/users/${username}/social_accounts`
    )) ?? [];

  const repos: Repo[] = reposRaw.map((r) => ({
    name: r.name,
    topics: r.topics ?? [],
    language: r.language,
    stars: r.stargazers_count,
    pushed_at: r.pushed_at,
  }));

  const social_accounts: GitHubSocialLink[] = socialRaw
    .filter((s) => s?.url)
    .map((s) => ({ provider: s.provider || "unknown", url: s.url }));

  let recentCommits = 0;
  if (includeRecentCommits) {
    const sinceIso = new Date(
      Date.now() - 30 * 24 * 60 * 60 * 1000
    ).toISOString();
    for (const repo of repos.slice(0, 5)) {
      const commits = await ghFetch<GhCommit[]>(
        `/repos/${username}/${repo.name}/commits?since=${sinceIso}&per_page=30`
      );
      if (commits) recentCommits += commits.length;
    }
  }

  const { score, signals } = computeGithubContextScore({
    bio: user.bio,
    blog: user.blog,
    twitter_username: user.twitter_username,
    company: user.company,
    location: user.location,
    email: user.email,
    social_accounts,
    repos: repos.length,
  });

  const active = repos.length > 3 || recentCommits > 5;

  return {
    username: user.login,
    display_name: user.name,
    profile_url: user.html_url || `https://github.com/${user.login}`,
    bio: user.bio,
    blog: user.blog?.trim() ? user.blog.trim() : null,
    twitter_username: user.twitter_username,
    company: user.company,
    location: user.location,
    email: user.email,
    social_accounts,
    context_score: score,
    context_signals: signals,
    repos,
    contributors: [],
    stars: [],
    forks: [],
    followers: [],
    following: [],
    recent_commits: recentCommits,
    active,
  };
}

export async function fetchFollowersFollowing(
  username: string
): Promise<{ followers: string[]; following: string[] }> {
  const followers = await ghFetch<{ login: string }[]>(
    `/users/${username}/followers?per_page=30`
  );
  const following = await ghFetch<{ login: string }[]>(
    `/users/${username}/following?per_page=30`
  );
  return {
    followers: followers?.map((u) => u.login) ?? [],
    following: following?.map((u) => u.login) ?? [],
  };
}

export async function fetchRepoContributors(
  username: string,
  repo: string
): Promise<string[]> {
  const data = await ghFetch<{ login: string }[]>(
    `/repos/${username}/${repo}/contributors?per_page=30`
  );
  return data?.map((c) => c.login).filter((l) => l !== username) ?? [];
}

export async function fetchStargazers(
  username: string,
  repo: string,
  limit: number
): Promise<string[]> {
  const data = await ghFetch<{ user: { login: string } }[]>(
    `/repos/${username}/${repo}/stargazers?per_page=${Math.min(limit, 30)}`
  );
  return data?.map((s) => s.user.login) ?? [];
}

export async function fetchForkers(
  username: string,
  repo: string,
  limit: number
): Promise<string[]> {
  const data = await ghFetch<{ owner: { login: string } }[]>(
    `/repos/${username}/${repo}/forks?per_page=${Math.min(limit, 30)}`
  );
  return (
    data?.map((f) => f.owner.login).filter((l) => l !== username) ?? []
  );
}
