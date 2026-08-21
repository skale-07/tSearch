import crypto from "crypto";
import { canonicalizeUrl, hostnameOf, sameRegistrableHost } from "./canonicalizeUrl.js";
import { BLOG_BUDGETS } from "./types.js";
import type {
  ArticleSection,
  DateSupport,
  ExtractionMethod,
  OriginalAnalysisArtifact,
} from "./types.js";

export interface ExtractedArticleDraft {
  title: string;
  author_text?: string;
  language?: string;
  published_at?: string;
  modified_at?: string;
  date_support: DateSupport;
  extraction_method: ExtractionMethod;
  content_hash?: string;
  sections: ArticleSection[];
  internal_links: string[];
  external_links: string[];
  original_analysis_artifacts: OriginalAnalysisArtifact[];
  plain_text: string;
  collection_warnings: string[];
}

/**
 * Readability-ish extraction from HTML fixtures: strip chrome, pull title/sections.
 */
export function extractArticleFromHtml(
  html: string,
  pageUrl: string,
  opts?: { maxChars?: number }
): ExtractedArticleDraft {
  const maxChars = opts?.maxChars ?? BLOG_BUDGETS.MAX_ARTICLE_CHARS;
  const warnings: string[] = [];

  const title =
    metaContent(html, "og:title") ??
    jsonLdString(html, "headline") ??
    firstTagText(html, "title") ??
    firstHeading(html) ??
    "Untitled";

  const author_text = extractAuthorText(html);

  const language =
    html.match(/<html[^>]+lang=["']([^"']+)["']/i)?.[1] ?? undefined;

  const published_at = normalizeDate(
    metaContent(html, "article:published_time") ??
      metaName(html, "publish-date") ??
      jsonLdString(html, "datePublished")
  );
  const modified_at = normalizeDate(
    metaContent(html, "article:modified_time") ??
      jsonLdString(html, "dateModified")
  );

  let date_support: DateSupport = "low";
  if (published_at && modified_at) date_support = "high";
  else if (published_at || modified_at) date_support = "moderate";

  const articleHtml = pickRichestContent(html);
  const cleaned = stripChrome(articleHtml);
  const sections = sectionsFromHtml(cleaned);
  let plain_text = sections.map((s) => s.text).join("\n\n").trim();
  if (!plain_text) {
    plain_text = stripTags(cleaned).trim();
  }
  if (plain_text.length > maxChars) {
    plain_text = plain_text.slice(0, maxChars);
    warnings.push(`truncated_to_${maxChars}_chars`);
  }

  const method: ExtractionMethod =
    plain_text.length < 80 ? "metadata_only" : "readability";

  if (method === "metadata_only") {
    warnings.push("full_text_unavailable_or_thin");
  }

  const { internal_links, external_links } = collectLinks(
    cleaned,
    pageUrl
  );

  const original_analysis_artifacts = detectOriginalAnalysis(
    cleaned,
    plain_text,
    pageUrl
  );

  const content_hash =
    plain_text.length > 0
      ? crypto.createHash("sha1").update(plain_text).digest("hex").slice(0, 16)
      : undefined;

  return {
    title: stripTags(title).trim() || "Untitled",
    author_text,
    language,
    published_at,
    modified_at,
    date_support,
    extraction_method: method,
    content_hash,
    sections:
      sections.length > 0
        ? sections
        : plain_text
          ? [{ text: plain_text, order: 0 }]
          : [],
    internal_links,
    external_links,
    original_analysis_artifacts,
    plain_text,
    collection_warnings: warnings,
  };
}

function sectionsFromHtml(html: string): ArticleSection[] {
  const parts = html.split(/(?=<h[1-6]\b)/i);
  const sections: ArticleSection[] = [];
  let order = 0;
  for (const part of parts) {
    const hm = part.match(/^<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1>/i);
    if (hm) {
      const heading = stripTags(hm[2]).trim();
      const rest = part.slice(hm[0].length);
      const text = stripTags(rest).trim();
      if (heading || text) {
        sections.push({
          heading: heading || undefined,
          level: Number(hm[1]),
          text: text || heading,
          order: order++,
        });
      }
    } else {
      const text = stripTags(part).trim();
      if (text) {
        sections.push({ text, order: order++ });
      }
    }
  }
  return sections;
}

