import {
  MAX_CANDIDATES,
  MAX_FOLLOWER_PROFILES,
  MIN_CONTEXT_SCORE_TO_EXPAND,
} from "../config.js";
import type { OlympiadProfile, ResolvedIdentity } from "../types.js";
import { expandGithubFromUrl } from "../github/githubExpand.js";
import { fetchGithubProfile } from "../github/githubUser.js";
import {
  expandSubstackFromSlug,
  expandSubstackFromUrl,
} from "../substack/substackExpand.js";
import { lookupOlympiad } from "../olympiad/parseOlympiad.js";
import type { GitHubProfile, WebsiteProfile } from "../types.js";
import { scrapeWebsite } from "../website/scrapeWebsite.js";
import { addRaw, type RawCandidate } from "./mergeCandidates.js";

async function websiteFromGithubBlog(
  profile: GitHubProfile
): Promise<WebsiteProfile | undefined> {
  const raw = profile.blog?.trim();
  if (!raw) return undefined;
  const url = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  const site = await scrapeWebsite(url);
  return site ?? undefined;
}

function log(msg: string): void {
  console.log(`[expand] ${msg}`);
}

export interface IdentityNeighbors {
  github: string[];
  collaborators: string[];
  followers: string[];
  substack: string[];
}

export interface ExpandResult {
  pool: Map<string, RawCandidate>;
  neighbors: Map<string, IdentityNeighbors>;
  seedTree: SeedTreeEdge[];
}

export interface SeedTreeEdge {
  from: string;
  from_github: string;
  to_github: string;
  via: "github-collaborator" | "github-follower" | "website-colocated";
  context_score?: number;
  context_signals?: string[];
  /** 1 = off seed, 2 = off a branch neighbor */
  hop?: 1 | 2;
  /** For hop 2: the branch parent's github login */
  via_node?: string;
  /** Root seed github when hop=2 (from_github may be the branch parent) */
  root_github?: string;
  /** Hop-1 folder relation of the branch parent */
  parent_relation?: "collaborator" | "follower" | "website";
}

const MAX_COLLABORATOR_PROFILES = Number(
  process.env.MAX_COLLABORATOR_PROFILES ?? 15
);

/**
 * Seed candidates only — LinkedIn (+ website/olympiad already on the identity).
 * No GitHub/Substack neighbor expand. Used by RESOLVE_ONLY runs.
 */
export function identitiesToSeedPool(
  identities: ResolvedIdentity[],
  olympiadIndex: Map<string, OlympiadProfile>
): ExpandResult {
  const pool = new Map<string, RawCandidate>();
  const neighbors = new Map<string, IdentityNeighbors>();

  for (const identity of identities) {
    const { query_name, linkedin, identity_confidence } = identity;
    const oly = lookupOlympiad(olympiadIndex, query_name);
    const identityKey = query_name.trim().toLowerCase();
    neighbors.set(identityKey, {
      github: [],
      collaborators: [],
      followers: [],
      substack: [],
    });

    addRaw(pool, {
      key: identityKey,
      name: query_name,
      discovered_via: [`linkedin:${query_name}`],
      linkedin,
      identity_confidence,
      olympiad: oly,
      website: identity.website ?? undefined,
    });
  }

  return { pool, neighbors, seedTree: [] };
}

