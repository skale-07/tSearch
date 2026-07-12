import type { Locator } from "playwright";
import { LINKEDIN_DELAY_MS, MAX_LINKEDIN_RESULTS } from "../config.js";
import type { LinkedInSession } from "./linkedinBrowser.js";
import { sleep } from "./linkedinBrowser.js";

export interface LinkedInSearchHit {
  url: string;
  title: string;
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

function buildSearchUrl(
  name: string,
  context?: { school?: string; country?: string }
): string {
  const terms = [name];
  if (context?.school) terms.push(context.school);
  if (context?.country) terms.push(context.country);
  const keywords = encodeURIComponent(terms.join(" "));
  return `https://www.linkedin.com/search/results/people/?keywords=${keywords}&origin=GLOBAL_SEARCH_HEADER`;
}

async function readHitFromContainer(
  container: Locator
): Promise<LinkedInSearchHit | null> {
  const link = container.locator('a[href*="/in/"]').first();
  if ((await link.count()) === 0) return null;

  const href = await link.getAttribute("href");
  if (!href) return null;
  const url = normalizeProfileUrl(href);
  if (!url) return null;

  const title =
    (
      await container
        .locator(
          ".entity-result__title-text span[aria-hidden='true'], .entity-result__title-text a span"
        )
        .first()
        .innerText()
        .catch(() => "")
    ).trim() ||
    (await link.innerText().catch(() => "")).trim();

  const subtitle = await container
    .locator(".entity-result__primary-subtitle")
    .first()
    .innerText()
    .catch(() => "");
  const secondary = await container
    .locator(".entity-result__secondary-subtitle")
    .first()
    .innerText()
    .catch(() => "");

  const snippet = [subtitle, secondary].filter(Boolean).join(" · ").trim();
  return { url, title, snippet };
}

export async function searchLinkedInByName(
  session: LinkedInSession,
  name: string,
  context?: { school?: string; country?: string }
): Promise<LinkedInSearchHit[]> {
  const { page } = session;
  const searchUrl = buildSearchUrl(name, context);

  await page.goto(searchUrl, { waitUntil: "domcontentloaded", timeout: 45000 });
  await page.waitForSelector("main", { timeout: 20000 }).catch(() => null);
  await sleep(LINKEDIN_DELAY_MS);

  const hits: LinkedInSearchHit[] = [];
  const seen = new Set<string>();

  const containers = page.locator(
    "li.reusable-search__result-container, div.reusable-search__result-container, .entity-result"
  );
  const count = await containers.count();

  for (let i = 0; i < count && hits.length < MAX_LINKEDIN_RESULTS; i++) {
    const hit = await readHitFromContainer(containers.nth(i));
    if (!hit || seen.has(hit.url)) continue;
    seen.add(hit.url);
    hits.push(hit);
  }

  if (hits.length === 0) {
    const links = page.locator('main a[href*="/in/"]');
    const linkCount = await links.count();
    for (let i = 0; i < linkCount && hits.length < MAX_LINKEDIN_RESULTS; i++) {
      const link = links.nth(i);
      const href = await link.getAttribute("href");
      if (!href) continue;
      const url = normalizeProfileUrl(href);
      if (!url || seen.has(url)) continue;
      if (/\/(company|school|search)\//i.test(href)) continue;
      seen.add(url);
      const title = (await link.innerText().catch(() => "")).trim();
      hits.push({ url, title, snippet: "" });
    }
  }

  return hits;
}
