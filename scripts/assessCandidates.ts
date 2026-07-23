#!/usr/bin/env node
import path from "path";
import { runAssessment } from "../src/assessment/runAssessment.js";

function arg(name: string): string | undefined {
  const idx = process.argv.indexOf(name);
  if (idx === -1) return undefined;
  return process.argv[idx + 1];
}

function has(flag: string): boolean {
  return process.argv.includes(flag);
}

function parseCandidateIds(raw: string | undefined): string[] | undefined {
  if (!raw?.trim()) return undefined;
  const ids = raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return ids.length ? ids : undefined;
}

async function main(): Promise<void> {
  const input =
    arg("--input") ?? path.resolve("output/candidates.json");
  const candidateIds = parseCandidateIds(arg("--candidates"));
  const limitDefault =
    candidateIds?.length ??
    Number(process.env.ASSESSMENT_CANDIDATE_LIMIT ?? 10);
  const limit = Number(arg("--limit") ?? limitDefault);
  const repoLimit = Number(
    arg("--repository-limit") ?? process.env.ASSESSMENT_REPOSITORY_LIMIT ?? 3
  );
  const candidateId = arg("--candidate");
  const seed = arg("--seed");
  const force = has("--force");
  if (force) process.env.ASSESSMENT_FORCE_REFRESH = "1";
  const mock = has("--mock") || process.env.ASSESSMENT_MOCK_LLM === "1";

  const { runId } = await runAssessment({
    inputPath: input,
    limit,
    repositoryLimit: repoLimit,
    candidateId,
    candidateIds,
    seedName: seed,
    mockLlm: mock || !process.env.OPENAI_API_KEY,
    skipDigest: has("--skip-digest"),
    resumeRunId: arg("--resume"),
    retryErrors: has("--retry-errors"),
    forceCandidateId: arg("--force-candidate"),
  });

  console.log(`Assessment run completed: ${runId}`);
  console.log(`Artifacts: output/assessment-runs/${runId}/`);
  console.log(`Digest: output/assessment-runs/${runId}/digest.md`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
