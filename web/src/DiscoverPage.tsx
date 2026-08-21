import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  fetchDiscovery,
  fetchMarks,
  fetchSeeds,
  pullDiscoveryOlympiads,
  refreshDiscovery,
  saveDiscoveryRoster,
  scrapeDiscoveryRosters,
  startDiscoveryResolve,
  startRunBatch,
  deleteMark,
  type ChannelSnapshot,
  type DiscoverySnapshot,
  type MarkRecord,
  type SeedSourceKind,
  type TreeOption,
} from "./api";
import { withAge } from "./ageDisplay";
import { MarksList } from "./MarksList";
import {
  clampResolveLimit,
  findPendingByName,
  groupChannels,
  MANUAL_COHORT_FILENAME,
  manualCohortTemplateJson,
  matchesPendingFilter,
  pendingKind,
  PERSON_NOT_ON_LIST,
  RESOLVE_LIMIT_DEFAULT,
  uniquePendingPrograms,
  uniquePendingYears,
} from "./discovery";
import { WebsiteGraphPanel } from "./WebsiteGraphPanel";

const OLYMPIAD_SOURCE_OPTIONS: Array<{ id: string; label: string }> = [
  { id: "ISEF", label: "ISEF" },
  { id: "IOI", label: "IOI" },
  { id: "IMO", label: "IMO" },
  { id: "IPHO", label: "IPhO" },
  { id: "ICHO", label: "IChO" },
  { id: "IBO", label: "IBO" },
];

interface Props {
  open: boolean;
  running: boolean;
  onStartResolve: (runId: string) => Promise<void>;
  onError: (message: string) => void;
}

function ChannelCard({
  title,
  hint,
  channels,
  actionLabel,
  onAction,
  actionDisabled,
  emptyLabel = "no files yet",
  wide,
  children,
}: {
  title: string;
  hint: string;
  channels: ChannelSnapshot[];
  actionLabel?: string;
  onAction?: () => void;
  actionDisabled?: boolean;
  emptyLabel?: string;
  wide?: boolean;
  children?: ReactNode;
}) {
  const rows = channels.reduce((n, c) => n + c.row_count, 0);
  const present = channels.some((c) => c.present);
  const errors = channels.filter((c) => c.error);
  return (
    <article
      className={`discover-card${present || children ? "" : " discover-card-empty"}${wide ? " discover-card-wide" : ""}`}
    >
      <p className="eyebrow">{present ? `${rows} names in files` : emptyLabel}</p>
      <h3>{title}</h3>
      <p className="muted">{hint}</p>
      {channels.length > 1 && present && (
        <ul className="discover-source-list">
          {channels.map((c) => (
            <li key={c.source_id}>
              {c.label} · {c.row_count}
            </li>
          ))}
        </ul>
      )}
      {errors.map((c) => (
        <p key={c.source_id} className="error">
          {c.error}
        </p>
      ))}
      {children}
      {actionLabel && onAction && (
        <button
          type="button"
          className="run-btn discover-card-btn"
          onClick={onAction}
          disabled={actionDisabled}
        >
          {actionLabel}
        </button>
      )}
    </article>
  );
}

