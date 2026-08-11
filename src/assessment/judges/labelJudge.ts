import { z } from "zod";
import type { LlmJudgeClient } from "./llmClient.js";
import {
  CANDIDATE_LABEL_IDS,
  type AssessmentAxes,
  type CandidateLabelAssignment,
  type CandidateLabelId,
  type CandidateLabelTier,
  type ExperienceJudgeResult,
  type OwnershipAssessmentV2,
} from "../types.js";

export const LABEL_PROMPT_VERSION = "label-prompt-v1";

/**
 * Recruiter-facing label taxonomy. Tier meanings are global:
 *   Tier 1 — meet this week: demonstrated at depth, evidence credible.
 *   Tier 2 — watch closely: genuine signal with verification or depth gaps.
 *   Tier 3 — trace signal: faint but real; keep on the radar.
 */
export const CANDIDATE_LABELS: Record<
  CandidateLabelId,
  { display: string; tagline: string; tiers: Record<CandidateLabelTier, string> }
> = {
  garage_builder: {
    display: "Garage Builder",
    tagline: "Ships real systems on their own steam.",
    tiers: {
      1: "Deep inspectable system(s) they demonstrably own — mechanism visible, sustained commits, credible ownership.",
      2: "Real self-built work with gaps: ownership partly verified, or depth moderate.",
      3: "Builds things, but evidence is thin or ownership unclear.",
    },
  },
  weird_bet_experimentalist: {
    display: "Weird-Bet Experimentalist",
    tagline: "Chases unusual problems and actually runs the experiment.",
    tiers: {
      1: "Rare, substantive problem with a real implementation or experiment and visible iteration.",
      2: "Distinctive problem framing with partial follow-through.",
      3: "Hints of unusual taste; execution not yet visible.",
    },
  },
  conviction_writer: {
    display: "Conviction Writer",
    tagline: "Stakes defended claims in public and backs them.",
    tiers: {
      1: "Definite, demonstrated positions — original analysis or built artifacts behind the claims.",
      2: "Real writing depth with defended positions but limited demonstration.",
      3: "Writes publicly with some substance; conviction or depth still thin.",
    },
  },
  loop_closer: {
    display: "Loop Closer",
    tagline: "Question → build → write-up; closes their own inquiry loops.",
    tiers: {
      1: "Clear closed loops across writing and code with dated progression.",
      2: "At least one credible question-to-artifact thread.",
      3: "Fragments of a loop; artifacts related but not yet connected.",
    },
  },
  wild_card: {
    display: "Wild Card",
    tagline: "Distinctive life path; artifacts thin but variance is high.",
    tiers: {
      1: "Genuinely rare, costly stated path plus at least one strong inspectable artifact.",
      2: "Distinctive concrete path; artifacts sparse or early.",
      3: "Unusual path stated but little to inspect yet.",
    },
  },
  quiet_signal: {
    display: "Quiet Signal",
    tagline: "Not enough public evidence to call — yet.",
    tiers: {
      1: "Strong discovery-side signal (graph position, olympiad record) with a near-empty public surface worth active digging.",
      2: "Some public traces; nothing deep enough to classify.",
      3: "Essentially no public evidence.",
    },
  },
};

export const labelJudgeOutputSchema = z.object({
  label: z.enum(CANDIDATE_LABEL_IDS),
  tier: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  runner_up: z.enum(CANDIDATE_LABEL_IDS).nullable(),
  rationale: z.string().min(1).max(400),
});

export const labelJudgeJsonSchema: Record<string, unknown> = {
  type: "object",
  additionalProperties: false,
  required: ["label", "tier", "runner_up", "rationale"],
  properties: {
    label: { type: "string", enum: [...CANDIDATE_LABEL_IDS] },
    tier: { type: "integer", enum: [1, 2, 3] },
    runner_up: {
      anyOf: [{ type: "string", enum: [...CANDIDATE_LABEL_IDS] }, { type: "null" }],
    },
    rationale: { type: "string", minLength: 1, maxLength: 400 },
  },
} as const;

function labelDefinitionsBlock(): string {
  return (Object.keys(CANDIDATE_LABELS) as CandidateLabelId[])
    .map((id) => {
      const l = CANDIDATE_LABELS[id];
      return `${id} — ${l.display}: ${l.tagline}\n  Tier 1: ${l.tiers[1]}\n  Tier 2: ${l.tiers[2]}\n  Tier 3: ${l.tiers[3]}`;
    })
    .join("\n");
}

export function buildLabelPrompt(): string {
  return `You are the label judge for tSearch (label-judge-v1). You place a candidate into exactly one recruiter-facing label and tier, from already-computed judge results — you never re-score the underlying work.

Labels and tier criteria:
${labelDefinitionsBlock()}

Rules:
- Pick the label whose Tier 1 description this person is closest to becoming, then the tier that matches today's evidence. Tier reflects demonstrated evidence, never potential alone.
- Ownership doubts cap garage_builder at Tier 2. Contrarian tone without demonstration caps conviction_writer at Tier 2.
- wild_card requires a concrete stated path (from the experience judge), not just sparse artifacts.
- quiet_signal is honest, not an insult — prefer it over stretching a label the evidence cannot carry.
- runner_up: the second-closest label, or null when nothing else is close.
- rationale: ONE sentence naming the specific project, post, or experience that drove the call — plain words, no scores, no dimension names.

Return a single JSON object matching the schema.`;
}

