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
        ? `<p style="margin:8px 0;"><strong>Technical:</strong> ${esc(String(c.technical_summary.score))}/5 avg (confidence ${esc(String(c.technical_summary.confidence))})</p>
           <p style="margin:8px 0;color:#333;">${esc(c.technical_summary.rationale.slice(0, 700))}</p>`
        : "";
      const writing =
        c.writing_summary?.available && c.writing_summary.rationale
          ? `<p style="margin:8px 0;"><strong>Writing:</strong> ${esc(c.writing_summary.rationale.slice(0, 500))}</p>`
          : "";
      const artifacts = c.strongest_artifacts
        .map((a) => {
          const href = safeHref(a.url);
          return href
            ? `<li><a href="${esc(href)}">${esc(a.title)}</a></li>`
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
            ? `<a href="${esc(href)}" style="margin-right:14px;font-weight:600;">${esc(String(label))}</a>`
            : "";
        })
        .join("");
      const brief = esc(
        (c.brief_rationale ?? c.why_highlighted[0]?.rationale ?? c.headline).slice(
          0,
          900
        )
      );
      const cory = c.cory_relevance
        ? `<span style="display:inline-block;margin-left:8px;padding:2px 8px;border:1px solid #ccc;border-radius:999px;font-size:12px;">Cory: ${esc(c.cory_relevance)}</span>`
        : "";

      return `
      <section style="border:1px solid #ddd;border-radius:8px;padding:16px;margin:16px 0;">
        <h2 style="margin:0 0 8px;font-size:18px;">${esc(String(c.rank))}. ${esc(c.name)}</h2>
        <p style="margin:0 0 8px;">${links || "<span style='color:#888;'>No profile links</span>"}</p>
        <p style="margin:0;color:#555;font-size:13px;">${esc(c.primary_archetype.replace(/_/g, " "))}${cory}</p>
        <p style="margin:8px 0 12px;">${esc(c.headline)}</p>
        <p style="margin:4px 0;font-size:13px;">Assessment priority: <strong>${esc(String(c.assessment_priority_score))}/100</strong> · Discovery score: <strong>${esc(String(c.discovery_score))}</strong></p>
        <h3 style="font-size:14px;margin:12px 0 4px;">Why send to Cory</h3>
        <p style="margin:4px 0;color:#222;">${brief}</p>
        <h3 style="font-size:14px;margin:12px 0 4px;">Specific work to inspect</h3>
        <ul style="margin:0;padding-left:18px;">${artifacts || "<li><em>None retained</em></li>"}</ul>
        ${tech}
        ${writing}
        <h3 style="font-size:14px;margin:12px 0 4px;">Caveats</h3>
        <ul style="margin:0;padding-left:18px;">${c.important_uncertainties
          .map((u) => `<li>${esc(u)}</li>`)
          .join("")}</ul>
        <p style="margin:12px 0 4px;"><strong>Next:</strong> ${esc(c.next_review_step)}</p>
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
  <h1 style="font-size:22px;">tSearch → Cory: Candidate Digest</h1>
  <p style="color:#555;font-size:13px;">
    Run <code>${esc(digest.assessment_run_id)}</code> ·
    Digest <code>${esc(digest.digest_id)}</code> ·
    ${esc(digest.generated_at)}
  </p>
  <p>${esc(digest.criteria_summary.purpose)}</p>
  <p style="font-size:13px;">
    Discovered ${esc(String(digest.meta.discovered_candidate_count))} ·
    Assessed ${esc(String(digest.meta.assessed_candidate_count))} ·
    Included ${esc(String(digest.candidates.length))}
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
