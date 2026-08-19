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
  type LinkedInSearchContext,
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
  PROFILE_SCRAPE_VERSION,
} from "../linkedin/linkedinExtract.js";
import { lookupOlympiad } from "../olympiad/parseOlympiad.js";
import {
  olympiadCollege,
  olympiadHighSchool,
  olympiadSearchHints,
  normalizeSchoolForSearch,
} from "../olympiad/searchHints.js";
import { footprintCrossCheck } from "./footprintSweep.js";
import { loadPerson } from "../storage/personStore.js";
import { readCache, writeCache } from "../storage/jsonStore.js";
import {
  candidateToResolvedIdentity,
  findScrapedCandidate,
} from "./candidateLookup.js";
import {
  applyWebsiteToLinkedInUrls,
  scrapeWebsite,
} from "../website/scrapeWebsite.js";
import { awardLinkedInSearchTerm } from "../awards/awardRegistry.js";
import { attachVerifiedGithub } from "./githubIdentity.js";

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
  const award_hint = awardLinkedInSearchTerm(seed.award_id);
  const highSchoolRaw = school?.trim() || olympiadHighSchool(olympiad);
  const highSchool = highSchoolRaw
    ? normalizeSchoolForSearch(highSchoolRaw) || undefined
    : undefined;
  const collegeRaw = olympiadCollege(olympiad);
  const college = collegeRaw
    ? normalizeSchoolForSearch(collegeRaw) || undefined
    : undefined;
  const matchCtx = {
    query_name: queryName,
    expected_country: country,
    school: highSchool,
    olympiad,
    olympiad_hints,
    award_hint,
  };

  // Award → college → school → olympiad/country. One token besides the name.
  const attempts: { label: string; context: LinkedInSearchContext }[] = [];
  if (award_hint) {
    attempts.push({
      label: "name+award",
      context: { award_hint },
    });
  }
  if (college) {
    attempts.push({
      label: "name+college",
      context: { college },
    });
  }
  if (highSchool) {
    attempts.push({
      label: "name+school",
      context: { school: highSchool },
    });
  }
  attempts.push({
    label: "name+olympiad",
    context: { country, olympiad_hints },
  });

  let hits: LinkedInSearchHit[] = [];
  let picked: { hit: LinkedInSearchHit; confidence: number } | null = null;
  let usedLabel = attempts[0]?.label ?? "name+olympiad";
  let sawHits = false;

  for (let ai = 0; ai < attempts.length; ai++) {
    const attempt = attempts[ai];
    const searchQuery = formatSearchQuery(queryName, attempt.context);
    console.log(`  [linkedin] search (${attempt.label}): ${searchQuery}`);

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
      hits = await searchLinkedInByName(session, queryName, attempt.context);
      // Don't cache empty — timeouts/auth walls look like "no results" and
      // would block retries for LINKEDIN_SEARCH_CACHE_TTL_MS.
      if (hits.length) writeCache("linkedin-search", searchQuery, hits);
    }

    if (!hits.length) {
      console.log(`  [linkedin] no results for "${queryName}" (${attempt.label})`);
      continue;
    }
    sawHits = true;

    const attemptMatchCtx = {
      ...matchCtx,
      school:
        attempt.label === "name+school" || attempt.label === "name+college"
          ? highSchool
          : undefined,
      expected_country:
        attempt.label === "name+olympiad" ? country : undefined,
      olympiad_hints:
        attempt.label === "name+olympiad" ? olympiad_hints : undefined,
      award_hint: attempt.label === "name+award" ? award_hint : undefined,
    };
    picked = pickBestLinkedInHit(hits, attemptMatchCtx);
    if (picked) {
      usedLabel = attempt.label;
      break;
    }

    console.log(
      `  [linkedin] top results don't match name "${queryName}" (${attempt.label})`
    );
    for (const h of hits.slice(0, 3)) {
      console.log(
        `    ? ${h.title || "(no title scraped)"} — ${h.url}`
      );
    }
    if (ai < attempts.length - 1) {
      console.log(`  [linkedin] falling back to ${attempts[ai + 1].label}`);
    }
  }

  if (!picked) {
    return { ok: false, reason: sawHits ? "no_name_match" : "no_results" };
  }

  console.log(
    `  [linkedin] top result (${usedLabel}): ${picked.hit.title}` +
      (picked.hit.headline ? ` — ${picked.hit.headline}` : "") +
      (picked.hit.location ? ` — ${picked.hit.location}` : "")
  );

  const searchConfirmed = isSearchConfirmed(picked.hit, {
    ...matchCtx,
    school: usedLabel === "name+school" ? highSchool : matchCtx.school,
  });
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

  // Cross-source check: LinkedIn-verified GitHub agreeing with the sweep's
  // independent name-based guess is strong identity evidence.
  const guess = loadPerson(queryName)?.footprint?.github_login_guess;
  const verifiedLogin = githubUsernameFromUrl(linkedin.github_url);
  const crossed = footprintCrossCheck(confidence, guess, verifiedLogin);
  if (crossed.confirmed) {
    console.log(
      `  [verify] footprint guess confirmed by LinkedIn (${verifiedLogin}) — confidence ${confidence.toFixed(2)} → ${crossed.confidence.toFixed(2)}`
    );
    confidence = crossed.confidence;
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

  // Contact-info personal website is the certain path to the source of truth.
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
    // Keep contact personal site; prefer final resolved URL from the fetch.
    personal_website: website.url || identity.linkedin.personal_website,
    website_url: website.url || identity.linkedin.website_url,
  };
  identity.github_url = merged.github_url;
  identity.substack_url = merged.substack_url;
  identity.website = website;

  if (merged.overrides.length) {
    console.log(
      `  [website] overrides LinkedIn → ${merged.overrides.join("; ")}`
    );
  }
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
      let outcome: ResolveOutcome;
      try {
        outcome = await resolveIdentity(seed, {
          getSession,
          olympiadIndex,
          existingCandidates,
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.warn(`  [resolve] aborted for ${seed.name}: ${msg}`);
        failed.push({ seed, reason: "no_results" });
        continue;
      }
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

  // GitHub only from LinkedIn / personal-site URLs — never name-search.
  for (const identity of resolved) {
    await attachVerifiedGithub(identity);
  }

  return { resolved, failed };
}

export { githubUsernameFromUrl, substackSlugFromUrl };
