import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it } from "vitest";
import {
  createAssessmentRun,
  updateAssessmentRunStatus,
  writeCandidateAssessment,
  loadAssessmentRun,
  assessmentRunDir,
} from "../../src/assessment/storage/assessmentRunStore.js";
import type { CandidateAssessmentRecord } from "../../src/assessment/types.js";
import { ASSESSMENT_SCHEMA_VERSION } from "../../src/assessment/types.js";

const tmpRuns: string[] = [];

afterEach(() => {
  for (const id of tmpRuns) {
    const dir = assessmentRunDir(id);
    if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
  }
  tmpRuns.length = 0;
});

function minimalRecord(
  runId: string,
  candidateId: string
): CandidateAssessmentRecord {
  return {
    schema_version: ASSESSMENT_SCHEMA_VERSION,
    candidate_id: candidateId,
    assessment_run_id: runId,
    source_candidate: {
      key: "x",
      name: "X",
      discovery_score: 1,
      score_breakdown: {
        builder: 0,
        thinker: 0,
        olympiad: 0,
        weirdness: 0,
        identity: 0,
      },
      discovered_via: [],
    },
    identity: {
      candidate_id: candidateId,
      id_source: "candidate_key",
      id_raw: "x",
      display_name: "X",
    },
    artifacts: { references: [], github_repositories: {}, evidence: [] },
    judge_results: {},
    synthesis: {
      archetype: "insufficient_evidence",
      headline: "x",
      overall_rationale: "none",
      primary_strength: "none",
      reason_to_review: "none",
      reason_for_caution: "none",
      strongest_evidence_ids: [],
      important_uncertainties: [],
      domain_scores: { evidence_completeness: 0 },
      priority_score: 0,
      priority_confidence: 0,
      weight_version: "priority-v1",
    },
    digest_summary: { why_highlighted: [], next_review_step: "n/a" },
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
}

describe("assessment run store", () => {
  it("creates run and forbids mutating completed runs", () => {
    process.env.ASSESSMENT_RUNS_DIR = path.join(
      os.tmpdir(),
      `tsearch-aruns-${Date.now()}`
    );
    const run = createAssessmentRun({
      source: {
        candidates_path: "output/candidates.json",
        candidates_file_hash: "abc",
      },
      config: {
        candidate_limit: 1,
        repository_limit: 3,
        publication_limit: 3,
        article_limit: 3,
        prompt_versions: {},
        weight_version: "priority-v1",
        mock_llm: true,
      },
    });
    tmpRuns.push(run.id);
    writeCandidateAssessment(run.id, minimalRecord(run.id, "cand_test"));
    updateAssessmentRunStatus(run.id, "completed");
    expect(loadAssessmentRun(run.id)?.status).toBe("completed");
    expect(() =>
      updateAssessmentRunStatus(run.id, "judging")
    ).toThrow(/immutable/);
  });
});
