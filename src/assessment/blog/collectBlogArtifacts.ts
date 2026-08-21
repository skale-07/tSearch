import crypto from "crypto";
import type { EvidenceItem } from "../types.js";
import { EvidenceStore } from "../evidence/evidenceStore.js";
import { blogFetch, type BlogClientOptions } from "./blogClient.js";
import { canonicalizeUrl, sameRegistrableHost } from "./canonicalizeUrl.js";
import { discoverBlog } from "./discoverBlog.js";
import { fetchRobotsFromText, isDisallowed } from "./fetchRobots.js";
import { discoverFeedUrls, fetchFeedsFromBodies, parseFeedXml } from "./fetchFeeds.js";
import {
  discoverSitemapUrls,
  fetchSitemapsFromBodies,
  parseSitemapXml,
} from "./fetchSitemaps.js";
import { extractArticleFromHtml } from "./extractArticle.js";
import { extractCitations } from "./extractCitations.js";
import { detectRevisions } from "./detectRevisions.js";
import { buildTopicClusters } from "./buildTopicClusters.js";
import { selectArticles } from "./selectArticles.js";
import { htmlToExcerpt } from "../../website/scrapeWebsite.js";
import {
  BLOG_BUDGETS,
  type BlogArticle,
  type BlogCorpus,
  type BlogFixture,
  type FeedEntry,
  type RobotsRules,
} from "./types.js";
import {
  extractWritingHubProfiles,
  extractWritingPlatformArticleLinks,
  feedUrlsForWritingHub,
  isWritingPlatformArticleUrl,
  isAuthoredPublicationUrl,
} from "./writingHubs.js";
import { articleAuthoredByCandidate } from "./articleAuthoredBy.js";

export interface CollectBlogResult {
  corpus: BlogCorpus;
  articles: BlogArticle[];
  selected: BlogArticle[];
  evidence: EvidenceItem[];
  /** Homepage visible text — about/edu lines live here, not in selected posts. */
  home_excerpt: string;
}

export interface CollectBlogOptions extends BlogClientOptions {
  candidate_id?: string;
  maxFeedEntries?: number;
  maxSitemapUrls?: number;
  maxArticlePages?: number;
  maxSelected?: number;
  /** Extra article/paper URLs (LinkedIn Featured, Contact). */
  seedArticleUrls?: string[];
  /** Display name — used to keep only articles this person authored. */
  candidateName?: string;
}

function makeCorpusId(candidateId: string, domain: string): string {
  return `bc_${crypto
    .createHash("sha1")
    .update(`${candidateId}:${domain}`)
    .digest("hex")
    .slice(0, 12)}`;
}

function makeArticleIds(canonicalUrl: string): {
  article_id: string;
  artifact_id: string;
} {
  const h = crypto
    .createHash("sha1")
    .update(`technical_article:${canonicalUrl}`)
    .digest("hex")
    .slice(0, 12);
  return { article_id: `ba_${h}`, artifact_id: `art_${h}` };
}

function emptyRobots(): RobotsRules {
  return { disallow: [], allow: [], sitemaps: [] };
}

// Nav/boilerplate paths that pass looksLikeArticleUrl but are never articles;
// only applied to the homepage-link fallback, where precision matters most.
const NAV_PATHS =
  /\/(about|contact|resume|cv|privacy|terms|subscribe|login|search|projects?|outreach|publications?|research|portfolio|more-projects?)(\/|$)/i;

const ASSET_PATH =
  /\.(xml|json|css|js|mjs|map|png|jpe?g|gif|svg|webp|ico|pdf|woff2?|ttf|eot|otf|wasm|mp4|webm|mp3|wav)(\?|$)/i;

const STATIC_BUNDLE_PATH =
  /\/(_next\/static|wp-content\/(?:plugins|themes|mu-plugins)|_app\/immutable|static\/(?:css|js|media))\//i;

/**
 * Fallback article discovery for sites with no feed and no sitemap: pull
 * same-host hrefs straight out of the homepage HTML. Hand-rolled personal
 * sites — often the highest-signal ones — frequently expose their writing
 * only as a plain list of links.
 */
function extractHomepageArticleLinks(
  html: string,
  baseUrl: string,
  robots: RobotsRules
): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const m of html.matchAll(/\bhref\s*=\s*["']([^"']+)["']/gi)) {
    const c = canonicalizeUrl(m[1], baseUrl);
    if (!c || seen.has(c)) continue;
    if (!sameRegistrableHost(c, baseUrl)) continue;
    if (isDisallowed(c, robots)) continue;
    if (!looksLikeArticleUrl(c)) continue;
    if (NAV_PATHS.test(new URL(c).pathname)) continue;
    seen.add(c);
    out.push(c);
  }
  return out;
}

