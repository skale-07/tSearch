import { SUBSTACK_CACHE_TTL_MS } from "../config.js";
import type { SubstackProfile } from "../types.js";
import { substackSlugFromUrl } from "../linkedin/linkedinExtract.js";
import { readCache, writeCache } from "../storage/jsonStore.js";
import { fetchSubstackFeed } from "./substackFeed.js";

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36";

async function fetchHomeHtml(slug: string): Promise<string> {
  try {
    const res = await fetch(`https://${slug}.substack.com`, {
      headers: { "User-Agent": USER_AGENT },
    });
    if (!res.ok) return "";
    return await res.text();
  } catch {
    return "";
  }
}

function parseRecommenders(html: string): string[] {
  const names = new Set<string>();
  const pubRe = /href="https:\/\/([a-z0-9-]+)\.substack\.com/gi;
  for (const m of html.matchAll(pubRe)) {
    if (m[1] && m[1] !== "www" && m[1] !== "open") {
      names.add(m[1]);
    }
  }
  return [...names].slice(0, 20);
}

export async function expandSubstackFromSlug(
  slug: string,
  url?: string
): Promise<SubstackProfile> {
  const cached = readCache<SubstackProfile>(
    "substack",
    slug,
    SUBSTACK_CACHE_TTL_MS
  );
  if (cached?.data) {
    console.log(`  [substack] cache hit: ${slug}`);
    return { ...cached.data, url: url ?? cached.data.url };
  }

  const feed = await fetchSubstackFeed(slug);
  const html = await fetchHomeHtml(slug);
  const recommenders = parseRecommenders(html);

  const profile: SubstackProfile = {
    url: url ?? `https://${slug}.substack.com`,
    slug,
    posts: feed?.posts ?? null,
    commenters: [],
    recommenders,
    active: (feed?.posts ?? 0) > 0,
  };
  writeCache("substack", slug, profile);
  return profile;
}

export interface SubstackExpansion {
  profile: SubstackProfile | null;
  discovered_slugs: string[];
}

export async function expandSubstackFromUrl(
  substackUrl: string
): Promise<SubstackExpansion> {
  const slug = substackSlugFromUrl(substackUrl);
  if (!slug) return { profile: null, discovered_slugs: [] };

  const profile = await expandSubstackFromSlug(slug, substackUrl);
  return {
    profile,
    discovered_slugs: profile.recommenders.filter((r) =>
      /^[a-z0-9-]+$/i.test(r)
    ),
  };
}
