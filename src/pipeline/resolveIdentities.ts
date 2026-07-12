import { LINKEDIN_DELAY_MS, MAX_IDENTITY_RESOLVES } from "../config.js";
import type { OlympiadProfile, ResolvedIdentity } from "../types.js";
import { openLinkedInSession, sleep } from "../linkedin/linkedinBrowser.js";
import { searchLinkedInByName } from "../linkedin/linkedinSearch.js";
import { pickBestLinkedInHit } from "../linkedin/linkedinMatch.js";
import {
  extractLinkedInProfile,
  githubUsernameFromUrl,
  substackSlugFromUrl,
} from "../linkedin/linkedinExtract.js";
import { lookupOlympiad } from "../olympiad/parseOlympiad.js";

export interface ResolveOptions {
  olympiadIndex: Map<string, OlympiadProfile>;
  school?: string;
  country?: string;
}

export async function resolveIdentity(
  queryName: string,
  opts: ResolveOptions & { session: Awaited<ReturnType<typeof openLinkedInSession>> }
): Promise<ResolvedIdentity | null> {
  const { session, olympiadIndex, school, country } = opts;
  const olympiad = lookupOlympiad(olympiadIndex, queryName);

  const hits = await searchLinkedInByName(session, queryName, {
    school,
    country: country ?? olympiad?.countries[0],
  });

  if (!hits.length) {
    console.log(`  [linkedin] no results for "${queryName}"`);
    return null;
  }

  const picked = pickBestLinkedInHit(hits, {
    query_name: queryName,
    olympiad,
  });

  if (!picked || picked.confidence < 0.35) {
    console.log(
      `  [linkedin] low confidence (${picked?.confidence ?? 0}) for "${queryName}"`
    );
    return null;
  }

  await sleep(LINKEDIN_DELAY_MS);
  const linkedin = await extractLinkedInProfile(
    session,
    picked.hit,
    queryName
  );

  return {
    query_name: queryName,
    linkedin,
    identity_confidence: picked.confidence,
    github_url: linkedin.github_url,
    substack_url: linkedin.substack_url,
  };
}

export async function resolveIdentities(
  names: string[],
  olympiadIndex: Map<string, OlympiadProfile>
): Promise<ResolvedIdentity[]> {
  const resolved: ResolvedIdentity[] = [];
  const seen = new Set<string>();
  const cap = Math.min(names.length, MAX_IDENTITY_RESOLVES);

  const session = await openLinkedInSession();
  console.log("[linkedin] Chromium session open (cookies loaded)");

  try {
    for (let i = 0; i < cap; i++) {
      const name = names[i];
      const key = name.trim().toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);

      console.log(`[resolve] (${i + 1}/${cap}) ${name}`);
      const identity = await resolveIdentity(name, {
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
