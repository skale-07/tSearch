import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GitHubProfile, LinkedInProfile } from "../../src/types.js";

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "tsearch-webgraph-"));

beforeEach(() => {
  vi.resetModules();
  process.env.PROFILES_DIR = path.join(tmpDir, "profiles");
  process.env.OUTPUT_PATH = path.join(tmpDir, "candidates.json");
  process.env.PEOPLE_DIR = path.join(tmpDir, "people");
  process.env.MARKS_DIR = path.join(tmpDir, "marks");
  process.env.PENDING_SEEDS_PATH = path.join(tmpDir, "pending-seeds.json");
  process.env.CACHE_DIR = path.join(tmpDir, "cache");
  fs.mkdirSync(process.env.PROFILES_DIR, { recursive: true });
  fs.mkdirSync(process.env.PEOPLE_DIR, { recursive: true });
  for (const name of fs.readdirSync(tmpDir)) {
    const p = path.join(tmpDir, name);
    if (p === process.env.PROFILES_DIR || p === process.env.PEOPLE_DIR) continue;
    fs.rmSync(p, { recursive: true, force: true });
  }
  fs.mkdirSync(process.env.PROFILES_DIR, { recursive: true });
});

afterEach(() => {
  delete process.env.PROFILES_DIR;
  delete process.env.OUTPUT_PATH;
  delete process.env.PEOPLE_DIR;
  delete process.env.MARKS_DIR;
  delete process.env.PENDING_SEEDS_PATH;
});

function writeSeed(slug: string, name: string): void {
  const dir = path.join(process.env.PROFILES_DIR!, slug);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, "profile.json"),
    JSON.stringify({
      slug,
      name,
      kind: "seed",
      relation: "seed",
      hop: 0,
      seed: slug,
      discovered_via: [],
      parents: [],
      context_score: 8,
      context_signals: [],
      links: { personal_website: "https://lab.example/people" },
      last_updated: new Date().toISOString(),
    }),
    "utf-8"
  );
}

function linkedin(name: string, url: string): LinkedInProfile {
  return {
    url,
    name,
    photo_url: null,
    headline: null,
    college: "UC Berkeley",
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
  };
}

function github(login: string): GitHubProfile {
  return {
    username: login,
    display_name: login,
    profile_url: `https://github.com/${login}`,
    bio: null,
    blog: null,
    twitter_username: null,
    company: null,
    location: null,
    email: null,
    social_accounts: [],
    context_score: 6,
    context_signals: ["repos"],
    repos: [],
    contributors: [],
    stars: [],
    forks: [],
    followers: [],
    following: [],
    recent_commits: 0,
    active: true,
  };
}

