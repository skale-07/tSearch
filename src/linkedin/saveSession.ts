import fs from "fs";
import { COOKIES_PATH, BROWSER_LAUNCH_OPTIONS } from "../config.js";

async function main(): Promise<void> {
  const { chromium } = await import("playwright");
  const browser = await chromium.launch(BROWSER_LAUNCH_OPTIONS);
  const context = await browser.newContext();
  const page = await context.newPage();

  console.log("Log in to LinkedIn in the browser window, then press Enter here.");
  await page.goto("https://www.linkedin.com/login", { waitUntil: "domcontentloaded" });

  await new Promise<void>((resolve) => {
    process.stdin.once("data", () => resolve());
  });

  await context.storageState({ path: COOKIES_PATH });
  console.log(`Saved session → ${COOKIES_PATH}`);
  await browser.close();
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
