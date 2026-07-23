import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it } from "vitest";
import { runAssessment } from "../../src/assessment/runAssessment.js";
import { assessmentRunDir } from "../../src/assessment/storage/assessmentRunStore.js";
import type { FixtureRepoPackage } from "../../src/assessment/github/collectRepositoryArtifact.js";
import type { Candidate } from "../../src/types.js";

const cleanup: string[] = [];

afterEach(() => {
  for (const p of cleanup) {
    if (fs.existsSync(p)) fs.rmSync(p, { recursive: true, force: true });
  }
  cleanup.length = 0;
});

function baseCandidate(partial: Partial<Candidate> & { name: string; key: string }): Candidate {
  return {
    discovered_via: ["linkedin:test"],
    identity_confidence: 0.9,
    final_score: 1.5,
    score_breakdown: {
      builder: 0.5,
      thinker: 0,
      olympiad: 0.5,
      weirdness: 0,
      identity: 0.2,
    },
    ...partial,
  };
}

const deepFixture: FixtureRepoPackage = {
  owner: "deepbuilder",
  name: "custom-scheduler-engine",
  description: "Custom placement scheduler with benchmarks",
  language: "Rust",
  stars: 3,
  readme: "# Scheduler\nCustom concurrent placement engine with failure recovery.",
  tree: [
    { path: "Cargo.toml", type: "blob", size: 200 },
    { path: "src/scheduler.rs", type: "blob", size: 4000 },
    { path: "src/bench.rs", type: "blob", size: 2000 },
    { path: "tests/scheduler_test.rs", type: "blob", size: 1000 },
  ],
  files: {
    "Cargo.toml": '[package]\nname = "scheduler"',
    "src/scheduler.rs": "pub fn place(nodes: &[Node]) -> Placement { /* nontrivial */ }",
    "src/bench.rs": "fn bench_throughput() {}",
    "tests/scheduler_test.rs": "#[test] fn recovers_from_failure() {}",
  },
  candidate_commits: Array.from({ length: 12 }, (_, i) => ({
    sha: `abc${i}`,
    message: `iterate scheduler ${i}`,
    date: "2024-01-01T00:00:00Z",
    url: "https://github.com/deepbuilder/custom-scheduler-engine/commit/abc",
  })),
  candidate_commit_files: Object.fromEntries(
    Array.from({ length: 12 }, (_, i) => [
      `abc${i}`,
      ["src/scheduler.rs"],
    ])
  ),
  repository_commit_sample: [
    ...Array.from({ length: 12 }, (_, i) => ({
      sha: `abc${i}`,
      author_login: "deepbuilder",
      committer_login: "deepbuilder",
      date: "2024-01-01T00:00:00Z",
      files_changed: ["src/scheduler.rs"],
    })),
    ...Array.from({ length: 8 }, (_, i) => ({
      sha: `oth${i}`,
      author_login: "collaborator",
      committer_login: "collaborator",
      date: "2024-01-02T00:00:00Z",
    })),
  ],
  candidate_prs: [
    {
      number: 1,
      title: "Add placement module",
      state: "closed",
      url: "https://github.com/deepbuilder/custom-scheduler-engine/pull/1",
    },
  ],
};

const shallowFixture: FixtureRepoPackage = {
  owner: "polished",
  name: "my-website",
  description: "Personal site",
  language: "HTML",
  stars: 0,
  readme: "# Hi",
  tree: [
    { path: "index.html", type: "blob", size: 100 },
    { path: "package.json", type: "blob", size: 50 },
  ],
  files: {
    "index.html": "<html></html>",
    "package.json": "{}",
  },
  candidate_commits: [
    {
      sha: "1",
      message: "init",
      date: "2024-01-01T00:00:00Z",
      url: "https://github.com/polished/my-website/commit/1",
    },
  ],
  candidate_prs: [],
};

