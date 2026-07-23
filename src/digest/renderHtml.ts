import type { DigestDocument } from "./types.js";

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
    const u = new URL(url);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    return u.toString();
  } catch {
    return null;
  }
}

export function renderHtml(digest: DigestDocument): string {
  const cards = digest.candidates
    .map((c) => {
      const tech = c.technical_summary
        ? `<p style="margin:8px 0;"><strong>Technical depth:</strong> ${esc(String(c.technical_summary.score))}/10 (confidence ${esc(String(c.technical_summary.confidence))})</p>
           <p style="margin:8px 0;color:#333;">${esc(c.technical_summary.rationale.slice(0, 600))}</p>`
        : "";
      const artifacts = c.strongest_artifacts
        .map((a) => {
          const href = safeHref(a.url);
          return href
            ? `<li><a href="${esc(href)}">${esc(a.title)}</a> — ${esc(a.reason_selected)}</li>`
            : `<li>${esc(a.title)}</li>`;
        })
        .join("");
      const links = [
        ["GitHub", c.links.github],
        ["LinkedIn", c.links.linkedin],
        ["Website", c.links.website],
        ["Blog", c.links.blog],
      ]
        .map(([label, url]) => {
          const href = safeHref(url);
          return href
            ? `<a href="${esc(href)}" style="margin-right:12px;">${esc(String(label))}</a>`
            : "";
        })
        .join("");

      return `
      <section style="border:1px solid #ddd;border-radius:8px;padding:16px;margin:16px 0;">
        <h2 style="margin:0 0 8px;font-size:18px;">${esc(String(c.rank))}. ${esc(c.name)}</h2>
        <p style="margin:0;color:#555;font-size:13px;">${esc(c.archetype.replace(/_/g, " "))}</p>
        <p style="margin:8px 0 12px;">${esc(c.headline)}</p>
        <p style="margin:4px 0;font-size:13px;">Discovery score: <strong>${esc(String(c.discovery_score))}</strong> · Assessment priority: <strong>${esc(String(c.assessment_priority_score))}/100</strong></p>
        <h3 style="font-size:14px;margin:12px 0 4px;">Why highlighted</h3>
        <ul style="margin:0;padding-left:18px;">${c.why_highlighted
          .map(
            (w) =>
              `<li><strong>${esc(w.claim)}</strong> — ${esc(w.rationale.slice(0, 300))}</li>`
          )
          .join("")}</ul>
        ${tech}
        <h3 style="font-size:14px;margin:12px 0 4px;">Curiosity signal</h3>
        <p style="margin:4px 0;">${esc(String(c.curiosity_summary.score))}/10 — ${esc(c.curiosity_summary.rationale.slice(0, 400))}</p>
        <h3 style="font-size:14px;margin:12px 0 4px;">Best artifacts</h3>
        <ul style="margin:0;padding-left:18px;">${artifacts}</ul>
        <h3 style="font-size:14px;margin:12px 0 4px;">Uncertainties</h3>
        <ul style="margin:0;padding-left:18px;">${c.important_uncertainties
          .map((u) => `<li>${esc(u)}</li>`)
          .join("")}</ul>
        <p style="margin:12px 0 4px;"><strong>Next:</strong> ${esc(c.next_review_step)}</p>
        <p style="margin:8px 0 0;">${links}</p>
      </section>`;
    })
    .join("\n");

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>tSearch Digest ${esc(digest.digest_id)}</title>
</head>
<body style="font-family:Georgia,serif;line-height:1.45;color:#111;max-width:720px;margin:0 auto;padding:16px;">
  <h1 style="font-size:22px;">tSearch Candidate Assessment Digest</h1>
  <p style="color:#555;font-size:13px;">
    Run <code>${esc(digest.assessment_run_id)}</code> ·
    Digest <code>${esc(digest.digest_id)}</code> ·
    ${esc(digest.generated_at)}
  </p>
  <p>${esc(digest.criteria_summary.purpose)}</p>
  <p style="font-size:13px;">
    Discovered ${esc(String(digest.meta.discovered_candidate_count))} ·
    Assessed ${esc(String(digest.meta.assessed_candidate_count))}
  </p>
  <h2 style="font-size:16px;">Not treated as proof</h2>
  <ul>${digest.criteria_summary.important_non_signals
    .map((n) => `<li>${esc(n)}</li>`)
    .join("")}</ul>
  ${cards}
  <p style="font-size:12px;color:#777;margin-top:24px;">Generated from persisted assessment snapshots. This email did not call an LLM.</p>
</body>
</html>`;
}
