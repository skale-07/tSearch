import { describe, expect, it } from "vitest";
import {
  buildExperienceEvidence,
  deterministicExperienceJudge,
  hasExperienceContent,
  type ExperienceProfileInput,
} from "../../src/assessment/judges/experienceJudge.js";
import { deterministicCoryRelevance } from "../../src/assessment/judges/coryRelevanceJudge.js";
import type { ExperienceJudgeResult } from "../../src/assessment/types.js";

const emptyProfile: ExperienceProfileInput = {
  headline: null,
  experience: [],
  awards: [],
  education: [],
  olympiad_prizes: [],
};

const distinctiveProfile: ExperienceProfileInput = {
  headline: "Building farm automation since 15",
  experience: [
    {
      title: "Founder — vintage synthesizer restoration shop",
      company: null,
      dates: "2022 – 2024",
    },
  ],
  awards: [
    { title: "National Robotics Champion", issuer: "NRC", date: "2023" },
  ],
  education: [{ school: "Some High School", years: "2021 – 2025" }],
  olympiad_prizes: ["IMO Silver 2024"],
  linkedin_url: "https://linkedin.com/in/example",
};

describe("experience judge (deterministic)", () => {
  it("abstains cleanly on an empty profile", () => {
    expect(hasExperienceContent(emptyProfile)).toBe(false);
    const result = deterministicExperienceJudge({
      profile: emptyProfile,
      evidence: [],
      artifactId: "art_none",
    });
    expect(result.overall_distinctiveness).toBe("insufficient_public_evidence");
    expect(result.hook).toBeNull();
    expect(result.dimensions.every((d) => d.score === null)).toBe(true);
  });

  it("scores a concrete distinctive path and produces a hook", () => {
    const { reference, evidence } = buildExperienceEvidence(
      "cand_x",
      distinctiveProfile
    );
    expect(reference.kind).toBe("other");
    expect(evidence.length).toBeGreaterThan(3);
    // Olympiad record comes from the seed dataset, not self-report
    expect(
      evidence.find((e) => e.observation.includes("IMO Silver"))?.strength
    ).toBe("moderate");

    const result = deterministicExperienceJudge({
      profile: distinctiveProfile,
      evidence,
      artifactId: reference.artifact_id,
    });
    expect(result.overall_distinctiveness).toBe("moderate");
    expect(result.hook).toBeTruthy();
    for (const dim of result.dimensions) {
      expect(dim.score).not.toBeNull();
      expect(dim.supporting_evidence_ids.length).toBeGreaterThan(0);
    }
  });

  it("evidence ids are deterministic across rebuilds (safe on retry)", () => {
    const a = buildExperienceEvidence("cand_x", distinctiveProfile);
    const b = buildExperienceEvidence("cand_x", distinctiveProfile);
    expect(a.reference.artifact_id).toBe(b.reference.artifact_id);
    expect(a.evidence.map((e) => e.evidence_id)).toEqual(
      b.evidence.map((e) => e.evidence_id)
    );
  });
});

describe("cory routing experience booster", () => {
  const strongExperience = {
    overall_distinctiveness: "strong",
    hook: "Restores vintage synthesizers between olympiad seasons",
  } as ExperienceJudgeResult;

  it("adds points and surfaces the hook as a reason", () => {
    const base = deterministicCoryRelevance({
      technical: {
        overall_technical_strength: "moderate",
        dimensions: [],
        strongest_evidence_ids: [],
      } as unknown as never,
      evidenceCompleteness: 0.3,
    });
    const boosted = deterministicCoryRelevance({
      technical: {
        overall_technical_strength: "moderate",
        dimensions: [],
        strongest_evidence_ids: [],
      } as unknown as never,
      experience: strongExperience,
      evidenceCompleteness: 0.3,
    });
    expect(boosted.reasons.join(" ")).toContain("vintage synthesizers");
    expect(
      ["high", "medium"].indexOf(boosted.relevance) <=
        ["high", "medium", "low", "insufficient_evidence"].indexOf(
          base.relevance
        )
    ).toBe(true);
  });

  it("never lifts a candidate with no artifact signal out of insufficient_evidence", () => {
    const result = deterministicCoryRelevance({
      experience: strongExperience,
      evidenceCompleteness: 0.2,
    });
    expect(result.relevance).toBe("insufficient_evidence");
  });
});
