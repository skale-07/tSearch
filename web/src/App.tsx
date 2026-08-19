import { useCallback, useEffect, useRef, useState, type PointerEvent } from "react";
import {
  cancelRun,
  fetchProfile,
  fetchSeeds,
  fetchTree,
  parseNodeId,
  startBranchRun,
  startRunBatch,
  subscribeRunEvents,
  type ProfileRecord,
  type ProfileRelation,
  type SeedOption,
  type TreeNodeSummary,
  type TreeOption,
  type TreeResponse,
} from "./api";
import { DiscoverPage } from "./DiscoverPage";
import { PipelineBatchModal } from "./PipelineBatchModal";
import { ProfilePanel } from "./ProfilePanel";
import { RadialTree } from "./RadialTree";
import { ScorePage, type ScoreTab } from "./ScorePage";
import "./App.css";

type Status = "idle" | "running" | "done" | "warning" | "failed";
type Workspace = "discover" | "graph" | "score";

function workspaceFromHash(): Workspace {
  const h = window.location.hash;
  if (h === "#discover") return "discover";
  if (h === "#score") return "score";
  return "graph";
}

function hashForWorkspace(ws: Workspace): string {
  if (ws === "discover") return "discover";
  if (ws === "score") return "score";
  return "";
}

function brandSub(ws: Workspace): string {
  if (ws === "discover") return "discovery";
  if (ws === "score") return "priority score";
  return "seed tree";
}

export default function App() {
  const [seeds, setSeeds] = useState<SeedOption[]>([]);
  const [trees, setTrees] = useState<TreeOption[]>([]);
  const [activeRunId, setActiveRunId] = useState<string | null>(null);
  const [pipelineBatchOpen, setPipelineBatchOpen] = useState(false);
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
  const [workspace, setWorkspace] = useState<Workspace>(workspaceFromHash);
  const [scoreTab, setScoreTab] = useState<ScoreTab>("assess");
  const [scoreMountId, setScoreMountId] = useState(0);
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
    const onHash = () => setWorkspace(workspaceFromHash());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  const openWorkspace = (next: Workspace) => {
    setWorkspace(next);
    window.location.hash = hashForWorkspace(next);
  };

  const openScore = (tab: ScoreTab = "assess", preselect: string[] = []) => {
    setScoreTab(tab);
    setAssessmentPreselect(preselect);
    setScoreMountId((n) => n + 1);
    openWorkspace("score");
  };

  useEffect(() => {
    let cancelled = false;
    fetchSeeds()
      .then(async (data) => {
        if (cancelled) return;
        setSeeds(data.seeds);
        setTrees(
          data.trees ?? data.profileSeeds.map((s) => ({ slug: s, name: s }))
        );
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

  const onRunBatch = async (
    batch: Array<{ name: string; country: string }>
  ) => {
    if (!batch.length) return;
    setPipelineBatchOpen(false);
    setError(null);
    setStatus("running");
    setLogs([]);
    setLogsOpen(true);
    setPanelProfile(null);
    setPanelNode(null);
    setSelectedNodeId(null);

    try {
      const { runId, batch: accepted } = await startRunBatch({ seeds: batch });
      setLogs((prev) => [
        ...prev,
        `[ui] batch ${accepted.length}: ${accepted.map((s) => s.name).join(", ")}`,
      ]);
      setActiveRunId(runId);
      const slug = await watchRun(runId);
      const refreshed = await fetchSeeds();
      setSeeds(refreshed.seeds);
      setTrees(
        refreshed.trees ??
          refreshed.profileSeeds.map((s) => ({ slug: s, name: s }))
      );
      if (slug) {
        setSeedSlug(slug);
        await loadTree(slug);
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

  const onWatchJob = async (runId: string) => {
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
          <span className="brand-sub">{brandSub(workspace)}</span>
        </div>

        <div className="controls">
          <div className="workspace-tabs" role="tablist" aria-label="Workspace">
            <button
              type="button"
              role="tab"
              aria-selected={workspace === "discover"}
              className={`nav-tab ${workspace === "discover" ? "on" : ""}`}
              onClick={() => openWorkspace("discover")}
            >
              Discover
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={workspace === "graph"}
              className={`nav-tab ${workspace === "graph" ? "on" : ""}`}
              onClick={() => openWorkspace("graph")}
            >
              Graph
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={workspace === "score"}
              className={`nav-tab ${workspace === "score" ? "on" : ""}`}
              onClick={() => openScore("assess")}
            >
              Score
            </button>
          </div>

          {workspace === "graph" && (
            <button
              type="button"
              className="run-btn"
              onClick={() => setPipelineBatchOpen(true)}
              disabled={seeds.length === 0 || status === "running"}
            >
              {status === "running" ? "Running…" : "Run pipeline…"}
            </button>
          )}

          {workspace === "graph" && trees.length > 0 && (
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
        {workspace === "discover" && (
          <DiscoverPage
            open
            running={status === "running"}
            onStartResolve={onWatchJob}
            onError={(message) => {
              setStatus("failed");
              setError(message);
            }}
          />
        )}

        {workspace === "score" && (
          <ScorePage
            running={status === "running"}
            digestHint={assessmentDigest}
            initialTab={scoreTab}
            navEpoch={scoreMountId}
            preselectCandidateIds={assessmentPreselect}
            onStartRun={(runId) => void onWatchJob(runId)}
            onError={(message) => {
              setStatus("failed");
              setError(message);
            }}
          />
        )}

        {workspace === "graph" &&
          (tree ? (
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
          ))}

        {workspace === "graph" && (
          <ProfilePanel
            profile={panelProfile}
            node={panelNode}
            loading={panelLoading}
            error={panelError}
            expanding={expanding}
            onExpandBranch={onExpandBranch}
            onAssessCandidate={(candidateId) => {
              openScore("assess", [candidateId]);
            }}
            onClose={() => {
              setPanelProfile(null);
              setPanelNode(null);
              setSelectedNodeId(null);
              setPanelError(null);
            }}
          />
        )}

        <PipelineBatchModal
          open={pipelineBatchOpen}
          seeds={seeds}
          trees={trees}
          disabled={status === "running"}
          onClose={() => setPipelineBatchOpen(false)}
          onConfirm={(batch) => void onRunBatch(batch)}
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
