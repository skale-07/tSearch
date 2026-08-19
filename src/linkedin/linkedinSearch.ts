import type { Locator } from "playwright";
import { LINKEDIN_DELAY_MS, MAX_LINKEDIN_RESULTS } from "../config.js";
import type { LinkedInSession } from "./linkedinBrowser.js";
import { assertLinkedInAuth, sleep } from "./linkedinBrowser.js";
import { primaryCountrySearchTerm } from "./countryMatch.js";

export interface LinkedInSearchContext {
  school?: string;
  college?: string;
  country?: string;
  olympiad_hints?: string[];
  /** Registry display name — scholarships search name + award, not country. */
  award_hint?: string;
}

export interface LinkedInSearchHit {
  url: string;
  title: string;
  headline: string;
  location: string;
  snippet: string;
}

function normalizeProfileUrl(href: string): string | null {
  try {
    const u = new URL(href, "https://www.linkedin.com");
    const m = u.pathname.match(/\/in\/([^/?#]+)/i);
    if (!m) return null;
    return `https://www.linkedin.com/in/${decodeURIComponent(m[1])}/`;
  } catch {
    return null;
  }
}

function buildSearchTerms(
  name: string,
  context?: LinkedInSearchContext
): string[] {
  const terms = [`"${name}"`];
  if (context?.award_hint) {
    // Name is an exact phrase; award stays unquoted so LinkedIn can match
    // partial/token forms ("Davidson Fellows" → Davidson Fellows).
    terms.push(context.award_hint.trim());
    return terms;
  }
  if (context?.college && !context.olympiad_hints?.length && !context.country) {
    terms.push(context.college);
    return terms;
  }
  // School-only primary queries stay tight — don't mix olympiad/country terms.
  if (context?.school && !context.olympiad_hints?.length && !context.country) {
    terms.push(context.school);
    return terms;
  }
  for (const hint of context?.olympiad_hints ?? []) {
    terms.push(hint);
  }
  if (context?.country) {
    terms.push(primaryCountrySearchTerm(context.country));
  }
  if (context?.school) terms.push(context.school);
  return terms;
}

function buildSearchUrl(name: string, context?: LinkedInSearchContext): string {
  const keywords = encodeURIComponent(buildSearchTerms(name, context).join(" "));
  return `https://www.linkedin.com/search/results/people/?keywords=${keywords}&origin=GLOBAL_SEARCH_HEADER`;
}

export function formatSearchQuery(
  name: string,
  context?: LinkedInSearchContext
): string {
  return buildSearchTerms(name, context).join(" ");
}

function looksLikeLocationLine(line: string): boolean {
  if (!line.includes(",")) return false;
  if (/•|1st|2nd|3rd|connection|follower|message|connect/i.test(line)) {
    return false;
  }
  const parts = line.split(",").map((p) => p.trim()).filter(Boolean);
  return parts.length >= 2 && parts.every((p) => p.length >= 2);
}

async function inferLocationFromContainer(
  container: Locator,
  headline: string,
  title: string
): Promise<string> {
  const text = await container.innerText().catch(() => "");
  const lines = text
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);

  for (const line of lines) {
    if (line === title || line === headline) continue;
    if (looksLikeLocationLine(line)) return line;
  }
  return "";
}

function normalizeCardName(raw: string): string {
  const firstLine = raw.split(/\n/)[0]?.trim() ?? raw.trim();
  return firstLine
    .replace(/\s*[•·|]\s*(\d+(st|nd|rd)\+?|Following).*$/i, "")
    .replace(/\s*[•·|].*$/, "")
    .trim();
}

async function extractNameFromContainer(container: Locator): Promise<string> {
  const selectors = [
    ".entity-result__title-text span[aria-hidden='true']",
    ".entity-result__title-text a span",
    ".entity-result__title-text",
  ];
  for (const sel of selectors) {
    const el = container.locator(sel).first();
    if ((await el.count()) > 0) {
      const name = normalizeCardName(await el.innerText().catch(() => ""));
      if (name) return name;
    }
  }

  const lines = (await container.innerText().catch(() => ""))
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);

  for (const line of lines) {
    if (/^(message|connect|follow|mutual)/i.test(line)) break;
    if (looksLikeLocationLine(line)) continue;
    const name = normalizeCardName(line);
    if (name.length >= 3 && name.length < 60 && /[A-Za-zÀ-ÿ]/.test(name)) {
      return name;
    }
  }
  return "";
}

async function readHitFromContainer(
  container: Locator
): Promise<LinkedInSearchHit | null> {
  const link = container.locator('a[href*="/in/"]').first();
  if ((await link.count()) === 0) return null;

  const href = await link
    .getAttribute("href", { timeout: 3000 })
    .catch(() => null);
  if (!href) return null;
  const url = normalizeProfileUrl(href);
  if (!url) return null;

  const title = await extractNameFromContainer(container);

  const headline = (
    await container
      .locator(".entity-result__primary-subtitle, div[class*='primary-subtitle']")
      .first()
      .innerText()
      .catch(() => "")
  ).trim();

  let location = (
    await container
      .locator(
        ".entity-result__secondary-subtitle, div[class*='secondary-subtitle'], .entity-result__summary"
      )
      .first()
      .innerText()
      .catch(() => "")
  ).trim();

  if (!location) {
    location = await inferLocationFromContainer(container, headline, title);
  }

  return {
    url,
    title,
    headline,
    location,
    snippet: location || headline,
  };
}

/**
 * People search that never throws into the resolve loop — LinkedIn DOM flakiness
 * becomes empty hits so the batch can continue.
 */
export async function searchLinkedInByName(
  session: LinkedInSession,
  name: string,
  context?: LinkedInSearchContext
): Promise<LinkedInSearchHit[]> {
  try {
    return await searchLinkedInByNameUnsafe(session, name, context);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`  [linkedin] search failed for "${name}": ${msg}`);
    return [];
  }
}