function collectLinks(
  html: string,
  pageUrl: string
): { internal_links: string[]; external_links: string[] } {
  const host = hostnameOf(pageUrl);
  const internal = new Set<string>();
  const external = new Set<string>();
  const re = /<a\b[^>]+href=["']([^"'#]+)["']/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const c = canonicalizeUrl(m[1], pageUrl);
    if (!c) continue;
    if (host && sameRegistrableHost(c, pageUrl)) internal.add(c);
    else external.add(c);
  }
  return {
    internal_links: [...internal],
    external_links: [...external],
  };
}

function detectOriginalAnalysis(
  html: string,
  text: string,
  pageUrl: string
): OriginalAnalysisArtifact[] {
  const out: OriginalAnalysisArtifact[] = [];
  const notebook =
    /https?:\/\/[^\s"'<>]+(?:colab\.research\.google|observablehq|notebooks?|jupyter)[^\s"'<>]*/gi;
  for (const m of text.match(notebook) ?? []) {
    out.push({
      kind: "notebook",
      url: canonicalizeUrl(m, pageUrl) ?? m,
      observation: "Links to a notebook or interactive analysis.",
    });
  }
  if (/<(table|figure)\b/i.test(html)) {
    out.push({
      kind: /<table\b/i.test(html) ? "table" : "figure",
      observation: "Page contains original table/figure markup.",
    });
  }
  const gh = text.match(
    /https?:\/\/(?:www\.)?github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+/gi
  );
  for (const m of gh ?? []) {
    out.push({
      kind: "code_repo",
      url: canonicalizeUrl(m, pageUrl) ?? m,
      observation: "Links to a GitHub repository.",
    });
  }
  return out.slice(0, 20);
}

function stripChrome(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<nav[\s\S]*?<\/nav>/gi, "")
    .replace(/<footer[\s\S]*?<\/footer>/gi, "")
    .replace(/<header[\s\S]*?<\/header>/gi, "");
}

function stripTags(s: string): string {
  return s
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, " ")
    .trim();
}

function firstTagText(html: string, tag: string): string | undefined {
  const m = html.match(new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i"));
  return m?.[1] ? stripTags(m[1]) : undefined;
}

function firstHeading(html: string): string | undefined {
  const m = html.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i);
  return m?.[1] ? stripTags(m[1]) : undefined;
}

function metaContents(html: string, prop: string): string[] {
  const out: string[] = [];
  const re = new RegExp(
    `<meta\\b[^>]*(?:property|name)=["']${prop}["'][^>]*>`,
    "gi"
  );
  const reFlip = new RegExp(
    `<meta\\b[^>]*content=["']([^"']+)["'][^>]*(?:property|name)=["']${prop}["'][^>]*>`,
    "gi"
  );
  for (const tag of html.match(re) ?? []) {
    const c = tag.match(/content=["']([^"']+)["']/i)?.[1];
    if (c?.trim()) out.push(c.trim());
  }
  for (const m of html.matchAll(reFlip)) {
    if (m[1]?.trim()) out.push(m[1].trim());
  }
  return [...new Set(out)];
}

