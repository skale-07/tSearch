import type {
  EvidenceItem,
  OwnershipAssessment,
  OwnershipAssessmentV2,
  OwnershipSupportClass,
  OwnershipType,
} from "../types.js";
import { EvidenceStore } from "../evidence/evidenceStore.js";
import { shouldIgnorePath } from "./selectSourceFiles.js";

export interface OwnershipCollectInput {
  artifact_id: string;
  repo_url: string;
  repo_owner: string;
  candidate_username: string;
  identity_support: OwnershipAssessmentV2["identity_support"];
  is_fork: boolean;
  is_template?: boolean;
  is_course_or_tutorial?: boolean;

  /** Same unfiltered sample metrics (required for share) */
  repository_commit_count_sampled: number;
  candidate_commits_in_repository_sample: number;
  /** Omit share when identity/sample coverage insufficient */
  candidate_commit_share?: number;
  sample_earliest_commit_at?: string;
  sample_latest_commit_at?: string;

  /** Author-filtered / inspection path (not share numerator) */
  candidate_commit_count: number;
  candidate_pr_count: number;
  candidate_merged_pr_count?: number;

  /** Paths proven changed by candidate that are also selected central */
  candidate_core_file_paths: string[];
  selected_central_paths: string[];

  contribution_span_days?: number;
  active_weeks?: number;
  generated_or_vendored_dominates?: boolean;
  history_predates_candidate?: boolean;
  squash_merge_unreliable?: boolean;
}

export function isCoreContributionPath(
  path: string,
  selectedCentral: Set<string>
): boolean {
  if (!selectedCentral.has(path)) return false;
  if (shouldIgnorePath(path)) return false;
  if (/\.(lock|sum)$/i.test(path)) return false;
  return true;
}

export function ownershipV2ToLegacy(
  v2: OwnershipAssessmentV2
): OwnershipAssessment {
  const map: Record<OwnershipSupportClass, { score: number; type: OwnershipType; confidence: number }> = {
    high_ownership_support: {
      score: 8,
      type: "primary_creator",
      confidence: 0.8,
    },
    medium_ownership_support: {
      score: 6,
      type: "major_contributor",
      confidence: 0.65,
    },
    low_ownership_support: {
      score: 3,
      type: "minor_contributor",
      confidence: 0.5,
    },
    insufficient_public_evidence: {
      score: 2,
      type: "unclear",
      confidence: 0.35,
    },
  };
  const m = map[v2.support_class];
  return {
    score: m.score,
    confidence: m.confidence,
    ownership_type: m.type,
    rationale: v2.summary,
    evidence_ids: v2.supporting_evidence_ids,
    limitations: [
      ...v2.missing_information,
      ...v2.identity_risks,
      ...v2.provenance_risks.map((p) => `${p.type}:${p.severity}`),
    ],
  };
}

