import { assessmentErrorView } from "./errorView";
import {
  candidateStatusTone,
  judgeStatusLabel,
  judgeStatusTone,
  stageLabel,
} from "./assessmentStatus";
import { formatOverallScore } from "./ageDisplay";
import type { AssessmentError, CandidateAssessmentDetail } from "./api";
import {
  resolveEvidenceCitations,
  workCitations,
  worksFromEvidenceIds,
  type EvidenceCitation,
  type WorkCitation,
} from "./evidenceCitations";

type DimensionRow = {
  dimension_id?: string;
  label?: string;
  score?: number | null;
  applicability?: string;
  rationale?: string;
  supporting_evidence_ids?: string[];
  counterevidence_ids?: string[];
};

type JudgeResultBlob = {
  overall_technical_strength?: string;
  overall_writing_depth?: string;
  overall_inquiry_support?: string;
  evidence_support?: string;
  summary?: string;
  relevance?: string;
  reasons?: string[];
  dimensions?: DimensionRow[];
  artifact_ids?: string[];
  strongest_evidence_ids?: string[];
  evidence_ids?: string[];
  model?: string;
  schema_version?: string;
  prompt_version?: string;
};

const JUDGE_ORDER = [
  "technical",
  "writing",
  "cross_artifact",
  "cory",
] as const;

function judgeTitle(judge: string): string {
  switch (judge) {
    case "technical":
      return "Technical";
    case "writing":
      return "Writing";
    case "cross_artifact":
      return "Cross-artifact";
    case "cory":
      return "Cory relevance";
    default:
      return judge;
  }
}

function bandLabel(result: JudgeResultBlob | undefined, judge: string): string | null {
  if (!result) return null;
  if (judge === "technical" && result.overall_technical_strength) {
    return result.overall_technical_strength.replace(/_/g, " ");
  }
  if (judge === "writing" && result.overall_writing_depth) {
    return result.overall_writing_depth.replace(/_/g, " ");
  }
  if (judge === "cross_artifact" && result.overall_inquiry_support) {
    return result.overall_inquiry_support.replace(/_/g, " ");
  }
  if (judge === "cory" && result.relevance) {
    return result.relevance.replace(/_/g, " ");
  }
  return null;
}

function scoreCell(score: number | null | undefined, applicability?: string): string {
  if (applicability && applicability !== "applicable") {
    return applicability.replace(/_/g, " ");
  }
  if (score === null || score === undefined) return "—";
  return String(score);
}

function CitationLinks({
  items,
  empty,
}: {
  items: Array<{ key: string; label: string; href: string; kind?: string }>;
  empty?: string;
}) {
  if (!items.length) {
    return empty ? <span className="muted">{empty}</span> : null;
  }
  return (
    <ul className="assessment-cite-list">
      {items.map((item) => (
        <li key={item.key}>
          <a
            className="assessment-cite-link"
            href={item.href}
            target="_blank"
            rel="noreferrer"
          >
            {item.label}
          </a>
          {item.kind ? <span className="muted"> · {item.kind}</span> : null}
        </li>
      ))}
    </ul>
  );
}

function EvidenceLinks({ items }: { items: EvidenceCitation[] }) {
  if (!items.length) return null;
  return (
    <ul className="assessment-cite-list compact">
      {items.map((item) => (
        <li key={item.evidence_id}>
          <a
            className="assessment-cite-link"
            href={item.href}
            target="_blank"
            rel="noreferrer"
            title={item.artifact_title}
          >
            {item.label}
          </a>
        </li>
      ))}
    </ul>
  );
}

interface Props {
  assessment: CandidateAssessmentDetail;
  runId?: string | null;
  compact?: boolean;
  onRetry?: () => void;
}

