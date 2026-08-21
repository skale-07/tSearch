import type { DigestCandidate, DigestDocument } from "./types.js";
import { profileFileName } from "./renderProfilePages.js";
import { scoreBreakdownHtml } from "./scoreBreakdown.js";
import { digestFootprintLine } from "./footprintLine.js";

/**
 * The digest email. Design goals: card-per-person, minimal prose (depth lives
 * on the Learn-more profile pages), no internal jargon in front of the
 * recipient — inline styles throughout for email-client compatibility.
 */

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function safeHref(url: string | undefined): string | null {
  if (!url) return null;
  try {
    const u = new URL(url, "https://local.invalid");
    if (u.protocol !== "http:" && u.protocol !== "https:" && !url.startsWith("./"))
      return null;
    return url;
  } catch {
    return null;
  }
}

const AVATAR_COLORS = ["#e8c56a", "#3dba9c", "#e07a5f", "#8fa8e0", "#c58fe0"];

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? "")
    .join("");
}

function humanize(s: string): string {
  return s.replace(/_/g, " ");
}

/** Hard-cap prose at a word boundary so card copy doesn't die mid-word. */
export function truncateAtWord(text: string, max: number): string {
  const t = text.trim();
  if (t.length <= max) return t;
  const slice = t.slice(0, max);
  const broken = /[\s,.;:!?…]/.test(slice[slice.length - 1] ?? "");
  let cut = broken
    ? slice.trimEnd()
    : slice.replace(/\s+\S*$/, "").trimEnd();
  if (!cut || cut.length < Math.min(40, Math.floor(max * 0.5))) {
    cut = slice.trimEnd();
  }
  return `${cut.replace(/[.,;:\s]+$/u, "")}…`;
}

function chipHtml(label: string, strong = false): string {
  const border = strong ? "#d9b24a" : "#e3ddd0";
  const color = strong ? "#8a6d1c" : "#6b6558";
  const bg = strong ? "#faf3dd" : "#f7f5ef";
  return `<span style="display:inline-block;font-size:11px;padding:2px 9px;border:1px solid ${border};border-radius:999px;color:${color};background:${bg};margin:0 5px 5px 0;">${label}</span>`;
}

/** Age / impressive-for-age under the brief. Connections live under the name. */
function surfacingLine(c: DigestCandidate): string {
  const s = c.surfacing;
  if (!s) return "";
  const parts: string[] = [];
  if (s.age_label) parts.push(s.age_label);
  else if (s.estimated_age !== null) parts.push(`~${s.estimated_age}`);
  if (s.age_relative_impressiveness !== null) {
    parts.push(`impressive-for-age ${s.age_relative_impressiveness}/10`);
  }
  if (!parts.length) return "";
  return `<p style="margin:0 0 10px;font-size:12px;color:#8a8578;">${esc(parts.join(" · "))}</p>`;
}

