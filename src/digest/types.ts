import type {
  Archetype,
  ArtifactKind,
  OwnershipSupportClass,
} from "../assessment/types.js";

export const DIGEST_SCHEMA_VERSION = "digest-v2";

export interface DigestCandidate {
  candidate_id: string;
  rank: number;
  name: string;
  archetype: Archetype;
  primary_archetype: Archetype;
  secondary_archetypes: Archetype[];
  headline: string;
  discovery_score: number;
  assessment_priority_score: number;
  assessment_confidence: number;
  ownership_support?: OwnershipSupportClass;
  evidence_support?: string;
  why_highlighted: Array<{
    claim: string;
    rationale: string;
    evidence_ids: string[];
  }>;
  technical_summary?: {
    score: number;
    confidence: number;
    rationale: string;
    evidence_ids: string[];
  };
  research_summary?: {
    score: number;
    confidence: number;
    rationale: string;
    evidence_ids: string[];
  };
  writing_summary?: {
    score: number | null;
    confidence: number;
    rationale: string;
    evidence_ids: string[];
    available: boolean;
  };
  cross_artifact_summary?: {
    score: number | null;
    confidence: number;
    rationale: string;
    evidence_ids: string[];
    available: boolean;
  };
  curiosity_summary: {
    score: number;
    confidence: number;
    rationale: string;
    evidence_ids: string[];
  };
  strongest_artifacts: Array<{
    artifact_id: string;
    kind: ArtifactKind;
    title: string;
    url: string;
    reason_selected: string;
  }>;
  important_uncertainties: string[];
  next_review_step: string;
  links: {
    linkedin?: string;
    github?: string;
    website?: string;
    blog?: string;
    publications?: string;
  };
}

export interface DigestDocument {
  schema_version: string;
  digest_id: string;
  assessment_run_id: string;
  generated_at: string;
  versions: {
    assessment_schema_version: string;
    rubric_bundle_version?: string;
    priority_weight_version: string;
    prompt_versions: Record<string, string>;
  };
  criteria_summary: {
    purpose: string;
    dimensions: string[];
    important_non_signals: string[];
    limitations: string[];
  };
  meta: {
    discovered_candidate_count: number;
    assessed_candidate_count: number;
    source_candidates_path: string;
  };
  candidates: DigestCandidate[];
}
