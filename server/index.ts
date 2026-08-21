import express from "express";
import fs from "fs";
import { COOKIES_PATH, OUTPUT_PATH, PROFILES_DIR } from "../src/config.js";
import {
  cancelRun,
  getActiveRunId,
  getRun,
  startAssessmentRun,
  startAssessmentRunLegacy,
  startBranchRun,
  startRun,
  startSeedBatchRun,
} from "./runs.js";
import {
  getDiscovery,
  postDiscoveryOlympiadPull,
  postDiscoveryRefresh,
  postDiscoveryResolve,
  postDiscoveryRoster,
  postDiscoveryScrape,
} from "./discoveryApi.js";
import {
  assertCandidateInRun,
  findLatestCandidateAssessment,
  getAssessmentRunCandidateRows,
  getAssessmentRunResponse,
  latestCompletedAssessmentRunId,
  listAssessedCandidates,
  sortAssessedRows,
  ASSESSED_SORTS,
  type AssessedSort,
  prepareAssessmentRun,
  reconcileAbandonedAssessmentRuns,
  loadAssessmentRun,
} from "./assessmentApi.js";
import path from "path";
import { assessmentRunDir } from "../src/assessment/storage/assessmentRunStore.js";
import { EMAIL_PROVIDER_API_KEY, getDigestsDir } from "../src/assessment/config.js";
import {
  effectiveDigestSettings,
  saveDigestSettings,
  validateSettings,
} from "../src/digest/digestSettings.js";
import { sendDigest } from "../src/digest/sendDigest.js";
import { renderDigestForRun } from "../src/assessment/runAssessment.js";
import { buildDigest } from "../src/digest/buildDigest.js";
import { renderProfilePage } from "../src/digest/renderProfilePages.js";
import type { DigestDocument } from "../src/digest/types.js";
import { readJson } from "../src/storage/jsonStore.js";
import { loadConvergenceMap } from "../src/pipeline/convergence.js";
import { loadCandidateAssessment } from "../src/assessment/storage/assessmentRunStore.js";
import {
  buildTree,
  cookiesExist,
  listHangSeedOptions,
  listProfileSeeds,
  listSeedOptions,
  listTreeOptions,
  loadProfile,
  profileWithAgeLabel,
  type TreeResponse,
} from "./tree.js";
import type { ProfileRelation } from "../src/storage/profileStore.js";
import {
  githubUsernameFromCandidate,
  identityFromCandidate,
} from "../src/assessment/candidateIdentity.js";
import type { Candidate } from "../src/types.js";
import { loadCandidatesFromPath } from "../src/assessment/selectCandidates.js";
import { ageFromPublicIdentity } from "../src/assessment/stage/deriveStage.js";
import { pickYouthWildcardIds } from "../src/assessment/youthWildcard.js";
import { primaryWritingSurfaceUrl } from "../src/assessment/linkedinSurfaces.js";
import { refreshConvergenceStore } from "../src/pipeline/convergence.js";
import {
  FEEDBACK_VERDICTS,
  exploreQueue,
  loadAllFeedback,
  loadFeedback,
  recordFeedback,
} from "../src/digest/feedbackStore.js";
import {
  deleteMark,
  loadAllMarks,
  loadMark,
  MARK_SOURCES,
  upsertMark,
} from "../src/marks/markStore.js";
import {
  isMarkSource,
  postWebsiteGraphHost,
  postWebsiteGraphIngest,
  postWebsiteGraphPreview,
} from "./websiteGraphApi.js";

const PORT = Number(process.env.API_PORT ?? 8787);

const app = express();
app.use(express.json({ limit: "1mb" }));

app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    cookies: cookiesExist(),
    cookiesPath: COOKIES_PATH,
    profilesDir: PROFILES_DIR,
    activeRunId: getActiveRunId(),
  });
});

app.get("/api/seeds", (_req, res) => {
  try {
    const trees = listTreeOptions();
    res.json({
      seeds: listSeedOptions(),
      profileSeeds: trees.map((t) => t.slug),
      trees,
      hangSeeds: listHangSeedOptions(),
    });
  } catch (err) {
    res.status(500).json({
      error: err instanceof Error ? err.message : String(err),
    });
  }
});

app.get("/api/discovery", (_req, res) => {
  try {
    res.json(getDiscovery());
  } catch (err) {
    res.status(500).json({
      error: err instanceof Error ? err.message : String(err),
    });
  }
});