function relAuthorTexts(html: string): string[] {
  const out: string[] = [];
  const re =
    /<a\b[^>]*rel=["'][^"']*\bauthor\b[^"']*["'][^>]*>([\s\S]*?)<\/a>/gi;
  for (const m of html.matchAll(re)) {
    const t = stripTags(m[1] ?? "").trim();
    if (t) out.push(t);
  }
  return [...new Set(out)];
}

function jsonLdAuthorNames(data: unknown): string[] {
  if (!data) return [];
  if (typeof data === "string") return data.trim() ? [data.trim()] : [];
  if (Array.isArray(data)) return data.flatMap(jsonLdAuthorNames);
  if (typeof data === "object") {
    const obj = data as Record<string, unknown>;
    if (typeof obj.name === "string" && obj.name.trim()) return [obj.name.trim()];
    if (obj.author !== undefined) return jsonLdAuthorNames(obj.author);
  }
  return [];
}

function jsonLdAuthors(html: string): string[] {
  const blocks = html.match(
    /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi
  );
  if (!blocks) return [];
  const names: string[] = [];
  for (const block of blocks) {
    const body = block.replace(/^[\s\S]*?>/, "").replace(/<\/script>$/i, "");
    try {
      const data = JSON.parse(body) as unknown;
      const v = findJsonLdValue(data, "author");
      names.push(...jsonLdAuthorNames(v));
    } catch {
      // ignore malformed json-ld
    }
  }
  return [...new Set(names)];
}

function extractAuthorText(html: string): string | undefined {
  const names = [
    ...metaContents(html, "author"),
    ...metaContents(html, "citation_author"),
    ...metaContents(html, "article:author"),
    ...jsonLdAuthors(html),
    ...relAuthorTexts(html),
  ];
  const unique: string[] = [];
  const seen = new Set<string>();
  for (const n of names) {
    const k = n.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    unique.push(n);
  }
  return unique.length ? unique.join("; ") : undefined;
}

function metaContent(html: string, prop: string): string | undefined {
  const re = new RegExp(
    `<meta[^>]+(?:property|name)=["']${prop}["'][^>]+content=["']([^"']+)["']`,
    "i"
  );
  const re2 = new RegExp(
    `<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']${prop}["']`,
    "i"
  );
  return html.match(re)?.[1] ?? html.match(re2)?.[1];
}

function metaName(html: string, name: string): string | undefined {
  return metaContent(html, name);
}

function jsonLdString(html: string, key: string): string | undefined {
  const blocks = html.match(
    /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi
  );
  if (!blocks) return undefined;
  for (const block of blocks) {
    const body = block.replace(/^[\s\S]*?>/, "").replace(/<\/script>$/i, "");
    try {
      const data = JSON.parse(body) as unknown;
      const v = findJsonLdValue(data, key);
      if (typeof v === "string") return v;
      if (v && typeof v === "object" && "name" in (v as object)) {
        return String((v as { name: string }).name);
      }
    } catch {
      // ignore malformed json-ld
    }
  }
  return undefined;
}

function findJsonLdValue(data: unknown, key: string): unknown {
  if (!data || typeof data !== "object") return undefined;
  if (Array.isArray(data)) {
    for (const item of data) {
      const v = findJsonLdValue(item, key);
      if (v !== undefined) return v;
    }
    return undefined;
  }
  const obj = data as Record<string, unknown>;
  if (key in obj) return obj[key];
  if (Array.isArray(obj["@graph"])) {
    return findJsonLdValue(obj["@graph"], key);
  }
  return undefined;
}

function extractByTag(html: string, tag: string): string | null {
  const m = html.match(
    new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i")
  );
  return m?.[1] ?? null;
}

function extractAllByTag(html: string, tag: string): string[] {
  const out: string[] = [];
  const re = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`, "gi");
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    if (m[1]) out.push(m[1]);
  }
  return out;
}

function extractByClass(html: string, classRe: RegExp): string | null {
  const all = extractAllByClass(html, classRe);
  return all[0] ?? null;
}

function extractAllByClass(html: string, classRe: RegExp): string[] {
  const out: string[] = [];
  const re = /<(?:div|section|main|article)\b([^>]*)>([\s\S]*?)<\/(?:div|section|main|article)>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const attrs = m[1];
    const cls = attrs.match(/class=["']([^"']+)["']/i)?.[1] ?? "";
    if (classRe.test(cls) && m[2]) out.push(m[2]);
  }
  return out;
}

/**
 * Prefer the longest real content block. First <article> on WP themes is often
 * a nav card / hello-world teaser — length beats first-match.
 */
function pickRichestContent(html: string): string {
  const candidates = [
    ...extractAllByTag(html, "article"),
    ...extractAllByTag(html, "main"),
    ...extractAllByClass(
      html,
      /wp-block-post-content|post-content|entry-content|article-body|site-content|content-area/i
    ),
  ];
  if (candidates.length === 0) return html;
  let best = candidates[0]!;
  let bestLen = stripTags(best).length;
  for (const c of candidates.slice(1)) {
    const len = stripTags(c).length;
    if (len > bestLen) {
      best = c;
      bestLen = len;
    }
  }
  // If every candidate is still a stub, fall back to full document.
  if (bestLen < 120) return html;
  return best;
}

function normalizeDate(raw?: string): string | undefined {
  if (!raw) return undefined;
  const t = Date.parse(raw);
  if (!Number.isNaN(t)) return new Date(t).toISOString();
  return raw.trim();
}
