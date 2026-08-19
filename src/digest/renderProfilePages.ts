import fs from "fs";
import path from "path";
import type { Candidate } from "../types.js";
import type { DigestCandidate, DigestDocument } from "./types.js";
import { identityFromCandidate } from "../assessment/candidateIdentity.js";
import { slugify } from "../storage/jsonStore.js";

/**
 * "Learn more" pages: one standalone, self-styled HTML profile per digest
 * candidate — photo, credentials, notable work — written next to the digest
 * so the email's Learn more buttons resolve wherever the folder is opened or
 * hosted. No LLM, no network at render time; emails are never included.
 */

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function safeHref(url: string | undefined | null): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    return u.toString();
  } catch {
    return null;
  }
}

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

export function profileFileName(c: DigestCandidate): string {
  return `${slugify(c.candidate_id)}.html`;
}

function chip(label: string, accent = false): string {
  return `<span class="chip${accent ? " chip-accent" : ""}">${label}</span>`;
}

function linkBtn(label: string, url: string | undefined): string {
  const href = safeHref(url);
  return href
    ? `<a class="btn" href="${esc(href)}" target="_blank" rel="noreferrer">${esc(label)}</a>`
    : "";
}

function section(title: string, body: string): string {
  return body
    ? `<section class="card"><h2>${esc(title)}</h2>${body}</section>`
    : "";
}

function credentialsBody(c: DigestCandidate, source?: Candidate): string {
  const rows: string[] = [];
  const oly = source?.olympiad;
  if (oly?.prizes?.length) {
    const prizes = oly.prizes
      .slice(0, 6)
      .map((p) => `<li>🏅 ${esc(p)}</li>`)
      .join("");
    rows.push(`<ul class="plain">${prizes}</ul>`);
  }
  const edu = source?.linkedin?.education ?? [];
  if (edu.length) {
    rows.push(
      `<ul class="plain">${edu
        .slice(0, 3)
        .map(
          (e) =>
            `<li>🎓 ${esc(e.school)}${e.degree ? ` — ${esc(e.degree)}` : ""}${e.field ? `, ${esc(e.field)}` : ""}${e.years ? ` <span class="muted">(${esc(e.years)})</span>` : ""}</li>`
        )
        .join("")}</ul>`
    );
  }
  const awards = (source?.linkedin?.awards ?? []).filter(
    (a) => a.title?.trim()
  );
  if (awards.length) {
    rows.push(
      `<ul class="plain">${awards
        .slice(0, 5)
        .map(
          (a) =>
            `<li>🏆 ${esc(a.title)}${a.issuer ? ` <span class="muted">· ${esc(a.issuer)}</span>` : ""}</li>`
        )
        .join("")}</ul>`
    );
  }
  return rows.join("");
}

