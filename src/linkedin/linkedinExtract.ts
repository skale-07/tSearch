import type { Page } from "playwright";
import type {
  LinkedInAward,
  LinkedInEducation,
  LinkedInExperience,
  LinkedInProfile,
} from "../types.js";
import type { LinkedInSearchHit } from "./linkedinSearch.js";
import type { LinkedInSession } from "./linkedinBrowser.js";
import { assertLinkedInAuth, sleep } from "./linkedinBrowser.js";
import { LINKEDIN_DELAY_MS } from "../config.js";
import { countryFromLocation } from "./countryMatch.js";
import { cleanSearchTitle } from "./linkedinMatch.js";

export const PROFILE_SCRAPE_VERSION = 9;

export function parseGithubUrl(text: string): string | null {
  const m = text.match(
    /https?:\/\/(?:www\.)?github\.com\/([a-zA-Z0-9](?:[a-zA-Z0-9-]{0,37}[a-zA-Z0-9])?)/i
  );
  return m ? `https://github.com/${m[1]}` : null;
}

export function parseSubstackUrl(text: string): string | null {
  const sub = text.match(/https?:\/\/([a-z0-9-]+)\.substack\.com/i);
  if (sub) return `https://${sub[1]}.substack.com`;
  const at = text.match(/https?:\/\/(?:www\.)?substack\.com\/@([a-z0-9-]+)/i);
  if (at) return `https://${at[1]}.substack.com`;
  return null;
}

export function parseTwitterUrl(text: string): string | null {
  const m = text.match(
    /https?:\/\/(?:www\.)?(?:twitter|x)\.com\/([a-zA-Z0-9_]+)/i
  );
  return m ? `https://x.com/${m[1]}` : null;
}

export function unwrapRedirectUrl(href: string): string {
  try {
    const u = new URL(href, "https://www.linkedin.com");
    if (
      /redir\/redirect/i.test(u.pathname) ||
      /\/safety\/go\/?/i.test(u.pathname)
    ) {
      const target = u.searchParams.get("url");
      if (target) {
        // safety/go encodes dots as %2E — decodeURIComponent handles that.
        const decoded = decodeURIComponent(target);
        if (/^https?:\/\//i.test(decoded)) return decoded.split("?")[0];
        if (/^[a-z0-9][-a-z0-9.]*\.[a-z]{2,}/i.test(decoded)) {
          return `https://${decoded}`;
        }
        return decoded.split("?")[0];
      }
    }
  } catch {
    // ignore malformed URLs
  }
  return href.split("?")[0];
}

function isBlockedPortfolioHost(href: string): boolean {
  return /linkedin\.com|github\.com|substack\.com|twitter\.com|x\.com|facebook\.com|instagram\.com|youtube\.com|tiktok\.com|mailto:|tel:/i.test(
    href
  );
}

function normalizeNameToken(token: string): string {
  return token.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function nameTokens(personName: string): string[] {
  return personName
    .trim()
    .split(/\s+/)
    .map(normalizeNameToken)
    .filter((t) => t.length >= 3);
}

function isLinkedInInternal(href: string): boolean {
  return /linkedin\.com/i.test(href);
}

function parseUrlsFromTextBlock(block: string): string[] {
  const urls: string[] = [];
  for (const line of block.split("\n")) {
    // LinkedIn often puts "(Personal)" on the same line: "varunrmadan.com (Personal)"
    const trimmed = line
      .trim()
      .replace(/\s*\(personal\)\s*$/i, "")
      .trim();
    if (!trimmed) continue;

    const inline = trimmed.match(/https?:\/\/[^\s)\]]+/i);
    if (inline && !isLinkedInInternal(inline[0])) {
      urls.push(unwrapRedirectUrl(inline[0]));
      continue;
    }
    if (/^https?:\/\//i.test(trimmed) && !isLinkedInInternal(trimmed)) {
      urls.push(unwrapRedirectUrl(trimmed));
      continue;
    }
    if (/^[a-z0-9][-a-z0-9.]*\.[a-z]{2,}\b/i.test(trimmed)) {
      const domain = trimmed.match(/^[a-z0-9][-a-z0-9.]*\.[a-z]{2,}/i)?.[0];
      if (!domain) continue;
      urls.push(`https://${domain}`);
    }
  }
  return urls;
}

