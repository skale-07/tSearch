import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { predictSeedAge } from "../../src/seeds/predictSeedAge.js";
import {
  parseCocaColaScholarsHtml,
  parseDavidsonFellowsHtml,
  parseRegeneronStsHtml,
  scrapeAwardRosters,
  yearsInRange,
} from "../../src/seeds/sources/awardRosterScrape.js";

describe("predictSeedAge", () => {
  it("ages a high-school-senior award forward (2022 senior → ~22 in 2026)", () => {
    expect(
      predictSeedAge(
        {
          source_id: "cameron_impact:2022",
          award_id: "cameron_impact",
          cohort_year: 2022,
          source_kind: "award_roster",
        },
        2026
      )
    ).toMatchObject({ age: 22, label: "~22" });
  });

  it("prefers a stated age at award over the cohort typical", () => {
    expect(
      predictSeedAge(
        {
          source_id: "regeneron_sts:2025",
          award_id: "regeneron_sts",
          cohort_year: 2025,
          age_at_award: 17,
          source_kind: "award_roster",
        },
        2026
      )
    ).toMatchObject({ age: 18, label: "~18" });
  });

  it("uses typical olympiad age when the CSV had no age column", () => {
    expect(
      predictSeedAge(
        {
          source_id: "olympiad:isef",
          cohort_year: 2022,
          source_kind: "olympiad_csv",
        },
        2026
      )
    ).toMatchObject({ age: 21, label: "~21" });
  });
});

describe("award roster HTML parsers", () => {
  it("reads Davidson Fellows h3 names and skips honorable mentions", () => {
    const html = `
      <h3>Ada Lovelace</h3><p>Berkeley, CA - Mathematics</p>
      <h3>Grace Hopper</h3><p>New York, NY - Science</p>
      <h3>Philip Meng &amp; Abhay Gupta</h3><p>Team Project - Technology</p>
      <h2>Honorable Mentions</h2>
      <h3>Should Skip</h3>
    `;
    const rows = parseDavidsonFellowsHtml(html);
    expect(rows.map((r) => r.name)).toEqual([
      "Ada Lovelace",
      "Grace Hopper",
      "Philip Meng",
      "Abhay Gupta",
    ]);
    expect(rows[0]?.country).toBe("United States");
  });

  it("reads Regeneron STS name + stated age", () => {
    const html = `
      <p><strong>Ada Lovelace</strong>, Age: 18<br />
      Example Academy, NJ<br />
      Project Title: Foam</p>
      <p><strong>Grace Hopper</strong>, Age: 17<br />
      Other High School, CA<br />
      Project Title: Navy</p>
    `;
    const rows = parseRegeneronStsHtml(html);
    expect(rows).toEqual([
      { name: "Ada Lovelace", age_at_award: 18, country: "United States" },
      { name: "Grace Hopper", age_at_award: 17, country: "United States" },
    ]);
  });

  it("falls back to plain-text Regeneron STS pages", () => {
    const rows = parseRegeneronStsHtml(
      "Ada Lovelace, Age: 18 Example Academy, NJ Project Title: Foam\n" +
        "Grace Hopper, Age: 17 Other High School, CA Project Title: Navy"
    );
    expect(rows.map((r) => r.name)).toEqual(["Ada Lovelace", "Grace Hopper"]);
  });

  it("reads Coca-Cola first/last table rows", () => {
    const html = `
      <table>
        <tr><th>First</th><th>Last</th><th>High School</th><th>City</th><th>State</th></tr>
        <tr><td>Ada</td><td>Lovelace</td><td>X</td><td>San Diego</td><td>CA</td></tr>
        <tr><td>Grace</td><td>Hopper</td><td>Y</td><td>Arlington</td><td>VA</td></tr>
      </table>
    `;
    const rows = parseCocaColaScholarsHtml(html);
    expect(rows.map((r) => r.name)).toEqual(["Ada Lovelace", "Grace Hopper"]);
    expect(rows[0]?.country).toBe("United States");
  });
});

describe("scrapeAwardRosters", () => {
  it("writes one roster file per award-year from fetched HTML", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tsearch-scrape-"));
    const names = [
      "Ada Lovelace",
      "Grace Hopper",
      "Alan Turing",
      "Alonzo Church",
      "Katherine Johnson",
      "Dorothy Vaughan",
    ];
    const html = names.map((n) => `<h3>${n}</h3>`).join("");
    const report = await scrapeAwardRosters({
      award_ids: ["davidson_fellows"],
      yearFrom: 2024,
      yearTo: 2025,
      dir,
      delayMs: 0,
      fetchHtml: async () => html,
    });
    expect(report.names_written).toBe(12);
    expect(report.jobs).toHaveLength(2);
    expect(fs.existsSync(path.join(dir, "davidson_fellows.2024.csv"))).toBe(true);
    expect(fs.existsSync(path.join(dir, "davidson_fellows.2025.csv"))).toBe(true);
  });

  it("caps the year range", () => {
    expect(() => yearsInRange(2018, 2026)).toThrow(/cap is 6/);
  });
});
