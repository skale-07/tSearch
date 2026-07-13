import express from "express";
import path from "path";
import { COOKIES_PATH, PROFILES_DIR } from "../src/config.js";
import { getActiveRunId, getRun, startRun } from "./runs.js";
import {
  buildTree,
  cookiesExist,
  listProfileSeeds,
  loadProfile,
  loadSeedsFile,
  type TreeResponse,
} from "./tree.js";
import type { ProfileRelation } from "../src/storage/profileStore.js";

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
        // Best-effort: slug may differ from display name until first run
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
      send({ type: "done", seedSlug: run.seedSlug ?? null });
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

app.get("/api/profile/:seedSlug/:relation/:slug", (req, res) => {
  const relation = req.params.relation as ProfileRelation;
  if (relation !== "collaborator" && relation !== "follower") {
    res.status(400).json({ error: "relation must be collaborator|follower" });
    return;
  }
  const profile = loadProfile(req.params.seedSlug, relation, req.params.slug);
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
  console.log(`[api] listening on http://localhost:${PORT}`);
  console.log(`[api] cookies ${cookiesExist() ? "ok" : "MISSING"} @ ${COOKIES_PATH}`);
  console.log(`[api] profiles @ ${PROFILES_DIR}`);
});
