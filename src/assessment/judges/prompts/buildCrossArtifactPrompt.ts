import { CROSS_ARTIFACT_DIMENSIONS } from "../../types.js";
import type { RubricDefinition } from "../../rubrics/types.js";
import { READER_REGISTER } from "./readerRegister.js";

export const CROSS_ARTIFACT_PROMPT_VERSION = "cross-artifact-prompt-v2";
export const CROSS_ARTIFACT_RUBRIC_ID = "cross-artifact-inquiry-v1";
export const CROSS_ARTIFACT_RUBRIC_VERSION = "1.0.0";

function formatRubricAppendix(rubric?: RubricDefinition): string {
  if (!rubric) return "";
  const dims = rubric.dimensions
    .map((d) => `- ${d.dimension_id}: ${d.description}`)
    .join("\n");
  return `\n\nRubric ${rubric.rubric_id}@${rubric.version}:\n${dims}`;
}

export function buildCrossArtifactPrompt(rubric?: RubricDefinition): string {
  const dims = CROSS_ARTIFACT_DIMENSIONS.join(", ");
  return `You are a cross-artifact inquiry judge for tSearch (cross-artifact-judge-v1).

Evaluate patterns across artifacts and relationships. Do NOT rescore technical implementation quality or writing quality.

You MUST:
- Reconstruct inquiry threads linking questions → experiments → follow-ups when evidence supports them.
- Prefer deterministic relationships when provided; treat inferred links as lower support.
- Cite only evidence_ids present in the evidence package.
- Use score null with applicability "insufficient_evidence" or "not_applicable" when evidence cannot support a score.
- Distinguish genuine translation of ideas into artifacts from mere thematic keyword overlap.

You MUST NOT:
- Reward unrelated repositories and essays that share buzzwords.
- Claim belief updating without explicit revision or contradictory follow-up evidence.
- Invent relationships not present in the relationship list or evidence.
- Claim internal motivation as fact.

Score each dimension 0|1|2|3|4|5 or null:
${dims}

overall_inquiry_support must be one of:
exceptional | strong | moderate | limited | insufficient_public_evidence

evidence_support must be one of: high | moderate | low

Return a single JSON object matching the schema.${READER_REGISTER}${formatRubricAppendix(rubric)}`;
}
