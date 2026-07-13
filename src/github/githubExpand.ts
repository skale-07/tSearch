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

export interface GithubExpandResult {
  profile: GitHubProfile | null;
  /** Co-authors / project collaborators — primary seed-tree edges. */
  collaborators: string[];
  /** Followers / following / stargazers / forkers — weaker signal. */
  peripheral: string[];
  discovered_logins: string[];
}

export async function expandGithubFromUrl(
  githubUrl: string
): Promise<GithubExpandResult> {
  const username = githubUsernameFromUrl(githubUrl);
  if (!username) {
    return {
      profile: null,
      collaborators: [],
      peripheral: [],
      discovered_logins: [],
    };
  }
  return expandGithubFromUsername(username);
}

export async function expandGithubFromUsername(
  username: string
): Promise<GithubExpandResult> {
  const profile = await fetchGithubProfile(username);
  if (!profile) {
    return {
      profile: null,
      collaborators: [],
      peripheral: [],
      discovered_logins: [],
    };
  }

  const { followers, following } = await fetchFollowersFollowing(username);

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
  }

  const collaborators = [...new Set(contributorSet)].filter(
    (l) => l.toLowerCase() !== username.toLowerCase()
  );
  const peripheral = [
    ...new Set([...followers, ...following, ...starSet, ...forkSet]),
  ].filter(
    (l) =>
      l.toLowerCase() !== username.toLowerCase() &&
      !collaborators.some((c) => c.toLowerCase() === l.toLowerCase())
  );

  profile.contributors = collaborators;
  profile.stars = [...new Set(starSet)];
  profile.forks = [...new Set(forkSet)];
  profile.followers = followers;
  profile.following = following;
  profile.profile_url = `https://github.com/${username}`;

  return {
    profile,
    collaborators,
    peripheral,
    discovered_logins: [...collaborators, ...peripheral],
  };
}
