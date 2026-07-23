import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { assessCandidate } from "../../src/assessment/assessCandidate.js";
import * as technicalJudgeV2 from "../../src/assessment/judges/technicalJudgeV2.js";
import { loadRubricBundle } from "../../src/assessment/rubrics/loadRubricBundle.js";
import { rubricBundleVersionLabel } from "../../src/assessment/rubrics/rubricCacheIdentity.js";
import {
  createAssessmentRun,
  loadCandidateAssessment,
} from "../../src/assessment/storage/assessmentRunStore.js";
import { identityFromCandidate } from "../../src/assessment/candidateIdentity.js";
import type { Candidate } from "../../src/types.js";
import type { BlogFixture } from "../../src/assessment/blog/types.js";
import type { FixtureRepoPackage } from "../../src/assessment/github/collectRepositoryArtifact.js";

const tmpDirs: string[] = [];
afterEach(() => {
  vi.restoreAllMocks();
  for (const d of tmpDirs.splice(0)) {
    fs.rmSync(d, { recursive: true, force: true });
  }
});

describe("assessCandidate isolation", () => {
  it("preserves writing judge when technical fails", async () => {
    const root = path.join(os.tmpdir(), `iso-${Date.now()}`);
    fs.mkdirSync(root, { recursive: true });
    tmpDirs.push(root);
    process.env.ASSESSMENT_RUNS_DIR = path.join(root, "runs");

    vi.spyOn(technicalJudgeV2, "deterministicTechnicalJudgeV2").mockImplementation(
      () => {
        throw new Error(
          "Schema validation failed (openai-llm): dimensions: Invalid input: expected array, received object; dimension_id"
        );
      }
    );

    const cand: Candidate = {
      name: "Iso",
      key: "iso",
      discovered_via: [],
      final_score: 1,
      score_breakdown: {
        builder: 1,
        thinker: 0,
        olympiad: 0,
        weirdness: 0,
        identity: 0,
      },
      identity_confidence: 1,
      github: {
        username: "isodev",
        profile_url: "https://github.com/isodev",
        repos: [
          {
            name: "engine",
            topics: [],
            language: "TypeScript",
            stars: 1,
            pushed_at: new Date().toISOString(),
          },
        ],
      },
      website: { url: "https://iso.example/" },
    };
    const identity = identityFromCandidate(cand);
    const run = createAssessmentRun({
      source: { candidates_path: "x", candidates_file_hash: "h" },
      config: {
        candidate_limit: 1,
        repository_limit: 3,
        publication_limit: 3,
        article_limit: 3,
        prompt_versions: {},
        weight_version: "priority-v2",
        mock_llm: true,
      },
      candidate_ids: [identity.candidate_id],
    });

    const fixtureRepo: FixtureRepoPackage = {
      owner: "isodev",
      name: "engine",
      description: "scheduler engine",
      language: "TypeScript",
      topics: [],
      readme: "# engine",
      tree: [{ path: "src/main.ts", type: "blob", size: 20 }],
      files: { "src/main.ts": "export const n = 1;\n" },
    };

    const blogFixture: BlogFixture = {
      website_url: "https://iso.example/",
      candidate_id: identity.candidate_id,
      canonical_domain: "iso.example",
      article_urls: ["https://iso.example/blog/deep"],
      pages: [
        {
          url: "https://iso.example/",
          html: "<html><body><a href='/blog/deep'>post</a></body></html>",
        },
        {
          url: "https://iso.example/blog/deep",
          html: `<html><body><h1>Deep</h1><article><p>${"reasoning ".repeat(80)}</p></article></body></html>`,
        },
      ],
    };

    const bundle = loadRubricBundle();
    await assessCandidate({
      runId: run.id,
      selected: {
        candidate_id: identity.candidate_id,
        candidate: cand,
        identity,
        source_snapshot: {
          key: cand.key,
          name: cand.name,
          discovery_score: 1,
          score_breakdown: cand.score_breakdown,
          discovered_via: [],
          github_username: "isodev",
          website_url: "https://iso.example/",
        },
      },
      opts: {
        inputPath: "x",
        mockLlm: true,
        fixtureReposByUser: { isodev: [fixtureRepo] },
        blogFixtureByKey: { isodev: blogFixture },
        selectionDetailsByUser: {
          isodev: {
            engine: {
              name: "engine",
              language: "TypeScript",
              pushed_at: new Date().toISOString(),
              stargazers_count: 1,
              forks_count: 0,
              is_fork: false,
              is_archived: false,
              topics: [],
              description: "scheduler",
            },
          },
        },
      },
      ctx: {
        rubricBundle: bundle,
        rubricBundleVersion: rubricBundleVersionLabel(bundle),
      },
      mode: "fresh",
    });

    const rec = loadCandidateAssessment(run.id, identity.candidate_id)!;
    expect(rec.judge_statuses.technical.status).toBe("failed");
    expect(rec.judge_results.technical).toBeUndefined();
    expect(rec.judge_statuses.writing.status).toBe("completed");
    expect(rec.judge_results.writing).toBeDefined();
    expect(rec.status).toBe("partial");
    expect(JSON.stringify(rec.digest_summary)).not.toMatch(
      /Schema validation failed|expected array|dimension_id/i
    );
    expect(rec.errors?.some((e) => e.judge === "technical")).toBe(true);
    expect(rec.errors?.[0]?.message).not.toMatch(/expected array/i);
    expect(rec.synthesis_state.fallback_used || !rec.synthesis_state.valid_for_ranking).toBe(
      true
    );
  });
});
