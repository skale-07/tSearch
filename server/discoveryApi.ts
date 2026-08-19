import { spawn } from "node:child_process";
import path from "node:path";
import { loadPerson } from "../src/storage/personStore.js";
import {
  deriveStage,
  formatAgeLabel,
} from "../src/assessment/stage/deriveStage.js";
import { predictSeedAge } from "../src/seeds/predictSeedAge.js";
import {
  CHANNEL_META,
  discoverySnapshot,
  findPendingSeedByName,
  refreshSeeds,
  takePendingBatch,
  type DiscoverySnapshot,
  type PendingSeed,
} from "../src/seeds/refreshSeeds.js";
import {
  listScrapableAwardIds,
  scrapeAwardRosters,
} from "../src/seeds/sources/awardRosterScrape.js";
import { writeAwardRoster } from "../src/seeds/sources/rosterSource.js";
import type { SeedSourceKind } from "../src/seeds/sources/types.js";
import { startSeedBatchRun } from "./runs.js";
import { loadAllPeople } from "../src/pipeline/convergence.js";
import { githubUsernameFromUrl } from "../src/linkedin/linkedinExtract.js";
import { seedHasHop1Neighbors } from "./tree.js";
import { slugify } from "../src/storage/jsonStore.js";

export const PENDING_RESOLVE_DEFAULT = 5;

const RETRY_TTL_MS = Number(
  process.env.AUTOPILOT_RETRY_TTL_MS ?? 14 * 24 * 60 * 60 * 1000
);

const KINDS = new Set<SeedSourceKind>([
  "olympiad_csv",
  "award_roster",
  "manual_cohort",
]);

function listGithubReadyPeople(): Array<{
  name: string;
  country: string;
  github_url: string;
  linkedin_url?: string;
  has_tree: boolean;
  age_label: string | null;
}> {
  const out: Array<{
    name: string;
    country: string;
    github_url: string;
    linkedin_url?: string;
    has_tree: boolean;
    age_label: string | null;
  }> = [];
  for (const rec of loadAllPeople()) {
    const raw =
      rec.links.github_url ?? rec.linkedin?.github_url ?? null;
    const login = githubUsernameFromUrl(raw);
    if (!login) continue;
    const slugs = [slugify(rec.name), slugify(login)];
    const has_tree = slugs.some((s) => seedHasHop1Neighbors(s));
    const stage = deriveStage({
      linkedin:
        rec.linkedin && rec.identity.status !== "no_name_match"
          ? rec.linkedin
          : undefined,
      olympiad: rec.olympiad,
    });
    out.push({
      name: rec.name,
      country: rec.country ?? rec.linkedin?.country ?? "",
      github_url: `https://github.com/${login}`,
      linkedin_url: rec.links.linkedin_url ?? rec.linkedin?.url,
      has_tree,
      age_label: formatAgeLabel(stage),
    });
  }
  return out;
}

export type DiscoveryPayload = DiscoverySnapshot & {
  channel_meta: typeof CHANNEL_META;
  roster_awards: Array<{
    award_id: string;
    display_name: string;
    scrapeable: boolean;
  }>;
  pending: Array<
    PendingSeed & { estimated_age: number | null; age_label: string | null }
  >;
  /** LinkedIn-resolved + GitHub from LinkedIn/website — expand queue. */
  github_ready: ReturnType<typeof listGithubReadyPeople>;
};

function attemptedRecently(name: string): boolean {
  const rec = loadPerson(name);
  if (!rec) return false;
  const failedStatus =
    rec.identity.status === "no_results" ||
    rec.identity.status === "no_name_match";
  if (!failedStatus) return false;
  const age = Date.now() - Date.parse(rec.last_updated);
  return Number.isFinite(age) && age < RETRY_TTL_MS;
}

function decorateDiscovery(snap: DiscoverySnapshot): DiscoveryPayload {
  const scrapeable = new Set(listScrapableAwardIds());
  return {
    ...snap,
    channel_meta: CHANNEL_META,
    roster_awards: snap.roster_awards.map((a) => ({
      ...a,
      scrapeable: scrapeable.has(a.award_id),
    })),
    github_ready: listGithubReadyPeople(),
    pending: snap.pending.map((s) => {
      const rec = loadPerson(s.name);
      const linkedin =
        rec?.linkedin && rec.identity.status !== "no_name_match"
          ? rec.linkedin
          : undefined;
      const stage = deriveStage({
        linkedin,
        olympiad: rec?.olympiad,
      });
      const pred = predictSeedAge(s);
      const age = stage.estimated_age ?? pred?.age ?? null;
      const age_label =
        age == null
          ? null
          : stage.estimated_age != null
            ? formatAgeLabel(stage)
            : (pred?.label ?? null);
      return {
        ...s,
        estimated_age: age,
        age_label,
      };
    }),
  };
}

