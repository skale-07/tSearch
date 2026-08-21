import { describe, expect, it } from "vitest";
import { publicTextAgeHint } from "../../../src/assessment/stage/publicTextAge.js";
import { deriveStage, formatAgeLabel } from "../../../src/assessment/stage/deriveStage.js";
import { ageScalar } from "../../../src/scoring/ageScalar.js";
import { htmlToExcerpt } from "../../../src/website/scrapeWebsite.js";
import type { OlympiadProfile, WebsiteProfile } from "../../../src/types.js";

const now = new Date("2026-08-21");

function site(text_excerpt: string): WebsiteProfile {
  return {
    url: "https://example.test",
    scraped_at: now.toISOString(),
    github_url: null,
    substack_url: null,
    twitter_url: null,
    linkedin_url: null,
    email: null,
    instagram_url: null,
    youtube_url: null,
    other_links: [],
    all_links: [],
    text_excerpt,
  };
}

function olympiadYearOnly(year: number): OlympiadProfile {
  return {
    name: "A",
    years: [year],
    sources: ["ISEF"],
    prizes: [],
    countries: [],
    schools: [],
    olympiadScore: 1,
    medalScore: 0,
    recencyScore: 1,
    ageScore: 0,
  };
}

describe("publicTextAgeHint", () => {
  it("reads college class standing, not job-title junior", () => {
    expect(
      publicTextAgeHint({
        website: site("I'm a junior in college studying compilers."),
        currentYear: 2026,
      })
    ).toMatchObject({ age: 20, basis: "text_standing", floor: false });

    expect(
      publicTextAgeHint({
        website: site("College sophomore. Building a kernel."),
        currentYear: 2026,
      })?.age
    ).toBe(19);

    expect(
      publicTextAgeHint({
        website: site("Junior software engineer at a startup."),
        currentYear: 2026,
      })
    ).toBeNull();
  });

  it("distinguishes high-school standing from college standing", () => {
    expect(
      publicTextAgeHint({
        website: site("High school junior, USACO camp."),
        currentYear: 2026,
      })
    ).toMatchObject({ age: 17, basis: "text_standing" });
  });

  it("floors graduate programs and alumni above 21", () => {
    expect(
      publicTextAgeHint({
        github: { bio: "PhD student in programming languages" },
        currentYear: 2026,
      })
    ).toMatchObject({ age: 25, floor: true, basis: "text_age_floor" });

    expect(
      publicTextAgeHint({
        website: site("Master's student in CS"),
        currentYear: 2026,
      })?.age
    ).toBe(23);

    expect(
      publicTextAgeHint({
        website: site("Recent college graduate working on compilers."),
        currentYear: 2026,
      })
    ).toMatchObject({ age: 22, floor: true });
  });

  it("does not treat a grad student as an undergrad alum", () => {
    expect(
      publicTextAgeHint({
        github: { bio: "CS grad student" },
        currentYear: 2026,
      })
    ).toMatchObject({ age: 23, floor: true });
  });

  it("ages class-of years: future is still in school, past has graduated", () => {
    expect(
      publicTextAgeHint({
        website: site("CS major, class of 2028."),
        currentYear: 2026,
      })
    ).toMatchObject({ age: 20, basis: "text_class_year", floor: false });

    expect(
      publicTextAgeHint({
        github: { bio: "Alum, class of 2020." },
        currentYear: 2026,
      })
    ).toMatchObject({ age: 28, basis: "text_class_year", floor: true });
  });

  it("ages a graduated-in-month year, not only 'class of'", () => {
    expect(
      publicTextAgeHint({
        extraTexts: [
          "I graduated from State University with a B.S. in Electrical Engineering in June 2024 as a scholar.",
        ],
        currentYear: 2026,
      })
    ).toMatchObject({ age: 24, basis: "text_class_year", floor: true });
  });

  it("reads a year sitting just before 'graduated'", () => {
    expect(
      publicTextAgeHint({
        extraTexts: ["[Jun 2024] I graduated from State University!"],
        currentYear: 2026,
      })
    ).toMatchObject({ age: 24, basis: "text_class_year" });
  });
});

describe("deriveStage public text", () => {
  it("lets college junior beat an olympiad-year typical-17 guess", () => {
    const stage = deriveStage({
      olympiad: olympiadYearOnly(2025),
      website: site("I'm a junior in college."),
      now,
    });
    expect(stage.basis).toBe("text_standing");
    expect(stage.estimated_age).toBe(20);
    expect(formatAgeLabel(stage)).toBe("~20");
    expect(ageScalar(20)).toBeLessThan(ageScalar(17));
    expect(ageScalar(20)).toBeGreaterThan(ageScalar(22));
  });

  it("treats alumni language as a ≥22 floor", () => {
    const stage = deriveStage({
      website: site("University graduate. Previously interned at a lab."),
      now,
    });
    expect(stage.basis).toBe("text_age_floor");
    expect(stage.estimated_age).toBe(22);
    expect(stage.bucket).toBe("post_grad");
    expect(formatAgeLabel(stage)).toBe("≥22");
  });
});

describe("htmlToExcerpt", () => {
  it("keeps visible standing language and drops scripts", () => {
    const text = htmlToExcerpt(
      `<html><head><title>Jane</title><script>var age=17</script></head><body><p>I'm a junior in college.</p></body></html>`
    );
    expect(text).toMatch(/junior in college/i);
    expect(text).not.toMatch(/var age/);
  });
});