export function AssessmentResultView({
  assessment,
  runId,
  compact = false,
  onRetry,
}: Props) {
  const statusTone = candidateStatusTone(assessment.status);
  const rankingValid = Boolean(assessment.synthesis_state?.valid_for_ranking);
  const synthesis = assessment.synthesis ?? {};
  const errors = (assessment.errors ?? []) as AssessmentError[];
  const artifacts = assessment.artifacts;
  const technicalFailed = assessment.judge_statuses?.technical?.status === "failed";
  const hasOtherSuccess = JUDGE_ORDER.some(
    (j) =>
      j !== "technical" &&
      (assessment.judge_statuses?.[j]?.status === "completed" ||
        assessment.judge_statuses?.[j]?.status === "abstained")
  );

  const assessedWorks = workCitations(artifacts);
  const highlightClaims = assessment.digest_summary?.why_highlighted ?? [];
  const synthesisEvidence = resolveEvidenceCitations(
    synthesis.strongest_evidence_ids,
    artifacts
  );
  const synthesisWorks = worksFromEvidenceIds(
    synthesis.strongest_evidence_ids,
    artifacts
  );

  return (
    <div className={`assessment-result ${compact ? "compact" : ""}`}>
      <div className="assessment-result-head">
        <span className={`status-pill ${statusTone}`}>
          {assessment.status.replace(/_/g, " ")}
        </span>
        <span className="muted">{stageLabel(assessment.pipeline_stage)}</span>
        {runId && <span className="muted mono">{runId}</span>}
      </div>

      {assessment.status === "partial" && technicalFailed && hasOtherSuccess && (
        <p className="assessment-partial">
          Partial assessment — technical judging failed. Other collected artifacts
          and successful judge results were preserved.
        </p>
      )}

      <div className="assessment-overview">
        {rankingValid && typeof synthesis.priority_score === "number" ? (
          <p className="assessment-priority">
            Overall{" "}
            <strong>
              {formatOverallScore(
                synthesis.priority_score,
                typeof synthesis.overall_score === "number"
                  ? synthesis.overall_score
                  : null
              )}
            </strong>
          </p>
        ) : (
          <p className="muted">Priority score not valid for ranking</p>
        )}
        {typeof synthesis.archetype === "string" && (
          <p>
            <span className="muted">Archetype</span>{" "}
            {String(synthesis.archetype).replace(/_/g, " ")}
          </p>
        )}
        {typeof synthesis.headline === "string" && (
          <p className="assessment-headline">{synthesis.headline}</p>
        )}
        {typeof synthesis.primary_strength === "string" && rankingValid && (
          <p className="muted">{synthesis.primary_strength}</p>
        )}
      </div>

      {assessedWorks.length > 0 && (
        <section className="assessment-works">
          <h4>Works assessed</h4>
          <CitationLinks items={assessedWorks} />
        </section>
      )}

      {!compact && highlightClaims.length > 0 && (
        <section className="assessment-highlights">
          <h4>Why highlighted</h4>
          <ul className="assessment-highlight-list">
            {highlightClaims.map((item) => {
              const cites = resolveEvidenceCitations(item.evidence_ids, artifacts);
              const works = worksFromEvidenceIds(item.evidence_ids, artifacts);
              return (
                <li key={item.claim}>
                  <strong>{item.claim}</strong>
                  {item.rationale ? (
                    <p className="muted">{item.rationale}</p>
                  ) : null}
                  {works.length > 0 && (
                    <div className="assessment-cite-block">
                      <span className="muted">Projects</span>
                      <CitationLinks items={works} />
                    </div>
                  )}
                  {cites.length > 0 && (
                    <div className="assessment-cite-block">
                      <span className="muted">Evidence</span>
                      <EvidenceLinks items={cites} />
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {!compact && (synthesisWorks.length > 0 || synthesisEvidence.length > 0) && (
        <section className="assessment-works">
          <h4>Strongest cited work</h4>
          {synthesisWorks.length > 0 && <CitationLinks items={synthesisWorks} />}
          {synthesisEvidence.length > 0 && (
            <EvidenceLinks items={synthesisEvidence} />
          )}
        </section>
      )}

      {JUDGE_ORDER.map((judge) => {
        const state = assessment.judge_statuses?.[judge];
        const result = assessment.judge_results?.[judge] as
          | JudgeResultBlob
          | undefined;
        if (!state && !result) return null;
        const status = state?.status ?? (result ? "completed" : "not_run");
        const band = bandLabel(result, judge);
        const judgeWorks = workCitations(artifacts, result?.artifact_ids);
        const strongest = resolveEvidenceCitations(
          result?.strongest_evidence_ids ?? result?.evidence_ids,
          artifacts
        );
        const strongestWorks = worksFromEvidenceIds(
          result?.strongest_evidence_ids ?? result?.evidence_ids,
          artifacts
        );
        return (
          <div key={judge} className="assessment-judge-card">
            <div className="assessment-judge-head">
              <strong>{judgeTitle(judge)}</strong>
              <span className={`judge-chip ${judgeStatusTone(status)}`}>
                {judgeStatusLabel(status)}
              </span>
              {band && <span className="assessment-band">{band}</span>}
            </div>
            {result?.summary && <p>{result.summary}</p>}
            {judge === "cory" && Array.isArray(result?.reasons) && (
              <ul className="assessment-reasons">
                {result.reasons.map((reason) => (
                  <li key={reason}>{reason}</li>
                ))}
              </ul>
            )}
            {!compact && judgeWorks.length > 0 && (
              <div className="assessment-cite-block">
                <span className="muted">Artifacts</span>
                <CitationLinks items={judgeWorks} />
              </div>
            )}
            {!compact && (strongestWorks.length > 0 || strongest.length > 0) && (
              <div className="assessment-cite-block">
                <span className="muted">Strongest evidence</span>
                {strongestWorks.length > 0 && (
                  <CitationLinks items={strongestWorks as WorkCitation[]} />
                )}
                <EvidenceLinks items={strongest} />
              </div>
            )}
            {Array.isArray(result?.dimensions) && result.dimensions.length > 0 && (
              <div className="assessment-dim-table">
                {result.dimensions.map((dim) => {
                  const dimEvidence = resolveEvidenceCitations(
                    dim.supporting_evidence_ids,
                    artifacts
                  );
                  return (
                    <div
                      key={dim.dimension_id ?? dim.label}
                      className="assessment-dim-row"
                    >
                      <span className="assessment-dim-name">
                        {(dim.label ?? dim.dimension_id ?? "").replace(/_/g, " ")}
                      </span>
                      <span className="assessment-dim-score">
                        {scoreCell(dim.score, dim.applicability)}
                      </span>
                      <div className="assessment-dim-body">
                        {!compact && dim.rationale && (
                          <span className="assessment-dim-rationale muted">
                            {dim.rationale}
                          </span>
                        )}
                        {!compact && dimEvidence.length > 0 && (
                          <EvidenceLinks items={dimEvidence} />
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
            {!compact && result?.schema_version && (
              <p className="muted mono">
                {result.schema_version}
                {result.model ? ` · ${result.model}` : ""}
                {result.prompt_version ? ` · ${result.prompt_version}` : ""}
              </p>
            )}
          </div>
        );
      })}

      {errors.length > 0 && (
        <div className="assessment-errors">
          <h4>Errors</h4>
          {errors.map((error, index) => {
            const view = assessmentErrorView(error);
            return (
              <details key={error.id ?? `${error.code}-${index}`} className="assessment-error">
                <summary className="error">
                  {view.title}: {view.message}
                </summary>
                {view.technical_details && (
                  <pre className="assessment-error-details">
                    {view.technical_details}
                  </pre>
                )}
              </details>
            );
          })}
          {onRetry && (
            <button type="button" className="run-btn" onClick={onRetry}>
              Retry candidate
            </button>
          )}
        </div>
      )}
    </div>
  );
}
