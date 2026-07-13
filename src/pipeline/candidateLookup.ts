import { countriesMatch } from "../linkedin/countryMatch.js";
import type { Candidate, OlympiadProfile, ResolvedIdentity } from "../types.js";
import type { SeedQuery } from "../seeds/parseSeeds.js";

export function normKey(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, " ");
}

export function candidateMatchesSeed(
  candidate: Candidate,
  seed: SeedQuery,
  olympiad?: OlympiadProfile
): boolean {
  if (!candidate.linkedin?.url) return false;

  const seedKey = normKey(seed.name);
  if (normKey(candidate.name) !== seedKey && candidate.key !== seedKey) {
    return false;
  }

  const seedCountry = seed.country ?? olympiad?.countries[0];
  if (seedCountry && candidate.olympiad?.countries?.length) {
    const countryOk = candidate.olympiad.countries.some((c) =>
      countriesMatch(seedCountry, c)
    );
    if (!countryOk) return false;
  }

  const seedSources = olympiad?.sources ?? [];
  if (seedSources.length) {
    if (!candidate.olympiad?.sources?.length) return false;
    const sourceOk = seedSources.some((s) =>
      candidate.olympiad!.sources.includes(s)
    );
    if (!sourceOk) return false;
  }

  return true;
}

export function findScrapedCandidate(
  candidates: Candidate[],
  seed: SeedQuery,
  olympiad?: OlympiadProfile
): Candidate | undefined {
  return candidates.find((c) => candidateMatchesSeed(c, seed, olympiad));
}

export function candidateToResolvedIdentity(
  candidate: Candidate,
  queryName: string
): ResolvedIdentity {
  return {
    query_name: queryName,
    linkedin: candidate.linkedin!,
    identity_confidence: candidate.identity_confidence,
    github_url:
      candidate.linkedin?.github_url ?? candidate.website?.github_url ?? null,
    substack_url:
      candidate.linkedin?.substack_url ?? candidate.website?.substack_url ?? null,
    website: candidate.website ?? null,
  };
}
