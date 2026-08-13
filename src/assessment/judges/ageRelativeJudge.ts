import { z } from "zod";
import type { LlmJudgeClient } from "./llmClient.js";
import {
  STAGE_NORMS,
  type StageEstimate,
} from "../stage/deriveStage.js";
import type {
  AgeRelativeJudgeResult,
  AssessmentAxes,
  OverallStrengthBand,
} from "../types.js";

export const AGE_RELATIVE_PROMPT_VERSION = "age-relative-prompt-v1";

export const ageRelativeOutputSchema = z.object({
  score: z.number().int().min(1).max(10).nullable(),
  rationale: z.string().min(1).max(400),
});

export const ageRelativeJsonSchema: Record<string, unknown> = {
  type: "object",
  additionalProperties: false,
  required: ["score", "rationale"],
  properties: {
    score: {
      anyOf: [{ type: "integer", minimum: 1, maximum: 10 }, { type: "null" }],
    },
    rationale: { type: "string", minLength: 1, maxLength: 400 },
  },
} as const;

const ANCHORS = `10 — Would be a strong signal from someone five-plus years older. Strangers depend on it, or the result is genuinely novel.
8–9 — Would impress coming from a strong final-year undergraduate; produced at this person's stage instead.
6–7 — Clearly above the stage norm: real systems with real depth, still recognizably student work.
4–5 — Solid for the stage. Competent projects, coursework-plus.
2–3 — Stage-typical. Tutorials, class assignments, standard competition prep.
1 — Below the norm for the stage, or nothing distinguishing.`;

export function buildAgeRelativePrompt(): string {
  return `You are the age-relative impressiveness judge for tSearch (age-relative-judge-v1).

You are given a life-stage estimate and the findings other judges already produced about a candidate's public work. Score how impressive that body of work is FOR SOMEONE AT THAT STAGE, 1–10.

Stage norms:
${Object.entries(STAGE_NORMS)
  .map(([k, v]) => `- ${k}: ${v}`)
  .join("\n")}

Scale:
${ANCHORS}

Rules:
- Score the GAP between this work and the stage norm — not the work's absolute quality. The technical judge already scored quality; repeating it here double-counts. The same artifact should score high for a 17-year-old and moderate for a 26-year-old.
- If the stage is "unknown", return score null. Never substitute a middle score for a missing stage.
- If there is no substantive assessed work, return score null.
- Stage is given to you as stated-date evidence. Do NOT reason about the person's background, circumstances, nationality, school prestige, or access to resources — score relative to age alone.
- rationale: ONE sentence naming the concrete work and why it is (or isn't) remarkable for that stage. No scores, no dimension names, no restating the band.

Return a single JSON object matching the schema.`;
}

export interface AgeRelativeInputs {
  stage: StageEstimate;
  /** Present only after synthesis; the band fields below cover earlier calls. */
  axes?: AssessmentAxes;
  technicalBand?: OverallStrengthBand;
  writingBand?: OverallStrengthBand;
  technicalSummary?: string;
  writingSummary?: string;
  experienceHook?: string | null;
}

function bandTo01(band?: OverallStrengthBand): number {
  switch (band) {
    case "exceptional":
      return 0.9;
    case "strong":
      return 0.75;
    case "moderate":
      return 0.5;
    case "limited":
      return 0.3;
    default:
      return 0;
  }
}

function finish(
  stage: StageEstimate,
  score: number | null,
  rationale: string,
  model: string,
  source: "llm" | "deterministic"
): AgeRelativeJudgeResult {
  return {
    schema_version: "age-relative-judge-v1",
    judge_type: "age_relative",
    prompt_version: AGE_RELATIVE_PROMPT_VERSION,
    model,
    stage_bucket: stage.bucket,
    estimated_age: stage.estimated_age,
    stage_confidence: stage.confidence,
    stage_basis: stage.basis,
    score,
    applicability: score === null ? "insufficient_evidence" : "applicable",
    rationale,
    source,
  };
}

function axisScore(a?: { score: number | null; available: boolean }): number {
  return a?.available && a.score !== null ? a.score : 0;
}

/** Offline fallback: shifts an absolute-quality read by the stage norm. */
export function deterministicAgeRelative(
  input: AgeRelativeInputs,
  model = "deterministic-fixture"
): AgeRelativeJudgeResult {
  const { stage, axes } = input;
  const tech = Math.max(
    axisScore(axes?.technical_strength),
    bandTo01(input.technicalBand)
  );
  const writing = Math.max(
    axisScore(axes?.writing_intellectual_depth),
    bandTo01(input.writingBand)
  );
  const best = Math.max(tech, writing);

  if (stage.bucket === "unknown") {
    return finish(
      stage,
      null,
      "Stage could not be derived from stated dates, so age-relative impressiveness is not scoreable.",
      model,
      "deterministic"
    );
  }
  if (best <= 0) {
    return finish(
      stage,
      null,
      "No substantive assessed work to weigh against the stage norm.",
      model,
      "deterministic"
    );
  }

  // Absolute quality on a 1–10 spine, then shifted by how much the stage
  // norm forgives (younger stages get more credit for the same artifact).
  const stageShift: Record<string, number> = {
    hs_underclass: 3,
    hs_senior: 2,
    early_undergrad: 1,
    late_undergrad: 0,
    post_grad: -1,
  };
  const raw = 1 + best * 8;
  const shifted = Math.round(raw + (stageShift[stage.bucket] ?? 0));
  const score = Math.max(1, Math.min(10, shifted));

  return finish(
    stage,
    score,
    `Assessed public work weighed against the ${stage.bucket.replace(/_/g, " ")} norm.`,
    model,
    "deterministic"
  );
}

export async function runAgeRelativeJudge(input: {
  client: LlmJudgeClient;
  candidateName: string;
  inputs: AgeRelativeInputs;
  model?: string;
  rubricBundleVersion?: string;
}): Promise<AgeRelativeJudgeResult> {
  const { stage } = input.inputs;
  if (stage.bucket === "unknown") {
    return deterministicAgeRelative(input.inputs, "skipped-unknown-stage");
  }

  const userPayload = {
    candidate: { name: input.candidateName },
    stage: {
      bucket: stage.bucket,
      estimated_age: stage.estimated_age,
      confidence: stage.confidence,
      basis: stage.basis,
      explanation: stage.explanation,
    },
    technical_summary: input.inputs.technicalSummary?.slice(0, 900) ?? null,
    writing_summary: input.inputs.writingSummary?.slice(0, 900) ?? null,
    experience_hook: input.inputs.experienceHook ?? null,
  };

  const { value, model } = await input.client.generateStructured({
    systemPrompt: buildAgeRelativePrompt(),
    userPayload,
    outputSchema: ageRelativeOutputSchema,
    jsonSchema: ageRelativeJsonSchema,
    jsonSchemaName: "age_relative_judge_v1",
    model: input.model,
    cacheNamespace: `age-relative-v1:${AGE_RELATIVE_PROMPT_VERSION}`,
    judgeSchemaVersion: "age-relative-judge-v1",
    rubricBundleVersion: input.rubricBundleVersion,
  });

  return finish(stage, value.score, value.rationale, model, "llm");
}
