import { useEffect, useState } from "react";
import {
  assessedProfileUrl,
  fetchAssessed,
  type AssessedRow,
} from "./api";

interface Props {
  open: boolean;
  onClose: () => void;
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
export function ReportsPanel({ open, onClose }: Props) {
  const [rows, setRows] = useState<AssessedRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [viewing, setViewing] = useState<AssessedRow | null>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetchAssessed()
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
  }, [open]);

  if (!open) return null;

  return (
    <>
      <aside className="panel assess-panel open">
        <div className="panel-head">
          <button type="button" className="panel-close" onClick={onClose}>
            Close
          </button>
        </div>
        <p className="eyebrow">Assessment</p>
        <h2>Reports</h2>
        <p className="muted assess-hint">
          Everyone the judge has run on — click a person to read their full
          profile, presented exactly like the email digest.
        </p>

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
                  <span className="assess-name">{r.name}</span>
                  <span className="assess-meta">
                    <span className="assess-score">
                      {r.priority_score.toFixed(0)}/100
                    </span>
                    <span className="chip">{r.archetype.replace(/_/g, " ")}</span>
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