function looksLikeArticleUrl(url: string): boolean {
  try {
    const u = new URL(url);
    const p = u.pathname.toLowerCase();
    if (p === "/" || p === "") return false;
    if (/\/(tag|tags|category|categories|author|page|feed|rss|sitemap|comments)(\/|$)/i.test(p)) {
      return false;
    }
    if (ASSET_PATH.test(p) || ASSET_PATH.test(u.pathname)) return false;
    if (STATIC_BUNDLE_PATH.test(p)) return false;
    return true;
  } catch {
    return false;
  }
}

function articlePlainLength(a: BlogArticle): number {
  return a.sections.reduce((n, s) => n + s.text.length, 0);
}

/**
 * When a listing page (e.g. /blog) was fetched instead of posts, pull the
 * same-host article links out of its HTML for a second fetch wave.
 */
function extractIndexArticleLinks(
  html: string,
  pageUrl: string,
  robots: RobotsRules
): string[] {
  return extractHomepageArticleLinks(html, pageUrl, robots);
}

function buildArticleFromPage(
  pageUrl: string,
  html: string,
  feedMeta?: FeedEntry
): BlogArticle {
  const canonical =
    canonicalizeUrl(pageUrl) ?? pageUrl;
  const { article_id, artifact_id } = makeArticleIds(canonical);
  const draft = extractArticleFromHtml(html, canonical);
  const citations = extractCitations(draft.plain_text, {
    baseUrl: canonical,
    html,
  });
  const revision_markers = detectRevisions({
    published_at: draft.published_at ?? feedMeta?.published_at,
    modified_at: draft.modified_at ?? feedMeta?.updated_at,
    text: draft.plain_text,
    html,
  });

  return {
    article_id,
    artifact_id,
    canonical_url: canonical,
    title: draft.title || feedMeta?.title || "Untitled",
    author_text: draft.author_text ?? feedMeta?.author,
    language: draft.language,
    published_at: draft.published_at ?? feedMeta?.published_at,
    modified_at: draft.modified_at ?? feedMeta?.updated_at,
    date_support: draft.date_support,
    extraction_method:
      draft.extraction_method === "metadata_only" && feedMeta
        ? "feed"
        : draft.extraction_method,
    content_hash: draft.content_hash,
    sections: draft.sections,
    citations,
    revision_markers,
    original_analysis_artifacts: draft.original_analysis_artifacts,
    internal_links: draft.internal_links,
    external_links: draft.external_links,
    collection_warnings: draft.collection_warnings,
  };
}

function emitEvidence(
  store: EvidenceStore,
  articles: BlogArticle[],
  selectedIds: Set<string>
): void {
  for (const a of articles) {
    if (!selectedIds.has(a.article_id)) continue;
    for (const section of a.sections.slice(0, 8)) {
      const obs = section.text.slice(0, 400);
      if (!obs.trim()) continue;
      store.create({
        artifact_id: a.artifact_id,
        source_type: "article_section",
        source_url: a.canonical_url,
        observation: obs,
        supports_claim: section.heading
          ? `Article section "${section.heading}"`
          : "Article body section",
        strength: section.text.length > 400 ? "moderate" : "weak",
        candidate_ownership_confidence: 0.5,
        location: {
          section: section.heading,
          heading: section.heading,
        },
        salt: `${a.article_id}:sec:${section.order}`,
      });
    }
    for (const cit of a.citations.slice(0, 12)) {
      store.create({
        artifact_id: a.artifact_id,
        source_type: "article_reference",
        source_url: cit.normalized_url ?? a.canonical_url,
        observation: `Citation (${cit.kind}): ${cit.raw}`,
        supports_claim: "Outbound reference present in article",
        strength: cit.kind === "doi" || cit.kind === "github" ? "moderate" : "weak",
        candidate_ownership_confidence: 0.4,
        salt: `${a.article_id}:${cit.citation_id}`,
      });
    }
  }
}