export function DiscoverPage({ open, running, onStartResolve, onError }: Props) {
  const [data, setData] = useState<DiscoverySnapshot | null>(null);
  const [loading, setLoading] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [kind, setKind] = useState<SeedSourceKind | "">("");
  const [year, setYear] = useState<number | "">("");
  const [program, setProgram] = useState("");
  const [limit, setLimit] = useState(RESOLVE_LIMIT_DEFAULT);
  const [lastScan, setLastScan] = useState<string | null>(null);
  const [awardId, setAwardId] = useState("");
  const [awardYear, setAwardYear] = useState(new Date().getFullYear());
  const [awardNames, setAwardNames] = useState("");
  const [savingRoster, setSavingRoster] = useState(false);
  const [scraping, setScraping] = useState(false);
  const [pullingOlympiad, setPullingOlympiad] = useState(false);
  const [scrapeAwardId, setScrapeAwardId] = useState("");
  const nowYear = new Date().getFullYear();
  const [yearFrom, setYearFrom] = useState(nowYear - 2);
  const [yearTo, setYearTo] = useState(nowYear);
  const [olyYearFrom, setOlyYearFrom] = useState(2022);
  const [olyYearTo, setOlyYearTo] = useState(nowYear);
  const [olySources, setOlySources] = useState<string[]>([
    "ISEF",
    "IOI",
    "IMO",
    "IPHO",
    "ICHO",
    "IBO",
  ]);
  const [olySkipIbo, setOlySkipIbo] = useState(false);
  const [resolveName, setResolveName] = useState("");
  const [oneNameError, setOneNameError] = useState<string | null>(null);
  const [treeOptions, setTreeOptions] = useState<TreeOption[]>([]);
  const [marks, setMarks] = useState<MarkRecord[]>([]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    fetchDiscovery()
      .then((next) => {
        if (!cancelled) {
          setData(next);
          if (!awardId && next.roster_awards?.[0]) {
            setAwardId(next.roster_awards[0].award_id);
          }
        }
      })
      .catch((err) => {
        if (!cancelled) onError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    void fetchSeeds()
      .then((s) => {
        if (!cancelled) setTreeOptions(s.hangSeeds ?? s.trees ?? []);
      })
      .catch(() => {});
    void fetchMarks()
      .then((rows) => {
        if (!cancelled) setMarks(rows);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [open]);

  const grouped = useMemo(
    () => groupChannels(data?.channels ?? []),
    [data]
  );

  const pending = useMemo(() => {
    return (data?.pending ?? []).filter((s) =>
      matchesPendingFilter(s, { kind, year, program })
    );
  }, [data, kind, year, program]);

  const kindRows = useMemo(() => {
    return (data?.pending ?? []).filter((s) =>
      matchesPendingFilter(s, { kind })
    );
  }, [data, kind]);

  const yearOptions = useMemo(() => uniquePendingYears(kindRows), [kindRows]);
  const programOptions = useMemo(
    () =>
      uniquePendingPrograms(
        kindRows.filter((s) => matchesPendingFilter(s, { year }))
      ),
    [kindRows, year]
  );

  const githubReady = data?.github_ready ?? [];
  const githubReadyNoTree = githubReady.filter((p) => !p.has_tree);
  const batchCeiling = Math.max(pending.length, 1);
  const effectiveLimit = clampResolveLimit(limit, batchCeiling);

  useEffect(() => {
    setLimit((prev) => clampResolveLimit(prev, batchCeiling));
  }, [batchCeiling]);

  if (!open) return null;

  const meta = data?.channel_meta;
  const awards = data?.roster_awards ?? [];
  const scrapeableAwards = awards.filter((a) => a.scrapeable);
  const scholarshipReady = grouped.scholarships.some((c) => c.present);
  const busy = running || scanning || scraping || pullingOlympiad;
  const resolveCount = Math.min(effectiveLimit, pending.length);
  const programLabel = (id: string) =>
    awards.find((a) => a.award_id === id)?.display_name ?? id;

  const onScan = async () => {
    setScanning(true);
    try {
      const next = await refreshDiscovery();
      setData(next);
      const r = next.refresh;
      setLastScan(
        r
          ? `Read ${r.rows_read} rows · ${next.pending.length} pending`
          : `${next.pending.length} pending`
      );
    } catch (err) {
      onError(err instanceof Error ? err.message : String(err));
    } finally {
      setScanning(false);
    }
  };

  const onSaveRoster = async () => {
    setSavingRoster(true);
    try {
      const next = await saveDiscoveryRoster({
        award_id: awardId,
        year: awardYear,
        names: awardNames,
      });
      setData(next);
      setKind("award_roster");
      setAwardNames("");
      setLastScan(
        next.saved
          ? `Saved ${next.saved.count} names to ${next.saved.file}, then scanned. ${next.pending.filter((s) => pendingKind(s) === "award_roster").length} scholarship seeds pending.`
          : "Roster saved."
      );
    } catch (err) {
      onError(err instanceof Error ? err.message : String(err));
    } finally {
      setSavingRoster(false);
    }
  };

  const onScrape = async () => {
    setScraping(true);
    try {
      const next = await scrapeDiscoveryRosters({
        award_id: scrapeAwardId || undefined,
        year_from: yearFrom,
        year_to: yearTo,
      });
      setData(next);
      setKind("award_roster");
      const jobs = next.scrape?.jobs ?? [];
      const ok = jobs.filter((j) => !j.error);
      const failed = jobs.filter((j) => j.error);
      setLastScan(
        `Scraped ${next.scrape?.names_written ?? 0} names across ${ok.length} award-years` +
          (failed.length ? ` · ${failed.length} missed (PDF/JS/no list)` : "") +
          `. ${next.pending.filter((s) => pendingKind(s) === "award_roster").length} scholarship seeds pending.`
      );
    } catch (err) {
      onError(err instanceof Error ? err.message : String(err));
    } finally {
      setScraping(false);
    }
  };

  const onPullOlympiad = async () => {
    if (!olySources.length) {
      onError("Pick at least one olympiad source.");
      return;
    }
    setPullingOlympiad(true);
    try {
      const next = await pullDiscoveryOlympiads({
        year_from: olyYearFrom,
        year_to: olyYearTo,
        sources: olySources,
        skip_ibo: olySkipIbo,
      });
      setData(next);
      setKind("olympiad_csv");
      const pull = next.olympiad_pull;
      setLastScan(
        `Olympiad pull wrote ${pull?.rows_written ?? "?"} rows ` +
          `(${pull?.sources.join(", ") ?? olySources.join(", ")} · ` +
          `${olyYearFrom}–${olyYearTo}), then scanned. ` +
          `${next.pending.filter((s) => pendingKind(s) === "olympiad_csv").length} olympiad seeds pending.`
      );
    } catch (err) {
      onError(err instanceof Error ? err.message : String(err));
    } finally {
      setPullingOlympiad(false);
    }
  };

  const toggleOlySource = (id: string) => {
    setOlySources((prev) =>
      prev.includes(id) ? prev.filter((s) => s !== id) : [...prev, id]
    );
  };

  const downloadManualTemplate = () => {
    const blob = new Blob([manualCohortTemplateJson()], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = MANUAL_COHORT_FILENAME;
    a.click();
    URL.revokeObjectURL(url);
  };

  const resolveFilters = {
    kind,
    year,
    program,
  };

  const onResolve = async () => {
    try {
      const { runId, batch } = await startDiscoveryResolve({
        limit: effectiveLimit,
        ...resolveFilters,
      });
      setLastScan(
        `Resolving ${batch.length}: ${batch.map((b) => b.name).join(", ")}`
      );
      await onStartResolve(runId);
      const next = await fetchDiscovery();
      setData(next);
    } catch (err) {
      onError(err instanceof Error ? err.message : String(err));
    }
  };

  const onResolveOne = async () => {
    const query = resolveName.trim();
    if (!query) {
      setOneNameError(PERSON_NOT_ON_LIST);
      return;
    }
    const hit = findPendingByName(pending, query);
    if (!hit) {
      setOneNameError(PERSON_NOT_ON_LIST);
      return;
    }
    setOneNameError(null);
    try {
      const { runId, batch } = await startDiscoveryResolve({
        name: hit.name,
        ...resolveFilters,
      });
      setLastScan(`Resolving ${batch[0]?.name ?? hit.name}`);
      setResolveName("");
      await onStartResolve(runId);
      const next = await fetchDiscovery();
      setData(next);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (/not on the list/i.test(msg)) setOneNameError(PERSON_NOT_ON_LIST);
      else onError(msg);
    }
  };

  const onExpandGithubReady = async () => {
    const batch = githubReadyNoTree.map((p) => ({
      name: p.name,
      country: p.country || "United States",
    }));
    if (!batch.length) {
      onError("No LinkedIn-resolved people with verified GitHub still need a tree.");
      return;
    }
    try {
      const { runId, batch: accepted } = await startRunBatch({ seeds: batch });
      setLastScan(
        `Expanding graph for ${accepted.length} with verified GitHub: ${accepted.map((b) => b.name).join(", ")}`
      );
      await onStartResolve(runId);
      const next = await fetchDiscovery();
      setData(next);
    } catch (err) {
      onError(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <section className="discover-page" aria-label="Seed discovery">
      <p className="eyebrow">Intake</p>
      <h1>Seed discovery</h1>
      <p className="muted discover-lede">
        Filter the pending list, then resolve that batch on LinkedIn. Intake
        cards below only pull names into the list — they do not search LinkedIn.
      </p>

      <div className="discover-resolve">
        <div className="discover-actions">
          <select
            aria-label="Channel"
            value={kind}
            disabled={busy}
            onChange={(e) => {
              setKind(e.target.value as SeedSourceKind | "");
              setYear("");
              setProgram("");
            }}
          >
            <option value="">All channels</option>
            <option value="olympiad_csv">Olympiads</option>
            <option value="award_roster">Scholarships</option>
            <option value="manual_cohort">Manual</option>
            <option value="website_page">Website graph</option>
          </select>
          <select
            aria-label="Competition or cohort year"
            value={year === "" ? "" : String(year)}
            disabled={busy}
            onChange={(e) => {
              setYear(e.target.value ? Number(e.target.value) : "");
              setProgram("");
            }}
          >
            <option value="">Any year</option>
            {yearOptions.map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </select>
          <select
            aria-label="Program"
            value={program}
            disabled={busy}
            onChange={(e) => setProgram(e.target.value)}
          >
            <option value="">Any program</option>
            {programOptions.map((p) => (
              <option key={p.id} value={p.id}>
                {programLabel(p.id)}
              </option>
            ))}
          </select>
          <label className="discover-limit">
            Max
            <input
              type="number"
              min={1}
              max={batchCeiling}
              value={effectiveLimit}
              disabled={busy}
              onChange={(e) =>
                setLimit(clampResolveLimit(Number(e.target.value), batchCeiling))
              }
            />
          </label>
          <button
            type="button"
            className="chip"
            disabled={busy || pending.length === 0}
            onClick={() => setLimit(pending.length)}
          >
            All {pending.length}
          </button>
          <button
            type="button"
            className="run-btn"
            onClick={() => void onResolve()}
            disabled={busy || pending.length === 0}
          >
            {running
              ? "Resolving…"
              : pending.length === 0
                ? "No matches"
                : `Resolve ${resolveCount} matching`}
          </button>
        </div>
        <div className="discover-actions">
          <label className="discover-limit discover-one-name">
            One person
            <input
              type="text"
              value={resolveName}
              placeholder="Full name as on the list"
              disabled={busy}
              onChange={(e) => {
                setResolveName(e.target.value);
                if (oneNameError) setOneNameError(null);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  void onResolveOne();
                }
              }}
            />
          </label>
          <button
            type="button"
            className="chip"
            onClick={() => void onResolveOne()}
            disabled={busy || !resolveName.trim()}
          >
            Resolve this person
          </button>
          <button
            type="button"
            className="chip"
            onClick={() => void onScan()}
            disabled={busy}
          >
            {scanning ? "Refreshing…" : "Refresh pending"}
          </button>
        </div>
      </div>
      {oneNameError && <p className="error discover-status">{oneNameError}</p>}
      <p className="muted discover-status">
        {pending.length} pending match these filters
        {data && data.pending_count !== pending.length
          ? ` (${data.pending_count} total).`
          : "."}{" "}
        Year is the competition / cohort year on the roster.
        {resolveCount >= 25
          ? " Large LinkedIn batches stay paced — do not raise delay to zero."
          : ""}
      </p>
      {lastScan && <p className="muted discover-status">{lastScan}</p>}

      {loading && !data && <p className="muted">Loading channels…</p>}

      <div className="discover-grid">
        <ChannelCard
          title={meta?.award_roster.title ?? "Scholarships & awards"}
          hint={meta?.award_roster.hint ?? ""}
          emptyLabel="scrape public rosters"
          wide
          channels={grouped.scholarships}
        >
          <form
            className="discover-roster-form"
            onSubmit={(e) => {
              e.preventDefault();
              void onScrape();
            }}
          >
            <p className="discover-roster-label">
              Scrape public winner lists into pending. Does not resolve LinkedIn.
            </p>
            <div className="discover-year-row">
              <label>
                From year
                <input
                  type="number"
                  min={2018}
                  max={nowYear + 1}
                  value={yearFrom}
                  disabled={running || scraping || pullingOlympiad}
                  onChange={(e) => setYearFrom(Number(e.target.value))}
                  required
                />
              </label>
              <label>
                To year
                <input
                  type="number"
                  min={2018}
                  max={nowYear + 1}
                  value={yearTo}
                  disabled={running || scraping || pullingOlympiad}
                  onChange={(e) => setYearTo(Number(e.target.value))}
                  required
                />
              </label>
              <label>
                Award
                <select
                  value={scrapeAwardId}
                  onChange={(e) => setScrapeAwardId(e.target.value)}
                  disabled={running || scraping || pullingOlympiad}
                >
                  <option value="">All scrapeable</option>
                  {scrapeableAwards.map((a) => (
                    <option key={a.award_id} value={a.award_id}>
                      {a.display_name}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <button
              type="submit"
              className="run-btn discover-card-btn"
              disabled={running || scraping || pullingOlympiad}
            >
              {scraping
                ? "Scraping…"
                : `Scrape ${Math.abs(yearTo - yearFrom) + 1} year${
                    Math.abs(yearTo - yearFrom) + 1 === 1 ? "" : "s"
                  }`}
            </button>
          </form>
          <form
            className="discover-roster-form"
            onSubmit={(e) => {
              e.preventDefault();
              void onSaveRoster();
            }}
          >
            <p className="discover-roster-label">
              {scholarshipReady
                ? "Or paste another winner list (Thiel, Presidential Scholars, Cameron, …)"
                : "Awards without a scraper: paste names from the public roster, one per line."}
            </p>
            <label>
              Award
              <select
                value={awardId}
                onChange={(e) => setAwardId(e.target.value)}
                disabled={running || savingRoster}
                required
              >
                {awards.length === 0 && <option value="">Loading awards…</option>}
                {awards.map((a) => (
                  <option key={a.award_id} value={a.award_id}>
                    {a.display_name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Cohort year
              <input
                type="number"
                min={1990}
                max={2100}
                value={awardYear}
                disabled={running || savingRoster}
                onChange={(e) => setAwardYear(Number(e.target.value))}
                required
              />
            </label>
            <label>
              Winner names
              <textarea
                rows={6}
                placeholder={"Ada Lovelace\nGrace Hopper"}
                value={awardNames}
                disabled={running || savingRoster}
                onChange={(e) => setAwardNames(e.target.value)}
                required
              />
            </label>
            <button
              type="submit"
              className="run-btn discover-card-btn"
              disabled={running || savingRoster || !awardId || !awardNames.trim()}
            >
              {savingRoster ? "Saving…" : "Save roster & scan"}
            </button>
          </form>
        </ChannelCard>
        <ChannelCard
          title={meta?.olympiad_csv.title ?? "Olympiads"}
          hint={meta?.olympiad_csv.hint ?? ""}
          channels={grouped.olympiad}
        >
          <form
            className="discover-roster-form"
            onSubmit={(e) => {
              e.preventDefault();
              void onPullOlympiad();
            }}
          >
            <p className="discover-roster-label">
              Re-run <code>olympiad_winners.py</code> against public medal lists
              and <strong>overwrite</strong> <code>olympiad_winners.csv</code>{" "}
              with only the selected years/sources, then scan pending. Narrow
              ranges drop older rows from the file. Not LinkedIn — can take
              several minutes.
            </p>
            <div className="discover-year-row">
              <label>
                From year
                <input
                  type="number"
                  min={2018}
                  max={nowYear + 1}
                  value={olyYearFrom}
                  disabled={running || pullingOlympiad}
                  onChange={(e) => setOlyYearFrom(Number(e.target.value))}
                  required
                />
              </label>
              <label>
                To year
                <input
                  type="number"
                  min={2018}
                  max={nowYear + 1}
                  value={olyYearTo}
                  disabled={running || pullingOlympiad}
                  onChange={(e) => setOlyYearTo(Number(e.target.value))}
                  required
                />
              </label>
            </div>
            <fieldset className="discover-oly-sources" disabled={running || pullingOlympiad}>
              <legend>Sources</legend>
              <div className="discover-oly-source-list">
                {OLYMPIAD_SOURCE_OPTIONS.map((opt) => (
                  <label key={opt.id} className="discover-oly-source">
                    <input
                      type="checkbox"
                      checked={olySources.includes(opt.id)}
                      onChange={() => toggleOlySource(opt.id)}
                    />
                    {opt.label}
                  </label>
                ))}
              </div>
            </fieldset>
            <label className="discover-oly-source">
              <input
                type="checkbox"
                checked={olySkipIbo}
                disabled={running || pullingOlympiad || !olySources.includes("IBO")}
                onChange={(e) => setOlySkipIbo(e.target.checked)}
              />
              Skip IBO (PDF parse is brittle)
            </label>
            <button
              type="submit"
              className="run-btn discover-card-btn"
              disabled={
                running || pullingOlympiad || olySources.length === 0
              }
            >
              {pullingOlympiad
                ? "Pulling olympiads…"
                : `Pull ${Math.abs(olyYearTo - olyYearFrom) + 1} year${
                    Math.abs(olyYearTo - olyYearFrom) + 1 === 1 ? "" : "s"
                  } & scan`}
            </button>
          </form>
        </ChannelCard>
        <ChannelCard
          title={meta?.manual_cohort.title ?? "Manual cohort"}
          hint={meta?.manual_cohort.hint ?? ""}
          emptyLabel="download template"
          channels={grouped.manual}
        >
          <p className="discover-roster-label">
            Required: <code>name</code>. Optional: <code>country</code>,{" "}
            <code>cohort_year</code> (class / award year),{" "}
            <code>age_at_award</code> (stated age that year). Save as{" "}
            <code>data/{MANUAL_COHORT_FILENAME}</code>.
          </p>
          <button
            type="button"
            className="discover-secondary-btn"
            onClick={downloadManualTemplate}
          >
            Download {MANUAL_COHORT_FILENAME}
          </button>
        </ChannelCard>
        <ChannelCard
          title="Website graph"
          hint="Paste a lab or personal site. Preview names, then confirm with an org/award token (or on-page LinkedIn URLs). Graph writes only after a LinkedIn confirm. Star does not enqueue."
          emptyLabel="url + seed"
          channels={grouped.website}
        >
          <WebsiteGraphPanel
            seedOptions={treeOptions.map((t) => ({ slug: t.slug, name: t.name }))}
            running={running}
            onStartRun={onStartResolve}
            onError={onError}
          />
        </ChannelCard>
        {marks.length > 0 && (
          <ChannelCard
            title="Look at later"
            hint="Stars from Graph, Assess, or a website preview. Unrelated to digest 👍/👎. Does not enqueue LinkedIn."
            emptyLabel={`${marks.length} marked`}
            channels={[]}
          >
            <MarksList
              marks={marks}
              onUnmark={(id) => {
                void deleteMark(id)
                  .then(() =>
                    setMarks((rows) => rows.filter((r) => r.id !== id))
                  )
                  .catch((err) =>
                    onError(err instanceof Error ? err.message : String(err))
                  );
              }}
            />
          </ChannelCard>
        )}
      </div>

      <h2 className="discover-pending-head discover-section-head">
        <span>
          Verified GitHub ({githubReady.length}
          {githubReadyNoTree.length
            ? ` · ${githubReadyNoTree.length} need tree`
            : ""}
          )
        </span>
        <button
          type="button"
          className="chip"
          onClick={() => void onExpandGithubReady()}
          disabled={busy || githubReadyNoTree.length === 0}
          title="LinkedIn-resolved people with GitHub from LinkedIn or personal site, no tree yet"
        >
          {running
            ? "Expanding…"
            : `Expand trees (${githubReadyNoTree.length})`}
        </button>
      </h2>
      <p className="muted discover-status">
        LinkedIn-resolved people whose GitHub URL came from LinkedIn or their
        personal site — not name search. Expand builds/grows their Graph tree.
      </p>
      {githubReady.length === 0 ? (
        <p className="muted">
          None yet. Run Discover on pending seeds; GitHub only attaches when the
          URL is already on LinkedIn or the personal site.
        </p>
      ) : (
        <table className="discover-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>GitHub</th>
              <th>Country</th>
              <th>Tree</th>
            </tr>
          </thead>
          <tbody>
            {githubReady.slice(0, 100).map((row) => (
              <tr key={`${row.name}:${row.github_url}`}>
                <td>{withAge(row.name, row.age_label)}</td>
                <td>
                  <a
                    href={row.github_url}
                    target="_blank"
                    rel="noreferrer"
                    className="discover-gh-link"
                  >
                    {row.github_url.replace(/^https?:\/\/(www\.)?github\.com\//i, "")}
                  </a>
                </td>
                <td>{row.country || "—"}</td>
                <td>{row.has_tree ? "yes" : "needs expand"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {githubReady.length > 100 && (
        <p className="muted">Showing first 100 of {githubReady.length}.</p>
      )}

      <h2 className="discover-pending-head">
        Pending ({pending.length}
        {data && data.pending_count !== pending.length
          ? ` / ${data.pending_count}`
          : ""}
        )
      </h2>
      {pending.length === 0 ? (
        <p className="muted">
          No pending people match these filters. Pull or scrape a roster, then
          Refresh pending.
        </p>
      ) : (
        <table className="discover-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Age</th>
              <th>Country</th>
              <th>Year</th>
              <th>Source</th>
            </tr>
          </thead>
          <tbody>
            {pending.slice(0, 200).map((row) => (
              <tr
                key={`${row.source_id}:${row.name}`}
                className="discover-row-pick"
                onClick={() => {
                  setResolveName(row.name);
                  setOneNameError(null);
                }}
              >
                <td>{row.name}</td>
                <td title={row.age_at_award != null ? `stated ${row.age_at_award} at award` : undefined}>
                  {row.age_label ?? "—"}
                </td>
                <td>{row.country ?? "—"}</td>
                <td>{row.cohort_year ?? "—"}</td>
                <td>{row.source_id}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {pending.length > 200 && (
        <p className="muted">Showing first 200 of {pending.length}.</p>
      )}
    </section>
  );
}
