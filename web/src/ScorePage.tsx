import { useEffect, useState } from "react";
import { AssessPanel } from "./AssessPanel";
import { DigestsPanel } from "./DigestsPanel";
import { ReportsPanel } from "./ReportsPanel";

export type ScoreTab = "assess" | "reports" | "digests";

interface Props {
  running: boolean;
  digestHint: string | null;
  preselectCandidateIds?: string[];
  initialTab?: ScoreTab;
  /** Bumps when App navigates into Score (or deep-links a candidate). */
  navEpoch?: number;
  onStartRun: (runId: string) => void;
  onError: (message: string) => void;
}

/** Score workspace: priority_score judges, reports, and digests. */
export function ScorePage({
  running,
  digestHint,
  preselectCandidateIds,
  initialTab = "assess",
  navEpoch = 0,
  onStartRun,
  onError,
}: Props) {
  const [tab, setTab] = useState<ScoreTab>(initialTab);

  useEffect(() => {
    setTab(initialTab);
  }, [navEpoch, initialTab]);

  useEffect(() => {
    if (preselectCandidateIds?.length) setTab("assess");
  }, [preselectCandidateIds, navEpoch]);

  return (
    <div className="score-page">
      <p className="eyebrow">Assessment</p>
      <h1>Score</h1>
      <p className="muted discover-lede">
        LLM judges over frozen candidates — overall score 1–10, not discovery
        ranking. Does not re-run LinkedIn discovery or identity matching.
      </p>

      <div className="score-tabs" role="tablist" aria-label="Score sections">
        <button
          type="button"
          role="tab"
          aria-selected={tab === "assess"}
          className={`nav-tab ${tab === "assess" ? "on" : ""}`}
          onClick={() => setTab("assess")}
        >
          Assess
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === "reports"}
          className={`nav-tab ${tab === "reports" ? "on" : ""}`}
          onClick={() => setTab("reports")}
        >
          Reports
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === "digests"}
          className={`nav-tab ${tab === "digests" ? "on" : ""}`}
          onClick={() => setTab("digests")}
        >
          Digests
        </button>
      </div>

      {tab === "assess" && (
        <AssessPanel
          open
          embedded
          running={running}
          digestHint={digestHint}
          onGoDigests={() => setTab("digests")}
          onStartRun={onStartRun}
          onError={onError}
          preselectCandidateIds={preselectCandidateIds}
        />
      )}
      {tab === "reports" && <ReportsPanel open embedded />}
      {tab === "digests" && <DigestsPanel open embedded />}
    </div>
  );
}
