import type { ScoreBreakdown } from "../types.js";
import type { BlogArticle } from "./blog/types.js";
import type { ArtifactRelationship } from "./relationships/types.js";
import type { StageBasis, StageBucket } from "./stage/deriveStage.js";

export const ASSESSMENT_SCHEMA_VERSION = "assessment-record-v2";

export type ArtifactKind =
  | "github_repository"
  | "github_contribution"
  | "research_publication"
  | "technical_article"
  | "essay"
  | "project_page"
  | "dataset"
  | "other";

export type EvidenceStrength = "weak" | "moderate" | "strong";

export type AssessmentRunStatus =
  | "queued"
  | "pending" // legacy; API normalizes to queued
  | "collecting"
  | "judging"
  | "rendering"
  | "completed"
  | "completed_with_errors"
  | "interrupted"
  | "failed";

/** Mid-pipeline progress only — never a terminal outcome. */
export type CandidateAssessmentStage =
  | "pending"
  | "collecting"
  | "judging_technical"
  | "judging_writing"
  | "linking_artifacts"
  | "judging_cross_artifact"
  | "judging_cory"
  | "synthesizing"
  | "done";

/** Terminal / lifecycle status for UI color and retry behavior. */
export type CandidateAssessmentStatus =
  | "pending"
  | "running"
  | "completed"
  | "partial"
  | "failed"
  | "insufficient_context";

export type JudgeExecutionStatus =
  | "pending"
  | "running"
  | "completed"
  | "abstained"
  | "not_applicable"
  | "failed";

export interface JudgeExecutionState {
  status: JudgeExecutionStatus;
  started_at?: string;
  completed_at?: string;
  attempt_count: number;
  error_ids: string[];
  fallback_used?: boolean;
}

export interface CandidateJudgeStatuses {
  technical: JudgeExecutionState;
  writing: JudgeExecutionState;
  cross_artifact: JudgeExecutionState;
  cory: JudgeExecutionState;
  /** Optional: absent on records written before the experience judge existed. */
  experience?: JudgeExecutionState;
}

export interface SynthesisExecutionState {
  status: "pending" | "completed" | "partial" | "failed" | "not_run";
  valid_for_ranking: boolean;
  fallback_used: boolean;
  completed_at?: string;
}

export type CandidateIdSource =
  | "github_username"
  | "linkedin_url"
  | "website_name"
  | "candidate_key";

export type OwnershipType =
  | "primary_creator"
  | "major_contributor"
  | "meaningful_contributor"
  | "minor_contributor"
  | "unclear";

export type Archetype =
  | "research_first_technical_investigator"
  | "independent_systems_builder"
  | "cross_domain_knowledge_seeker"
  | "unusual_experimentalist"
  | "deep_technical_writer"
  | "high_potential_weakly_verified"
  | "polished_profile_limited_artifact_depth"
  | "insufficient_evidence";

export interface CandidateIdentityAssessment {
  candidate_id: string;
  id_source: CandidateIdSource;
  id_raw: string;
  display_name: string;
  github_username?: string;
  linkedin_url?: string;
  website_url?: string;
}

export interface ArtifactReference {
  artifact_id: string;
  kind: ArtifactKind;
  title: string;
  canonical_url: string;
  author_identity_confidence: number;
  candidate_ownership_confidence: number;
  discovered_from: string;
  selected_reason: string;
  collected_at: string;
  content_hash?: string;
}

export interface EvidenceItem {
  evidence_id: string;
  artifact_id: string;
  source_type:
    | "github_file"
    | "github_commit"
    | "github_pull_request"
    | "github_issue"
    | "github_repository_metadata"
    | "paper_section"
    | "paper_metadata"
    | "author_contribution_statement"
    | "article_section"
    | "article_reference"
    | "project_page"
    | "profile_field"
    | "other";
  source_url: string;
  location?: {
    file_path?: string;
    line_start?: number;
    line_end?: number;
    section?: string;
    heading?: string;
    commit_sha?: string;
  };
  observation: string;
  supports_claim: string;
  strength: EvidenceStrength;
  candidate_ownership_confidence: number;
}

export interface CounterEvidence {
  observation: string;
  effect_on_score: string;
  evidence_ids?: string[];
}

export interface DimensionAssessment {
  dimension: string;
  score: number;
  confidence: number;
  definition: string;
  rationale: string;
  supporting_evidence_ids: string[];
  counterevidence: CounterEvidence[];
  missing_information: string[];
}

export interface OwnershipAssessment {
  score: number;
  confidence: number;
  ownership_type: OwnershipType;
  rationale: string;
  evidence_ids: string[];
  limitations: string[];
}

