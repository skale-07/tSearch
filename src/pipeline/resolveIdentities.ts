import { LINKEDIN_DELAY_MS, MAX_IDENTITY_RESOLVES } from "../config.js";
import type { OlympiadProfile, ResolvedIdentity } from "../types.js";
import type { SeedQuery } from "../seeds/parseSeeds.js";
import { openLinkedInSession, sleep } from "../linkedin/linkedinBrowser.js";
import {
  formatSearchQuery,
  searchLinkedInByName,
} from "../linkedin/linkedinSearch.js";
import {
  isSearchConfirmed,
  pickBestLinkedInHit,
} from "../linkedin/linkedinMatch.js";
import { countryMatchesText } from "../linkedin/countryMatch.js";
import {
  extractLinkedInProfile,
  extractProfileLinksOnly,
  profileFromSearchHit,
  githubUsernameFromUrl,
  substackSlugFromUrl,
} from "../linkedin/linkedinExtract.js";
import { lookupOlympiad } from "../olympiad/parseOlympiad.js";

export interface ResolveOptions {
  olympiadIndex: Map<string, OlympiadProfile>;
  school?: string;
  country?: string;
}

function resolveCountry(
  seed: SeedQuery,
  olympiad?: OlympiadProfile
): string | undefined {
  return seed.country ?? olympiad?.countries[0];
}

export async function resolveIdentity(
  seed: SeedQuery,
  opts: ResolveOptions & { session: Awaited<ReturnType<typeof openLinkedInSession>> }
): Promise<ResolvedIdentity | null> {
  const { session, olympiadIndex, school } = opts;
  const queryName = seed.name;
  const olympiad = lookupOlympiad(olympiadIndex, queryName);
  const country = resolveCountry(seed, olympiad);
  const searchContext = { school, country };

  console.log(
    `  [linkedin] search: ${formatSearchQuery(queryName, searchContext)}`
  );

  const hits = await searchLinkedInByName(session, queryName, searchContext);

  if (!hits.length) {
    console.log(`  [linkedin] no results for "${queryName}"`);
    return null;
  }

  const matchCtx = {
    query_name: queryName,
    expected_country: country,
    olympiad,
  };

  const picked = pickBestLinkedInHit(hits, matchCtx);

  if (!picked || picked.confidence < 0.35) {
    console.log(
      `  [linkedin] low confidence (${picked?.confidence ?? 0}) for "${queryName}"`
    );
    return null;
  }

  const searchConfirmed = isSearchConfirmed(
    picked.hit,
    matchCtx,
    picked.confidence
  );

  let linkedin;
  let confidence = picked.confidence;

  if (searchConfirmed) {
    console.log(
      `  [linkedin] confirmed from search — ${picked.hit.location} (skipping full profile parse)`
    );
    linkedin = profileFromSearchHit(picked.hit, queryName);
    const links = await extractProfileLinksOnly(session, picked.hit.url);
    linkedin = { ...linkedin, ...links };
    confidence = Math.min(1, confidence + 0.1);
  } else {
    await sleep(LINKEDIN_DELAY_MS);
    linkedin = await extractLinkedInProfile(session, picked.hit, queryName);

    if (country && picked.hit.location) {
      if (countryMatchesText(country, picked.hit.location)) {
        confidence = Math.min(1, confidence + 0.1);
      } else if (!countryMatchesText(country, linkedin.country ?? "")) {
        console.log(
          `  [linkedin] country mismatch (expected ${country}, search: ${picked.hit.location})`
        );
        confidence = Math.max(0, confidence - 0.1);
      }
    }
  }

  if (confidence < 0.35) {
    console.log(
      `  [linkedin] rejected after country check (conf=${confidence.toFixed(2)})`
    );
    return null;
  }

  return {
    query_name: queryName,
    linkedin,
    identity_confidence: confidence,
    github_url: linkedin.github_url,
    substack_url: linkedin.substack_url,
  };
}

export async function resolveIdentities(
  seeds: SeedQuery[],
  olympiadIndex: Map<string, OlympiadProfile>
): Promise<ResolvedIdentity[]> {
  const resolved: ResolvedIdentity[] = [];
  const seen = new Set<string>();
  const cap = Math.min(seeds.length, MAX_IDENTITY_RESOLVES);

  const session = await openLinkedInSession();
  console.log("[linkedin] Chromium session open (cookies loaded)");

  try {
    for (let i = 0; i < cap; i++) {
      const seed = seeds[i];
      const key = seed.name.trim().toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);

      console.log(`[resolve] (${i + 1}/${cap}) ${seed.name}`);
      const identity = await resolveIdentity(seed, {
        session,
        olympiadIndex,
      });
      if (identity) {
        const gh = githubUsernameFromUrl(identity.github_url);
        const ss = substackSlugFromUrl(identity.substack_url);
        console.log(
          `  → ${identity.linkedin.url} conf=${identity.identity_confidence.toFixed(2)} gh=${gh ?? "—"} substack=${ss ?? "—"}`
        );
        resolved.push(identity);
      }
    }
  } finally {
    await session.close();
    console.log("[linkedin] Chromium session closed");
  }

  return resolved;
}

export { githubUsernameFromUrl, substackSlugFromUrl };
