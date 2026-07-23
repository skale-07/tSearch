import crypto from "crypto";
import type { CandidateAssessmentRecord } from "../assessment/types.js";
import type { AssessmentRun } from "../assessment/types.js";
import { DIGEST_TOP_N } from "../assessment/config.js";
import type { DigestCandidate, DigestDocument } from "./types.js";
import { DIGEST_SCHEMA_VERSION } from "./types.js";
import { evidenceIndex } from "../assessment/evidence/evidenceValidation.js";

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

function filterClaims(
  claims: DigestCandidate["why_highlighted"],
  evidenceIds: Set<string>
): DigestCandidate["why_highlighted"] {
  return claims.filter((c) => {
    if (!c.evidence_ids.length) return c.claim === "Assessment incomplete";
    return c.evidence_ids.every((id) => evidenceIds.has(id));
  });
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

export function buildDigest(input: {
  run: AssessmentRun;
  assessments: CandidateAssessmentRecord[];
  discoveredCandidateCount: number;
  topN?: number;
}): DigestDocument {
  const topN = input.topN ?? DIGEST_TOP_N;
  const ranked = [...input.assessments]
    .filter((a) => !a.error || a.synthesis.priority_score > 0)
    .sort(
      (a, b) =>
        b.synthesis.priority_score - a.synthesis.priority_score ||
        a.source_candidate.name.localeCompare(b.source_candidate.name)
    )
    .slice(0, Math.min(10, Math.max(5, topN) === topN ? topN : Math.min(10, topN)));

  const selected = ranked.slice(0, Math.min(10, Math.max(ranked.length, 0)));

  const candidates: DigestCandidate[] = selected.map((a, i) => {
    const evidenceIds = new Set(
      a.artifacts.evidence.map((e) => e.evidence_id)
    );
    const technical = avgDims(a, [
      "technical_depth",
      "architecture_depth",
      "implementation_quality",
      "mechanism_depth",
      "algorithmic_or_methodological_depth",
    ]);
    const curiosityScore = a.synthesis.domain_scores.curiosity;
    const whyRaw = a.digest_summary.why_highlighted.length
      ? a.digest_summary.why_highlighted
      : [
          {
            claim: a.synthesis.primary_strength,
            rationale: a.synthesis.overall_rationale.slice(0, 400),
            evidence_ids: a.synthesis.strongest_evidence_ids.slice(0, 3),
          },
        ];
    const why = filterClaims(whyRaw, evidenceIds).slice(0, 3);

    const axes = a.synthesis.axes;
    const writing = axes?.writing_intellectual_depth;
    const cross = axes?.cross_artifact_coherence;
    const assignment = a.synthesis.archetype_assignment;

    return {
      candidate_id: a.candidate_id,
      rank: i + 1,
      name: a.source_candidate.name,
      archetype: a.synthesis.archetype,
      primary_archetype: assignment?.primary ?? a.synthesis.archetype,
      secondary_archetypes: assignment?.secondary?.slice(0, 2) ?? [],
      headline: a.synthesis.headline,
      discovery_score: a.source_candidate.discovery_score,
      assessment_priority_score: a.synthesis.priority_score,
      assessment_confidence: a.synthesis.priority_confidence,
      ownership_support: a.ownership?.support_class,
      evidence_support: axes?.evidence_completeness?.evidence_support,
      why_highlighted: why,
      technical_summary: technical,
      writing_summary: writing
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
      strongest_artifacts: a.artifacts.references.slice(0, 5).map((r) => ({
        artifact_id: r.artifact_id,
        kind: r.kind,
        title: r.title,
        url: r.canonical_url,
        reason_selected: r.selected_reason,
      })),
      important_uncertainties: a.synthesis.important_uncertainties.slice(0, 4),
      next_review_step:
        a.digest_summary.next_review_step || a.synthesis.reason_to_review,
      links: {
        linkedin: a.source_candidate.linkedin_url,
        github: a.source_candidate.github_url,
        website: a.source_candidate.website_url,
        blog: a.source_candidate.blog_url,
      },
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
        "Highlight candidates with inspectable evidence of technical depth, ownership, and self-directed inquiry — not résumé prestige.",
      dimensions: [
        "technical_strength",
        "ownership_support",
        "writing_intellectual_depth",
        "cross_artifact_coherence",
        "observable_inquiry",
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
      ],
    },
    meta: {
      discovered_candidate_count: input.discoveredCandidateCount,
      assessed_candidate_count: input.assessments.length,
      source_candidates_path: input.run.source.candidates_path,
    },
    candidates,
  };
}

void evidenceIndex;