function homeExcerptFromFixture(fixture: BlogFixture): string {
  const pages = fixture.pages ?? [];
  const homeCanon =
    canonicalizeUrl(fixture.website_url) ?? fixture.website_url;
  const keys = new Set(
    [
      homeCanon,
      homeCanon.replace(/\/$/, ""),
      `${homeCanon.replace(/\/$/, "")}/`,
      fixture.website_url,
    ].map((k) => canonicalizeUrl(k) ?? k)
  );
  for (const page of pages) {
    const key = canonicalizeUrl(page.url) ?? page.url;
    if (keys.has(key)) return htmlToExcerpt(page.html);
  }
  for (const page of pages) {
    try {
      const path = new URL(page.url).pathname;
      if (path === "/" || path === "") return htmlToExcerpt(page.html);
    } catch {
      // skip
    }
  }
  return pages[0] ? htmlToExcerpt(pages[0].html) : "";
}

function coverageFrom(articles: BlogArticle[]): BlogCorpus["coverage"] {
  const dates = articles
    .flatMap((a) => [a.published_at, a.modified_at])
    .filter((d): d is string => !!d)
    .sort();
  return {
    discovered_article_count: articles.length,
    extracted_article_count: articles.length,
    full_text_count: articles.filter(
      (a) => a.extraction_method !== "metadata_only"
    ).length,
    metadata_only_count: articles.filter(
      (a) => a.extraction_method === "metadata_only"
    ).length,
    earliest_date: dates[0],
    latest_date: dates[dates.length - 1],
  };
}

/**
 * Offline collector: all network bodies come from the fixture.
 */
