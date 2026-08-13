import { describe, expect, it } from "vitest";
import {
  computeObscurity,
  upsideMultiplier,
} from "../../src/scoring/computeObscurity.js";
import { computeScore } from "../../src/scoring/computeScore.js";
import { deriveStage } from "../../src/assessment/stage/deriveStage.js";
import { deterministicAgeRelative } from "../../src/assessment/judges/ageRelativeJudge.js";
import { deterministicCoryRelevance } from "../../src/assessment/judges/coryRelevanceJudge.js";
import type {
  GitHubProfile,
  OlympiadProfile,
  SubstackProfile,
  WebsiteProfile,
} from "../../src/types.js";

function gh(partial: Partial<GitHubProfile>): GitHubProfile {
  return {
    username: "x",
    display_name: null,
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
    repos: [],
    contributors: [],
    stars: [],
    forks: [],
    followers: [],
    following: [],
    recent_commits: 0,
    active: false,
    ...partial,
  };
}

const repo = (stars: number) => ({
  name: `r${stars}`,
  topics: [],
  language: "Rust",
  stars,
  pushed_at: "2026-01-01",
});

function site(links: number): WebsiteProfile {
  return {
    url: "https://me.dev",
    scraped_at: "2026-01-01",
    github_url: null,
    substack_url: null,
    twitter_url: null,
    linkedin_url: null,
    email: null,
    instagram_url: null,
    youtube_url: null,
    other_links: [],
    all_links: Array.from({ length: links }, (_, i) => `https://x/${i}`),
  };
}

describe("computeObscurity", () => {
  it("an empty profile is maximally obscure but has no substance to be undiscovered about", () => {
    const result = computeObscurity({});
    expect(result.obscurity).toBeGreaterThan(0.8);
    expect(result.substance_present).toBe(false);
    // The degenerate case must never produce a surfacing multiplier.
    expect(upsideMultiplier(result)).toBeNull();
  });

  it("real work with no audience scores highly obscure and yields a multiplier", () => {
    const result = computeObscurity({
      github: gh({ repos: [repo(1), repo(0), repo(2)], followers: [] }),
    });
    expect(result.substance_present).toBe(true);
    expect(result.obscurity).toBeGreaterThan(0.7);
    expect(upsideMultiplier(result)).not.toBeNull();
  });

  it("a well-followed person with a built-out presence scores low obscurity", () => {
    const result = computeObscurity({
      github: gh({
        repos: [repo(400)],
        followers: Array.from({ length: 30 }, (_, i) => `f${i}`),
      }),
      substack: { url: "u", slug: "s", posts: 20, commenters: [], recommenders: [], active: true } as SubstackProfile,
      website: site(20),
    });
    expect(result.obscurity).toBeLessThan(0.2);
  });

  it("saturated follower counts are flagged rather than trusted as exact", () => {
    const result = computeObscurity({
      github: gh({
        repos: [repo(1)],
        followers: Array.from({ length: 30 }, (_, i) => `f${i}`),
      }),
    });
    expect(result.signals.github_followers_saturated).toBe(true);
  });

  it("obscurity never changes final_score", () => {
    const bare = computeScore(gh({ repos: [repo(0)] }), undefined, undefined, 0, 0);
    const withSite = computeScore(
      gh({ repos: [repo(0)] }),
      undefined,
      undefined,
      0,
      0,
      site(20)
    );
    expect(withSite.final_score).toBe(bare.final_score);
    expect(withSite.breakdown.obscurity).toBeLessThan(
      bare.breakdown.obscurity!
    );
  });
});

const olympiad = (partial: Partial<OlympiadProfile>): OlympiadProfile => ({
  name: "A",
  years: [2025],
  sources: [],
  prizes: [],
  countries: [],
  schools: [],
  olympiadScore: 1,
  medalScore: 1,
  recencyScore: 1,
  ageScore: 0,
  ...partial,
});

describe("deriveStage", () => {
  const now = new Date("2026-08-13");

  it("uses the stated olympiad age band when present", () => {
    const stage = deriveStage({
      olympiad: olympiad({ years: [2026], ageScore: 2 }),
      now,
    });
    expect(stage.bucket).toBe("hs_senior");
    expect(stage.basis).toBe("olympiad_age_band");
    expect(stage.confidence).toBeGreaterThan(0.8);
  });

  it("ages an older competitor forward out of the target band", () => {
    const stage = deriveStage({
      olympiad: olympiad({ years: [2019], ageScore: 2 }),
      now,
    });
    expect(stage.estimated_age).toBeGreaterThanOrEqual(23);
    expect(stage.bucket).toBe("post_grad");
  });

  it("falls back to a stated graduation year", () => {
    const stage = deriveStage({
      linkedin: { graduation_year: 2032 } as never,
      now,
    });
    expect(stage.bucket).toBe("hs_underclass");
    expect(stage.basis).toBe("linkedin_graduation_year");
  });

  it("returns unknown with zero confidence when no dates are stated", () => {
    const stage = deriveStage({ now });
    expect(stage.bucket).toBe("unknown");
    expect(stage.confidence).toBe(0);
    expect(stage.estimated_age).toBeNull();
  });
});

describe("age-relative impressiveness (deterministic)", () => {
  const now = new Date("2026-08-13");
  const hsSenior = deriveStage({ olympiad: olympiad({ years: [2026], ageScore: 2 }), now });
  const postGrad = deriveStage({ olympiad: olympiad({ years: [2019], ageScore: 2 }), now });

  it("scores the same work higher for a younger stage", () => {
    const young = deterministicAgeRelative({ stage: hsSenior, technicalBand: "strong" });
    const older = deterministicAgeRelative({ stage: postGrad, technicalBand: "strong" });
    expect(young.score).toBeGreaterThan(older.score!);
  });

  it("returns null — not a middle score — when the stage is unknown", () => {
    const result = deterministicAgeRelative({
      stage: deriveStage({ now }),
      technicalBand: "strong",
    });
    expect(result.score).toBeNull();
    expect(result.applicability).toBe("insufficient_evidence");
  });

  it("returns null when there is no substantive work to weigh", () => {
    const result = deterministicAgeRelative({ stage: hsSenior });
    expect(result.score).toBeNull();
  });
});

describe("cory routing age booster", () => {
  const strongTech = {
    overall_technical_strength: "moderate",
    dimensions: [],
    strongest_evidence_ids: [],
  } as unknown as never;

  it("boosts and explains when the work is exceptional for the stage", () => {
    const boosted = deterministicCoryRelevance({
      technical: strongTech,
      ageRelative: { score: 9, stage_bucket: "hs_senior" } as never,
      evidenceCompleteness: 0.3,
    });
    expect(boosted.reasons.join(" ")).toMatch(/exceptional for their stage/i);
  });

  it("cannot rescue a candidate with no artifact signal", () => {
    const result = deterministicCoryRelevance({
      ageRelative: { score: 10, stage_bucket: "hs_senior" } as never,
      evidenceCompleteness: 0.2,
    });
    expect(result.relevance).toBe("insufficient_evidence");
  });
});
