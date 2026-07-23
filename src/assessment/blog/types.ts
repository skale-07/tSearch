/** Provisional product crawl budgets (provisional_product_rule). */
export const BLOG_BUDGETS = {
  MAX_FEED_ENTRIES: 100,
  MAX_SITEMAP_URLS: 500,
  MAX_ARTICLE_PAGES: 40,
  MAX_SELECTED_ARTICLES: 5,
  MAX_REDIRECTS: 5,
  MAX_ARTICLE_CHARS: 60_000,
  MAX_PDF_BYTES: 15 * 1024 * 1024,
  MAX_BROWSER_PAGES: 5,
  MAX_CONSECUTIVE_ERRORS: 3,
} as const;

export const BLOG_USER_AGENT = "tSearch-assessment/1.0";

export type DateSupport = "high" | "moderate" | "low";

export type ExtractionMethod =
  | "feed"
  | "readability"
  | "site_selector"
  | "json_ld"
  | "pdf"
  | "browser_rendered"
  | "metadata_only";

export interface ArticleSection {
  heading?: string;
  level?: number;
  text: string;
  order: number;
}

export interface CitationReference {
  citation_id: string;
  kind: "doi" | "github" | "url" | "other";
  raw: string;
  normalized_url?: string;
  context?: string;
}

export interface RevisionMarker {
  kind: "date_modified" | "update_note" | "content_hash_change" | "other";
  observation: string;
  published_at?: string;
  modified_at?: string;
  confidence_support: "high" | "moderate" | "low";
}

export interface OriginalAnalysisArtifact {
  kind:
    | "notebook"
    | "dataset"
    | "code_repo"
    | "figure"
    | "table"
    | "experiment"
    | "other";
  url?: string;
  observation: string;
}

export interface TopicCluster {
  cluster_id: string;
  label: string;
  keywords: string[];
  article_ids: string[];
}

export interface ArticleSeries {
  series_id: string;
  title: string;
  article_ids: string[];
}

export interface BlogArticle {
  article_id: string;
  artifact_id: string;
  canonical_url: string;
  title: string;

  author_text?: string;
  language?: string;

  published_at?: string;
  modified_at?: string;
  date_support: DateSupport;

  extraction_method: ExtractionMethod;

  content_hash?: string;
  sections: ArticleSection[];
  citations: CitationReference[];
  revision_markers: RevisionMarker[];
  original_analysis_artifacts: OriginalAnalysisArtifact[];

  internal_links: string[];
  external_links: string[];

  collection_warnings: string[];
}

export interface BlogCorpus {
  corpus_id: string;
  candidate_id: string;
  canonical_domain: string;

  discovery_sources: string[];
  article_ids: string[];
  selected_article_ids: string[];

  topic_clusters: TopicCluster[];
  series: ArticleSeries[];

  coverage: {
    discovered_article_count: number;
    extracted_article_count: number;
    full_text_count: number;
    metadata_only_count: number;
    earliest_date?: string;
    latest_date?: string;
  };

  collection_warnings: string[];
}

/** Offline fixture: all network bodies pre-supplied. */
export interface BlogFixturePage {
  url: string;
  html: string;
  status?: number;
}

export interface BlogFixtureFeed {
  url: string;
  body: string;
}

export interface BlogFixtureSitemap {
  url: string;
  body: string;
}

export interface BlogFixture {
  website_url: string;
  candidate_id: string;
  canonical_domain?: string;
  robots_txt?: string;
  feeds?: BlogFixtureFeed[];
  sitemaps?: BlogFixtureSitemap[];
  pages?: BlogFixturePage[];
  /** Pre-listed article URLs when feeds/sitemaps are omitted. */
  article_urls?: string[];
}

export interface FeedEntry {
  title: string;
  link: string;
  published_at?: string;
  updated_at?: string;
  author?: string;
  categories: string[];
  summary?: string;
}

export interface SitemapUrlEntry {
  loc: string;
  lastmod?: string;
}

export interface RobotsRules {
  disallow: string[];
  allow: string[];
  sitemaps: string[];
  crawl_delay?: number;
}
