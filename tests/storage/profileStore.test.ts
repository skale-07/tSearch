import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Candidate, GitHubProfile } from "../../src/types.js";

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "tsearch-profilestore-"));

beforeEach(() => {
  vi.resetModules();
  process.env.PROFILES_DIR = tmpDir;
  for (const name of fs.readdirSync(tmpDir)) {
    fs.rmSync(path.join(tmpDir, name), { recursive: true, force: true });
  }
});

afterEach(() => {
  delete process.env.PROFILES_DIR;
});

function gh(username: string, context_score: number): GitHubProfile {
  return {
    username,
    display_name: username,
    profile_url: `https://github.com/${username}`,
    bio: null,
    blog: null,
    twitter_username: null,
    company: null,
    location: null,
    email: null,
    social_accounts: [],
    context_score,
    context_signals: context_score ? ["blog"] : [],
    repos: [],
    contributors: [],
    stars: [],
    forks: [],
    followers: [],
    following: [],
    recent_commits: 0,
    active: true,
  };
}

function cand(name: string, github?: GitHubProfile): Candidate {
  return {
    name,
    key: name.toLowerCase(),
    discovered_via: [`github-collaborator:${name}`],
    identity_confidence: 0,
    github,
    final_score: 0,
    score_breakdown: {
      builder: 0,
      thinker: 0,
      olympiad: 0,
      weirdness: 0,
      identity: 0,
    },
  };
}

describe("writeSeedTreeProfiles", () => {
  it("hydrates a neighbor from the merge even when they would miss the top-N cut", async () => {
    const { writeSeedTreeProfiles } = await import(
      "../../src/storage/profileStore.js"
    );
    writeSeedTreeProfiles(
      [
        cand("Seed Person", gh("seedlogin", 12)),
        cand("Low Rank Neighbor", gh("thin-collab", 2)),
      ],
      {
        seeds: [
          {
            name: "Seed Person",
            github: "https://github.com/seedlogin",
          },
        ],
        edges: [
          {
            from: "Seed Person",
            from_github: "seedlogin",
            to_github: "thin-collab",
            via: "github-collaborator",
            hop: 1,
            context_score: 2,
            context_signals: ["twitter"],
          },
        ],
      }
    );

    const file = path.join(
      tmpDir,
      "seedlogin",
      "collaborators",
      "thin-collab",
      "profile.json"
    );
    const rec = JSON.parse(fs.readFileSync(file, "utf-8"));
    expect(rec.github.username).toBe("thin-collab");
    expect(rec.context_score).toBe(2);
  });

  it("stamps edge context onto a stub when the neighbor is missing from candidates", async () => {
    const { writeSeedTreeProfiles } = await import(
      "../../src/storage/profileStore.js"
    );
    writeSeedTreeProfiles(
      [cand("Seed Person", gh("seedlogin", 12))],
      {
        seeds: [
          {
            name: "Seed Person",
            github: "https://github.com/seedlogin",
          },
        ],
        edges: [
          {
            from: "Seed Person",
            from_github: "seedlogin",
            to_github: "felicityblueish",
            via: "github-follower",
            hop: 1,
            context_score: 6,
            context_signals: ["blog", "bio"],
          },
        ],
      }
    );

    const file = path.join(
      tmpDir,
      "seedlogin",
      "followers",
      "felicityblueish",
      "profile.json"
    );
    const rec = JSON.parse(fs.readFileSync(file, "utf-8"));
    expect(rec.github).toBeUndefined();
    expect(rec.context_score).toBe(6);
    expect(rec.context_signals).toEqual(["blog", "bio"]);
  });
});
