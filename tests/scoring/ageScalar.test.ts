import { describe, expect, it } from "vitest";
import { ageScalar, toOverallScore10 } from "../../src/scoring/ageScalar.js";
import { computeScore } from "../../src/scoring/computeScore.js";
import { computePriorityV2 } from "../../src/assessment/scoring/synthesizeCandidate.js";
import type { AssessmentAxes } from "../../src/assessment/types.js";
import type { OlympiadProfile } from "../../src/types.js";

describe("ageScalar", () => {
  it("is unity at 22 and boosts younger / damps older", () => {
    expect(ageScalar(22)).toBe(1);
    expect(ageScalar(16)).toBeGreaterThan(1.3);
    expect(ageScalar(16)).toBeLessThanOrEqual(1.4);
    expect(ageScalar(18)).toBeGreaterThan(1.2);
    expect(ageScalar(28)).toBeLessThan(1);
    expect(ageScalar(28)).toBeGreaterThan(0.7);
    expect(ageScalar(50)).toBe(0.5);
  });

  it("maps 0–100 onto recruiter-facing 1–10", () => {
    expect(toOverallScore10(0)).toBe(0);
    expect(toOverallScore10(90)).toBe(9);
    expect(toOverallScore10(5)).toBe(1);
    expect(toOverallScore10(100)).toBe(10);
  });
});

describe("computeScore age scalar", () => {
  const oly = (ageScore: number, year: number): OlympiadProfile => ({
    name: "Test",
    years: [year],
    sources: ["IMO"],
    prizes: [],
    countries: [],
    schools: [],
    olympiadScore: 3,
    medalScore: 2,
    recencyScore: 4,
    ageScore,
  });

  it("scales final_score higher for a younger olympiad cohort", () => {
    // ageScore 2 => ~16.5 at competition; year = current → ~16–17 now
    const young = computeScore(undefined, undefined, oly(2, new Date().getFullYear()));
    const older = computeScore(
      undefined,
      undefined,
      oly(1, new Date().getFullYear() - 8)
    );
    expect(young.breakdown.age_scalar!).toBeGreaterThan(1);
    expect(older.breakdown.age_scalar!).toBeLessThanOrEqual(1);
    // Same pre-age olympiad contribution shape; young should outrank after scalar
    expect(young.final_score).toBeGreaterThan(older.final_score);
  });

  it("leaves scalar at 1 when no stage evidence", () => {
    const r = computeScore();
    expect(r.breakdown.age_scalar).toBe(1);
    expect(r.breakdown.estimated_age ?? null).toBeNull();
  });
});

describe("computePriorityV2 age scalar", () => {
  const axes = {
    technical_strength: {
      score: 0.8,
      available: true,
      evidence_support: "high" as const,
    },
    ownership_support: {
      score: 0.7,
      available: true,
      evidence_support: "moderate" as const,
    },
    evidence_completeness: {
      score: 0.8,
      available: true,
      evidence_support: "high" as const,
    },
  } as AssessmentAxes;

  it("multiplies priority so younger estimated age ranks higher", () => {
    const young = computePriorityV2({ axes, estimatedAge: 17 });
    const older = computePriorityV2({ axes, estimatedAge: 30 });
    const unknown = computePriorityV2({ axes });
    expect(young.components.age_scalar).toBeGreaterThan(1);
    expect(older.components.age_scalar).toBeLessThan(1);
    expect(unknown.components.age_scalar).toBe(1);
    expect(young.priority_score).toBeGreaterThan(older.priority_score);
    expect(young.priority_score).toBeGreaterThan(unknown.priority_score);
  });
});
