export type ArtifactRelationshipType =
  | "article_links_repository"
  | "repository_links_article"
  | "repository_supports_article"
  | "article_documents_project"
  | "article_revises_prior_article"
  | "shared_topic"
  | "follow_up_artifact"
  | "explicitly_cited"
  | "derived_from"
  | "inferred_connection";

export type ConfidenceSupport = "high" | "moderate" | "low";

export interface ArtifactRelationship {
  relationship_id: string;
  source_artifact_id: string;
  target_artifact_id: string;

  relationship_type: ArtifactRelationshipType;

  deterministic: boolean;

  confidence_support: ConfidenceSupport;

  evidence_ids: string[];
  explanation?: string;
}

export interface ArtifactUrlRef {
  artifact_id: string;
  kind?: string;
  canonical_url: string;
  /** Optional text to scan (article body, README, etc.) */
  text?: string;
}
