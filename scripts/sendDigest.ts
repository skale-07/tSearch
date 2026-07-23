#!/usr/bin/env node
import { sendDigest } from "../src/digest/sendDigest.js";

function arg(name: string): string | undefined {
  const idx = process.argv.indexOf(name);
  if (idx === -1) return undefined;
  return process.argv[idx + 1];
}

function has(flag: string): boolean {
  return process.argv.includes(flag);
}

async function main(): Promise<void> {
  const digestId = arg("--digest");
  if (!digestId) {
    console.error("Usage: npm run digest:send -- --digest <digestId>");
    process.exit(1);
  }
  const result = await sendDigest({
    digestId,
    dryRun: has("--dry-run"),
  });
  console.log(`Sent: ${result.messageId}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
