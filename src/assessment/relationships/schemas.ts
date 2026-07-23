import { z } from "zod";

export const artifactRelationshipTypeSchema = z.enum([
  "article_links_repository",
  "repository_links_article",
  "repository_supports_article",
  "article_documents_project",
  "article_revises_prior_article",
  "shared_topic",
  "follow_up_artifact",
  "explicitly_cited",
  "derived_from",
  "inferred_connection",
]);

export const artifactRelationshipSchema = z.object({
  relationship_id: z.string().min(1),
  source_artifact_id: z.string().min(1),
  target_artifact_id: z.string().min(1),
  relationship_type: artifactRelationshipTypeSchema,
  deterministic: z.boolean(),
  confidence_support: z.enum(["high", "moderate", "low"]),
  evidence_ids: z.array(z.string()),
  explanation: z.string().optional(),
});

export type ArtifactRelationshipParsed = z.infer<
  typeof artifactRelationshipSchema
>;
