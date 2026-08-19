import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { runAssessment } from "../../src/assessment/runAssessment.js";
import {
  assessmentRunDir,
  loadAssessmentRun,
} from "../../src/assessment/storage/assessmentRunStore.js";
import type { FixtureRepoPackage } from "../../src/assessment/github/collectRepositoryArtifact.js";
import type { Candidate } from "../../src/types.js";
import type { BlogFixture } from "../../src/assessment/blog/types.js";
import { loadRubricBundle } from "../../src/assessment/rubrics/loadRubricBundle.js";
import {
  rubricBundleVersionLabel,
  rubricCacheIdentity,
  sortKeys,
} from "../../src/assessment/rubrics/rubricCacheIdentity.js";
import { MockLlmJudgeClient } from "../../src/assessment/judges/llmClient.js";
import * as technicalJudgeV2 from "../../src/assessment/judges/technicalJudgeV2.js";
import * as blogCollector from "../../src/assessment/blog/collectBlogArtifacts.js";

const cleanup: string[] = [];

afterEach(() => {
  for (const p of cleanup) {
    if (fs.existsSync(p)) fs.rmSync(p, { recursive: true, force: true });
  }
  cleanup.length = 0;
  vi.restoreAllMocks();
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
  readme:
    "# Scheduler\nSee writeup https://example.com/blog/scheduler-deep-dive\n",
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

const linkedBlogFixture: BlogFixture = {
  website_url: "https://example.com/",
  candidate_id: "cand_test_deepbuilder",
  canonical_domain: "example.com",
  article_urls: ["https://example.com/blog/scheduler-deep-dive"],
  pages: [
    {
      url: "https://example.com/",
      html: "<html><body><a href='/blog/scheduler-deep-dive'>post</a></body></html>",
    },
    {
      url: "https://example.com/blog/scheduler-deep-dive",
      html: `<html><body>
        <h1>Scheduler Deep Dive</h1>
        <article>
          <p>We built a custom scheduler. Source:
          https://github.com/deepbuilder/custom-scheduler-engine</p>
          <p>Mechanism and evaluation details follow. The placement loop
          keeps a ready queue, scores each pending job against current
          cluster capacity, and commits the assignment only after a
          two-phase check against fragmentation. That is the whole
          design: inspectable control flow, no hidden heuristic soup,
          and a writeup long enough to judge as real technical writing
          rather than a landing-page stub.</p>
        </article>
      </body></html>`,
    },
  ],
};

function ghCandidate(
  name: string,
  username: string,
  repo: string,
  extras?: Partial<Candidate>
): Candidate {
  return baseCandidate({
    name,
    key: name.toLowerCase(),
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
      context_score: 3,
      context_signals: [],
      repos: [
        {
          name: repo,
          topics: [],
          language: "Rust",
          stars: 1,
          pushed_at: new Date().toISOString(),
        },
      ],
      contributors: ["outsider"],
      stars: [],
      forks: [],
      followers: [],
      following: [],
      recent_commits: 5,
      active: true,
    },
    ...extras,
  });
}

function setupDirs(): { root: string; inputPath: string } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "tsearch-wire-"));
  cleanup.push(root);
  process.env.ASSESSMENT_RUNS_DIR = path.join(root, "runs");
  process.env.DIGESTS_DIR = path.join(root, "digests");
  process.env.ASSESSMENT_MOCK_LLM = "1";
  return { root, inputPath: path.join(root, "candidates.json") };
}

