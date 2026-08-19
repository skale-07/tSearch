import { describe, expect, it } from "vitest";
import type { LinkedInProfile, ResolvedIdentity } from "../../src/types.js";
import { attachVerifiedGithub } from "../../src/pipeline/githubIdentity.js";

function linkedin(over: Partial<LinkedInProfile> = {}): LinkedInProfile {
  return {
    url: "https://www.linkedin.com/in/warrenbei",
    name: "Warren Bei",
    photo_url: null,
    headline: null,
    college: null,
    school: null,
    degree: null,
    country: "Canada",
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

describe("attachVerifiedGithub", () => {
  function identity(over: Partial<ResolvedIdentity> = {}): ResolvedIdentity {
    return {
      query_name: "Warren Bei",
      linkedin: linkedin(),
      identity_confidence: 0.8,
      github_url: null,
      substack_url: null,
      website: null,
      ...over,
    };
  }

  it("keeps a GitHub URL already on LinkedIn/website", async () => {
    const id = identity({ github_url: "https://github.com/from-linkedin" });
    await attachVerifiedGithub(id);
    expect(id.github_url).toBe("https://github.com/from-linkedin");
  });

  it("does not invent a GitHub URL when LinkedIn has none", async () => {
    const id = identity();
    await attachVerifiedGithub(id);
    expect(id.github_url).toBeNull();
  });

  it("drops .github.io / asset URLs that are not a profile", async () => {
    const id = identity({
      github_url:
        "https://neuroailab.github.io/spelke_net/static/css/bulma.min.css",
    });
    await attachVerifiedGithub(id);
    expect(id.github_url).toBeNull();
  });
});
