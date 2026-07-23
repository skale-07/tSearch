import { canonicalizeUrl } from "./canonicalizeUrl.js";
import { BLOG_BUDGETS } from "./types.js";
import type { SitemapUrlEntry } from "./types.js";

const COMMON_SITEMAP_PATHS = [
  "/sitemap.xml",
  "/sitemap_index.xml",
  "/sitemap-index.xml",
  "/post-sitemap.xml",
  "/blog-sitemap.xml",
];

export function discoverSitemapUrls(
  robotsSitemaps: string[],
  baseUrl: string
): string[] {
  const found = new Set<string>();
  for (const s of robotsSitemaps) {
    const c = canonicalizeUrl(s, baseUrl);
    if (c) found.add(c);
  }
  let origin: string;
  try {
    origin = new URL(baseUrl).origin;
  } catch {
    return [...found];
  }
  for (const p of COMMON_SITEMAP_PATHS) {
    const c = canonicalizeUrl(origin + p);
    if (c) found.add(c);
  }
  return [...found];
}

/**
 * Parse urlset or sitemapindex lightly via regex.
 * Nested sitemap locs are returned with lastmod when present; caller may fetch them.
 */
export function parseSitemapXml(
  xml: string,
  opts?: { maxUrls?: number }
): { urls: SitemapUrlEntry[]; nestedSitemaps: string[] } {
  const max = opts?.maxUrls ?? BLOG_BUDGETS.MAX_SITEMAP_URLS;
  const nestedSitemaps: string[] = [];
  const urls: SitemapUrlEntry[] = [];

  const sitemapRe = /<sitemap\b[^>]*>([\s\S]*?)<\/sitemap>/gi;
  let m: RegExpExecArray | null;
  while ((m = sitemapRe.exec(xml)) !== null) {
    const loc = firstTag(m[1], "loc");
    if (loc) nestedSitemaps.push(loc.trim());
  }

  const urlRe = /<url\b[^>]*>([\s\S]*?)<\/url>/gi;
  while ((m = urlRe.exec(xml)) !== null && urls.length < max) {
    const loc = firstTag(m[1], "loc");
    if (!loc) continue;
    const lastmod = firstTag(m[1], "lastmod") ?? undefined;
    urls.push({
      loc: loc.trim(),
      lastmod: lastmod ? normalizeDate(lastmod) : undefined,
    });
  }

  // Prefer recently modified first
  urls.sort((a, b) => {
    const ta = a.lastmod ? Date.parse(a.lastmod) : 0;
    const tb = b.lastmod ? Date.parse(b.lastmod) : 0;
    return tb - ta;
  });

  return { urls: urls.slice(0, max), nestedSitemaps };
}

function firstTag(block: string, name: string): string | undefined {
  const re = new RegExp(`<${name}\\b[^>]*>([\\s\\S]*?)<\\/${name}>`, "i");
  return block.match(re)?.[1]?.trim();
}

function normalizeDate(raw: string): string {
  const t = Date.parse(raw);
  if (!Number.isNaN(t)) return new Date(t).toISOString();
  return raw.trim();
}

export function fetchSitemapsFromBodies(
  sitemaps: Array<{ url: string; body: string }>,
  opts?: { maxUrls?: number }
): SitemapUrlEntry[] {
  const max = opts?.maxUrls ?? BLOG_BUDGETS.MAX_SITEMAP_URLS;
  const out: SitemapUrlEntry[] = [];
  const seen = new Set<string>();
  for (const sm of sitemaps) {
    const { urls } = parseSitemapXml(sm.body, { maxUrls: max });
    for (const u of urls) {
      const loc = canonicalizeUrl(u.loc, sm.url) ?? u.loc;
      if (!loc || seen.has(loc)) continue;
      seen.add(loc);
      out.push({ loc, lastmod: u.lastmod });
      if (out.length >= max) return out;
    }
  }
  return out;
}
