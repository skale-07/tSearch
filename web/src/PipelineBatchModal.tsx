import { useEffect, useMemo, useState } from "react";
import type { SeedOption, TreeOption } from "./api";
import { withAge } from "./ageDisplay";

function seedKey(s: { name: string; country: string }): string {
  return `${s.name}||${s.country}`;
}

type TriFilter = "all" | "yes" | "no";

type Props = {
  open: boolean;
  seeds: SeedOption[];
  trees: TreeOption[];
  disabled?: boolean;
  initialKeys?: string[];
  onClose: () => void;
  onConfirm: (seeds: Array<{ name: string; country: string }>) => void;
};

export function PipelineBatchModal({
  open,
  seeds,
  trees,
  disabled = false,
  initialKeys,
  onClose,
  onConfirm,
}: Props) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState("");
  const [githubFilter, setGithubFilter] = useState<TriFilter>("all");
  const [treeFilter, setTreeFilter] = useState<TriFilter>("all");
  const [linkedinFilter, setLinkedinFilter] = useState<TriFilter>("all");
  const [countryFilter, setCountryFilter] = useState("");

  const treeNames = useMemo(
    () =>
      new Set(
        trees
          .filter((t) => t.hasTree !== false)
          .map((t) => t.name.trim().toLowerCase())
      ),
    [trees]
  );

  const batchCap = Math.max(seeds.length, 1);

  const countries = useMemo(() => {
    const set = new Set<string>();
    for (const s of seeds) {
      const c = s.country.trim();
      if (c) set.add(c);
    }
    return [...set].sort((a, b) => a.localeCompare(b));
  }, [seeds]);

  useEffect(() => {
    if (!open) return;
    setQuery("");
    setGithubFilter("all");
    setTreeFilter("all");
    setLinkedinFilter("all");
    setCountryFilter("");
    setSelected(new Set(initialKeys ?? []));
  }, [open, initialKeys]);

  if (!open) return null;

  const hasTree = (s: SeedOption): boolean =>
    s.hasTree === true || treeNames.has(s.name.trim().toLowerCase());

  const filtered = seeds.filter((s) => {
    const q = query.trim().toLowerCase();
    if (
      q &&
      !s.name.toLowerCase().includes(q) &&
      !s.country.toLowerCase().includes(q)
    ) {
      return false;
    }
    if (githubFilter === "yes" && !s.has_github) return false;
    if (githubFilter === "no" && s.has_github) return false;
    const tree = hasTree(s);
    if (treeFilter === "yes" && !tree) return false;
    if (treeFilter === "no" && tree) return false;
    if (linkedinFilter === "yes" && !s.has_linkedin) return false;
    if (linkedinFilter === "no" && s.has_linkedin) return false;
    if (countryFilter && s.country.trim() !== countryFilter) return false;
    return true;
  });

  const sortedFiltered = [...filtered].sort((a, b) => {
    const aGh = a.has_github ? 1 : 0;
    const bGh = b.has_github ? 1 : 0;
    if (aGh !== bGh) return bGh - aGh;
    const aTree = hasTree(a);
    const bTree = hasTree(b);
    if (aTree !== bTree) return aTree ? 1 : -1;
    return a.name.localeCompare(b.name);
  });

  const toggle = (key: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
        return next;
      }
      if (next.size >= batchCap) return prev;
      next.add(key);
      return next;
    });
  };

  const selectVisible = () => {
    const keys = sortedFiltered.map(seedKey).slice(0, batchCap);
    setSelected(new Set(keys));
  };

  const chosen = seeds.filter((s) => selected.has(seedKey(s)));
  const filtersActive =
    githubFilter !== "all" ||
    treeFilter !== "all" ||
    linkedinFilter !== "all" ||
    Boolean(countryFilter) ||
    Boolean(query.trim());

  return (
    <div
      className="assess-modal-backdrop"
      role="presentation"
      onClick={(e) => {
        if (e.target === e.currentTarget && !disabled) onClose();
      }}
    >
      <section
        className="assess-modal pipeline-batch-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="pipeline-batch-title"
      >
        <h3 id="pipeline-batch-title">Run pipeline</h3>
        <p className="muted">
          Filter the list, then select. Showing {sortedFiltered.length} of{" "}
          {seeds.length}
          {filtersActive ? " (filtered)" : ""}. Large LinkedIn batches risk
          bans.
        </p>

        <div className="assess-toolbar pipeline-batch-filters">
          <input
            type="search"
            className="assess-filter"
            placeholder="Search name or country…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            disabled={disabled}
          />
          <select
            aria-label="Filter by GitHub"
            value={githubFilter}
            disabled={disabled}
            onChange={(e) => setGithubFilter(e.target.value as TriFilter)}
          >
            <option value="all">GitHub: any</option>
            <option value="yes">Has GitHub</option>
            <option value="no">No GitHub</option>
          </select>
          <select
            aria-label="Filter by tree"
            value={treeFilter}
            disabled={disabled}
            onChange={(e) => setTreeFilter(e.target.value as TriFilter)}
          >
            <option value="all">Tree: any</option>
            <option value="yes">Has tree</option>
            <option value="no">Needs expand</option>
          </select>
          <select
            aria-label="Filter by LinkedIn"
            value={linkedinFilter}
            disabled={disabled}
            onChange={(e) => setLinkedinFilter(e.target.value as TriFilter)}
          >
            <option value="all">LinkedIn: any</option>
            <option value="yes">Resolved</option>
            <option value="no">Not resolved</option>
          </select>
          <select
            aria-label="Filter by country"
            value={countryFilter}
            disabled={disabled || countries.length === 0}
            onChange={(e) => setCountryFilter(e.target.value)}
          >
            <option value="">Country: any</option>
            {countries.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </div>

        <div className="assess-toolbar">
          <button
            type="button"
            className="chip"
            disabled={disabled || sortedFiltered.length === 0}
            onClick={selectVisible}
          >
            Select visible ({Math.min(sortedFiltered.length, batchCap)})
          </button>
          <button
            type="button"
            className="chip"
            disabled={disabled || !filtersActive}
            onClick={() => {
              setQuery("");
              setGithubFilter("all");
              setTreeFilter("all");
              setLinkedinFilter("all");
              setCountryFilter("");
            }}
          >
            Reset filters
          </button>
          <button
            type="button"
            className="chip"
            disabled={disabled || selected.size === 0}
            onClick={() => setSelected(new Set())}
          >
            Clear selection
          </button>
        </div>

        <ul className="assess-list pipeline-batch-list">
          {sortedFiltered.length === 0 ? (
            <li className="muted">No seeds match these filters.</li>
          ) : (
            sortedFiltered.map((s) => {
              const key = seedKey(s);
              const tree = hasTree(s);
              const checked = selected.has(key);
              const atCap = !checked && selected.size >= batchCap;
              return (
                <li key={key}>
                  <label className="assess-row">
                    <input
                      type="checkbox"
                      checked={checked}
                      disabled={disabled || atCap}
                      onChange={() => toggle(key)}
                    />
                    <span className="assess-row-main">
                      <span className="assess-name">
                        {withAge(s.name, s.age_label)}
                      </span>
                      <span className="assess-meta">
                        {s.country || "—"}
                        {s.has_linkedin ? " · LinkedIn" : ""}
                        {s.has_github ? " · GitHub" : ""}
                        {tree ? " · has tree" : " · needs expand"}
                      </span>
                    </span>
                  </label>
                </li>
              );
            })
          )}
        </ul>

        <div className="assess-modal-actions">
          <button type="button" className="chip" disabled={disabled} onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="run-btn"
            disabled={disabled || chosen.length === 0}
            onClick={() =>
              onConfirm(
                chosen.map((s) => ({ name: s.name, country: s.country }))
              )
            }
          >
            Run pipeline on {chosen.length}
          </button>
        </div>
      </section>
    </div>
  );
}
