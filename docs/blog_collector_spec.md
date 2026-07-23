# Blog Collector Specification

## Collection sequence

1. Input candidate website URL.[file:43]
2. Resolve canonical domain via redirects and canonical tags.[file:43]
3. Fetch and parse `robots.txt`; obey disallow rules and crawl-delay where present.[file:43]
4. Discover RSS/Atom feeds from HTML link tags and common feed paths.[file:43]
5. Discover sitemaps from robots.txt and common sitemap paths.[file:43]
6. Detect blog index pages via feed items, sitemap URLs, nav labels, and schema.org `Blog`/`BlogPosting` metadata.[file:43]
7. Canonicalize article URLs using rel=canonical, OpenGraph URL, and normalized trailing-slash/query rules.[file:43]
8. Extract article content using readability-style parsing first, DOM selectors second, and JavaScript-rendered fallback only when static extraction fails.[file:43]
9. Extract citations from links, footnotes, bibliographies, DOI patterns, inline reference markers, and quote blocks.[file:43]
10. Detect revisions from `dateModified`, update notes, archive diffs, and feed entry changes.[file:43]
11. Build internal-link graph and topic clusters from article text, tags, categories, and embeddings.[file:43]
12. Select articles for judging using recency, topic persistence, originality cues, and evidence density.[file:43]

## Crawl boundaries

- Stay within canonical domain and explicit content subdomains unless the site declares a blog on another domain.[file:43]
- Ignore generic social links unless they host canonical post content.[file:43]
- Cap fetches per domain per run and stop on repeated server errors.[file:43]

## Request behavior

- Use a clear user agent identifying tSearch collector.
- Respect robots exclusions.
- Follow up to a bounded redirect chain.
- Back off on 429 or 5xx responses.

## Parsing rules

- RSS/Atom: parse title, link, published, updated, author, categories, summary.
- Sitemap: accept `urlset` and sitemap indexes; prefer recently modified entries first.
- Schema.org: parse `BlogPosting`, `Article`, `datePublished`, `dateModified`, `author`, `headline`.
- OpenGraph: use as fallback metadata only.
- PDFs: collect metadata plus extracted text if public and within content limits.
- Non-English pages: keep language tag and allow collection; do not downrank for language alone.
- Paywalls: keep metadata only and mark full-text unavailable.

## Duplicate and revision handling

- Deduplicate by canonical URL first, then normalized title/date hash.
- Record separate revisions when modified date or content hash changes materially.
- Distinguish archive pages, tag pages, and article pages.

## Signal extraction

- Citation proximity: distance from claim sentence/paragraph to outbound source mention.
- DOI resolution: regex DOI extraction plus resolver normalization.
- Source-type classification: DOI/journal, government, standards, blog, company docs, code repo, dataset, interview, book.
- Original analysis artifact detection: links to notebooks, datasets, code repos, tables, figures, experiments, or reanalyses.
