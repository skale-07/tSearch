import { describe, expect, it } from "vitest";
import {
  extractOrgHintFromPage,
  extractPagePeople,
  isPersonShapedName,
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

  it("marks leftover title-case names low confidence and unchecked", () => {
    const html = `<html><body><p>See work from Alice Example below.</p></body></html>`;
    const people = extractPagePeople({
      html,
      pageUrl: "https://blog.example/post",
    });
    const alice = people.find((p) => p.name === "Alice Example");
    expect(alice?.confidence).toBe("low");
    expect(alice?.checked_default).toBe(false);
  });

  it("rejects org and nav phrases as names", () => {
    expect(isPersonShapedName("Research Laboratory")).toBe(false);
    expect(isPersonShapedName("Ada Lovelace")).toBe(true);
    expect(isPersonShapedName("Team")).toBe(false);
    expect(isPersonShapedName("USA Astronomy")).toBe(false);
    expect(isPersonShapedName("USAAAO Team")).toBe(false);
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
    expect(names.some((n) => /usa|astronomy|olympiad/i.test(n))).toBe(false);
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
