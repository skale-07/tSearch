import fs from "fs";
import path from "path";

/**
 * Tier-1 system oracle: lexical (BM25) index over the repo's knowledge
 * surfaces. Deliberately in-memory and dependency-free — the corpus is small
 * (~docs + source), builds in well under a second, and staleness is a cheap
 * mtime scan.
 *
 * PII boundary: only the allowlisted roots below are ever walked. profiles/,
 * backup/, data/, cache/, and output/ hold scraped person data and must never
 * enter the index (this repo is public; the oracle may run against live LLMs).
 */

const FILE_ROOTS = ["README.md", "CLAUDE.md", "docs", "rubrics", "src", "server", "tests", "web/src", "scripts"];
const EXTENSIONS = new Set([".md", ".ts", ".tsx", ".yaml", ".yml"]);
const CODE_WINDOW = 60;
const CODE_STEP = 50;
const MD_MAX_SECTION = 80;

export interface OracleChunk {
  file: string;
  start_line: number;
  end_line: number;
  text: string;
}

export interface OracleIndex {
  root: string;
  built_at: string;
  chunks: OracleChunk[];
  /** term → number of chunks containing it */
  df: Map<string, number>;
  /** per-chunk term counts, same order as chunks */
  termCounts: Array<Map<string, number>>;
  avgLen: number;
  fileStamps: Map<string, string>;
}

export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9_]+/)
    .filter((t) => t.length >= 2);
}

function walk(root: string, rel: string, out: string[]): void {
  const abs = path.join(root, rel);
  const stat = fs.statSync(abs, { throwIfNoEntry: false });
  if (!stat) return;
  if (stat.isFile()) {
    if (EXTENSIONS.has(path.extname(rel))) out.push(rel);
    return;
  }
  for (const entry of fs.readdirSync(abs).sort()) {
    if (entry === "node_modules" || entry.startsWith(".")) continue;
    walk(root, path.join(rel, entry), out);
  }
}

export function listIndexFiles(root: string): string[] {
  const files: string[] = [];
  for (const r of FILE_ROOTS) walk(root, r, files);
  return files;
}

function stamp(root: string, file: string): string {
  const s = fs.statSync(path.join(root, file), { throwIfNoEntry: false });
  return s ? `${s.mtimeMs}:${s.size}` : "gone";
}

function chunkMarkdown(file: string, lines: string[]): OracleChunk[] {
  const chunks: OracleChunk[] = [];
  let start = 0;
  const flush = (end: number) => {
    // window long sections so a giant doc section stays retrievable
    for (let s = start; s < end; s += MD_MAX_SECTION) {
      const e = Math.min(end, s + MD_MAX_SECTION);
      const text = lines.slice(s, e).join("\n").trim();
      if (text) chunks.push({ file, start_line: s + 1, end_line: e, text });
    }
  };
  for (let i = 1; i < lines.length; i++) {
    if (/^#{1,3} /.test(lines[i])) {
      flush(i);
      start = i;
    }
  }
  flush(lines.length);
  return chunks;
}

function chunkCode(file: string, lines: string[]): OracleChunk[] {
  const chunks: OracleChunk[] = [];
  for (let s = 0; s < lines.length; s += CODE_STEP) {
    const e = Math.min(lines.length, s + CODE_WINDOW);
    const text = lines.slice(s, e).join("\n").trim();
    if (text) chunks.push({ file, start_line: s + 1, end_line: e, text });
    if (e >= lines.length) break;
  }
  return chunks;
}

export function buildIndex(root: string = process.cwd()): OracleIndex {
  const chunks: OracleChunk[] = [];
  const fileStamps = new Map<string, string>();

  for (const file of listIndexFiles(root)) {
    fileStamps.set(file, stamp(root, file));
    const lines = fs
      .readFileSync(path.join(root, file), "utf-8")
      .split("\n");
    chunks.push(
      ...(file.endsWith(".md")
        ? chunkMarkdown(file, lines)
        : chunkCode(file, lines))
    );
  }

  const df = new Map<string, number>();
  const termCounts: Array<Map<string, number>> = [];
  let totalLen = 0;
  for (const chunk of chunks) {
    const counts = new Map<string, number>();
    // Path tokens (weighted) make file names searchable — "feedback" should
    // reach src/digest/feedbackStore.ts even where the body says "verdict".
    const pathTokens = tokenize(
      chunk.file.replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    );
    const tokens = [
      ...tokenize(chunk.text),
      ...pathTokens,
      ...pathTokens,
      ...pathTokens,
    ];
    totalLen += tokens.length;
    for (const t of tokens) counts.set(t, (counts.get(t) ?? 0) + 1);
    for (const t of counts.keys()) df.set(t, (df.get(t) ?? 0) + 1);
    termCounts.push(counts);
  }

  return {
    root,
    built_at: new Date().toISOString(),
    chunks,
    df,
    termCounts,
    avgLen: chunks.length ? totalLen / chunks.length : 0,
    fileStamps,
  };
}

/** Cheap staleness probe: any indexed file changed, appeared, or vanished. */
export function isStale(index: OracleIndex): boolean {
  const current = listIndexFiles(index.root);
  if (current.length !== index.fileStamps.size) return true;
  for (const file of current) {
    if (index.fileStamps.get(file) !== stamp(index.root, file)) return true;
  }
  return false;
}

export interface OracleHit {
  chunk: OracleChunk;
  score: number;
}

const K1 = 1.5;
const B = 0.75;

export function searchIndex(
  index: OracleIndex,
  query: string,
  k = 8
): OracleHit[] {
  const terms = [...new Set(tokenize(query))];
  const n = index.chunks.length;
  if (!n || !terms.length) return [];

  const scored: OracleHit[] = [];
  for (let i = 0; i < n; i++) {
    const counts = index.termCounts[i];
    let len = 0;
    for (const c of counts.values()) len += c;
    let score = 0;
    for (const term of terms) {
      const tf = counts.get(term) ?? 0;
      if (!tf) continue;
      const dfT = index.df.get(term) ?? 0;
      const idf = Math.log(1 + (n - dfT + 0.5) / (dfT + 0.5));
      score +=
        (idf * tf * (K1 + 1)) /
        (tf + K1 * (1 - B + (B * len) / (index.avgLen || 1)));
    }
    if (score > 0) scored.push({ chunk: index.chunks[i], score });
  }

  return scored.sort((a, b) => b.score - a.score).slice(0, k);
}
