import express from "express";
import fs from "fs";
import { COOKIES_PATH, OUTPUT_PATH, PROFILES_DIR } from "../src/config.js";
import {
  getActiveRunId,
  getRun,
  startAssessmentRun,
  startAssessmentRunLegacy,
  startBranchRun,
  startRun,
} from "./runs.js";
import {
  assertCandidateInRun,
  findLatestCandidateAssessment,
  getAssessmentRunCandidateRows,
  getAssessmentRunResponse,
  prepareAssessmentRun,
  reconcileAbandonedAssessmentRuns,
  loadAssessmentRun,
} from "./assessmentApi.js";
import { loadCandidateAssessment } from "../src/assessment/storage/assessmentRunStore.js";
import {
  buildTree,
  cookiesExist,
  listProfileSeeds,
  loadProfile,
  loadSeedsFile,
  type TreeResponse,
} from "./tree.js";
import type { ProfileRelation } from "../src/storage/profileStore.js";
import {
  githubUsernameFromCandidate,
  identityFromCandidate,
} from "../src/assessment/candidateIdentity.js";
import type { Candidate } from "../src/types.js";
import { loadCandidatesFromPath } from "../src/assessment/selectCandidates.js";

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
    const seeds = loadSeedsFile();
    const available = new Set(listProfileSeeds());
    res.json({
      seeds: seeds.map((s) => ({
        ...s,
        hasTree: available.has(
          s.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")
        ),
      })),
      profileSeeds: [...available],
    });
  } catch (err) {
    res.status(500).json({
      error: err instanceof Error ? err.message : String(err),
    });
  }
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
    const candidates = [...loaded]
      .sort((a, b) => (b.final_score ?? 0) - (a.final_score ?? 0))
      .map((c: Candidate) => {
        const identity = identityFromCandidate(c);
        const github_username = githubUsernameFromCandidate(c);
        const website_url =
          c.linkedin?.personal_website ?? c.website?.url ?? undefined;
        const blog_url = c.github?.blog ?? c.substack?.url ?? undefined;
        return {
          candidate_id: identity.candidate_id,
          name: c.name,
          final_score: c.final_score ?? 0,
          github_username,
          website_url,
          blog_url,
          has_github: Boolean(github_username),
          has_writing_surface: Boolean(blog_url || website_url),
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
  res.json(profile);
});

app.get(
  "/api/profile/:seedSlug/:parentRelation/:parentSlug/:relation/:slug",
  (req, res) => {
    const parentRelation = req.params.parentRelation as ProfileRelation;
    const relation = req.params.relation as ProfileRelation;
    if (
      (parentRelation !== "collaborator" && parentRelation !== "follower") ||
      (relation !== "collaborator" && relation !== "follower")
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
    res.json(profile);
  }
);

app.get("/api/profile/:seedSlug/:relation/:slug", (req, res) => {
  const relation = req.params.relation as ProfileRelation;
  if (relation !== "collaborator" && relation !== "follower") {
    res.status(400).json({ error: "relation must be collaborator|follower" });
    return;
  }
  const profile = loadProfile(req.params.seedSlug, relation, req.params.slug, {
    hop: 1,
  });
  if (!profile) {
    res.status(404).json({ error: "Profile not found" });
    return;
  }
  res.json(profile);
});

// Convenience: list known trees for the “load existing” path
app.get("/api/trees", (_req, res) => {
  res.json({ seeds: listProfileSeeds() });
});

app.listen(PORT, () => {
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
