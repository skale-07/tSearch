import { describe, it, expect, beforeAll } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "tsearch-marks-"));
process.env.MARKS_DIR = tmpDir;

type MarkStore = typeof import("../../src/marks/markStore.js");
let store: MarkStore;

beforeAll(async () => {
  store = await import("../../src/marks/markStore.js");
});

describe("markStore", () => {
  it("puts, gets, and deletes a watchlist row", () => {
    const rec = store.upsertMark({
      id: "cand_abc",
      name: "Ada Lovelace",
      source: "assess",
    });
    expect(rec.id).toBe("cand_abc");
    expect(rec.candidate_id).toBeUndefined();
    expect(store.loadMark("cand_abc")?.name).toBe("Ada Lovelace");
    expect(store.loadAllMarks().map((m) => m.id)).toContain("cand_abc");
    expect(store.deleteMark("cand_abc")).toBe(true);
    expect(store.loadMark("cand_abc")).toBeNull();
  });

  it("rewrites a page-hit key onto a candidate_id after resolve", () => {
    const pageId = store.pageHitMarkId(
      "https://lab.example/people",
      "Jane Doe"
    );
    expect(pageId.startsWith("page:")).toBe(true);
    store.upsertMark({
      id: pageId,
      name: "Jane Doe",
      source: "website_preview",
      page_url: "https://lab.example/people",
    });
    const moved = store.rewriteMarkId(pageId, "cand_jane", {
      candidate_id: "cand_jane",
    });
    expect(moved?.id).toBe("cand_jane");
    expect(moved?.candidate_id).toBe("cand_jane");
    expect(moved?.page_url).toBe("https://lab.example/people");
    expect(store.loadMark(pageId)).toBeNull();
    expect(store.loadMark("cand_jane")?.name).toBe("Jane Doe");
  });

  it("round-trips person_slug and preserves it on upsert", () => {
    const rec = store.upsertMark({
      id: "cand_slug",
      name: "Ada Lovelace",
      source: "graph",
      seed_slug: "seed-ada",
      person_slug: "ada-lovelace",
    });
    expect(rec.person_slug).toBe("ada-lovelace");
    expect(store.loadMark("cand_slug")?.person_slug).toBe("ada-lovelace");
    const again = store.upsertMark({
      id: "cand_slug",
      name: "Ada Lovelace",
      source: "graph",
      seed_slug: "seed-ada",
    });
    expect(again.person_slug).toBe("ada-lovelace");
  });

  it("pageHitMarkId is stable for the same url+name", () => {
    const a = store.pageHitMarkId("https://x.example/team", "José García");
    const b = store.pageHitMarkId("https://x.example/team", "Jose Garcia");
    expect(a).toBe(b);
  });
});