function websiteSectionBlock(contactText: string): string | null {
  const websiteMatch = contactText.match(
    /Website\s*\n+([\s\S]*?)(?:\n(?:Your Profile|Profile|Email|Phone|Birthday|Connected|IM|Address|Twitter|Message)|$)/i
  );
  return websiteMatch?.[1] ?? null;
}

/** LinkedIn labels some URLs "(Personal)" in the Website section. */
function linkedinLabeledPersonalUrl(contactText: string): string | null {
  const block = websiteSectionBlock(contactText);
  if (!block || !/\(personal\)/i.test(block)) return null;
  return parseUrlsFromTextBlock(block)[0] ?? null;
}

function collectContactUrls(contactText: string, hrefs: string[]): string[] {
  const urls = new Set<string>();

  for (const raw of hrefs) {
    const href = unwrapRedirectUrl(raw);
    if (href.startsWith("http") && !isLinkedInInternal(href)) urls.add(href);
  }

  for (const m of contactText.matchAll(/https?:\/\/[^\s)\]]+/gi)) {
    const url = unwrapRedirectUrl(m[0]);
    if (!isLinkedInInternal(url)) urls.add(url);
  }

  const websiteBlock = websiteSectionBlock(contactText);
  if (websiteBlock) {
    for (const url of parseUrlsFromTextBlock(websiteBlock)) urls.add(url);
  }

  return [...urls];
}

function urlsFromWebsiteSection(
  contactText: string,
  contactUrls: string[]
): Set<string> {
  const inSection = new Set<string>();
  const websiteMatch = contactText.match(
    /Website\s*\n+([\s\S]*?)(?:\n(?:Your Profile|Profile|Email|Phone|Birthday|Connected|IM|Address|Twitter|Message)|$)/i
  );
  if (!websiteMatch) return inSection;

  const block = websiteMatch[1].toLowerCase();
  for (const url of contactUrls) {
    try {
      const host = new URL(url).hostname.replace(/^www\./i, "").toLowerCase();
      if (block.includes(host) || block.includes(host.split(".")[0])) {
        inSection.add(url);
      }
    } catch {
      // ignore bad URLs
    }
  }
  return inSection;
}

function scorePortfolioUrl(
  url: string,
  personName: string,
  inWebsiteSection: boolean
): number {
  if (!isPersonalWebsiteCandidate(url)) return -1;

  let score = 0;
  if (/\.github\.io\b/i.test(url)) score += 5;

  const blob = url.toLowerCase().replace(/[^a-z0-9]/g, "");
  for (const token of nameTokens(personName)) {
    if (blob.includes(token)) score += 3;
  }
  if (inWebsiteSection) score += 2;

  return score;
}

function isPersonalWebsiteCandidate(url: string): boolean {
  return !isBlockedPortfolioHost(url);
}

export function classifyContactInfo(
  contactText: string,
  hrefs: string[],
  personName: string
): { personal_website: string | null; contact_links: string[] } {
  const contact_links = collectContactUrls(contactText, hrefs);

  const labeledPersonal = linkedinLabeledPersonalUrl(contactText);
  if (labeledPersonal) {
    const links = [...new Set([labeledPersonal, ...contact_links])];
    return { personal_website: labeledPersonal, contact_links: links };
  }

  const websiteSection = urlsFromWebsiteSection(contactText, contact_links);

  let best: { url: string; score: number } | null = null;
  for (const url of contact_links) {
    const score = scorePortfolioUrl(url, personName, websiteSection.has(url));
    if (score < 0) continue;
    if (!best || score > best.score) best = { url, score };
  }

  const personal_website = best && best.score >= 3 ? best.url : null;
  return { personal_website, contact_links };
}

