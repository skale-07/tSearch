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
});