export type OwnershipSupportClass =
  | "high_ownership_support"
  | "medium_ownership_support"
  | "low_ownership_support"
  | "insufficient_public_evidence";

export type EvidenceCoverage = "high" | "medium" | "low";

export interface OwnershipAssessmentV2 {
  schema_version: "ownership-v2";
  support_class: OwnershipSupportClass;
  evidence_coverage: EvidenceCoverage;
  identity_support: "exact" | "high" | "medium" | "low";
  direct_core_contribution_present: boolean;
  contribution_metrics: {
    candidate_commit_count?: number;
    repository_commit_count_sampled?: number;
    candidate_commits_in_repository_sample?: number;
    candidate_commit_share?: number;
    sample_earliest_commit_at?: string;
    sample_latest_commit_at?: string;
    candidate_pr_count?: number;
    candidate_merged_pr_count?: number;
    candidate_core_file_change_count?: number;
    candidate_core_file_paths?: string[];
    active_weeks?: number;
    contribution_span_days?: number;
  };
  responsibility_signals: Array<{
    type:
      | "review_activity"
      | "release_participation"
      | "codeowners"
      | "maintainer_role"
      | "explicit_contribution_statement";
    evidence_ids: string[];
  }>;
  continuity_signals: Array<{
    type:
      | "active_weeks"
      | "long_contribution_span"
      | "repeat_external_contribution"
      | "post_release_maintenance";
    evidence_ids: string[];
  }>;
  provenance_risks: Array<{
    type:
      | "fork"
      | "template"
      | "imported_history"
      | "generated_code"
      | "vendored_code"
      | "course_assignment"
      | "uncertain_repository_origin";
    severity: "low" | "moderate" | "high";
    evidence_ids: string[];
  }>;
  identity_risks: string[];
  supporting_evidence_ids: string[];
  counterevidence_ids: string[];
  missing_information: string[];
  summary: string;
}

export interface SpecialistJudgeResult {
  judge_type: "technical" | "research" | "writing" | "curiosity";
  prompt_version: string;
  model: string;
  input_hash: string;
  summary: string;
  dimensions: DimensionAssessment[];
  strongest_evidence_ids: string[];
  important_uncertainties: string[];
  recommended_human_review: string[];
  created_at: string;
}

export const CANDIDATE_LABEL_IDS = [
  "garage_builder",
  "weird_bet_experimentalist",
  "conviction_writer",
  "loop_closer",
  "wild_card",
  "quiet_signal",
] as const;

export type CandidateLabelId = (typeof CANDIDATE_LABEL_IDS)[number];

export type CandidateLabelTier = 1 | 2 | 3;

/** LLM-predicted (or deterministic-fallback) label + tier for recruiter-facing framing. */
export interface CandidateLabelAssignment {
  label: CandidateLabelId;
  display: string;
  tier: CandidateLabelTier;
  runner_up: CandidateLabelId | null;
  /** One sentence naming the concrete evidence behind the call. */
  rationale: string;
  source: "llm" | "deterministic";
  prompt_version: string;
}

export interface CandidateSynthesis {
  archetype: Archetype;
  /** Multi-label assignment; `archetype` mirrors `primary` for legacy readers. */
  archetype_assignment?: ArchetypeAssignment;
  /** Tiered recruiter-facing label (label-judge); absent on records assessed before it existed. */
  label_assignment?: CandidateLabelAssignment;
  /**
   * Surfacing dials. Obscurity / connections stay outside `priority_score`.
   * Chronological age is applied as a multiplier on `priority_score` itself
   * (see `ageScalar`); age-relative impressiveness remains a separate 1–10
   * stage-gap read for Cory / digest chips.
   */
  surfacing?: {
    /** 1–10 relative to stage norm; null when unscoreable. */
    age_relative_impressiveness: number | null;
    stage_bucket: StageBucket;
    estimated_age: number | null;
    /** Recruiter-facing age, e.g. "21", "~24", "≥22". */
    age_label?: string | null;
    /** 0..1 from the discovery-side footprint read. */
    obscurity: number | null;
    /** Stated LinkedIn connection count when captured. */
    connections?: number | null;
    /** True when LinkedIn showed 500+ rather than an exact count. */
    connections_saturated?: boolean;
    /** 0..1 LLM-judged technical soundness, damped by ownership. */
    substance?: number | null;
    /** obscurity × judged substance — undiscovered *and* technically sound. */
    upside_score: number | null;
    /** upside further weighted by how impressive the work is for their age. */
    age_weighted_upside?: number | null;
  };
  axes?: AssessmentAxes;
  headline: string;
  overall_rationale: string;
  primary_strength: string;
  secondary_strength?: string;
  reason_to_review: string;
  reason_for_caution: string;
  strongest_evidence_ids: string[];
  important_uncertainties: string[];
  domain_scores: {
    technical?: number;
    research?: number;
    writing?: number;
    curiosity?: number;
    ownership?: number;
    evidence_completeness: number;
  };
  /** 0–100 internal ranking (frozen artifacts). Prefer `overall_score`. */
  priority_score: number;
  /** Recruiter-facing 1–10. */
  overall_score?: number;
  priority_confidence: number;
  weight_version: string;
}