/** @deprecated use classifyContactInfo */
export function parsePersonalWebsiteFromContact(
  contactText: string,
  hrefs: string[],
  personName = ""
): string | null {
  return classifyContactInfo(contactText, hrefs, personName).personal_website;
}

export function parseWebsiteUrl(
  text: string,
  hrefs: string[]
): string | null {
  const normalized = hrefs.map(unwrapRedirectUrl);
  for (const href of normalized) {
    if (!href.startsWith("http")) continue;
    if (isBlockedPortfolioHost(href)) continue;
    return href;
  }
  const m = text.match(/https?:\/\/[^\s)]+/i);
  if (m && !isBlockedPortfolioHost(m[0])) {
    return unwrapRedirectUrl(m[0]);
  }
  return null;
}

function parseAllLinks(
  text: string,
  hrefs: string[]
): Pick<
  LinkedInProfile,
  "github_url" | "substack_url" | "twitter_url" | "website_url"
> {
  const blob = [text, ...hrefs].join("\n");
  return {
    github_url: parseGithubUrl(blob),
    substack_url: parseSubstackUrl(blob),
    twitter_url: parseTwitterUrl(blob),
    website_url: parseWebsiteUrl(blob, hrefs),
  };
}

async function collectHrefs(
  locator: ReturnType<Page["locator"]>
): Promise<string[]> {
  if ((await locator.count()) === 0) return [];
  return locator.locator("a[href]").evaluateAll((els) =>
    els
      .map((el) => {
        const href = el.getAttribute("href") ?? "";
        if (href.startsWith("http")) return href;
        if (href.startsWith("/")) return `https://www.linkedin.com${href}`;
        return href;
      })
      .filter(Boolean)
  );
}

async function fetchContactInfo(
  page: Page,
  _profileUrl?: string
): Promise<{ text: string; hrefs: string[] } | null> {
  // New LinkedIn UI opens contact info as a <dialog> (no role="dialog") and
  // updates the URL to .../overlay/contact-info/. Wait on that, not artdeco.
  await page.evaluate(() => window.scrollTo(0, 0)).catch(() => null);
  await sleep(400);

  const triggers = [
    page.locator('a[href*="overlay/contact-info"]').first(),
    page.getByRole("link", { name: /contact info/i }).first(),
    page.locator("main").getByText(/^Contact info$/i).first(),
    page
      .locator("main a, main button, main span")
      .filter({ hasText: /contact info/i })
      .first(),
  ];

  let clicked = false;
  for (const el of triggers) {
    if ((await el.count()) === 0) continue;
    await el.scrollIntoViewIfNeeded().catch(() => null);
    const ok = await el
      .click({ timeout: 5000 })
      .then(() => true)
      .catch(() => false);
    if (ok) {
      clicked = true;
      break;
    }
  }
  if (!clicked) {
    console.log("  [linkedin] contact info trigger not found");
    return null;
  }

  try {
    await page.waitForURL(/\/overlay\/contact-info\/?/i, { timeout: 8000 });
  } catch {
    // Some sessions keep the same URL; fall through and try DOM.
  }
  await sleep(700);

  const dialog = page
    .locator("dialog")
    .filter({ hasText: /website|contact info/i })
    .first();
  const fallback = page
    .locator('[role="dialog"], .artdeco-modal, dialog, [aria-modal="true"]')
    .filter({ hasText: /website|your profile|contact info/i })
    .first();

  let root = dialog;
  if ((await dialog.count()) === 0 || !(await dialog.isVisible().catch(() => false))) {
    root = fallback;
  }

  if ((await root.count()) === 0) {
    // Last resort: scrape from body text once overlay URL is active.
    if (!/\/overlay\/contact-info\/?/i.test(page.url())) {
      console.log("  [linkedin] contact info modal did not open");
      return null;
    }
    const bodyText = await page.locator("body").innerText().catch(() => "");
    const cutoff = bodyText.search(/\nSkip to main content/i);
    const text = (cutoff > 0 ? bodyText.slice(0, cutoff) : bodyText).trim();
    const hrefs = [
      ...new Set(
        (await collectHrefs(page.locator("body"))).map(unwrapRedirectUrl)
      ),
    ].filter((h) => !/linkedin\.com\/(in|mynetwork|jobs|messaging|feed|search)/i.test(h));
    await page.keyboard.press("Escape").catch(() => null);
    console.log(
      `  [linkedin] contact info via body scrape (${hrefs.length} links)`
    );
    return text ? { text, hrefs } : null;
  }

  await root.waitFor({ state: "visible", timeout: 3000 }).catch(() => null);
  const text = await root.innerText().catch(() => "");
  const hrefs = [
    ...new Set((await collectHrefs(root)).map(unwrapRedirectUrl)),
  ];

  await page.keyboard.press("Escape").catch(() => null);
  await sleep(400);

  if (!text.trim()) {
    console.log("  [linkedin] contact info modal empty");
    return null;
  }

  console.log(
    `  [linkedin] contact info opened (${hrefs.length} links, ${text.length} chars)`
  );
  return { text, hrefs };
}