app.post("/api/discovery/refresh", (_req, res) => {
  try {
    res.json(postDiscoveryRefresh());
  } catch (err) {
    res.status(500).json({
      error: err instanceof Error ? err.message : String(err),
    });
  }
});

app.post("/api/discovery/roster", (req, res) => {
  const result = postDiscoveryRoster(req.body ?? {});
  if ("error" in result) {
    res.status(result.status).json({ error: result.error });
    return;
  }
  res.json(result);
});

app.post("/api/discovery/scrape", async (req, res) => {
  const result = await postDiscoveryScrape(req.body ?? {});
  if ("error" in result) {
    res.status(result.status).json({ error: result.error });
    return;
  }
  res.json(result);
});

app.post("/api/discovery/olympiad", async (req, res) => {
  const result = await postDiscoveryOlympiadPull(req.body ?? {});
  if ("error" in result) {
    res.status(result.status).json({ error: result.error });
    return;
  }
  res.json(result);
});

app.post("/api/discovery/resolve", (req, res) => {
  const result = postDiscoveryResolve(req.body ?? {});
  if ("error" in result) {
    res.status(result.status).json({ error: result.error });
    return;
  }
  res.status(202).json(result);
});

app.post("/api/runs", (req, res) => {
  const name = typeof req.body?.name === "string" ? req.body.name.trim() : "";
  const country =
    typeof req.body?.country === "string" ? req.body.country.trim() : "";
  if (!name || !country) {
    res.status(400).json({ error: "Body requires { name, country }" });
    return;
  }

  const result = startRun({ name, country });
  if ("error" in result) {
    res.status(result.status).json({ error: result.error });
    return;
  }
  res.status(202).json({ runId: result.runId });
});

/** Batch pipeline: N seeds in one LinkedIn-paced run (Graph UI multi-select). */
app.post("/api/runs/batch", (req, res) => {
  const raw = req.body?.seeds;
  if (!Array.isArray(raw) || !raw.length) {
    res.status(400).json({ error: "Body requires { seeds: [{ name, country }] }" });
    return;
  }
  const seeds: Array<{ name: string; country: string }> = [];
  for (const entry of raw) {
    const name = typeof entry?.name === "string" ? entry.name.trim() : "";
    const country =
      typeof entry?.country === "string" ? entry.country.trim() : "";
    if (!name || !country) {
      res.status(400).json({
        error: "Each seed needs non-empty name and country",
      });
      return;
    }
    seeds.push({ name, country });
  }
  if (seeds.length > 500) {
    res.status(400).json({
      error: "Batch capped at 500 seeds — split the run if you need more.",
    });
    return;
  }
  const result = startSeedBatchRun({
    seeds,
    label: `batch:${seeds.length}`,
  });
  if ("error" in result) {
    res.status(result.status).json({ error: result.error });
    return;
  }
  res.status(202).json({ runId: result.runId, batch: result.batch });
});

app.post("/api/runs/:id/cancel", (req, res) => {
  const result = cancelRun(req.params.id);
  if ("error" in result) {
    res.status(result.status).json({ error: result.error });
    return;
  }
  res.json({ ok: true });
});

app.post("/api/runs/branch", (req, res) => {
  const rootSeedSlug =
    typeof req.body?.rootSeedSlug === "string"
      ? req.body.rootSeedSlug.trim()
      : "";
  const parentSlug =
    typeof req.body?.parentSlug === "string" ? req.body.parentSlug.trim() : "";
  const relation = req.body?.relation as "collaborator" | "follower" | undefined;
  if (
    !rootSeedSlug ||
    !parentSlug ||
    (relation !== "collaborator" && relation !== "follower")
  ) {
    res.status(400).json({
      error:
        "Body requires { rootSeedSlug, parentSlug, relation: collaborator|follower }",
    });
    return;
  }

  const result = startBranchRun({ rootSeedSlug, parentSlug, relation });
  if ("error" in result) {
    res.status(result.status).json({ error: result.error });
    return;
  }
  res.status(202).json({ runId: result.runId });
});

