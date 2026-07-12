import type { Page } from "playwright";
import type { LinkedInProfile } from "../types.js";
import type { LinkedInSearchHit } from "./linkedinSearch.js";
import type { LinkedInSession } from "./linkedinBrowser.js";
import { sleep } from "./linkedinBrowser.js";
import { LINKEDIN_DELAY_MS } from "../config.js";
import { countryFromLocation } from "./countryMatch.js";

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

export function parseWebsiteUrl(
  text: string,
  hrefs: string[]
): string | null {
  for (const href of hrefs) {
    if (!href.startsWith("http")) continue;
    if (
      /linkedin\.com|github\.com|substack\.com|twitter\.com|x\.com/i.test(href)
    ) {
      continue;
    }
    return href.split("?")[0];
  }
  const m = text.match(/https?:\/\/[^\s)]+/i);
  if (m && !/linkedin|github|substack|twitter|x\.com/i.test(m[0])) {
    return m[0];
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

async function sectionText(
  page: Page,
  heading: RegExp
): Promise<{ text: string; hrefs: string[] }> {
  const section = page
    .locator("section")
    .filter({ has: page.getByRole("heading", { name: heading }) })
    .first();
  if ((await section.count()) === 0) return { text: "", hrefs: [] };
  return {
    text: await section.innerText().catch(() => ""),
    hrefs: await collectHrefs(section),
  };
}

function parseEducation(text: string): {
  school: string | null;
  degree: string | null;
  graduation_year: number | null;
} {
  const lines = text
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  const school = lines.find((l) => !/^education$/i.test(l)) ?? null;
  const degree =
    lines.find((l) =>
      /bachelor|master|phd|b\.?s\.?|m\.?s\.?|b\.?a\.?|m\.?a\.?|degree/i.test(l)
    ) ?? null;

  const years = [...text.matchAll(/\b(19|20)\d{2}\b/g)].map((m) =>
    parseInt(m[0], 10)
  );
  const graduation_year =
    years.length > 0 ? Math.max(...years.filter((y) => y <= 2030)) : null;

  return { school, degree, graduation_year };
}

function parseLocationFromLine(text: string): string | null {
  const trimmed = text.trim();
  if (!trimmed || !trimmed.includes(",")) return null;
  if (/connection|follower|contact|message|premium/i.test(trimmed)) return null;
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
  return {
    url: hit.url,
    name: hit.title || queryName,
    photo_url: null,
    headline: hit.headline || null,
    school: null,
    degree: null,
    country: countryFromLocation(location),
    graduation_year: null,
    keywords: hit.headline ? hit.headline.split(/\s+/).slice(0, 8) : [],
    github_url: null,
    substack_url: null,
    twitter_url: null,
    website_url: null,
    experience: [],
    skills: [],
  };
}

export async function extractProfileLinksOnly(
  session: LinkedInSession,
  profileUrl: string
): Promise<
  Pick<
    LinkedInProfile,
    "github_url" | "substack_url" | "twitter_url" | "website_url"
  >
> {
  const { page } = session;
  await page.goto(profileUrl, { waitUntil: "domcontentloaded", timeout: 45000 });
  await page.waitForSelector("main", { timeout: 15000 }).catch(() => null);
  await sleep(600);

  const hrefs = await collectHrefs(page.locator("main"));
  let aboutText = "";
  const aboutSection = page
    .locator("section")
    .filter({ has: page.getByRole("heading", { name: /^About$/i }) })
    .first();
  if ((await aboutSection.count()) > 0) {
    aboutText = await aboutSection.innerText().catch(() => "");
    hrefs.push(...(await collectHrefs(aboutSection)));
  }

  const contact = page.getByRole("link", { name: /contact info/i }).first();
  if ((await contact.count()) > 0) {
    await contact.click().catch(() => null);
    await sleep(600);
    const modal = page.locator('[role="dialog"], .artdeco-modal').first();
    if ((await modal.count()) > 0) {
      aboutText += "\n" + (await modal.innerText().catch(() => ""));
      hrefs.push(...(await collectHrefs(modal)));
      await page.keyboard.press("Escape").catch(() => null);
    }
  }

  return parseAllLinks(aboutText, hrefs);
}

export async function extractLinkedInProfile(
  session: LinkedInSession,
  hit: LinkedInSearchHit,
  queryName: string
): Promise<LinkedInProfile> {
  const { page } = session;

  await page.goto(hit.url, { waitUntil: "domcontentloaded", timeout: 45000 });
  await page.waitForSelector("main", { timeout: 15000 }).catch(() => null);
  await sleep(LINKEDIN_DELAY_MS);

  const mainText = await page.locator("main").innerText().catch(() => "");
  const hrefs = await collectHrefs(page.locator("main"));

  let name = queryName;
  const h1 = page.locator("main h1").first();
  if ((await h1.count()) > 0) {
    name = (await h1.innerText()).trim() || name;
  }

  const headline =
    (await extractTopCardHeadline(page)) || hit.headline || null;
  let location =
    (await extractTopCardLocation(page)) || hit.location || null;

  const about = await sectionText(page, /^About$/i);
  const education = await sectionText(page, /^Education$/i);
  const experience = await sectionText(page, /^Experience$/i);
  const skills = await sectionText(page, /^Skills$/i);

  hrefs.push(...about.hrefs, ...education.hrefs, ...experience.hrefs);

  let contactText = "";
  const contact = page.getByRole("link", { name: /contact info/i }).first();
  if ((await contact.count()) > 0) {
    await contact.click().catch(() => null);
    await sleep(800);
    const modal = page.locator('[role="dialog"], .artdeco-modal').first();
    if ((await modal.count()) > 0) {
      contactText = await modal.innerText().catch(() => "");
      hrefs.push(...(await collectHrefs(modal)));
      await page.keyboard.press("Escape").catch(() => null);
    }
  }

  const blob = [mainText, about.text, education.text, contactText, ...hrefs].join(
    "\n"
  );
  const links = parseAllLinks(blob, hrefs);
  const edu = parseEducation(education.text);

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

  const experienceLines = experience.text
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !/^experience$/i.test(l))
    .slice(0, 10);

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
    school: edu.school,
    degree: edu.degree,
    country,
    graduation_year: edu.graduation_year,
    keywords,
    github_url: links.github_url ?? null,
    substack_url: links.substack_url ?? null,
    twitter_url: links.twitter_url ?? null,
    website_url: links.website_url ?? null,
    experience: experienceLines,
    skills: skillLines,
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
