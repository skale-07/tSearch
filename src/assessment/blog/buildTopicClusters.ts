import crypto from "crypto";
import type { BlogArticle, TopicCluster } from "./types.js";

const STOP = new Set([
  "a",
  "an",
  "the",
  "and",
  "or",
  "but",
  "in",
  "on",
  "at",
  "to",
  "for",
  "of",
  "with",
  "by",
  "from",
  "as",
  "is",
  "are",
  "was",
  "were",
  "be",
  "this",
  "that",
  "these",
  "those",
  "it",
  "its",
  "into",
  "about",
  "over",
  "after",
  "before",
  "between",
  "through",
  "during",
  "without",
  "within",
  "also",
  "than",
  "then",
  "so",
  "if",
  "not",
  "no",
  "yes",
  "can",
  "could",
  "should",
  "would",
  "may",
  "might",
  "will",
  "just",
  "like",
  "using",
  "use",
  "used",
  "via",
  "how",
  "what",
  "when",
  "where",
  "which",
  "who",
  "why",
  "our",
  "we",
  "you",
  "your",
  "my",
  "their",
  "they",
  "them",
  "his",
  "her",
  "have",
  "has",
  "had",
  "do",
  "does",
  "did",
  "more",
  "most",
  "some",
  "any",
  "all",
  "each",
  "other",
  "such",
  "only",
  "own",
  "same",
  "too",
  "very",
  "one",
  "two",
  "new",
  "first",
]);

export function tokenizeKeywords(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s_-]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length >= 3 && !STOP.has(t) && !/^\d+$/.test(t));
}

function articleText(a: BlogArticle): string {
  return [a.title, ...a.sections.map((s) => `${s.heading ?? ""} ${s.text}`)].join(
    " "
  );
}

/**
 * Simple keyword overlap clustering — deterministic, no embeddings.
 */
export function buildTopicClusters(
  articles: BlogArticle[],
  opts?: { minSharedKeywords?: number; maxClusters?: number }
): TopicCluster[] {
  const minShared = opts?.minSharedKeywords ?? 2;
  const maxClusters = opts?.maxClusters ?? 12;

  const keywordsById = new Map<string, Set<string>>();
  for (const a of articles) {
    const counts = new Map<string, number>();
    for (const t of tokenizeKeywords(articleText(a))) {
      counts.set(t, (counts.get(t) ?? 0) + 1);
    }
    const top = [...counts.entries()]
      .sort((x, y) => y[1] - x[1] || x[0].localeCompare(y[0]))
      .slice(0, 12)
      .map(([k]) => k);
    keywordsById.set(a.article_id, new Set(top));
  }

  const parent = new Map<string, string>();
  const find = (id: string): string => {
    const p = parent.get(id) ?? id;
    if (p !== id) {
      const root = find(p);
      parent.set(id, root);
      return root;
    }
    return id;
  };
  const union = (a: string, b: string) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent.set(ra, rb);
  };

  for (const a of articles) parent.set(a.article_id, a.article_id);

  for (let i = 0; i < articles.length; i++) {
    for (let j = i + 1; j < articles.length; j++) {
      const ka = keywordsById.get(articles[i].article_id)!;
      const kb = keywordsById.get(articles[j].article_id)!;
      let shared = 0;
      for (const k of ka) if (kb.has(k)) shared++;
      if (shared >= minShared) {
        union(articles[i].article_id, articles[j].article_id);
      }
    }
  }

  const groups = new Map<string, string[]>();
  for (const a of articles) {
    const root = find(a.article_id);
    const list = groups.get(root) ?? [];
    list.push(a.article_id);
    groups.set(root, list);
  }

  const clusters: TopicCluster[] = [];
  for (const [, ids] of groups) {
    if (ids.length < 1) continue;
    const kwCounts = new Map<string, number>();
    for (const id of ids) {
      for (const k of keywordsById.get(id) ?? []) {
        kwCounts.set(k, (kwCounts.get(k) ?? 0) + 1);
      }
    }
    const keywords = [...kwCounts.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, 5)
      .map(([k]) => k);
    const label = keywords.slice(0, 3).join(" / ") || "general";
    const cluster_id = `tc_${crypto
      .createHash("sha1")
      .update(ids.slice().sort().join("|"))
      .digest("hex")
      .slice(0, 10)}`;
    clusters.push({
      cluster_id,
      label,
      keywords,
      article_ids: ids.slice().sort(),
    });
  }

  return clusters
    .sort(
      (a, b) =>
        b.article_ids.length - a.article_ids.length ||
        a.label.localeCompare(b.label)
    )
    .slice(0, maxClusters);
}
