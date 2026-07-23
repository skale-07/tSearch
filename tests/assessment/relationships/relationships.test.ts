import { describe, expect, it } from "vitest";
import {
  extractBlogUrls,
  extractDeterministicLinks,
  extractGithubUrls,
} from "../../../src/assessment/relationships/extractDeterministicLinks.js";
import {
  inferRelationships,
  weakOverlapScore,
} from "../../../src/assessment/relationships/inferRelationships.js";
import {
  filterValidRelationships,
  RelationshipValidationError,
  validateRelationships,
} from "../../../src/assessment/relationships/validateRelationships.js";
import type { ArtifactRelationship } from "../../../src/assessment/relationships/types.js";

describe("URL extractors", () => {
  it("finds github and blog urls", () => {
    expect(
      extractGithubUrls("see https://github.com/acme/widget/tree/main")
    ).toEqual(["https://github.com/acme/widget"]);
    expect(
      extractBlogUrls("readme https://notes.example.com/post/1 and https://github.com/x/y")
    ).toEqual(["https://notes.example.com/post/1"]);
  });
});

describe("extractDeterministicLinks", () => {
  it("links article→repo and repo→article from exact URLs", () => {
    const rels = extractDeterministicLinks([
      {
        artifact_id: "art_blog",
        kind: "technical_article",
        canonical_url: "https://notes.example.com/post/1",
        text: "Implementation lives at https://github.com/acme/widget",
      },
      {
        artifact_id: "art_repo",
        kind: "github_repository",
        canonical_url: "https://github.com/acme/widget",
        text: "Writeup: https://notes.example.com/post/1",
      },
    ]);
    expect(
      rels.some(
        (r) =>
          r.relationship_type === "article_links_repository" &&
          r.deterministic === true
      )
    ).toBe(true);
    expect(
      rels.some(
        (r) =>
          r.relationship_type === "repository_links_article" &&
          r.deterministic === true
      )
    ).toBe(true);
  });
});

describe("inferRelationships", () => {
  it("marks weak links as non-deterministic", () => {
    const arts = [
      {
        artifact_id: "a",
        kind: "technical_article",
        canonical_url: "https://example.com/scheduler",
        text: "distributed scheduler runtime latency",
      },
      {
        artifact_id: "b",
        kind: "github_repository",
        canonical_url: "https://github.com/x/scheduler",
        text: "distributed scheduler runtime",
      },
    ];
    expect(weakOverlapScore(arts[0], arts[1])).toBeGreaterThanOrEqual(2);
    const inferred = inferRelationships(arts);
    expect(inferred.length).toBeGreaterThan(0);
    expect(inferred.every((r) => r.deterministic === false)).toBe(true);
  });
});

describe("validateRelationships", () => {
  const base: ArtifactRelationship = {
    relationship_id: "rel_1",
    source_artifact_id: "a",
    target_artifact_id: "b",
    relationship_type: "article_links_repository",
    deterministic: true,
    confidence_support: "high",
    evidence_ids: [],
  };

  it("rejects missing artifact ids", () => {
    expect(() => validateRelationships([base], ["a"])).toThrow(
      RelationshipValidationError
    );
  });

  it("rejects deterministic inferred_connection", () => {
    expect(() =>
      validateRelationships(
        [
          {
            ...base,
            relationship_type: "inferred_connection",
            deterministic: true,
          },
        ],
        ["a", "b"]
      )
    ).toThrow(/deterministic:false/);
  });

  it("filters unknown ids quietly", () => {
    expect(filterValidRelationships([base], ["a"])).toHaveLength(0);
    expect(filterValidRelationships([base], ["a", "b"])).toHaveLength(1);
  });
});