export function getDiscovery(): DiscoveryPayload {
  return decorateDiscovery(discoverySnapshot());
}

export function postDiscoveryRefresh(): DiscoveryPayload & {
  refresh: ReturnType<typeof refreshSeeds>;
} {
  const refresh = refreshSeeds();
  return { ...decorateDiscovery(discoverySnapshot()), refresh };
}

export function postDiscoveryRoster(body: {
  award_id?: unknown;
  year?: unknown;
  names?: unknown;
}):
  | (DiscoveryPayload & {
      refresh: ReturnType<typeof refreshSeeds>;
      saved: { file: string; count: number };
    })
  | { error: string; status: number } {
  const award_id = typeof body.award_id === "string" ? body.award_id.trim() : "";
  const year = Number(body.year);
  const names = typeof body.names === "string" ? body.names : "";
  if (!award_id) {
    return { error: "Pick a scholarship / award.", status: 400 };
  }
  try {
    const saved = writeAwardRoster({ award_id, year, namesText: names });
    const refresh = refreshSeeds();
    return { ...decorateDiscovery(discoverySnapshot()), refresh, saved };
  } catch (err) {
    return {
      error: err instanceof Error ? err.message : String(err),
      status: 400,
    };
  }
}

export async function postDiscoveryScrape(body: {
  award_id?: unknown;
  year_from?: unknown;
  year_to?: unknown;
}): Promise<
  | (DiscoveryPayload & {
      refresh: ReturnType<typeof refreshSeeds>;
      scrape: Awaited<ReturnType<typeof scrapeAwardRosters>>;
    })
  | { error: string; status: number }
> {
  const now = new Date().getFullYear();
  const yearFrom = Math.floor(Number(body.year_from ?? now - 2));
  const yearTo = Math.floor(Number(body.year_to ?? now));
  if (!Number.isInteger(yearFrom) || !Number.isInteger(yearTo)) {
    return { error: "Year range must be four-digit years.", status: 400 };
  }
  if (yearFrom < 2018 || yearTo > now + 1) {
    return {
      error: `Years must be between 2018 and ${now + 1}.`,
      status: 400,
    };
  }
  const award_id =
    typeof body.award_id === "string" && body.award_id.trim()
      ? body.award_id.trim()
      : undefined;
  try {
    const scrape = await scrapeAwardRosters({
      award_ids: award_id ? [award_id] : undefined,
      yearFrom,
      yearTo,
    });
    const refresh = refreshSeeds();
    return { ...decorateDiscovery(discoverySnapshot()), refresh, scrape };
  } catch (err) {
    return {
      error: err instanceof Error ? err.message : String(err),
      status: 400,
    };
  }
}

const OLYMPIAD_SOURCES = new Set([
  "ISEF",
  "IOI",
  "IMO",
  "IPHO",
  "ICHO",
  "IBO",
]);

const OLYMPIAD_PULL_TIMEOUT_MS = Number(
  process.env.OLYMPIAD_PULL_TIMEOUT_MS ?? 15 * 60 * 1000
);

let olympiadPullRunning = false;

function runOlympiadWinnersScript(args: string[]): Promise<{
  code: number | null;
  stdout: string;
  stderr: string;
}> {
  const script = path.resolve(process.cwd(), "olympiad_winners.py");
  const python = process.env.PYTHON ?? "python";
  return new Promise((resolve) => {
    const child = spawn(python, [script, ...args], {
      cwd: process.cwd(),
      env: process.env,
      shell: process.platform === "win32",
    });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill();
      stderr += `\n[timeout] killed after ${OLYMPIAD_PULL_TIMEOUT_MS}ms`;
    }, OLYMPIAD_PULL_TIMEOUT_MS);
    child.stdout?.on("data", (buf: Buffer) => {
      stdout += buf.toString("utf8");
    });
    child.stderr?.on("data", (buf: Buffer) => {
      stderr += buf.toString("utf8");
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr });
    });
    child.on("error", (err) => {
      clearTimeout(timer);
      resolve({
        code: 1,
        stdout,
        stderr: `${stderr}\n${err.message}`,
      });
    });
  });
}

/** Re-run olympiad_winners.py, then refresh pending from the CSV. */
export async function postDiscoveryOlympiadPull(body: {
  year_from?: unknown;
  year_to?: unknown;
  sources?: unknown;
  skip_ibo?: unknown;
}): Promise<
  | (DiscoveryPayload & {
      refresh: ReturnType<typeof refreshSeeds>;
      olympiad_pull: {
        rows_written: number | null;
        sources: string[];
        year_from: number;
        year_to: number;
        log_tail: string;
      };
    })
  | { error: string; status: number }
