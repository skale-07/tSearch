import { useEffect, useState } from "react";
import { fetchAssessed, type MarkRecord } from "./api";
import { markLookDeeper } from "./markLookDeeper";

interface Props {
  marks: MarkRecord[];
  onUnmark: (id: string) => void;
  onOpenGraph?: (mark: MarkRecord) => void;
  onAssess?: (candidateId: string) => void;
}

function MarkName({
  mark,
  assessedIds,
  onOpenGraph,
  onAssess,
}: {
  mark: MarkRecord;
  assessedIds: Set<string>;
  onOpenGraph?: (mark: MarkRecord) => void;
  onAssess?: (candidateId: string) => void;
}) {
  const action = markLookDeeper(mark, assessedIds);
  if (action.kind === "digest") {
    return (
      <a
        className="marks-open"
        href={action.href}
        target="_blank"
        rel="noreferrer"
        title={action.title}
      >
        {mark.name}
      </a>
    );
  }
  if (action.kind === "graph" && onOpenGraph) {
    return (
      <button
        type="button"
        className="marks-open"
        title={action.title}
        onClick={() => onOpenGraph(mark)}
      >
        {mark.name}
      </button>
    );
  }
  if (action.kind === "assess" && onAssess) {
    return (
      <button
        type="button"
        className="marks-open"
        title={action.title}
        onClick={() => onAssess(action.candidateId)}
      >
        {mark.name}
      </button>
    );
  }
  return <span title={action.title}>{mark.name}</span>;
}

export function MarksList({ marks, onUnmark, onOpenGraph, onAssess }: Props) {
  const [assessedIds, setAssessedIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    let cancelled = false;
    void fetchAssessed()
      .then((rows) => {
        if (!cancelled) {
          setAssessedIds(new Set(rows.map((r) => r.candidate_id)));
        }
      })
      .catch(() => {
        /* list still works — digest links stay off */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (marks.length === 0) return null;
  return (
    <div className="marks-list">
      <p className="muted">Look at later ({marks.length})</p>
      <ul>
        {marks.slice(0, 20).map((m) => (
          <li key={m.id}>
            <MarkName
              mark={m}
              assessedIds={assessedIds}
              onOpenGraph={onOpenGraph}
              onAssess={onAssess}
            />
            <button
              type="button"
              className="mark-star on"
              title="Unmark — does not enqueue LinkedIn"
              onClick={() => onUnmark(m.id)}
            >
              ★
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
