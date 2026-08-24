import { describe, expect, it } from "vitest";
import {
  assessedProfileHref,
  markCandidateId,
  markGraphSlug,
  markLookDeeper,
} from "../../web/src/markLookDeeper.js";

describe("markCandidateId", () => {
  it("prefers candidate_id over a page-hit id", () => {
    expect(
      markCandidateId({ id: "page:deadbeef", candidate_id: "cand_jane" })
    ).toBe("cand_jane");
  });

  it("ignores page-hit ids without candidate_id", () => {
    expect(markCandidateId({ id: "page:deadbeef" })).toBeUndefined();
  });

  it("uses a non-page id when candidate_id is missing", () => {
    expect(markCandidateId({ id: "cand_abc" })).toBe("cand_abc");
    expect(markCandidateId({ id: "ada-lovelace" })).toBe("ada-lovelace");
  });
});

describe("markGraphSlug", () => {
  it("prefers person_slug", () => {
    expect(
      markGraphSlug({
        id: "cand_abc",
        person_slug: "ada-lovelace",
      })
    ).toBe("ada-lovelace");
  });

  it("uses a non-page, non-candidate id as the slug", () => {
    expect(markGraphSlug({ id: "ada-lovelace" })).toBe("ada-lovelace");
  });

  it("does not treat page or cand_ ids as slugs", () => {
    expect(markGraphSlug({ id: "page:deadbeef" })).toBeUndefined();
    expect(markGraphSlug({ id: "cand_abc" })).toBeUndefined();
  });
});

describe("markLookDeeper", () => {
  const assessed = new Set(["cand_jane"]);

  it("assessed → digest href even when they are on a graph", () => {
    const action = markLookDeeper(
      {
        id: "cand_jane",
        candidate_id: "cand_jane",
        seed_slug: "seed-ada",
        person_slug: "jane-doe",
      },
      assessed
    );
    expect(action).toEqual({
      kind: "digest",
      href: assessedProfileHref("cand_jane"),
      title: "Open digest profile",
    });
  });

  it("seed_slug + person_slug, not assessed → graph", () => {
    const action = markLookDeeper(
      {
        id: "cand_abc",
        candidate_id: "cand_abc",
        seed_slug: "seed-ada",
        person_slug: "ada-lovelace",
      },
      assessed
    );
    expect(action).toEqual({ kind: "graph", title: "Open graph profile" });
  });

  it("seed_slug + slug id, not assessed → graph", () => {
    const action = markLookDeeper(
      { id: "ada-lovelace", seed_slug: "seed-ada" },
      assessed
    );
    expect(action).toEqual({ kind: "graph", title: "Open graph profile" });
  });

  it("page-hit with seed_slug is not on-graph", () => {
    const action = markLookDeeper(
      { id: "page:deadbeef", seed_slug: "seed-ada" },
      assessed
    );
    expect(action.kind).toBe("hint");
    expect(action.title).toMatch(/Confirm them on LinkedIn first/i);
  });

  it("candidate_id, no graph, no assessment → assess", () => {
    const action = markLookDeeper(
      { id: "cand_abc", candidate_id: "cand_abc" },
      assessed
    );
    expect(action).toEqual({
      kind: "assess",
      candidateId: "cand_abc",
      title: "Run an assessment on them to look deeper",
    });
  });
});