function workBody(c: DigestCandidate, source?: Candidate): string {
  const parts: string[] = [];
  if (c.strongest_artifacts.length) {
    parts.push(
      `<ul class="plain">${c.strongest_artifacts
        .slice(0, 5)
        .map((a) => {
          const href = safeHref(a.url);
          const title = href
            ? `<a href="${esc(href)}" target="_blank" rel="noreferrer">${esc(a.title)}</a>`
            : esc(a.title);
          return `<li>${title} <span class="muted">· ${esc(humanize(a.kind))}</span></li>`;
        })
        .join("")}</ul>`
    );
  }
  const repos = (source?.github?.repos ?? [])
    .filter((r) => r.name)
    .sort((a, b) => (b.stars ?? 0) - (a.stars ?? 0))
    .slice(0, 4);
  if (repos.length && source?.github?.username) {
    const user = source.github.username;
    parts.push(
      `<div class="repo-grid">${repos
        .map((r) => {
          const href = safeHref(`https://github.com/${user}/${r.name}`);
          const meta = [
            r.language ? esc(r.language) : null,
            r.stars ? `★ ${r.stars}` : null,
          ]
            .filter(Boolean)
            .join(" · ");
          return `<a class="repo" href="${href ? esc(href) : "#"}" target="_blank" rel="noreferrer"><strong>${esc(r.name)}</strong><span class="muted">${meta}</span>${r.topics?.length ? `<span class="muted">${r.topics.slice(0, 3).map(esc).join(", ")}</span>` : ""}</a>`;
        })
        .join("")}</div>`
    );
  }
  return parts.join("");
}

export function renderProfilePage(
  c: DigestCandidate,
  source?: Candidate
): string {
  const photo = safeHref(source?.linkedin?.photo_url ?? undefined);
  const avatar = photo
    ? `<div class="avatar"><span>${esc(initials(c.name))}</span><img src="${esc(photo)}" alt="" onerror="this.remove()" /></div>`
    : `<div class="avatar"><span>${esc(initials(c.name))}</span></div>`;

  const chips = [
    chip(esc(humanize(c.primary_archetype)), true),
    c.network_bridges
      ? chip(
          `🔗 bridges ${c.network_bridges.seed_count} seed-set members`
        )
      : "",
    source?.olympiad?.sources?.length
      ? chip(esc(source.olympiad.sources.join(" · ")))
      : "",
  ]
    .filter(Boolean)
    .join("");

  const brief = esc(
    (c.brief_rationale ?? c.why_highlighted[0]?.rationale ?? c.headline).slice(
      0,
      1200
    )
  );

  const bridgeLine = c.network_bridges
    ? `<p class="bridge">Connected to ${c.network_bridges.seed_count} people in the seed set: ${esc(c.network_bridges.seeds.join(", "))}${c.network_bridges.collaborator_of.length ? ` — co-contributor with ${esc(c.network_bridges.collaborator_of.join(", "))}` : ""}.</p>`
    : "";

  const writing =
    c.writing_summary?.available && c.writing_summary.rationale
      ? `<p>${esc(c.writing_summary.rationale.slice(0, 700))}</p>`
      : "";

  const caveats = c.important_uncertainties.length
    ? `<details><summary>What the evidence can't show yet</summary><ul class="plain">${c.important_uncertainties
        .map((u) => `<li>${esc(u)}</li>`)
        .join("")}</ul></details>`
    : "";

  const assessment = `
    <div class="score-row">
      <div><span class="big">${esc((c.assessment_priority_score / 10).toFixed(1))}</span><span class="muted">/10 overall</span></div>
    </div>
    ${c.technical_summary ? `<p>${esc(c.technical_summary.rationale.slice(0, 800))}</p>` : ""}
    ${caveats}
    <p class="next"><strong>Suggested first look:</strong> ${esc(c.next_review_step)}</p>`;

  const links = [
    linkBtn("GitHub", c.links.github),
    linkBtn("LinkedIn", c.links.linkedin),
    linkBtn("Website", c.links.website),
    linkBtn("Blog", c.links.blog),
  ]
    .filter(Boolean)
    .join("");

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${esc(c.name)} — tSearch</title>
<style>
  :root { --bg:#12151a; --card:#1a1f27; --ink:#faf6ed; --muted:#9aa3b2; --accent:#e8c56a; --line:rgba(250,246,237,.12); }
  * { box-sizing:border-box; }
  body { margin:0; background:radial-gradient(ellipse 80% 50% at 50% -10%, rgba(232,197,106,.08), transparent), #12151a; color:var(--ink); font:16px/1.55 "Avenir Next", "Segoe UI", system-ui, sans-serif; }
  .wrap { max-width:780px; margin:0 auto; padding:40px 20px 64px; }
  .brand { color:var(--accent); font-family:Georgia, serif; font-weight:700; font-size:20px; letter-spacing:-.02em; }
  .brand small { color:var(--muted); font-family:inherit; font-weight:400; letter-spacing:.14em; text-transform:uppercase; font-size:11px; margin-left:8px; }
  .hero { display:flex; gap:22px; align-items:center; margin:28px 0 8px; }
  .avatar { position:relative; width:96px; height:96px; border-radius:50%; background:linear-gradient(135deg, #2a3140, #1a1f27); border:2px solid var(--accent); display:grid; place-items:center; flex-shrink:0; overflow:hidden; }
  .avatar span { font-size:30px; color:var(--accent); font-family:Georgia, serif; }
  .avatar img { position:absolute; inset:0; width:100%; height:100%; object-fit:cover; }
  h1 { margin:0; font-family:Georgia, serif; font-size:34px; letter-spacing:-.02em; }
  .headline { color:var(--muted); margin:4px 0 10px; }
  .chip { display:inline-block; font-size:12px; padding:3px 10px; border:1px solid var(--line); border-radius:999px; color:var(--muted); margin:0 6px 6px 0; }
  .chip-accent { border-color:rgba(232,197,106,.5); color:var(--accent); background:rgba(232,197,106,.08); }
  .card { background:rgba(26,31,39,.75); border:1px solid var(--line); border-radius:12px; padding:20px 22px; margin:16px 0; }
  .card h2 { margin:0 0 10px; font-size:13px; letter-spacing:.12em; text-transform:uppercase; color:var(--muted); }
  .plain { margin:0; padding:0; list-style:none; }
  .plain li { margin:6px 0; }
  .muted { color:var(--muted); font-size:.9em; }
  .bridge { border-left:3px solid var(--accent); padding:6px 12px; background:rgba(232,197,106,.06); border-radius:0 8px 8px 0; }
  .repo-grid { display:grid; grid-template-columns:repeat(auto-fill, minmax(210px, 1fr)); gap:10px; margin-top:10px; }
  .repo { display:flex; flex-direction:column; gap:2px; padding:12px 14px; border:1px solid var(--line); border-radius:10px; text-decoration:none; color:var(--ink); background:rgba(18,21,26,.5); }
  .repo:hover { border-color:rgba(232,197,106,.5); }
  a { color:var(--accent); }
  .btn { display:inline-block; margin:0 10px 10px 0; padding:9px 18px; border:1px solid rgba(232,197,106,.5); border-radius:8px; color:var(--accent); text-decoration:none; font-weight:600; font-size:14px; }
  .btn:hover { background:rgba(232,197,106,.12); }
  .big { font-family:Georgia, serif; font-size:40px; color:var(--accent); margin-right:8px; }
  .score-row { margin-bottom:8px; }
  details { margin:12px 0; }
  summary { cursor:pointer; color:var(--muted); }
  .next { margin-bottom:0; }
  footer { color:var(--muted); font-size:12px; margin-top:28px; }
</style>
</head>
<body>
<div class="wrap">
  <div class="brand">tSearch<small>talent profile</small></div>
  <div class="hero">
    ${avatar}
    <div>
      <h1>${esc(c.name)}</h1>
      <p class="headline">${esc((source?.linkedin?.headline ?? c.headline).slice(0, 160))}</p>
      <div>${chips}</div>
    </div>
  </div>
  ${bridgeLine}
  ${section("Why they stand out", `<p>${brief}</p>`)}
  ${section("Credentials", credentialsBody(c, source))}
  ${section("Projects & work", workBody(c, source))}
  ${section("Writing", writing)}
  ${section("Assessment", assessment)}
  <div style="margin-top:18px;">${links}</div>
  <footer>Generated by tSearch from public evidence · digest candidate ${esc(c.candidate_id)} · missing evidence is never counted against anyone.</footer>
</div>
</body>
</html>`;
}

/** Writes one page per digest candidate into dir. Returns pages written. */
export function writeDigestProfilePages(
  digest: DigestDocument,
  sources: Candidate[],
  dir: string
): number {
  fs.mkdirSync(dir, { recursive: true });
  const byId = new Map(
    sources.map((s) => [identityFromCandidate(s).candidate_id, s])
  );
  let written = 0;
  for (const c of digest.candidates) {
    const html = renderProfilePage(c, byId.get(c.candidate_id));
    fs.writeFileSync(path.join(dir, profileFileName(c)), html, "utf-8");
    written++;
  }
  return written;
}