async function sectionText(
  page: Page,
  heading: RegExp
): Promise<{ text: string; hrefs: string[] }> {
  const section = page
    .locator("section")
    .filter({ has: page.getByRole("heading", { name: heading }) })
    .first();
  if ((await section.count()) === 0) return { text: "", hrefs: [] };
  await section.scrollIntoViewIfNeeded().catch(() => null);
  await sleep(300);
  const showAll = section
    .getByRole("button", { name: /show all|see all/i })
    .first();
  if ((await showAll.count()) > 0) {
    await showAll.click().catch(() => null);
    await sleep(500);
  }
  return {
    text: await section.innerText().catch(() => ""),
    hrefs: await collectHrefs(section),
  };
}

async function sectionTextByHeadings(
  page: Page,
  headings: RegExp[]
): Promise<{ text: string; hrefs: string[] }> {
  for (const heading of headings) {
    const result = await sectionText(page, heading);
    if (result.text.trim()) return result;
  }
  return { text: "", hrefs: [] };
}

const NOISE_LINE =
  /^(show all|see all|add|education|experience|skills|honors|awards|licenses)$/i;

function cleanSectionLines(text: string, header: RegExp): string[] {
  return text
    .split("\n")
    .map((l) => l.trim())
    .filter(
      (l) =>
        l &&
        !header.test(l) &&
        !NOISE_LINE.test(l) &&
        !/^issued\b/i.test(l)
    );
}

const DEGREE_RE =
  /bachelor|master|phd|b\.?s\.?|m\.?s\.?|b\.?a\.?|m\.?a\.?|degree|high school|associate|diploma/i;
const YEARS_RE = /\b(19|20)\d{2}\b|present/i;
const DATE_RE =
  /^(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec|\d{4}|present)/i;

async function fetchDetailSectionText(
  page: Page,
  profileUrl: string,
  detail: "education" | "experience" | "honors"
): Promise<string> {
  const base = profileUrl.replace(/\/$/, "").split("/details/")[0];
  const suffix =
    detail === "honors" ? "/details/honors/" : `/details/${detail}/`;
  await page.goto(base + suffix, {
    waitUntil: "domcontentloaded",
    timeout: 45000,
  });
  assertLinkedInAuth(page);
  await page.waitForSelector("main", { timeout: 15000 }).catch(() => null);
  await sleep(LINKEDIN_DELAY_MS);
  const main = await page.locator("main").innerText().catch(() => "");
  const cutoff = main.search(/More profiles for you/i);
  return cutoff > 0 ? main.slice(0, cutoff).trim() : main;
}

function stripDetailHeader(text: string, header: RegExp): string {
  return text.replace(header, "").trim();
}

function looksLikeSchool(line: string): boolean {
  return /university|college|high school|institute|academy|school\b/i.test(line);
}

