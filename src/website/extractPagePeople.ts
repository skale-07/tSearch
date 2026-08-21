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

const TEAM_HINT = /\b(team|people|members|lab|group|roster|directory)\b/i;

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

/** All-caps acronym — org token, not a given/family name. */
function isAcronymToken(word: string): boolean {
  return /^[A-Z]{2,}$/.test(word);
}

/** 2–4 capitalized tokens, not an org/nav phrase. */
export function isPersonShapedName(raw: string): boolean {
  const name = decodeEntities(raw).replace(/\s+/g, " ").trim();
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

function sameOriginPath(href: string, pageUrl: string): string | null {
  try {
    const page = new URL(pageUrl);
    const u = new URL(href, pageUrl);
    if (u.origin !== page.origin) return null;
    return u.pathname.toLowerCase();
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

function inTeamishContext(html: string, snippet: string): boolean {
  const idx = html.toLowerCase().indexOf(snippet.slice(0, 40).toLowerCase());
  if (idx < 0) return TEAM_HINT.test(html.slice(0, 2000));
  const window = html.slice(Math.max(0, idx - 800), idx + 200);
  return TEAM_HINT.test(window);
}

/**
 * Conservative nominator. LinkedIn/GitHub anchors first, team-list names
 * second, title-case leftovers last (unchecked by default).
 */
export function extractPagePeople(input: {
  html: string;
  pageUrl: string;
  seedName?: string;
  limit?: number;
}): PagePerson[] {
  const { html, pageUrl } = input;
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

  for (const a of collectAnchors(html)) {
    const li = linkedInInUrl(a.href, pageUrl);
    const gh = githubProfileUrl(a.href, pageUrl);
    if (li) {
      const slug = li.match(/\/in\/([^/]+)/)?.[1] ?? "";
      const name = isPersonShapedName(a.text) ? a.text : titleFromSlug(slug);
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
      const name = isPersonShapedName(a.text) ? a.text : null;
      if (name) {
        take({
          name,
          github_url: gh,
          confidence: "high",
          evidence: `GitHub ${gh}`,
        });
      }
    }
    const path = sameOriginPath(a.href, pageUrl);
    if (
      path &&
      TEAM_HINT.test(path) === false &&
      isPersonShapedName(a.text) &&
      inTeamishContext(html, a.text)
    ) {
      take({
        name: a.text,
        confidence: "medium",
        evidence: `team-page link ${a.text}`,
      });
    }
  }

  for (const text of collectListItems(html)) {
    const firstLine = text.split(/[|•·\n]/)[0]?.trim() ?? "";
    if (!isPersonShapedName(firstLine)) continue;
    if (!inTeamishContext(html, firstLine) && !TEAM_HINT.test(pageUrl)) continue;
    take({
      name: firstLine,
      confidence: "medium",
      evidence: "team/people list item",
    });
  }

  const excerpt = htmlToExcerpt(html, 6000);
  const hasStructured = [...byKey.values()].some(
    (h) => h.confidence === "high" || h.confidence === "medium"
  );
  if (!hasStructured) {
    const nameRe =
      /\b([A-Z][a-zA-Z'’-]+(?:\s+[A-Z][a-zA-Z'’-]+){1,3})\b/g;
    for (const m of excerpt.matchAll(nameRe)) {
      const name = m[1] ?? "";
      if (!isPersonShapedName(name)) continue;
      take({
        name,
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
