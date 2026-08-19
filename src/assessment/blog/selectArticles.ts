import { BLOG_BUDGETS } from "./types.js";
import type { BlogArticle, TopicCluster } from "./types.js";
import { isWritingPlatformHost } from "./writingHubs.js";

export interface SelectArticlesOptions {
  maxSelected?: number;
  now?: Date;
}

const JUNK_ARTICLE_TITLE =
  /^(page redirection|terms of service|privacy policy|medium privacy policy|work at medium|index|untitled|cookie policy|hello world!?)\b/i;

/** Portfolio nav labels — junk only when the body is still a stub. */
const NAV_LABEL_TITLE =
  /^(home|about|outreach|publications?|research|more projects|projects?)\b/i;

/** Below this, the page is a stub/nav shell — not judgeable writing. */
const MIN_SUBSTANCE_CHARS = 280;

function isJunkArticle(a: BlogArticle): boolean {
  const title = a.title.trim();
  if (JUNK_ARTICLE_TITLE.test(title)) return true;
  const len = articleLength(a);
  if (len < MIN_SUBSTANCE_CHARS) return true;
  if (NAV_LABEL_TITLE.test(title) && len < 800) return true;
  try {
    const u = new URL(a.canonical_url);
    const host = u.hostname.replace(/^www\./i, "");
    const path = u.pathname.replace(/\/$/, "") || "/";
    // Listing indexes are only useful when nothing deeper was found — drop
    // them when the path is exactly /blog or /posts.
    if (/^\/(blog|posts|articles|writing)$/i.test(path) && len < 800) {
      return true;
    }
    // Reserved Medium chrome hosts should never be selectable even if fetched.
    if (
      host === "policy.medium.com" ||
      host === "help.medium.com" ||
      /\/jobs-at-medium\//i.test(a.canonical_url)
    ) {
      return true;
    }
    // Drop zero-substance pages that only exist as platform chrome.
    if (isWritingPlatformHost(host) && len < 200) {
      if (/privacy|terms|jobs?|career|cookie/i.test(title)) return true;
    }
  } catch {
    return false;
  }
  return false;
}

function articleLength(a: BlogArticle): number {
  return a.sections.reduce((n, s) => n + s.text.length, 0);
}

// Conviction markers: the rubric now scores demonstrated conviction, so
// opinionated pieces must actually reach the judge — without this bonus a
// short manifesto loses its selection slot to any long neutral tutorial.
const OPINION_SIGNALS =
  /\b(wrong|myth|overrated|underrated|overhyped|disagree|contrarian|unpopular opinion|conventional wisdom|hot take|everyone (?:thinks|says|believes)|nobody talks about|i (?:believe|bet|refuse))\b/gi;

function opinionBonus(a: BlogArticle): number {
  const text = `${a.title} ${a.sections.map((s) => s.text).join(" ")}`.slice(
    0,
    8000
  );
  const hits = text.match(OPINION_SIGNALS)?.length ?? 0;
  return Math.min(0.2, hits * 0.05);
}

function recencyScore(a: BlogArticle, now: Date): number {
  const raw = a.published_at ?? a.modified_at;
  if (!raw) return 0;
  const t = Date.parse(raw);
  if (Number.isNaN(t)) return 0;
  const ageDays = (now.getTime() - t) / (24 * 60 * 60 * 1000);
  if (ageDays < 0) return 1;
  if (ageDays < 30) return 1;
  if (ageDays < 180) return 0.7;
  if (ageDays < 730) return 0.4;
  return 0.15;
}

/**
 * Pick up to N articles by length, recency, and topic diversity.
 */
export function selectArticles(
  articles: BlogArticle[],
  clusters: TopicCluster[],
  opts?: SelectArticlesOptions
): BlogArticle[] {
  const max = opts?.maxSelected ?? BLOG_BUDGETS.MAX_SELECTED_ARTICLES;
  const now = opts?.now ?? new Date();
  if (articles.length === 0) return [];

  const clusterOf = new Map<string, string>();
  for (const c of clusters) {
    for (const id of c.article_ids) {
      if (!clusterOf.has(id)) clusterOf.set(id, c.cluster_id);
    }
  }

  const scored = articles
    .filter((a) => !isJunkArticle(a))
    .map((a) => {
    const len = articleLength(a);
    const lengthScore = Math.min(1, len / 4000);
    const revBonus = a.revision_markers.length > 0 ? 0.1 : 0;
    const citeBonus = Math.min(0.15, a.citations.length * 0.03);
    const score =
      0.45 * lengthScore +
      0.4 * recencyScore(a, now) +
      revBonus +
      citeBonus +
      opinionBonus(a);
    return { article: a, score };
  });

  scored.sort(
    (a, b) =>
      b.score - a.score ||
      a.article.canonical_url.localeCompare(b.article.canonical_url)
  );

  const selected: BlogArticle[] = [];
  const usedClusters = new Set<string>();

  // First pass: prefer diverse clusters
  for (const s of scored) {
    if (selected.length >= max) break;
    const cid = clusterOf.get(s.article.article_id) ?? s.article.article_id;
    if (usedClusters.has(cid) && selected.length < max) {
      // skip same cluster until diversity pass fills
      continue;
    }
    selected.push(s.article);
    usedClusters.add(cid);
  }

  // Second pass: fill remaining by score
  if (selected.length < max) {
    const have = new Set(selected.map((a) => a.article_id));
    for (const s of scored) {
      if (selected.length >= max) break;
      if (have.has(s.article.article_id)) continue;
      selected.push(s.article);
    }
  }

  return selected;
}
