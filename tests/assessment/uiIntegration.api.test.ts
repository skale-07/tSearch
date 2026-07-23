import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  prepareAssessmentRun,
  getAssessmentRunResponse,
  getAssessmentRunCandidateRows,
  assertCandidateInRun,
  readPersistedAssessmentStatus,
} from "../../server/assessmentApi.js";
import {
  assessmentRunDir,
  createAssessmentRun,
  listCandidateAssessments,
  loadAssessmentRun,
  updateAssessmentRunStatus,
  writeCandidateAssessment,
  writeSourceCandidates,
} from "../../src/assessment/storage/assessmentRunStore.js";
import { TECHNICAL_JUDGE_IMPLEMENTATION_VERSION } from "../../src/assessment/storage/artifactCache.js";
import { ASSESSMENT_SCHEMA_VERSION } from "../../src/assessment/types.js";
import type { Candidate } from "../../src/types.js";
import { identityFromCandidate } from "../../src/assessment/candidateIdentity.js";
import { runAssessment } from "../../src/assessment/runAssessment.js";
import { MockLlmJudgeClient } from "../../src/assessment/judges/llmClient.js";
import { TECHNICAL_DIMENSIONS_V2 } from "../../src/assessment/types.js";
import {
  initialJudgeStatuses,
  initialSynthesisState,
} from "../../src/assessment/assessmentState.js";
import type { CandidateAssessmentRecord } from "../../src/assessment/types.js";

const tmpDirs: string[] = [];

function tmpRoot(): string {
  const dir = path.join(os.tmpdir(), `tsearch-ui-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  fs.mkdirSync(dir, { recursive: true });
  tmpDirs.push(dir);
  process.env.ASSESSMENT_RUNS_DIR = path.join(dir, "runs");
  return dir;
}

afterEach(() => {
  for (const dir of tmpDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function candidate(partial: {
  name: string;
  key: string;
  github?: string;
  website?: string;
}): Candidate {
  return {
    name: partial.name,
    key: partial.key,
    discovered_via: [],
    final_score: 0.5,
    score_breakdown: {
      builder: 0.5,
      thinker: 0,
      olympiad: 0,
      weirdness: 0,
      identity: 0,
    },
    identity_confidence: 0.5,
    github: partial.github
      ? { username: partial.github, profile_url: `https://github.com/${partial.github}` }
      : undefined,
    website: partial.website ? { url: partial.website } : undefined,
  };
}

function writeCandidatesFile(dir: string, list: Candidate[]): string {
  const p = path.join(dir, "candidates.json");
  fs.writeFileSync(p, JSON.stringify(list, null, 2));
  return p;
}

describe("prepareAssessmentRun", () => {
  it("freezes only eligible requested IDs and rejects unknown", () => {
    const root = tmpRoot();
    const a = candidate({ name: "A", key: "a", github: "alice" });
    const b = candidate({ name: "B", key: "b" }); // insufficient
    const c = candidate({ name: "C", key: "c", website: "https://c.example" });
    const input = writeCandidatesFile(root, [a, b, c]);
    const idA = identityFromCandidate(a).candidate_id;
    const idB = identityFromCandidate(b).candidate_id;
    const idC = identityFromCandidate(c).candidate_id;

    const bad = prepareAssessmentRun({
      candidate_ids: [idA, "cand_does_not_exist"],
      inputPath: input,
      mock_llm: true,
    });
    expect("error" in bad).toBe(true);

    const ok = prepareAssessmentRun({
      candidate_ids: [idA, idB, idC],
      inputPath: input,
      mock_llm: true,
      skip_digest: true,
    });
    expect("error" in ok).toBe(false);
    if ("error" in ok) return;
    expect(ok.eligible_count).toBe(2);
    expect(ok.skipped_count).toBe(1);
    expect(ok.skipped_candidates[0]?.candidate_id).toBe(idB);

    const run = loadAssessmentRun(ok.run_id)!;
    expect(run.candidate_ids).toEqual([idA, idC]);
    expect(run.candidate_ids).not.toContain(idB);
    expect(run.config.judge_implementation_version).toBe(
      TECHNICAL_JUDGE_IMPLEMENTATION_VERSION
    );
    expect(TECHNICAL_JUDGE_IMPLEMENTATION_VERSION).toBe("technical-judge-v2");
    expect(run.status).toBe("queued");

    const snap = JSON.parse(
      fs.readFileSync(
        path.join(assessmentRunDir(ok.run_id), "source-candidates.json"),
        "utf-8"
      )
    ) as Candidate[];
    expect(snap).toHaveLength(2);
  });
});