export function collectOwnershipEvidence(
  input: OwnershipCollectInput
): { ownership: OwnershipAssessmentV2; evidence: EvidenceItem[] } {
  const store = new EvidenceStore();
  const ownerMatch =
    input.repo_owner.toLowerCase() === input.candidate_username.toLowerCase();

  const supporting: string[] = [];
  const counter: string[] = [];
  const missing: string[] = [];
  const identity_risks: string[] = [];
  const provenance_risks: OwnershipAssessmentV2["provenance_risks"] = [];

  const evOwner = store.create({
    artifact_id: input.artifact_id,
    source_type: "github_repository_metadata",
    source_url: input.repo_url,
    observation: ownerMatch
      ? `Repository owner login matches candidate (${input.candidate_username}).`
      : `Repository owner is ${input.repo_owner}; candidate is ${input.candidate_username}.`,
    supports_claim: ownerMatch
      ? "Candidate is the repository owner account."
      : "Candidate is not the repository owner account.",
    strength: ownerMatch ? "moderate" : "weak",
    candidate_ownership_confidence: ownerMatch ? 0.7 : 0.3,
    salt: "owner",
  });
  if (ownerMatch) supporting.push(evOwner.evidence_id);
  else counter.push(evOwner.evidence_id);

  const shareKnown = input.candidate_commit_share !== undefined;
  const evCommits = store.create({
    artifact_id: input.artifact_id,
    source_type: "github_commit",
    source_url: `${input.repo_url}/commits`,
    observation: shareKnown
      ? `In bounded repository commit sample (${input.repository_commit_count_sampled}), candidate-matched commits=${input.candidate_commits_in_repository_sample} (share=${input.candidate_commit_share!.toFixed(2)}). Recent-window sample only.`
      : `Repository sample size=${input.repository_commit_count_sampled}; candidate-matched=${input.candidate_commits_in_repository_sample}. Share omitted (insufficient identity/coverage).`,
    supports_claim:
      "Bounded recent-window commit share from a single unfiltered sample.",
    strength:
      input.candidate_commits_in_repository_sample >= 5
        ? "strong"
        : input.candidate_commits_in_repository_sample >= 1
          ? "moderate"
          : "weak",
    candidate_ownership_confidence: shareKnown
      ? Math.min(0.9, 0.3 + (input.candidate_commit_share ?? 0))
      : 0.35,
    salt: "repo-sample-commits",
  });
  if (input.candidate_commits_in_repository_sample > 0) {
    supporting.push(evCommits.evidence_id);
  }

  const corePaths = [
    ...new Set(
      input.candidate_core_file_paths.filter((p) =>
        isCoreContributionPath(p, new Set(input.selected_central_paths))
      )
    ),
  ];
  const direct_core = corePaths.length > 0;

  if (direct_core) {
    const evCore = store.create({
      artifact_id: input.artifact_id,
      source_type: "github_commit",
      source_url: input.repo_url,
      observation: `Candidate-attributed changes to selected central files: ${corePaths.slice(0, 8).join(", ")}.`,
      supports_claim: "Direct core-contribution evidence for central paths.",
      strength: "strong",
      candidate_ownership_confidence: 0.85,
      salt: `core:${corePaths.slice(0, 3).join("|")}`,
      location: { file_path: corePaths[0] },
    });
    supporting.push(evCore.evidence_id);
  } else {
    missing.push(
      "No candidate-attributed changed-file evidence for selected central paths."
    );
  }

  if (input.is_fork) {
    provenance_risks.push({
      type: "fork",
      severity: "moderate",
      evidence_ids: [evOwner.evidence_id],
    });
  }
  if (input.is_template) {
    provenance_risks.push({
      type: "template",
      severity: "high",
      evidence_ids: [],
    });
  }
  if (input.is_course_or_tutorial) {
    provenance_risks.push({
      type: "course_assignment",
      severity: "high",
      evidence_ids: [],
    });
  }
  if (input.generated_or_vendored_dominates) {
    provenance_risks.push({
      type: "generated_code",
      severity: "high",
      evidence_ids: [],
    });
  }
  if (input.history_predates_candidate) {
    provenance_risks.push({
      type: "imported_history",
      severity: "moderate",
      evidence_ids: [],
    });
  }

  if (input.identity_support === "low") {
    identity_risks.push("Identity support is low.");
  }

  const hasObservable =
    input.candidate_commit_count > 0 ||
    input.candidate_commits_in_repository_sample > 0 ||
    input.candidate_pr_count > 0 ||
    direct_core;

  let support_class: OwnershipSupportClass;
  if (input.identity_support === "low") {
    support_class = "insufficient_public_evidence";
  } else if (!hasObservable) {
    support_class = "insufficient_public_evidence";
    missing.push("No attributable commits, PRs, or core-file changes observed.");
  } else if (
    direct_core &&
    (input.identity_support === "exact" || input.identity_support === "high") &&
    (ownerMatch || input.candidate_pr_count >= 1 || input.candidate_commits_in_repository_sample >= 3)
  ) {
    support_class = "high_ownership_support";
  } else if (direct_core || input.candidate_pr_count >= 2 || input.candidate_commits_in_repository_sample >= 3) {
    support_class = "medium_ownership_support";
  } else {
    support_class = "low_ownership_support";
  }

  // Gate 4 provenance caps
  const capMedium =
    input.identity_support === "medium" ||
    input.history_predates_candidate ||
    input.generated_or_vendored_dominates ||
    input.squash_merge_unreliable ||
    input.is_course_or_tutorial ||
    (input.is_template && !direct_core);

  if (capMedium && support_class === "high_ownership_support") {
    support_class = "medium_ownership_support";
  }

  // Owner alone without core → never high
  if (!direct_core && support_class === "high_ownership_support") {
    support_class = "medium_ownership_support";
  }

  let evidence_coverage: OwnershipAssessmentV2["evidence_coverage"] = "low";
  if (direct_core && input.repository_commit_count_sampled >= 10) {
    evidence_coverage = "high";
  } else if (hasObservable && input.repository_commit_count_sampled >= 5) {
    evidence_coverage = "medium";
  }

  const ownership: OwnershipAssessmentV2 = {
    schema_version: "ownership-v2",
    support_class,
    evidence_coverage,
    identity_support: input.identity_support,
    direct_core_contribution_present: direct_core,
    contribution_metrics: {
      candidate_commit_count: input.candidate_commit_count,
      repository_commit_count_sampled: input.repository_commit_count_sampled,
      candidate_commits_in_repository_sample:
        input.candidate_commits_in_repository_sample,
      ...(shareKnown
        ? { candidate_commit_share: input.candidate_commit_share }
        : {}),
      sample_earliest_commit_at: input.sample_earliest_commit_at,
      sample_latest_commit_at: input.sample_latest_commit_at,
      candidate_pr_count: input.candidate_pr_count,
      candidate_merged_pr_count: input.candidate_merged_pr_count,
      candidate_core_file_change_count: corePaths.length,
      candidate_core_file_paths: corePaths,
      active_weeks: input.active_weeks,
      contribution_span_days: input.contribution_span_days,
    },
    responsibility_signals: [],
    continuity_signals:
      input.active_weeks && input.active_weeks >= 4
        ? [
            {
              type: "active_weeks",
              evidence_ids: [evCommits.evidence_id],
            },
          ]
        : [],
    provenance_risks,
    identity_risks,
    supporting_evidence_ids: supporting,
    counterevidence_ids: counter,
    missing_information: missing,
    summary: `Ownership ${support_class}; direct_core=${direct_core}; owner_match=${ownerMatch}; sample_share=${shareKnown ? input.candidate_commit_share : "omitted"}.`,
  };

  return { ownership, evidence: store.all() };
}