app.get("/api/candidates", (_req, res) => {
  if (!fs.existsSync(OUTPUT_PATH)) {
    res.status(404).json({
      error: `Candidates file not found at ${OUTPUT_PATH}. Run discovery first.`,
      path: OUTPUT_PATH,
    });
    return;
  }
  try {
    const loaded = loadCandidatesFromPath(OUTPUT_PATH);
    const youthWildcard = pickYouthWildcardIds(loaded);
    const candidates = [...loaded]
      .sort((a, b) => (b.final_score ?? 0) - (a.final_score ?? 0))
      .map((c: Candidate) => {
        const identity = identityFromCandidate(c);
        const github_username = githubUsernameFromCandidate(c);
        const writingPrimary = primaryWritingSurfaceUrl(c);
        const website_url =
          c.linkedin?.personal_website ??
          c.website?.url ??
          writingPrimary ??
          undefined;
        const blog_url =
          c.github?.blog ?? c.substack?.url ?? writingPrimary ?? undefined;
        const age = ageFromPublicIdentity({
          linkedin: c.linkedin,
          olympiad: c.olympiad,
          website: c.website,
          github: c.github,
        });
        return {
          candidate_id: identity.candidate_id,
          name: c.name,
          age_label: age.age_label,
          estimated_age: age.estimated_age,
          final_score: c.final_score ?? 0,
          overall_score: c.overall_score ?? c.score_breakdown?.overall_score,
          github_username,
          website_url,
          blog_url,
          has_github: Boolean(github_username),
          has_writing_surface: Boolean(blog_url || website_url),
          youth_wildcard: youthWildcard.has(identity.candidate_id),
        };
      });
    res.json({ candidates, path: OUTPUT_PATH });
  } catch (err) {
    res.status(500).json({
      error: err instanceof Error ? err.message : String(err),
    });
  }
});

app.post("/api/assessment/runs", (req, res) => {
  // New contract: { candidate_ids, mock_llm?, skip_digest? }
  const candidateIdsRaw = req.body?.candidate_ids ?? req.body?.candidateIds;
  const candidate_ids = Array.isArray(candidateIdsRaw)
    ? candidateIdsRaw.filter((x: unknown) => typeof x === "string")
    : [];

  // Legacy top_n / mode support → reject with guidance except selected via legacy
  if (req.body?.mode === "top_n") {
    res.status(400).json({
      error:
        "top_n is removed. Pass candidate_ids for all eligible candidates instead.",
    });
    return;
  }

  if (!candidate_ids.length && req.body?.mode === "selected") {
    const legacy = startAssessmentRunLegacy({
      mode: "selected",
      candidateIds: Array.isArray(req.body?.candidateIds)
        ? req.body.candidateIds.filter((x: unknown) => typeof x === "string")
        : [],
      mock: Boolean(req.body?.mock ?? req.body?.mock_llm),
      inputPath: OUTPUT_PATH,
    });
    if ("error" in legacy) {
      res.status(legacy.status).json({ error: legacy.error });
      return;
    }
    res.status(202).json({ job_id: legacy.runId, runId: legacy.runId });
    return;
  }

  const prepared = prepareAssessmentRun({
    candidate_ids,
    mock_llm: Boolean(req.body?.mock_llm ?? req.body?.mock),
    skip_digest: req.body?.skip_digest !== false,
    inputPath: OUTPUT_PATH,
  });
  if ("error" in prepared) {
    res.status(prepared.status).json({ error: prepared.error });
    return;
  }

  const started = startAssessmentRun({
    assessmentRunId: prepared.run_id,
    mock: prepared.mock_llm,
    skipDigest: prepared.skip_digest,
  });
  if ("error" in started) {
    res.status(started.status).json({ error: started.error });
    return;
  }

  res.status(202).json({
    run_id: prepared.run_id,
    job_id: started.runId,
    status: "queued" as const,
    requested_count: prepared.requested_count,
    eligible_count: prepared.eligible_count,
    skipped_count: prepared.skipped_count,
    skipped_candidates: prepared.skipped_candidates,
  });
});

app.get("/api/assessment/runs/:runId", (req, res) => {
  const data = getAssessmentRunResponse(req.params.runId);
  if (!data) {
    res.status(404).json({ error: "Assessment run not found" });
    return;
  }
  res.json(data);
});

app.get("/api/assessment/runs/:runId/candidates", (req, res) => {
  const rows = getAssessmentRunCandidateRows(req.params.runId);
  if (!rows) {
    res.status(404).json({ error: "Assessment run not found" });
    return;
  }
  res.json({ candidates: rows });
});

