import { describe, expect, it } from "vitest";
import {
  validateDimensionAssessment,
  validateSpecialistJudgeResult,
  EvidenceValidationError,
} from "../../src/assessment/evidence/evidenceValidation.js";
import type { EvidenceItem, SpecialistJudgeResult } from "../../src/assessment/types.js";
import { TECHNICAL_DIMENSIONS } from "../../src/assessment/types.js";

const evidence: EvidenceItem[] = [
  {
    evidence_id: "ev_strong",
    artifact_id: "art_1",
    source_type: "github_file",
    source_url: "https://github.com/x/y",
    observation: "Core scheduler module present.",
    supports_claim: "Nontrivial implementation exists.",
    strength: "strong",
    candidate_ownership_confidence: 0.8,
  },
  {
    evidence_id: "ev_weak",
    artifact_id: "art_1",
    source_type: "github_repository_metadata",
    source_url: "https://github.com/x/y",
    observation: "Repo has a README.",
    supports_claim: "Documentation exists.",
    strength: "weak",
    candidate_ownership_confidence: 0.5,
  },
];

describe("evidence validation", () => {
  it("rejects nonexistent evidence IDs", () => {
    expect(() =>
      validateDimensionAssessment(
        {
          dimension: "technical_depth",
          score: 5,
          confidence: 0.5,
          definition: "d",
          rationale: "ok",
          supporting_evidence_ids: ["missing"],
          counterevidence: [],
          missing_information: [],
        },
        new Map(evidence.map((e) => [e.evidence_id, e]))
      )
    ).toThrow(EvidenceValidationError);
  });

  it("rejects score above 10", () => {
    expect(() =>
      validateDimensionAssessment(
        {
          dimension: "technical_depth",
          score: 11,
          confidence: 0.5,
          definition: "d",
          rationale: "ok",
          supporting_evidence_ids: ["ev_weak"],
          counterevidence: [],
          missing_information: [],
        },
        new Map(evidence.map((e) => [e.evidence_id, e]))
      )
    ).toThrow(/out of range/);
  });

  it("rejects high score without strong evidence", () => {
    expect(() =>
      validateDimensionAssessment(
        {
          dimension: "technical_depth",
          score: 9,
          confidence: 0.5,
          definition: "d",
          rationale: "looks deep",
          supporting_evidence_ids: ["ev_weak"],
          counterevidence: [],
          missing_information: [],
        },
        new Map(evidence.map((e) => [e.evidence_id, e]))
      )
    ).toThrow(/strong evidence/);
  });

  it("rejects internal motivation as fact", () => {
    expect(() =>
      validateDimensionAssessment(
        {
          dimension: "technical_depth",
          score: 5,
          confidence: 0.5,
          definition: "d",
          rationale: "They are motivated by curiosity alone.",
          supporting_evidence_ids: ["ev_weak"],
          counterevidence: [],
          missing_information: [],
        },
        new Map(evidence.map((e) => [e.evidence_id, e]))
      )
    ).toThrow(/internal motivation/);
  });

  it("rejects confirmed creator claims with low ownership", () => {
    expect(() =>
      validateDimensionAssessment(
        {
          dimension: "candidate_ownership",
          score: 5,
          confidence: 0.4,
          definition: "d",
          rationale: "Candidate is the sole author of the system.",
          supporting_evidence_ids: ["ev_weak"],
          counterevidence: [],
          missing_information: [],
        },
        new Map(evidence.map((e) => [e.evidence_id, e])),
        { ownershipConfidence: 0.3 }
      )
    ).toThrow(/confirmed-creator/);
  });

  it("accepts valid specialist result", () => {
    const result: SpecialistJudgeResult = {
      judge_type: "technical",
      prompt_version: "technical-v1",
      model: "test",
      input_hash: "h",
      summary: "Solid engineering work with clear ownership signals.",
      dimensions: TECHNICAL_DIMENSIONS.map((dimension) => ({
        dimension,
        score: 5,
        confidence: 0.6,
        definition: dimension,
        rationale: "Supported by repository artifacts.",
        supporting_evidence_ids: ["ev_strong"],
        counterevidence: [],
        missing_information: [],
      })),
      strongest_evidence_ids: ["ev_strong"],
      important_uncertainties: ["u"],
      recommended_human_review: ["r"],
      created_at: new Date().toISOString(),
    };
    expect(() =>
      validateSpecialistJudgeResult(result, evidence, TECHNICAL_DIMENSIONS)
    ).not.toThrow();
  });
});
