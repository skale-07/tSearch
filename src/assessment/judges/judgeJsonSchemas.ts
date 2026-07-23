/**
 * Compact JSON Schemas for OpenAI strict structured outputs.
 * Kept hand-written so we control OpenAI strict-mode constraints
 * (additionalProperties: false, required on all keys).
 */

const dimensionAssessmentV2JsonSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "dimension_id",
    "score",
    "applicability",
    "rationale",
    "supporting_evidence_ids",
    "counterevidence_ids",
    "missing_information",
  ],
  properties: {
    dimension_id: { type: "string", minLength: 1 },
    score: {
      anyOf: [
        { type: "integer", enum: [0, 1, 2, 3, 4, 5] },
        { type: "null" },
      ],
    },
    applicability: {
      type: "string",
      enum: ["applicable", "not_applicable", "insufficient_evidence"],
    },
    rationale: { type: "string", minLength: 1 },
    supporting_evidence_ids: {
      type: "array",
      items: { type: "string" },
    },
    counterevidence_ids: {
      type: "array",
      items: { type: "string" },
    },
    missing_information: {
      type: "array",
      items: { type: "string" },
    },
  },
} as const;

const overallStrengthBand = {
  type: "string",
  enum: [
    "exceptional",
    "strong",
    "moderate",
    "limited",
    "insufficient_public_evidence",
  ],
} as const;

const evidenceSupportLevel = {
  type: "string",
  enum: ["high", "moderate", "low"],
} as const;

export const technicalJudgeV2JsonSchema: Record<string, unknown> = {
  type: "object",
  additionalProperties: false,
  required: [
    "artifact_reconstruction",
    "dimensions",
    "strongest_evidence_ids",
    "counterevidence_ids",
    "unsupported_or_unverifiable_claims",
    "missing_information",
    "overall_technical_strength",
    "evidence_support",
    "summary",
  ],
  properties: {
    artifact_reconstruction: {
      type: "object",
      additionalProperties: false,
      required: [
        "problem",
        "claimed_mechanism",
        "visible_architecture",
        "validation_approach",
        "unresolved_questions",
        "evidence_ids",
      ],
      properties: {
        problem: { type: "string", minLength: 1 },
        claimed_mechanism: { type: "string", minLength: 1 },
        visible_architecture: { type: "string", minLength: 1 },
        validation_approach: { type: "string", minLength: 1 },
        unresolved_questions: { type: "array", items: { type: "string" } },
        evidence_ids: { type: "array", items: { type: "string" } },
      },
    },
    dimensions: {
      type: "array",
      items: dimensionAssessmentV2JsonSchema,
    },
    strongest_evidence_ids: { type: "array", items: { type: "string" } },
    counterevidence_ids: { type: "array", items: { type: "string" } },
    unsupported_or_unverifiable_claims: {
      type: "array",
      items: { type: "string" },
    },
    missing_information: { type: "array", items: { type: "string" } },
    overall_technical_strength: overallStrengthBand,
    evidence_support: evidenceSupportLevel,
    summary: { type: "string", minLength: 1 },
  },
} as const;

export const writingJudgeJsonSchema: Record<string, unknown> = {
  type: "object",
  additionalProperties: false,
  required: [
    "corpus_reconstruction",
    "dimensions",
    "strongest_evidence_ids",
    "counterevidence_ids",
    "missing_information",
    "overall_writing_depth",
    "evidence_support",
    "summary",
  ],
  properties: {
    corpus_reconstruction: {
      type: "object",
      additionalProperties: false,
      required: [
        "recurring_questions",
        "observable_trajectory",
        "explicit_revisions",
        "original_analysis_artifacts",
        "evidence_ids",
      ],
      properties: {
        recurring_questions: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            required: ["question", "artifact_ids", "evidence_ids"],
            properties: {
              question: { type: "string", minLength: 1 },
              artifact_ids: { type: "array", items: { type: "string" } },
              evidence_ids: { type: "array", items: { type: "string" } },
            },
          },
        },
        observable_trajectory: { type: "string", minLength: 1 },
        explicit_revisions: { type: "array", items: { type: "string" } },
        original_analysis_artifacts: {
          type: "array",
          items: { type: "string" },
        },
        evidence_ids: { type: "array", items: { type: "string" } },
      },
    },
    dimensions: {
      type: "array",
      items: dimensionAssessmentV2JsonSchema,
    },
    strongest_evidence_ids: { type: "array", items: { type: "string" } },
    counterevidence_ids: { type: "array", items: { type: "string" } },
    missing_information: { type: "array", items: { type: "string" } },
    overall_writing_depth: overallStrengthBand,
    evidence_support: evidenceSupportLevel,
    summary: { type: "string", minLength: 1 },
  },
} as const;

export const crossArtifactJudgeJsonSchema: Record<string, unknown> = {
  type: "object",
  additionalProperties: false,
  required: [
    "reconstructed_inquiry_threads",
    "dimensions",
    "overall_inquiry_support",
    "evidence_support",
    "strongest_evidence_ids",
    "counterevidence_ids",
    "missing_information",
    "summary",
  ],
  properties: {
    reconstructed_inquiry_threads: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: [
          "thread_id",
          "question_or_theme",
          "ordered_artifact_ids",
          "relationship_ids",
          "evidence_ids",
          "interpretation",
          "counterevidence",
        ],
        properties: {
          thread_id: { type: "string", minLength: 1 },
          question_or_theme: { type: "string", minLength: 1 },
          ordered_artifact_ids: { type: "array", items: { type: "string" } },
          relationship_ids: { type: "array", items: { type: "string" } },
          evidence_ids: { type: "array", items: { type: "string" } },
          interpretation: { type: "string", minLength: 1 },
          counterevidence: { type: "array", items: { type: "string" } },
        },
      },
    },
    dimensions: {
      type: "array",
      items: dimensionAssessmentV2JsonSchema,
    },
    overall_inquiry_support: overallStrengthBand,
    evidence_support: evidenceSupportLevel,
    strongest_evidence_ids: { type: "array", items: { type: "string" } },
    counterevidence_ids: { type: "array", items: { type: "string" } },
    missing_information: { type: "array", items: { type: "string" } },
    summary: { type: "string", minLength: 1 },
  },
} as const;

export const coryRelevanceJsonSchema: Record<string, unknown> = {
  type: "object",
  additionalProperties: false,
  required: [
    "relevance",
    "reasons",
    "evidence_ids",
    "human_review_recommended",
  ],
  properties: {
    relevance: {
      type: "string",
      enum: ["high", "medium", "low", "insufficient_evidence"],
    },
    reasons: {
      type: "array",
      items: { type: "string" },
      minItems: 1,
    },
    evidence_ids: { type: "array", items: { type: "string" } },
    human_review_recommended: { type: "boolean" },
  },
} as const;