app.post("/api/assessment/runs/:runId/retry", (req, res) => {
  if (req.body?.mode !== "failed") {
    res.status(400).json({ error: 'Body requires { mode: "failed" }' });
    return;
  }
  const run = getAssessmentRunResponse(req.params.runId);
  if (!run) {
    res.status(404).json({ error: "Assessment run not found" });
    return;
  }
  const started = startAssessmentRun({
    assessmentRunId: req.params.runId,
    mock: run.mock_llm,
    skipDigest: true,
    resumeArgs: ["--retry-errors"],
    label: `assessment:retry-failed:${req.params.runId}`,
  });
  if ("error" in started) {
    res.status(started.status).json({ error: started.error });
    return;
  }
  res.status(202).json({
    run_id: started.assessmentRunId,
    job_id: started.runId,
    status: "queued" as const,
  });
});

app.post("/api/assessment/runs/:runId/retry-candidate", (req, res) => {
  const candidate_id =
    typeof req.body?.candidate_id === "string"
      ? req.body.candidate_id.trim()
      : "";
  if (!candidate_id) {
    res.status(400).json({ error: "Body requires { candidate_id }" });
    return;
  }
  const checked = assertCandidateInRun(req.params.runId, candidate_id);
  if ("error" in checked) {
    res.status(checked.status).json({ error: checked.error });
    return;
  }
  const run = getAssessmentRunResponse(req.params.runId)!;
  const started = startAssessmentRun({
    assessmentRunId: req.params.runId,
    mock: run.mock_llm,
    skipDigest: true,
    resumeArgs: ["--force-candidate", candidate_id],
    label: `assessment:force:${candidate_id}`,
  });
  if ("error" in started) {
    res.status(started.status).json({ error: started.error });
    return;
  }
  res.status(202).json({
    run_id: started.assessmentRunId,
    job_id: started.runId,
    status: "queued" as const,
  });
});

app.get("/api/assessment/runs/:runId/candidates/:candidateId", (req, res) => {
  const run = loadAssessmentRun(req.params.runId);
  if (!run) {
    res.status(404).json({ error: "Assessment run not found" });
    return;
  }
  if (!run.candidate_ids.includes(req.params.candidateId)) {
    res.status(404).json({ error: "Candidate not in this run" });
    return;
  }
  const record = loadCandidateAssessment(
    req.params.runId,
    req.params.candidateId
  );
  if (!record) {
    res.status(404).json({ error: "Assessment record not found yet" });
    return;
  }
  res.json({ run_id: req.params.runId, assessment: record });
});

app.get("/api/candidates/:candidateId/assessment", (req, res) => {
  const found = findLatestCandidateAssessment(req.params.candidateId);
  if (!found) {
    res.status(404).json({ error: "No assessment found for candidate" });
    return;
  }
  res.json({
    run_id: found.run_id,
    assessment: found.record,
  });
});

app.get("/api/runs/:id", (req, res) => {
  const run = getRun(req.params.id);
  if (!run) {
    res.status(404).json({ error: "Run not found" });
    return;
  }
  res.json({
    id: run.id,
    name: run.name,
    country: run.country,
    status: run.status,
    startedAt: run.startedAt,
    finishedAt: run.finishedAt,
    seedSlug: run.seedSlug,
    assessmentRunId: run.assessmentRunId,
    kind: run.kind,
    error: run.error,
    logCount: run.logs.length,
  });
});