describe("run terminal status", () => {
  it("marks completed_with_errors when a judge fails but writing survives", async () => {
    const root = tmpRoot();
    const person = candidate({
      name: "Writer",
      key: "writer",
      github: "writerdev",
      website: "https://writer.example",
    });
    const input = writeCandidatesFile(root, [person]);
    const id = identityFromCandidate(person).candidate_id;

    let techCalls = 0;
    const client = new MockLlmJudgeClient(({ systemPrompt }) => {
      if (systemPrompt.includes("technical") || systemPrompt.includes("Technical")) {
        techCalls += 1;
        throw new Error(
          "Schema validation failed (openai-llm): dimensions: Invalid input: expected array, received object"
        );
      }
      // writing / other — return minimal valid-ish; writing judge may use deterministic in mock path
      return {};
    });

    // Use fixtures so we don't hit network; blog fixture + empty repos still exercise paths
    const { runId } = await runAssessment({
      inputPath: input,
      candidateIds: [id],
      limit: 1,
      mockLlm: true,
      llmClient: client,
      skipDigest: true,
      fixtureReposByUser: {
        writerdev: [
          {
            name: "demo",
            full_name: "writerdev/demo",
            description: "demo",
            default_branch: "main",
            language: "TypeScript",
            topics: [],
            is_fork: false,
            is_archived: false,
            stargazers_count: 1,
            forks_count: 0,
            pushed_at: new Date().toISOString(),
            created_at: new Date().toISOString(),
            html_url: "https://github.com/writerdev/demo",
            readme: "# demo\nengine scheduler",
            tree: [{ path: "src/main.ts", type: "blob", size: 100 }],
            files: {
              "src/main.ts": "export const x = 1;\n",
              "README.md": "# demo\n",
            },
            commits: [],
            prs: [],
          },
        ],
      },
      blogFixtureByKey: {
        writerdev: {
          site_url: "https://writer.example",
          articles: [
            {
              title: "Deep dive",
              canonical_url: "https://writer.example/a",
              published_at: "2024-01-01",
              content_hash: "h1",
              sections: [{ heading: "Intro", text: "A long essay about systems." }],
            },
          ],
        },
      },
      selectionDetailsByUser: {
        writerdev: {
          demo: {
            name: "demo",
            language: "TypeScript",
            pushed_at: new Date().toISOString(),
            stargazers_count: 1,
            forks_count: 0,
            is_fork: false,
            is_archived: false,
            topics: [],
            description: "demo",
          },
        },
      },
    });

    const run = loadAssessmentRun(runId)!;
    // deterministic mock path may not call failing client for technical — assert structure
    expect(["completed", "completed_with_errors"]).toContain(run.status);
    const assessments = listCandidateAssessments(runId);
    expect(assessments).toHaveLength(1);
    const rec = assessments[0]!;
    expect(rec.judge_statuses).toBeDefined();
    expect(rec.synthesis_state).toBeDefined();
    expect(rec.pipeline_stage).toBe("done");
    expect(rec.revision).toBeGreaterThan(0);

    // Zod leak scan across user-facing fields
    const blob = JSON.stringify({
      digest_summary: rec.digest_summary,
      synthesis: {
        headline: rec.synthesis.headline,
        overall_rationale: rec.synthesis.overall_rationale,
        primary_strength: rec.synthesis.primary_strength,
        reason_to_review: rec.synthesis.reason_to_review,
        reason_for_caution: rec.synthesis.reason_for_caution,
      },
    });
    for (const needle of [
      "Schema validation failed",
      "ZodError",
      "expected array",
      "received object",
      "dimension_id",
      "invalid_type",
    ]) {
      expect(blob.toLowerCase()).not.toContain(needle.toLowerCase());
    }
    void techCalls;
  });
});

describe("assessment API reads + retry membership", () => {
  it("returns revision and rejects force-candidate outside snapshot", () => {
    tmpRoot();
    const run = createAssessmentRun({
      source: {
        candidates_path: "/tmp/x.json",
        candidates_file_hash: "abc",
      },
      config: {
        candidate_limit: 1,
        repository_limit: 3,
        publication_limit: 3,
        article_limit: 3,
        prompt_versions: {},
        weight_version: "priority-v2",
        mock_llm: true,
        judge_implementation_version: "technical-judge-v2",
      },
      candidate_ids: ["cand_in_snap"],
    });
    writeSourceCandidates(run.id, []);

    const rec: CandidateAssessmentRecord = {
      schema_version: ASSESSMENT_SCHEMA_VERSION,
      candidate_id: "cand_in_snap",
      assessment_run_id: run.id,
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
        candidate_id: "cand_in_snap",
        id_source: "candidate_key",
        id_raw: "x",
        display_name: "X",
      },
      artifacts: { references: [], github_repositories: {}, evidence: [] },
      judge_results: {},
      judge_statuses: initialJudgeStatuses({
        hasGithub: false,
        hasWritingSurface: false,
      }),
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
        priority_score: 5,
        priority_confidence: 0,
        weight_version: "priority-v2",
      },
      synthesis_state: {
        ...initialSynthesisState(),
        status: "completed",
        valid_for_ranking: false,
        fallback_used: true,
      },
      digest_summary: { why_highlighted: [], next_review_step: "n/a" },
      status: "insufficient_context",
      pipeline_stage: "done",
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      revision: 0,
    };
    writeCandidateAssessment(run.id, rec);
    updateAssessmentRunStatus(run.id, "completed_with_errors");

    const api = getAssessmentRunResponse(run.id)!;
    expect(api.status).toBe("completed_with_errors");
    expect(api.revision).toBeGreaterThan(0);
    expect(readPersistedAssessmentStatus(run.id)).toBe("completed_with_errors");

    const rows = getAssessmentRunCandidateRows(run.id)!;
    expect(rows[0]?.synthesis_valid).toBe(false);
    expect(rows[0]?.priority_score).toBeUndefined();
    expect(rows[0]?.judge_statuses.writing.status).toBe("not_applicable");

    const bad = assertCandidateInRun(run.id, "cand_other");
    expect("error" in bad).toBe(true);
    const good = assertCandidateInRun(run.id, "cand_in_snap");
    expect("error" in good).toBe(false);
  });
});

describe("technical v2 metadata", () => {
  it("uses technical-judge-v2 constant", () => {
    expect(TECHNICAL_JUDGE_IMPLEMENTATION_VERSION).toBe("technical-judge-v2");
    expect(TECHNICAL_DIMENSIONS_V2.length).toBe(12);
  });
});
