import type { MarkRecord } from "./api";

interface Props {
  marks: MarkRecord[];
  onUnmark: (id: string) => void;
  onOpen?: (mark: MarkRecord) => void;
}

export function MarksList({ marks, onUnmark, onOpen }: Props) {
  if (marks.length === 0) return null;
  return (
    <div className="marks-list">
      <p className="muted">Look at later ({marks.length})</p>
      <ul>
        {marks.slice(0, 20).map((m) => (
          <li key={m.id}>
            {onOpen && m.seed_slug ? (
              <button
                type="button"
                className="marks-open"
                onClick={() => onOpen(m)}
                title="Open this seed tree"
              >
                {m.name}
              </button>
            ) : (
              <span>{m.name}</span>
            )}
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
