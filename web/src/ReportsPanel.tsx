import { useEffect, useState } from "react";
import {
  ASSESSED_SORT_LABELS,
  assessedProfileUrl,
  fetchAssessed,
  type AssessedRow,
  type AssessedSort,
} from "./api";
import { formatOverallScore } from "./ageDisplay";

interface Props {
  open: boolean;
  /** When true, render as Score page content (not a slide-over). */
  embedded?: boolean;
  onClose?: () => void;
}

function timeAgo(iso: string): string {
  const ms = Date.now() - Date.parse(iso);
  if (!Number.isFinite(ms) || ms < 0) return "";
  const days = Math.floor(ms / 86_400_000);
  if (days > 0) return `${days}d ago`;
  const hours = Math.floor(ms / 3_600_000);
  if (hours > 0) return `${hours}h ago`;
  return "just now";
}

/** Everyone the judge has run on, with the digest-style profile a click away. */
export function ReportsPanel({ open, embedded = false, onClose }: Props) {
  const [rows, setRows] = useState<AssessedRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [viewing, setViewing] = useState<AssessedRow | null>(null);
  const [sort, setSort] = useState<AssessedSort>("recent");

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetchAssessed(sort)
      .then((data) => {
        if (!cancelled) setRows(data);
      })
      .catch((err) => {
        if (!cancelled)
          setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, sort]);

  if (!open) return null;

  return (
    <>
      <aside className={embedded ? "score-pane" : "panel assess-panel open"}>
        {!embedded && onClose && (
          <div className="panel-head">
            <button type="button" className="panel-close" onClick={onClose}>
              Close
            </button>
          </div>
        )}
        {!embedded && (
          <>
            <p className="eyebrow">Assessment</p>
            <h2>Reports</h2>
          </>
        )}
        <p className="muted assess-hint">
          Everyone the judge has run on — click a person to read their full
          profile, presented exactly like the email digest.
        </p>

        <div className="sort-dial">
          <label htmlFor="reports-sort" className="muted">
            Surface by
          </label>
          <select
            id="reports-sort"
            value={sort}
            onChange={(e) => setSort(e.target.value as AssessedSort)}
          >
            {ASSESSED_SORT_LABELS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
          <span className="muted sort-hint">
            {ASSESSED_SORT_LABELS.find((o) => o.value === sort)?.hint}
          </span>
        </div>

        {loading && <p className="muted">Loading reports…</p>}
        {error && <p className="error">{error}</p>}
        {!loading && !error && rows.length === 0 && (
          <p className="muted">No assessments yet — run the judge first.</p>
        )}

        <ul className="assess-list report-list">
          {rows.map((r) => (
            <li key={r.candidate_id}>
              <button
                type="button"
                className="assess-row assess-row-btn report-row"
                onClick={() => setViewing(r)}
              >
                <span className="assess-row-main">
                  <span className="assess-name">
                    {r.name}
                    {r.estimated_age != null ? (
                      <span className="name-age"> · ~{r.estimated_age}</span>
                    ) : null}
                  </span>
                  <span className="assess-meta">
                    <span className="assess-score">
                      {formatOverallScore(r.priority_score)}
                    </span>
                    <span className="chip">
                      {r.label
                        ? `${r.label.display} · T${r.label.tier}`
                        : r.archetype.replace(/_/g, " ")}
                    </span>
                    {typeof r.age_relative === "number" && (
                      <span className="chip">
                        {r.age_relative}/10 for age
                      </span>
                    )}
                    {typeof r.obscurity === "number" && r.obscurity >= 0.6 && (
                      <span className="chip">
                        {typeof r.connections === "number"
                          ? `${r.connections} connections`
                          : r.obscurity >= 0.8
                            ? "barely visible"
                            : "low profile"}
                      </span>
                    )}
                    {r.youth_wildcard && (
                      <span className="chip chip-strong">Youth wildcard</span>
                    )}
                    {r.youth_wildcard_alumni && (
                      <span className="chip chip-off">Former youth wildcard</span>
                    )}
                    {r.status !== "completed" && (
                      <span className="chip">{r.status.replace(/_/g, " ")}</span>
                    )}
                    <span className="chip">{timeAgo(r.updated_at)}</span>
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      </aside>

      {viewing && (
        <div className="report-viewer" role="dialog" aria-modal="true">
          <div className="report-viewer-bar">
            <strong>{viewing.name}</strong>
            <span>
              <a
                className="chip"
                href={assessedProfileUrl(viewing.candidate_id)}
                target="_blank"
                rel="noreferrer"
              >
                Open in tab ↗
              </a>
              <button
                type="button"
                className="chip"
                onClick={() => setViewing(null)}
              >
                Close
              </button>
            </span>
          </div>
          <iframe
            title={`Profile: ${viewing.name}`}
            src={assessedProfileUrl(viewing.candidate_id)}
          />
        </div>
      )}
    </>
  );
}