export function collectBlogArtifactsFromFixture(
  fixture: BlogFixture,
  opts?: CollectBlogOptions
): CollectBlogResult {
  const warnings: string[] = [];
  const discovery_sources: string[] = [];
  const maxFeed = opts?.maxFeedEntries ?? BLOG_BUDGETS.MAX_FEED_ENTRIES;
  const maxSitemap = opts?.maxSitemapUrls ?? BLOG_BUDGETS.MAX_SITEMAP_URLS;
  const maxPages = opts?.maxArticlePages ?? BLOG_BUDGETS.MAX_ARTICLE_PAGES;
  const maxSelected = opts?.maxSelected ?? BLOG_BUDGETS.MAX_SELECTED_ARTICLES;

  const discovered = discoverBlog(fixture.website_url, {
    html: fixture.pages?.find((p) =>
      canonicalizeUrl(p.url) === canonicalizeUrl(fixture.website_url)
    )?.html,
  });
  const canonical_domain =
    fixture.canonical_domain ?? discovered.canonical_domain;

  const robots = fixture.robots_txt
    ? fetchRobotsFromText(fixture.robots_txt)
    : emptyRobots();
  if (fixture.robots_txt) discovery_sources.push("robots.txt");

  const feedEntries = fixture.feeds?.length
    ? fetchFeedsFromBodies(fixture.feeds, { maxEntries: maxFeed })
    : [];
  if (fixture.feeds?.length) discovery_sources.push("feeds");

  const sitemapEntries = fixture.sitemaps?.length
    ? fetchSitemapsFromBodies(fixture.sitemaps, { maxUrls: maxSitemap })
    : [];
  if (fixture.sitemaps?.length) discovery_sources.push("sitemaps");

  const pageByUrl = new Map<string, string>();
  for (const p of fixture.pages ?? []) {
    const c = canonicalizeUrl(p.url) ?? p.url;
    pageByUrl.set(c, p.html);
  }

  const candidateUrls: string[] = [];
  const seen = new Set<string>();
  const siteOrigin = `https://${canonical_domain}/`;
  const pushUrl = (raw: string, base?: string) => {
    const c = canonicalizeUrl(raw, base) ?? raw;
    if (seen.has(c)) return;
    const onSite = sameRegistrableHost(c, siteOrigin);
    const offsiteWriting =
      isWritingPlatformArticleUrl(c) || isAuthoredPublicationUrl(c);
    if (!onSite && !offsiteWriting) return;
    if (onSite && isDisallowed(c, robots)) return;
    if (onSite && !looksLikeArticleUrl(c)) return;
    seen.add(c);
    candidateUrls.push(c);
  };

  for (const e of feedEntries) pushUrl(e.link);
  for (const u of sitemapEntries) pushUrl(u.loc);
  for (const u of fixture.article_urls ?? []) pushUrl(u, fixture.website_url);
  for (const u of opts?.seedArticleUrls ?? []) pushUrl(u);
  for (const p of fixture.pages ?? []) pushUrl(p.url);

  // Homepage (and any fetched hub pages) may embed Medium/Substack story links.
  for (const p of fixture.pages ?? []) {
    for (const link of extractWritingPlatformArticleLinks(p.html, p.url)) {
      pushUrl(link);
    }
  }

  if (fixture.article_urls?.length) discovery_sources.push("article_urls");
  if (fixture.pages?.length) discovery_sources.push("pages");

  const feedByLink = new Map(
    feedEntries.map((e) => [canonicalizeUrl(e.link) ?? e.link, e])
  );

  const articles: BlogArticle[] = [];
  for (const url of candidateUrls.slice(0, maxPages)) {
    const html = pageByUrl.get(url);
    if (!html) {
      // metadata-only from feed if available
      const meta = feedByLink.get(url);
      if (meta) {
        const { article_id, artifact_id } = makeArticleIds(url);
        articles.push({
          article_id,
          artifact_id,
          canonical_url: url,
          title: meta.title || "Untitled",
          author_text: meta.author,
          published_at: meta.published_at,
          modified_at: meta.updated_at,
          date_support: meta.published_at ? "moderate" : "low",
          extraction_method: "metadata_only",
          sections: meta.summary
            ? [{ text: meta.summary, order: 0 }]
            : [],
          citations: [],
          revision_markers: detectRevisions({
            published_at: meta.published_at,
            modified_at: meta.updated_at,
            text: meta.summary,
          }),
          original_analysis_artifacts: [],
          internal_links: [],
          external_links: [],
          collection_warnings: ["page_html_missing_in_fixture"],
        });
      } else {
        warnings.push(`missing_html:${url}`);
      }
      continue;
    }
    articles.push(buildArticleFromPage(url, html, feedByLink.get(url)));
  }

  // Index→post hop for fixture pages (mirrors live collector).
  for (const p of fixture.pages ?? []) {
    for (const link of extractIndexArticleLinks(p.html, p.url, robots)) {
      pushUrl(link, p.url);
    }
  }
  for (const url of candidateUrls.slice(0, maxPages)) {
    if (articles.some((a) => a.canonical_url === url)) continue;
    const html = pageByUrl.get(url);
    if (!html) continue;
    articles.push(buildArticleFromPage(url, html, feedByLink.get(url)));
  }

  // Portfolio/SPA sites often put the only prose on `/`. If nothing substantive
  // was discovered, treat the homepage as a writing candidate.
  const homeCanon =
    canonicalizeUrl(fixture.website_url) ?? fixture.website_url;
  let homeHtml: string | undefined;
  for (const key of [
    homeCanon,
    homeCanon.replace(/\/$/, ""),
    `${homeCanon.replace(/\/$/, "")}/`,
    fixture.website_url,
  ]) {
    homeHtml = pageByUrl.get(key);
    if (homeHtml) break;
  }
  if (!homeHtml) {
    for (const [u, html] of pageByUrl) {
      try {
        const path = new URL(u).pathname;
        if (path === "/" || path === "") {
          homeHtml = html;
          break;
        }
      } catch {
        // skip
      }
    }
  }
  const hasSubstance = articles.some((a) => articlePlainLength(a) >= 400);
  if (!hasSubstance && homeHtml) {
    const homeArticle = buildArticleFromPage(homeCanon, homeHtml);
    if (
      articlePlainLength(homeArticle) >= 400 &&
      !articles.some((a) => a.canonical_url === homeArticle.canonical_url)
    ) {
      articles.push(homeArticle);
      discovery_sources.push("homepage_prose");
    }
  }

  const hubProfileUrls = homeHtml
    ? extractWritingHubProfiles(homeHtml, homeCanon)
    : [];
  const authoredArticles = articles.filter((a) =>
    articleAuthoredByCandidate(a, {
      candidateName: opts?.candidateName,
      personalSiteUrl: fixture.website_url,
      hubProfileUrls,
    })
  );

  const topic_clusters = buildTopicClusters(authoredArticles);
  const selected = selectArticles(authoredArticles, topic_clusters, {
    maxSelected,
  });
  const selectedIds = new Set(selected.map((a) => a.article_id));

  const store = new EvidenceStore();
  emitEvidence(store, authoredArticles, selectedIds);

  const corpus: BlogCorpus = {
    corpus_id: makeCorpusId(fixture.candidate_id, canonical_domain),
    candidate_id: fixture.candidate_id,
    canonical_domain,
    discovery_sources,
    article_ids: authoredArticles.map((a) => a.article_id),
    selected_article_ids: selected.map((a) => a.article_id),
    topic_clusters,
    series: [],
    coverage: {
      ...coverageFrom(authoredArticles),
      discovered_article_count: candidateUrls.length,
    },
    collection_warnings: warnings,
  };

  return {
    corpus,
    articles: authoredArticles,
    selected,
    evidence: store.all(),
    home_excerpt: homeExcerptFromFixture(fixture),
  };
}