app.get("/api/runs/:id/events", (req, res) => {
  const run = getRun(req.params.id);
  if (!run) {
    res.status(404).json({ error: "Run not found" });
    return;
  }

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders?.();

  const send = (data: unknown) => {
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  // Replay buffered logs
  for (const line of run.logs) {
    if (line.startsWith("__EVENT__")) {
      try {
        send(JSON.parse(line.slice("__EVENT__".length)));
      } catch {
        send({ type: "log", line });
      }
    } else {
      send({ type: "log", line });
    }
  }

  if (run.status !== "running") {
    if (run.status === "done") {
      send({
        type: "done",
        seedSlug: run.seedSlug ?? null,
        assessmentRunId: run.assessmentRunId ?? null,
        digestHint: run.assessmentRunId
          ? `output/assessment-runs/${run.assessmentRunId}/digest.md`
          : null,
      });
    } else {
      send({ type: "error", message: run.error ?? "failed" });
    }
    res.end();
    return;
  }

  const onLine = (line: string) => {
    if (line.startsWith("__EVENT__")) {
      try {
        send(JSON.parse(line.slice("__EVENT__".length)));
      } catch {
        send({ type: "log", line });
      }
      if (line.includes('"type":"done"') || line.includes('"type":"error"')) {
        res.end();
        run.listeners.delete(onLine);
      }
      return;
    }
    send({ type: "log", line });
  };

  run.listeners.add(onLine);
  req.on("close", () => {
    run.listeners.delete(onLine);
  });
});

app.get("/api/tree/:seedSlug", (req, res) => {
  const tree: TreeResponse | null = buildTree(req.params.seedSlug);
  if (!tree) {
    res.status(404).json({
      error: `No profile tree found for "${req.params.seedSlug}" under ${PROFILES_DIR}`,
    });
    return;
  }
  res.json(tree);
});

app.get("/api/profile/:seedSlug/seed", (req, res) => {
  const profile = loadProfile(req.params.seedSlug, "seed");
  if (!profile) {
    res.status(404).json({ error: "Profile not found" });
    return;
  }
  res.json(profileWithAgeLabel(profile));
});

app.get(
  "/api/profile/:seedSlug/:parentRelation/:parentSlug/:relation/:slug",
  (req, res) => {
    const parentRelation = req.params.parentRelation as ProfileRelation;
    const relation = req.params.relation as ProfileRelation;
    if (
      (parentRelation !== "collaborator" &&
        parentRelation !== "follower" &&
        parentRelation !== "website") ||
      (relation !== "collaborator" &&
        relation !== "follower" &&
        relation !== "website")
    ) {
      res.status(400).json({ error: "invalid relation" });
      return;
    }
    const profile = loadProfile(
      req.params.seedSlug,
      relation,
      req.params.slug,
      {
        hop: 2,
        parentSlug: req.params.parentSlug,
        parentRelation,
      }
    );
    if (!profile) {
      res.status(404).json({ error: "Profile not found" });
      return;
    }
    res.json(profileWithAgeLabel(profile));
  }
);

app.get("/api/profile/:seedSlug/:relation/:slug", (req, res) => {
  const relation = req.params.relation as ProfileRelation;
  if (
    relation !== "collaborator" &&
    relation !== "follower" &&
    relation !== "website"
  ) {
    res.status(400).json({ error: "relation must be collaborator|follower|website" });
    return;
  }
  const profile = loadProfile(req.params.seedSlug, relation, req.params.slug, {
    hop: 1,
  });
  if (!profile) {
    res.status(404).json({ error: "Profile not found" });
    return;
  }
  res.json(profileWithAgeLabel(profile));
});

// Convenience: list known trees for the “load existing” path
app.get("/api/trees", (_req, res) => {
  res.json({ seeds: listProfileSeeds() });
});

// People reachable from 2+ seed-set members, best-bridged first.
app.get("/api/convergence", (_req, res) => {
  res.json({ bridges: refreshConvergenceStore() });
});

// --- Assessment reports (digest-style profiles in the UI) ---

app.get("/api/assessed", (req, res) => {
  const requested = String(req.query.sort ?? "recent");
  const sort = (ASSESSED_SORTS as readonly string[]).includes(requested)
    ? (requested as AssessedSort)
    : "recent";
  res.json({
    assessed: sortAssessedRows(listAssessedCandidates(), sort),
    sort,
    available_sorts: ASSESSED_SORTS,
  });
});

// The same profile page the email digest links to, built on demand from the
// candidate's latest assessment + that run's frozen source snapshot.
app.get("/api/assessed/:candidateId/profile.html", (req, res) => {
  const found = findLatestCandidateAssessment(req.params.candidateId);
  if (!found) {
    res.status(404).send("No assessment found for this candidate.");
    return;
  }
  const run = loadAssessmentRun(found.run_id);
  if (!run) {
    res.status(404).send("Assessment run not found.");
    return;
  }
  const sources =
    readJson<Candidate[]>(
      path.join(assessmentRunDir(found.run_id), "source-candidates.json")
    ) ?? [];
  const digest = buildDigest({
    run,
    assessments: [found.record],
    discoveredCandidateCount: 1,
    minPriority: 0,
    convergence: loadConvergenceMap(),
    youthWildcardIds: pickYouthWildcardIds(sources),
  });
  const dc = digest.candidates[0];
  if (!dc) {
    res
      .status(422)
      .send("This assessment has no rankable synthesis to render.");
    return;
  }
  const source = sources.find(
    (s) => identityFromCandidate(s).candidate_id === req.params.candidateId
  );
  res.type("html").send(renderProfilePage(dc, source));
});

// Digest generation from the UI + static serving so Learn-more links work.
app.post("/api/digest/generate", (req, res) => {
  const runId =
    (typeof req.body?.run_id === "string" && req.body.run_id.trim()) ||
    latestCompletedAssessmentRunId();
  if (!runId) {
    res.status(404).json({
      error: "No completed assessment run yet — run an assessment first.",
    });
    return;
  }
  renderDigestForRun(runId)
    .then((digestId) => {
      res.json({
        digest_id: digestId,
        run_id: runId,
        url: `/api/digests/${digestId}.html`,
      });
    })
    .catch((err) => {
      res
        .status(500)
        .json({ error: err instanceof Error ? err.message : String(err) });
    });
});

app.get("/api/digest/list", (_req, res) => {
  try {
    const dir = getDigestsDir();
    if (!fs.existsSync(dir)) {
      res.json({ digests: [] });
      return;
    }
    const digests = fs
      .readdirSync(dir)
      .filter((f) => /^digest_[a-f0-9]+\.html$/i.test(f))
      .map((f) => {
        const digest_id = f.replace(/\.html$/i, "");
        const htmlPath = path.join(dir, f);
        const jsonPath = path.join(dir, `${digest_id}.json`);
        const st = fs.statSync(htmlPath);
        const doc = readJson<DigestDocument>(jsonPath);
        return {
          digest_id,
          url: `/api/digests/${digest_id}.html`,
          generated_at: doc?.generated_at ?? st.mtime.toISOString(),
          assessment_run_id: doc?.assessment_run_id ?? null,
          candidate_count: doc?.candidates?.length ?? null,
          assessed_candidate_count:
            doc?.meta?.assessed_candidate_count ?? null,
        };
      })
      .sort((a, b) => b.generated_at.localeCompare(a.generated_at));
    res.json({ digests });
  } catch (err) {
    res.status(500).json({
      error: err instanceof Error ? err.message : String(err),
    });
  }
});

app.use("/api/digests", express.static(getDigestsDir()));

app.get("/api/digest/settings", (_req, res) => {
  const effective = effectiveDigestSettings();
  res.json({
    from: effective.from,
    to: effective.to,
    provider_key_present: Boolean(EMAIL_PROVIDER_API_KEY),
  });
});

app.post("/api/digest/settings", (req, res) => {
  const next = {
    from: typeof req.body?.from === "string" ? req.body.from : undefined,
    to: typeof req.body?.to === "string" ? req.body.to : undefined,
  };
  const invalid = validateSettings(next);
  if (invalid) {
    res.status(400).json({ error: invalid });
    return;
  }
  saveDigestSettings(next);
  res.json({ ...effectiveDigestSettings(), provider_key_present: Boolean(EMAIL_PROVIDER_API_KEY) });
});

// Sending from the UI: dry-run unless the request explicitly says otherwise —
// the UI's confirm dialog is the human go-ahead the house rules require.
app.post("/api/digest/:digestId/send", (req, res) => {
  const next = {
    from: typeof req.body?.from === "string" ? req.body.from : undefined,
    to: typeof req.body?.to === "string" ? req.body.to : undefined,
  };
  const invalid = validateSettings(next);
  if (invalid) {
    res.status(400).json({ error: invalid });
    return;
  }
  saveDigestSettings(next);
  const dryRun = req.body?.dry_run !== false;
  sendDigest({ digestId: req.params.digestId, dryRun })
    .then((result) => res.json(result))
    .catch((err) =>
      res
        .status(500)
        .json({ error: err instanceof Error ? err.message : String(err) })
    );
});

// --- Reviewer feedback (digest Phases 3–4) ---

app.post("/api/feedback", (req, res) => {
  const candidate_id =
    typeof req.body?.candidate_id === "string"
      ? req.body.candidate_id.trim()
      : "";
  const verdict =
    typeof req.body?.verdict === "string" ? req.body.verdict : "";
  if (
    !candidate_id ||
    !(FEEDBACK_VERDICTS as readonly string[]).includes(verdict)
  ) {
    res.status(400).json({
      error: `Body requires { candidate_id, verdict: ${FEEDBACK_VERDICTS.join("|")} }`,
    });
    return;
  }
  try {
    const record = recordFeedback({
      candidate_id,
      candidate_name:
        typeof req.body?.candidate_name === "string"
          ? req.body.candidate_name
          : undefined,
      verdict: verdict as (typeof FEEDBACK_VERDICTS)[number],
      note: typeof req.body?.note === "string" ? req.body.note : undefined,
    });
    res.status(201).json({ feedback: record });
  } catch (err) {
    res
      .status(500)
      .json({ error: err instanceof Error ? err.message : String(err) });
  }
});

app.get("/api/feedback", (_req, res) => {
  res.json({ feedback: loadAllFeedback() });
});

app.get("/api/feedback/candidate/:candidateId", (req, res) => {
  const record = loadFeedback(req.params.candidateId);
  res.json({ feedback: record });
});

// Candidates the reviewer marked explore_network — input for branch expands.
app.get("/api/feedback/explore-queue", (_req, res) => {
  res.json({ queue: exploreQueue() });
});

app.get("/api/marks", (_req, res) => {
  res.json({ marks: loadAllMarks() });
});

app.put("/api/marks/:id", (req, res) => {
  const id = decodeURIComponent(req.params.id ?? "").trim();
  const name = typeof req.body?.name === "string" ? req.body.name.trim() : "";
  if (!id || !name) {
    res.status(400).json({ error: "Body requires { name, source }" });
    return;
  }
  if (!isMarkSource(req.body?.source)) {
    res.status(400).json({
      error: `source must be one of: ${MARK_SOURCES.join("|")}`,
    });
    return;
  }
  try {
    const mark = upsertMark({
      id,
      name,
      source: req.body.source,
      note: typeof req.body?.note === "string" ? req.body.note : undefined,
      seed_slug:
        typeof req.body?.seed_slug === "string" ? req.body.seed_slug : undefined,
      page_url:
        typeof req.body?.page_url === "string" ? req.body.page_url : undefined,
      candidate_id:
        typeof req.body?.candidate_id === "string"
          ? req.body.candidate_id
          : undefined,
    });
    res.json({ mark });
  } catch (err) {
    res
      .status(500)
      .json({ error: err instanceof Error ? err.message : String(err) });
  }
});

app.delete("/api/marks/:id", (req, res) => {
  const id = decodeURIComponent(req.params.id ?? "").trim();
  if (!id) {
    res.status(400).json({ error: "id required" });
    return;
  }
  const existed = Boolean(loadMark(id));
  deleteMark(id);
  res.json({ ok: true, deleted: existed });
});

app.post("/api/website-graph/host", (req, res) => {
  const result = postWebsiteGraphHost(req.body ?? {});
  if (result && typeof result === "object" && "error" in result) {
    const err = result as { error: string; status: number };
    res.status(err.status).json({ error: err.error });
    return;
  }
  res.json(result);
});

app.post("/api/website-graph/preview", (req, res) => {
  postWebsiteGraphPreview(req.body ?? {})
    .then((result) => {
      if (result && typeof result === "object" && "error" in result) {
        const err = result as { error: string; status: number };
        res.status(err.status).json({ error: err.error });
        return;
      }
      res.json(result);
    })
    .catch((err) =>
      res
        .status(500)
        .json({ error: err instanceof Error ? err.message : String(err) })
    );
});

app.post("/api/website-graph/ingest", (req, res) => {
  const result = postWebsiteGraphIngest(req.body ?? {});
  if ("error" in result) {
    res.status(result.status).json({ error: result.error });
    return;
  }
  res.status(202).json(result);
});

app.listen(PORT, "127.0.0.1", () => {
  const { interrupted } = reconcileAbandonedAssessmentRuns();
  if (interrupted.length) {
    console.log(
      `[api] marked ${interrupted.length} abandoned assessment run(s) interrupted`
    );
  }
  console.log(`[api] listening on http://localhost:${PORT}`);
  console.log(`[api] cookies ${cookiesExist() ? "ok" : "MISSING"} @ ${COOKIES_PATH}`);
  console.log(`[api] profiles @ ${PROFILES_DIR}`);
});
