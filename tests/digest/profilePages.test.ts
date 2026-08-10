import { describe, it, expect } from "vitest";
import { renderProfilePage, profileFileName } from "../../src/digest/renderProfilePages.js";
import { renderHtml } from "../../src/digest/renderHtml.js";
import type { DigestCandidate, DigestDocument } from "../../src/digest/types.js";
import type { Candidate } from "../../src/types.js";

const digestCandidate: DigestCandidate = {
  candidate_id: "cand_rich",
  rank: 1,
  name: "Rich Person",
  archetype: "independent_systems_builder",
  primary_archetype: "independent_systems_builder",
  secondary_archetypes: [],
  headline: "Builds schedulers <script>alert(1)</script>",
  discovery_score: 1.4,
  assessment_priority_score: 82,
  assessment_confidence: 0.7,
  network_bridges: {
    seed_count: 2,
    seeds: ["Seed A", "Seed B"],
    collaborator_of: ["Seed A"],
  },
  why_highlighted: [
    { claim: "depth", rationale: "Custom scheduler with benchmarks.", evidence_ids: [] },
  ],
  brief_rationale: "Wrote a custom scheduler; benchmarked against tokio.",
  cory_relevance: "high",
  technical_summary: {
    score: 4.2,
    confidence: 0.7,
    rationale: "Deep systems work across the runtime.",
    evidence_ids: [],
  },
  curiosity_summary: { score: 6, confidence: 0.6, rationale: "r", evidence_ids: [] },
  strongest_artifacts: [
    {
      artifact_id: "a1",
      kind: "github_repository",
      title: "scheduler-rs",
      url: "https://github.com/rich/scheduler-rs",
      reason_selected: "cited",
    },
  ],
  important_uncertainties: ["Production usage unknown"],
  next_review_step: "Read the scheduler core.",
  links: { github: "https://github.com/rich" },
};

const source = {
  name: "Rich Person",
  key: "rich person",
  linkedin: {
    photo_url: "https://media.example.com/photo.jpg",
    headline: "Systems tinkerer",
    education: [
      { school: "MIT", degree: "BS", field: "CS", years: "2023–2027" },
    ],
    awards: [{ title: "IMO Gold", issuer: "IMO", date: "2023" }],
  },
  olympiad: { prizes: ["IMO 2023 Gold"], sources: ["IMO"] },
  github: {
    username: "rich",
    repos: [
      { name: "scheduler-rs", stars: 120, language: "Rust", topics: ["async"] },
    ],
  },
  website: { email: "sec.ret@example.com" },
} as unknown as Candidate;

const digest = {
  schema_version: "digest-v2",
  digest_id: "digest_test",
  assessment_run_id: "arun",
  generated_at: new Date().toISOString(),
  versions: {
    assessment_schema_version: "v",
    priority_weight_version: "w",
    prompt_versions: {},
  },
  criteria_summary: {
    purpose: "p",
    dimensions: [],
    important_non_signals: [],
    limitations: [],
  },
  meta: {
    discovered_candidate_count: 4,
    assessed_candidate_count: 2,
    source_candidates_path: "x",
  },
  candidates: [digestCandidate],
} as DigestDocument;

describe("renderProfilePage", () => {
  it("shows photo, credentials, projects, and bridge line — escaped", () => {
    const html = renderProfilePage(digestCandidate, source);
    expect(html).toContain("Rich Person");
    expect(html).toContain("media.example.com/photo.jpg");
    expect(html).toContain("IMO 2023 Gold");
    expect(html).toContain("MIT");
    expect(html).toContain("scheduler-rs");
    expect(html).toContain("Connected to 2 people in the seed set");
    expect(html).not.toContain("<script>alert");
  });

  it("never leaks scraped emails onto the page", () => {
    const html = renderProfilePage(digestCandidate, source);
    expect(html).not.toContain("sec.ret@example.com");
  });

  it("renders gracefully without a source candidate (initials avatar), escaping the digest headline", () => {
    const html = renderProfilePage(digestCandidate, undefined);
    expect(html).toContain("RP");
    expect(html).not.toContain("<img");
    expect(html).not.toContain("<script>alert");
    expect(html).toContain("&lt;script&gt;");
  });
});

describe("redesigned digest email", () => {
  it("cards link to Learn-more pages and drop internal jargon", () => {
    const html = renderHtml(digest);
    expect(html).toContain(`./profiles/digest_test/${profileFileName(digestCandidate)}`);
    expect(html).toContain("Learn more");
    expect(html).not.toMatch(/cory/i);
    expect(html).not.toContain("arun");
    expect(html).toContain("knows 2 of your seed set");
  });

  it("honors a hosted profile base URL", () => {
    const html = renderHtml(digest, {
      profileBaseUrl: "https://digests.example.com/p",
    });
    expect(html).toContain(
      `https://digests.example.com/p/${profileFileName(digestCandidate)}`
    );
  });
});
