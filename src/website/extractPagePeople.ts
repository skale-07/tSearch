import { githubUsernameFromUrl } from "../linkedin/linkedinExtract.js";
import { htmlToExcerpt } from "./scrapeWebsite.js";

export type PagePersonConfidence = "high" | "medium" | "low";

export interface PagePerson {
  name: string;
  linkedin_url?: string;
  github_url?: string;
  confidence: PagePersonConfidence;
  evidence: string;
  /** High/medium default on in the preview checklist; low stays unchecked. */
  checked_default: boolean;
}

const PREVIEW_CAP = 40;

const GENERIC_LINK =
  /linkedin\.com|twitter\.com|\bx\.com\b|facebook\.com|instagram\.com|^mailto:/i;

const STOP_NAMES = new Set(
  [
    "home",
    "about",
    "contact",
    "team",
    "people",
    "members",
    "lab",
    "research",
    "publications",
    "projects",
    "news",
    "blog",
    "privacy",
    "terms",
    "login",
    "sign",
    "university",
    "college",
    "institute",
    "laboratory",
    "department",
    "faculty",
    "staff",
    "students",
    "alumni",
    "read more",
    "learn more",
    "view all",
    "skip to",
    "main content",
    "click here",
  ].map((s) => s.toLowerCase())
);

export function normalizeNameKey(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function decodeEntities(raw: string): string {
  return raw
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/\s+/g, " ")
    .trim();
}

function stripTags(html: string): string {
  return decodeEntities(html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " "));
}

/** Strip medal/result prefixes so "Gold Medal Ada Lovelace" nominates Ada. */
export function peelResultPrefix(raw: string): string {
  return decodeEntities(raw)
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^(?:written by|by)\s+/i, "")
    .replace(
      /^(?:gold|silver|bronze)\s+medal\s+/i,
      ""
    )
    .replace(/^(?:honorable mention|participation)\s+/i, "")
    .trim();
}

const ROSTER_PATH_TOKENS = new Set([
  "team",
  "people",
  "roster",
  "history",
  "results",
  "members",
  "winners",
]);

/** Leftover title-case sweep only on roster/results URLs, not news/project pages. */
export function isRosterResultsUrl(pageUrl: string): boolean {
  try {
    const path = new URL(pageUrl).pathname.toLowerCase();
    return path
      .split(/[/_\-.]+/)
      .some((token) => ROSTER_PATH_TOKENS.has(token));
  } catch {
    return false;
  }
}

/** All-caps acronym — org token, not a given/family name. */
function isAcronymToken(word: string): boolean {
  return /^[A-Z]{2,}$/.test(word);
}

/** 2–4 capitalized tokens, not an org/nav phrase. */
export function isPersonShapedName(raw: string): boolean {
  const name = peelResultPrefix(raw);
  if (name.length < 4 || name.length > 60) return false;
  if (STOP_NAMES.has(name.toLowerCase())) return false;
  if (/[0-9/@:]/.test(name)) return false;
  const words = name.split(" ").filter(Boolean);
  if (words.length < 2 || words.length > 4) return false;
  if (words.some((w) => STOP_NAMES.has(w.toLowerCase()))) return false;
  if (words.some((w) => isAcronymToken(w))) return false;
  return words.every(
    (w) =>
      /^[A-Z][a-zA-Z'’-]*$/.test(w) && w.length >= 2 && /[a-z]/.test(w)
  );
}

export function isSoftNotFoundPage(html: string): boolean {
  const title = stripTags(
    html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? ""
  );
  const h1 = stripTags(html.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i)?.[1] ?? "");
  return /page not found|not found|404/i.test(`${title} ${h1}`.slice(0, 200));
}

/** Prefer article body; drop nav/header so "The Team" in chrome doesn't gate extract. */
export function extractMainHtml(html: string): string {
  const article = html.match(/<article\b[^>]*>[\s\S]*?<\/article>/i)?.[0];
  if (article && article.length > 400) return article;
  const entry = html.match(
    /class="[^"]*entry-content[^"]*"[\s\S]{200,80000}<\/div>/i
  )?.[0];
  if (entry) return entry;
  const main = html.match(/<main\b[^>]*>[\s\S]*?<\/main>/i)?.[0];
  if (main && main.length > 400) return main;
  return html
    .replace(/<nav\b[\s\S]*?<\/nav>/gi, " ")
    .replace(/<header\b[\s\S]*?<\/header>/gi, " ")
    .replace(/<footer\b[\s\S]*?<\/footer>/gi, " ")
    .replace(/<aside\b[\s\S]*?<\/aside>/gi, " ");
}

