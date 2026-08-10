import { describe, it, expect, beforeAll } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";

// config.ts reads env at import time — set dirs before the module graph loads.
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "tsearch-personstore-"));
process.env.PEOPLE_DIR = path.join(tmpDir, "people");
process.env.CACHE_DIR = path.join(tmpDir, "cache");

type PersonStore = typeof import("../../src/storage/personStore.js");
let store: PersonStore;

beforeAll(async () => {
  store = await import("../../src/storage/personStore.js");
});

describe("upsertPerson", () => {
  it("creates a record with sensible defaults", () => {
    const rec = store.upsertPerson({
      name: "Test Person",
      country: "Poland",
      identity: { status: "no_results", confidence: 0 },
    });
    expect(rec.slug).toBe("test-person");
    expect(rec.identity.status).toBe("no_results");
    expect(rec.first_seen).toBeTruthy();
    expect(fs.existsSync(store.personPath("Test Person"))).toBe(true);
  });

  it("deep-merges across runs: unions arrays, keeps first_seen, appends score history", async () => {
    const name = "Merge Person";
    const first = store.upsertPerson({
      name,
      country: "Israel",
      aliases: ["M. Person"],
      graph: { github_neighbors: ["alice"], discovered_via: ["linkedin:x"] },
    });

    await new Promise((r) => setTimeout(r, 5));
    const second = store.upsertPerson({
      name,
      aliases: ["Mergey"],
      identity: { status: "resolved", confidence: 0.8 },
      graph: { github_neighbors: ["bob"], substack_neighbors: ["s1"] },
      scores: {
        builder: 0.5,
        thinker: 0,
        olympiad: 0.3,
        weirdness: 0,
        identity: 0.08,
        final_score: 0.88,
      },
    });

    expect(second.country).toBe("Israel");
    expect(second.aliases.sort()).toEqual(["M. Person", "Mergey"]);
    expect(second.graph.github_neighbors.sort()).toEqual(["alice", "bob"]);
    expect(second.graph.discovered_via).toEqual(["linkedin:x"]);
    expect(second.identity.status).toBe("resolved");
    expect(second.first_seen).toBe(first.first_seen);
    expect(second.score_history).toHaveLength(1);
    expect(second.score_history[0].final_score).toBe(0.88);

    const reloaded = store.loadPerson(name);
    expect(reloaded?.last_updated).toBe(second.last_updated);
  });

  it("never stores the canonical name as its own alias", () => {
    const rec = store.upsertPerson({
      name: "Alias Person",
      aliases: ["Alias Person", "A. Person"],
    });
    expect(rec.aliases).toEqual(["A. Person"]);
  });
});
