import { z } from "zod";

export const dateSupportSchema = z.enum(["high", "moderate", "low"]);

export const extractionMethodSchema = z.enum([
  "feed",
  "readability",
  "site_selector",
  "json_ld",
  "pdf",
  "browser_rendered",
  "metadata_only",
]);

export const articleSectionSchema = z.object({
  heading: z.string().optional(),
  level: z.number().int().optional(),
  text: z.string(),
  order: z.number().int(),
});

export const citationReferenceSchema = z.object({
  citation_id: z.string().min(1),
  kind: z.enum(["doi", "github", "url", "other"]),
  raw: z.string().min(1),
  normalized_url: z.string().optional(),
  context: z.string().optional(),
});

export const revisionMarkerSchema = z.object({
  kind: z.enum([
    "date_modified",
    "update_note",
    "content_hash_change",
    "other",
  ]),
  observation: z.string().min(1),
  published_at: z.string().optional(),
  modified_at: z.string().optional(),
  confidence_support: z.enum(["high", "moderate", "low"]),
});

export const originalAnalysisArtifactSchema = z.object({
  kind: z.enum([
    "notebook",
    "dataset",
    "code_repo",
    "figure",
    "table",
    "experiment",
    "other",
  ]),
  url: z.string().optional(),
  observation: z.string().min(1),
});

export const topicClusterSchema = z.object({
  cluster_id: z.string().min(1),
  label: z.string().min(1),
  keywords: z.array(z.string()),
  article_ids: z.array(z.string()),
});

export const articleSeriesSchema = z.object({
  series_id: z.string().min(1),
  title: z.string().min(1),
  article_ids: z.array(z.string()),
});

export const blogArticleSchema = z.object({
  article_id: z.string().min(1),
  artifact_id: z.string().min(1),
  canonical_url: z.string().min(1),
  title: z.string(),
  author_text: z.string().optional(),
  language: z.string().optional(),
  published_at: z.string().optional(),
  modified_at: z.string().optional(),
  date_support: dateSupportSchema,
  extraction_method: extractionMethodSchema,
  content_hash: z.string().optional(),
  sections: z.array(articleSectionSchema),
  citations: z.array(citationReferenceSchema),
  revision_markers: z.array(revisionMarkerSchema),
  original_analysis_artifacts: z.array(originalAnalysisArtifactSchema),
  internal_links: z.array(z.string()),
  external_links: z.array(z.string()),
  collection_warnings: z.array(z.string()),
});

export const blogCorpusSchema = z.object({
  corpus_id: z.string().min(1),
  candidate_id: z.string().min(1),
  canonical_domain: z.string().min(1),
  discovery_sources: z.array(z.string()),
  article_ids: z.array(z.string()),
  selected_article_ids: z.array(z.string()),
  topic_clusters: z.array(topicClusterSchema),
  series: z.array(articleSeriesSchema),
  coverage: z.object({
    discovered_article_count: z.number().int().nonnegative(),
    extracted_article_count: z.number().int().nonnegative(),
    full_text_count: z.number().int().nonnegative(),
    metadata_only_count: z.number().int().nonnegative(),
    earliest_date: z.string().optional(),
    latest_date: z.string().optional(),
  }),
  collection_warnings: z.array(z.string()),
});

export type BlogArticleParsed = z.infer<typeof blogArticleSchema>;
export type BlogCorpusParsed = z.infer<typeof blogCorpusSchema>;
