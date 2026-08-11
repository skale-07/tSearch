import { BLOG_BUDGETS } from "./types.js";
import type { BlogArticle, TopicCluster } from "./types.js";

export interface SelectArticlesOptions {
  maxSelected?: number;
  now?: Date;
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

  const scored = articles.map((a) => {
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
