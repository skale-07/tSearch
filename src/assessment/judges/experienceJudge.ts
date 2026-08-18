import crypto from "crypto";
import type { LlmJudgeClient } from "./llmClient.js";
import {
  EXPERIENCE_PROMPT_VERSION,
  EXPERIENCE_RUBRIC_ID,
  EXPERIENCE_RUBRIC_VERSION,
  buildExperiencePrompt,
} from "./prompts/buildExperiencePrompt.js";
import { experienceJudgeJsonSchema } from "./judgeJsonSchemas.js";
import { experienceJudgeLlmOutputSchema } from "./schemas/experienceJudgeSchema.js";
import {
  EXPERIENCE_DIMENSIONS,
  type ArtifactReference,
  type DimensionAssessmentV2,
  type EvidenceItem,
  type ExperienceJudgeResult,
  type OverallStrengthBand,
} from "../types.js";
import type { RubricDefinition } from "../rubrics/types.js";
import { validateJudgeDimensionsV2 } from "../evidence/evidenceValidation.js";
import { coerceScoredDimensionsForEvidence } from "./normalizeLlmPayload.js";
import { EvidenceStore } from "../evidence/evidenceStore.js";
import { matchAwards } from "../../awards/awardRegistry.js";
import { averageScores, toDimensionScoreV2 } from "./scoreUtils.js";

/** Publicly stated experiences pulled from the frozen candidate record. */
export interface ExperienceProfileInput {
  headline?: string | null;
  experience: Array<{
    title: string;
    company: string | null;
    dates: string | null;
  }>;
  awards: Array<{ title: string; issuer: string | null; date: string | null }>;
  education: Array<{ school: string; years: string | null }>;
  olympiad_prizes: string[];
  linkedin_url?: string;
}

export function hasExperienceContent(p: ExperienceProfileInput): boolean {
  return !!(
    p.headline?.trim() ||
    p.experience.length ||
    p.awards.length ||
    p.olympiad_prizes.length
  );
}

/**
 * Evidence for the experience judge comes from the frozen candidate record
 * (self-reported profile fields), never from a fresh scrape. Strength stays
 * weak for self-reported entries; olympiad prizes come from the CSV record
 * and count as moderate.
 */
export function buildExperienceEvidence(
  candidateId: string,
  profile: ExperienceProfileInput
): { reference: ArtifactReference; evidence: EvidenceItem[] } {
  const h = crypto
    .createHash("sha1")
    .update(`profile:${candidateId}`)
    .digest("hex")
    .slice(0, 12);
  const artifact_id = `art_${h}`;
  const sourceUrl = profile.linkedin_url ?? "about:frozen-profile";

  const reference: ArtifactReference = {
    artifact_id,
    kind: "other",
    title: "Stated profile experiences",
    canonical_url: sourceUrl,
    author_identity_confidence: 0.9,
    candidate_ownership_confidence: 0.9,
    discovered_from: "frozen_candidate_record",
    selected_reason: "experience_judge_input",
    collected_at: new Date().toISOString(),
  };

  const store = new EvidenceStore();
  const add = (
    observation: string,
    claim: string,
    strength: "weak" | "moderate",
    salt: string
  ) =>
    store.create({
      artifact_id,
      source_type: "profile_field",
      source_url: sourceUrl,
      observation: observation.slice(0, 300),
      supports_claim: claim,
      strength,
      candidate_ownership_confidence: 0.9,
      salt,
    });

  if (profile.headline?.trim()) {
    add(profile.headline.trim(), "Self-stated headline", "weak", "headline");
  }
  profile.experience.slice(0, 12).forEach((e, i) => {
    const line = [e.title, e.company, e.dates].filter(Boolean).join(" — ");
    if (line.trim()) add(line, "Self-stated position", "weak", `exp:${i}`);
  });
  // A stated award matching the registry stops being unverifiable self-report:
  // the issuer publishes a named winner list, so a reviewer can check it.
  const awardMatches = matchAwards(
    profile.awards.map((a) => ({ title: a.title, issuer: a.issuer, date: a.date }))
  );
  const matchedText = new Set(awardMatches.map((m) => m.matched_text));
  profile.awards.slice(0, 12).forEach((a, i) => {
    const line = [a.title, a.issuer, a.date].filter(Boolean).join(" — ");
    if (!line.trim()) return;
    const match = matchedText.has(a.title)
      ? awardMatches.find((m) => m.matched_text === a.title)
      : undefined;
    if (match) {
      add(
        line,
        `Award matched to the known-awards registry (${match.award.display_name}, tier ${match.award.prestige_tier})`,
        "moderate",
        `award:${i}`
      );
    } else {
      add(line, "Self-stated award", "weak", `award:${i}`);
    }
  });
  profile.olympiad_prizes.slice(0, 8).forEach((p, i) => {
    if (p.trim()) {
      add(p, "Olympiad record from seed dataset", "moderate", `olympiad:${i}`);
    }
  });
  profile.education.slice(0, 4).forEach((e, i) => {
    const line = [e.school, e.years].filter(Boolean).join(" — ");
    if (line.trim()) add(line, "Self-stated education", "weak", `edu:${i}`);
  });

  return { reference, evidence: store.all() };
}

