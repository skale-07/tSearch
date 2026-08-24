import { describe, expect, it } from "vitest";
import { includeOnTree, isBotLogin } from "../../src/storage/includeOnTree.js";

function node(
  relation: "collaborator" | "follower" | "website",
  score: number,
  slug = "someone"
) {
  return {
    slug,
    name: slug,
    relation,
    context_score: score,
  } as const;
}

describe("includeOnTree", () => {
  it("always keeps the seed", () => {
    expect(includeOnTree(node("follower", 0), 0)).toBe(true);
  });

  it("keeps collaborators below the follower context floor", () => {
    expect(includeOnTree(node("collaborator", 0), 1)).toBe(true);
    expect(includeOnTree(node("collaborator", 2), 1)).toBe(true);
  });

  it("keeps website neighbors regardless of score", () => {
    expect(includeOnTree(node("website", 0), 1)).toBe(true);
  });

  it("hides followers below MIN_TREE_CONTEXT_SCORE", () => {
    expect(includeOnTree(node("follower", 0), 1)).toBe(false);
    expect(includeOnTree(node("follower", 3), 1)).toBe(false);
    expect(includeOnTree(node("follower", 4), 1)).toBe(true);
  });

  it("still drops bot logins even when they are collaborators", () => {
    expect(isBotLogin("dependabot", "dependabot")).toBe(true);
    expect(
      includeOnTree(node("collaborator", 9, "dependabot[bot]"), 1)
    ).toBe(false);
  });
});
