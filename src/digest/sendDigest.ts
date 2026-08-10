import fs from "fs";
import path from "path";
import {
  DIGEST_EMAIL_FROM,
  DIGEST_EMAIL_SUBJECT_PREFIX,
  DIGEST_EMAIL_TO,
  EMAIL_PROVIDER_API_KEY,
  getDigestsDir,
} from "../assessment/config.js";
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
}): Promise<{ messageId: string }> {
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

  const to = DIGEST_EMAIL_TO.split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (!to.length) {
    throw new Error("DIGEST_EMAIL_TO is required to send digests");
  }
  if (!DIGEST_EMAIL_FROM) {
    throw new Error("DIGEST_EMAIL_FROM is required to send digests");
  }

  const transport =
    opts.transport ??
    (opts.dryRun || !EMAIL_PROVIDER_API_KEY
      ? new TestEmailTransport()
      : new ResendEmailTransport(EMAIL_PROVIDER_API_KEY));

  const result = await transport.send({
    to,
    from: DIGEST_EMAIL_FROM,
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
      dryRun: opts.dryRun || !EMAIL_PROVIDER_API_KEY,
    })
  );
  return result;
}
