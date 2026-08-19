import { describe, expect, it } from "vitest";
import { computeScore } from "../../src/scoring/computeScore.js";
import {
  isTechnicalExperience,
  linkedinTechnicalSignal,
} from "../../src/scoring/linkedinTechnical.js";
import type { GitHubProfile, LinkedInProfile } from "../../src/types.js";

function li(over: Partial<LinkedInProfile> = {}): LinkedInProfile {
  return {
    url: "https://www.linkedin.com/in/x",
    name: "Test",
    photo_url: null,
    headline: null,
    college: null,
    school: null,
    degree: null,
    country: null,
    graduation_year: null,
    education: [],
    keywords: [],
    github_url: null,
    substack_url: null,
    twitter_url: null,
    personal_website: null,
    website_url: null,
    contact_links: [],
    experience: [],
    awards: [],
    skills: [],
    ...over,
  };
}

function gh(over: Partial<GitHubProfile> = {}): GitHubProfile {
  return {
    username: "x",
    display_name: "x",
    profile_url: "https://github.com/x",
    bio: null,
    blog: null,
    twitter_username: null,
    company: null,
    location: null,
    email: null,
    social_accounts: [],
    context_score: 0,
    context_signals: [],
    repos: [
      { name: "a", topics: [], language: "ts", stars: 0, pushed_at: null },
      { name: "b", topics: [], language: "ts", stars: 0, pushed_at: null },
      { name: "c", topics: [], language: "ts", stars: 0, pushed_at: null },
      { name: "d", topics: [], language: "ts", stars: 0, pushed_at: null },
    ],
    contributors: [],
    stars: [],
    forks: [],
    followers: [],
    following: [],
    recent_commits: 8,
    active: true,
    ...over,
  };
}

describe("linkedinTechnicalSignal", () => {
  it("is zero when experience is empty", () => {
    expect(linkedinTechnicalSignal(li())).toBe(0);
    expect(linkedinTechnicalSignal(undefined)).toBe(0);
  });

  it("treats research intern as technical and cashier as not", () => {
    expect(
      isTechnicalExperience({
        title: "Research Intern",
        company: "Stanford NLP",
        dates: "2025",
        location: null,
      })
    ).toBe(true);
    expect(
      isTechnicalExperience({
        title: "Marketing Intern",
        company: "Local Cafe",
        dates: null,
        location: null,
      })
    ).toBe(false);
  });
});

describe("computeScore LinkedIn experience", () => {
  it("gives a builder bump for technical LinkedIn roles when GitHub is missing", () => {
    const none = computeScore();
    const withLi = computeScore(
      undefined,
      undefined,
      undefined,
      0,
      0,
      undefined,
      li({
        experience: [
          {
            title: "Software Engineering Intern",
            company: "A lab",
            dates: "2025",
            location: null,
          },
        ],
      })
    );
    expect(none.breakdown.builder).toBe(0);
    expect(withLi.breakdown.builder).toBeGreaterThan(0);
    expect(withLi.breakdown.builder).toBeLessThanOrEqual(0.35);
    expect(withLi.final_score).toBeGreaterThan(none.final_score);
  });

  it("does not lower a GitHub-strong person who has no LinkedIn jobs", () => {
    const githubOnly = computeScore(gh());
    const githubPlusEmptyLi = computeScore(
      gh(),
      undefined,
      undefined,
      0,
      0,
      undefined,
      li()
    );
    expect(githubPlusEmptyLi.breakdown.builder).toBe(githubOnly.breakdown.builder);
    expect(githubPlusEmptyLi.final_score).toBe(githubOnly.final_score);
  });
});