function parseEducationDetail(text: string): LinkedInEducation[] {
  const body = stripDetailHeader(text, /^education\s*/i);
  const lines = body
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  const entries: LinkedInEducation[] = [];
  let i = 0;

  while (i < lines.length && entries.length < 8) {
    const school = lines[i++];
    if (!school) break;

    let degree: string | null = null;
    let field: string | null = null;
    let years: string | null = null;

    if (
      i < lines.length &&
      (DEGREE_RE.test(lines[i]) ||
        /diploma|in progress/i.test(lines[i]))
    ) {
      degree = lines[i++];
    } else if (
      i < lines.length &&
      !looksLikeSchool(lines[i]) &&
      YEARS_RE.test(lines[i])
    ) {
      years = lines[i++];
    }

    entries.push({ school, degree, field, years });
  }

  return entries;
}

function parseExperienceDetail(text: string): LinkedInExperience[] {
  const body = stripDetailHeader(text, /^experience\s*/i);
  const lines = body
    .split("\n")
    .map((l) => l.trim())
    .filter(
      (l) =>
        l &&
        !/^(part-time|full-time|internship|contract|self-employed)$/i.test(l)
    );
  const entries: LinkedInExperience[] = [];
  let i = 0;

  while (i < lines.length && entries.length < 8) {
    const company = lines[i++];
    if (!company || company.startsWith("http")) continue;
    if (/^(paper|publication):/i.test(company)) break;

    if (i < lines.length && /^\d+\s*(yr|mo)s?$/i.test(lines[i])) i++;

    const title = i < lines.length ? lines[i++] : null;
    if (
      !title ||
      title.startsWith("http") ||
      title.length > 80 ||
      /^(paper|publication):/i.test(title)
    ) {
      continue;
    }

    if (
      i < lines.length &&
      /^(part-time|full-time|internship|contract|self-employed)$/i.test(lines[i])
    ) {
      i++;
    }

    const dates =
      i < lines.length && (DATE_RE.test(lines[i]) || /present/i.test(lines[i]))
        ? lines[i++]
        : null;

    let location: string | null = null;
    if (
      i < lines.length &&
      lines[i].includes(",") &&
      !lines[i].startsWith("http") &&
      lines[i].length < 120
    ) {
      location = lines[i++];
    }

    if (i < lines.length && lines[i].length > 100) i++;

    entries.push({ title, company, dates, location });
  }

  return entries;
}

function parseHonorsDetail(text: string): LinkedInAward[] {
  const body = stripDetailHeader(text, /^honors\s*&\s*awards\s*/i);
  const lines = body
    .split("\n")
    .map((l) => l.trim())
    .filter(
      (l) =>
        l &&
        !l.startsWith("http") &&
        !/\.(jpg|png|gif)$/i.test(l) &&
        !/^associated with$/i.test(l)
    );
  const entries: LinkedInAward[] = [];
  let i = 0;

  while (i < lines.length && entries.length < 12) {
    const title = lines[i++];
    if (!title) break;
    if (/^associated with/i.test(title)) {
      if (entries.length) {
        const prev = entries[entries.length - 1];
        prev.issuer = prev.issuer ?? title.replace(/^associated with\s*/i, "");
      }
      continue;
    }
    if (/^issued by/i.test(title)) {
      if (entries.length) {
        entries[entries.length - 1].issuer = title.replace(/^issued by\s*/i, "");
      }
      continue;
    }
    if (title.length > 100) continue;

    let date: string | null = null;
    let issuer: string | null = null;

    if (i < lines.length && (DATE_RE.test(lines[i]) || /^\d{4}$/.test(lines[i]))) {
      date = lines[i++];
    }
    if (i < lines.length && /^associated with/i.test(lines[i])) {
      issuer = lines[i++].replace(/^associated with\s*/i, "");
    }

    entries.push({ title, issuer, date });
  }

  return entries;
}