function card(
  c: DigestCandidate,
  i: number,
  profileBaseUrl: string
): string {
  const color = AVATAR_COLORS[i % AVATAR_COLORS.length];
  const briefRaw =
    c.brief_rationale ?? c.why_highlighted[0]?.rationale ?? c.headline;
  const brief = esc(truncateAtWord(briefRaw, 260));

  const chips = [
    c.label
      ? chipHtml(`${esc(c.label.display)} · T${c.label.tier}`, true)
      : chipHtml(esc(humanize(c.primary_archetype)), true),
    c.network_bridges
      ? chipHtml(`🔗 knows ${c.network_bridges.seed_count} of your seed set`)
      : "",
    c.youth_wildcard ? chipHtml("Youth wildcard · 17–19") : "",
    c.reviewer_feedback === "relevant" ? chipHtml("✓ you flagged relevant") : "",
  ]
    .filter(Boolean)
    .join("");

  const works = c.strongest_artifacts
    .slice(0, 2)
    .map((a) => {
      const href = safeHref(a.url);
      const title = truncateAtWord(a.title, 60);
      return href
        ? `<a href="${esc(href)}" style="color:#1a1408;text-decoration:underline;">${esc(title)}</a>`
        : esc(title);
    })
    .join(" &nbsp;·&nbsp; ");

  const profileHref = `${profileBaseUrl}/${profileFileName(c)}`;
  const github = safeHref(c.links.github);

  const footprint = digestFootprintLine(c);
  const footprintHtml = footprint
    ? `<div style="font-size:12px;color:#8a8578;margin:0 0 6px;">${esc(footprint)}</div>`
    : "";

  return `
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#ffffff;border:1px solid #eae6dc;border-radius:12px;margin:0 0 14px;">
    <tr>
      <td style="padding:18px 20px;">
        <table role="presentation" cellpadding="0" cellspacing="0" width="100%">
          <tr>
            <td width="52" valign="top">
              <div style="width:44px;height:44px;border-radius:50%;background:${color};color:#1a1408;font-weight:700;font-size:17px;text-align:center;line-height:44px;font-family:Georgia,serif;">${esc(initials(c.name))}</div>
            </td>
            <td valign="top" style="padding-left:6px;">
              <div style="font-family:Georgia,serif;font-size:19px;color:#1a1408;margin:0 0 2px;">${esc(c.name)}</div>
              ${footprintHtml}
              <div>${chips}</div>
            </td>
            <td valign="top" align="right" style="white-space:nowrap;">
              <span style="font-family:Georgia,serif;font-size:22px;color:#b98f1e;">${esc((c.assessment_priority_score / 10).toFixed(1))}</span><span style="font-size:11px;color:#a49e90;">/10</span>
            </td>
          </tr>
        </table>
        <p style="margin:12px 0 10px;font-size:14px;line-height:1.55;color:#3b372e;">${brief}</p>
        ${c.experience_hook ? `<p style="margin:0 0 10px;font-size:13px;line-height:1.5;color:#8a6d1f;font-style:italic;">✦ ${esc(truncateAtWord(c.experience_hook, 130))}</p>` : ""}
        ${surfacingLine(c)}
        ${c.score_breakdown ? scoreBreakdownHtml(c.score_breakdown) : ""}
        ${works ? `<p style="margin:0 0 14px;font-size:13px;color:#6b6558;">Worth a look: ${works}</p>` : ""}
        <a href="${esc(profileHref)}" style="display:inline-block;background:#e8c56a;color:#1a1408;font-weight:700;font-size:13px;padding:9px 20px;border-radius:8px;text-decoration:none;">Learn more →</a>
        ${github ? `&nbsp;&nbsp;<a href="${esc(github)}" style="display:inline-block;border:1px solid #d9d4c7;color:#3b372e;font-weight:600;font-size:13px;padding:8px 18px;border-radius:8px;text-decoration:none;">GitHub</a>` : ""}
      </td>
    </tr>
  </table>`;
}

export function renderHtml(
  digest: DigestDocument,
  opts?: { profileBaseUrl?: string }
): string {
  const profileBaseUrl =
    opts?.profileBaseUrl ?? `./profiles/${digest.digest_id}`;
  const date = new Date(digest.generated_at).toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });
  const cards = digest.candidates
    .map((c, i) => card(c, i, profileBaseUrl))
    .join("\n");

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>tSearch Talent Digest — ${esc(date)}</title>
</head>
<body style="margin:0;padding:0;background:#f4f1e9;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f1e9;">
    <tr><td align="center" style="padding:28px 14px;">
      <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:600px;max-width:100%;font-family:'Avenir Next','Segoe UI',system-ui,sans-serif;">
        <tr><td style="padding:0 4px 18px;">
          <span style="font-family:Georgia,serif;font-size:24px;font-weight:700;color:#1a1408;">tSearch</span>
          <span style="font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:#a49e90;">&nbsp;talent digest</span>
          <div style="font-size:13px;color:#6b6558;margin-top:6px;">${esc(date)} · ${esc(String(digest.candidates.length))} people surfaced from public building &amp; writing evidence</div>
        </td></tr>
        <tr><td>
          ${cards}
        </td></tr>
        <tr><td style="padding:12px 4px 0;font-size:11px;line-height:1.6;color:#a49e90;">
          Found by expanding real collaboration graphs from olympiad-level seeds, then assessing each person's public repositories and writing.
          Missing evidence never counts against anyone. Reply with a name to see more like them — or say "not relevant" and they won't reappear.<br/>
          <span style="color:#c4beb0;">digest ${esc(digest.digest_id)} · ${esc(String(digest.meta.discovered_candidate_count))} discovered · ${esc(String(digest.meta.assessed_candidate_count))} assessed</span>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}
