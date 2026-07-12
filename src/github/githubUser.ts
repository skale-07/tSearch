import type { GitHubProfile, Repo } from "../types.js";
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
}

interface GhCommit {
  commit?: { author?: { date?: string } };
}

export async function fetchGithubProfile(
  username: string
): Promise<GitHubProfile | null> {
  const user = await ghFetch<GhUser>(`/users/${username}`);
  if (!user) return null;

  const reposRaw = await ghFetch<GhRepo[]>(
    `/users/${username}/repos?sort=pushed&per_page=30`
  );
  if (!reposRaw) return null;

  const repos: Repo[] = reposRaw.map((r) => ({
    name: r.name,
    topics: r.topics ?? [],
    language: r.language,
    stars: r.stargazers_count,
    pushed_at: r.pushed_at,
  }));

  const sinceIso = new Date(
    Date.now() - 30 * 24 * 60 * 60 * 1000
  ).toISOString();

  let recentCommits = 0;
  for (const repo of repos.slice(0, 5)) {
    const commits = await ghFetch<GhCommit[]>(
      `/repos/${username}/${repo.name}/commits?since=${sinceIso}&per_page=30`
    );
    if (commits) recentCommits += commits.length;
  }

  const active = repos.length > 3 || recentCommits > 5;

  return {
    username: user.login,
    display_name: user.name,
    profile_url: `https://github.com/${user.login}`,
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