async function extractHeadlineFromTopSection(
  page: Page,
  name: string
): Promise<string | null> {
  const section = page.locator("main section").first();
  if ((await section.count()) === 0) return null;

  const lines = (await section.innerText().catch(() => ""))
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);

  for (const line of lines) {
    if (line === name || cleanSearchTitle(line) === name) continue;
    if (/^(he\/him|she\/her|they\/them|contact info)$/i.test(line)) continue;
    if (/^·|^\d+(st|nd|rd)|^connect$|^message$|^followers$|^connections$/i.test(line)) {
      continue;
    }
    if (
      line.includes(",") &&
      !line.includes("|") &&
      line.split(",").length >= 2 &&
      line.length < 80
    ) {
      continue;
    }
    if (line.length > 12) return line;
  }

  return null;
}

async function extractTopCardRoleLines(
  page: Page
): Promise<{ company: string | null; school: string | null }> {
  const section = page.locator("main section").first();
  if ((await section.count()) === 0) {
    return { company: null, school: null };
  }

  const lines = (await section.innerText().catch(() => ""))
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);

  const contactIdx = lines.findIndex((l) => /contact info/i.test(l));
  if (contactIdx < 0 || contactIdx + 1 >= lines.length) {
    return { company: null, school: null };
  }

  const afterContact = lines.slice(contactIdx + 1);
  const company = afterContact[0] ?? null;
  const school =
    afterContact.find((l) => looksLikeSchool(l) && l !== company) ?? null;

  return { company, school };
}

function primaryEducationSummary(education: LinkedInEducation[]): {
  school: string | null;
  degree: string | null;
  graduation_year: number | null;
  college: string | null;
} {
  if (!education.length) {
    return { school: null, degree: null, graduation_year: null, college: null };
  }
  const first = education[0];
  const years = first.years ?? "";
  const yearMatches = [...years.matchAll(/\b(19|20)\d{2}\b/g)].map((m) =>
    parseInt(m[0], 10)
  );
  const graduation_year =
    yearMatches.length > 0
      ? Math.max(...yearMatches.filter((y) => y <= 2035))
      : null;

  return {
    college: first.school,
    school: first.school,
    degree: first.degree,
    graduation_year,
  };
}

async function extractLocationFromTopSection(
  page: Page
): Promise<string | null> {
  const section = page.locator("main section").first();
  if ((await section.count()) === 0) return null;

  const lines = (await section.innerText().catch(() => ""))
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);

  for (const line of lines) {
    const loc = parseLocationFromLine(line);
    if (loc) return loc;
  }

  return null;
}

function parseLocationFromLine(text: string): string | null {
  const trimmed = text.trim();
  if (!trimmed || !trimmed.includes(",")) return null;
  if (
    /connection|follower|contact|message|premium|gold|silver|ioi|imo|mop|rsi|ipho|usaco/i.test(
      trimmed
    )
  ) {
    return null;
  }
  if (/\|/.test(trimmed)) return null;
  if (trimmed.length > 90) return null;
  return trimmed;
}

async function extractTopCardLocation(page: Page): Promise<string | null> {
  const topCard = page.locator(
    "main .pv-text-details__left-panel, main .ph5.pb5"
  ).first();

  if ((await topCard.count()) > 0) {
    const smalls = topCard.locator("span.text-body-small");
    const count = await smalls.count();
    for (let i = 0; i < count; i++) {
      const text = (await smalls.nth(i).innerText().catch(() => "")).trim();
      const loc = parseLocationFromLine(text);
      if (loc) return loc;
    }
  }

  const fallback = page.locator("main span.text-body-small.inline.t-black--light");
  const count = await fallback.count();
  for (let i = 0; i < count; i++) {
    const text = (await fallback.nth(i).innerText().catch(() => "")).trim();
    const loc = parseLocationFromLine(text);
    if (loc) return loc;
  }

  return null;
}

