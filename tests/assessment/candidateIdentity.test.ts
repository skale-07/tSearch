import { describe, expect, it } from "vitest";
import {
  resolveCandidateIdentity,
  identityFromCandidate,
} from "../../src/assessment/candidateIdentity.js";
import type { Candidate } from "../../src/types.js";

describe("stable candidate IDs", () => {
  it("prefers GitHub username", () => {
    const a = resolveCandidateIdentity({
      name: "Jane Doe",
      github_username: "jane-doe",
      linkedin_url: "https://www.linkedin.com/in/jane-doe/",
    });
    const b = resolveCandidateIdentity({
      name: "Jane Doe",
      github_username: "Jane-Doe",
    });
    expect(a.id_source).toBe("github_username");
    expect(a.candidate_id).toBe(b.candidate_id);
    expect(a.candidate_id.startsWith("cand_")).toBe(true);
  });

  it("falls back to LinkedIn URL", () => {
    const a = resolveCandidateIdentity({
      name: "Jane Doe",
      linkedin_url: "https://www.linkedin.com/in/JaneDoe/?trk=x",
    });
    const b = resolveCandidateIdentity({
      name: "Other Name Same Profile",
      linkedin_url: "https://linkedin.com/in/janedoe/",
    });
    expect(a.id_source).toBe("linkedin_url");
    expect(a.candidate_id).toBe(b.candidate_id);
  });

  it("does not equate different people with the same name", () => {
    const a = resolveCandidateIdentity({
      name: "Alex Kim",
      github_username: "alexkim1",
    });
    const b = resolveCandidateIdentity({
      name: "Alex Kim",
      github_username: "alexkim2",
    });
    expect(a.candidate_id).not.toBe(b.candidate_id);
  });

  it("is collision-resistant across sources", () => {
    const gh = resolveCandidateIdentity({
      name: "X",
      github_username: "example",
    });
    const key = resolveCandidateIdentity({
      name: "X",
      key: "example",
    });
    expect(gh.candidate_id).not.toBe(key.candidate_id);
  });

  it("works from Candidate objects", () => {
    const c = {
      name: "Varun Madan",
      key: "varun madan",
      discovered_via: [],
      identity_confidence: 0.9,
      final_score: 2,
      score_breakdown: {
        builder: 0,
        thinker: 0,
        olympiad: 0,
        weirdness: 0,
        identity: 0,
      },
      github: {
        username: "madanva",
        display_name: "Varun",
        profile_url: "https://github.com/madanva",
        bio: null,
        blog: null,
        twitter_username: null,
        company: null,
        location: null,
        email: null,
        social_accounts: [],
        context_score: 0,
        context_signals: [],
        repos: [],
        contributors: [],
        stars: [],
        forks: [],
        followers: [],
        following: [],
        recent_commits: 0,
        active: false,
      },
    } satisfies Candidate;
    const id = identityFromCandidate(c);
    expect(id.github_username).toBe("madanva");
    expect(id.id_source).toBe("github_username");
  });
});
