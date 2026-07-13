import { MAX_CANDIDATES } from "../config.js";
import type { OlympiadProfile, ResolvedIdentity } from "../types.js";
import { expandGithubFromUrl } from "../github/githubExpand.js";
import { fetchGithubProfile } from "../github/githubUser.js";
import {
  expandSubstackFromSlug,
  expandSubstackFromUrl,
} from "../substack/substackExpand.js";
import { lookupOlympiad } from "../olympiad/parseOlympiad.js";
import { addRaw, type RawCandidate } from "./mergeCandidates.js";

function log(msg: string): void {
  console.log(`[expand] ${msg}`);
}

export interface IdentityNeighbors {
  github: string[];
  /** Explicit project co-authors (stronger than followers/stargazers). */
  collaborators: string[];
  substack: string[];
}

export interface ExpandResult {
  pool: Map<string, RawCandidate>;
  neighbors: Map<string, IdentityNeighbors>;
  /** Seed → collaborator edges for tree visualization / demo. */
  seedTree: SeedTreeEdge[];
}

export interface SeedTreeEdge {
  from: string;
  from_github: string;
  to_github: string;
  via: "github-collaborator";
  repos_hint?: string;
}

/** How many collaborator profiles to hydrate as 1-hop candidates. */
const MAX_COLLABORATOR_PROFILES = Number(
  process.env.MAX_COLLABORATOR_PROFILES ?? 15
);

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

    const githubUrl = identity.github_url ?? identity.website?.github_url;
    if (githubUrl) {
      log(`  github: expanding collaborators from ${githubUrl}`);
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
        hood.github = gh.discovered_logins;
        log(
          `  collaborators (${gh.collaborators.length}): ${gh.collaborators.slice(0, 12).join(", ") || "—"}`
        );
        if (gh.peripheral.length) {
          log(
            `  peripheral (followers/stars/forks, not expanded): ${gh.peripheral.length}`
          );
        }

        for (const login of gh.collaborators) {
          seedTree.push({
            from: query_name,
            from_github: gh.profile.username,
            to_github: login,
            via: "github-collaborator",
          });
        }

        for (const login of gh.collaborators.slice(
          0,
          MAX_COLLABORATOR_PROFILES
        )) {
          const profile = await fetchGithubProfile(login);
          if (!profile) continue;
          const display = profile.display_name || login;
          addRaw(pool, {
            key: login.toLowerCase(),
            name: display,
            discovered_via: [`github-collaborator:${gh.profile.username}`],
            github: profile,
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