async function extractTopCardHeadline(page: Page): Promise<string | null> {
  const headline = page
    .locator(
      "main .pv-text-details__left-panel .text-body-medium, main .text-body-medium.break-words"
    )
    .first();
  if ((await headline.count()) === 0) return null;
  const text = (await headline.innerText().catch(() => "")).trim();
  return text || null;
}

export function profileFromSearchHit(
  hit: LinkedInSearchHit,
  queryName: string
): LinkedInProfile {
  const location = hit.location || null;
  const name = cleanSearchTitle(hit.title) || queryName;
  return {
    url: hit.url,
    name,
    photo_url: null,
    headline: hit.headline || null,
    college: null,
    school: null,
    degree: null,
    country: countryFromLocation(location),
    graduation_year: null,
    education: [],
    keywords: hit.headline ? hit.headline.split(/\s+/).slice(0, 8) : [],
    github_url: null,
    substack_url: null,
    twitter_url: null,
    personal_website: null,
    website_url: null,
    contact_links: [],
    experience: [],
    awards: [],
    skills: [],
  };
}

export function isFullLinkedInProfile(profile: LinkedInProfile): boolean {
  return (
    profile.scrape_version === PROFILE_SCRAPE_VERSION &&
    Array.isArray(profile.education) &&
    Array.isArray(profile.experience) &&
    Array.isArray(profile.awards)
  );
}

export async function extractProfileLinksOnly(
  session: LinkedInSession,
  profileUrl: string,
  personName = ""
): Promise<
  Pick<
    LinkedInProfile,
    | "github_url"
    | "substack_url"
    | "twitter_url"
    | "personal_website"
    | "website_url"
    | "contact_links"
  >
> {
  const { page } = session;
  await page.goto(profileUrl, { waitUntil: "domcontentloaded", timeout: 45000 });
  assertLinkedInAuth(page);
  await page.waitForSelector("main", { timeout: 15000 }).catch(() => null);
  await sleep(600);

  const contact = await fetchContactInfo(page, profileUrl);
  const contactText = contact?.text ?? "";
  const contactHrefs = contact?.hrefs ?? [];
  const classified = classifyContactInfo(contactText, contactHrefs, personName);
  const contactLinks = contact
    ? parseAllLinks(contactText, contactHrefs)
    : null;
  const links = parseAllLinks(contactText, contactHrefs);

  const website =
    classified.personal_website ?? links.website_url ?? null;
  return {
    github_url: contactLinks?.github_url ?? links.github_url ?? null,
    substack_url: contactLinks?.substack_url ?? links.substack_url ?? null,
    twitter_url: contactLinks?.twitter_url ?? links.twitter_url ?? null,
    personal_website: website,
    website_url: website,
    contact_links: classified.contact_links,
  };
}