/**
 * Live collector — uses blogClient. Prefer fixture mode in tests.
 */
export async function collectBlogArtifacts(
  websiteUrl: string,
  opts?: CollectBlogOptions
): Promise<CollectBlogResult> {
  const candidate_id = opts?.candidate_id ?? "unknown";
  const maxFeed = opts?.maxFeedEntries ?? BLOG_BUDGETS.MAX_FEED_ENTRIES;
  const maxSitemap = opts?.maxSitemapUrls ?? BLOG_BUDGETS.MAX_SITEMAP_URLS;
  const maxPages = opts?.maxArticlePages ?? BLOG_BUDGETS.MAX_ARTICLE_PAGES;
  const clientOpts: BlogClientOptions = {
    fetchImpl: opts?.fetchImpl,
    userAgent: opts?.userAgent,
    maxRedirects: opts?.maxRedirects,
    maxConsecutiveErrors: opts?.maxConsecutiveErrors,
    backoffBaseMs: opts?.backoffBaseMs,
    maxRetries: opts?.maxRetries,
  };

  const home = await blogFetch(websiteUrl, clientOpts);
  const discovered = discoverBlog(websiteUrl, {
    html: home.body,
    resolvedUrl: home.finalUrl,
  });

  let robotsTxt = "";
  try {
    const robotsRes = await blogFetch(
      `https://${discovered.canonical_domain}/robots.txt`,
      clientOpts
    );
    if (robotsRes.status >= 200 && robotsRes.status < 300) {
      robotsTxt = robotsRes.body;
    }
  } catch {
    // optional
  }

  const feedUrls = discoverFeedUrls(home.body, home.finalUrl).slice(0, 5);
  const feeds: Array<{ url: string; body: string }> = [];
  for (const fu of feedUrls) {
    try {
      const res = await blogFetch(fu, clientOpts);
      if (res.status >= 200 && res.status < 300) {
        feeds.push({ url: res.finalUrl, body: res.body });
      }
    } catch {
      // skip
    }
  }

  const robots = robotsTxt ? fetchRobotsFromText(robotsTxt) : emptyRobots();
  const sitemapUrls = discoverSitemapUrls(robots.sitemaps, home.finalUrl).slice(
    0,
    5
  );
  const sitemaps: Array<{ url: string; body: string }> = [];
  for (const su of sitemapUrls) {
    try {
      const res = await blogFetch(su, clientOpts);
      if (res.status >= 200 && res.status < 300) {
        sitemaps.push({ url: res.finalUrl, body: res.body });
        // one level of nested sitemaps
        const parsed = parseSitemapXml(res.body, { maxUrls: maxSitemap });
        for (const nested of parsed.nestedSitemaps.slice(0, 3)) {
          try {
            const nres = await blogFetch(nested, clientOpts);
            if (nres.status >= 200 && nres.status < 300) {
              sitemaps.push({ url: nres.finalUrl, body: nres.body });
            }
          } catch {
            // skip
          }
        }
      }
    } catch {
      // skip
    }
  }

  const feedEntries = feeds.length
    ? fetchFeedsFromBodies(feeds, { maxEntries: maxFeed })
    : parseFeedXml("", { maxEntries: maxFeed });
  const sitemapEntries = sitemaps.length
    ? fetchSitemapsFromBodies(sitemaps, { maxUrls: maxSitemap })
    : [];

  const urls: string[] = [];
  const seen = new Set<string>();
  const pagesSeed: NonNullable<BlogFixture["pages"]> = [];
  const pushLiveUrl = (raw: string, base?: string) => {
    const c = canonicalizeUrl(raw, base) ?? raw;
    if (seen.has(c)) return;
    const onSite = sameRegistrableHost(c, home.finalUrl);
    const offsiteWriting =
      isWritingPlatformArticleUrl(c) || isAuthoredPublicationUrl(c);
    if (!onSite && !offsiteWriting) return;
    if (onSite && isDisallowed(c, robots)) return;
    if (onSite && !looksLikeArticleUrl(c)) return;
    seen.add(c);
    urls.push(c);
  };

  for (const e of [
    ...feedEntries.map((x) => x.link),
    ...sitemapEntries.map((x) => x.loc),
  ]) {
    pushLiveUrl(e);
  }
  for (const seed of opts?.seedArticleUrls ?? []) {
    pushLiveUrl(seed);
  }

  // Personal site is a hub: follow Medium / Substack / etc. profile links and
  // ingest story URLs already listed on the homepage.
  const hubProfiles = extractWritingHubProfiles(home.body, home.finalUrl).slice(
    0,
    3
  );
  for (const article of extractWritingPlatformArticleLinks(
    home.body,
    home.finalUrl
  )) {
    pushLiveUrl(article);
  }
  if (hubProfiles.length || urls.some((u) => isWritingPlatformArticleUrl(u))) {
    console.log(
      `  [assess] blog: writing hubs from personal site: ${hubProfiles.join(", ") || "—"} (${urls.filter((u) => isWritingPlatformArticleUrl(u)).length} story link(s) on homepage)`
    );
  }

  for (const hub of hubProfiles) {
    for (const feedUrl of feedUrlsForWritingHub(hub).slice(0, 2)) {
      try {
        const res = await blogFetch(feedUrl, clientOpts);
        if (res.status < 200 || res.status >= 300) continue;
        feeds.push({ url: res.finalUrl, body: res.body });
        const hubEntries = parseFeedXml(res.body, { maxEntries: maxFeed });
        for (const e of hubEntries) pushLiveUrl(e.link);
        console.log(
          `  [assess] blog: hub feed ${feedUrl} → ${hubEntries.length} entries`
        );
      } catch {
        // optional
      }
    }
    // Also scrape the hub profile page for story links (feeds sometimes empty).
    try {
      const hubPage = await blogFetch(hub, clientOpts);
      if (hubPage.status >= 200 && hubPage.status < 300) {
        pagesSeed.push({
          url: hubPage.finalUrl,
          html: hubPage.body,
          status: hubPage.status,
        });
        for (const article of extractWritingPlatformArticleLinks(
          hubPage.body,
          hubPage.finalUrl
        )) {
          pushLiveUrl(article);
        }
      }
    } catch {
      // optional
    }
  }

  // Always harvest same-host article links from the homepage — feeds/sitemaps
  // often miss hand-rolled blogs, and never hurt when they already found posts.
  {
    const homeLinks = extractHomepageArticleLinks(
      home.body,
      home.finalUrl,
      robots
    );
    const before = urls.length;
    for (const c of homeLinks) pushLiveUrl(c);
    if (urls.length > before) {
      console.log(
        `  [assess] blog: homepage-link harvest found ${urls.length - before}`
      );
    }
  }

  const pages: BlogFixture["pages"] = [
    { url: home.finalUrl, html: home.body, status: home.status },
    ...pagesSeed,
  ];
  const fetched = new Set(
    pages.map((p) => canonicalizeUrl(p.url) ?? p.url)
  );

  const fetchWave = async (candidates: string[]) => {
    for (const url of candidates) {
      if (pages.length >= maxPages + 1) break; // +1 for homepage already present
      const key = canonicalizeUrl(url) ?? url;
      if (fetched.has(key)) continue;
      try {
        const res = await blogFetch(url, clientOpts);
        if (res.status >= 200 && res.status < 300) {
          const finalKey = canonicalizeUrl(res.finalUrl) ?? res.finalUrl;
          fetched.add(key);
          fetched.add(finalKey);
          pages.push({
            url: res.finalUrl,
            html: res.body,
            status: res.status,
          });
        }
      } catch {
        // skip
      }
    }
  };

  await fetchWave(urls);

  // Second hop: listing pages (/blog, /posts) → individual post URLs.
  {
    const before = urls.length;
    for (const page of pages) {
      if (!sameRegistrableHost(page.url, home.finalUrl)) continue;
      for (const link of extractIndexArticleLinks(
        page.html,
        page.url,
        robots
      )) {
        pushLiveUrl(link);
      }
    }
    const gained = urls.length - before;
    if (gained > 0) {
      console.log(`  [assess] blog: index→post hop found ${gained}`);
      await fetchWave(urls);
    }
  }

  return collectBlogArtifactsFromFixture(
    {
      website_url: websiteUrl,
      candidate_id,
      canonical_domain: discovered.canonical_domain,
      robots_txt: robotsTxt || undefined,
      feeds,
      sitemaps,
      pages,
      article_urls: urls,
    },
    opts
  );
}
