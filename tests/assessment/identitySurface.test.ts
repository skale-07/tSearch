import { describe, expect, it } from "vitest";
import {
  computeIdentitySurfaceScore,
  SURFACE_WEIGHTS,
} from "../../src/github/identitySurface.js";
import { computeGithubContextScore } from "../../src/github/githubUser.js";

describe("computeIdentitySurfaceScore", () => {
  it("weights LinkedIn + writing above twitter", () => {
    const both = computeIdentitySurfaceScore({
      linkedin_url: "https://linkedin.com/in/a",
      website_url: "https://example.com",
    });
    const twitterOnly = computeIdentitySurfaceScore({
      twitter_username: "someone",
    });
    expect(both.score).toBe(
      SURFACE_WEIGHTS.linkedin + SURFACE_WEIGHTS.writing
    );
    expect(twitterOnly.score).toBe(SURFACE_WEIGHTS.twitter);
    expect(both.score).toBeGreaterThan(twitterOnly.score);
  });

  it("does not count github social provider", () => {
    const scored = computeIdentitySurfaceScore({
      social_accounts: [
        { provider: "github", url: "https://github.com/x" },
        { provider: "linkedin", url: "https://linkedin.com/in/x" },
      ],
    });
    expect(scored.signals).toEqual(["linkedin"]);
    expect(scored.score).toBe(SURFACE_WEIGHTS.linkedin);
  });
  it("weights email above twitter", () => {
    const withEmail = computeIdentitySurfaceScore({
      email: "a@example.com",
    });
    const withTwitter = computeIdentitySurfaceScore({
      twitter_username: "someone",
    });
    expect(withEmail.score).toBe(SURFACE_WEIGHTS.email);
    expect(withTwitter.score).toBe(SURFACE_WEIGHTS.twitter);
    expect(withEmail.score).toBeGreaterThan(withTwitter.score);
  });
});

describe("computeGithubContextScore weights", () => {
  it("scores LinkedIn+blog higher than twitter-only and ignores repos", () => {
    const rich = computeGithubContextScore({
      bio: null,
      blog: "https://blog.example.com",
      twitter_username: null,
      company: null,
      location: null,
      email: null,
      social_accounts: [
        { provider: "linkedin", url: "https://linkedin.com/in/a" },
      ],
      repos: 50,
    });
    const twitter = computeGithubContextScore({
      bio: null,
      blog: null,
      twitter_username: "x",
      company: null,
      location: null,
      email: null,
      social_accounts: [],
      repos: 50,
    });
    expect(rich.score).toBe(8);
    expect(twitter.score).toBe(1);
    expect(rich.signals).not.toContain("repos");
  });

  it("scores email above twitter", () => {
    const email = computeGithubContextScore({
      bio: null,
      blog: null,
      twitter_username: null,
      company: null,
      location: null,
      email: "a@example.com",
      social_accounts: [],
      repos: 0,
    });
    const twitter = computeGithubContextScore({
      bio: null,
      blog: null,
      twitter_username: "x",
      company: null,
      location: null,
      email: null,
      social_accounts: [],
      repos: 0,
    });
    expect(email.score).toBe(3);
    expect(twitter.score).toBe(1);
  });
});
