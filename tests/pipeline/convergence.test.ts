import { describe, it, expect, beforeAll } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import type { PersonRecord } from "../../src/storage/personStore.js";

// CONVERGENCE_PATH/PEOPLE_DIR are read from env at config import time, so no
// static imports of config-touching modules — dynamic imports only.
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "tsearch-conv-"));
process.env.CONVERGENCE_PATH = path.join(tmpDir, "convergence.json");
process.env.PEOPLE_DIR = path.join(tmpDir, "people");

type Convergence = typeof import("../../src/pipeline/convergence.js");
type Scoring = typeof import("../../src/scoring/computeScore.js");
let conv: Convergence;
let computeScore: Scoring["computeScore"];

beforeAll(async () => {
  conv = await import("../../src/pipeline/convergence.js");
  computeScore = (await import("../../src/scoring/computeScore.js"))
    .computeScore;
});

function seedPerson(
  name: string,
  graph: Partial<PersonRecord["graph"]>
): PersonRecord {
  return {
    name,
    slug: name.toLowerCase().replace(/\s+/g, "-"),
    aliases: [],
    links: {},
    identity: { status: "resolved", confidence: 0.8 },
    graph: {
      github_neighbors: [],
      github_collaborators: [],
      github_followers: [],
      substack_neighbors: [],
      discovered_via: [],
      ...graph,
    },
    score_history: [],
    freshness: {},
    first_seen: "2026-01-01T00:00:00Z",
    last_updated: "2026-01-01T00:00:00Z",
  };
}

describe("computeConvergence", () => {
  it("flags logins reachable from 2+ seeds, weighting collaborators double", () => {
    const people = [
      seedPerson("Seed One", {
        github_collaborators: ["james", "solo-one"],
      }),
      seedPerson("Seed Two", {
        github_followers: ["James"],
        github_collaborators: ["solo-two"],
      }),
      seedPerson("Seed Three", { github_followers: ["james"] }),
    ];

    const entries = conv.computeConvergence(people);
    expect(entries).toHaveLength(1);
    const james = entries[0];
    expect(james.login).toBe("james");
    expect(james.seed_count).toBe(3);
    expect(james.seeds).toEqual(["Seed One", "Seed Three", "Seed Two"]);
    expect(james.collaborator_of).toEqual(["Seed One"]);
    // 2*1 collaborator + 2 followers
    expect(james.weight).toBe(4);
  });

  it("ignores non-seed-members and self-references", () => {
    const stranger = seedPerson("Stranger", {
      github_collaborators: ["james"],
    });
    stranger.identity.status = "not_attempted";
    stranger.olympiad = undefined;

    const selfRef = seedPerson("James Person", {
      github_collaborators: ["james-person", "other"],
    });

    const entries = conv.computeConvergence([stranger, selfRef]);
    expect(entries).toHaveLength(0);
  });

  it("falls back to merged neighbor lists on older records", () => {
    const people = [
      seedPerson("Old A", { github_neighbors: ["bridge"] }),
      seedPerson("Old B", { github_neighbors: ["bridge"] }),
    ];
    const entries = conv.computeConvergence(people);
    expect(entries).toHaveLength(1);
    expect(entries[0].seed_count).toBe(2);
  });
});

describe("convergence store round-trip", () => {
  it("refreshes from person records and loads as a login-keyed map", () => {
    fs.mkdirSync(process.env.PEOPLE_DIR!, { recursive: true });
    for (const p of [
      seedPerson("Store A", { github_collaborators: ["shared"] }),
      seedPerson("Store B", { github_followers: ["Shared"] }),
    ]) {
      fs.writeFileSync(
        path.join(process.env.PEOPLE_DIR!, `${p.slug}.json`),
        JSON.stringify(p)
      );
    }
    const entries = conv.refreshConvergenceStore();
    expect(entries.map((e) => e.login)).toContain("shared");
    const map = conv.loadConvergenceMap();
    expect(map.get("shared")?.seed_count).toBe(2);
  });
});

describe("convergence score bonus", () => {
  it("adds a capped bonus per extra seed and never dominates", () => {
    const base = computeScore(undefined, undefined, undefined, 0, 0);
    const two = computeScore(undefined, undefined, undefined, 0, 2);
    const many = computeScore(undefined, undefined, undefined, 0, 10);
    expect(base.breakdown.convergence).toBe(0);
    expect(two.breakdown.convergence).toBe(0.15);
    expect(two.final_score).toBeCloseTo(base.final_score + 0.15, 5);
    expect(many.breakdown.convergence).toBe(0.45);
  });
});