describe("offline assessment integration", () => {
  it("runs fixture assessment and produces digest without network/LLM", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "tsearch-assess-"));
    cleanup.push(root);
    process.env.ASSESSMENT_RUNS_DIR = path.join(root, "runs");
    process.env.DIGESTS_DIR = path.join(root, "digests");
    process.env.ASSESSMENT_MOCK_LLM = "1";

    const candidates: Candidate[] = [
      baseCandidate({
        name: "Deep Builder",
        key: "deep builder",
        final_score: 2.0,
        github: {
          username: "deepbuilder",
          display_name: "Deep Builder",
          profile_url: "https://github.com/deepbuilder",
          bio: null,
          blog: null,
          twitter_username: null,
          company: null,
          location: null,
          email: null,
          social_accounts: [],
          context_score: 5,
          context_signals: ["blog"],
          repos: [
            {
              name: "custom-scheduler-engine",
              topics: ["systems"],
              language: "Rust",
              stars: 3,
              pushed_at: new Date().toISOString(),
            },
          ],
          contributors: [],
          stars: [],
          forks: [],
          followers: [],
          following: [],
          recent_commits: 20,
          active: true,
        },
      }),
      baseCandidate({
        name: "Polished Profile",
        key: "polished profile",
        final_score: 1.8,
        github: {
          username: "polished",
          display_name: "Polished",
          profile_url: "https://github.com/polished",
          bio: "Passionate engineer",
          blog: null,
          twitter_username: null,
          company: null,
          location: null,
          email: null,
          social_accounts: [],
          context_score: 2,
          context_signals: [],
          repos: [
            {
              name: "my-website",
              topics: [],
              language: "HTML",
              stars: 0,
              pushed_at: new Date().toISOString(),
            },
          ],
          contributors: [],
          stars: [],
          forks: [],
          followers: [],
          following: [],
          recent_commits: 1,
          active: false,
        },
      }),
      baseCandidate({
        name: "No Github",
        key: "no github",
        final_score: 1.0,
      }),
    ];

    const inputPath = path.join(root, "candidates.json");
    fs.writeFileSync(inputPath, JSON.stringify(candidates, null, 2));

    const { runId } = await runAssessment({
      inputPath,
      limit: 10,
      mockLlm: true,
      fixtureReposByUser: {
        deepbuilder: [deepFixture],
        polished: [shallowFixture],
      },
    });

    const runDir = assessmentRunDir(runId);
    expect(fs.existsSync(path.join(runDir, "run.json"))).toBe(true);
    expect(fs.existsSync(path.join(runDir, "digest.md"))).toBe(true);
    expect(fs.existsSync(path.join(runDir, "digest.html"))).toBe(true);

    const digest = JSON.parse(
      fs.readFileSync(path.join(runDir, "digest.json"), "utf-8")
    );
    expect(digest.candidates.length).toBeGreaterThan(0);
    expect(digest.candidates[0].assessment_priority_score).toBeGreaterThanOrEqual(
      0
    );
    // discovery score remains separate field
    expect(digest.candidates[0]).toHaveProperty("discovery_score");
    expect(JSON.stringify(digest)).not.toMatch(/@gmail\.com|mailto:/i);

    // Sample chain presence: evidence → dimension → digest
    const assessments = fs.readdirSync(path.join(runDir, "assessments"));
    expect(assessments.length).toBeGreaterThan(0);
    const deep = JSON.parse(
      fs.readFileSync(
        path.join(
          runDir,
          "assessments",
          assessments.find((f) =>
            JSON.parse(
              fs.readFileSync(path.join(runDir, "assessments", f), "utf-8")
            ).source_candidate.name.includes("Deep")
          )!
        ),
        "utf-8"
      )
    );
    expect(deep.artifacts.evidence.length).toBeGreaterThan(0);
    expect(deep.judge_results.technical.schema_version).toBe(
      "technical-judge-v2"
    );
    expect(deep.judge_results.technical.dimensions.length).toBeGreaterThan(0);
    expect(deep.synthesis.priority_score).toBeGreaterThan(
      JSON.parse(
        fs.readFileSync(
          path.join(
            runDir,
            "assessments",
            assessments.find((f) =>
              JSON.parse(
                fs.readFileSync(path.join(runDir, "assessments", f), "utf-8")
              ).source_candidate.name.includes("Polished")
            )!
          ),
          "utf-8"
        )
      ).synthesis.priority_score
    );
  });
});
