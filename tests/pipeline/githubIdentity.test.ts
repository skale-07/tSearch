import { describe, expect, it } from "vitest";
import type { LinkedInProfile, ResolvedIdentity } from "../../src/types.js";
import {
  attachVerifiedGithub,
  type GithubSearchDeps,
} from "../../src/pipeline/githubIdentity.js";

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

const noNetwork: GithubSearchDeps = {
  searchUsers: async () => [],
  fetchUser: async () => null,
  fetchReadme: async () => null,
  fetchOrgs: async () => null,
};

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
    await attachVerifiedGithub(id, { deps: noNetwork });
    expect(id.github_url).toBe("https://github.com/from-linkedin");
  });

  it("does not invent a GitHub URL when LinkedIn has none and search is empty", async () => {
    const id = identity();
    await attachVerifiedGithub(id, { deps: noNetwork });
    expect(id.github_url).toBeNull();
  });

  it("drops .github.io / asset URLs that are not a profile", async () => {
    const id = identity({
      github_url:
        "https://neuroailab.github.io/spelke_net/static/css/bulma.min.css",
    });
    await attachVerifiedGithub(id, { deps: noNetwork });
    expect(id.github_url).toBeNull();
  });

  it("attaches a name-search hit only when school/college appears on the profile", async () => {
    const id = identity({
      linkedin: linkedin({ school: "Lake Highland Preparatory School" }),
    });
    const deps: GithubSearchDeps = {
      searchUsers: async () => [
        { login: "other-jane", id: 1, type: "User" },
        { login: "warrenbei", id: 2, type: "User" },
      ],
      fetchUser: async (login) =>
        login === "warrenbei"
          ? {
              login: "warrenbei",
              name: "Warren Bei",
              bio: "Lake Highland alum",
              company: null,
              location: null,
              blog: null,
            }
          : {
              login,
              name: "Someone Else",
              bio: "random cs student",
              company: null,
              location: null,
              blog: null,
            },
      fetchReadme: async () => null,
      fetchOrgs: async () => null,
    };
    await attachVerifiedGithub(id, { deps });
    expect(id.github_url).toBe("https://github.com/warrenbei");
  });

  it("drops name-search hits that do not corroborate school/college/major", async () => {
    const id = identity({
      linkedin: linkedin({ college: "Stanford University" }),
    });
    const deps: GithubSearchDeps = {
      searchUsers: async () => [{ login: "warrenbei", id: 1, type: "User" }],
      fetchUser: async () => ({
        login: "warrenbei",
        name: "Warren Bei",
        bio: "CS student. I like rust.",
        company: null,
        location: null,
        blog: null,
      }),
      fetchReadme: async () => "hello world",
      fetchOrgs: async () => null,
    };
    await attachVerifiedGithub(id, { deps });
    expect(id.github_url).toBeNull();
  });

  it("attaches when the profile README cites the LinkedIn we already resolved", async () => {
    const id = identity({
      query_name: "Arihant Choudhary",
      linkedin: linkedin({
        url: "https://www.linkedin.com/in/arihantchoudhary/",
        name: "Arihant Choudhary",
      }),
    });
    const deps: GithubSearchDeps = {
      searchUsers: async () => [
        { login: "arihantchoudhary", id: 1, type: "User" },
      ],
      fetchUser: async () => ({
        login: "arihantchoudhary",
        name: "Arihant Choudhary",
        bio: "Still Learning and vibe coding",
        company: null,
        location: null,
        blog: null,
      }),
      fetchReadme: async () =>
        "Hi, I'm Arihant!\nLinkedIn: https://www.linkedin.com/in/arihantchoudhary/",
      fetchOrgs: async () => null,
    };
    await attachVerifiedGithub(id, { deps });
    expect(id.github_url).toBe("https://github.com/arihantchoudhary");
  });

  it("does not skip name-search just because LinkedIn has no school", async () => {
    const id = identity();
    let searched = false;
    const deps: GithubSearchDeps = {
      searchUsers: async () => {
        searched = true;
        return [];
      },
      fetchUser: async () => null,
      fetchReadme: async () => null,
      fetchOrgs: async () => null,
    };
    await attachVerifiedGithub(id, { deps });
    expect(searched).toBe(true);
    expect(id.github_url).toBeNull();
  });
});
