import { describe, expect, it } from "vitest";
import { normalizeLlmPayload } from "../../src/assessment/judges/normalizeLlmPayload.js";
import { parseWithSchema } from "../../src/assessment/schemas.js";
import { technicalJudgeLlmOutputV2Schema } from "../../src/assessment/judges/schemas/technicalJudgeSchema.js";
import { TECHNICAL_DIMENSIONS_V2 } from "../../src/assessment/types.js";
import { MockLlmJudgeClient } from "../../src/assessment/judges/llmClient.js";

function dimObjectEntry(id: string, score: number) {
  return {
    score,
    applicability: "applicable",
    rationale: `Rationale for ${id}`,
    supporting_evidence_ids: ["ev1"],
    counterevidence_ids: [],
    missing_information: [],
  };
}

/** Malformed shape that previously broke live OpenAI runs (dimensions as object). */
function malformedTechnicalV2Payload() {
  const dimensions: Record<string, unknown> = {};
  for (const id of TECHNICAL_DIMENSIONS_V2) {
    dimensions[id] = dimObjectEntry(id, 3);
  }
  return {
    artifact_reconstruction: {
      problem: "p",
      claimed_mechanism: "m",
      visible_architecture: "a",
      validation_approach: "v",
      unresolved_questions: [],
      evidence_ids: ["ev1"],
    },
    dimensions,
    strongest_evidence_ids: ["ev1"],
    counterevidence_ids: [],
    unsupported_or_unverifiable_claims: [],
    missing_information: [],
    overall_technical_strength: "moderate",
    evidence_support: "moderate",
    summary: "ok",
  };
}

describe("normalizeLlmPayload + technical v2 schema", () => {
  it("maps dimensions object keyed by id into array and parses", () => {
    const raw = malformedTechnicalV2Payload();
    const normalized = normalizeLlmPayload(raw);
    const value = parseWithSchema(
      technicalJudgeLlmOutputV2Schema,
      normalized,
      "test"
    );
    expect(value.dimensions).toHaveLength(TECHNICAL_DIMENSIONS_V2.length);
    expect(value.dimensions[0].dimension_id).toBe(TECHNICAL_DIMENSIONS_V2[0]);
    expect(value.summary).toBe("ok");
  });

  it("passes through already-valid dimension arrays", () => {
    const raw = malformedTechnicalV2Payload();
    const asArray = {
      ...raw,
      dimensions: TECHNICAL_DIMENSIONS_V2.map((id) => ({
        dimension_id: id,
        ...dimObjectEntry(id, 2),
      })),
    };
    const value = parseWithSchema(
      technicalJudgeLlmOutputV2Schema,
      normalizeLlmPayload(asArray),
      "test"
    );
    expect(value.dimensions).toHaveLength(TECHNICAL_DIMENSIONS_V2.length);
  });

  it("MockLlmJudgeClient normalizes before Zod parse", async () => {
    const client = new MockLlmJudgeClient(() => malformedTechnicalV2Payload());
    const result = await client.generateStructured({
      systemPrompt: "sys",
      userPayload: {},
      outputSchema: technicalJudgeLlmOutputV2Schema,
      cacheNamespace: `test-normalize-${Date.now()}`,
    });
    expect(result.value.dimensions).toHaveLength(TECHNICAL_DIMENSIONS_V2.length);
  });

  it("nulls score when applicability is not_applicable (live failure shape)", () => {
    const raw = {
      ...malformedTechnicalV2Payload(),
      dimensions: TECHNICAL_DIMENSIONS_V2.map((id, i) => ({
        dimension_id: id,
        score: i >= 5 ? 2 : 3,
        applicability: i >= 5 ? "not_applicable" : "applicable",
        rationale: `Rationale for ${id}`,
        supporting_evidence_ids: i >= 5 ? [] : ["ev1"],
        counterevidence_ids: [],
        missing_information: [],
      })),
    };
    const value = parseWithSchema(
      technicalJudgeLlmOutputV2Schema,
      normalizeLlmPayload(raw),
      "test"
    );
    expect(value.dimensions.filter((d) => d.applicability !== "applicable").every((d) => d.score === null)).toBe(true);
  });
});

describe("coerceScoredDimensionsForEvidence", () => {
  it("demotes scored dimensions with no evidence instead of throwing", async () => {
    const { coerceScoredDimensionsForEvidence } = await import(
      "../../src/assessment/judges/normalizeLlmPayload.js"
    );
    const coerced = coerceScoredDimensionsForEvidence(
      {
        dimensions: [
          {
            dimension_id: "problem_difficulty",
            score: 3,
            applicability: "applicable",
            rationale: "Hard problem",
            supporting_evidence_ids: [],
            counterevidence_ids: [],
            missing_information: [],
          },
        ],
        strongest_evidence_ids: [],
      },
      new Set(["ev1"])
    );
    expect(coerced.dimensions[0]?.score).toBeNull();
    expect(coerced.dimensions[0]?.applicability).toBe("insufficient_evidence");
  });

  it("backfills from strongest_evidence_ids when present", async () => {
    const { coerceScoredDimensionsForEvidence } = await import(
      "../../src/assessment/judges/normalizeLlmPayload.js"
    );
    const coerced = coerceScoredDimensionsForEvidence(
      {
        dimensions: [
          {
            dimension_id: "problem_difficulty",
            score: 3,
            applicability: "applicable",
            rationale: "Hard problem",
            supporting_evidence_ids: [],
            counterevidence_ids: [],
            missing_information: [],
          },
        ],
        strongest_evidence_ids: ["ev1"],
      },
      new Set(["ev1"])
    );
    expect(coerced.dimensions[0]?.score).toBe(3);
    expect(coerced.dimensions[0]?.supporting_evidence_ids).toEqual(["ev1"]);
  });

  it("covers the writing intellectual_honesty failure mode", async () => {
    const { coerceScoredDimensionsForEvidence } = await import(
      "../../src/assessment/judges/normalizeLlmPayload.js"
    );
    const { validateJudgeDimensionsV2 } = await import(
      "../../src/assessment/evidence/evidenceValidation.js"
    );
    const { WRITING_DIMENSIONS } = await import(
      "../../src/assessment/types.js"
    );
    const evidence = [
      {
        evidence_id: "ev_w1",
        artifact_id: "art_1",
        source_type: "article_section" as const,
        source_url: "https://example.com/post",
        observation: "Claims a limitation",
        supports_claim: "honesty",
        strength: "moderate" as const,
        candidate_ownership_confidence: 0.7,
      },
    ];
    const coerced = coerceScoredDimensionsForEvidence(
      {
        dimensions: WRITING_DIMENSIONS.map((dimension_id) => ({
          dimension_id,
          score: dimension_id === "intellectual_honesty" ? 1 : 2,
          applicability: "applicable",
          rationale: "scored",
          supporting_evidence_ids:
            dimension_id === "intellectual_honesty" ? [] : ["ev_w1"],
          counterevidence_ids: [],
          missing_information: [],
        })),
        strongest_evidence_ids: [],
      },
      new Set(["ev_w1"])
    );
    expect(
      coerced.dimensions.find((d) => d.dimension_id === "intellectual_honesty")
    ).toMatchObject({
      score: null,
      applicability: "insufficient_evidence",
    });
    expect(() =>
      validateJudgeDimensionsV2(
        coerced.dimensions as never,
        evidence,
        WRITING_DIMENSIONS
      )
    ).not.toThrow();
  });
});
