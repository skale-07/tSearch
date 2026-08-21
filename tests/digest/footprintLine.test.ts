import { describe, expect, it } from "vitest";
import { digestFootprintLine } from "../../src/digest/footprintLine.js";
import type { DigestCandidate } from "../../src/digest/types.js";

function stub(partial: Partial<DigestCandidate> = {}): DigestCandidate {
  return {
    candidate_id: "c1",
    rank: 1,
    name: "Ada",
    archetype: "independent_systems_builder",
    primary_archetype: "independent_systems_builder",
    secondary_archetypes: [],
    headline: "builder",
    discovery_score: 1,
    assessment_priority_score: 70,
    assessment_confidence: 0.7,
    why_highlighted: [],
    curiosity_summary: {
      score: 5,
      confidence: 0.5,
      rationale: "n/a",
      evidence_ids: [],
    },
    strongest_artifacts: [],
    important_uncertainties: [],
    next_review_step: "look",
    links: {},
    ...partial,
  };
}

describe("digestFootprintLine", () => {
  it("puts LinkedIn connection count first even when obscurity is low", () => {
    expect(
      digestFootprintLine(
        stub({
          surfacing: {
            age_relative_impressiveness: null,
            stage_bucket: "college",
            estimated_age: 20,
            obscurity: 0.3,
            connections: 87,
            upside_score: null,
          },
        })
      )
    ).toBe("87 LinkedIn connections");
  });

  it("appends a qualitative obscurity read when the footprint is thin", () => {
    expect(
      digestFootprintLine(
        stub({
          surfacing: {
            age_relative_impressiveness: null,
            stage_bucket: "high_school",
            estimated_age: 18,
            obscurity: 0.82,
            connections: 41,
            upside_score: null,
          },
        })
      )
    ).toBe("41 LinkedIn connections · barely visible online");
  });

  it("renders LinkedIn's 500+ cap instead of a fake exact count", () => {
    expect(
      digestFootprintLine(
        stub({
          surfacing: {
            age_relative_impressiveness: null,
            stage_bucket: "professional",
            estimated_age: 24,
            obscurity: 0.1,
            connections: 500,
            connections_saturated: true,
            upside_score: null,
          },
        })
      )
    ).toBe("500+ LinkedIn connections");
  });

  it("falls back to score-breakdown connections when surfacing is missing", () => {
    expect(
      digestFootprintLine(
        stub({
          score_breakdown: {
            assessment: null,
            discovery: {
              final_score: 1,
              overall_10: null,
              parts: [],
              age_scalar: null,
              estimated_age: null,
            },
            dials: {
              obscurity: 0.7,
              upside: null,
              age_relative: null,
              connections: 120,
            },
          },
        })
      )
    ).toBe("120 LinkedIn connections · low public profile");
  });

  it("returns null when there is no footprint signal", () => {
    expect(digestFootprintLine(stub())).toBeNull();
  });
});