export interface CandidateDigestSummary {
  why_highlighted: Array<{
    claim: string;
    rationale: string;
    evidence_ids: string[];
  }>;
  next_review_step: string;
}

export interface RepoTreeEntry {
  path: string;
  type: "blob" | "tree";
  size?: number;
}

export interface GithubRepositoryArtifactDetail {
  owner: string;
  name: string;
  full_name: string;
  description: string | null;
  default_branch: string;
  is_fork: boolean;
  is_archived: boolean;
  language: string | null;
  languages: Record<string, number>;
  topics: string[];
  license: string | null;
  stars: number;
  pushed_at: string | null;
  created_at: string | null;
  readme_excerpt: string;
  tree: RepoTreeEntry[];
  manifests: Array<{ path: string; excerpt: string }>;
  core_source_files: Array<{ path: string; excerpt: string }>;
  test_files: Array<{ path: string; excerpt: string }>;
  candidate_commits: Array<{
    sha: string;
    message: string;
    date: string | null;
    url: string;
  }>;
  candidate_prs: Array<{
    number: number;
    title: string;
    state: string;
    url: string;
  }>;
  ownership: OwnershipAssessmentV2;
  /** Derived view for Phase 2 synthesis / confidence floors */
  ownership_legacy: OwnershipAssessment;
}

export interface CandidateArtifactCollection {
  references: ArtifactReference[];
  github_repositories: Record<string, GithubRepositoryArtifactDetail>;
  /** Selected blog/article artifacts keyed by artifact_id */
  blog_articles?: Record<string, BlogArticle>;
  evidence: EvidenceItem[];
}

export interface CandidateJudgeResults {
  /** Primary technical result is technical-judge-v2 */
  technical?: TechnicalJudgeResultV2;
  writing?: WritingJudgeResult;
  cross_artifact?: CrossArtifactJudgeResult;
  experience?: ExperienceJudgeResult;
  age_relative?: AgeRelativeJudgeResult;
  cory?: CoryRelevanceResult;
  /** Legacy Phase-2 specialist shape retained only for adapters */
  research?: SpecialistJudgeResult;
  curiosity?: SpecialistJudgeResult;
}

export interface SourceCandidateSnapshot {
  key: string;
  name: string;
  discovery_score: number;
  score_breakdown: ScoreBreakdown;
  discovered_via: string[];
  linkedin_url?: string;
  github_username?: string;
  github_url?: string;
  website_url?: string;
  blog_url?: string;
}

export interface CandidateAssessmentRecord {
  schema_version: string;
  candidate_id: string;
  assessment_run_id: string;
  source_candidate: SourceCandidateSnapshot;
  identity: CandidateIdentityAssessment;
  artifacts: CandidateArtifactCollection;
  /** Candidate-level ownership aggregate (Phase A) */
  ownership?: OwnershipAssessmentV2;
  /** Deterministic artifact relationships (when both repo + writing exist) */
  relationships?: ArtifactRelationship[];
  judge_results: CandidateJudgeResults;
  judge_statuses: CandidateJudgeStatuses;
  synthesis: CandidateSynthesis;
  synthesis_state: SynthesisExecutionState;
  digest_summary: CandidateDigestSummary;
  status: CandidateAssessmentStatus;
  pipeline_stage: CandidateAssessmentStage;
  created_at: string;
  updated_at: string;
  revision: number;
  errors?: AssessmentError[];
  /** @deprecated Prefer errors[]; kept for older records */
  error?: AssessmentRunError;
}

export interface AssessmentError {
  id?: string;
  stage:
    | "collecting"
    | "technical"
    | "writing"
    | "relationships"
    | "cross_artifact"
    | "experience"
    | "cory"
    | "synthesis"
    | "persistence";
  code: string;
  message: string;
  technical_details?: string;
  retryable: boolean;
  judge?: "technical" | "writing" | "cross_artifact" | "experience" | "cory";
  attempt_count?: number;
  occurred_at: string;
  candidate_id?: string;
}