> {
  if (olympiadPullRunning) {
    return { error: "Olympiad pull already running.", status: 409 };
  }

  const now = new Date().getFullYear();
  const yearFrom = Number(body.year_from ?? now - 2);
  const yearTo = Number(body.year_to ?? now);
  if (!Number.isInteger(yearFrom) || !Number.isInteger(yearTo)) {
    return { error: "Year range must be four-digit years.", status: 400 };
  }
  if (yearFrom > yearTo) {
    return { error: "year_from must be ≤ year_to.", status: 400 };
  }
  if (yearFrom < 2018 || yearTo > now + 1) {
    return {
      error: `Years must be between 2018 and ${now + 1}.`,
      status: 400,
    };
  }

  let sources: string[];
  if (Array.isArray(body.sources) && body.sources.length) {
    sources = body.sources
      .map((s) => (typeof s === "string" ? s.trim().toUpperCase() : ""))
      .filter((s) => OLYMPIAD_SOURCES.has(s));
    if (!sources.length) {
      return {
        error: `sources must be from: ${[...OLYMPIAD_SOURCES].join(", ")}`,
        status: 400,
      };
    }
  } else if (typeof body.sources === "string" && body.sources.trim()) {
    sources = body.sources
      .split(",")
      .map((s) => s.trim().toUpperCase())
      .filter((s) => OLYMPIAD_SOURCES.has(s));
    if (!sources.length) {
      return {
        error: `sources must be from: ${[...OLYMPIAD_SOURCES].join(", ")}`,
        status: 400,
      };
    }
  } else {
    sources = ["ISEF", "IOI", "IMO", "IPHO", "ICHO", "IBO"];
  }

  const skipIbo = Boolean(body.skip_ibo);
  const args = [
    "--from-year",
    String(yearFrom),
    "--to-year",
    String(yearTo),
    "--sources",
    sources.join(","),
    "--out",
    "olympiad_winners.csv",
  ];
  if (skipIbo) args.push("--skip-ibo");

  olympiadPullRunning = true;
  try {
    console.log(`[discovery] olympiad pull: python olympiad_winners.py ${args.join(" ")}`);
    const { code, stdout, stderr } = await runOlympiadWinnersScript(args);
    const combined = `${stdout}\n${stderr}`.trim();
    const wrote = combined.match(/Wrote\s+(\d+)\s+rows/i);
    const rows_written = wrote ? Number(wrote[1]) : null;

    if (code !== 0) {
      return {
        error: `olympiad_winners.py failed (exit ${code}). ${combined.slice(-800)}`,
        status: 500,
      };
    }

    const refresh = refreshSeeds();
    return {
      ...decorateDiscovery(discoverySnapshot()),
      refresh,
      olympiad_pull: {
        rows_written,
        sources,
        year_from: yearFrom,
        year_to: yearTo,
        log_tail: combined.slice(-1200),
      },
    };
  } catch (err) {
    return {
      error: err instanceof Error ? err.message : String(err),
      status: 500,
    };
  } finally {
    olympiadPullRunning = false;
  }
}

export function postDiscoveryResolve(body: {
  limit?: unknown;
  kind?: unknown;
  name?: unknown;
  year?: unknown;
  program?: unknown;
}):
  | { runId: string; batch: Array<{ name: string; country?: string }> }
  | { error: string; status: number } {
  const kind =
    typeof body.kind === "string" && KINDS.has(body.kind as SeedSourceKind)
      ? (body.kind as SeedSourceKind)
      : undefined;
  const name = typeof body.name === "string" ? body.name.trim() : "";
  const yearRaw = Number(body.year);
  const cohort_year =
    Number.isInteger(yearRaw) && yearRaw >= 1990 && yearRaw <= 2100
      ? yearRaw
      : undefined;
  const program =
    typeof body.program === "string" && body.program.trim()
      ? body.program.trim()
      : undefined;
  const pick = { kind, cohort_year, program };

  let batch: PendingSeed[];
  if (name) {
    const hit = findPendingSeedByName(name, pick);
    if (!hit) {
      return { error: "This person is not on the list", status: 404 };
    }
    batch = [hit];
  } else {
    const raw = Number(body.limit ?? PENDING_RESOLVE_DEFAULT);
    const limit = Math.max(
      1,
      Number.isFinite(raw) ? Math.floor(raw) : PENDING_RESOLVE_DEFAULT
    );
    batch = takePendingBatch(limit, {
      ...pick,
      skip: (s) => attemptedRecently(s.name),
    });
    if (!batch.length) {
      return {
        error: "No pending people match these filters.",
        status: 400,
      };
    }
  }

  const started = startSeedBatchRun({
    seeds: batch.map((s) => ({
      name: s.name,
      country: s.country,
      award_id: s.award_id,
    })),
    label: name
      ? `pending:name:${batch[0]!.name}`
      : `pending:${batch.length}${cohort_year ? `:y${cohort_year}` : ""}${program ? `:${program}` : ""}`,
    // Discover intake: LinkedIn resolve + graph expand into trees/candidates.
    resolveOnly: false,
  });
  if ("error" in started) return started;
  return started;
}
