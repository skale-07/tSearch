import { describe, expect, it } from "vitest";
import { computeAssessmentPriority } from "../../src/assessment/scoring/computeAssessmentPriority.js";

describe("computeAssessmentPriority", () => {
  it("does not treat missing research/writing as zero domains that crush score", () => {
    const onlyTech = computeAssessmentPriority({
      technical: 8,
      curiosity: 6,
      unusual_problem_selection: 5,
      persistence: 5,
      ownership: 7,
      evidence_completeness: 0.8,
      aggregate_confidence: 0.8,
    });
    const withResearch = computeAssessmentPriority({
      technical: 8,
      research: 8,
      curiosity: 6,
      unusual_problem_selection: 5,
      persistence: 5,
      ownership: 7,
      evidence_completeness: 0.8,
      aggregate_confidence: 0.8,
    });
    expect(onlyTech.priority_score).toBeGreaterThan(40);
    // Having a second strong domain should not be required for a solid score
    expect(onlyTech.priority_score).toBeGreaterThan(30);
    expect(withResearch.priority_score).toBeGreaterThan(onlyTech.priority_score - 5);
  });

  it("redistributes second-domain weight when only one domain exists", () => {
    const result = computeAssessmentPriority({
      technical: 10,
      evidence_completeness: 1,
      aggregate_confidence: 1,
      curiosity: 0,
      persistence: 0,
      ownership: 0,
      unusual_problem_selection: 0,
    });
    expect(result.components.second).toBe(0);
    expect(result.priority_score).toBeGreaterThan(0);
    expect(result.priority_score).toBeLessThanOrEqual(100);
  });

  it("bounds confidence adjustment and score 0-100", () => {
    const low = computeAssessmentPriority({
      technical: 10,
      curiosity: 10,
      unusual_problem_selection: 10,
      persistence: 10,
      ownership: 10,
      evidence_completeness: 1,
      aggregate_confidence: 0,
    });
    const high = computeAssessmentPriority({
      technical: 10,
      curiosity: 10,
      unusual_problem_selection: 10,
      persistence: 10,
      ownership: 10,
      evidence_completeness: 1,
      aggregate_confidence: 1,
    });
    expect(low.priority_score).toBeLessThan(high.priority_score);
    expect(high.priority_score).toBeLessThanOrEqual(100);
    expect(low.priority_score).toBeGreaterThanOrEqual(0);
  });

  it("persists weight version", () => {
    const r = computeAssessmentPriority({
      evidence_completeness: 0.5,
      aggregate_confidence: 0.5,
    });
    expect(r.weight_version).toBe("priority-v2.1");
  });
});
