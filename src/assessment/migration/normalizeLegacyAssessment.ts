import type { CandidateAssessmentRecord } from "../types.js";
import { ASSESSMENT_SCHEMA_VERSION } from "../types.js";

/**
 * Normalize legacy Phase-2 assessment records for digest regeneration.
 * Does not rewrite files on disk.
 */
export function normalizeLegacyAssessment(
  record: CandidateAssessmentRecord
): CandidateAssessmentRecord {
  if (record.schema_version === ASSESSMENT_SCHEMA_VERSION) {
    return record;
  }
  return {
    ...record,
    schema_version: ASSESSMENT_SCHEMA_VERSION,
    ownership: record.ownership,
    synthesis: {
      ...record.synthesis,
      weight_version: record.synthesis.weight_version || "priority-v1",
      archetype_assignment: record.synthesis.archetype_assignment ?? {
        primary: record.synthesis.archetype,
        secondary: [],
        evidence_ids: record.synthesis.strongest_evidence_ids,
        confidence_support: "low",
      },
    },
  };
}

export function isLegacyAssessmentSchema(version: string): boolean {
  return version === "1.0.0" || version.startsWith("1.");
}
