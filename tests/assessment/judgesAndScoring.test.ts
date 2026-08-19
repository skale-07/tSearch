import { describe, expect, it } from "vitest";
import { deterministicTechnicalJudgeV2 } from "../../src/assessment/judges/technicalJudgeV2.js";
import { deterministicWritingJudge } from "../../src/assessment/judges/writingJudge.js";
import { deterministicCrossArtifactJudge } from "../../src/assessment/judges/crossArtifactJudge.js";
import { deterministicCoryRelevance } from "../../src/assessment/judges/coryRelevanceJudge.js";
import {
  computePriorityV2,
  EXPERIENCE_AS_TECHNICAL_CAP,
  PRIORITY_V2_VERSION,
  synthesizeCandidate,
  ownershipSupportToScore,
} from "../../src/assessment/scoring/synthesizeCandidate.js";
import { synthesizeFromTechnical } from "../../src/assessment/scoring/archetypes.js";
import type {
  EvidenceItem,
  GithubRepositoryArtifactDetail,
  OwnershipAssessmentV2,
  SpecialistJudgeResult,
} from "../../src/assessment/types.js";
import { TECHNICAL_DIMENSIONS_V2 } from "../../src/assessment/types.js";

function ev(id: string, strength: EvidenceItem["strength"] = "moderate"): EvidenceItem {
  return {
    evidence_id: id,
    artifact_id: "art_1",
    source_type: "github_file",
    source_url: "https://github.com/x/y",
    observation: "Core implementation present.",
    supports_claim: "Implementation depth",
    strength,
    candidate_ownership_confidence: 0.7,
  };
}

function repo(partial?: Partial<GithubRepositoryArtifactDetail>): GithubRepositoryArtifactDetail {
  const ownership: OwnershipAssessmentV2 = {
    schema_version: "ownership-v2",
    support_class: "high_ownership_support",
    evidence_coverage: "medium",
    identity_support: "high",
    direct_core_contribution_present: true,
    contribution_metrics: { candidate_commit_count: 12 },
    responsibility_signals: [],
    continuity_signals: [],
    provenance_risks: [],
    identity_risks: [],
    supporting_evidence_ids: ["ev1"],
    counterevidence_ids: [],
    missing_information: [],
    summary: "High ownership support.",
  };
  return {
    owner: "deep",
    name: "custom-scheduler-engine",
    full_name: "deep/custom-scheduler-engine",
    description: "scheduler",
    default_branch: "main",
    is_fork: false,
    is_archived: false,
    language: "Rust",
    languages: { Rust: 1 },
    topics: [],
    license: null,
    stars: 1,
    pushed_at: null,
    created_at: null,
    readme_excerpt: "Custom scheduler with failure recovery.",
    tree: [],
    manifests: [{ path: "Cargo.toml", excerpt: "[package]" }],
    core_source_files: [{ path: "src/sched.rs", excerpt: "fn place() {}" }],
    test_files: [{ path: "tests/t.rs", excerpt: "#[test] fn ok() {}" }],
    candidate_commits: Array.from({ length: 10 }, (_, i) => ({
      sha: `s${i}`,
      message: `m${i}`,
      date: null,
      url: "u",
    })),
    candidate_prs: [],
    ownership,
    ownership_legacy: {
      score: 8,
      confidence: 0.8,
      ownership_type: "primary_creator",
      rationale: "legacy",
      evidence_ids: ["ev1"],
      limitations: [],
    },
    ...partial,
  };
}

describe("deterministic judges offline", () => {
  it("technical v2 covers all dimensions without ownership dim", () => {
    const evidence = [ev("ev1", "strong"), ev("ev2")];
    const result = deterministicTechnicalJudgeV2({
      evidence,
      repositories: [repo()],
    });
    expect(result.schema_version).toBe("technical-judge-v2");
    expect(result.dimensions).toHaveLength(TECHNICAL_DIMENSIONS_V2.length);
    expect(result.dimensions.every((d) => d.dimension_id !== "candidate_ownership")).toBe(
      true
    );
    expect(result.dimensions.every((d) => d.score === null || (d.score >= 0 && d.score <= 5))).toBe(
      true
    );
  });

  it("writing judge abstains without articles", () => {
    const result = deterministicWritingJudge({ articles: [], evidence: [] });
    expect(result.overall_writing_depth).toBe("insufficient_public_evidence");
    expect(result.dimensions.every((d) => d.score === null)).toBe(true);
  });

  it("cross-artifact judge abstains without relationships", () => {
    const result = deterministicCrossArtifactJudge({
      artifactIds: ["a1"],
      relationships: [],
      evidence: [ev("ev1")],
    });
    expect(result.dimensions.every((d) => d.applicability === "insufficient_evidence")).toBe(
      true
    );
  });

  it("cory relevance is deterministic from signals", () => {
    const technical = deterministicTechnicalJudgeV2({
      evidence: [ev("ev1", "strong")],
      repositories: [repo()],
    });
    const cory = deterministicCoryRelevance({
      technical,
      ownership: repo().ownership,
      evidenceCompleteness: 0.8,
    });
    expect(cory.calibration_version).toMatch(/^cory-relevance-v1/);
    expect(["high", "medium", "low", "insufficient_evidence"]).toContain(cory.relevance);
  });
});

