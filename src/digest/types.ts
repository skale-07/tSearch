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
  /** Reviewer feedback applied to this digest (Phase 3/4 loop). */
  reviewer_feedback?: "relevant" | "explore_network";
  /** Reachable from 2+ seed-set members (the convergence heuristic). */
  network_bridges?: {
    seed_count: number;
    seeds: string[];
    collaborator_of: string[];
  };
  why_highlighted: Array<{
    claim: string;
    rationale: string;
    evidence_ids: string[];
  }>;
  /** Few-sentence Cory brief naming specific works */
  brief_rationale?: string;
  /** One recruiter-memorable line from the experience judge (self-reported path). */
  experience_hook?: string;
  /** Tiered recruiter label (label-judge): e.g. "Garage Builder" tier 1. */
  label?: { id: string; display: string; tier: number; rationale?: string };
  /** Surfacing dials — age-relative impressiveness and footprint obscurity. */
  surfacing?: {
    age_relative_impressiveness: number | null;
    stage_bucket: string;
    estimated_age: number | null;
    obscurity: number | null;
    connections?: number | null;
    substance?: number | null;
    upside_score: number | null;
    age_weighted_upside?: number | null;
  };
  cory_relevance?: string;
  cory_reasons?: string[];
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
    /** Candidates hidden because the reviewer marked them not_relevant. */
    feedback_excluded_count?: number;
    /** Candidates ranked up because the reviewer marked them relevant. */
    feedback_boosted_count?: number;
  };
  candidates: DigestCandidate[];
}
