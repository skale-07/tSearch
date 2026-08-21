import { useEffect, useMemo, useState } from "react";
import {
  fetchDigestDocument,
  fetchDigestSettings,
  fetchDigests,
  generateDigest,
  locateWebsiteGraphHost,
  sendDigestEmail,
  type DigestCandidateCard,
  type DigestDocument,
  type DigestListItem,
  type WebsiteGraphHostInfo,
} from "./api";
import { WebsiteGraphPanel } from "./WebsiteGraphPanel";

interface Props {
  open: boolean;
  /** When true, render as Score page content (not a slide-over). */
  embedded?: boolean;
  running?: boolean;
  onClose?: () => void;
  onStartRun?: (runId: string) => Promise<void>;
  onError?: (message: string) => void;
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

function formatWhen(iso: string): string {
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return iso;
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

/** Browse, open, and email generated talent digests. */
export function DigestsPanel({
  open,
  embedded = false,
  running = false,
  onClose,
  onStartRun,
  onError,
}: Props) {
  const [rows, setRows] = useState<DigestListItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [viewing, setViewing] = useState<DigestListItem | null>(null);
  const [building, setBuilding] = useState(false);

  const [sendOpen, setSendOpen] = useState(false);
  const [sendTarget, setSendTarget] = useState<DigestListItem | null>(null);
  const [sendFrom, setSendFrom] = useState("");
  const [sendTo, setSendTo] = useState("");
  const [sendDryRun, setSendDryRun] = useState(true);
  const [sendKeyPresent, setSendKeyPresent] = useState(false);
  const [sendBusy, setSendBusy] = useState(false);
  const [sendResult, setSendResult] = useState<string | null>(null);
  const [digestDoc, setDigestDoc] = useState<DigestDocument | null>(null);
  const [pickedId, setPickedId] = useState<string>("");
  const [host, setHost] = useState<WebsiteGraphHostInfo | null>(null);
  const [hostError, setHostError] = useState<string | null>(null);
  const [hostLoading, setHostLoading] = useState(false);

  const websiteCandidates = useMemo(
    () =>
      (digestDoc?.candidates ?? []).filter((c) => Boolean(c.links.website)),
    [digestDoc]
  );
  const picked: DigestCandidateCard | undefined = websiteCandidates.find(
    (c) => c.candidate_id === pickedId
  );

  const reload = () => {
    setLoading(true);
    setError(null);
    fetchDigests()
      .then(setRows)
      .catch((err) =>
        setError(err instanceof Error ? err.message : String(err))
      )
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetchDigests()
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

  const openSendDialog = (digest: DigestListItem) => {
    setSendTarget(digest);
    setSendResult(null);
    setSendDryRun(true);
    setSendOpen(true);
    fetchDigestSettings()
      .then((s) => {
        setSendFrom((prev) => prev || s.from);
        setSendTo((prev) => prev || s.to);
        setSendKeyPresent(s.provider_key_present);
      })
      .catch(() => {});
  };

  useEffect(() => {
    if (!viewing) {
      setDigestDoc(null);
      setPickedId("");
      setHost(null);
      setHostError(null);
      return;
    }
    let cancelled = false;
    setDigestDoc(null);
    setHost(null);
    setHostError(null);
    fetchDigestDocument(viewing.digest_id)
      .then((doc) => {
        if (cancelled) return;
        setDigestDoc(doc);
        const first = doc.candidates.find((c) => c.links.website);
        setPickedId(first?.candidate_id ?? "");
      })
      .catch((err) => {
        if (!cancelled)
          setHostError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancelled = true;
    };
  }, [viewing]);

  useEffect(() => {
    if (!pickedId) {
      setHost(null);
      return;
    }
    let cancelled = false;
    setHostLoading(true);
    setHostError(null);
    locateWebsiteGraphHost({ candidate_id: pickedId })
      .then((info) => {
        if (!cancelled) setHost(info);
      })
      .catch((err) => {
        if (!cancelled) {
          setHost(null);
          setHostError(err instanceof Error ? err.message : String(err));
        }
      })
      .finally(() => {
        if (!cancelled) setHostLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [pickedId]);

  const doSend = () => {
    if (!sendTarget) return;
    setSendBusy(true);
    setSendResult(null);
    sendDigestEmail({
      digestId: sendTarget.digest_id,
      from: sendFrom,
      to: sendTo,
      dryRun: sendDryRun,
    })
      .then((r) =>
        setSendResult(
          r.dryRun
            ? `Dry run OK (${r.messageId}) — nothing was emailed. Recipients would be: ${r.to.join(", ")}`
            : `Sent to ${r.to.join(", ")} (${r.messageId})`
        )
      )
      .catch((err) =>
        setSendResult(`❌ ${err instanceof Error ? err.message : String(err)}`)
      )
      .finally(() => setSendBusy(false));
  };

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
            <h2>Digests</h2>
          </>
        )}
        <p className="muted assess-hint">
          Open a generated talent digest, then email it. Send defaults to
          dry-run until you check “Send for real.”
        </p>

        <div className="assess-actions">
          <button
            type="button"
            className="chip"
            disabled={building || loading}
            onClick={() => {
              setBuilding(true);
              setError(null);
              generateDigest()
                .then((r) => {
                  reload();
                  setViewing({
                    digest_id: r.digest_id,
                    url: r.url,
                    generated_at: new Date().toISOString(),
                    assessment_run_id: r.run_id,
                    candidate_count: null,
                    assessed_candidate_count: null,
                  });
                })
                .catch((err) =>
                  setError(err instanceof Error ? err.message : String(err))
                )
                .finally(() => setBuilding(false));
            }}
          >
            {building ? "Building…" : "Generate from latest run"}
          </button>
        </div>

        {loading && <p className="muted">Loading digests…</p>}
        {error && <p className="error">{error}</p>}
        {!loading && !error && rows.length === 0 && (
          <p className="muted">
            No digests yet — generate one after an assessment completes.
          </p>
        )}

        <ul className="assess-list report-list">
          {rows.map((d) => (
            <li key={d.digest_id}>
              <div className="digest-row">
                <button
                  type="button"
                  className="assess-row assess-row-btn report-row"
                  onClick={() => setViewing(d)}
                >
                  <span className="assess-row-main">
                    <span className="assess-name">{d.digest_id}</span>
                    <span className="assess-meta">
                      {d.candidate_count != null && (
                        <span className="chip">{d.candidate_count} people</span>
                      )}
                      <span className="chip">{formatWhen(d.generated_at)}</span>
                      <span className="chip">{timeAgo(d.generated_at)}</span>
                    </span>
                  </span>
                </button>
                <button
                  type="button"
                  className="chip digest-send-chip"
                  title="Email this digest"
                  onClick={(e) => {
                    e.stopPropagation();
                    openSendDialog(d);
                  }}
                >
                  Send…
                </button>
              </div>
            </li>
          ))}
        </ul>
      </aside>

      {viewing && (
        <div className="report-viewer digest-viewer" role="dialog" aria-modal="true">
          <div className="report-viewer-bar">
            <strong>{viewing.digest_id}</strong>
            <span>
              <button
                type="button"
                className="chip"
                onClick={() => openSendDialog(viewing)}
              >
                Send…
              </button>
              <a
                className="chip"
                href={viewing.url}
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
          <div className="digest-viewer-body">
            <iframe title={`Digest: ${viewing.digest_id}`} src={viewing.url} />
            <aside className="digest-teammates" aria-label="Teammates">
              <h3>Teammates</h3>
              <p className="muted">
                Pull people from a digest candidate’s site. Confirm runs
                LinkedIn + corroborated GitHub. Does not start until you
                confirm.
              </p>
              {websiteCandidates.length === 0 && (
                <p className="muted">
                  No digest candidates have a website URL.
                </p>
              )}
              {websiteCandidates.length > 0 && (
                <label className="website-graph-field">
                  Candidate
                  <select
                    value={pickedId}
                    onChange={(e) => setPickedId(e.target.value)}
                  >
                    {websiteCandidates.map((c) => (
                      <option key={c.candidate_id} value={c.candidate_id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              {hostLoading && <p className="muted">Finding graph root…</p>}
              {hostError && <p className="error">{hostError}</p>}
              {picked && host && onStartRun && (
                <WebsiteGraphPanel
                  key={picked.candidate_id}
                  seedSlug={host.seed_slug}
                  hostSlug={
                    host.host_slug !== host.seed_slug
                      ? host.host_slug
                      : undefined
                  }
                  defaultUrl={picked.links.website || host.websiteUrl || ""}
                  defaultOrgHint={host.org_hint ?? undefined}
                  running={running}
                  compact
                  onStartRun={onStartRun}
                  onError={onError ?? setError}
                />
              )}
            </aside>
          </div>
        </div>
      )}

      {sendOpen && sendTarget && (
        <div className="assess-modal-backdrop" role="presentation">
          <section
            className="assess-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="digest-send-title"
          >
            <h3 id="digest-send-title">
              Send digest {sendTarget.digest_id.slice(0, 18)}
            </h3>
            <label className="send-field">
              From
              <input
                type="text"
                value={sendFrom}
                onChange={(e) => setSendFrom(e.target.value)}
                placeholder="tSearch <digest@yourdomain.com>"
              />
            </label>
            <label className="send-field">
              To (comma-separated)
              <input
                type="text"
                value={sendTo}
                onChange={(e) => setSendTo(e.target.value)}
                placeholder="cory@example.com"
              />
            </label>
            <label className="assess-live-toggle">
              <input
                type="checkbox"
                checked={!sendDryRun}
                onChange={(e) => setSendDryRun(!e.target.checked)}
              />
              Send for real
            </label>
            {!sendDryRun && (
              <p className="error">
                This emails the digest via Resend — no further confirmation
                after you click Send.
                {!sendKeyPresent &&
                  " (No RESEND_API_KEY configured — this will fall back to a dry run.)"}
              </p>
            )}
            {sendDryRun && (
              <p className="muted">Dry run: validates and logs, sends nothing.</p>
            )}
            {sendResult && <p className="assess-rerun-note">{sendResult}</p>}
            <div className="assess-modal-actions">
              <button
                type="button"
                className="chip"
                onClick={() => setSendOpen(false)}
                disabled={sendBusy}
              >
                Close
              </button>
              <button
                type="button"
                className="run-btn"
                onClick={doSend}
                disabled={sendBusy || !sendTo.trim() || !sendFrom.trim()}
              >
                {sendBusy ? "Sending…" : sendDryRun ? "Run dry-run" : "Send"}
              </button>
            </div>
          </section>
        </div>
      )}
    </>
  );
}
