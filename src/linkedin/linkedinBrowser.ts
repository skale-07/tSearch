import fs from "fs";
import type { Browser, BrowserContext, Page } from "playwright";
import { BROWSER_LAUNCH_OPTIONS, COOKIES_PATH } from "../config.js";

export interface LinkedInSession {
  page: Page;
  close(): Promise<void>;
}

let activeBrowser: Browser | null = null;
let activeContext: BrowserContext | null = null;

export function requireCookies(): void {
  if (!fs.existsSync(COOKIES_PATH)) {
    throw new Error(
      `Missing ${COOKIES_PATH}. Run "npm run login" and sign in to LinkedIn first.`
    );
  }
}

export async function openLinkedInSession(): Promise<LinkedInSession> {
  requireCookies();

  const { chromium } = await import("playwright");
  activeBrowser = await chromium.launch(BROWSER_LAUNCH_OPTIONS);
  activeContext = await activeBrowser.newContext({
    storageState: COOKIES_PATH,
    viewport: { width: 1280, height: 900 },
  });
  const page = await activeContext.newPage();

  await page.goto("https://www.linkedin.com/feed/", {
    waitUntil: "domcontentloaded",
    timeout: 45000,
  });
  await page.waitForTimeout(1500);

  const onLoginPage =
    page.url().includes("/login") || page.url().includes("/checkpoint");
  if (onLoginPage) {
    await page.close();
    await activeContext.close();
    await activeBrowser.close();
    activeContext = null;
    activeBrowser = null;
    throw new Error(
      `LinkedIn session expired. Run "npm run login" to refresh ${COOKIES_PATH}.`
    );
  }

  return {
    page,
    close: async () => {
      if (activeContext) await activeContext.close();
      if (activeBrowser) await activeBrowser.close();
      activeContext = null;
      activeBrowser = null;
    },
  };
}

export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
