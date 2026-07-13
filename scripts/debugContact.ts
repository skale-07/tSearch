import { openLinkedInSession } from "../src/linkedin/linkedinBrowser.js";
import { sleep } from "../src/linkedin/linkedinBrowser.js";
import {
  parsePersonalWebsiteFromContact,
  unwrapRedirectUrl,
} from "../src/linkedin/linkedinExtract.js";

const url = "https://www.linkedin.com/in/varunrmadan/";

async function main(): Promise<void> {
  const session = await openLinkedInSession();
  const { page } = session;

  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 });
  await page.waitForSelector("main", { timeout: 15000 }).catch(() => null);
  await sleep(2000);

  await page.evaluate(() => window.scrollTo(0, 0));
  await sleep(500);

  const triggers = [
    { name: "overlay link", loc: page.locator('a[href*="overlay/contact-info"]') },
    {
      name: "role link",
      loc: page.getByRole("link", { name: /contact info/i }),
    },
    { name: "text", loc: page.locator("main").getByText(/^Contact info$/i) },
    { name: "any contact", loc: page.locator("main a, main button").filter({ hasText: /contact info/i }) },
  ];

  for (const t of triggers) {
    console.log(`trigger ${t.name}: count=${await t.loc.count()}`);
  }

  const clickTarget = page
    .locator("main a, main button, main span")
    .filter({ hasText: /^Contact info$/i })
    .first();
  if ((await clickTarget.count()) > 0) {
    await clickTarget.click();
    await sleep(1500);
  }

  const dialogs = await page.locator('[role="dialog"], .artdeco-modal').evaluateAll(
    (els) =>
      els.map((el) => ({
        text: (el.textContent ?? "").trim().slice(0, 400),
        len: (el.textContent ?? "").length,
      }))
  );
  console.log("DIALOGS:", JSON.stringify(dialogs, null, 2));

  const modal = page
    .locator('[role="dialog"], .artdeco-modal')
    .filter({ hasText: /website|your profile|email|phone|contact info/i })
    .first();

  if ((await modal.count()) > 0) {
    const text = await modal.innerText();
    const hrefs = await modal.locator("a[href]").evaluateAll((els) =>
      els.map((el) => ({
        href: el.getAttribute("href") ?? "",
        text: (el.textContent ?? "").trim().slice(0, 80),
      }))
    );
    console.log("\nMODAL TEXT:\n", text);
    console.log("\nMODAL HREFS:", JSON.stringify(hrefs, null, 2));
    const unwrapped = hrefs.map((h) => unwrapRedirectUrl(h.href));
    console.log(
      "\nPARSED WEBSITE:",
      parsePersonalWebsiteFromContact(text, unwrapped)
    );
  } else {
    console.log("No matching contact modal found");
    const mainSnippet = await page.locator("main").innerText();
    console.log("MAIN has Contact info:", /contact info/i.test(mainSnippet));
  }

  await session.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
