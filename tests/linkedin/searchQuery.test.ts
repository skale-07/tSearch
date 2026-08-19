import { describe, expect, it } from "vitest";
import { formatSearchQuery } from "../../src/linkedin/linkedinSearch.js";
import {
  normalizeSchoolForSearch,
  olympiadHighSchool,
  olympiadSearchHints,
} from "../../src/olympiad/searchHints.js";
import type { OlympiadProfile } from "../../src/types.js";

function profile(partial: Partial<OlympiadProfile>): OlympiadProfile {
  return {
    name: "Test",
    years: [2022],
    sources: ["ISEF"],
    prizes: ["ISEF 2022 gold"],
    countries: ["United States of America"],
    schools: [],
    olympiadScore: 1,
    medalScore: 1,
    recencyScore: 1,
    ageScore: 0,
    ...partial,
  };
}

describe("LinkedIn search query strategy", () => {
  it("award query is name + award display name, unquoted award token", () => {
    expect(
      formatSearchQuery("Christine Song", {
        award_hint: "Davidson Fellows",
      })
    ).toBe('"Christine Song" Davidson Fellows');
  });

  it("college-only query is name + college", () => {
    expect(
      formatSearchQuery("Christine Song", {
        college: "Stanford University",
      })
    ).toBe('"Christine Song" Stanford University');
  });

  it("primary query is name + high school only", () => {
    expect(
      formatSearchQuery("Christine Song", {
        school: "Monta Vista High School",
      })
    ).toBe('"Christine Song" Monta Vista High School');
  });

  it("secondary query is name + olympiad hint + country (no school)", () => {
    expect(
      formatSearchQuery("Christine Song", {
        country: "United States of America",
        olympiad_hints: ["ISEF"],
      })
    ).toBe('"Christine Song" ISEF United States');
  });

  it("strips trailing state initials from high school for search", () => {
    const o = profile({
      schools: ["Stanford University", "Monta Vista High School, CA"],
    });
    expect(olympiadHighSchool(o)).toBe("Monta Vista High School");
    expect(normalizeSchoolForSearch("Lake Highland Preparatory School, FL")).toBe(
      "Lake Highland Preparatory School"
    );
    expect(olympiadSearchHints(o)).toEqual(["ISEF"]);
  });
});