describe("website graph attach", () => {
  it("refuses name-only ingest", async () => {
    writeSeed("feodor", "Feodor Petrov");
    const { prepareWebsiteGraphIngest } = await import(
      "../../src/pipeline/websiteGraph.js"
    );
    const job = prepareWebsiteGraphIngest({
      seed_slug: "feodor",
      url: "https://lab.example/people",
      names: ["Ada Lovelace"],
    });
    expect("error" in job).toBe(true);
    if ("error" in job) {
      expect(job.status).toBe(400);
      expect(job.error).toMatch(/Name-only/);
    }
  });

  it("caps ingest names at 15 when org token is present", async () => {
    writeSeed("feodor", "Feodor Petrov");
    const { prepareWebsiteGraphIngest, WEBSITE_GRAPH_INGEST_LIMIT } =
      await import("../../src/pipeline/websiteGraph.js");
    const names = Array.from({ length: 20 }, (_, i) => `Person ${i}`);
    const job = prepareWebsiteGraphIngest({
      seed_slug: "feodor",
      url: "https://lab.example/people",
      names,
      org_hint: "Berkeley",
    });
    if ("error" in job) throw new Error(job.error);
    expect(job.names).toHaveLength(WEBSITE_GRAPH_INGEST_LIMIT);
    expect(job.org_hint).toBe("Berkeley");
  });

  it("writes no tree when nobody has LinkedIn", async () => {
    writeSeed("feodor", "Feodor Petrov");
    const { attachWebsiteColocatedNeighbors } = await import(
      "../../src/pipeline/websiteGraph.js"
    );
    const attached = attachWebsiteColocatedNeighbors({
      seed_slug: "feodor",
      page_url: "https://lab.example/people",
      people: [
        { name: "Ada Lovelace", github_url: "https://github.com/ada" },
        { name: "Grace Hopper" },
      ],
    });
    expect(attached.attached).toBe(0);
    expect(attached.edges).toEqual([]);
    expect(fs.existsSync(path.join(tmpDir, "seed_tree.json"))).toBe(false);
  });

  it("persists only LinkedIn-confirmed colocated neighbors", async () => {
    writeSeed("feodor", "Feodor Petrov");
    const { attachWebsiteColocatedNeighbors } = await import(
      "../../src/pipeline/websiteGraph.js"
    );
    const attached = attachWebsiteColocatedNeighbors({
      seed_slug: "feodor",
      page_url: "https://lab.example/people",
      people: [
        {
          name: "Ada Lovelace",
          linkedin: linkedin(
            "Ada Lovelace",
            "https://www.linkedin.com/in/ada/"
          ),
          github_url: "https://github.com/ada",
        },
        { name: "Grace Hopper" },
      ],
    });
    expect(attached.attached).toBe(1);
    expect(attached.edges).toHaveLength(1);
    expect(attached.edges[0]?.via).toBe("website-colocated");

    const adaFile = path.join(
      process.env.PROFILES_DIR!,
      "feodor",
      "website",
      "ada",
      "profile.json"
    );
    expect(fs.existsSync(adaFile)).toBe(true);
    expect(
      fs.existsSync(
        path.join(
          process.env.PROFILES_DIR!,
          "feodor",
          "website",
          "grace-hopper",
          "profile.json"
        )
      )
    ).toBe(false);

    const tree = JSON.parse(
      fs.readFileSync(path.join(tmpDir, "seed_tree.json"), "utf-8")
    ) as { edges: Array<{ via: string }> };
    expect(tree.edges.map((e) => e.via)).toEqual(["website-colocated"]);
  });

  it("attaches GitHub collaborators under a hop-1 website neighbor", async () => {
    writeSeed("feodor", "Feodor Petrov");
    const {
      attachWebsiteColocatedNeighbors,
      attachGithubCollaboratorsUnderHost,
    } = await import("../../src/pipeline/websiteGraph.js");
    attachWebsiteColocatedNeighbors({
      seed_slug: "feodor",
      page_url: "https://lab.example/people",
      people: [
        {
          name: "Ada Lovelace",
          linkedin: linkedin(
            "Ada Lovelace",
            "https://www.linkedin.com/in/ada/"
          ),
          github: github("ada"),
        },
      ],
    });
    const collabs = attachGithubCollaboratorsUnderHost({
      seed_slug: "feodor",
      parent_slug: "ada",
      parent_relation: "website",
      parent_hop: 1,
      collaborators: [{ login: "ghopper", profile: github("ghopper") }],
    });
    expect(collabs.attached).toBe(1);
    expect(collabs.edges[0]?.via).toBe("github-collaborator");
    expect(collabs.edges[0]?.hop).toBe(2);
    expect(
      fs.existsSync(
        path.join(
          process.env.PROFILES_DIR!,
          "feodor",
          "website",
          "ada",
          "collaborators",
          "ghopper",
          "profile.json"
        )
      )
    ).toBe(true);
    const skipped = attachGithubCollaboratorsUnderHost({
      seed_slug: "feodor",
      parent_slug: "ada",
      parent_relation: "website",
      parent_hop: 2,
      collaborators: [{ login: "x", profile: github("x") }],
    });
    expect(skipped.attached).toBe(0);
  });
});

describe("orgHintFromUrl", () => {
  it("keeps the registrable label", async () => {
    const { orgHintFromUrl } = await import(
      "../../src/pipeline/websiteGraph.js"
    );
    expect(orgHintFromUrl("https://lab.berkeley.edu/people")).toBe("berkeley");
    expect(orgHintFromUrl("https://usaaao.org/team")).toBe("usaaao");
  });
});
