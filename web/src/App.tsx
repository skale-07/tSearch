import { useCallback, useEffect, useRef, useState, type PointerEvent } from "react";
import {
  cancelRun,
  fetchProfile,
  fetchSeeds,
  fetchTree,
  parseNodeId,
  startBranchRun,
  startRun,
  subscribeRunEvents,
  type ProfileRecord,
  type ProfileRelation,
  type SeedOption,
  type TreeNodeSummary,
  type TreeOption,
  type TreeResponse,
} from "./api";
import { AssessPanel } from "./AssessPanel";
import { ProfilePanel } from "./ProfilePanel";
import { ReportsPanel } from "./ReportsPanel";
import { RadialTree } from "./RadialTree";
import "./App.css";

type Status = "idle" | "running" | "done" | "warning" | "failed";

export default function App() {
  const [seeds, setSeeds] = useState<SeedOption[]>([]);
  const [trees, setTrees] = useState<TreeOption[]>([]);
  const [activeRunId, setActiveRunId] = useState<string | null>(null);
  const [selectedSeed, setSelectedSeed] = useState<string>("");
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string | null>(null);
  const [logs, setLogs] = useState<string[]>([]);
  const [logsOpen, setLogsOpen] = useState(false);
  const [logsHeight, setLogsHeight] = useState(200);
  const logDrag = useRef<{ startY: number; startH: number } | null>(null);
  const [tree, setTree] = useState<TreeResponse | null>(null);
  const [seedSlug, setSeedSlug] = useState<string | null>(null);
  const [panelProfile, setPanelProfile] = useState<ProfileRecord | null>(null);
  const [panelNode, setPanelNode] = useState<TreeNodeSummary | null>(null);
  const [panelLoading, setPanelLoading] = useState(false);
  const [panelError, setPanelError] = useState<string | null>(null);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [expanding, setExpanding] = useState(false);
  const [assessOpen, setAssessOpen] = useState(false);
  const [reportsOpen, setReportsOpen] = useState(false);
  const [assessmentDigest, setAssessmentDigest] = useState<string | null>(null);
  const [assessmentPreselect, setAssessmentPreselect] = useState<string[]>([]);
  const [runStartedAt, setRunStartedAt] = useState<number | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [treeSearch, setTreeSearch] = useState("");
  const logBodyRef = useRef<HTMLPreElement | null>(null);

  useEffect(() => {
    if (status !== "running") {
      setRunStartedAt(null);
      return;
    }
    const started = Date.now();
    setRunStartedAt(started);
    setElapsed(0);
    const t = setInterval(
      () => setElapsed(Math.floor((Date.now() - started) / 1000)),
      1000
    );
    return () => clearInterval(t);
  }, [status]);

  useEffect(() => {
    const el = logBodyRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [logs, logsOpen]);

  useEffect(() => {
    let cancelled = false;
    fetchSeeds()
      .then(async (data) => {
        if (cancelled) return;
        setSeeds(data.seeds);
        setTrees(
          data.trees ?? data.profileSeeds.map((s) => ({ slug: s, name: s }))
        );
        if (data.seeds.length) {
          const preferred = data.seeds[0];
          setSelectedSeed(`${preferred.name}||${preferred.country}`);
        }
        const slug = data.profileSeeds[0];
        if (slug) {
          try {
            const t = await fetchTree(slug);
            if (cancelled) return;
            setTree(t);
            setSeedSlug(slug);
          } catch (err) {
            if (!cancelled) {
              setError(err instanceof Error ? err.message : String(err));
            }
          }
        }
      })
      .catch((err) => {
        if (!cancelled) setError(String(err.message || err));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const loadTree = useCallback(async (slug: string) => {
    setError(null);
    try {
      const t = await fetchTree(slug);
      setTree(t);
      setSeedSlug(slug);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setTree(null);
    }
  }, []);

  const current = seeds.find(
    (s) => `${s.name}||${s.country}` === selectedSeed
  );

  const watchRun = (runId: string): Promise<string | null> =>
    new Promise((resolve) => {
      const unsub = subscribeRunEvents(runId, (ev) => {
        if (ev.type === "log") {
          setLogs((prev) => [...prev, ev.line]);
        } else if (ev.type === "done") {
          setStatus(
            ev.assessment_status === "completed_with_errors" ||
              ev.assessment_status === "interrupted"
              ? "warning"
              : "done"
          );
          if (ev.digestHint) setAssessmentDigest(ev.digestHint);
          else if (ev.assessmentRunId || ev.run_id) {
            setAssessmentDigest(
              `output/assessment-runs/${ev.assessmentRunId ?? ev.run_id}/digest.md`
            );
          }
          unsub();
          resolve(ev.seedSlug ?? null);
        } else if (ev.type === "error") {
          setStatus("failed");
          setError(ev.message);
          unsub();
          resolve(null);
        }
      });
    });

  const onRun = async () => {
    if (!current) return;
    setError(null);
    setStatus("running");
    setLogs([]);
    setLogsOpen(true);
    setPanelProfile(null);
    setPanelNode(null);
    setSelectedNodeId(null);

    try {
      const { runId } = await startRun({
        name: current.name,
        country: current.country,
      });
      setActiveRunId(runId);
      const slug = await watchRun(runId);
      if (slug) {
        setSeedSlug(slug);
        await loadTree(slug);
        setTrees((prev) =>
          prev.some((t) => t.slug === slug)
            ? prev
            : [...prev, { slug, name: current.name }]
        );
      }
    } catch (err) {
      setStatus("failed");
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setActiveRunId(null);
    }
  };

  const onCancelRun = async () => {
    if (!activeRunId) return;
    try {
      await cancelRun(activeRunId);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const onAssessmentStart = async (runId: string) => {
    setError(null);
    setAssessmentDigest(null);
    setStatus("running");
    setLogs([]);
    setLogsOpen(true);
    setActiveRunId(runId);
    try {
      await watchRun(runId);
    } catch (err) {
      setStatus("failed");
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setActiveRunId(null);
    }
  };

  const onSelectNode = async (node: TreeNodeSummary) => {
    if (!seedSlug) return;
    setSelectedNodeId(node.id);
    setPanelNode(node);
    setPanelLoading(true);
    setPanelError(null);
    try {
      const relation: ProfileRelation = node.relation;
      const { slug, parentSlug: parsedParent } = parseNodeId(node.id);
      const parentSlug = node.parentId ?? parsedParent;

      let parentRelation: "collaborator" | "follower" | undefined;
      if (node.hop === 2 && parentSlug && tree) {
        const parentNode = tree.nodes.find((n) => n.id === parentSlug);
        if (
          parentNode?.relation === "collaborator" ||
          parentNode?.relation === "follower"
        ) {
          parentRelation = parentNode.relation;
        } else {
          const hop1Edge = tree.edges.find(
            (e) => e.hop === 1 && e.to === parentSlug
          );
          if (hop1Edge?.via === "github-collaborator") {
            parentRelation = "collaborator";
          } else if (hop1Edge?.via === "github-follower") {
            parentRelation = "follower";
          }
        }
      }

      const profile = await fetchProfile(
        seedSlug,
        relation,
        relation === "seed" ? undefined : slug,
        node.hop === 2 && parentSlug && parentRelation
          ? { parentSlug, parentRelation }
          : undefined
      );
      setPanelProfile(profile);
    } catch (err) {
      setPanelError(err instanceof Error ? err.message : String(err));
      setPanelProfile(null);
    } finally {
      setPanelLoading(false);
    }
  };

  const onExpandBranch = async () => {
    if (!seedSlug || !panelNode || panelNode.hop !== 1) return;
    if (
      panelNode.relation !== "collaborator" &&
      panelNode.relation !== "follower"
    ) {
      return;
    }

    setError(null);
    setExpanding(true);
    setStatus("running");
    setLogs([]);
    setLogsOpen(true);

    try {
      const { slug } = parseNodeId(panelNode.id);
      const { runId } = await startBranchRun({
        rootSeedSlug: seedSlug,
        parentSlug: slug,
        relation: panelNode.relation,
      });
      setActiveRunId(runId);
      const resultSlug = await watchRun(runId);
      if (resultSlug) {
        await loadTree(resultSlug);
      }
    } catch (err) {
      setStatus("failed");
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setExpanding(false);
      setActiveRunId(null);
    }
  };

  const onLogResizePointerDown = useCallback(
    (e: PointerEvent<HTMLDivElement>) => {
      e.preventDefault();
      e.currentTarget.setPointerCapture(e.pointerId);
      logDrag.current = { startY: e.clientY, startH: logsHeight };
      if (!logsOpen) setLogsOpen(true);
    },
    [logsHeight, logsOpen]
  );

  const onLogResizePointerMove = useCallback(
    (e: PointerEvent<HTMLDivElement>) => {
      if (!logDrag.current) return;
      const dy = logDrag.current.startY - e.clientY;
      const max = Math.floor(window.innerHeight * 0.7);
      setLogsHeight(
        Math.min(max, Math.max(120, logDrag.current.startH + dy))
      );
    },
    []
  );

  const onLogResizePointerUp = useCallback(
    (e: PointerEvent<HTMLDivElement>) => {
      if (!logDrag.current) return;
      logDrag.current = null;
      try {
        e.currentTarget.releasePointerCapture(e.pointerId);
      } catch {
        /* already released */
      }
    },
    []
  );

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark">tSearch</span>
          <span className="brand-sub">seed tree</span>
        </div>

        <div className="controls">
          <label className="sr-only" htmlFor="seed-select">
            Seed
          </label>
          <select
            id="seed-select"
            value={selectedSeed}
            onChange={(e) => setSelectedSeed(e.target.value)}
            disabled={status === "running"}
          >
            {seeds.map((s) => (
              <option
                key={`${s.name}-${s.country}`}
                value={`${s.name}||${s.country}`}
              >
                {s.country ? `${s.name} — ${s.country}` : s.name}
              </option>
            ))}
          </select>

          <button
            type="button"
            className="run-btn"
            onClick={onRun}
            disabled={!current || status === "running"}
          >
            {status === "running" ? "Running…" : "Run pipeline"}
          </button>

          <button
            type="button"
            className="run-btn"
            onClick={() => {
              setAssessOpen(true);
              setAssessmentPreselect([]);
            }}
            disabled={status === "running"}
          >
            Assess
          </button>

          <button
            type="button"
            className="run-btn"
            onClick={() => {
              setReportsOpen(true);
              setAssessOpen(false);
            }}
          >
            Reports
          </button>

          {trees.length > 0 && (
            <select
              aria-label="Load existing tree"
              value={seedSlug ?? ""}
              onChange={(e) => {
                if (e.target.value) loadTree(e.target.value);
              }}
              disabled={status === "running"}
            >
              <option value="" disabled>
                Load tree…
              </option>
              {trees.map((t) => (
                <option key={t.slug} value={t.slug}>
                  {t.name}
                </option>
              ))}
            </select>
          )}

          {status === "running" && activeRunId && (
            <button
              type="button"
              className="cancel-btn"
              onClick={() => void onCancelRun()}
            >
              Cancel
            </button>
          )}

          <span className={`status status-${status}`} aria-live="polite">
            {status === "running" && runStartedAt
              ? `running · ${Math.floor(elapsed / 60)}:${String(elapsed % 60).padStart(2, "0")}`
              : status}
          </span>
        </div>
      </header>

      {error && (
        <div className="banner error" role="alert">
          <span className="banner-text">{error}</span>
          <button
            type="button"
            className="banner-dismiss"
            aria-label="Dismiss error"
            onClick={() => setError(null)}
          >
            ×
          </button>
        </div>
      )}

      <main className="stage">
        {tree ? (
          <>
            <input
              type="search"
              className="tree-search"
              placeholder="Search tree…"
              aria-label="Search tree by name"
              value={treeSearch}
              onChange={(e) => setTreeSearch(e.target.value)}
            />
            <RadialTree
              nodes={tree.nodes}
              edges={tree.edges}
              seedId={tree.seedSlug}
              selectedId={selectedNodeId}
              onSelect={onSelectNode}
              searchQuery={treeSearch}
            />
          </>
        ) : (
          <div className="empty">
            <p>Select a seed and run the pipeline to grow the tree.</p>
            <p className="muted">
              Existing trees load automatically when found under{" "}
              <code>profiles/</code>.
            </p>
          </div>
        )}

        <ProfilePanel
          profile={panelProfile}
          node={panelNode}
          loading={panelLoading}
          error={panelError}
          expanding={expanding}
          onExpandBranch={onExpandBranch}
          onAssessCandidate={(candidateId) => {
            setAssessmentPreselect([candidateId]);
            setAssessOpen(true);
          }}
          onClose={() => {
            setPanelProfile(null);
            setPanelNode(null);
            setSelectedNodeId(null);
            setPanelError(null);
          }}
        />

        <ReportsPanel open={reportsOpen} onClose={() => setReportsOpen(false)} />

        <AssessPanel
          open={assessOpen}
          running={status === "running"}
          digestHint={assessmentDigest}
          onClose={() => setAssessOpen(false)}
          onStartRun={(runId) => void onAssessmentStart(runId)}
          preselectCandidateIds={assessmentPreselect}
          onError={(message) => {
            setStatus("failed");
            setError(message);
          }}
        />
      </main>

      <div
        className={`log-drawer ${logsOpen ? "open" : ""}`}
        style={logsOpen ? { height: logsHeight } : undefined}
      >
        <div
          className="log-resize"
          role="separator"
          aria-orientation="horizontal"
          aria-label="Resize logs panel"
          aria-valuenow={logsHeight}
          onPointerDown={onLogResizePointerDown}
          onPointerMove={onLogResizePointerMove}
          onPointerUp={onLogResizePointerUp}
          onPointerCancel={onLogResizePointerUp}
          onDoubleClick={() => setLogsHeight(200)}
        />
        <button
          type="button"
          className="log-toggle"
          onClick={() => setLogsOpen((o) => !o)}
        >
          Logs {logs.length ? `(${logs.length})` : ""}
        </button>
        {logsOpen && (
          <pre className="log-body" ref={logBodyRef}>
            {logs.length ? logs.join("\n") : "No logs yet."}
          </pre>
        )}
      </div>
    </div>
  );
}
