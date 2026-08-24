import { useEffect, useMemo, useState } from "react";
import {
  deleteMark,
  fetchMarks,
  ingestWebsiteGraph,
  previewWebsiteGraph,
  putMark,
  type MarkRecord,
  type PagePersonRow,
} from "./api";
import {
  matchingPreviewableUrl,
  type PageUrlOption,
} from "./previewablePageUrls";

/** Keep in sync with `WEBSITE_GRAPH_INGEST_LIMIT` in src/pipeline/websiteGraph.ts */
const INGEST_LIMIT = 15;

interface SeedOpt {
  slug: string;
  name: string;
}

interface Props {
  seedSlug?: string;
  hostSlug?: string;
  seedOptions?: SeedOpt[];
  defaultUrl?: string;
  urlOptions?: PageUrlOption[];
  defaultOrgHint?: string;
  running: boolean;
  compact?: boolean;
  onStartRun: (runId: string) => Promise<void>;
  onError: (message: string) => void;
}

export function WebsiteGraphPanel({
  seedSlug,
  hostSlug,
  seedOptions,
  defaultUrl,
  urlOptions,
  defaultOrgHint,
  running,
  compact,
  onStartRun,
  onError,
}: Props) {
  const [pickedSlug, setPickedSlug] = useState(seedSlug ?? "");
  const [url, setUrl] = useState(defaultUrl ?? "");
  const [orgHint, setOrgHint] = useState(defaultOrgHint ?? "");
  const [previewing, setPreviewing] = useState(false);
  const [ingesting, setIngesting] = useState(false);
  const [pageUrl, setPageUrl] = useState<string | null>(null);
  const [people, setPeople] = useState<PagePersonRow[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [lowCount, setLowCount] = useState(0);
  const [previewed, setPreviewed] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [marks, setMarks] = useState<MarkRecord[]>([]);
  const [manualName, setManualName] = useState("");
  const [manualLinkedIn, setManualLinkedIn] = useState("");
  const [manualGithub, setManualGithub] = useState("");
  const [customPage, setCustomPage] = useState(false);

  useEffect(() => {
    if (seedSlug) setPickedSlug(seedSlug);
  }, [seedSlug]);

  useEffect(() => {
    if (defaultUrl) {
      setUrl(defaultUrl);
      setCustomPage(false);
      setPreviewError(null);
    }
  }, [defaultUrl]);

  useEffect(() => {
    if (defaultOrgHint) setOrgHint(defaultOrgHint);
  }, [defaultOrgHint]);

  useEffect(() => {
    void fetchMarks()
      .then(setMarks)
      .catch(() => {});
  }, [people]);

  const markedIds = useMemo(() => new Set(marks.map((m) => m.id)), [marks]);
  const slug = seedSlug || pickedSlug;
  const busy = running || previewing || ingesting;
  const noHangTargets = !seedSlug && (seedOptions?.length ?? 0) === 0;
  const pageChoices = urlOptions ?? [];
  const matchedChoiceUrl = matchingPreviewableUrl(url, pageChoices);
  const showPageSelect = pageChoices.length > 1;
  const showUrlInput = !showPageSelect || customPage || !matchedChoiceUrl;

  const clearPreview = () => {
    setPreviewed(false);
    setPeople([]);
    setSelected(new Set());
    setPageUrl(null);
    setLowCount(0);
    setPreviewError(null);
  };

  const onPreview = async () => {
    if (!slug) {
      onError("Pick a seed to hang website people under.");
      return;
    }
    setPreviewing(true);
    setPreviewError(null);
    try {
      const result = await previewWebsiteGraph({
        seed_slug: slug,
        host_slug: hostSlug,
        url: url.trim() || undefined,
      });
      setPageUrl(result.page_url);
      setUrl(result.page_url);
      setPeople(result.people);
      setLowCount(result.low_confidence_count);
      setPreviewed(true);
      setPreviewError(null);
      if (result.org_hint) {
        const extracted = result.org_hint;
        setOrgHint((prev) => {
          if (!prev.trim()) return extracted;
          if (
            defaultOrgHint &&
            prev.trim().toLowerCase() === defaultOrgHint.trim().toLowerCase()
          ) {
            return extracted;
          }
          return prev;
        });
      }
      setSelected(
        new Set(
          result.people.filter((p) => p.checked_default).map((p) => p.name)
        )
      );
    } catch (err) {
      setPeople([]);
      setSelected(new Set());
      setPreviewed(false);
      setPreviewError(err instanceof Error ? err.message : String(err));
    } finally {
      setPreviewing(false);
    }
  };

  const toggle = (name: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(name)) {
        next.delete(name);
        return next;
      }
      if (next.size >= INGEST_LIMIT) {
        onError(`Ingest cap is ${INGEST_LIMIT} people per run.`);
        return prev;
      }
      next.add(name);
      return next;
    });
  };

  const onAddManual = () => {
    const name = manualName.trim();
    if (!name) {
      onError("Manual row needs a name.");
      return;
    }
    if (people.some((p) => p.name.toLowerCase() === name.toLowerCase())) {
      onError("That name is already on the list.");
      return;
    }
    const linkedin = manualLinkedIn.trim() || undefined;
    const github = manualGithub.trim() || undefined;
    const row: PagePersonRow = {
      name,
      linkedin_url: linkedin,
      github_url: github,
      confidence: linkedin || github ? "high" : "medium",
      evidence: "manual row",
      checked_default: true,
    };
    setPeople((rows) => [...rows, row]);
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.size >= INGEST_LIMIT) return prev;
      next.add(name);
      return next;
    });
    setPreviewed(true);
    if (!pageUrl && url.trim()) setPageUrl(url.trim());
    setManualName("");
    setManualLinkedIn("");
    setManualGithub("");
  };

  const onIngest = async () => {
    if (!slug) return;
    const resolvedUrl = (pageUrl || url).trim();
    if (!resolvedUrl) {
      onError("Page URL required (hang-under source). Name + org is enough — no LinkedIn/GitHub URL.");
      return;
    }
    const chosen = [...people.filter((p) => selected.has(p.name))];
    const pending = manualName.trim();
    if (
      pending &&
      !chosen.some((p) => p.name.toLowerCase() === pending.toLowerCase())
    ) {
      chosen.push({
        name: pending,
        linkedin_url: manualLinkedIn.trim() || undefined,
        github_url: manualGithub.trim() || undefined,
        confidence: "medium",
        evidence: "manual row",
        checked_default: true,
      });
    }
    if (!chosen.length) {
      onError("Add a name (preview checklist or the manual row) to resolve.");
      return;
    }
    const needOrg = chosen.some((p) => !p.linkedin_url);
    if (needOrg && !orgHint.trim()) {
      onError(
        "Org/award token required for anyone without a LinkedIn URL. Short token — not a legal letterhead."
      );
      return;
    }
    const hints: Record<
      string,
      { linkedin_url?: string; github_url?: string; org_hint?: string }
    > = {};
    for (const p of chosen) {
      const h: {
        linkedin_url?: string;
        github_url?: string;
        org_hint?: string;
      } = {};
      if (p.linkedin_url) h.linkedin_url = p.linkedin_url;
      if (p.github_url) h.github_url = p.github_url;
      if (Object.keys(h).length) hints[p.name] = h;
    }
    setIngesting(true);
    try {
      const started = await ingestWebsiteGraph({
        seed_slug: slug,
        host_slug: hostSlug,
        url: resolvedUrl,
        names: chosen.map((p) => p.name),
        org_hint: orgHint.trim() || undefined,
        hints: Object.keys(hints).length ? hints : undefined,
      });
      await onStartRun(started.runId);
    } catch (err) {
      onError(err instanceof Error ? err.message : String(err));
    } finally {
      setIngesting(false);
    }
  };

  const onStar = async (p: PagePersonRow) => {
    const id = p.mark_id;
    if (!id) return;
    try {
      if (markedIds.has(id)) {
        await deleteMark(id);
        setMarks((rows) => rows.filter((m) => m.id !== id));
        return;
      }
      const rec = await putMark({
        id,
        name: p.name,
        source: "website_preview",
        page_url: pageUrl ?? url,
        seed_slug: slug || undefined,
      });
      setMarks((rows) => [rec, ...rows.filter((m) => m.id !== id)]);
    } catch (err) {
      onError(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <div className={`website-graph${compact ? " compact" : ""}`}>
      {!compact && (
        <p className="muted website-graph-lede">
          Preview extracts names. Confirm runs LinkedIn resolve and
          corroborated GitHub attach — not a name-only search. Star only saves
          a reminder.
        </p>
      )}
      {noHangTargets && (
        <p className="muted">
          No seed profiles yet. Resolve someone on Discover first so there is a
          tree root to hang people under.
        </p>
      )}
      {!seedSlug && seedOptions && seedOptions.length > 0 && (
        <label className="website-graph-field">
          Hang under seed
          <select
            value={pickedSlug}
            onChange={(e) => setPickedSlug(e.target.value)}
            disabled={busy}
          >
            <option value="">Pick a seed…</option>
            {seedOptions.map((s) => (
              <option key={s.slug} value={s.slug}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
      )}
      {seedSlug && !compact && (
        <p className="muted">
          Attaches to <code>{hostSlug || seedSlug}</code> as same-site
          neighbors. Graph writes only after at least one LinkedIn confirm.
        </p>
      )}
      <label className="website-graph-field">
        Page URL
        {showPageSelect && (
          <select
            value={
              customPage || !matchedChoiceUrl ? "__other__" : matchedChoiceUrl
            }
            onChange={(e) => {
              const next = e.target.value;
              if (next === "__other__") {
                setCustomPage(true);
                clearPreview();
                return;
              }
              setCustomPage(false);
              setUrl(next);
              clearPreview();
            }}
            disabled={busy}
          >
            {pageChoices.map((o) => (
              <option key={o.url} value={o.url}>
                {o.label}
              </option>
            ))}
            <option value="__other__">Other…</option>
          </select>
        )}
        {showUrlInput && (
          <input
            type="url"
            value={url}
            placeholder="https://lab.example/people"
            onChange={(e) => {
              setCustomPage(true);
              setUrl(e.target.value);
            }}
            disabled={busy}
          />
        )}
      </label>
      <label className="website-graph-field">
        Org / award token
        <input
          type="text"
          value={orgHint}
          placeholder="USAAAO, AAPT, Davidson Fellows"
          onChange={(e) => setOrgHint(e.target.value)}
          disabled={busy}
        />
      </label>
      <p className="muted website-graph-hint">
        Shared org or award they are on together (USAAAO, AAPT) — not high
        school or college. Required for anyone without a LinkedIn URL.
      </p>
      <button
        type="button"
        className="chip"
        onClick={() => void onPreview()}
        disabled={busy || !slug}
      >
        {previewing ? "Fetching…" : "Preview people"}
      </button>
      {previewError && (
        <p className="error" role="alert">
          {previewError}
        </p>
      )}
      {previewed && people.length === 0 && !previewError && (
        <p className="muted">
          No names extracted from that page. Try another URL or add someone in
          the manual row.
        </p>
      )}
      {people.length > 0 && (
        <>
          {lowCount > 0 && (
            <p className="muted">
              {lowCount} low-confidence name{lowCount === 1 ? "" : "s"} left
              unchecked — LinkedIn queries on guessed names are usually wrong.
            </p>
          )}
          <ul className="website-graph-list">
            {people.map((p) => (
              <li key={p.name}>
                <label>
                  <input
                    type="checkbox"
                    checked={selected.has(p.name)}
                    onChange={() => toggle(p.name)}
                    disabled={busy}
                  />
                  <span>
                    {p.name}
                    <span className="muted">
                      {" "}
                      · {p.confidence}
                      {p.linkedin_url ? " · LinkedIn" : ""}
                      {p.github_url ? " · GitHub" : ""}
                    </span>
                  </span>
                </label>
                {p.mark_id && (
                  <button
                    type="button"
                    className={`mark-star ${markedIds.has(p.mark_id) ? "on" : ""}`}
                    title="Mark to look at later — does not enqueue LinkedIn"
                    onClick={() => void onStar(p)}
                  >
                    ★
                  </button>
                )}
              </li>
            ))}
          </ul>
        </>
      )}
      <div className="website-graph-manual">
        <p className="muted">
          Manual row — name + org token is enough. LinkedIn/GitHub URLs are
          optional.
        </p>
        <label className="website-graph-field">
          Name
          <input
            type="text"
            value={manualName}
            onChange={(e) => setManualName(e.target.value)}
            disabled={busy}
            placeholder="Ada Lovelace"
          />
        </label>
        <label className="website-graph-field">
          Org / award token
          <input
            type="text"
            value={orgHint}
            onChange={(e) => setOrgHint(e.target.value)}
            disabled={busy}
            placeholder="USAAAO, AAPT, Davidson Fellows"
          />
        </label>
        <label className="website-graph-field">
          LinkedIn URL
          <input
            type="url"
            value={manualLinkedIn}
            onChange={(e) => setManualLinkedIn(e.target.value)}
            disabled={busy}
            placeholder="https://www.linkedin.com/in/…"
          />
        </label>
        <label className="website-graph-field">
          GitHub URL
          <input
            type="url"
            value={manualGithub}
            onChange={(e) => setManualGithub(e.target.value)}
            disabled={busy}
            placeholder="https://github.com/…"
          />
        </label>
        <button
          type="button"
          className="chip"
          onClick={onAddManual}
          disabled={busy || !manualName.trim() || selected.size >= INGEST_LIMIT}
        >
          Add to list
        </button>
      </div>
      <button
        type="button"
        className="run-btn"
        onClick={() => void onIngest()}
        disabled={
          busy ||
          !(pageUrl || url.trim()) ||
          (selected.size === 0 && !manualName.trim())
        }
      >
        {ingesting
          ? "Starting…"
          : `Confirm resolve (${selected.size}/${INGEST_LIMIT})`}
      </button>
    </div>
  );
}
