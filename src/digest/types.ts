import type {
  Archetype,
  ArtifactKind,
  OwnershipSupportClass,
} from "../assessment/types.js";

export const DIGEST_SCHEMA_VERSION = "digest-v2";

export interface DigestWeightedLine {
  label: string;
  score: number;
  weight: number;
  weighted: number;
}

export interface DigestScoreBreakdown {
  assessment: {
    overall_10: number;
    priority_100: number;
    lines: DigestWeightedLine[];
    base: number;
    age_scalar: number;
    estimated_age: number | null;
    caps: string[];
  } | null;
  discovery: {
    final_score: number;
    overall_10: number | null;
    parts: Array<{ label: string; value: number }>;
    age_scalar: number | null;
    estimated_age: number | null;
  };
  dials: {
    obscurity: number | null;
    upside: number | null;
    age_relative: number | null;
    connections: number | null;
  };
}

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
  /** Frozen 17–19 lottery pick — included even below the priority floor. */
  youth_wildcard?: boolean;
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
  /** How the 1–10 was computed (assessment formula + discovery parts). */
  score_breakdown?: DigestScoreBreakdown;
  /** Surfacing dials — age-relative impressiveness and footprint obscurity. */
  surfacing?: {
    age_relative_impressiveness: number | null;
    stage_bucket: string;
    estimated_age: number | null;
    age_label?: string | null;
    obscurity: number | null;
    connections?: number | null;
    connections_saturated?: boolean;
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
