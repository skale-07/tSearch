#!/usr/bin/env node
import { renderDigestForRun } from "../src/assessment/runAssessment.js";

function arg(name: string): string | undefined {
  const idx = process.argv.indexOf(name);
  if (idx === -1) return undefined;
  return process.argv[idx + 1];
}

async function main(): Promise<void> {
  const runId = arg("--run");
  if (!runId) {
    console.error("Usage: npm run digest:generate -- --run <assessmentRunId>");
    process.exit(1);
  }
  const digestId = await renderDigestForRun(runId);
  console.log(`Digest regenerated: ${digestId}`);
  console.log(`Files under output/digests/ and output/assessment-runs/${runId}/`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
