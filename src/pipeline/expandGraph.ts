import { MAX_CANDIDATES } from "../config.js";
import type { OlympiadProfile, ResolvedIdentity } from "../types.js";
import { expandGithubFromUrl } from "../github/githubExpand.js";
import { fetchGithubProfile } from "../github/githubUser.js";
import { expandSubstackFromSlug, expandSubstackFromUrl } from "../substack/substackExpand.js";
import { lookupOlympiad } from "../olympiad/parseOlympiad.js";
import { addRaw, type RawCandidate } from "./mergeCandidates.js";

function log(msg: string): void {
  console.log(`[expand] ${msg}`);
}

export async function expandGraph(
  identities: ResolvedIdentity[],
  olympiadIndex: Map<string, OlympiadProfile>
): Promise<Map<string, RawCandidate>> {
  const pool = new Map<string, RawCandidate>();

  for (const identity of identities) {
    const { query_name, linkedin, identity_confidence } = identity;
    const oly = lookupOlympiad(olympiadIndex, query_name);

    log(`identity: ${query_name} (${linkedin.url})`);

    addRaw(pool, {
      key: query_name.trim().toLowerCase(),
      name: linkedin.name || query_name,
      discovered_via: [`linkedin:${query_name}`],
      linkedin,
      identity_confidence,
      olympiad: oly,
    });

    if (identity.github_url) {
      const gh = await expandGithubFromUrl(identity.github_url);
      if (gh.profile) {
        addRaw(pool, {
          key: query_name.trim().toLowerCase(),
          name: linkedin.name || query_name,
          discovered_via: [`github-verified:${query_name}`],
          linkedin,
          identity_confidence,
          github: gh.profile,
          olympiad: oly,
        });
        log(
          `  github ${identity.github_url} → ${gh.discovered_logins.length} neighbors`
        );

        for (const login of gh.discovered_logins.slice(0, 20)) {
          const profile = await fetchGithubProfile(login);
          if (!profile) continue;
          const display = profile.display_name || login;
          addRaw(pool, {
            key: login.toLowerCase(),
            name: display,
            discovered_via: [`github-1hop:${gh.profile.username}`],
            github: profile,
            identity_confidence: 0,
            olympiad: lookupOlympiad(olympiadIndex, display),
          });
        }
      }
    } else {
      log(`  github: no URL from LinkedIn`);
    }

    if (identity.substack_url) {
      const ss = await expandSubstackFromUrl(identity.substack_url);
      if (ss.profile) {
        addRaw(pool, {
          key: query_name.trim().toLowerCase(),
          name: linkedin.name || query_name,
          discovered_via: [`substack-verified:${query_name}`],
          linkedin,
          identity_confidence,
          substack: ss.profile,
          olympiad: oly,
        });
        log(
          `  substack ${identity.substack_url} → ${ss.discovered_slugs.length} neighbors`
        );

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
      log(`  substack: no URL from LinkedIn`);
    }
  }

  if (pool.size > MAX_CANDIDATES) {
    log(`pool ${pool.size} > cap ${MAX_CANDIDATES} (merge will trim)`);
  }

  return pool;
}