const TITLE_ACRONYM_SKIP = new Set([
  "THE",
  "AND",
  "FOR",
  "OUR",
  "NEW",
  "TEAM",
  "WWW",
  "HTTP",
  "HTML",
  "USA",
  "PDF",
  "FAQ",
]);

export function orgLabelFromUrl(url: string | null | undefined): string | null {
  if (!url?.trim()) return null;
  try {
    const host = new URL(url).hostname.replace(/^www\./i, "").toLowerCase();
    const parts = host.split(".").filter(Boolean);
    const tlds = new Set([
      "com",
      "org",
      "net",
      "edu",
      "io",
      "ai",
      "co",
      "us",
      "uk",
      "ac",
      "gov",
    ]);
    while (parts.length > 1 && tlds.has(parts[parts.length - 1]!)) {
      parts.pop();
    }
    const label = parts[parts.length - 1]?.trim();
    return label && label.length >= 2 && label.length <= 16 ? label : null;
  } catch {
    return null;
  }
}

/**
 * Shared org/award token from the page itself — not the seed's school.
 * Prefers a title/h1 acronym that matches the host (USAAAO), else host label.
 */
export function extractOrgHintFromPage(
  html: string,
  pageUrl: string
): string | null {
  const fromHost = orgLabelFromUrl(pageUrl);
  const title = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1];
  const h1 = html.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i)?.[1];
  const blob = stripTags([title, h1].filter(Boolean).join(" "));
  const acronyms = [...blob.matchAll(/\b([A-Z]{3,12})\b/g)]
    .map((m) => m[1] ?? "")
    .filter((a) => a && !TITLE_ACRONYM_SKIP.has(a));
  if (fromHost) {
    const hit = acronyms.find((a) => {
      const lower = a.toLowerCase();
      return (
        lower === fromHost ||
        lower.includes(fromHost) ||
        fromHost.includes(lower)
      );
    });
    if (hit) return hit;
  }
  if (acronyms[0]) return acronyms[0];
  return fromHost;
}

function titleFromSlug(slug: string): string | null {
  const cleaned = slug
    .replace(/[_/]+/g, "-")
    .replace(/-\d{2,}$/g, "")
    .replace(/-+/g, " ")
    .trim();
  if (!cleaned) return null;
  const titled = cleaned
    .split(" ")
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(" ");
  return isPersonShapedName(titled) ? titled : null;
}

