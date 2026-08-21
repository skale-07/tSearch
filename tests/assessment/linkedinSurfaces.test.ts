import { describe, expect, it } from "vitest";
import {
  authoredWritingUrls,
  githubUsernameFromLinkedInSurfaces,
} from "../../src/assessment/linkedinSurfaces.js";
import type { Candidate } from "../../src/types.js";

function candidate(over: Partial<Candidate> = {}): Candidate {
  return {
    key: "x",
    name: "X",
    discovered_via: [],
    identity_confidence: 0,
    final_score: 0,
    score_breakdown: {
      builder: 0,
      thinker: 0,
      olympiad: 0,
      weirdness: 0,
      identity: 0,
    },
    ...over,
  };
}

describe("linkedinSurfaces", () => {
  it("takes GitHub from Featured, not only Contact github_url", () => {
    expect(
      githubUsernameFromLinkedInSurfaces(
        candidate({
          linkedin: {
            url: "https://www.linkedin.com/in/x",
            name: "X",
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
            featured_links: ["https://github.com/pinned-user/cool-repo"],
            experience: [],
            awards: [],
            skills: [],
          },
        })
      )
    ).toBe("pinned-user");
  });

  it("keeps papers and blogs, drops news coverage", () => {
    const urls = authoredWritingUrls(
      candidate({
        linkedin: {
          url: "https://www.linkedin.com/in/x",
          name: "X",
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
          featured_links: [
            "https://arxiv.org/abs/2401.00001",
            "https://alice.substack.com/p/hello",
            "https://www.nytimes.com/2024/01/01/science/kid.html",
          ],
          experience: [],
          awards: [],
          skills: [],
        },
      })
    );
    expect(urls.some((u) => u.includes("arxiv.org"))).toBe(true);
    expect(urls.some((u) => u.includes("substack.com"))).toBe(true);
    expect(urls.some((u) => u.includes("nytimes.com"))).toBe(false);
  });
});
