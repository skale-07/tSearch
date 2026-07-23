import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it } from "vitest";
import { runAssessment } from "../../src/assessment/runAssessment.js";
import {
  assessmentRunDir,
  loadAssessmentRun,
} from "../../src/assessment/storage/assessmentRunStore.js";
import type { FixtureRepoPackage } from "../../src/assessment/github/collectRepositoryArtifact.js";
import type { Candidate } from "../../src/types.js";

const cleanup: string[] = [];

afterEach(() => {
  for (const p of cleanup) {
    if (fs.existsSync(p)) fs.rmSync(p, { recursive: true, force: true });
  }
  cleanup.length = 0;
});

function baseCandidate(
  partial: Partial<Candidate> & { name: string; key: string }
): Candidate {
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
  description: "Custom placement scheduler",
  language: "Rust",
  stars: 3,
  readme: "# Scheduler",
  tree: [
    { path: "Cargo.toml", type: "blob", size: 200 },
    { path: "src/scheduler.rs", type: "blob", size: 4000 },
  ],
  files: {
    "Cargo.toml": "[package]",
    "src/scheduler.rs": "pub fn place() {}",
  },
  repository_commit_sample: Array.from({ length: 10 }, (_, i) => ({
    sha: `s${i}`,
    author_login: i < 4 ? "deepbuilder" : "other",
    committer_login: i < 4 ? "deepbuilder" : "other",
    date: "2024-01-01",
    files_changed: i < 4 ? ["src/scheduler.rs"] : [],
  })),
  candidate_commits: Array.from({ length: 4 }, (_, i) => ({
    sha: `s${i}`,
    message: "w",
    date: "2024-01-01",
    url: "u",
  })),
  candidate_commit_files: {
    s0: ["src/scheduler.rs"],
    s1: ["src/scheduler.rs"],
    s2: ["src/scheduler.rs"],
    s3: ["src/scheduler.rs"],
  },
  candidate_prs: [],
};

function ghCandidate(name: string, username: string, repo: string): Candidate {
  return baseCandidate({
    name,
    key: name.toLowerCase(),
    final_score: 2,
    github: {
      username,
      display_name: name,
      profile_url: `https://github.com/${username}`,
      bio: null,
      blog: null,
      twitter_username: null,
      company: null,
      location: null,
      email: null,
      social_accounts: [],
      context_score: 5,
      context_signals: [],
      repos: [
        {
          name: repo,
          topics: [],
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
      recent_commits: 4,
      active: true,
    },
  });
}

describe("resume and selection wiring", () => {
  it("uses injected selection details so template/fork metadata affects live path", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "tsearch-sel-"));
    cleanup.push(root);
    process.env.ASSESSMENT_RUNS_DIR = path.join(root, "runs");
    process.env.DIGESTS_DIR = path.join(root, "digests");

    const candidates = [
      ghCandidate("Deep Builder", "deepbuilder", "custom-scheduler-engine"),
    ];
    const inputPath = path.join(root, "candidates.json");
    fs.writeFileSync(inputPath, JSON.stringify(candidates));

    const { runId } = await runAssessment({
      inputPath,
      limit: 1,
      mockLlm: true,
      fixtureReposByUser: { deepbuilder: [deepFixture] },
      selectionDetailsByUser: {
        deepbuilder: {
          "custom-scheduler-engine": {
            fork: false,
            archived: false,
            is_template: false,
            size: 400,
            language: "Rust",
            description: "custom scheduler engine",
          },
        },
      },
    });

    const assessments = fs.readdirSync(
      path.join(assessmentRunDir(runId), "assessments")
    );
    expect(assessments.length).toBe(1);
    const rec = JSON.parse(
      fs.readFileSync(
        path.join(assessmentRunDir(runId), "assessments", assessments[0]!),
        "utf-8"
      )
    );
    expect(Object.keys(rec.artifacts.github_repositories).length).toBe(1);
  });

  it("resumes incomplete run and skips completed candidates", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "tsearch-resume-"));
    cleanup.push(root);
    process.env.ASSESSMENT_RUNS_DIR = path.join(root, "runs");
    process.env.DIGESTS_DIR = path.join(root, "digests");

    const candidates = [
      ghCandidate("Deep Builder", "deepbuilder", "custom-scheduler-engine"),
    ];
    const inputPath = path.join(root, "candidates.json");
    fs.writeFileSync(inputPath, JSON.stringify(candidates));

    const { runId } = await runAssessment({
      inputPath,
      limit: 1,
      mockLlm: true,
      fixtureReposByUser: { deepbuilder: [deepFixture] },
      skipDigest: true,
    });

    // Re-open as incomplete for resume (simulating crash after candidate write)
    const runPath = path.join(assessmentRunDir(runId), "run.json");
    const runJson = JSON.parse(fs.readFileSync(runPath, "utf-8"));
    runJson.status = "judging";
    delete runJson.completed_at;
    fs.writeFileSync(runPath, JSON.stringify(runJson, null, 2));

    const before = fs.readdirSync(
      path.join(assessmentRunDir(runId), "assessments")
    );
    const mtimeBefore = fs.statSync(
      path.join(assessmentRunDir(runId), "assessments", before[0]!)
    ).mtimeMs;

    await runAssessment({
      inputPath,
      resumeRunId: runId,
      mockLlm: true,
      fixtureReposByUser: { deepbuilder: [deepFixture] },
      skipDigest: true,
    });

    const after = fs.readdirSync(
      path.join(assessmentRunDir(runId), "assessments")
    );
    expect(after).toEqual(before);
    const mtimeAfter = fs.statSync(
      path.join(assessmentRunDir(runId), "assessments", after[0]!)
    ).mtimeMs;
    expect(mtimeAfter).toBe(mtimeBefore);
    expect(loadAssessmentRun(runId)?.status).toBe("completed");
  });
});
