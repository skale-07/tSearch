import crypto from "crypto";
import type { CandidateAssessmentRecord } from "../assessment/types.js";
import type { AssessmentRun, ArtifactKind } from "../assessment/types.js";
import { DIGEST_MIN_PRIORITY, DIGEST_TOP_N } from "../assessment/config.js";
import type { DigestCandidate, DigestDocument } from "./types.js";
import { DIGEST_SCHEMA_VERSION } from "./types.js";
import type { FeedbackRecord } from "./feedbackStore.js";
import type { ConvergenceEntry } from "../pipeline/convergence.js";
import {
  buildCoryBrief,
  resolveProfileLinks,
  selectNamedWorks,
} from "./buildCoryBrief.js";

function avgDims(
  record: CandidateAssessmentRecord,
  names: string[]
):
  | { score: number; confidence: number; rationale: string; evidence_ids: string[] }
  | undefined {
  const tech = record.judge_results.technical;
  if (!tech) return undefined;
  const dims = tech.dimensions.filter((d) =>
    names.includes(
      "dimension_id" in d && typeof d.dimension_id === "string"
        ? d.dimension_id
        : (d as { dimension?: string }).dimension ?? ""
    )
  );
  if (!dims.length) return undefined;
  const scored = dims.filter(
    (d) => typeof d.score === "number" && d.score !== null
  ) as Array<{
    score: number;
    confidence?: number;
    rationale: string;
    supporting_evidence_ids: string[];
  }>;
  if (!scored.length) return undefined;
  const score = scored.reduce((s, d) => s + d.score, 0) / scored.length;
  const confidence =
    scored.reduce((s, d) => s + (d.confidence ?? 0.6), 0) / scored.length;
  return {
    score: Math.round(score * 10) / 10,
    confidence: Math.round(confidence * 100) / 100,
    rationale: scored.map((d) => d.rationale).join(" "),
    evidence_ids: [
      ...new Set(scored.flatMap((d) => d.supporting_evidence_ids)),
    ],
  };
}

function contentHash(record: CandidateAssessmentRecord): string {
  return crypto
    .createHash("sha1")
    .update(
      JSON.stringify({
        id: record.candidate_id,
        priority: record.synthesis.priority_score,
        archetype: record.synthesis.archetype,
        updated: record.updated_at,
      })
    )
    .digest("hex");
}

function isDigestEligible(
  a: CandidateAssessmentRecord,
  minPriority: number
): boolean {
  if (a.status === "failed" || a.status === "insufficient_context") return false;
  if (a.synthesis_state && a.synthesis_state.valid_for_ranking === false) {
    return false;
  }
  return a.synthesis.priority_score >= minPriority;
}

function clampTopN(topN: number): number {
  return Math.min(10, Math.max(5, Math.round(topN)));
}