async function searchLinkedInByNameUnsafe(
  session: LinkedInSession,
  name: string,
  context?: LinkedInSearchContext
): Promise<LinkedInSearchHit[]> {
  const { page } = session;
  const searchUrl = buildSearchUrl(name, context);

  await page.goto(searchUrl, { waitUntil: "domcontentloaded", timeout: 45000 });
  assertLinkedInAuth(page);
  await page.waitForSelector("main", { timeout: 20000 }).catch(() => null);
  await sleep(LINKEDIN_DELAY_MS);

  const hits: LinkedInSearchHit[] = [];
  const seen = new Set<string>();

  const containers = page.locator(
    "li.reusable-search__result-container, div.reusable-search__result-container, .entity-result"
  );
  const count = await containers.count();

  for (let i = 0; i < count && hits.length < MAX_LINKEDIN_RESULTS; i++) {
    const hit = await readHitFromContainer(containers.nth(i)).catch(() => null);
    // Keep URL even when the name scrape returns "" — pickBest trusts LinkedIn
    // ranking for targeted queries.
    if (!hit?.url || seen.has(hit.url)) continue;
    seen.add(hit.url);
    hits.push(hit);
  }

  if (hits.length === 0) {
    // Snapshot hrefs + link text in one evaluate — per-nth getAttribute waits
    // up to 30s and dies when LinkedIn detaches lazy result nodes mid-loop.
    const anchors = await page
      .locator('main a[href*="/in/"]')
      .evaluateAll((els) =>
        els.map((el) => {
          const a = el as HTMLAnchorElement;
          return {
            href: a.href,
            text: (a.getAttribute("aria-label") || a.textContent || "")
              .trim()
              .split("\n")[0]
              ?.trim() ?? "",
          };
        })
      )
      .catch(() => [] as Array<{ href: string; text: string }>);

    for (const anchor of anchors) {
      if (hits.length >= MAX_LINKEDIN_RESULTS) break;
      const url = normalizeProfileUrl(anchor.href);
      if (!url || seen.has(url)) continue;
      if (/\/(company|school|search)\//i.test(anchor.href)) continue;
      seen.add(url);
      hits.push({
        url,
        title: normalizeCardName(anchor.text),
        headline: "",
        location: "",
        snippet: "",
      });
    }
  }

  return hits;
}
