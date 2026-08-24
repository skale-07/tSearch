import { describe, expect, it } from "vitest";
import {
  extractOrgHintFromPage,
  extractPagePeople,
  isPersonShapedName,
  isRosterResultsUrl,
  isSoftNotFoundPage,
  peelResultPrefix,
} from "../../src/website/extractPagePeople.js";

const LAB_HTML = `
<html><head><title>Acme Lab</title></head>
<body>
  <h1>Acme Robotics Lab</h1>
  <p>Directed by Feodor Petrov.</p>
  <section id="team">
    <h2>People</h2>
    <ul>
      <li><a href="https://www.linkedin.com/in/ada-lovelace-123">Ada Lovelace</a></li>
      <li><a href="https://github.com/ghopper">Grace Hopper</a></li>
      <li>Alan Turing</li>
    </ul>
  </section>
  <footer><a href="/about">About</a></footer>
</body></html>
`;

const BLOG_HTML = `
<html><body>
  <h1>Notes on compilers</h1>
  <p>I wrote about register allocation. Contact me on Twitter.</p>
  <a href="https://twitter.com/someone">Twitter</a>
</body></html>
`;

describe("extractPagePeople", () => {
  it("pulls LinkedIn and GitHub anchors and team-list names", () => {
    const people = extractPagePeople({
      html: LAB_HTML,
      pageUrl: "https://lab.example/people",
      seedName: "Feodor Petrov",
    });
    const byName = Object.fromEntries(people.map((p) => [p.name, p]));
    expect(byName["Ada Lovelace"]?.confidence).toBe("high");
    expect(byName["Ada Lovelace"]?.linkedin_url).toMatch(/linkedin\.com\/in\/ada-lovelace/);
    expect(byName["Ada Lovelace"]?.checked_default).toBe(true);
    expect(byName["Grace Hopper"]?.github_url).toBe("https://github.com/ghopper");
    expect(byName["Grace Hopper"]?.confidence).toBe("high");
    expect(byName["Alan Turing"]?.confidence).toBe("medium");
    expect(byName["Feodor Petrov"]).toBeUndefined();
  });

  it("returns no people on a personal blog without a roster", () => {
    const people = extractPagePeople({
      html: BLOG_HTML,
      pageUrl: "https://notes.example/",
      seedName: "Writer",
    });
    expect(people.filter((p) => p.confidence !== "low")).toEqual([]);
  });

  it("marks leftover title-case names low confidence on roster URLs only", () => {
    const html = `<html><body><p>See work from Alice Example below.</p></body></html>`;
    const onNews = extractPagePeople({
      html,
      pageUrl: "https://blog.example/post",
    });
    expect(onNews.find((p) => p.name === "Alice Example")).toBeUndefined();

    const onRoster = extractPagePeople({
      html,
      pageUrl: "https://usaaao.org/historic-results",
    });
    const alice = onRoster.find((p) => p.name === "Alice Example");
    expect(alice?.confidence).toBe("low");
    expect(alice?.checked_default).toBe(false);
  });

  it("does not leftover-sweep news or ISEF headlines", () => {
    const html = `
<html><body>
  <article>
    <h1>Engineering Fair Winners Named</h1>
    <p>WRAL reports tonight. Students used Visual Studio Code and cited Copyright Capitol Broadcasting Company in the footer.</p>
  </article>
</body></html>`;
    const news = extractPagePeople({
      html,
      pageUrl: "https://www.wral.com/news/local/story/",
    });
    const names = news.map((p) => p.name);
    expect(names).not.toContain("Visual Studio Code");
    expect(names).not.toContain("Copyright Capitol Broadcasting Company");
    expect(names).not.toContain("Engineering Fair Winners Named");

    const isef = extractPagePeople({
      html: `<html><body><article><h1>A Novel Folding Method</h1><p>This project uses Visual Studio Code as the editor.</p></article></body></html>`,
      pageUrl: "https://projectboard.isef.net/project/abc123",
    });
    expect(isef.map((p) => p.name)).not.toContain("Visual Studio Code");
    expect(isef.map((p) => p.name)).not.toContain("A Novel Folding Method");
  });

  it("peels bylines into a personal name", () => {
    expect(peelResultPrefix("By Kaitlyn Dang")).toBe("Kaitlyn Dang");
    expect(peelResultPrefix("Written by Ada Lovelace")).toBe("Ada Lovelace");
    expect(isPersonShapedName("By Kaitlyn Dang")).toBe(true);

    const people = extractPagePeople({
      html: `<html><body><article><p>By Kaitlyn Dang</p></article></body></html>`,
      pageUrl: "https://www.wral.com/news/local/story/",
    });
    expect(people.map((p) => p.name)).toContain("Kaitlyn Dang");
    expect(people.map((p) => p.name)).not.toContain("By Kaitlyn Dang");
  });

  it("treats history and historic-results paths as roster pages", () => {
    expect(isRosterResultsUrl("https://usaaao.org/about/history/")).toBe(true);
    expect(isRosterResultsUrl("https://usaaao.org/historic-results")).toBe(
      true
    );
    expect(isRosterResultsUrl("https://usaaao.org/team")).toBe(true);
    expect(isRosterResultsUrl("https://www.wral.com/news/local/story/")).toBe(
      false
    );
    expect(
      isRosterResultsUrl("https://projectboard.isef.net/project/abc123")
    ).toBe(false);
  });

  it("rejects org and nav phrases as names", () => {
    expect(isPersonShapedName("Research Laboratory")).toBe(false);
    expect(isPersonShapedName("Ada Lovelace")).toBe(true);
    expect(isPersonShapedName("Team")).toBe(false);
    expect(isPersonShapedName("USA Astronomy")).toBe(false);
    expect(isPersonShapedName("USAAAO Team")).toBe(false);
    expect(isPersonShapedName("Gold Medal Alexander Li")).toBe(true);
    expect(isPersonShapedName("Mary-Jane Watson")).toBe(true);
    // Country + discipline still looks title-case — LLM screen drops it.
  });

  it("does not nominate org title-case as people on a roster page", () => {
    const html = `
<html><head><title>USAAAO — USA Astronomy and Astrophysics Olympiad</title></head>
<body>
  <h1>USAAAO</h1>
  <p>USA Astronomy and Astrophysics Olympiad</p>
  <ul>
    <li>Ada Lovelace</li>
    <li>Grace Hopper</li>
  </ul>
</body></html>`;
    const people = extractPagePeople({
      html,
      pageUrl: "https://usaaao.org/team",
      seedName: "Feodor Petrov",
    });
    const names = people.map((p) => p.name);
    expect(names).toContain("Ada Lovelace");
    expect(names).toContain("Grace Hopper");
    expect(
      people
        .filter((p) => p.checked_default)
        .some((p) => /usa|astronomy|olympiad/i.test(p.name))
    ).toBe(false);
  });

  it("reads names from article body, not site nav", () => {
    const html = `
<html><head><title>History – USAAAO</title></head>
<body>
  <nav><a href="/about/the-team/">The Team</a><a href="/selection/">Selection Process</a></nav>
  <article>
    <div class="entry-content">
      <p>Founded by six students. Gold Medal Alexander Li and Silver Medal Yehong Jiang competed.</p>
      <p>Brian Sun later joined the effort.</p>
    </div>
  </article>
</body></html>`;
    const people = extractPagePeople({
      html,
      pageUrl: "https://usaaao.org/about/history/",
      seedName: "Feodor Yevtushenko",
    });
    const names = people.map((p) => p.name);
    expect(names).toContain("Alexander Li");
    expect(names).toContain("Yehong Jiang");
    expect(names).toContain("Brian Sun");
    expect(names).not.toContain("Selection Process");
    expect(names).not.toContain("Gold Medal Alexander Li");
  });

  it("flags WordPress-style not-found pages", () => {
    expect(
      isSoftNotFoundPage(
        "<html><head><title>Page not found – USAAAO</title></head><body><h1>Page not found</h1></body></html>"
      )
    ).toBe(true);
  });

  it("prefers a page acronym matching the host as the org token", () => {
    const html = `
<html><head><title>USAAAO — USA Astronomy and Astrophysics Olympiad</title></head>
<body><h1>USAAAO</h1></body></html>`;
    expect(extractOrgHintFromPage(html, "https://usaaao.org/team")).toBe(
      "USAAAO"
    );
  });
});
