import { describe, expect, it } from "vitest";
import {
  CANDIDATE_LABELS,
  buildLabelPrompt,
  deterministicLabelTier,
  labelJudgeOutputSchema,
} from "../../src/assessment/judges/labelJudge.js";
import { CANDIDATE_LABEL_IDS, type AssessmentAxes } from "../../src/assessment/types.js";

function axes(partial: {
  tech?: number;
  own?: number;
  writing?: number;
  cross?: number;
  unusual?: number;
}): AssessmentAxes {
  const axis = (score?: number) =>
    score === undefined
      ? { score: null, available: false, evidence_support: "low" as const }
      : { score, available: true, evidence_support: "moderate" as const };
  return {
    technical_strength: axis(partial.tech),
    ownership_support: axis(partial.own),
    writing_intellectual_depth: axis(partial.writing),
    cross_artifact_coherence: axis(partial.cross),
    unusual_problem_selection: axis(partial.unusual),
    persistence_and_iteration: axis(undefined),
    evidence_completeness: axis(0.5),
  } as AssessmentAxes;
}

describe("label taxonomy", () => {
  it("every label id has display + three tier criteria, and the prompt lists them", () => {
    const prompt = buildLabelPrompt();
    for (const id of CANDIDATE_LABEL_IDS) {
      const label = CANDIDATE_LABELS[id];
      expect(label.display).toBeTruthy();
      expect(Object.keys(label.tiers)).toEqual(["1", "2", "3"]);
      expect(prompt).toContain(id);
      expect(prompt).toContain(label.display);
    }
  });

  it("output schema rejects unknown labels and out-of-range tiers", () => {
    expect(
      labelJudgeOutputSchema.safeParse({
        label: "rockstar_ninja",
        tier: 1,
        runner_up: null,
        rationale: "x",
      }).success
    ).toBe(false);
    expect(
      labelJudgeOutputSchema.safeParse({
        label: "garage_builder",
        tier: 4,
        runner_up: null,
        rationale: "x",
      }).success
    ).toBe(false);
  });
});

describe("deterministicLabelTier", () => {
  it("strong builder with high ownership → Garage Builder tier 1", () => {
    const result = deterministicLabelTier({
      axes: axes({ tech: 0.8, own: 0.7 }),
      ownership: { support_class: "high_ownership_support" } as never,
    });
    expect(result.label).toBe("garage_builder");
    expect(result.tier).toBe(1);
  });

  it("unusual problem + solid tech → Weird-Bet Experimentalist over builder", () => {
    const result = deterministicLabelTier({
      axes: axes({ tech: 0.6, own: 0.6, unusual: 0.7 }),
    });
    expect(result.label).toBe("weird_bet_experimentalist");
    expect(result.tier).toBe(2);
  });

  it("distinctive path with weak artifacts → Wild Card, hook as rationale", () => {
    const result = deterministicLabelTier({
      axes: axes({ tech: 0.2 }),
      experience: {
        overall_distinctiveness: "strong",
        hook: "Sailed the Atlantic at 16",
      } as never,
    });
    expect(result.label).toBe("wild_card");
    expect(result.rationale).toContain("Sailed the Atlantic");
  });

  it("nothing available → Quiet Signal tier 3", () => {
    const result = deterministicLabelTier({});
    expect(result.label).toBe("quiet_signal");
    expect(result.tier).toBe(3);
  });

  it("mid-tech with no other signal lands Garage Builder tier 3, not a fake tier 1", () => {
    const result = deterministicLabelTier({ axes: axes({ tech: 0.48 }) });
    expect(result.label).toBe("garage_builder");
    expect(result.tier).toBe(3);
  });
});
