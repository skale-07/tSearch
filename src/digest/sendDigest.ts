import fs from "fs";
import path from "path";
import {
  DIGEST_EMAIL_SUBJECT_PREFIX,
  EMAIL_PROVIDER_API_KEY,
  getDigestsDir,
} from "../assessment/config.js";
import { effectiveDigestSettings } from "./digestSettings.js";
import { readJson } from "../storage/jsonStore.js";
import type { DigestDocument } from "./types.js";
import {
  ResendEmailTransport,
  TestEmailTransport,
  type EmailTransport,
} from "./emailTransport.js";

export async function sendDigest(opts: {
  digestId: string;
  transport?: EmailTransport;
  dryRun?: boolean;
  /** Override stored/env recipients for this send. */
  to?: string;
  from?: string;
}): Promise<{ messageId: string; dryRun: boolean; to: string[] }> {
  const digestsDir = getDigestsDir();
  const jsonPath = path.join(digestsDir, `${opts.digestId}.json`);
  const mdPath = path.join(digestsDir, `${opts.digestId}.md`);
  const htmlPath = path.join(digestsDir, `${opts.digestId}.html`);
  const digest = readJson<DigestDocument>(jsonPath);
  if (!digest) throw new Error(`Digest not found: ${opts.digestId}`);
  if (!fs.existsSync(htmlPath) || !fs.existsSync(mdPath)) {
    throw new Error(`Digest render files missing for ${opts.digestId}`);
  }
  const html = fs.readFileSync(htmlPath, "utf-8");
  const text = fs.readFileSync(mdPath, "utf-8");

  const settings = effectiveDigestSettings();
  const to = (opts.to ?? settings.to)
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const from = (opts.from ?? settings.from).trim();
  if (!to.length) {
    throw new Error(
      "No recipients configured — set them in the UI send dialog or DIGEST_EMAIL_TO"
    );
  }
  if (!from) {
    throw new Error(
      "No From address configured — set it in the UI send dialog or DIGEST_EMAIL_FROM"
    );
  }

  const transport =
    opts.transport ??
    (opts.dryRun || !EMAIL_PROVIDER_API_KEY
      ? new TestEmailTransport()
      : new ResendEmailTransport(EMAIL_PROVIDER_API_KEY));

  const wasDryRun = Boolean(opts.dryRun || !EMAIL_PROVIDER_API_KEY);
  const result = await transport.send({
    to,
    from,
    subject: `${DIGEST_EMAIL_SUBJECT_PREFIX} ${digest.candidates.length} people worth a look — ${new Date(
      digest.generated_at
    ).toLocaleDateString("en-US", { month: "short", day: "numeric" })}`,
    html,
    text,
  });

  console.log(
    JSON.stringify({
      stage: "email_sent",
      digest_id: opts.digestId,
      messageId: result.messageId,
      dryRun: wasDryRun,
    })
  );
  return { messageId: result.messageId, dryRun: wasDryRun, to };
}
