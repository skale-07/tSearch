import { describe, expect, it } from "vitest";
import {
  nameMatchesQuery,
  pickBestLinkedInHit,
} from "../../src/linkedin/linkedinMatch.js";
import type { LinkedInSearchHit } from "../../src/linkedin/linkedinSearch.js";

function hit(partial: Partial<LinkedInSearchHit> & { url: string }): LinkedInSearchHit {
  return {
    title: "",
    headline: "",
    location: "",
    snippet: "",
    ...partial,
  };
}

describe("nameMatchesQuery", () => {
  it("matches first+last when LinkedIn drops a middle name", () => {
    expect(nameMatchesQuery("Ana Maria Spiride", "Ana Spiride • 2nd")).toBe(
      true
    );
  });

  it("matches first name + last initial (LinkedIn privacy truncation)", () => {
    expect(nameMatchesQuery("Abigail Qi", "Abigail Q. • 2nd")).toBe(true);
    expect(nameMatchesQuery("Abigail Qi", "Abigail Q • 3rd")).toBe(true);
    expect(nameMatchesQuery("Bennett Huang", "Bennett H.")).toBe(true);
  });

  it("rejects a clearly different person", () => {
    expect(nameMatchesQuery("Abigail Qi", "Abigail Chen • 3rd")).toBe(false);
    expect(nameMatchesQuery("Abigail Qi", "Abigail C. • 2nd")).toBe(false);
  });
});

describe("pickBestLinkedInHit", () => {
  it("takes LinkedIn #1 for targeted search when the name matches", () => {
    const picked = pickBestLinkedInHit(
      [
        hit({
          url: "https://www.linkedin.com/in/abigail-qi/",
          title: "Abigail Qi • 2nd",
        }),
      ],
      {
        query_name: "Abigail Qi",
        school: "Baton Rouge Magnet High School",
      }
    );
    expect(picked?.hit.url).toContain("abigail-qi");
    expect(picked?.confidence).toBe(0.85);
  });

  it("takes LinkedIn #1 for targeted search when title scrape is empty", () => {
    const picked = pickBestLinkedInHit(
      [hit({ url: "https://www.linkedin.com/in/abigail-qi/", title: "" })],
      {
        query_name: "Abigail Qi",
        olympiad_hints: ["ISEF"],
        expected_country: "United States",
      }
    );
    expect(picked?.hit.url).toContain("abigail-qi");
    expect(picked?.confidence).toBe(0.75);
  });

  it("scans past a wrong-named #1 to a matching later card", () => {
    const picked = pickBestLinkedInHit(
      [
        hit({
          url: "https://www.linkedin.com/in/other/",
          title: "Someone Else • 1st",
        }),
        hit({
          url: "https://www.linkedin.com/in/abigail-qi/",
          title: "Abigail Qi • 2nd",
        }),
      ],
      { query_name: "Abigail Qi", school: "Baton Rouge Magnet High School" }
    );
    expect(picked?.hit.url).toContain("abigail-qi");
  });
});