describe("priority-v2 synthesis", () => {
  it("maps ownership support classes to legacy-style scores", () => {
    expect(ownershipSupportToScore("high_ownership_support")).toBe(8);
    expect(ownershipSupportToScore("medium_ownership_support")).toBe(6);
    expect(ownershipSupportToScore("low_ownership_support")).toBe(3);
    expect(ownershipSupportToScore("insufficient_public_evidence")).toBe(2);
  });

  it("does not fully redistribute missing writing weight", () => {
    const technical = deterministicTechnicalJudgeV2({
      evidence: [ev("ev1", "strong"), ev("ev2")],
      repositories: [repo()],
    });
    const withWritingMissing = synthesizeCandidate({
      name: "A",
      technical,
      ownership: repo().ownership,
      evidenceCount: 6,
    });
    expect(withWritingMissing.weight_version).toBe(PRIORITY_V2_VERSION);
    expect(withWritingMissing.axes?.writing_intellectual_depth?.available).toBe(false);
    expect(withWritingMissing.archetype_assignment?.primary).toBeTruthy();

    // Half of writing (0.05) unused: max theoretical < full redistribution
    const axes = withWritingMissing.axes!;
    const { components } = computePriorityV2({ axes });
    expect(components.w_writing).toBe(0);
    // technical receives at most +0.025 from writing half-share
    expect(components.w_technical).toBeLessThanOrEqual(0.3 + 0.025 + 0.075 / 2 + 1e-9);
  });

  it("compat wrapper synthesizeFromTechnical uses priority-v2", () => {
    const legacy: SpecialistJudgeResult = {
      judge_type: "technical",
      prompt_version: "technical-v1",
      model: "deterministic-fixture",
      input_hash: "x",
      summary: "Legacy summary",
      dimensions: [
        {
          dimension: "technical_depth",
          score: 7,
          confidence: 0.7,
          definition: "d",
          rationale: "r",
          supporting_evidence_ids: ["ev1"],
          counterevidence: [],
          missing_information: [],
        },
        {
          dimension: "architecture_depth",
          score: 7,
          confidence: 0.7,
          definition: "d",
          rationale: "r",
          supporting_evidence_ids: ["ev1"],
          counterevidence: [],
          missing_information: [],
        },
        {
          dimension: "algorithmic_depth",
          score: 6,
          confidence: 0.7,
          definition: "d",
          rationale: "r",
          supporting_evidence_ids: ["ev1"],
          counterevidence: [],
          missing_information: [],
        },
        {
          dimension: "implementation_quality",
          score: 7,
          confidence: 0.7,
          definition: "d",
          rationale: "r",
          supporting_evidence_ids: ["ev1"],
          counterevidence: [],
          missing_information: [],
        },
        {
          dimension: "unusual_problem_selection",
          score: 7,
          confidence: 0.7,
          definition: "d",
          rationale: "r",
          supporting_evidence_ids: ["ev1"],
          counterevidence: [],
          missing_information: [],
        },
        {
          dimension: "persistence_and_iteration",
          score: 6,
          confidence: 0.7,
          definition: "d",
          rationale: "r",
          supporting_evidence_ids: ["ev1"],
          counterevidence: [],
          missing_information: [],
        },
        {
          dimension: "problem_difficulty",
          score: 6,
          confidence: 0.7,
          definition: "d",
          rationale: "r",
          supporting_evidence_ids: ["ev1"],
          counterevidence: [],
          missing_information: [],
        },
        {
          dimension: "evaluation_rigor",
          score: 6,
          confidence: 0.7,
          definition: "d",
          rationale: "r",
          supporting_evidence_ids: ["ev1"],
          counterevidence: [],
          missing_information: [],
        },
        {
          dimension: "originality",
          score: 5,
          confidence: 0.7,
          definition: "d",
          rationale: "r",
          supporting_evidence_ids: ["ev1"],
          counterevidence: [],
          missing_information: [],
        },
        {
          dimension: "completion",
          score: 6,
          confidence: 0.7,
          definition: "d",
          rationale: "r",
          supporting_evidence_ids: ["ev1"],
          counterevidence: [],
          missing_information: [],
        },
        {
          dimension: "candidate_ownership",
          score: 7,
          confidence: 0.7,
          definition: "d",
          rationale: "r",
          supporting_evidence_ids: ["ev1"],
          counterevidence: [],
          missing_information: [],
        },
      ],
      strongest_evidence_ids: ["ev1"],
      important_uncertainties: [],
      recommended_human_review: [],
      created_at: new Date().toISOString(),
    };
    const syn = synthesizeFromTechnical({
      technical: legacy,
      ownership: repo().ownership,
      evidenceCount: 5,
      discoveryScore: 1,
      name: "Legacy",
    });
    expect(syn.weight_version).toBe("priority-v2");
    expect(syn.archetype_assignment).toBeDefined();
    expect(syn.axes).toBeDefined();
  });

  it("uses LinkedIn experience as capped technical when GitHub was not judged", () => {
    const experience = {
      schema_version: "experience-judge-v1" as const,
      judge_type: "experience" as const,
      artifact_ids: ["art_exp"],
      rubric_id: "experience-distinctiveness-v1",
      rubric_version: "1",
      prompt_version: "experience-prompt-v1",
      model: "test",
      dimensions: [],
      overall_distinctiveness: "strong" as const,
      evidence_support: "low" as const,
      hook: "Built a national robotics platform",
      strongest_evidence_ids: ["ev_exp"],
      counterevidence_ids: [],
      missing_information: [],
      summary: "Distinctive stated path.",
    };
    const withExp = synthesizeCandidate({
      name: "Youth",
      experience,
      evidenceCount: 3,
      estimatedAge: 18,
    });
    const empty = synthesizeCandidate({
      name: "Youth",
      evidenceCount: 3,
      estimatedAge: 18,
    });
    expect(withExp.axes?.technical_strength?.available).toBe(true);
    expect(withExp.axes?.technical_strength?.score).toBeCloseTo(
      0.8 * EXPERIENCE_AS_TECHNICAL_CAP
    );
    expect(withExp.axes?.technical_strength?.summary).toMatch(/LinkedIn experience/);
    expect(withExp.priority_score).toBeGreaterThan(empty.priority_score);

    const github = deterministicTechnicalJudgeV2({
      evidence: [ev("ev1", "strong")],
      repositories: [repo()],
    });
    const withBoth = synthesizeCandidate({
      name: "Both",
      technical: github,
      ownership: repo().ownership,
      experience,
      evidenceCount: 6,
    });
    expect(withBoth.axes?.technical_strength?.score).toBeGreaterThan(
      withExp.axes!.technical_strength!.score!
    );
    expect(withBoth.axes?.technical_strength?.summary).not.toMatch(/LinkedIn experience/);
  });

  it("applies the age scalar to LinkedIn-only experience so 17 outranks 28", () => {
    const experience = {
      schema_version: "experience-judge-v1" as const,
      judge_type: "experience" as const,
      artifact_ids: ["art_exp"],
      rubric_id: "experience-distinctiveness-v1",
      rubric_version: "1",
      prompt_version: "experience-prompt-v1",
      model: "test",
      dimensions: [],
      overall_distinctiveness: "strong" as const,
      evidence_support: "low" as const,
      hook: "Built a national robotics platform",
      strongest_evidence_ids: ["ev_exp"],
      counterevidence_ids: [],
      missing_information: [],
      summary: "Distinctive stated path.",
    };
    const young = synthesizeCandidate({
      name: "Youth",
      experience,
      evidenceCount: 3,
      estimatedAge: 17,
    });
    const older = synthesizeCandidate({
      name: "Older",
      experience,
      evidenceCount: 3,
      estimatedAge: 28,
    });
    expect(young.priority_score).toBeGreaterThan(older.priority_score);
    expect(young.priority_score / older.priority_score).toBeCloseTo(28 / 17, 2);
  });
});
