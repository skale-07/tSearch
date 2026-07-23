import crypto from "crypto";
import type { ArtifactRelationship, ArtifactUrlRef } from "./types.js";

const GITHUB_REPO_RE =
  /https?:\/\/(?:www\.)?github\.com\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)/gi;

/** Pure: extract github owner/repo URLs from free text. */
export function extractGithubUrls(text: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const m of text.matchAll(GITHUB_REPO_RE)) {
    const owner = m[1];
    const repo = m[2].replace(/\.git$/i, "");
    if (/^(settings|orgs|marketplace|features|topics|collections|events|about|pricing|login|signup)$/i.test(owner)) {
      continue;
    }
    const url = `https://github.com/${owner}/${repo}`;
    if (seen.has(url.toLowerCase())) continue;
    seen.add(url.toLowerCase());
    out.push(url);
  }
  return out;
}

/** Pure: extract http(s) URLs that look like blog/article pages. */
export function extractBlogUrls(text: string): string[] {
  const urlRe = /https?:\/\/[^\s"'<>)\]]+/gi;
  const out: string[] = [];
  const seen = new Set<string>();
  for (const m of text.matchAll(urlRe)) {
    let raw = m[0].replace(/[).,;]+$/, "");
    if (/github\.com/i.test(raw)) continue;
    try {
      const u = new URL(raw);
      if (!/^https?:$/i.test(u.protocol)) continue;
      // Drop pure homepage roots without path? Keep them — README may link site.
      const key = u.toString().toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(u.toString());
    } catch {
      // skip
    }
  }
  return out;
}

function makeRelationshipId(
  source: string,
  target: string,
  type: string
): string {
  return `rel_${crypto
    .createHash("sha1")
    .update(`${source}:${target}:${type}`)
    .digest("hex")
    .slice(0, 12)}`;
}

function normalizeRepoUrl(url: string): string | null {
  const m = url.match(
    /^https?:\/\/(?:www\.)?github\.com\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)/i
  );
  if (!m) return null;
  return `https://github.com/${m[1]}/${m[2].replace(/\.git$/i, "")}`;
}

function urlsMatch(a: string, b: string): boolean {
  try {
    const ua = new URL(a);
    const ub = new URL(b);
    const pathA = ua.pathname.replace(/\/$/, "").toLowerCase();
    const pathB = ub.pathname.replace(/\/$/, "").toLowerCase();
    return (
      ua.hostname.toLowerCase() === ub.hostname.toLowerCase() &&
      pathA === pathB
    );
  } catch {
    return a.toLowerCase() === b.toLowerCase();
  }
}

/**
 * Deterministic link extraction:
 * - GitHub URLs in article text → article_links_repository
 * - Blog/article URLs in README text → repository_links_article
 */
export function extractDeterministicLinks(
  artifacts: ArtifactUrlRef[],
  opts?: { evidenceIdsByPair?: Map<string, string[]> }
): ArtifactRelationship[] {
  const repos = artifacts.filter(
    (a) =>
      a.kind === "github_repository" ||
      /github\.com\//i.test(a.canonical_url)
  );
  const articles = artifacts.filter(
    (a) =>
      a.kind === "technical_article" ||
      a.kind === "essay" ||
      (!/github\.com\//i.test(a.canonical_url) &&
        a.kind !== "github_repository")
  );

  const repoByUrl = new Map<string, ArtifactUrlRef>();
  for (const r of repos) {
    const n = normalizeRepoUrl(r.canonical_url);
    if (n) repoByUrl.set(n.toLowerCase(), r);
  }

  const articleByUrl = articles;

  const out: ArtifactRelationship[] = [];
  const seen = new Set<string>();

  const push = (rel: ArtifactRelationship) => {
    const key = `${rel.source_artifact_id}:${rel.target_artifact_id}:${rel.relationship_type}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push(rel);
  };

  for (const article of articles) {
    const text = article.text ?? "";
    for (const gh of extractGithubUrls(text)) {
      const target = repoByUrl.get(gh.toLowerCase());
      if (!target) continue;
      const pairKey = `${article.artifact_id}->${target.artifact_id}`;
      push({
        relationship_id: makeRelationshipId(
          article.artifact_id,
          target.artifact_id,
          "article_links_repository"
        ),
        source_artifact_id: article.artifact_id,
        target_artifact_id: target.artifact_id,
        relationship_type: "article_links_repository",
        deterministic: true,
        confidence_support: "high",
        evidence_ids: opts?.evidenceIdsByPair?.get(pairKey) ?? [],
        explanation: `Article text contains exact repository URL ${gh}`,
      });
    }
  }

  for (const repo of repos) {
    const text = repo.text ?? "";
    for (const blogUrl of extractBlogUrls(text)) {
      const target = articleByUrl.find((a) => urlsMatch(a.canonical_url, blogUrl));
      if (!target) continue;
      const pairKey = `${repo.artifact_id}->${target.artifact_id}`;
      push({
        relationship_id: makeRelationshipId(
          repo.artifact_id,
          target.artifact_id,
          "repository_links_article"
        ),
        source_artifact_id: repo.artifact_id,
        target_artifact_id: target.artifact_id,
        relationship_type: "repository_links_article",
        deterministic: true,
        confidence_support: "high",
        evidence_ids: opts?.evidenceIdsByPair?.get(pairKey) ?? [],
        explanation: `Repository README/text contains exact article URL ${blogUrl}`,
      });
    }
  }

  return out;
}