function scoreBand(avg: number | null): OverallStrengthBand {
  if (avg === null) return "insufficient_public_evidence";
  if (avg >= 4.5) return "exceptional";
  if (avg >= 3.5) return "strong";
  if (avg >= 2.5) return "moderate";
  if (avg >= 1.5) return "limited";
  return "insufficient_public_evidence";
}

export async function runExperienceJudge(input: {
  client: LlmJudgeClient;
  candidateName: string;
  profile: ExperienceProfileInput;
  evidence: EvidenceItem[];
  artifactId: string;
  model?: string;
  rubric?: RubricDefinition;
  rubricBundleVersion?: string;
}): Promise<ExperienceJudgeResult> {
  if (!hasExperienceContent(input.profile)) {
    return deterministicExperienceJudge({
      profile: input.profile,
      evidence: input.evidence,
      artifactId: input.artifactId,
      model: input.model ?? "deterministic-unavailable",
    });
  }

  const evidenceIds = input.evidence.map((e) => e.evidence_id);
  const userPayload = {
    candidate: { name: input.candidateName },
    allowed_evidence_ids: evidenceIds,
    profile: {
      headline: input.profile.headline ?? null,
      experience: input.profile.experience,
      awards: input.profile.awards,
      education: input.profile.education,
      olympiad_prizes: input.profile.olympiad_prizes,
    },
    evidence: input.evidence.map((e) => ({
      evidence_id: e.evidence_id,
      artifact_id: e.artifact_id,
      source_type: e.source_type,
      observation: e.observation,
      supports_claim: e.supports_claim,
      strength: e.strength,
    })),
    required_dimensions: [...EXPERIENCE_DIMENSIONS],
  };

  const { value, model } = await input.client.generateStructured({
    systemPrompt: buildExperiencePrompt(input.rubric),
    userPayload,
    outputSchema: experienceJudgeLlmOutputSchema,
    jsonSchema: experienceJudgeJsonSchema,
    jsonSchemaName: "experience_judge_v1",
    model: input.model,
    cacheNamespace: `experience-v1:${EXPERIENCE_PROMPT_VERSION}`,
    judgeSchemaVersion: "experience-judge-v1",
    rubricBundleVersion: input.rubricBundleVersion ?? EXPERIENCE_RUBRIC_VERSION,
  });

  const allowed = new Set(evidenceIds);
  const strength = new Map(
    input.evidence.map((e) => [e.evidence_id, e.strength] as const)
  );
  const coerced = coerceScoredDimensionsForEvidence(
    {
      ...value,
      strongest_evidence_ids: (value.strongest_evidence_ids ?? []).filter(
        (id) => allowed.has(id)
      ),
      counterevidence_ids: (value.counterevidence_ids ?? []).filter((id) =>
        allowed.has(id)
      ),
    },
    allowed,
    strength
  );

  const result: ExperienceJudgeResult = {
    schema_version: "experience-judge-v1",
    judge_type: "experience",
    artifact_ids: [input.artifactId],
    rubric_id: EXPERIENCE_RUBRIC_ID,
    rubric_version: EXPERIENCE_RUBRIC_VERSION,
    prompt_version: EXPERIENCE_PROMPT_VERSION,
    model,
    ...coerced,
  };
  validateJudgeDimensionsV2(result.dimensions, input.evidence, EXPERIENCE_DIMENSIONS);
  return result;
}

