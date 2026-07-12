import {
  LINKEDIN_CACHE_TTL_MS,
  LINKEDIN_DELAY_MS,
  LINKEDIN_SEARCH_CACHE_TTL_MS,
  MAX_IDENTITY_RESOLVES,
} from "../config.js";
import type { LinkedInProfile, OlympiadProfile, ResolvedIdentity } from "../types.js";
import type { SeedQuery } from "../seeds/parseSeeds.js";
import type { LinkedInSession } from "../linkedin/linkedinBrowser.js";
import { openLinkedInSession, sleep } from "../linkedin/linkedinBrowser.js";
import {
  formatSearchQuery,
  searchLinkedInByName,
  type LinkedInSearchHit,
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
import { readCache, writeCache } from "../storage/jsonStore.js";

export interface ResolveOptions {
  olympiadIndex: Map<string, OlympiadProfile>;
  school?: string;
  country?: string;
}

export type ResolveFailureReason =
  | "no_results"
  | "low_confidence"
  | "not_attempted";

export type ResolveOutcome =
  | { ok: true; identity: ResolvedIdentity }
  | { ok: false; reason: Exclude<ResolveFailureReason, "not_attempted"> };

export interface ResolveResults {
  resolved: ResolvedIdentity[];
  failed: { seed: SeedQuery; reason: ResolveFailureReason }[];
}

function resolveCountry(
  seed: SeedQuery,
  olympiad?: OlympiadProfile
): string | undefined {
  return seed.country ?? olympiad?.countries[0];
}

export async function resolveIdentity(
  seed: SeedQuery,
  opts: ResolveOptions & { getSession: () => Promise<LinkedInSession> }
): Promise<ResolveOutcome> {
  const { getSession, olympiadIndex, school } = opts;
  const queryName = seed.name;
  const olympiad = lookupOlympiad(olympiadIndex, queryName);
  const country = resolveCountry(seed, olympiad);
  const searchContext = { school, country };
  const searchQuery = formatSearchQuery(queryName, searchContext);

  console.log(`  [linkedin] search: ${searchQuery}`);

  let hits: LinkedInSearchHit[];
  const cachedSearch = readCache<LinkedInSearchHit[]>(
    "linkedin-search",
    searchQuery,
    LINKEDIN_SEARCH_CACHE_TTL_MS
  );
  if (cachedSearch) {
    hits = cachedSearch.data ?? [];
    console.log(`  [linkedin] search cache hit (${hits.length} results)`);
  } else {
    const session = await getSession();
    hits = await searchLinkedInByName(session, queryName, searchContext);
    writeCache("linkedin-search", searchQuery, hits);
  }

  if (!hits.length) {
    console.log(`  [linkedin] no results for "${queryName}"`);
    return { ok: false, reason: "no_results" };
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
    return { ok: false, reason: "low_confidence" };
  }

  const searchConfirmed = isSearchConfirmed(
    picked.hit,
    matchCtx,
    picked.confidence
  );

  let linkedin: LinkedInProfile;
  let confidence = picked.confidence;

  const cachedProfile = readCache<LinkedInProfile>(
    "linkedin-profile",
    picked.hit.url,
    LINKEDIN_CACHE_TTL_MS
  );

  if (cachedProfile?.data) {
    linkedin = cachedProfile.data;
    console.log(`  [linkedin] profile cache hit: ${picked.hit.url}`);
    if (searchConfirmed) {
      confidence = Math.min(1, confidence + 0.1);
    } else if (country && picked.hit.location) {
      if (countryMatchesText(country, picked.hit.location)) {
        confidence = Math.min(1, confidence + 0.1);
      } else if (!countryMatchesText(country, linkedin.country ?? "")) {
        confidence = Math.max(0, confidence - 0.1);
      }
    }
  } else if (searchConfirmed) {
    console.log(
      `  [linkedin] confirmed from search — ${picked.hit.location} (skipping full profile parse)`
    );
    const base = profileFromSearchHit(picked.hit, queryName);
    const session = await getSession();
    const links = await extractProfileLinksOnly(session, picked.hit.url);
    linkedin = { ...base, ...links };
    confidence = Math.min(1, confidence + 0.1);
    writeCache("linkedin-profile", picked.hit.url, linkedin);
  } else {
    const session = await getSession();
    await sleep(LINKEDIN_DELAY_MS);
    linkedin = await extractLinkedInProfile(session, picked.hit, queryName);
    writeCache("linkedin-profile", picked.hit.url, linkedin);

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
    return { ok: false, reason: "low_confidence" };
  }

  return {
    ok: true,
    identity: {
      query_name: queryName,
      linkedin,
      identity_confidence: confidence,
      github_url: linkedin.github_url,
      substack_url: linkedin.substack_url,
    },
  };
}

export async function resolveIdentities(
  seeds: SeedQuery[],
  olympiadIndex: Map<string, OlympiadProfile>
): Promise<ResolveResults> {
  const resolved: ResolvedIdentity[] = [];
  const failed: ResolveResults["failed"] = [];
  const seen = new Set<string>();
  const cap = Math.min(seeds.length, MAX_IDENTITY_RESOLVES);

  // Lazy: a fully cached run never has to launch Chromium (or need cookies).
  const sessionRef: { current: LinkedInSession | null } = { current: null };
  const getSession = async (): Promise<LinkedInSession> => {
    if (!sessionRef.current) {
      sessionRef.current = await openLinkedInSession();
      console.log("[linkedin] Chromium session open (cookies loaded)");
    }
    return sessionRef.current;
  };

  try {
    for (let i = 0; i < cap; i++) {
      const seed = seeds[i];
      const key = seed.name.trim().toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);

      console.log(`[resolve] (${i + 1}/${cap}) ${seed.name}`);
      const outcome = await resolveIdentity(seed, {
        getSession,
        olympiadIndex,
      });
      if (outcome.ok) {
        const identity = outcome.identity;
        const gh = githubUsernameFromUrl(identity.github_url);
        const ss = substackSlugFromUrl(identity.substack_url);
        console.log(
          `  → ${identity.linkedin.url} conf=${identity.identity_confidence.toFixed(2)} gh=${gh ?? "—"} substack=${ss ?? "—"}`
        );
        resolved.push(identity);
      } else {
        failed.push({ seed, reason: outcome.reason });
      }
    }

    for (let i = cap; i < seeds.length; i++) {
      failed.push({ seed: seeds[i], reason: "not_attempted" });
    }
  } finally {
    if (sessionRef.current) {
      await sessionRef.current.close();
      console.log("[linkedin] Chromium session closed");
    }
  }

  return { resolved, failed };
}

export { githubUsernameFromUrl, substackSlugFromUrl };
