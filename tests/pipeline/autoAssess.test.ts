import { describe, it, expect } from "vitest";
import {
  hasGithubPath,
  hasWritingSurface,
  selectAutoAssess,
} from "../../src/pipeline/autoAssess.js";
import type { Candidate } from "../../src/types.js";

function cand(over: Record<string, unknown>): Candidate {
  return {
    name: "Person",
    key: "person",
    discovered_via: [],
    identity_confidence: 0,
    final_score: 1,
    score_breakdown: { builder: 0, thinker: 0, olympiad: 0, weirdness: 0, identity: 0 },
    ...over,
  } as unknown as Candidate;
}

const gh = (context_score = 8) => ({
  username: "p",
  profile_url: "https://github.com/p",
  context_score,
  blog: "",
  repos: [],
});

describe("auto-assess base condition", () => {
  it("requires BOTH a github path and a writing surface", () => {
    const both = cand({
      name: "Both",
      github: gh(),
      website: { url: "https://p.dev" },
      identity_confidence: 0.8,
    });
    const githubOnly = cand({ name: "GH", github: gh(), identity_confidence: 0.8 });
    const writingOnly = cand({
      name: "Blog",
      website: { url: "https://p.dev" },
      identity_confidence: 0.8,
    });

    expect(hasGithubPath(both) && hasWritingSurface(both)).toBe(true);
    const picks = selectAutoAssess([both, githubOnly, writingOnly], {
      hasReport: () => false,
    });
    expect(picks.map((p) => p.name)).toEqual(["Both"]);
  });

  it("applies the context floor to discovered neighbors but not resolved seeds", () => {
    const weakNeighbor = cand({
      name: "Weak",
      key: "weak",
      github: gh(2),
      website: { url: "https://w.dev" },
      identity_confidence: 0,
    });
    const strongNeighbor = cand({
      name: "Strong",
      key: "strong",
      github: { ...gh(7), username: "strong" },
      website: { url: "https://s.dev" },
      identity_confidence: 0,
    });
    const weakContextSeed = cand({
      name: "Seed",
      key: "seed",
      github: { ...gh(0), username: "seedy" },
      website: { url: "https://seed.dev" },
      identity_confidence: 0.9,
    });

    const picks = selectAutoAssess(
      [weakNeighbor, strongNeighbor, weakContextSeed],
      { hasReport: () => false, minContext: 4 }
    );
    expect(picks.map((p) => p.name).sort()).toEqual(["Seed", "Strong"]);
  });

  it("skips candidates that already have a report", () => {
    const c = cand({
      name: "Done",
      github: gh(),
      website: { url: "https://d.dev" },
      identity_confidence: 0.8,
    });
    expect(selectAutoAssess([c], { hasReport: () => true })).toEqual([]);
  });

  it("counts github blog and substack as writing surfaces", () => {
    expect(
      hasWritingSurface(cand({ github: { ...gh(), blog: "https://b.dev" } }))
    ).toBe(true);
    expect(
      hasWritingSurface(cand({ substack: { url: "https://x.substack.com" } }))
    ).toBe(true);
    expect(hasWritingSurface(cand({ github: gh() }))).toBe(false);
  });
});
