import {
  LINKEDIN_CACHE_TTL_MS,
  LINKEDIN_SEARCH_CACHE_TTL_MS,
  MAX_IDENTITY_RESOLVES,
} from "../config.js";
import type { Candidate, LinkedInProfile, OlympiadProfile, ResolvedIdentity } from "../types.js";
import type { SeedQuery } from "../seeds/parseSeeds.js";
import type { LinkedInSession } from "../linkedin/linkedinBrowser.js";
import { openLinkedInSession } from "../linkedin/linkedinBrowser.js";
import {
  formatSearchQuery,
  searchLinkedInByName,
  type LinkedInSearchHit,
} from "../linkedin/linkedinSearch.js";
import {
  isSearchConfirmed,
  pickBestLinkedInHit,
} from "../linkedin/linkedinMatch.js";
import {
  extractLinkedInProfile,
  isFullLinkedInProfile,
  githubUsernameFromUrl,
  substackSlugFromUrl,
} from "../linkedin/linkedinExtract.js";
import { lookupOlympiad } from "../olympiad/parseOlympiad.js";
import { olympiadSearchHints } from "../olympiad/searchHints.js";
import { readCache, writeCache } from "../storage/jsonStore.js";
import {
  candidateToResolvedIdentity,
  findScrapedCandidate,
} from "./candidateLookup.js";
import { PROFILE_SCRAPE_VERSION } from "../linkedin/linkedinExtract.js";
import {
  applyWebsiteToLinkedInUrls,
  scrapeWebsite,
} from "../website/scrapeWebsite.js";

export interface ResolveOptions {
  olympiadIndex: Map<string, OlympiadProfile>;
  school?: string;
  country?: string;
}

export type ResolveFailureReason =
  | "no_results"
  | "no_name_match"
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
  opts: ResolveOptions & {
    getSession: () => Promise<LinkedInSession>;
    existingCandidates?: Candidate[];
  }
): Promise<ResolveOutcome> {
  const { getSession, olympiadIndex, school, existingCandidates = [] } = opts;
  const queryName = seed.name;
  const olympiad = lookupOlympiad(olympiadIndex, queryName);
  const country = resolveCountry(seed, olympiad);

  const scraped = findScrapedCandidate(existingCandidates, seed, olympiad);
  if (
    scraped?.linkedin &&
    scraped.linkedin.scrape_version === PROFILE_SCRAPE_VERSION
  ) {
    const site = scraped.linkedin.personal_website ?? "—";
    console.log(
      `  [linkedin] skip search — already in candidates.json (${scraped.linkedin.url}) site=${site}`
    );
    return {
      ok: true,
      identity: candidateToResolvedIdentity(scraped, queryName),
    };
  }

  const olympiad_hints = olympiadSearchHints(olympiad);
  const searchContext = { school, country, olympiad_hints };
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
    olympiad_hints,
  };

  const picked = pickBestLinkedInHit(hits, matchCtx);

  if (!picked) {
    console.log(
      `  [linkedin] top results don't match name "${queryName}"`
    );
    for (const h of hits.slice(0, 3)) {
      console.log(`    ? ${h.title}`);
    }
    return { ok: false, reason: "no_name_match" };
  }

  console.log(
    `  [linkedin] top result: ${picked.hit.title}` +
      (picked.hit.headline ? ` — ${picked.hit.headline}` : "") +
      (picked.hit.location ? ` — ${picked.hit.location}` : "")
  );

  const searchConfirmed = isSearchConfirmed(picked.hit, matchCtx);
  let confidence = picked.confidence;

  let linkedin: LinkedInProfile;
  const cachedProfile = readCache<LinkedInProfile>(
    "linkedin-profile-v2",
    picked.hit.url,
    LINKEDIN_CACHE_TTL_MS
  );

  if (cachedProfile?.data && isFullLinkedInProfile(cachedProfile.data)) {
    linkedin = cachedProfile.data;
    console.log(`  [linkedin] profile cache hit: ${picked.hit.url}`);
  } else {
    console.log(`  [linkedin] scraping profile (education, experience, awards)`);
    const session = await getSession();
    linkedin = await extractLinkedInProfile(session, picked.hit, queryName);
    writeCache("linkedin-profile-v2", picked.hit.url, linkedin);
  }

  if (searchConfirmed) {
    confidence = Math.min(1, confidence + 0.1);
  }

  return {
    ok: true,
    identity: {
      query_name: queryName,
      linkedin,
      identity_confidence: confidence,
      github_url: linkedin.github_url,
      substack_url: linkedin.substack_url,
      website: null,
    },
  };
}

async function enrichIdentityFromWebsite(
  identity: ResolvedIdentity
): Promise<void> {
  if (identity.website?.github_url || identity.website?.email) return;

  const siteUrl =
    identity.linkedin.personal_website ?? identity.linkedin.website_url;
  if (!siteUrl) return;

  console.log(`  [website] scraping ${siteUrl}`);
  const website = await scrapeWebsite(siteUrl);
  if (!website) return;

  const merged = applyWebsiteToLinkedInUrls(
    identity.linkedin.github_url,
    identity.linkedin.substack_url,
    identity.linkedin.twitter_url,
    website
  );
  identity.linkedin = {
    ...identity.linkedin,
    github_url: merged.github_url,
    substack_url: merged.substack_url,
    twitter_url: merged.twitter_url,
  };
  identity.github_url = merged.github_url;
  identity.substack_url = merged.substack_url;
  identity.website = website;

  console.log(
    `  [website] ${identity.query_name}: gh=${website.github_url ?? "—"} x=${website.twitter_url ?? "—"} email=${website.email ?? "—"} substack=${website.substack_url ?? "—"}`
  );
}

export async function resolveIdentities(
  seeds: SeedQuery[],
  olympiadIndex: Map<string, OlympiadProfile>,
  existingCandidates: Candidate[] = []
): Promise<ResolveResults> {
  const resolved: ResolvedIdentity[] = [];
  const failed: ResolveResults["failed"] = [];
  const seen = new Set<string>();
  const cap = Math.min(seeds.length, MAX_IDENTITY_RESOLVES);
  const websiteJobs: Promise<void>[] = [];

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
        existingCandidates,
      });
      if (outcome.ok) {
        const identity = outcome.identity;
        const gh = githubUsernameFromUrl(identity.github_url);
        const ss = substackSlugFromUrl(identity.substack_url);
        const site = identity.linkedin.personal_website ?? "—";
        const contactCount = identity.linkedin.contact_links?.length ?? 0;
        console.log(
          `  → ${identity.linkedin.url} conf=${identity.identity_confidence.toFixed(2)} gh=${gh ?? "—"} substack=${ss ?? "—"} site=${site} contact=${contactCount}`
        );
        resolved.push(identity);
        // Overlap website fetch with the next LinkedIn profiles.
        websiteJobs.push(enrichIdentityFromWebsite(identity));
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

  if (websiteJobs.length) {
    console.log(
      `[website] waiting on ${websiteJobs.length} personal-site scrape(s)...`
    );
    await Promise.all(websiteJobs);
  }

  return { resolved, failed };
}

export { githubUsernameFromUrl, substackSlugFromUrl };
