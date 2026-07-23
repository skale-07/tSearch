import { useCallback, useEffect, useMemo, useState } from "react";
import {
  fetchCandidates,
  startAssessmentRun,
  type AssessmentCandidateRow,
} from "./api";

type SortKey = "name" | "final_score";

interface Props {
  open: boolean;
  running: boolean;
  digestHint: string | null;
  onClose: () => void;
  onStartRun: (runId: string) => void;
  onError: (message: string) => void;
}

export function AssessPanel({
  open,
  running,
  digestHint,
  onClose,
  onStartRun,
  onError,
}: Props) {
  const [candidates, setCandidates] = useState<AssessmentCandidateRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("final_score");
  const [sortDesc, setSortDesc] = useState(true);
  const [topN, setTopN] = useState(10);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const data = await fetchCandidates();
      setCandidates(data.candidates);
      setSelected(new Set());
    } catch (err) {
      setCandidates([]);
      setLoadError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open) void load();
  }, [open, load]);

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

  const toggleAllVisible = () => {
    const ids = filtered.map((c) => c.candidate_id);
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
    try {
      const { runId } = await startAssessmentRun({
        mode: "selected",
        candidateIds: ids,
      });
      onStartRun(runId);
    } catch (err) {
      onError(err instanceof Error ? err.message : String(err));
    }
  };

  const assessTopN = async () => {
    if (!candidates.length) return;
    try {
      const { runId } = await startAssessmentRun({
        mode: "top_n",
        limit: Math.max(1, Math.floor(topN) || 10),
      });
      onStartRun(runId);
    } catch (err) {
      onError(err instanceof Error ? err.message : String(err));
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
        Ranked from <code>candidates.json</code>. Top N uses discovery{" "}
        <code>final_score</code>.
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

      {candidates.length > 0 && (
        <>
          <div className="assess-actions">
            <button
              type="button"
              className="run-btn"
              disabled={running || selected.size === 0}
              onClick={() => void assessSelected()}
            >
              Assess selected ({selected.size})
            </button>
            <div className="assess-topn">
              <label htmlFor="assess-topn">
                Top N
                <input
                  id="assess-topn"
                  type="number"
                  min={1}
                  max={Math.max(1, candidates.length)}
                  value={topN}
                  onChange={(e) => setTopN(Number(e.target.value))}
                  disabled={running}
                />
              </label>
              <button
                type="button"
                className="run-btn"
                disabled={running || candidates.length === 0}
                onClick={() => void assessTopN()}
              >
                Assess top N
              </button>
            </div>
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
              Toggle visible
            </button>
          </div>

          <ul className="assess-list">
            {filtered.map((c) => (
              <li key={c.candidate_id}>
                <label className="assess-row">
                  <input
                    type="checkbox"
                    checked={selected.has(c.candidate_id)}
                    onChange={() => toggle(c.candidate_id)}
                    disabled={running}
                  />
                  <span className="assess-row-main">
                    <span className="assess-name">{c.name}</span>
                    <span className="assess-meta">
                      <span className="assess-score">
                        {c.final_score.toFixed(1)}
                      </span>
                      {c.has_github && <span className="chip">GitHub</span>}
                      {c.has_writing_surface && (
                        <span className="chip">Writing</span>
                      )}
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
    </aside>
  );
}
