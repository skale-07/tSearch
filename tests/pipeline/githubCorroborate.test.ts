import { describe, expect, it } from "vitest";
import {
  corroboratingHits,
  distinctiveNeedles,
  githubCitesKnownIdentity,
  githubProfileBlob,
  identityAnchors,
  linkedInSlugFromUrl,
} from "../../src/pipeline/githubCorroborate.js";
import type { LinkedInProfile } from "../../src/types.js";

function li(over: Partial<LinkedInProfile> = {}): LinkedInProfile {
  return {
    url: "https://www.linkedin.com/in/x",
    name: "Test",
    photo_url: null,
    headline: null,
    college: null,
    school: null,
    degree: null,
    country: null,
    graduation_year: null,
    education: [],
    keywords: [],
    github_url: null,
    substack_url: null,
    twitter_url: null,
    personal_website: null,
    website_url: null,
    contact_links: [],
    experience: [],
    awards: [],
    skills: [],
    ...over,
  };
}

describe("distinctiveNeedles", () => {
  it("keeps highland from a prep school and drops school/prep", () => {
    const needles = distinctiveNeedles(
      "Lake Highland Preparatory School, FL"
    );
    expect(needles).toContain("highland");
    expect(needles).toContain("lake highland");
    expect(needles.some((n) => n === "school" || n === "prep")).toBe(false);
  });

  it("keeps MIT as an acronym", () => {
    expect(distinctiveNeedles("MIT")).toContain("mit");
  });

  it("does not treat Computer Science as an identity needle", () => {
    expect(distinctiveNeedles("Computer Science")).toEqual([]);
  });
});

describe("corroboratingHits", () => {
  it("matches school tokens in a GitHub bio", () => {
    const anchors = identityAnchors(
      li({ school: "Lake Highland Preparatory School, FL" })
    );
    const blob = githubProfileBlob({
      bio: "HS at Lake Highland • now Stanford",
    });
    expect(corroboratingHits(anchors, blob).length).toBeGreaterThan(0);
  });

  it("rejects a bio that only says university / CS", () => {
    const anchors = identityAnchors(
      li({
        college: "Stanford University",
        education: [{ school: "Stanford University", degree: "BS", field: "Computer Science", years: "2024" }],
      })
    );
    expect(anchors).toContain("stanford");
    const blob = githubProfileBlob({
      bio: "CS student at a university. I like engineering.",
    });
    expect(corroboratingHits(anchors, blob)).toEqual([]);
  });
});

describe("githubCitesKnownIdentity", () => {
  it("extracts a LinkedIn slug", () => {
    expect(
      linkedInSlugFromUrl("https://www.linkedin.com/in/arihantchoudhary/")
    ).toBe("arihantchoudhary");
  });

  it("matches a README that lists the LinkedIn URL", () => {
    const readme = `Hi, I'm Arihant!
Personal Website: https://www.arihantchoudhary.com
LinkedIn: https://www.linkedin.com/in/arihantchoudhary/`;
    expect(
      githubCitesKnownIdentity(
        readme,
        "https://www.linkedin.com/in/arihantchoudhary/",
        ["https://www.arihantchoudhary.com"]
      )
    ).toEqual({ via: "linkedin", detail: "arihantchoudhary" });
  });

  it("does not treat a name-only README as a LinkedIn cite", () => {
    expect(
      githubCitesKnownIdentity(
        "Hi, I'm Arihant Choudhary. Still learning.",
        "https://www.linkedin.com/in/arihantchoudhary/",
        []
      )
    ).toBeNull();
  });
});
