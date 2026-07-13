import { useCallback, useEffect, useState } from "react";
import {
  fetchProfile,
  fetchSeeds,
  fetchTree,
  startRun,
  subscribeRunEvents,
  type ProfileRecord,
  type ProfileRelation,
  type SeedOption,
  type TreeNodeSummary,
  type TreeResponse,
} from "./api";
import { ProfilePanel } from "./ProfilePanel";
import { RadialTree } from "./RadialTree";
import "./App.css";

type Status = "idle" | "running" | "done" | "failed";

export default function App() {
  const [seeds, setSeeds] = useState<SeedOption[]>([]);
  const [profileSeeds, setProfileSeeds] = useState<string[]>([]);
  const [selectedSeed, setSelectedSeed] = useState<string>("");
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string | null>(null);
  const [logs, setLogs] = useState<string[]>([]);
  const [logsOpen, setLogsOpen] = useState(false);
  const [tree, setTree] = useState<TreeResponse | null>(null);
  const [seedSlug, setSeedSlug] = useState<string | null>(null);
  const [panelProfile, setPanelProfile] = useState<ProfileRecord | null>(null);
  const [panelLoading, setPanelLoading] = useState(false);
  const [panelError, setPanelError] = useState<string | null>(null);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchSeeds()
      .then(async (data) => {
        if (cancelled) return;
        setSeeds(data.seeds);
        setProfileSeeds(data.profileSeeds);
        if (data.seeds.length) {
          const preferred =
            data.seeds.find((s) => s.name === "Varun Madan") ?? data.seeds[0];
          setSelectedSeed(`${preferred.name}||${preferred.country}`);
        }
        const slug = data.profileSeeds.includes("madanva")
          ? "madanva"
          : data.profileSeeds[0];
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

  const onRun = async () => {
    if (!current) return;
    setError(null);
    setStatus("running");
    setLogs([]);
    setLogsOpen(true);
    setPanelProfile(null);
    setSelectedNodeId(null);

    try {
      const { runId } = await startRun({
        name: current.name,
        country: current.country,
      });

      await new Promise<void>((resolve) => {
        const unsub = subscribeRunEvents(runId, (ev) => {
          if (ev.type === "log") {
            setLogs((prev) => [...prev, ev.line]);
          } else if (ev.type === "done") {
            setStatus("done");
            if (ev.seedSlug) {
              setSeedSlug(ev.seedSlug);
              loadTree(ev.seedSlug);
              setProfileSeeds((prev) =>
                prev.includes(ev.seedSlug!) ? prev : [...prev, ev.seedSlug!]
              );
            } else {
              setError(
                "Pipeline finished but no seedSlug was found in seed_tree.json"
              );
            }
            unsub();
            resolve();
          } else if (ev.type === "error") {
            setStatus("failed");
            setError(ev.message);
            unsub();
            resolve();
          }
        });
      });
    } catch (err) {
      setStatus("failed");
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const onSelectNode = async (node: TreeNodeSummary) => {
    if (!seedSlug) return;
    setSelectedNodeId(node.id);
    setPanelLoading(true);
    setPanelError(null);
    try {
      const relation: ProfileRelation = node.relation;
      const profile = await fetchProfile(
        seedSlug,
        relation,
        relation === "seed" ? undefined : node.id
      );
      setPanelProfile(profile);
    } catch (err) {
      setPanelError(err instanceof Error ? err.message : String(err));
      setPanelProfile(null);
    } finally {
      setPanelLoading(false);
    }
  };

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
              <option key={`${s.name}-${s.country}`} value={`${s.name}||${s.country}`}>
                {s.name}
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

          {profileSeeds.length > 0 && (
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
              {profileSeeds.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          )}

          <span className={`status status-${status}`}>{status}</span>
        </div>
      </header>

      {error && <div className="banner error">{error}</div>}

      <main className="stage">
        {tree ? (
          <RadialTree
            nodes={tree.nodes}
            edges={tree.edges}
            seedId={tree.seedSlug}
            selectedId={selectedNodeId}
            onSelect={onSelectNode}
          />
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
          loading={panelLoading}
          error={panelError}
          onClose={() => {
            setPanelProfile(null);
            setSelectedNodeId(null);
            setPanelError(null);
          }}
        />
      </main>

      <div className={`log-drawer ${logsOpen ? "open" : ""}`}>
        <button
          type="button"
          className="log-toggle"
          onClick={() => setLogsOpen((o) => !o)}
        >
          Logs {logs.length ? `(${logs.length})` : ""}
        </button>
        {logsOpen && (
          <pre className="log-body">
            {logs.length ? logs.join("\n") : "No logs yet."}
          </pre>
        )}
      </div>
    </div>
  );
}
