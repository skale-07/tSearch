import { describe, expect, it } from "vitest";
import {
  hasDetailedLinkedInExperience,
  interestingProfileLinks,
  isYouthWildcardPoolMember,
  pickYouthWildcardIds,
  YOUTH_WILDCARD_LIMIT,
} from "../../src/assessment/youthWildcard.js";
import type { Candidate, LinkedInProfile } from "../../src/types.js";
import { identityFromCandidate } from "../../src/assessment/candidateIdentity.js";

function li(over: Partial<LinkedInProfile> = {}): LinkedInProfile {
  return {
    url: "https://www.linkedin.com/in/x",
    name: "Test",
    photo_url: null,
    headline: "Student",
    college: null,
    school: "East High",
    degree: null,
    country: "United States",
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
    stated_age: 18,
    ...over,
  };
}

function cand(
  name: string,
  over: Partial<Candidate> & { linkedin?: LinkedInProfile } = {}
): Candidate {
  return {
    name,
    key: name.toLowerCase(),
    discovered_via: [],
    identity_confidence: 0.8,
    final_score: 1,
    score_breakdown: {
      builder: 0,
      thinker: 0,
      olympiad: 1,
      weirdness: 0,
      identity: 0.2,
      estimated_age: 18,
    },
    linkedin: over.linkedin ?? li(),
    ...over,
  };
}

const detailedExp = [
  {
    title: "Software Engineering Intern",
    company: "Acme Robotics",
    dates: "Jun 2025 – Aug 2025",
    location: "Boston, MA",
  },
];

describe("youthWildcard", () => {
  it("requires detailed experience and interesting links", () => {
    expect(hasDetailedLinkedInExperience(li({ experience: detailedExp }))).toBe(
      true
    );
    expect(
      hasDetailedLinkedInExperience(
        li({ experience: [{ title: "Student", company: null, dates: null, location: null }] })
      )
    ).toBe(false);
    const withFeatured = cand("A", {
      linkedin: li({
        experience: detailedExp,
        featured_links: ["https://isef.net/project/abc"],
      }),
    });
    expect(interestingProfileLinks(withFeatured).length).toBeGreaterThan(0);
    expect(isYouthWildcardPoolMember(withFeatured)).toBe(true);
    expect(
      isYouthWildcardPoolMember(
        cand("B", {
          linkedin: li({
            experience: detailedExp,
            featured_links: ["https://example.com/x"],
            stated_age: 22,
          }),
        })
      )
    ).toBe(false);
  });

  it("draws a stable set of at most 5 from the pool", () => {
    const pool = Array.from({ length: 8 }, (_, i) =>
      cand(`Person ${i}`, {
        linkedin: li({
          url: `https://www.linkedin.com/in/p${i}`,
          name: `Person ${i}`,
          experience: detailedExp,
          featured_links: [`https://example.com/p${i}`],
          stated_age: 17 + (i % 3),
        }),
      })
    );
    const first = pickYouthWildcardIds(pool);
    const second = pickYouthWildcardIds(pool);
    expect(first.size).toBe(YOUTH_WILDCARD_LIMIT);
    expect([...first].sort()).toEqual([...second].sort());
    const ids = pool.map((c) => identityFromCandidate(c).candidate_id);
    for (const id of first) expect(ids).toContain(id);
  });

  it("falls back to contact/site links when Featured was never stored", () => {
    const c = cand("C", {
      linkedin: li({
        experience: detailedExp,
        contact_links: ["https://my-isef-project.example/writeup"],
      }),
    });
    expect(interestingProfileLinks(c)).toEqual([
      "https://my-isef-project.example/writeup",
    ]);
    expect(isYouthWildcardPoolMember(c)).toBe(true);
  });
});
