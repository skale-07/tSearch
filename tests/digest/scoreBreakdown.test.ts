import { describe, expect, it } from "vitest";
import { buildDigest } from "../../src/digest/buildDigest.js";
import {
  digestScoreBreakdown,
  scoreBreakdownHtml,
  scoreBreakdownMarkdown,
} from "../../src/digest/scoreBreakdown.js";
import type {
  AssessmentRun,
  CandidateAssessmentRecord,
} from "../../src/assessment/types.js";
import { ASSESSMENT_SCHEMA_VERSION } from "../../src/assessment/types.js";

function record(): CandidateAssessmentRecord {
  return {
    schema_version: ASSESSMENT_SCHEMA_VERSION,
    candidate_id: "cand_break",
    assessment_run_id: "arun_test",
    source_candidate: {
      key: "test",
      name: "Test Person",
      discovery_score: 2.19,
      score_breakdown: {
        builder: 0.5,
        thinker: 0,
        olympiad: 1.4,
        weirdness: 0,
        identity: 0.19,
        convergence: 0,
        obscurity: 0.72,
        age_scalar: 1.048,
        estimated_age: 21,
        overall_score: 7.3,
      },
      discovered_via: ["linkedin:x"],
    },
    identity: {
      candidate_id: "cand_break",
      id_source: "github_username",
      id_raw: "test",
      display_name: "Test Person",
      github_username: "test",
    },
    artifacts: {
      references: [],
      github_repositories: {},
      evidence: [],
    },
    judge_results: {},
    judge_statuses: {
      technical: { status: "failed", attempt_count: 1, error_ids: [] },
      writing: { status: "completed", attempt_count: 1, error_ids: [] },
      cross_artifact: { status: "not_applicable", attempt_count: 0, error_ids: [] },
      cory: { status: "abstained", attempt_count: 0, error_ids: [] },
    },
    synthesis: {
      archetype: "insufficient_evidence",
      headline: "Test Person: insufficient",
      overall_rationale: "x",
      primary_strength: "x",
      reason_to_review: "x",
      reason_for_caution: "x",
      strongest_evidence_ids: [],
      important_uncertainties: [],
      domain_scores: { evidence_completeness: 0.2 },
      priority_score: 20.96,
      overall_score: 2.1,
      priority_confidence: 0.35,
      weight_version: "priority-v2",
      axes: {
        technical_strength: {
          score: 0,
          available: true,
          evidence_support: "low",
        },
        ownership_support: {
          score: 0.2,
          available: true,
          evidence_support: "low",
        },
        writing_intellectual_depth: {
          score: 0.3,
          available: true,
          evidence_support: "low",
        },
        evidence_completeness: {
          score: 0.2,
          available: true,
          evidence_support: "low",
        },
      },
      surfacing: {
        age_relative_impressiveness: null,
        stage_bucket: "early_undergrad",
        estimated_age: 21,
        obscurity: 0.72,
        upside_score: null,
      },
    },
    digest_summary: {
      why_highlighted: [],
      next_review_step: "x",
    },
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    synthesis_state: {
      status: "completed",
      valid_for_ranking: false,
      fallback_used: true,
    },
    status: "partial",
    pipeline_stage: "done",
    revision: 1,
  };
}

const run: AssessmentRun = {
  schema_version: ASSESSMENT_SCHEMA_VERSION,
  id: "arun_test",
  created_at: new Date().toISOString(),
  status: "completed",
  source: {
    candidates_path: "output/candidates.json",
    candidates_file_hash: "abc",
  },
  config: {
    candidate_limit: 10,
    repository_limit: 3,
    publication_limit: 3,
    article_limit: 3,
    prompt_versions: {},
    weight_version: "priority-v2",
  },
  candidate_ids: ["cand_break"],
  errors: [],
};

describe("digestScoreBreakdown", () => {
  it("shows age as a multiplier and obscurity as a dial outside the score", () => {
    const b = digestScoreBreakdown(record());
    expect(b.assessment?.age_scalar).toBeGreaterThan(1);
    expect(b.assessment?.estimated_age).toBe(21);
    expect(b.discovery.parts.some((p) => p.label === "Olympiad")).toBe(true);
    expect(b.dials.obscurity).toBe(0.72);
    const html = scoreBreakdownHtml(b);
    expect(html).toMatch(/How the score was computed/i);
    expect(html).toMatch(/Age/i);
    expect(html).toMatch(/Obscurity/);
    expect(html).toMatch(/not/i);
    expect(html).not.toMatch(/cory/i);
    const md = scoreBreakdownMarkdown(b);
    expect(md).toMatch(/Discovery/);
    expect(md).toMatch(/Obscurity/);
  });

  it("lands on digest cards via buildDigest", () => {
    const digest = buildDigest({
      run,
      assessments: [record()],
      discoveredCandidateCount: 1,
      minPriority: 0,
    });
    expect(digest.candidates[0]?.score_breakdown?.dials.obscurity).toBe(0.72);
    expect(digest.candidates[0]?.score_breakdown?.assessment?.estimated_age).toBe(
      21
    );
  });

  it("does not leak discovery obscurity when assessment gated it off", () => {
    const gated = record();
    gated.synthesis.surfacing = {
      ...gated.synthesis.surfacing!,
      obscurity: null,
      upside_score: null,
    };
    const b = digestScoreBreakdown(gated);
    expect(b.dials.obscurity).toBeNull();
    expect(scoreBreakdownHtml(b)).not.toMatch(/Obscurity/);
  });
});