export function buildDigest(input: {
  run: AssessmentRun;
  assessments: CandidateAssessmentRecord[];
  discoveredCandidateCount: number;
  topN?: number;
  minPriority?: number;
  /** Reviewer feedback keyed by candidate_id (Phase 4 ranking refinement). */
  feedback?: Map<string, FeedbackRecord>;
  /** Multi-seed bridges keyed by lowercase github login. */
  convergence?: Map<string, ConvergenceEntry>;
}): DigestDocument {
  const topN = clampTopN(input.topN ?? DIGEST_TOP_N);
  const minPriority = input.minPriority ?? DIGEST_MIN_PRIORITY;
  const feedback = input.feedback ?? new Map<string, FeedbackRecord>();

  const verdictOf = (a: CandidateAssessmentRecord) =>
    feedback.get(a.candidate_id)?.latest_verdict;
  // Feedback refines digest ordering/filtering only — priority_score itself
  // is never rewritten, so assessment stays reproducible and auditable.
  const notRejected = (a: CandidateAssessmentRecord) =>
    verdictOf(a) !== "not_relevant";
  const feedbackBoost = (a: CandidateAssessmentRecord) =>
    verdictOf(a) === "relevant" ? 1 : 0;

  const pool = input.assessments.filter(notRejected);
  const feedback_excluded_count = input.assessments.length - pool.length;

  const ranked = [...pool]
    .filter((a) => isDigestEligible(a, minPriority))
    .sort((a, b) => {
      const coryRank = (r?: string) =>
        r === "high" ? 2 : r === "medium" ? 1 : 0;
      const ca = coryRank(a.judge_results.cory?.relevance);
      const cb = coryRank(b.judge_results.cory?.relevance);
      return (
        feedbackBoost(b) - feedbackBoost(a) ||
        b.synthesis.priority_score - a.synthesis.priority_score ||
        cb - ca ||
        a.source_candidate.name.localeCompare(b.source_candidate.name)
      );
    })
    .slice(0, topN);

  // If the floor excluded everyone, fall back to top-N by priority so the
  // digest is never silently empty for a finished run.
  const selected =
    ranked.length > 0
      ? ranked
      : [...pool]
          .filter((a) => a.synthesis.priority_score > 0)
          .sort(
            (a, b) =>
              feedbackBoost(b) - feedbackBoost(a) ||
              b.synthesis.priority_score - a.synthesis.priority_score ||
              a.source_candidate.name.localeCompare(b.source_candidate.name)
          )
          .slice(0, topN);

  const feedback_boosted_count = selected.filter(
    (a) => feedbackBoost(a) === 1
  ).length;

  const candidates: DigestCandidate[] = selected.map((a, i) => {
    const brief = buildCoryBrief(a);
    const works = brief.works.length
      ? brief.works
      : selectNamedWorks(a);
    const technical = avgDims(a, [
      "technical_depth",
      "architecture_depth",
      "implementation_quality",
      "mechanism_depth",
      "algorithmic_or_methodological_depth",
    ]);
    const curiosityScore = a.synthesis.domain_scores.curiosity;
    const axes = a.synthesis.axes;
    const writing = axes?.writing_intellectual_depth;
    const cross = axes?.cross_artifact_coherence;
    const assignment = a.synthesis.archetype_assignment;
    const writingJudge = a.judge_results.writing;

    const reviewerVerdict = verdictOf(a);
    const bridge = input.convergence?.get(
      (a.identity.github_username ?? "").toLowerCase()
    );

    return {
      ...(bridge
        ? {
            network_bridges: {
              seed_count: bridge.seed_count,
              seeds: bridge.seeds,
              collaborator_of: bridge.collaborator_of,
            },
          }
        : {}),
      candidate_id: a.candidate_id,
      rank: i + 1,
      name: a.source_candidate.name,
      ...(reviewerVerdict === "relevant" ||
      reviewerVerdict === "explore_network"
        ? { reviewer_feedback: reviewerVerdict }
        : {}),
      archetype: a.synthesis.archetype,
      primary_archetype: assignment?.primary ?? a.synthesis.archetype,
      secondary_archetypes: assignment?.secondary?.slice(0, 2) ?? [],
      headline: a.synthesis.headline,
      discovery_score: a.source_candidate.discovery_score,
      assessment_priority_score: a.synthesis.priority_score,
      assessment_confidence: a.synthesis.priority_confidence,
      ownership_support: a.ownership?.support_class,
      evidence_support: axes?.evidence_completeness?.evidence_support,
      cory_relevance: brief.cory_relevance,
      cory_reasons: brief.cory_reasons,
      brief_rationale: brief.rationale,
      why_highlighted: [
        {
          claim: brief.claim,
          rationale: brief.rationale,
          evidence_ids: brief.evidence_ids,
        },
      ],
      technical_summary: technical
        ? {
            ...technical,
            rationale:
              a.judge_results.technical?.summary?.slice(0, 500) ??
              technical.rationale,
          }
        : undefined,
      writing_summary: writingJudge
        ? {
            score:
              writing?.score ??
              (writingJudge.overall_writing_depth ===
              "insufficient_public_evidence"
                ? null
                : 0),
            confidence: writing?.available === false ? 0.3 : 0.6,
            rationale: writingJudge.summary,
            evidence_ids: writingJudge.strongest_evidence_ids.slice(0, 3),
            available:
              writingJudge.overall_writing_depth !==
              "insufficient_public_evidence",
          }
        : writing
          ? {
              score: writing.score,
              confidence: writing.available ? 0.6 : 0.3,
              rationale: writing.summary ?? "Writing axis",
              evidence_ids: [],
              available: writing.available,
            }
          : undefined,
      cross_artifact_summary: cross
        ? {
            score: cross.score,
            confidence: cross.available ? 0.6 : 0.3,
            rationale: cross.summary ?? "Cross-artifact axis",
            evidence_ids: [],
            available: cross.available,
          }
        : undefined,
      curiosity_summary: {
        score: curiosityScore ?? 0,
        confidence: Math.min(0.6, a.synthesis.priority_confidence),
        rationale:
          "Observable inquiry / unusual+persistence signals (not intrinsic motivation).",
        evidence_ids: a.synthesis.strongest_evidence_ids.slice(0, 2),
      },
      strongest_artifacts: works.map((w) => ({
        artifact_id: w.artifact_id,
        kind: w.kind as ArtifactKind,
        title: w.title,
        url: w.url,
        reason_selected: "cited_in_cory_brief",
      })),
      important_uncertainties: a.synthesis.important_uncertainties.slice(0, 4),
      next_review_step:
        a.digest_summary.next_review_step || a.synthesis.reason_to_review,
      links: resolveProfileLinks(a),
    };
  });

  const orderedHashes = selected
    .map(contentHash)
    .sort()
    .join("|");
  const digest_id = `digest_${crypto
    .createHash("sha1")
    .update(
      [
        input.run.id,
        DIGEST_SCHEMA_VERSION,
        orderedHashes,
        input.run.config.rubric_bundle_version ?? "legacy-phase2",
        input.run.config.weight_version,
      ].join(":")
    )
    .digest("hex")
    .slice(0, 12)}`;

  return {
    schema_version: DIGEST_SCHEMA_VERSION,
    digest_id,
    assessment_run_id: input.run.id,
    generated_at: new Date().toISOString(),
    versions: {
      assessment_schema_version: input.run.schema_version,
      rubric_bundle_version: input.run.config.rubric_bundle_version,
      priority_weight_version: input.run.config.weight_version,
      prompt_versions: input.run.config.prompt_versions,
    },
    criteria_summary: {
      purpose:
        "Top assessed candidates for Cory review: strong public technical/writing signal with inspectable repos and articles — not résumé prestige.",
      dimensions: [
        "technical_strength",
        "ownership_support",
        "writing_intellectual_depth",
        "cross_artifact_coherence",
        "observable_inquiry",
        "cory_relevance",
        "evidence_completeness",
      ],
      important_non_signals: [
        "Star counts",
        "Institution prestige",
        "Follower counts",
        "Fashionable tech keywords alone",
        "Polished English alone",
      ],
      limitations: [
        "Missing blogs do not zero technical scores.",
        "Ownership requires direct core-contribution evidence for high support.",
        "Discovery score (final_score) is shown separately and is not the assessment priority.",
        `Digest includes candidates at or above priority ${minPriority} (top ${topN}).`,
      ],
    },
    meta: {
      discovered_candidate_count: input.discoveredCandidateCount,
      assessed_candidate_count: input.assessments.length,
      source_candidates_path: input.run.source.candidates_path,
      ...(feedback.size
        ? { feedback_excluded_count, feedback_boosted_count }
        : {}),
    },
    candidates,
  };
}
