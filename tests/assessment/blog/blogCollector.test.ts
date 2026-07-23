import { describe, expect, it } from "vitest";
import { canonicalizeUrl } from "../../../src/assessment/blog/canonicalizeUrl.js";
import { parseRobotsTxt, isDisallowed } from "../../../src/assessment/blog/fetchRobots.js";
import { parseFeedXml } from "../../../src/assessment/blog/fetchFeeds.js";
import { parseSitemapXml } from "../../../src/assessment/blog/fetchSitemaps.js";
import { extractArticleFromHtml } from "../../../src/assessment/blog/extractArticle.js";
import { extractCitations } from "../../../src/assessment/blog/extractCitations.js";
import { detectRevisions } from "../../../src/assessment/blog/detectRevisions.js";
import { buildTopicClusters } from "../../../src/assessment/blog/buildTopicClusters.js";
import { selectArticles } from "../../../src/assessment/blog/selectArticles.js";
import { collectBlogArtifactsFromFixture } from "../../../src/assessment/blog/collectBlogArtifacts.js";
import type { BlogArticle } from "../../../src/assessment/blog/types.js";

describe("canonicalizeUrl", () => {
  it("strips tracking params and trailing slash", () => {
    expect(
      canonicalizeUrl("https://Example.com/posts/a/?utm_source=x&id=1")
    ).toBe("https://example.com/posts/a?id=1");
  });
});

describe("robots parsing", () => {
  it("parses disallow and blocks matching paths", () => {
    const rules = parseRobotsTxt(`
User-agent: *
Disallow: /private/
Allow: /private/ok
Sitemap: https://example.com/sitemap.xml
`);
    expect(rules.disallow).toContain("/private/");
    expect(rules.sitemaps[0]).toContain("sitemap.xml");
    expect(isDisallowed("https://example.com/private/secret", rules)).toBe(true);
    expect(isDisallowed("https://example.com/private/ok", rules)).toBe(false);
  });
});

describe("feed and sitemap parsers", () => {
  it("parses RSS titles and links", () => {
    const entries = parseFeedXml(`<?xml version="1.0"?>
<rss><channel>
<item><title>Alpha</title><link>https://example.com/a</link><pubDate>Mon, 01 Jan 2024 00:00:00 GMT</pubDate></item>
<item><title>Beta</title><link>https://example.com/b</link></item>
</channel></rss>`);
    expect(entries).toHaveLength(2);
    expect(entries[0].title).toBe("Alpha");
    expect(entries[0].link).toContain("example.com/a");
  });

  it("parses sitemap urlset", () => {
    const { urls } = parseSitemapXml(`<?xml version="1.0"?>
<urlset>
<url><loc>https://example.com/old</loc><lastmod>2020-01-01</lastmod></url>
<url><loc>https://example.com/new</loc><lastmod>2024-06-01</lastmod></url>
</urlset>`);
    expect(urls[0].loc).toContain("/new");
  });
});

describe("article extraction pipeline", () => {
  it("extracts title, sections, citations, revisions", () => {
    const html = `<!doctype html><html lang="en"><head>
<title>Deep dive</title>
<meta property="article:published_time" content="2024-01-01T00:00:00Z"/>
<meta property="article:modified_time" content="2024-04-01T00:00:00Z"/>
</head><body><article>
<h1>Deep dive</h1>
<p>Updated: we revised the method. See https://doi.org/10.1000/xyz123 and
https://github.com/acme/widget for code.</p>
<h2>Limitations</h2>
<p>We only tested on synthetic data.</p>
</article></body></html>`;
    const draft = extractArticleFromHtml(html, "https://example.com/deep");
    expect(draft.title).toMatch(/Deep dive/i);
    expect(draft.sections.some((s) => s.heading === "Limitations")).toBe(true);
    const cites = extractCitations(draft.plain_text, { html });
    expect(cites.some((c) => c.kind === "doi")).toBe(true);
    expect(cites.some((c) => c.kind === "github")).toBe(true);
    const revs = detectRevisions({
      published_at: draft.published_at,
      modified_at: draft.modified_at,
      text: draft.plain_text,
    });
    expect(revs.some((r) => r.kind === "date_modified")).toBe(true);
    expect(revs.some((r) => r.kind === "update_note")).toBe(true);
  });
});

function stubArticle(
  id: string,
  title: string,
  text: string,
  published_at?: string
): BlogArticle {
  return {
    article_id: id,
    artifact_id: `art_${id}`,
    canonical_url: `https://example.com/${id}`,
    title,
    published_at,
    date_support: published_at ? "moderate" : "low",
    extraction_method: "readability",
    sections: [{ text, order: 0 }],
    citations: [],
    revision_markers: [],
    original_analysis_artifacts: [],
    internal_links: [],
    external_links: [],
    collection_warnings: [],
  };
}

describe("clustering and selection", () => {
  it("clusters by shared keywords and selects with diversity", () => {
    const articles = [
      stubArticle("a1", "Scheduler design", "scheduler runtime engine latency", "2024-06-01"),
      stubArticle("a2", "Scheduler pitfalls", "scheduler runtime queue latency", "2024-05-01"),
      stubArticle("a3", "Gardening tips", "tomato soil compost watering", "2024-04-01"),
    ];
    const clusters = buildTopicClusters(articles, { minSharedKeywords: 2 });
    expect(clusters.some((c) => c.article_ids.length >= 2)).toBe(true);
    const selected = selectArticles(articles, clusters, {
      maxSelected: 2,
      now: new Date("2024-07-01"),
    });
    expect(selected).toHaveLength(2);
    const ids = selected.map((a) => a.article_id);
    expect(ids).toContain("a1");
  });
});

describe("collectBlogArtifactsFromFixture", () => {
  it("collects offline without network and emits evidence", () => {
    const result = collectBlogArtifactsFromFixture({
      website_url: "https://example.com/",
      candidate_id: "cand_1",
      robots_txt: "User-agent: *\nDisallow: /drafts/\n",
      feeds: [
        {
          url: "https://example.com/feed.xml",
          body: `<?xml version="1.0"?><rss><channel>
<item><title>Post One</title><link>https://example.com/p1</link><pubDate>2024-01-15T00:00:00Z</pubDate></item>
<item><title>Draft</title><link>https://example.com/drafts/x</link></item>
</channel></rss>`,
        },
      ],
      pages: [
        {
          url: "https://example.com/p1",
          html: `<html><body><article><h1>Post One</h1>
<p>Long enough body about systems and ${"runtime ".repeat(40)}experimentation.
References https://github.com/acme/demo</p></article></body></html>`,
        },
      ],
    });

    expect(result.corpus.canonical_domain).toBe("example.com");
    expect(result.articles.some((a) => a.canonical_url.includes("/drafts/"))).toBe(
      false
    );
    expect(result.selected.length).toBeGreaterThan(0);
    expect(result.evidence.some((e) => e.source_type === "article_section")).toBe(
      true
    );
    expect(
      result.evidence.some((e) => e.source_type === "article_reference")
    ).toBe(true);
  });
});
