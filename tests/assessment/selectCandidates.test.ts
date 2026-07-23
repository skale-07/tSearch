import { describe, expect, it } from "vitest";
import { selectCandidatesForAssessment } from "../../src/assessment/selectCandidates.js";
import { identityFromCandidate } from "../../src/assessment/candidateIdentity.js";
import type { Candidate } from "../../src/types.js";

function stubCandidate(
  name: string,
  score: number,
  extras?: Partial<Candidate>
): Candidate {
  const username = name.replace(/\s+/g, "").toLowerCase();
  return {
    key: name.toLowerCase().replace(/\s+/g, "-"),
    name,
    discovered_via: ["test"],
    identity_confidence: 1,
    final_score: score,
    score_breakdown: {
      builder: 0,
      thinker: 0,
      olympiad: 0,
      weirdness: 0,
      identity: 1,
    },
    github: {
      username,
      profile_url: `https://github.com/${username}`,
    },
    ...extras,
  } as Candidate;
}

describe("selectCandidatesForAssessment candidateIds", () => {
  const a = stubCandidate("Alice Alpha", 90);
  const b = stubCandidate("Bob Beta", 80);
  const c = stubCandidate("Carol Gamma", 70);
  const d = stubCandidate("Dan Delta", 60);
  const all = [d, b, a, c]; // unsorted on purpose

  const idA = identityFromCandidate(a).candidate_id;
  const idB = identityFromCandidate(b).candidate_id;
  const idC = identityFromCandidate(c).candidate_id;
  const idD = identityFromCandidate(d).candidate_id;

  it("filters to requested ids and preserves discovery-score order", () => {
    const selected = selectCandidatesForAssessment(all, {
      limit: 10,
      candidateIds: [idC, idA, idD],
    });
    expect(selected.map((s) => s.candidate_id)).toEqual([idA, idC, idD]);
  });

  it("applies limit after id filter", () => {
    const selected = selectCandidatesForAssessment(all, {
      limit: 2,
      candidateIds: [idA, idB, idC, idD],
    });
    expect(selected.map((s) => s.candidate_id)).toEqual([idA, idB]);
  });

  it("falls back to top-N when candidateIds unset", () => {
    const selected = selectCandidatesForAssessment(all, { limit: 2 });
    expect(selected.map((s) => s.candidate_id)).toEqual([idA, idB]);
  });

  it("supports singular candidateId", () => {
    const selected = selectCandidatesForAssessment(all, {
      limit: 10,
      candidateId: idB,
    });
    expect(selected).toHaveLength(1);
    expect(selected[0].candidate_id).toBe(idB);
  });
});
