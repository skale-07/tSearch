import { describe, expect, it } from "vitest";
import {
  collectOwnershipEvidence,
  ownershipV2ToLegacy,
} from "../../src/assessment/github/collectOwnershipEvidence.js";
import { commitMatchesCanonicalLogin } from "../../src/assessment/github/matchCommitLogin.js";
import { collectRepositoryFromFixture } from "../../src/assessment/github/collectRepositoryArtifact.js";

describe("ownership evidence v2", () => {
  it("uses same-sample share not author-filtered / total confusion", () => {
    const result = collectOwnershipEvidence({
      artifact_id: "art_1",
      repo_url: "https://github.com/jane/engine",
      repo_owner: "jane",
      candidate_username: "jane",
      identity_support: "exact",
      is_fork: false,
      repository_commit_count_sampled: 20,
      candidate_commits_in_repository_sample: 2,
      candidate_commit_share: 0.1,
      candidate_commit_count: 50,
      candidate_pr_count: 1,
      candidate_core_file_paths: ["src/scheduler.ts"],
      selected_central_paths: ["src/scheduler.ts"],
    });
    expect(result.ownership.contribution_metrics.candidate_commit_share).toBe(0.1);
    expect(result.ownership.direct_core_contribution_present).toBe(true);
    expect(result.ownership.support_class).toBe("high_ownership_support");
  });

  it("does not treat selected central files alone as authorship", () => {
    const result = collectOwnershipEvidence({
      artifact_id: "art_2",
      repo_url: "https://github.com/jane/engine",
      repo_owner: "jane",
      candidate_username: "jane",
      identity_support: "exact",
      is_fork: false,
      repository_commit_count_sampled: 20,
      candidate_commits_in_repository_sample: 5,
      candidate_commit_share: 0.25,
      candidate_commit_count: 5,
      candidate_pr_count: 0,
      candidate_core_file_paths: [],
      selected_central_paths: ["src/scheduler.ts", "src/core.ts"],
    });
    expect(result.ownership.direct_core_contribution_present).toBe(false);
    expect(result.ownership.support_class).not.toBe("high_ownership_support");
  });

  it("owner scaffold without core contribution cannot be high", () => {
    const result = collectOwnershipEvidence({
      artifact_id: "art_3",
      repo_url: "https://github.com/jane/my-website",
      repo_owner: "jane",
      candidate_username: "jane",
      identity_support: "exact",
      is_fork: false,
      is_course_or_tutorial: true,
      repository_commit_count_sampled: 5,
      candidate_commits_in_repository_sample: 5,
      candidate_commit_share: 1,
      candidate_commit_count: 5,
      candidate_pr_count: 0,
      candidate_core_file_paths: [],
      selected_central_paths: ["index.html"],
    });
    expect(result.ownership.support_class).not.toBe("high_ownership_support");
    const legacy = ownershipV2ToLegacy(result.ownership);
    expect(legacy.score).toBeLessThan(8);
  });

  it("omits share when not provided", () => {
    const result = collectOwnershipEvidence({
      artifact_id: "art_4",
      repo_url: "https://github.com/jane/engine",
      repo_owner: "jane",
      candidate_username: "jane",
      identity_support: "exact",
      is_fork: false,
      repository_commit_count_sampled: 10,
      candidate_commits_in_repository_sample: 1,
      candidate_commit_count: 1,
      candidate_pr_count: 0,
      candidate_core_file_paths: [],
      selected_central_paths: ["src/a.ts"],
    });
    expect(
      result.ownership.contribution_metrics.candidate_commit_share
    ).toBeUndefined();
  });
});

describe("Phase-A commit identity matching", () => {
  it("matches author login exact only", () => {
    expect(
      commitMatchesCanonicalLogin(
        { author: { login: "Jane" }, committer: { login: "bot" } },
        "jane"
      )
    ).toBe(true);
  });

  it("does not match name-only or missing login", () => {
    expect(
      commitMatchesCanonicalLogin(
        { author: { login: null, name: "Jane" }, committer: { login: null } },
        "jane"
      )
    ).toBe(false);
  });

  it("rejects committer match when different author login present", () => {
    expect(
      commitMatchesCanonicalLogin(
        { author: { login: "other" }, committer: { login: "jane" } },
        "jane"
      )
    ).toBe(false);
  });
});

describe("fixture collector share", () => {
  it("does not inflate share to 1.0 when sample has other authors", () => {
    const result = collectRepositoryFromFixture(
      {
        owner: "jane",
        name: "engine",
        language: "Rust",
        tree: [
          { path: "src/scheduler.rs", type: "blob", size: 4000 },
          { path: "Cargo.toml", type: "blob", size: 100 },
        ],
        files: {
          "src/scheduler.rs": "pub fn place() {}",
          "Cargo.toml": "[package]",
        },
        repository_commit_sample: [
          ...Array.from({ length: 2 }, (_, i) => ({
            sha: `c${i}`,
            author_login: "jane",
            committer_login: "jane",
            date: "2024-01-01",
            files_changed: ["src/scheduler.rs"],
          })),
          ...Array.from({ length: 18 }, (_, i) => ({
            sha: `o${i}`,
            author_login: "other",
            committer_login: "other",
            date: "2024-01-02",
          })),
        ],
        candidate_commits: [
          {
            sha: "c0",
            message: "work",
            date: "2024-01-01",
            url: "u",
          },
          {
            sha: "c1",
            message: "work2",
            date: "2024-01-01",
            url: "u",
          },
        ],
        candidate_commit_files: {
          c0: ["src/scheduler.rs"],
          c1: ["src/scheduler.rs"],
        },
      },
      "jane",
      "technical_naming"
    );
    expect(
      result.detail.ownership.contribution_metrics.candidate_commit_share
    ).toBeCloseTo(0.1, 5);
    expect(result.detail.ownership.direct_core_contribution_present).toBe(true);
  });

  it("omits share entirely when no unfiltered repository sample exists", () => {
    // Regression for the triage High finding: a candidate-only commit list
    // must never become the share denominator (share ≡ 1.0 → false
    // primary_creator). Missing sample → share omitted, sample count 0.
    // Non-owner candidate: without the fix, the synthesized candidate-only
    // sample yielded share 1.0 AND candidate_commits_in_repository_sample=12,
    // which satisfied the >=3 gate into high_ownership_support.
    const result = collectRepositoryFromFixture(
      {
        owner: "some-org",
        name: "engine",
        language: "Rust",
        tree: [{ path: "src/scheduler.rs", type: "blob", size: 4000 }],
        files: { "src/scheduler.rs": "pub fn place() {}" },
        candidate_commits: Array.from({ length: 12 }, (_, i) => ({
          sha: `c${i}`,
          message: "work",
          date: "2024-01-01",
          url: "u",
        })),
        candidate_commit_files: { c0: ["src/scheduler.rs"] },
      },
      "jane",
      "technical_naming"
    );
    const metrics = result.detail.ownership.contribution_metrics;
    expect(metrics.candidate_commit_share).toBeUndefined();
    expect(metrics.candidate_commits_in_repository_sample).toBe(0);
    expect(result.detail.ownership.support_class).not.toBe(
      "high_ownership_support"
    );
  });
});
