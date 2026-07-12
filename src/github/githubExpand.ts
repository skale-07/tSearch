import {
  MAX_GITHUB_STARGAZERS_PER_REPO,
  MAX_REPOS_EXPAND,
} from "../config.js";
import type { GitHubProfile } from "../types.js";
import { githubUsernameFromUrl } from "../linkedin/linkedinExtract.js";
import {
  fetchFollowersFollowing,
  fetchForkers,
  fetchGithubProfile,
  fetchRepoContributors,
  fetchStargazers,
} from "./githubUser.js";

export async function expandGithubFromUrl(
  githubUrl: string
): Promise<{ profile: GitHubProfile | null; discovered_logins: string[] }> {
  const username = githubUsernameFromUrl(githubUrl);
  if (!username) return { profile: null, discovered_logins: [] };
  return expandGithubFromUsername(username);
}

export async function expandGithubFromUsername(
  username: string
): Promise<{ profile: GitHubProfile | null; discovered_logins: string[] }> {
  const profile = await fetchGithubProfile(username);
  if (!profile) return { profile: null, discovered_logins: [] };

  const discovered = new Set<string>();
  const { followers, following } = await fetchFollowersFollowing(username);
  for (const l of [...followers, ...following]) discovered.add(l);

  const topRepos = profile.repos
    .sort((a, b) => b.stars - a.stars)
    .slice(0, MAX_REPOS_EXPAND);

  const contributorSet: string[] = [];
  const starSet: string[] = [];
  const forkSet: string[] = [];

  for (const repo of topRepos) {
    const contributors = await fetchRepoContributors(username, repo.name);
    const stargazers = await fetchStargazers(
      username,
      repo.name,
      MAX_GITHUB_STARGAZERS_PER_REPO
    );
    const forkers = await fetchForkers(
      username,
      repo.name,
      MAX_GITHUB_STARGAZERS_PER_REPO
    );
    contributorSet.push(...contributors);
    starSet.push(...stargazers);
    forkSet.push(...forkers);
    for (const l of [...contributors, ...stargazers, ...forkers]) {
      discovered.add(l);
    }
  }

  discovered.delete(username);
  profile.contributors = [...new Set(contributorSet)];
  profile.stars = [...new Set(starSet)];
  profile.forks = [...new Set(forkSet)];
  profile.followers = followers;
  profile.following = following;
  profile.profile_url = `https://github.com/${username}`;

  return { profile, discovered_logins: [...discovered] };
}