/** @deprecated Prefer AssessmentError */
export interface AssessmentRunError {
  code: string;
  message: string;
  retryable: boolean;
  candidate_id?: string;
  stage?: string;
  at: string;
  technical_details?: string;
  judge?: string;
}

export interface AssessmentRun {
  schema_version: string;
  id: string;
  created_at: string;
  completed_at?: string;
  updated_at?: string;
  revision?: number;
  status: AssessmentRunStatus;
  source: {
    candidates_path: string;
    candidates_file_hash: string;
    /** SHA-256 of exact bytes written to source-candidates.json */
    source_candidates_hash?: string;
    seed_slug?: string;
  };
  config: {
    candidate_limit: number;
    repository_limit: number;
    publication_limit: number;
    article_limit: number;
    model?: string;
    /** openai | anthropic | mock — which live judge backend was selected */
    llm_provider?: string;
    prompt_versions: Record<string, string>;
    weight_version: string;
    mock_llm: boolean;
    judge_schema_version?: string;
    rubric_bundle_version?: string;
    judge_implementation_version?: string;
    collection_config_version?: string;
  };
  candidate_ids: string[];
  errors: AssessmentRunError[];
  digest_id?: string;
  /** Wildcard freeze at queue time — digest must not re-draw after a later rotation. */
  youth_wildcard_ids?: string[];
}

export const TECHNICAL_DIMENSIONS = [
  "problem_difficulty",
  "technical_depth",
  "architecture_depth",
  "algorithmic_depth",
  "implementation_quality",
  "evaluation_rigor",
  "originality",
  "completion",
  "candidate_ownership",
  "persistence_and_iteration",
  "unusual_problem_selection",
] as const;

export type TechnicalDimension = (typeof TECHNICAL_DIMENSIONS)[number];

/** Technical-judge-v2 dimensions (no candidate_ownership). */
export const TECHNICAL_DIMENSIONS_V2 = [
  "problem_difficulty",
  "mechanism_depth",
  "architecture_depth",
  "algorithmic_or_methodological_depth",
  "implementation_quality",
  "evaluation_and_validation",
  "failure_handling",
  "reproducibility",
  "tradeoff_reasoning",
  "completion_and_operational_reality",
  "persistence_and_iteration",
  "unusual_problem_selection",
] as const;

export type TechnicalDimensionV2 = (typeof TECHNICAL_DIMENSIONS_V2)[number];

export const WRITING_DIMENSIONS = [
  "question_quality",
  "research_depth",
  "source_quality_and_integration",
  "reasoning_rigor",
  "mechanistic_explanation",
  "original_analysis",
  "conviction_and_contrarian_insight",
  "cross_domain_synthesis",
  "intellectual_honesty",
  "uncertainty_and_limitations",
  "observable_self_directed_inquiry",
  "topic_persistence",
  "clarity",
] as const;

export type WritingDimension = (typeof WRITING_DIMENSIONS)[number];

export const CROSS_ARTIFACT_DIMENSIONS = [
  "question_to_artifact_translation",
  "idea_project_alignment",
  "iteration_across_artifacts",
  "evidence_of_belief_updating",
  "cross_domain_connection_quality",
  "sustained_inquiry",
  "experiment_and_feedback_loop",
  "coherence_without_redundancy",
] as const;

export type CrossArtifactDimension = (typeof CROSS_ARTIFACT_DIMENSIONS)[number];

export const EXPERIENCE_DIMENSIONS = [
  "experience_rarity",
  "demonstrated_agency_and_cost",
  "concreteness_and_verifiability",
] as const;

export type ExperienceDimension = (typeof EXPERIENCE_DIMENSIONS)[number];

export type DimensionScoreV2 = 0 | 1 | 2 | 3 | 4 | 5 | null;

export type DimensionApplicability =
  | "applicable"
  | "not_applicable"
  | "insufficient_evidence";

export interface DimensionAssessmentV2 {
  dimension_id: string;
  score: DimensionScoreV2;
  applicability: DimensionApplicability;
  rationale: string;
  supporting_evidence_ids: string[];
  counterevidence_ids: string[];
  missing_information: string[];
}

export type OverallStrengthBand =
  | "exceptional"
  | "strong"
  | "moderate"
  | "limited"
  | "insufficient_public_evidence";

export type EvidenceSupportLevel = "high" | "moderate" | "low";

