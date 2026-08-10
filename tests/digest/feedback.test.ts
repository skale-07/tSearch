import { describe, it, expect, beforeAll } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";

// FEEDBACK_DIR is read from env at config import time.
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "tsearch-feedback-"));
process.env.FEEDBACK_DIR = tmpDir;

type FeedbackStore = typeof import("../../src/digest/feedbackStore.js");
let store: FeedbackStore;

beforeAll(async () => {
  store = await import("../../src/digest/feedbackStore.js");
});

describe("feedbackStore", () => {
  it("records feedback and keeps an append-only entry history", () => {
    const first = store.recordFeedback({
      candidate_id: "cand_history",
      candidate_name: "History Person",
      verdict: "relevant",
    });
    expect(first.latest_verdict).toBe("relevant");

    const second = store.recordFeedback({
      candidate_id: "cand_history",
      verdict: "not_relevant",
      note: "wrong field",
    });
    expect(second.latest_verdict).toBe("not_relevant");
    expect(second.entries).toHaveLength(2);
    expect(second.entries[0].verdict).toBe("relevant");
    expect(second.candidate_name).toBe("History Person");

    const reloaded = store.loadFeedback("cand_history");
    expect(reloaded?.latest_verdict).toBe("not_relevant");
  });

  it("exposes the explore queue", () => {
    store.recordFeedback({
      candidate_id: "cand_explore",
      verdict: "explore_network",
    });
    const queue = store.exploreQueue();
    expect(queue.map((r) => r.candidate_id)).toContain("cand_explore");
    expect(queue.map((r) => r.candidate_id)).not.toContain("cand_history");
  });
});