export interface LabelJudgeInputs {
  axes?: AssessmentAxes;
  ownership?: OwnershipAssessmentV2;
  experience?: ExperienceJudgeResult;
  technicalSummary?: string;
  writingSummary?: string;
  crossSummary?: string;
}

function finish(
  label: CandidateLabelId,
  tier: CandidateLabelTier,
  rationale: string,
  runner_up: CandidateLabelId | null,
  source: CandidateLabelAssignment["source"]
): CandidateLabelAssignment {
  return {
    label,
    display: CANDIDATE_LABELS[label].display,
    tier,
    runner_up,
    rationale,
    source,
    prompt_version: LABEL_PROMPT_VERSION,
  };
}

/** Offline fallback used in mock mode; mirrors the archetype thresholds. */
export function deterministicLabelTier(
  input: LabelJudgeInputs
): CandidateLabelAssignment {
  const axes = input.axes;
  const score = (a?: { score: number | null; available: boolean }) =>
    a?.available && a.score !== null ? a.score : 0;
  const tech = score(axes?.technical_strength);
  const own = score(axes?.ownership_support);
  const writing = score(axes?.writing_intellectual_depth);
  const cross = score(axes?.cross_artifact_coherence);
  const unusual = score(axes?.unusual_problem_selection);
  const ownClass = input.ownership?.support_class;
  const ownGood =
    own >= 0.55 ||
    ownClass === "medium_ownership_support" ||
    ownClass === "high_ownership_support";
  const expBand = input.experience?.overall_distinctiveness;
  const expStrong = expBand === "strong" || expBand === "exceptional";

  if (unusual >= 0.6 && tech >= 0.5) {
    return finish(
      "weird_bet_experimentalist",
      unusual >= 0.8 && tech >= 0.6 ? 1 : 2,
      "Unusual problem selection with real implementation evidence.",
      "garage_builder",
      "deterministic"
    );
  }
  if (tech >= 0.55 && ownGood) {
    return finish(
      "garage_builder",
      tech >= 0.72 && ownClass === "high_ownership_support" ? 1 : 2,
      "Self-built technical work with credible ownership.",
      expStrong ? "wild_card" : null,
      "deterministic"
    );
  }
  if (cross >= 0.55) {
    return finish(
      "loop_closer",
      cross >= 0.72 ? 1 : 2,
      "Connected question-to-artifact threads across their work.",
      "garage_builder",
      "deterministic"
    );
  }
  if (writing >= 0.55) {
    return finish(
      "conviction_writer",
      writing >= 0.72 ? 1 : 2,
      "Public writing carries the strongest demonstrated signal.",
      null,
      "deterministic"
    );
  }
  if (expStrong) {
    return finish(
      "wild_card",
      tech >= 0.45 ? 1 : 2,
      input.experience?.hook ?? "Distinctive stated path with sparse artifacts.",
      tech >= 0.45 ? "garage_builder" : null,
      "deterministic"
    );
  }
  if (tech >= 0.45) {
    return finish(
      "garage_builder",
      3,
      "Builds things; depth or ownership not yet demonstrated.",
      null,
      "deterministic"
    );
  }
  const anySignal = tech > 0 || writing > 0 || cross > 0;
  return finish(
    "quiet_signal",
    anySignal ? 2 : 3,
    anySignal
      ? "Some public traces, nothing deep enough to classify."
      : "No substantive public evidence yet.",
    null,
    "deterministic"
  );
}

export async function runLabelJudge(input: {
  client: LlmJudgeClient;
  candidateName: string;
  inputs: LabelJudgeInputs;
  model?: string;
  rubricBundleVersion?: string;
}): Promise<CandidateLabelAssignment> {
  const { axes, ownership, experience } = input.inputs;
  const userPayload = {
    candidate: { name: input.candidateName },
    axes: axes ?? null,
    ownership_support: ownership?.support_class ?? null,
    experience: experience
      ? {
          overall_distinctiveness: experience.overall_distinctiveness,
          hook: experience.hook,
          summary: experience.summary,
        }
      : null,
    technical_summary: input.inputs.technicalSummary?.slice(0, 800) ?? null,
    writing_summary: input.inputs.writingSummary?.slice(0, 800) ?? null,
    cross_artifact_summary: input.inputs.crossSummary?.slice(0, 600) ?? null,
  };

  const { value } = await input.client.generateStructured({
    systemPrompt: buildLabelPrompt(),
    userPayload,
    outputSchema: labelJudgeOutputSchema,
    jsonSchema: labelJudgeJsonSchema,
    jsonSchemaName: "label_judge_v1",
    model: input.model,
    cacheNamespace: `label-v1:${LABEL_PROMPT_VERSION}`,
    judgeSchemaVersion: "label-judge-v1",
    rubricBundleVersion: input.rubricBundleVersion,
  });

  return finish(
    value.label,
    value.tier as CandidateLabelTier,
    value.rationale,
    value.runner_up,
    "llm"
  );
}
