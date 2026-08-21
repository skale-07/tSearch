import { describe, expect, it } from "vitest";
import {
  expandTwoDigitYear,
  parseEducationEndYear,
  parseStatedAge,
  ageFromLinkedInProfile,
} from "../../src/linkedin/linkedinAge.js";
import { deriveStage, formatAgeLabel } from "../../src/assessment/stage/deriveStage.js";

describe("parseStatedAge", () => {
  it("reads explicit current-age phrasing", () => {
    expect(parseStatedAge("19 years old | student")).toBe(19);
    expect(parseStatedAge("I'm 20 and building compilers")).toBe(20);
    expect(parseStatedAge("I am 18")).toBe(18);
    expect(parseStatedAge("Age: 21")).toBe(21);
    expect(parseStatedAge("19 yo CS student")).toBe(19);
    expect(parseStatedAge("17 | Student at MIT")).toBe(17);
  });

  it("does not treat class years or counts as an age", () => {
    expect(parseStatedAge("Class of 19")).toBeNull();
    expect(parseStatedAge("YC W19")).toBeNull();
    expect(parseStatedAge("20 years of experience")).toBeNull();
    expect(parseStatedAge("Top 20 under 20 list nominee")).toBeNull();
    expect(parseStatedAge("Age 18-24 program")).toBeNull();
  });
});

describe("education year parsing", () => {
  it("expands '08 to 2008 in 2026", () => {
    expect(expandTwoDigitYear(8, 2026)).toBe(2008);
    expect(parseEducationEndYear("Class of '08", 2026)).toBe(2008);
    expect(parseEducationEndYear("2004 - 2008", 2026)).toBe(2008);
  });

  it("skips in-progress rows", () => {
    expect(parseEducationEndYear("2023 - Present", 2026)).toBeNull();
  });
});

describe("ageFromLinkedInProfile", () => {
  it("uses HS end year at typical age 18 (class of 2008 → ~36 in 2026)", () => {
    const hint = ageFromLinkedInProfile(
      {
        headline: "Software engineer",
        education: [
          {
            school: "Stanford University",
            degree: "BS",
            field: "CS",
            years: "2006 - 2010",
          },
          {
            school: "Lincoln High School",
            degree: null,
            field: null,
            years: "2004 - 2008",
          },
        ],
        school: "Stanford University",
        degree: "BS",
        graduation_year: 2010,
      },
      2026
    );
    expect(hint).toMatchObject({ age: 36, basis: "linkedin_hs_year" });
  });

  it("lets a stated headline age dominate education", () => {
    const hint = ageFromLinkedInProfile(
      {
        headline: "19 years old | student",
        education: [
          {
            school: "Lincoln High School",
            degree: null,
            field: null,
            years: "2004 - 2008",
          },
        ],
        school: "Lincoln High School",
        degree: null,
        graduation_year: 2008,
      },
      2026
    );
    expect(hint).toMatchObject({ age: 19, basis: "linkedin_stated_age" });
  });
});

describe("deriveStage LinkedIn priority", () => {
  const now = new Date("2026-08-18");

  it("lets LinkedIn headline age beat an olympiad age band", () => {
    const stage = deriveStage({
      linkedin: { headline: "I'm 21" } as never,
      olympiad: {
        name: "A",
        years: [2024],
        sources: ["IMO"],
        prizes: [],
        countries: [],
        schools: [],
        olympiadScore: 3,
        medalScore: 3,
        recencyScore: 4,
        ageScore: 2,
      },
      now,
    });
    expect(stage.basis).toBe("linkedin_stated_age");
    expect(stage.estimated_age).toBe(21);
  });

  it("reads a high-school class year as ~18 at that year", () => {
    const stage = deriveStage({
      linkedin: {
        education: [
          {
            school: "Lincoln High School",
            degree: null,
            field: null,
            years: "Class of '08",
          },
        ],
      } as never,
      now,
    });
    expect(stage.basis).toBe("linkedin_hs_year");
    expect(stage.estimated_age).toBe(36);
  });
});

describe("formatAgeLabel", () => {
  it("omits the tilde for a stated LinkedIn age", () => {
    expect(
      formatAgeLabel({ estimated_age: 21, basis: "linkedin_stated_age" })
    ).toBe("21");
  });

  it("marks inferred ages as estimates and completed-bachelor's as a floor", () => {
    expect(
      formatAgeLabel({ estimated_age: 36, basis: "linkedin_hs_year" })
    ).toBe("~36");
    expect(
      formatAgeLabel({ estimated_age: 22, basis: "text_age_floor" })
    ).toBe("≥22");
    expect(
      formatAgeLabel({ estimated_age: null, basis: "none" })
    ).toBeNull();
  });
});