describe("orchestrator agent wiring", () => {
  it("invokes technical judge v2 and persists technical-judge-v2 as primary", async () => {
    const spy = vi.spyOn(technicalJudgeV2, "deterministicTechnicalJudgeV2");
    const { inputPath } = setupDirs();
    const candidates = [
      ghCandidate("Deep Builder", "deepbuilder", "custom-scheduler-engine"),
    ];
    fs.writeFileSync(inputPath, JSON.stringify(candidates));

    const { runId } = await runAssessment({
      inputPath,
      limit: 1,
      mockLlm: true,
      fixtureReposByUser: { deepbuilder: [deepFixture] },
      skipDigest: true,
    });

    expect(spy).toHaveBeenCalled();
    const rec = JSON.parse(
      fs.readFileSync(
        path.join(
          assessmentRunDir(runId),
          "assessments",
          fs.readdirSync(path.join(assessmentRunDir(runId), "assessments"))[0]!
        ),
        "utf-8"
      )
    );
    expect(rec.judge_results.technical.schema_version).toBe(
      "technical-judge-v2"
    );
    expect(rec.judge_results.technical.judge_type).toBe("technical");
  });

  it("mock mode uses deterministic technical-v2 (not LLM v2)", async () => {
    const det = vi.spyOn(technicalJudgeV2, "deterministicTechnicalJudgeV2");
    const llm = vi.spyOn(technicalJudgeV2, "runTechnicalJudgeV2");
    const { inputPath } = setupDirs();
    fs.writeFileSync(
      inputPath,
      JSON.stringify([
        ghCandidate("Deep Builder", "deepbuilder", "custom-scheduler-engine"),
      ])
    );

    await runAssessment({
      inputPath,
      limit: 1,
      mockLlm: true,
      fixtureReposByUser: { deepbuilder: [deepFixture] },
      skipDigest: true,
    });

    expect(det).toHaveBeenCalled();
    expect(llm).not.toHaveBeenCalled();
  });

  it("candidate website invokes collectBlogArtifacts and writing judge", async () => {
    const blogSpy = vi.spyOn(blogCollector, "collectBlogArtifactsFromFixture");
    const { inputPath } = setupDirs();
    const candidates = [
      ghCandidate("Deep Builder", "deepbuilder", "custom-scheduler-engine", {
        linkedin: {
          url: "https://www.linkedin.com/in/deep/",
          name: "Deep Builder",
          photo_url: null,
          headline: null,
          college: null,
          school: null,
          degree: null,
          country: null,
          graduation_year: null,
          education: [],
          keywords: [],
          personal_website: "https://example.com/",
          website_url: "https://example.com/",
          github_url: null,
          substack_url: null,
          twitter_url: null,
          contact_links: ["https://example.com/"],
          experience: [],
          awards: [],
          skills: [],
        },
      }),
    ];
    fs.writeFileSync(inputPath, JSON.stringify(candidates));

    const { runId } = await runAssessment({
      inputPath,
      limit: 1,
      mockLlm: true,
      fixtureReposByUser: { deepbuilder: [deepFixture] },
      blogFixtureByKey: { deepbuilder: linkedBlogFixture },
      skipDigest: true,
    });

    expect(blogSpy).toHaveBeenCalled();
    const rec = JSON.parse(
      fs.readFileSync(
        path.join(
          assessmentRunDir(runId),
          "assessments",
          fs.readdirSync(path.join(assessmentRunDir(runId), "assessments"))[0]!
        ),
        "utf-8"
      )
    );
    expect(rec.judge_results.writing).toBeTruthy();
    expect(rec.judge_results.writing.schema_version).toBe("writing-judge-v1");
    expect(Object.keys(rec.artifacts.blog_articles ?? {}).length).toBeGreaterThan(
      0
    );
  });

  it("missing blog evidence leaves writing unavailable, not zero", async () => {
    const { inputPath } = setupDirs();
    fs.writeFileSync(
      inputPath,
      JSON.stringify([
        ghCandidate("Deep Builder", "deepbuilder", "custom-scheduler-engine"),
      ])
    );

    const { runId } = await runAssessment({
      inputPath,
      limit: 1,
      mockLlm: true,
      fixtureReposByUser: { deepbuilder: [deepFixture] },
      skipDigest: true,
    });

    const rec = JSON.parse(
      fs.readFileSync(
        path.join(
          assessmentRunDir(runId),
          "assessments",
          fs.readdirSync(path.join(assessmentRunDir(runId), "assessments"))[0]!
        ),
        "utf-8"
      )
    );
    expect(rec.judge_results.writing).toBeUndefined();
    expect(rec.synthesis.axes.writing_intellectual_depth.available).toBe(false);
    expect(rec.synthesis.axes.writing_intellectual_depth.score).toBeNull();
  });

  it("generates deterministic relationships and runs cross-artifact only with links", async () => {
    const { inputPath } = setupDirs();
    const candidates = [
      ghCandidate("Deep Builder", "deepbuilder", "custom-scheduler-engine", {
        linkedin: {
          url: "https://www.linkedin.com/in/deep/",
          name: "Deep Builder",
          photo_url: null,
          headline: null,
          college: null,
          school: null,
          degree: null,
          country: null,
          graduation_year: null,
          education: [],
          keywords: [],
          personal_website: "https://example.com/",
          website_url: "https://example.com/",
          github_url: null,
          substack_url: null,
          twitter_url: null,
          contact_links: ["https://example.com/"],
          experience: [],
          awards: [],
          skills: [],
        },
      }),
    ];
    fs.writeFileSync(inputPath, JSON.stringify(candidates));

    const { runId } = await runAssessment({
      inputPath,
      limit: 1,
      mockLlm: true,
      fixtureReposByUser: { deepbuilder: [deepFixture] },
      blogFixtureByKey: { deepbuilder: linkedBlogFixture },
      skipDigest: true,
    });

    const rec = JSON.parse(
      fs.readFileSync(
        path.join(
          assessmentRunDir(runId),
          "assessments",
          fs.readdirSync(path.join(assessmentRunDir(runId), "assessments"))[0]!
        ),
        "utf-8"
      )
    );
    expect((rec.relationships ?? []).length).toBeGreaterThan(0);
    expect(rec.relationships.every((r: { deterministic: boolean }) => r.deterministic)).toBe(
      true
    );
    expect(rec.judge_results.cross_artifact).toBeTruthy();
    expect(rec.judge_results.cross_artifact.schema_version).toBe(
      "cross-artifact-judge-v1"
    );
  });

  it("does not run cross-artifact without relationships", async () => {
    const { inputPath } = setupDirs();
    fs.writeFileSync(
      inputPath,
      JSON.stringify([
        ghCandidate("Deep Builder", "deepbuilder", "custom-scheduler-engine"),
      ])
    );

    const { runId } = await runAssessment({
      inputPath,
      limit: 1,
      mockLlm: true,
      fixtureReposByUser: { deepbuilder: [deepFixture] },
      skipDigest: true,
    });

    const rec = JSON.parse(
      fs.readFileSync(
        path.join(
          assessmentRunDir(runId),
          "assessments",
          fs.readdirSync(path.join(assessmentRunDir(runId), "assessments"))[0]!
        ),
        "utf-8"
      )
    );
    expect(rec.judge_results.cross_artifact).toBeUndefined();
    expect(rec.synthesis.axes.cross_artifact_coherence.available).toBe(false);
  });

  it("passes Cory into synthesis when substantive evidence exists", async () => {
    const { inputPath } = setupDirs();
    fs.writeFileSync(
      inputPath,
      JSON.stringify([
        ghCandidate("Deep Builder", "deepbuilder", "custom-scheduler-engine"),
      ])
    );

    const { runId } = await runAssessment({
      inputPath,
      limit: 1,
      mockLlm: true,
      fixtureReposByUser: { deepbuilder: [deepFixture] },
      skipDigest: true,
    });

    const rec = JSON.parse(
      fs.readFileSync(
        path.join(
          assessmentRunDir(runId),
          "assessments",
          fs.readdirSync(path.join(assessmentRunDir(runId), "assessments"))[0]!
        ),
        "utf-8"
      )
    );
    expect(rec.judge_results.cory).toBeTruthy();
    expect(rec.judge_results.cory.relevance).not.toBeUndefined();
    expect(rec.synthesis.axes.cory_relevance).toBeTruthy();
  });

  it("abstains Cory without LLM when no substantive tech/writing", async () => {
    const { inputPath } = setupDirs();
    fs.writeFileSync(
      inputPath,
      JSON.stringify([
        baseCandidate({
          name: "Sparse Person",
          key: "sparse person",
          final_score: 0.1,
        }),
      ])
    );

    const client = new MockLlmJudgeClient(() => {
      throw new Error("Cory LLM must not be called for sparse candidates");
    });

    const { runId } = await runAssessment({
      inputPath,
      limit: 1,
      mockLlm: false,
      llmClient: client,
      skipDigest: true,
    });

    const rec = JSON.parse(
      fs.readFileSync(
        path.join(
          assessmentRunDir(runId),
          "assessments",
          fs.readdirSync(path.join(assessmentRunDir(runId), "assessments"))[0]!
        ),
        "utf-8"
      )
    );
    expect(rec.error).toBeUndefined();
    expect(rec.judge_results.cory.relevance).toBe("insufficient_evidence");
    expect(rec.synthesis.archetype).toBe("insufficient_evidence");
  });

  it("loads rubric YAML at startup and stores non-legacy bundle version", async () => {
    const { inputPath } = setupDirs();
    fs.writeFileSync(
      inputPath,
      JSON.stringify([
        ghCandidate("Deep Builder", "deepbuilder", "custom-scheduler-engine"),
      ])
    );

    const { runId } = await runAssessment({
      inputPath,
      limit: 1,
      mockLlm: true,
      fixtureReposByUser: { deepbuilder: [deepFixture] },
      skipDigest: true,
    });

    const run = loadAssessmentRun(runId)!;
    expect(run.config.rubric_bundle_version).toBeTruthy();
    expect(run.config.rubric_bundle_version).not.toBe("legacy-phase2");
    expect(run.config.rubric_bundle_version).toMatch(/^\d+\.\d+\.\d+:/);
  });

  it("canonical rubric hash is stable under key reorder; identity changes with hash", () => {
    const bundle = loadRubricBundle();
    const a = rubricCacheIdentity(bundle);
    const reordered = {
      ...bundle,
      file_hashes: Object.fromEntries(
        Object.entries(bundle.file_hashes).reverse()
      ),
    };
    expect(rubricCacheIdentity(reordered)).toBe(a);
    expect(sortKeys({ b: "2", a: "1" })).toEqual({ a: "1", b: "2" });

    const mutated = {
      ...bundle,
      file_hashes: { ...bundle.file_hashes, "fake.yaml": "deadbeef" },
    };
    expect(rubricCacheIdentity(mutated)).not.toBe(a);
    expect(rubricBundleVersionLabel(mutated)).not.toBe(
      rubricBundleVersionLabel(bundle)
    );
  });

  it("changing rubricBundleVersion causes judge cache miss", async () => {
    const { z } = await import("zod");
    const schema = z.object({ summary: z.string(), score: z.number() });
    let calls = 0;
    const ns = `test-orch-rubric-${Date.now()}`;
    const client = new MockLlmJudgeClient(() => {
      calls++;
      return { summary: "ok", score: calls };
    });
    await client.generateStructured({
      systemPrompt: "p",
      userPayload: { a: 1 },
      outputSchema: schema,
      cacheNamespace: ns,
      rubricBundleVersion: "1.0.0:aaa",
    });
    await client.generateStructured({
      systemPrompt: "p",
      userPayload: { a: 1 },
      outputSchema: schema,
      cacheNamespace: ns,
      rubricBundleVersion: "1.0.0:bbb",
    });
    expect(calls).toBe(2);
  });

  it("never adds contributors as candidates; freezes candidate_ids", async () => {
    const { inputPath } = setupDirs();
    const candidates = [
      ghCandidate("Deep Builder", "deepbuilder", "custom-scheduler-engine"),
    ];
    fs.writeFileSync(inputPath, JSON.stringify(candidates));

    const { runId } = await runAssessment({
      inputPath,
      limit: 1,
      mockLlm: true,
      fixtureReposByUser: { deepbuilder: [deepFixture] },
      skipDigest: true,
    });

    const run = loadAssessmentRun(runId)!;
    expect(run.candidate_ids.length).toBe(1);
    const assessments = fs.readdirSync(
      path.join(assessmentRunDir(runId), "assessments")
    );
    expect(assessments.length).toBe(1);
    const snap = JSON.parse(
      fs.readFileSync(
        path.join(assessmentRunDir(runId), "source-candidates.json"),
        "utf-8"
      )
    );
    expect(Array.isArray(snap)).toBe(true);
    expect(snap.every((c: Candidate) => c.name !== "outsider")).toBe(true);
  });

  it("GitHub-only candidates complete successfully", async () => {
    const { inputPath } = setupDirs();
    fs.writeFileSync(
      inputPath,
      JSON.stringify([
        ghCandidate("Deep Builder", "deepbuilder", "custom-scheduler-engine"),
      ])
    );

    const { runId } = await runAssessment({
      inputPath,
      limit: 1,
      mockLlm: true,
      fixtureReposByUser: { deepbuilder: [deepFixture] },
      skipDigest: true,
    });

    const rec = JSON.parse(
      fs.readFileSync(
        path.join(
          assessmentRunDir(runId),
          "assessments",
          fs.readdirSync(path.join(assessmentRunDir(runId), "assessments"))[0]!
        ),
        "utf-8"
      )
    );
    expect(rec.error).toBeUndefined();
    expect(rec.judge_results.technical.schema_version).toBe(
      "technical-judge-v2"
    );
  });

  it("writing-only with blog fixture completes without GitHub", async () => {
    const { inputPath } = setupDirs();
    const candidate = baseCandidate({
      name: "Writer Only",
      key: "writer only",
      final_score: 1.2,
      linkedin: {
        url: "https://www.linkedin.com/in/writeronlyxyz/",
        name: "Writer Only",
        photo_url: null,
        headline: null,
        college: null,
        school: null,
        degree: null,
        country: null,
        graduation_year: null,
        education: [],
        keywords: [],
        personal_website: "https://example.com/",
        website_url: "https://example.com/",
        github_url: null,
        substack_url: null,
        twitter_url: null,
        contact_links: ["https://example.com/"],
        experience: [],
        awards: [],
        skills: [],
      },
    });
    fs.writeFileSync(inputPath, JSON.stringify([candidate]));

    // Precompute candidate_id via a dry run selection helper
    const { identityFromCandidate } = await import(
      "../../src/assessment/candidateIdentity.js"
    );
    const id = identityFromCandidate(candidate).candidate_id;

    const { runId } = await runAssessment({
      inputPath,
      limit: 1,
      mockLlm: true,
      blogFixtureByKey: { [id]: linkedBlogFixture },
      skipDigest: true,
    });

    const rec = JSON.parse(
      fs.readFileSync(
        path.join(
          assessmentRunDir(runId),
          "assessments",
          fs.readdirSync(path.join(assessmentRunDir(runId), "assessments"))[0]!
        ),
        "utf-8"
      )
    );
    expect(rec.error).toBeUndefined();
    expect(rec.identity.github_username).toBeUndefined();
    expect(rec.judge_results.writing).toBeTruthy();
    expect(rec.judge_results.technical).toBeUndefined();
  });

  it("uses input snapshot without discovery; sparse candidate continues", async () => {
    const { inputPath } = setupDirs();
    const candidates = [
      ghCandidate("Deep Builder", "deepbuilder", "custom-scheduler-engine"),
      baseCandidate({ name: "No Sources", key: "no sources", final_score: 0.2 }),
    ];
    fs.writeFileSync(inputPath, JSON.stringify(candidates));

    const { runId } = await runAssessment({
      inputPath,
      limit: 10,
      mockLlm: true,
      fixtureReposByUser: { deepbuilder: [deepFixture] },
      skipDigest: true,
    });

    const run = loadAssessmentRun(runId)!;
    expect(run.candidate_ids.length).toBe(2);
    expect(run.source.source_candidates_hash).toBeTruthy();
    const snap = JSON.parse(
      fs.readFileSync(
        path.join(assessmentRunDir(runId), "source-candidates.json"),
        "utf-8"
      )
    );
    expect(snap.length).toBe(2);

    const assessments = fs
      .readdirSync(path.join(assessmentRunDir(runId), "assessments"))
      .map((f) =>
        JSON.parse(
          fs.readFileSync(
            path.join(assessmentRunDir(runId), "assessments", f),
            "utf-8"
          )
        )
      );
    expect(assessments.length).toBe(2);
    const sparse = assessments.find(
      (a) => a.source_candidate.name === "No Sources"
    );
    expect(sparse.error).toBeUndefined();
    expect(sparse.synthesis.archetype).toBe("insufficient_evidence");
    const deep = assessments.find((a) =>
      a.source_candidate.name.includes("Deep")
    );
    expect(deep.judge_results.technical.schema_version).toBe(
      "technical-judge-v2"
    );
  });
});
