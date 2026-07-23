import { canonicalizeUrl } from "./canonicalizeUrl.js";
import { BLOG_BUDGETS } from "./types.js";
import type { FeedEntry } from "./types.js";

const COMMON_FEED_PATHS = [
  "/feed",
  "/rss",
  "/rss.xml",
  "/feed.xml",
  "/atom.xml",
  "/index.xml",
  "/feeds/posts/default",
];

/** Discover feed URLs from HTML link tags and common paths. */
export function discoverFeedUrls(html: string, baseUrl: string): string[] {
  const found = new Set<string>();
  const linkRe =
    /<link[^>]+rel=["'][^"']*alternate[^"']*["'][^>]*>/gi;
  let m: RegExpExecArray | null;
  while ((m = linkRe.exec(html)) !== null) {
    const tag = m[0];
    const type = tag.match(/type=["']([^"']+)["']/i)?.[1] ?? "";
    if (!/rss|atom|xml/i.test(type) && !/rss|atom/i.test(tag)) continue;
    const href = tag.match(/href=["']([^"']+)["']/i)?.[1];
    if (!href) continue;
    const c = canonicalizeUrl(href, baseUrl);
    if (c) found.add(c);
  }

  let origin: string;
  try {
    origin = new URL(baseUrl).origin;
  } catch {
    return [...found];
  }
  for (const p of COMMON_FEED_PATHS) {
    const c = canonicalizeUrl(origin + p);
    if (c) found.add(c);
  }
  return [...found];
}

/**
 * Light RSS/Atom parse via regex — enough for fixture titles/links without a full XML DOM.
 */
export function parseFeedXml(
  xml: string,
  opts?: { maxEntries?: number }
): FeedEntry[] {
  const max = opts?.maxEntries ?? BLOG_BUDGETS.MAX_FEED_ENTRIES;
  const entries: FeedEntry[] = [];

  // RSS items
  const itemRe = /<item\b[^>]*>([\s\S]*?)<\/item>/gi;
  let m: RegExpExecArray | null;
  while ((m = itemRe.exec(xml)) !== null && entries.length < max) {
    entries.push(parseItemBlock(m[1], "rss"));
  }

  // Atom entries
  if (entries.length === 0) {
    const entryRe = /<entry\b[^>]*>([\s\S]*?)<\/entry>/gi;
    while ((m = entryRe.exec(xml)) !== null && entries.length < max) {
      entries.push(parseItemBlock(m[1], "atom"));
    }
  }

  return entries.slice(0, max);
}

function parseItemBlock(block: string, kind: "rss" | "atom"): FeedEntry {
  const title = decodeXml(
    firstTag(block, "title") ?? firstCdata(block, "title") ?? ""
  );
  let link = "";
  if (kind === "rss") {
    link =
      firstTag(block, "link") ??
      firstTag(block, "guid") ??
      "";
  } else {
    const alt = block.match(
      /<link[^>]+rel=["']alternate["'][^>]*href=["']([^"']+)["']/i
    ) ?? block.match(/<link[^>]+href=["']([^"']+)["'][^>]*\/?>/i);
    link = alt?.[1] ?? firstTag(block, "id") ?? "";
  }

  const published_at =
    firstTag(block, "pubDate") ??
    firstTag(block, "published") ??
    firstTag(block, "dc:date") ??
    undefined;
  const updated_at =
    firstTag(block, "updated") ?? firstTag(block, "atom:updated") ?? undefined;
  const author =
    firstTag(block, "author") ??
    firstNested(block, "author", "name") ??
    firstTag(block, "dc:creator") ??
    undefined;
  const categories: string[] = [];
  const catRe = /<category\b[^>]*(?:>([^<]*)<\/category>|\/?>)/gi;
  let cm: RegExpExecArray | null;
  while ((cm = catRe.exec(block)) !== null) {
    const term =
      cm[1]?.trim() ||
      cm[0].match(/term=["']([^"']+)["']/i)?.[1] ||
      "";
    if (term) categories.push(decodeXml(term));
  }
  const summary =
    firstTag(block, "description") ??
    firstTag(block, "summary") ??
    firstTag(block, "content") ??
    undefined;

  return {
    title,
    link: link.trim(),
    published_at: published_at ? normalizeDate(published_at) : undefined,
    updated_at: updated_at ? normalizeDate(updated_at) : undefined,
    author: author ? decodeXml(author) : undefined,
    categories,
    summary: summary ? stripTags(decodeXml(summary)).slice(0, 2000) : undefined,
  };
}

function firstTag(block: string, name: string): string | undefined {
  const re = new RegExp(`<${name}\\b[^>]*>([\\s\\S]*?)<\\/${name}>`, "i");
  const m = block.match(re);
  return m?.[1]?.trim();
}

function firstCdata(block: string, name: string): string | undefined {
  const re = new RegExp(
    `<${name}\\b[^>]*><!\\[CDATA\\[([\\s\\S]*?)\\]\\]><\\/${name}>`,
    "i"
  );
  return block.match(re)?.[1]?.trim();
}

function firstNested(
  block: string,
  parent: string,
  child: string
): string | undefined {
  const re = new RegExp(
    `<${parent}\\b[^>]*>([\\s\\S]*?)<\\/${parent}>`,
    "i"
  );
  const inner = block.match(re)?.[1];
  if (!inner) return undefined;
  return firstTag(inner, child);
}

function decodeXml(s: string): string {
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .trim();
}

function stripTags(s: string): string {
  return s.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

function normalizeDate(raw: string): string {
  const t = Date.parse(raw);
  if (!Number.isNaN(t)) return new Date(t).toISOString();
  return raw.trim();
}

export function fetchFeedsFromBodies(
  feeds: Array<{ url: string; body: string }>,
  opts?: { maxEntries?: number }
): FeedEntry[] {
  const out: FeedEntry[] = [];
  const seen = new Set<string>();
  for (const f of feeds) {
    for (const e of parseFeedXml(f.body, opts)) {
      const link = canonicalizeUrl(e.link, f.url) ?? e.link;
      if (!link || seen.has(link)) continue;
      seen.add(link);
      out.push({ ...e, link });
      if (out.length >= (opts?.maxEntries ?? BLOG_BUDGETS.MAX_FEED_ENTRIES)) {
        return out;
      }
    }
  }
  return out;
}
