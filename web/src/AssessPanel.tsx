import { useCallback, useEffect, useMemo, useState } from "react";
import {
  fetchCandidates,
  fetchAssessmentRunCandidates,
  fetchRunCandidateAssessment,
  pollAssessmentRun,
  retryAssessmentCandidate,
  retryFailedAssessment,
  startAssessmentRun,
  type AssessmentCandidateRow,
  type AssessmentRun,
  type AssessmentRunCandidate,
  type CandidateAssessmentDetail,
} from "./api";
import { assessmentEligibility } from "./eligibility";
import {
  candidateStatusTone,
  judgeAttemptsLabel,
  judgeStatusLabel,
  judgeStatusTone,
  runStatusTone,
  stageLabel,
} from "./assessmentStatus";
import { AssessmentResultView } from "./AssessmentResultView";

type SortKey = "name" | "final_score";

interface Props {
  open: boolean;
  running: boolean;
  digestHint: string | null;
  onClose: () => void;
  onStartRun: (jobId: string) => void;
  onError: (message: string) => void;
  preselectCandidateIds?: string[];
  mockLlm?: boolean;
}

export function AssessPanel({
  open,
  running,
  digestHint,
  onClose,
  onStartRun,
  onError,
  preselectCandidateIds,
  mockLlm = true,
}: Props) {
  const [candidates, setCandidates] = useState<AssessmentCandidateRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("final_score");
  const [sortDesc, setSortDesc] = useState(true);
  const [useMockLlm, setUseMockLlm] = useState(mockLlm);
  const [confirming, setConfirming] = useState(false);
  const [starting, setStarting] = useState(false);
  const [run, setRun] = useState<AssessmentRun | null>(null);
  const [runCandidates, setRunCandidates] = useState<AssessmentRunCandidate[]>([]);
  const [detailCandidateId, setDetailCandidateId] = useState<string | null>(null);
  const [detail, setDetail] = useState<CandidateAssessmentDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const data = await fetchCandidates();
      setCandidates(data.candidates);
      setSelected(
        new Set(
          (preselectCandidateIds ?? []).filter((id) =>
            data.candidates.some(
              (candidate) =>
                candidate.candidate_id === id &&
                assessmentEligibility(candidate).eligible
            )
          )
        )
      );
    } catch (err) {
      setCandidates([]);
      setLoadError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [preselectCandidateIds]);

  useEffect(() => {
    if (open) void load();
  }, [open, load]);

  useEffect(() => {
    setUseMockLlm(mockLlm);
  }, [mockLlm]);

  const refreshRunCandidates = useCallback(async (runId: string) => {
    try {
      setRunCandidates(await fetchAssessmentRunCandidates(runId));
    } catch (err) {
      onError(err instanceof Error ? err.message : String(err));
    }
  }, [onError]);

  useEffect(() => {
    if (!run?.run_id || ["completed", "completed_with_errors", "failed", "interrupted"].includes(run.status)) {
      return;
    }
    const controller = new AbortController();
    void pollAssessmentRun(run.run_id, {
      signal: controller.signal,
      onUpdate: (next) => {
        setRun(next);
        void refreshRunCandidates(next.run_id);
      },
    }).then((finalRun) => {
      setRun(finalRun);
      void refreshRunCandidates(finalRun.run_id);
    }).catch((err: unknown) => {
      if (!(err instanceof DOMException && err.name === "AbortError")) {
        onError(err instanceof Error ? err.message : String(err));
      }
    });
    return () => controller.abort();
  }, [onError, refreshRunCandidates, run?.run_id, run?.status]);

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    let rows = candidates;
    if (q) {
      rows = rows.filter(
        (c) =>
          c.name.toLowerCase().includes(q) ||
          c.github_username?.toLowerCase().includes(q) ||
          c.candidate_id.toLowerCase().includes(q)
      );
    }
    return [...rows].sort((a, b) => {
      if (sortKey === "name") {
        const cmp = a.name.localeCompare(b.name);
        return sortDesc ? -cmp : cmp;
      }
      const cmp = (a.final_score ?? 0) - (b.final_score ?? 0);
      return sortDesc ? -cmp : cmp;
    });
  }, [candidates, filter, sortKey, sortDesc]);

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const eligibleFiltered = useMemo(
    () => filtered.filter((candidate) => assessmentEligibility(candidate).eligible),
    [filtered]
  );

  const toggleAllVisible = () => {
    const ids = eligibleFiltered.map((c) => c.candidate_id);
    setSelected((prev) => {
      const allOn = ids.every((id) => prev.has(id));
      const next = new Set(prev);
      if (allOn) {
        for (const id of ids) next.delete(id);
      } else {
        for (const id of ids) next.add(id);
      }
      return next;
    });
  };

  const assessSelected = async () => {
    const ids = [...selected];
    if (!ids.length) return;
    setStarting(true);
    try {
      const result = await startAssessmentRun({
        candidate_ids: ids,
        mock_llm: useMockLlm,
        skip_digest: true,
      });
      setRun({
        run_id: result.run_id,
        status: result.status,
        revision: 0,
        mock_llm: useMockLlm,
        candidate_count: result.eligible_count,
        counts: { pending: result.eligible_count, active: 0, completed: 0, partial: 0, failed: 0, insufficient_context: 0 },
        errors: [],
      });
      setConfirming(false);
      onStartRun(result.job_id);
    } catch (err) {
      onError(err instanceof Error ? err.message : String(err));
    } finally {
      setStarting(false);
    }
  };

  const selectAllEligible = () => {
    setSelected(new Set(candidates.filter((c) => assessmentEligibility(c).eligible).map((c) => c.candidate_id)));
  };

  const retryAllFailed = async () => {
    if (!run) return;
    try {
      const result = await retryFailedAssessment(run.run_id);
      setRun({ ...run, status: "queued" });
      onStartRun(result.job_id);
    } catch (err) {
      onError(err instanceof Error ? err.message : String(err));
    }
  };

  const retryCandidate = async (candidateId: string) => {
    if (!run) return;
    try {
      const result = await retryAssessmentCandidate(run.run_id, candidateId);
      setRun({ ...run, status: "queued" });
      onStartRun(result.job_id);
    } catch (err) {
      onError(err instanceof Error ? err.message : String(err));
    }
  };

  const openDetail = async (candidateId: string) => {
    if (!run) return;
    setDetailCandidateId(candidateId);
    setDetailLoading(true);
    setDetail(null);
    try {
      const result = await fetchRunCandidateAssessment(run.run_id, candidateId);
      setDetail(result.assessment);
    } catch (err) {
      onError(err instanceof Error ? err.message : String(err));
      setDetailCandidateId(null);
    } finally {
      setDetailLoading(false);
    }
  };

  if (!open) return null;

  return (
    <aside className="panel assess-panel open">
      <div className="panel-head">
        <button type="button" className="panel-close" onClick={onClose}>
          Close
        </button>
      </div>

      <p className="eyebrow">Assessment</p>
      <h2>Assess</h2>
      <p className="muted assess-hint">
        Choose candidates with a GitHub path or writing surface. Assessment does
        not run discovery, email collection, or digest generation.
      </p>

      <div className="assess-toolbar">
        <button
          type="button"
          className="run-btn"
          onClick={() => void load()}
          disabled={loading || running}
        >
          {loading ? "Loading…" : "Refresh"}
        </button>
        <input
          type="search"
          className="assess-filter"
          placeholder="Filter…"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          disabled={running}
        />
      </div>

      {loadError && <p className="error">{loadError}</p>}

      {!loadError && !loading && candidates.length === 0 && (
        <p className="muted">No candidates yet — run discovery first.</p>
      )}

      {run && (
        <section className="assess-progress">
          <div className="assess-progress-head">
            <strong>Run {run.status.replace(/_/g, " ")}</strong>
            <span className={`status-tone ${runStatusTone(run.status)}`}>{run.candidate_count} candidates</span>
          </div>
          <p className="muted">
            {run.counts.completed} completed · {run.counts.partial} partial · {run.counts.failed} failed · {run.counts.active} active · {run.counts.pending} pending
          </p>
          {run.counts.failed > 0 && (
            <button type="button" className="chip assess-retry" onClick={() => void retryAllFailed()} disabled={running}>
              Retry all failed
            </button>
          )}
          {runCandidates.length > 0 && (
            <ul className="assess-list assess-run-list">
              {runCandidates.map((candidate) => (
                <li key={candidate.candidate_id}>
                  <div className="assess-row">
                    <button
                      type="button"
                      className="assess-row-main assess-row-btn"
                      onClick={() => void openDetail(candidate.candidate_id)}
                    >
                      <span className="assess-name">{candidate.name}</span>
                      <span className="assess-meta">
                        <span className={`status-tone ${candidateStatusTone(candidate.status)}`}>{candidate.status.replace(/_/g, " ")}</span>
                        <span className="chip">{stageLabel(candidate.pipeline_stage)}</span>
                        {Object.entries(candidate.judge_statuses).map(([judge, state]) => (
                          <span key={judge} className={`judge-chip ${judgeStatusTone(state.status)}`} title={judgeAttemptsLabel(state.attempt_count) ?? undefined}>
                            {judge.replace(/_/g, " ")}: {judgeStatusLabel(state.status)}
                          </span>
                        ))}
                        {candidate.synthesis_valid && typeof candidate.priority_score === "number" && (
                          <span className="assess-score">Priority {candidate.priority_score.toFixed(1)}</span>
                        )}
                      </span>
                    </button>
                    {(candidate.status === "failed" || candidate.status === "partial") && (
                      <button type="button" className="chip assess-retry" onClick={() => void retryCandidate(candidate.candidate_id)} disabled={running}>
                        Retry
                      </button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
          {(detailLoading || detail) && (
            <div className="assess-detail">
              <div className="assess-detail-head">
                <strong>Candidate result</strong>
                <button type="button" className="chip" onClick={() => { setDetail(null); setDetailCandidateId(null); }}>
                  Close detail
                </button>
              </div>
              {detailLoading && <p className="muted">Loading assessment…</p>}
              {detail && (
                <AssessmentResultView
                  assessment={detail}
                  runId={run.run_id}
                  onRetry={
                    detailCandidateId
                      ? () => void retryCandidate(detailCandidateId)
                      : undefined
                  }
                />
              )}
            </div>
          )}
        </section>
      )}

      {candidates.length > 0 && (
        <>
          <div className="assess-actions">
            <button
              type="button"
              className="run-btn"
              disabled={running || selected.size === 0}
              onClick={() => setConfirming(true)}
            >
              Run assessment on {selected.size} candidates
            </button>
            <button type="button" className="chip" disabled={running} onClick={selectAllEligible}>
              Run all eligible ({candidates.filter((c) => assessmentEligibility(c).eligible).length})
            </button>
            <button type="button" className="chip" disabled={running || selected.size === 0} onClick={() => setSelected(new Set())}>
              Clear selection
            </button>
          </div>

          <div className="assess-sort">
            <button
              type="button"
              className="chip"
              onClick={() => {
                setSortKey("final_score");
                setSortDesc((d) => (sortKey === "final_score" ? !d : true));
              }}
            >
              Score {sortKey === "final_score" ? (sortDesc ? "↓" : "↑") : ""}
            </button>
            <button
              type="button"
              className="chip"
              onClick={() => {
                setSortKey("name");
                setSortDesc((d) => (sortKey === "name" ? !d : false));
              }}
            >
              Name {sortKey === "name" ? (sortDesc ? "↓" : "↑") : ""}
            </button>
            <button type="button" className="chip" onClick={toggleAllVisible}>
              Select visible eligible
            </button>
          </div>

          <ul className="assess-list">
            {filtered.map((c) => (
              <li key={c.candidate_id}>
                <label className={`assess-row ${assessmentEligibility(c).eligible ? "" : "assess-ineligible"}`}>
                  <input
                    type="checkbox"
                    checked={selected.has(c.candidate_id)}
                    onChange={() => toggle(c.candidate_id)}
                    disabled={running || !assessmentEligibility(c).eligible}
                  />
                  <span className="assess-row-main">
                    <span className="assess-name">{c.name}</span>
                    <span className="assess-meta">
                      <span className="assess-score">
                        {c.final_score.toFixed(1)}
                      </span>
                      <span className={`chip ${assessmentEligibility(c).githubPathAvailable ? "chip-on" : "chip-off"}`}>GitHub path available</span>
                      <span className={`chip ${assessmentEligibility(c).writingEligible ? "chip-on" : "chip-off"}`}>Writing</span>
                      {!assessmentEligibility(c).eligible && <span className="chip">Insufficient context</span>}
                    </span>
                  </span>
                </label>
              </li>
            ))}
          </ul>
        </>
      )}

      {digestHint && (
        <p className="assess-digest">
          Digest: <code>{digestHint}</code>
        </p>
      )}
      {confirming && (
        <div className="assess-modal-backdrop" role="presentation">
          <section className="assess-modal" role="dialog" aria-modal="true" aria-labelledby="assess-confirm-title">
            <h3 id="assess-confirm-title">Confirm assessment run</h3>
            <p>{selected.size} requested · {selected.size} eligible · 0 skipped</p>
            <ul>
              <li>GitHub and writing paths run only where available.</li>
              <li>Discovery and email collection are off.</li>
              <li>Digest generation is skipped.</li>
            </ul>
            <label className="assess-live-toggle">
              <input type="checkbox" checked={!useMockLlm} onChange={(event) => setUseMockLlm(!event.target.checked)} />
              Use live LLM
            </label>
            {!useMockLlm && <p className="error">Live LLM can incur cost and send selected assessment context to the configured provider.</p>}
            <div className="assess-modal-actions">
              <button type="button" className="chip" onClick={() => setConfirming(false)} disabled={starting}>Cancel</button>
              <button type="button" className="run-btn" onClick={() => void assessSelected()} disabled={starting}>
                {starting ? "Starting…" : `Run ${useMockLlm ? "mock" : "live"} assessment`}
              </button>
            </div>
          </section>
        </div>
      )}
    </aside>
  );
}