const AGENCY_SIGNALS =
  /\b(founder|founded|co-?founder|built|created|started|launched|shipped|organi[sz]ed|champion|winner|captain)\b/i;
const RARITY_SIGNALS =
  /\b(national|international|olympiad|patent|published|expedition|sailed|champion)\b/i;

/** Deterministic offline experience judge for fixtures / mock defaults. */
export function deterministicExperienceJudge(input: {
  profile: ExperienceProfileInput;
  evidence: EvidenceItem[];
  artifactId: string;
  model?: string;
}): ExperienceJudgeResult {
  const p = input.profile;
  const hasContent = hasExperienceContent(p);
  const evIds = input.evidence.map((e) => e.evidence_id);
  const allText = [
    p.headline ?? "",
    ...p.experience.map((e) => `${e.title} ${e.company ?? ""}`),
    ...p.awards.map((a) => `${a.title} ${a.issuer ?? ""}`),
    ...p.olympiad_prizes,
  ].join(" ");
  const hasAward = p.awards.length > 0 || p.olympiad_prizes.length > 0;
  const hasDates =
    p.experience.some((e) => !!e.dates) || p.awards.some((a) => !!a.date);
  const agency = AGENCY_SIGNALS.test(allText);
  const rarity = RARITY_SIGNALS.test(allText) || hasAward;

  const dimensions: DimensionAssessmentV2[] = EXPERIENCE_DIMENSIONS.map(
    (dimension_id) => {
      if (!hasContent || evIds.length === 0) {
        return {
          dimension_id,
          score: null,
          applicability: "insufficient_evidence" as const,
          rationale: "No stated experiences available in the frozen record.",
          supporting_evidence_ids: [],
          counterevidence_ids: [],
          missing_information: ["Profile experience, awards, or headline"],
        };
      }
      let score = 2;
      if (dimension_id === "experience_rarity") score = rarity ? 3 : 1;
      if (dimension_id === "demonstrated_agency_and_cost") {
        score = agency ? 3 : hasAward ? 2 : 1;
      }
      if (dimension_id === "concreteness_and_verifiability") {
        score = hasDates || p.olympiad_prizes.length ? 3 : 1;
      }
      return {
        dimension_id,
        score: toDimensionScoreV2(score),
        applicability: "applicable" as const,
        rationale: `Derived from ${evIds.length} stated profile field(s).`,
        supporting_evidence_ids: evIds.slice(0, 2),
        counterevidence_ids: [],
        missing_information: ["External verification of self-reported entries"],
      };
    }
  );

  const avg = averageScores(dimensions.map((d) => d.score));
  const hookSource =
    p.awards.find((a) => a.title.trim())?.title ??
    p.experience.find((e) => AGENCY_SIGNALS.test(e.title))?.title ??
    p.olympiad_prizes[0];

  const result: ExperienceJudgeResult = {
    schema_version: "experience-judge-v1",
    judge_type: "experience",
    artifact_ids: [input.artifactId],
    rubric_id: EXPERIENCE_RUBRIC_ID,
    rubric_version: EXPERIENCE_RUBRIC_VERSION,
    prompt_version: EXPERIENCE_PROMPT_VERSION,
    model: input.model ?? "deterministic-fixture",
    dimensions,
    overall_distinctiveness: scoreBand(avg),
    evidence_support: hasContent ? "low" : "low",
    hook:
      hasContent && rarity && hookSource ? hookSource.slice(0, 120) : null,
    strongest_evidence_ids: evIds.slice(0, 3),
    counterevidence_ids: [],
    missing_information: hasContent
      ? ["External verification of self-reported entries"]
      : ["Public profile experience content"],
    summary: hasContent
      ? `Stated path assessed from ${evIds.length} profile field(s); self-reported and unverified.`
      : "Experience distinctiveness unavailable: no stated experiences in the frozen record.",
  };
  validateJudgeDimensionsV2(result.dimensions, input.evidence, EXPERIENCE_DIMENSIONS);
  return result;
}
