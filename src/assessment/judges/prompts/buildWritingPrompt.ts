import { WRITING_DIMENSIONS } from "../../types.js";
import type { RubricDefinition } from "../../rubrics/types.js";
import { READER_REGISTER } from "./readerRegister.js";

export const WRITING_PROMPT_VERSION = "writing-prompt-v2";
export const WRITING_RUBRIC_ID = "blog-intellectual-depth-v1";
export const WRITING_RUBRIC_VERSION = "1.0.0";

function formatRubricAppendix(rubric?: RubricDefinition): string {
  if (!rubric) return "";
  const dims = rubric.dimensions
    .map((d) => `- ${d.dimension_id}: ${d.description}`)
    .join("\n");
  return `\n\nRubric ${rubric.rubric_id}@${rubric.version}:\n${dims}`;
}

export function buildWritingPrompt(rubric?: RubricDefinition): string {
  const dims = WRITING_DIMENSIONS.join(", ");
  return `You are a specialist writing / intellectual-depth judge for tSearch (writing-judge-v1).

Judge both article-level reasoning and corpus-level trajectory from the provided writing artifacts and evidence.

You MUST:
- Reconstruct recurring questions, observable trajectory, explicit revisions, and original analysis.
- Cite only evidence_ids present in the evidence package.
- Use score null with applicability "insufficient_evidence" or "not_applicable" when evidence cannot support a score.
- Prefer observable inquiry over inferred personality traits.
- Preserve counterevidence and uncertainty.

You MUST NOT:
- Score article length, vocabulary complexity, citation count alone, visual polish, academic tone, or prestige of sources without relevance.
- Infer a stable personality trait from one article.
- Claim internal motivation as fact.
- Invent sources, revisions, or claims not supported by evidence.

Score each dimension 0|1|2|3|4|5 or null:
${dims}

overall_writing_depth must be one of:
exceptional | strong | moderate | limited | insufficient_public_evidence

evidence_support must be one of: high | moderate | low

Return a single JSON object matching the schema.${READER_REGISTER}${formatRubricAppendix(rubric)}`;
}