export async function expandGraph(
  identities: ResolvedIdentity[],
  olympiadIndex: Map<string, OlympiadProfile>
): Promise<ExpandResult> {
  const pool = new Map<string, RawCandidate>();
  const neighbors = new Map<string, IdentityNeighbors>();
  const seedTree: SeedTreeEdge[] = [];

  for (const identity of identities) {
    const { query_name, linkedin, identity_confidence } = identity;
    const oly = lookupOlympiad(olympiadIndex, query_name);
    const identityKey = query_name.trim().toLowerCase();
    const hood: IdentityNeighbors = {
      github: [],
      collaborators: [],
      followers: [],
      substack: [],
    };
    neighbors.set(identityKey, hood);

    log(`identity: ${query_name} (${linkedin.url})`);

    addRaw(pool, {
      key: query_name.trim().toLowerCase(),
      name: query_name,
      discovered_via: [`linkedin:${query_name}`],
      linkedin,
      identity_confidence,
      olympiad: oly,
      website: identity.website ?? undefined,
    });

    if (identity.website) {
      log(
        `  website ${identity.website.url} → gh=${identity.website.github_url ?? "—"} x=${identity.website.twitter_url ?? "—"} email=${identity.website.email ?? "—"}`
      );
    }

    // Personal website github always beats LinkedIn-derived github_url.
    const githubUrl =
      identity.website?.github_url ??
      identity.github_url ??
      null;
    if (githubUrl) {
      log(`  github: expanding collaborators + followers from ${githubUrl}`);
      const gh = await expandGithubFromUrl(githubUrl);
      if (gh.profile) {
        addRaw(pool, {
          key: query_name.trim().toLowerCase(),
          name: query_name,
          discovered_via: [`github-verified:${query_name}`],
          linkedin,
          identity_confidence,
          github: gh.profile,
          website: identity.website ?? undefined,
          olympiad: oly,
        });

        hood.collaborators = gh.collaborators;
        hood.followers = gh.profile.followers;
        hood.github = gh.discovered_logins;

        log(
          `  collaborators (${gh.collaborators.length}): ${gh.collaborators.slice(0, 12).join(", ") || "—"}`
        );
        log(
          `  followers (${gh.profile.followers.length}): ${gh.profile.followers.slice(0, 12).join(", ") || "—"}`
        );

        for (const login of gh.collaborators.slice(
          0,
          MAX_COLLABORATOR_PROFILES
        )) {
          seedTree.push({
            from: query_name,
            from_github: gh.profile.username,
            to_github: login,
            via: "github-collaborator",
            hop: 1,
          });

          const profile = await fetchGithubProfile(login, {
            includeRecentCommits: false,
          });
          if (!profile) continue;

          seedTree[seedTree.length - 1].context_score = profile.context_score;
          seedTree[seedTree.length - 1].context_signals =
            profile.context_signals;

          const website = await websiteFromGithubBlog(profile);
          const display = profile.display_name || login;
          addRaw(pool, {
            key: login.toLowerCase(),
            name: display,
            discovered_via: [`github-collaborator:${gh.profile.username}`],
            github: profile,
            website,
            identity_confidence: 0,
            olympiad: lookupOlympiad(olympiadIndex, display),
          });
        }

        // Hydrate followers, then keep only those with enough public context
        // to seed another enrichment hop (blog/socials/email/etc.).
        const followerProfiles: {
          login: string;
          profile: NonNullable<Awaited<ReturnType<typeof fetchGithubProfile>>>;
        }[] = [];

        for (const login of gh.profile.followers.slice(0, MAX_FOLLOWER_PROFILES)) {
          const profile = await fetchGithubProfile(login, {
            includeRecentCommits: false,
          });
          if (!profile) continue;
          followerProfiles.push({ login, profile });
        }

        followerProfiles.sort(
          (a, b) => b.profile.context_score - a.profile.context_score
        );

        const richFollowers = followerProfiles.filter(
          (f) => f.profile.context_score >= MIN_CONTEXT_SCORE_TO_EXPAND
        );

        log(
          `  rich followers (context>=${MIN_CONTEXT_SCORE_TO_EXPAND}): ${richFollowers
            .slice(0, 10)
            .map((f) => `${f.login}(${f.profile.context_score})`)
            .join(", ") || "—"}`
        );

        for (const { login, profile } of richFollowers) {
          seedTree.push({
            from: query_name,
            from_github: gh.profile.username,
            to_github: login,
            via: "github-follower",
            hop: 1,
            context_score: profile.context_score,
            context_signals: profile.context_signals,
          });

          const website = await websiteFromGithubBlog(profile);
          const display = profile.display_name || login;
          addRaw(pool, {
            key: login.toLowerCase(),
            name: display,
            discovered_via: [`github-follower:${gh.profile.username}`],
            github: profile,
            website,
            identity_confidence: 0,
            olympiad: lookupOlympiad(olympiadIndex, display),
          });
        }
      }
    } else {
      log(`  github: no URL`);
    }

    if (identity.substack_url) {
      const ss = await expandSubstackFromUrl(identity.substack_url);
      if (ss.profile) {
        addRaw(pool, {
          key: query_name.trim().toLowerCase(),
          name: query_name,
          discovered_via: [`substack-verified:${query_name}`],
          linkedin,
          identity_confidence,
          substack: ss.profile,
          website: identity.website ?? undefined,
          olympiad: oly,
        });
        log(
          `  substack ${identity.substack_url} → ${ss.discovered_slugs.length} neighbors`
        );
        hood.substack = ss.discovered_slugs;

        for (const slug of ss.discovered_slugs.slice(0, 10)) {
          const neighbor = await expandSubstackFromSlug(slug);
          addRaw(pool, {
            key: `substack:${slug}`,
            name: slug,
            discovered_via: [`substack-1hop:${ss.profile.slug}`],
            substack: neighbor,
            identity_confidence: 0,
          });
        }
      }
    } else {
      log(`  substack: no URL`);
    }
  }

  if (pool.size > MAX_CANDIDATES) {
    log(`pool ${pool.size} > cap ${MAX_CANDIDATES} (merge will trim)`);
  }

  return { pool, neighbors, seedTree };
}