function linkedInInUrl(href: string, baseUrl: string): string | null {
  try {
    const u = new URL(href, baseUrl);
    const host = u.hostname.replace(/^www\./i, "").toLowerCase();
    if (host !== "linkedin.com" && !host.endsWith(".linkedin.com")) return null;
    const m = u.pathname.match(/\/in\/([^/?#]+)/i);
    if (!m) return null;
    return `https://www.linkedin.com/in/${decodeURIComponent(m[1]).toLowerCase()}/`;
  } catch {
    return null;
  }
}

function githubProfileUrl(href: string, baseUrl: string): string | null {
  try {
    const u = new URL(href, baseUrl);
    const login = githubUsernameFromUrl(u.toString());
    return login ? `https://github.com/${login}` : null;
  } catch {
    return null;
  }
}

interface Hit {
  name: string;
  linkedin_url?: string;
  github_url?: string;
  confidence: PagePersonConfidence;
  evidence: string;
}

function prefer(a: Hit, b: Hit): Hit {
  const rank = { high: 3, medium: 2, low: 1 };
  const winner = rank[b.confidence] > rank[a.confidence] ? b : a;
  return {
    ...winner,
    linkedin_url: a.linkedin_url ?? b.linkedin_url ?? winner.linkedin_url,
    github_url: a.github_url ?? b.github_url ?? winner.github_url,
  };
}

function collectAnchors(html: string): Array<{ href: string; text: string }> {
  const out: Array<{ href: string; text: string }> = [];
  for (const m of html.matchAll(
    /<a\b([^>]*?)>([\s\S]*?)<\/a>/gi
  )) {
    const attrs = m[1] ?? "";
    const href = attrs.match(/\bhref\s*=\s*["']([^"']+)["']/i)?.[1];
    if (!href) continue;
    const text = stripTags(m[2] ?? "");
    out.push({ href, text });
  }
  return out;
}

function collectListItems(html: string): string[] {
  const items: string[] = [];
  for (const m of html.matchAll(/<(li|td|figcaption|h[3-4])\b[^>]*>([\s\S]*?)<\/\1>/gi)) {
    const text = stripTags(m[2] ?? "");
    if (text) items.push(text);
  }
  return items;
}

function collectParagraphs(html: string): string[] {
  const items: string[] = [];
  for (const m of html.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/gi)) {
    const text = stripTags(m[1] ?? "");
    if (text) items.push(text);
  }
  return items;
}

function nominateText(text: string, take: (hit: Hit) => void, confidence: PagePersonConfidence, evidence: string): void {
  const peeled = peelResultPrefix(text.split(/[|•·\n]/)[0]?.trim() ?? "");
  if (!isPersonShapedName(peeled)) return;
  take({
    name: peeled,
    confidence,
    evidence,
  });
}

/**
 * Conservative nominator. LinkedIn/GitHub anchors first, article/list names
 * second, leftover title-case last and only on roster/results URLs.
 */
export function extractPagePeople(input: {
  html: string;
  pageUrl: string;
  seedName?: string;
  limit?: number;
}): PagePerson[] {
  const { html, pageUrl } = input;
  const main = extractMainHtml(html);
  const limit = input.limit ?? PREVIEW_CAP;
  const seedKey = input.seedName ? normalizeNameKey(input.seedName) : "";
  const byKey = new Map<string, Hit>();

  const take = (hit: Hit) => {
    const key = normalizeNameKey(hit.name);
    if (!key || (seedKey && key === seedKey)) return;
    if (/\bbot\b/.test(key)) return;
    const prev = byKey.get(key);
    byKey.set(key, prev ? prefer(prev, hit) : hit);
  };

  for (const a of collectAnchors(main)) {
    const li = linkedInInUrl(a.href, pageUrl);
    const gh = githubProfileUrl(a.href, pageUrl);
    if (li) {
      const slug = li.match(/\/in\/([^/]+)/)?.[1] ?? "";
      const label = peelResultPrefix(a.text);
      const name = isPersonShapedName(label) ? label : titleFromSlug(slug);
      if (name) {
        take({
          name,
          linkedin_url: li,
          github_url: gh ?? undefined,
          confidence: "high",
          evidence: `LinkedIn ${li}`,
        });
      }
      continue;
    }
    if (gh && !GENERIC_LINK.test(a.href)) {
      const name = isPersonShapedName(a.text) ? peelResultPrefix(a.text) : null;
      if (name) {
        take({
          name,
          github_url: gh,
          confidence: "high",
          evidence: `GitHub ${gh}`,
        });
      }
    }
  }

  for (const text of collectListItems(main)) {
    nominateText(text, take, "medium", "article list item");
  }
  const medalNameRe =
    /(?:Gold|Silver|Bronze)\s+Medal\s+([A-Z][a-zA-Z'’-]+(?:\s+[A-Z][a-zA-Z'’-]+){1,3})/g;
  for (const text of collectParagraphs(main)) {
    const first = peelResultPrefix(
      text.split(/[|•·\n]/)[0]?.trim().split(/[.(]/)[0]?.trim() ?? ""
    );
    if (first.length > 0 && first.length < 60 && isPersonShapedName(first)) {
      nominateText(first, take, "medium", "article paragraph");
    }
    for (const m of text.matchAll(medalNameRe)) {
      nominateText(m[1] ?? "", take, "medium", "results-line name");
    }
  }

  if (isRosterResultsUrl(pageUrl)) {
    const excerpt = htmlToExcerpt(main, 20_000);
    const nameRe =
      /\b([A-Z][a-zA-Z'’-]+(?:\s+[A-Z][a-zA-Z'’-]+){1,3})\b/g;
    for (const m of excerpt.matchAll(nameRe)) {
      const peeled = peelResultPrefix(m[1] ?? "");
      if (!isPersonShapedName(peeled)) continue;
      take({
        name: peeled,
        confidence: "low",
        evidence: "title-case name in page text",
      });
    }
  }

  const ranked = [...byKey.values()].sort((a, b) => {
    const rank = { high: 0, medium: 1, low: 2 };
    return rank[a.confidence] - rank[b.confidence] || a.name.localeCompare(b.name);
  });

  return ranked.slice(0, Math.max(0, limit)).map((h) => ({
    name: h.name,
    ...(h.linkedin_url ? { linkedin_url: h.linkedin_url } : {}),
    ...(h.github_url ? { github_url: h.github_url } : {}),
    confidence: h.confidence,
    evidence: h.evidence,
    checked_default: h.confidence !== "low",
  }));
}