const SUPPORT_RANK: Record<OwnershipSupportClass, number> = {
  high_ownership_support: 4,
  medium_ownership_support: 3,
  low_ownership_support: 2,
  insufficient_public_evidence: 1,
};

/** Prefer repos with direct core contribution; do not average blindly. */
export function aggregateCandidateOwnership(
  repoOwnerships: OwnershipAssessmentV2[]
): OwnershipAssessmentV2 | undefined {
  if (!repoOwnerships.length) return undefined;
  const withCore = repoOwnerships.filter((o) => o.direct_core_contribution_present);
  const pool = withCore.length ? withCore : repoOwnerships;
  const sorted = [...pool].sort(
    (a, b) => SUPPORT_RANK[b.support_class] - SUPPORT_RANK[a.support_class]
  );
  const best = sorted[0]!;
  const multiCore = withCore.length >= 2;
  if (multiCore && best.support_class === "medium_ownership_support") {
    return {
      ...best,
      summary: `${best.summary} Aggregate: repeated core contribution across ${withCore.length} repositories.`,
      evidence_coverage:
        best.evidence_coverage === "low" ? "medium" : best.evidence_coverage,
    };
  }
  return {
    ...best,
    summary: `Candidate-level ownership from best repository signal: ${best.summary}`,
  };
}