export interface TechnicalJudgeResultV2 {
  schema_version: "technical-judge-v2";
  judge_type: "technical";
  artifact_ids: string[];
  rubric_id: string;
  rubric_version: string;
  prompt_version: string;
  model: string;
  artifact_reconstruction: {
    problem: string;
    claimed_mechanism: string;
    visible_architecture: string;
    validation_approach: string;
    unresolved_questions: string[];
    evidence_ids: string[];
  };
  dimensions: DimensionAssessmentV2[];
  strongest_evidence_ids: string[];
  counterevidence_ids: string[];
  unsupported_or_unverifiable_claims: string[];
  missing_information: string[];
  overall_technical_strength: OverallStrengthBand;
  evidence_support: EvidenceSupportLevel;
  summary: string;
}

export interface WritingJudgeResult {
  schema_version: "writing-judge-v1";
  judge_type: "writing";
  artifact_ids: string[];
  rubric_id: string;
  rubric_version: string;
  prompt_version: string;
  model: string;
  corpus_reconstruction: {
    recurring_questions: Array<{
      question: string;
      artifact_ids: string[];
      evidence_ids: string[];
    }>;
    observable_trajectory: string;
    explicit_revisions: string[];
    original_analysis_artifacts: string[];
    evidence_ids: string[];
  };
  dimensions: DimensionAssessmentV2[];
  strongest_evidence_ids: string[];
  counterevidence_ids: string[];
  missing_information: string[];
  overall_writing_depth: OverallStrengthBand;
  evidence_support: EvidenceSupportLevel;
  summary: string;
}

export interface CrossArtifactJudgeResult {
  schema_version: "cross-artifact-judge-v1";
  judge_type: "cross_artifact";
  relationship_ids: string[];
  artifact_ids: string[];
  rubric_id: string;
  rubric_version: string;
  prompt_version: string;
  model: string;
  reconstructed_inquiry_threads: Array<{
    thread_id: string;
    question_or_theme: string;
    ordered_artifact_ids: string[];
    relationship_ids: string[];
    evidence_ids: string[];
    interpretation: string;
    counterevidence: string[];
  }>;
  dimensions: DimensionAssessmentV2[];
  overall_inquiry_support: OverallStrengthBand;
  evidence_support: EvidenceSupportLevel;
  strongest_evidence_ids: string[];
  counterevidence_ids: string[];
  missing_information: string[];
  summary: string;
}

export interface ExperienceJudgeResult {
  schema_version: "experience-judge-v1";
  judge_type: "experience";
  artifact_ids: string[];
  rubric_id: string;
  rubric_version: string;
  prompt_version: string;
  model: string;
  dimensions: DimensionAssessmentV2[];
  overall_distinctiveness: OverallStrengthBand;
  evidence_support: EvidenceSupportLevel;
  /** One recruiter-memorable line naming the weirdest concrete experience; null when nothing qualifies. */
  hook: string | null;
  strongest_evidence_ids: string[];
  counterevidence_ids: string[];
  missing_information: string[];
  summary: string;
}

export interface AgeRelativeJudgeResult {
  schema_version: "age-relative-judge-v1";
  judge_type: "age_relative";
  prompt_version: string;
  model: string;
  stage_bucket: StageBucket;
  estimated_age: number | null;
  stage_confidence: number;
  stage_basis: StageBasis;
  /** 1–10 relative to the stage norm; null when stage or work is insufficient. */
  score: number | null;
  applicability: "applicable" | "insufficient_evidence";
  rationale: string;
  source: "llm" | "deterministic";
}

export interface CoryRelevanceResult {
  relevance: "high" | "medium" | "low" | "insufficient_evidence";
  reasons: string[];
  evidence_ids: string[];
  calibration_version: string;
  human_review_recommended: boolean;
}

export interface AxisResult {
  /** Normalized 0..1 when available; null when unavailable. */
  score: number | null;
  available: boolean;
  evidence_support: EvidenceSupportLevel;
  summary?: string;
}

export interface AssessmentAxes {
  technical_strength?: AxisResult;
  ownership_support?: AxisResult;
  writing_intellectual_depth?: AxisResult;
  observable_inquiry?: AxisResult;
  cross_artifact_coherence?: AxisResult;
  evidence_completeness: AxisResult;
  cory_relevance?: AxisResult;
  unusual_problem_selection?: AxisResult;
  persistence_and_iteration?: AxisResult;
}

export interface ArchetypeAssignment {
  primary: Archetype;
  secondary: Archetype[];
  evidence_ids: string[];
  confidence_support: "high" | "moderate" | "low";
}

export interface EvidenceSupportResult {
  level: EvidenceSupportLevel;
  reasons: string[];
  caps_applied: string[];
}
