import { describe, it, expect, beforeAll } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import type { GithubUserDetail } from "../../src/pipeline/footprintSweep.js";

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "tsearch-sweep-"));
process.env.SEED_QUEUE_PATH = path.join(tmpDir, "seed-queue.json");
process.env.PEOPLE_DIR = path.join(tmpDir, "people");
process.env.CONVERGENCE_PATH = path.join(tmpDir, "convergence.json");

type Sweep = typeof import("../../src/pipeline/footprintSweep.js");
let sweep: Sweep;

beforeAll(async () => {
  sweep = await import("../../src/pipeline/footprintSweep.js");
});

const seed = { name: "Warren Bei", countries: ["Canada"], years: [2023, 2024] };

const gh = (over: Partial<GithubUserDetail>): GithubUserDetail => ({
  login: "warrenbei",
  name: "Warren Bei",
  bio: null,
  location: null,
  blog: null,
  created_at: "2022-05-01T00:00:00Z",
  public_repos: 1,
  followers: 2,
  ...over,
});

describe("nameMatchConfidence", () => {
  it("full display-name match is 1.0; unrelated login is noise", () => {
    expect(sweep.nameMatchConfidence("Warren Bei", "wb123", "Warren Bei")).toBe(1);
    expect(
      sweep.nameMatchConfidence("Warren Bei", "totallydifferent", null)
    ).toBeLessThan(0.45);
  });

  it("first+last in login scores 0.75", () => {
    expect(sweep.nameMatchConfidence("Warren Bei", "warren-bei-dev", null)).toBe(
      0.75
    );
  });
});

describe("scoreFootprint", () => {
  it("returns zero for no candidate or weak name match", () => {
    expect(sweep.scoreFootprint(seed, null).score).toBe(0);
    const weak = sweep.scoreFootprint(seed, gh({ login: "xyz", name: "Someone Else" }));
    expect(weak.score).toBe(0);
    expect(weak.github_login_guess).toBeUndefined();
  });

  it("stacks signals: bio hint, country, website, repos", () => {
    const rich = sweep.scoreFootprint(
      seed,
      gh({
        bio: "IMO 2024 gold · systems tinkerer",
        location: "Vancouver, Canada",
        blog: "https://warren.dev",
        public_repos: 12,
        followers: 40,
      })
    );
    expect(rich.score).toBeGreaterThan(0.9);
    expect(rich.signals).toEqual(
      expect.arrayContaining([
        "olympiad-hint-in-bio",
        "country-match",
        "has-website",
        "repos>3",
        "followers>10",
        "account-age-plausible",
      ])
    );
    const bare = sweep.scoreFootprint(seed, gh({}));
    expect(rich.score).toBeGreaterThan(bare.score);
  });

  it("never exceeds 1.0", () => {
    const maxed = sweep.scoreFootprint(
      seed,
      gh({
        bio: "IMO olympiad codeforces",
        location: "Canada",
        blog: "https://x.dev",
        public_repos: 99,
        followers: 999,
      })
    );
    expect(maxed.score).toBeLessThanOrEqual(1);
  });
});

describe("seed queue", () => {
  it("ranks qualified, unresolved people and round-trips through the store", async () => {
    const { upsertPerson } = await import("../../src/storage/personStore.js");
    upsertPerson({
      name: "Queue High",
      footprint: {
        score: 0.8,
        github_login_guess: "qh",
        github_confidence: 0.9,
        signals: ["name-match:0.90"],
        checked_at: new Date().toISOString(),
      },
    });
    upsertPerson({
      name: "Queue Low",
      footprint: {
        score: 0.1,
        github_confidence: 0.2,
        signals: [],
        checked_at: new Date().toISOString(),
      },
    });
    upsertPerson({
      name: "Queue Resolved",
      identity: { status: "resolved", confidence: 0.9 },
      footprint: {
        score: 0.9,
        github_confidence: 0.9,
        signals: [],
        checked_at: new Date().toISOString(),
      },
    });

    const queue = sweep.refreshSeedQueue();
    expect(queue.map((q) => q.name)).toEqual(["Queue High"]);
    expect(sweep.loadSeedQueue().map((q) => q.name)).toEqual(["Queue High"]);
  });
});