export async function extractLinkedInProfile(
  session: LinkedInSession,
  hit: LinkedInSearchHit,
  queryName: string
): Promise<LinkedInProfile> {
  const { page } = session;

  await page.goto(hit.url, { waitUntil: "domcontentloaded", timeout: 45000 });
  assertLinkedInAuth(page);
  await page.waitForSelector("main", { timeout: 15000 }).catch(() => null);
  await sleep(LINKEDIN_DELAY_MS);

  const mainText = await page.locator("main").innerText().catch(() => "");
  const hrefs = await collectHrefs(page.locator("main"));

  let name = cleanSearchTitle(hit.title) || queryName;
  const nameEl = page.locator("main h1, main section h2").first();
  if ((await nameEl.count()) > 0) {
    const nameText = (await nameEl.innerText()).trim();
    if (nameText) name = cleanSearchTitle(nameText) || nameText;
  }

  const headline =
    (await extractTopCardHeadline(page)) ||
    (await extractHeadlineFromTopSection(page, name)) ||
    hit.headline ||
    null;
  let location =
    (await extractTopCardLocation(page)) ||
    (await extractLocationFromTopSection(page)) ||
    hit.location ||
    null;

  const about = await sectionText(page, /^About$/i);
  const skills = await sectionText(page, /^Skills$/i);
  // Featured/links are intentional profile pins — not the main feed noise.
  const featured = await sectionTextByHeadings(page, [
    /^Featured$/i,
    /^Featured links$/i,
    /^Links$/i,
  ]);

  hrefs.push(...about.hrefs.map(unwrapRedirectUrl));

  const contact = await fetchContactInfo(page, hit.url);
  const contactText = contact?.text ?? "";
  const contactHrefs = contact?.hrefs ?? [];
  if (contact) hrefs.push(...contactHrefs);

  const classified = classifyContactInfo(contactText, contactHrefs, name);
  const contactLinks = contact
    ? parseAllLinks(contactText, contactHrefs)
    : null;
  const featuredLinks = featured.text.trim()
    ? parseAllLinks(featured.text, featured.hrefs.map(unwrapRedirectUrl))
    : null;

  const educationText = await fetchDetailSectionText(
    page,
    hit.url,
    "education"
  );
  const experienceText = await fetchDetailSectionText(
    page,
    hit.url,
    "experience"
  );
  const honorsText = await fetchDetailSectionText(page, hit.url, "honors");

  // Social URLs (esp. GitHub) must NOT be taken from the whole page blob —
  // LinkedIn activity/recommendations often link other people's GitHubs.
  // Only Contact info + Featured (then personal website in resolveIdentities).
  const blob = [mainText, about.text, educationText, experienceText, honorsText, contactText, ...hrefs].join(
    "\n"
  );
  const links = parseAllLinks(blob, hrefs.map(unwrapRedirectUrl));
  const website =
    classified.personal_website ??
    contactLinks?.website_url ??
    links.website_url ??
    null;
  // Personal site (from Contact info) is scraped separately and overrides these.
  // LinkedIn socials: Contact info → Featured only — never the whole profile blob.
  const linkedInGithub =
    contactLinks?.github_url ?? featuredLinks?.github_url ?? null;
  const linkedInSubstack =
    contactLinks?.substack_url ?? featuredLinks?.substack_url ?? null;
  const linkedInTwitter =
    contactLinks?.twitter_url ?? featuredLinks?.twitter_url ?? null;

  const education = parseEducationDetail(educationText);
  const experience = parseExperienceDetail(experienceText);
  const awards = parseHonorsDetail(honorsText);
  const eduSummary = primaryEducationSummary(education);

  if (!location && contactText) {
    const m = contactText.match(/(?:Location)\s*\n\s*([^\n]+)/i);
    if (m) location = m[1].trim();
  }

  const country = countryFromLocation(location);

  const photo = await page
    .locator('main img[src*="profile-displayphoto"]')
    .first()
    .getAttribute("src")
    .catch(() => null);

  const skillLines = skills.text
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !/^skills$/i.test(l))
    .slice(0, 12);

  const keywords = [
    ...(headline ? headline.split(/\s+/).slice(0, 8) : []),
    ...skillLines.slice(0, 4),
  ].filter(Boolean);

  return {
    url: hit.url,
    name,
    photo_url: photo,
    headline,
    college: eduSummary.college,
    school: eduSummary.school,
    degree: eduSummary.degree,
    country,
    graduation_year: eduSummary.graduation_year,
    education,
    keywords,
    github_url: linkedInGithub,
    substack_url: linkedInSubstack,
    twitter_url: linkedInTwitter,
    personal_website: website,
    website_url: website,
    contact_links: classified.contact_links,
    experience,
    awards,
    skills: skillLines,
    scrape_version: PROFILE_SCRAPE_VERSION,
  };
}

export function githubUsernameFromUrl(url: string | null): string | null {
  if (!url) return null;
  const m = url.match(
    /github\.com\/([a-zA-Z0-9](?:[a-zA-Z0-9-]{0,37}[a-zA-Z0-9])?)/i
  );
  return m ? m[1] : null;
}

export function substackSlugFromUrl(url: string | null): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    if (u.hostname.endsWith(".substack.com")) {
      return u.hostname.split(".")[0];
    }
  } catch {
    return null;
  }
  return null;
}
