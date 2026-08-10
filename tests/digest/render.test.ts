import { describe, expect, it } from "vitest";
import { buildDigest } from "../../src/digest/buildDigest.js";
import { renderHtml, truncateAtWord } from "../../src/digest/renderHtml.js";
import { renderMarkdown } from "../../src/digest/renderMarkdown.js";
import type {
  AssessmentRun,
  CandidateAssessmentRecord,
} from "../../src/assessment/types.js";
import { ASSESSMENT_SCHEMA_VERSION } from "../../src/assessment/types.js";

function assessment(
  id: string,
  name: string,
  priority: number
): CandidateAssessmentRecord {
  return {
    schema_version: ASSESSMENT_SCHEMA_VERSION,
    candidate_id: id,
    assessment_run_id: "arun_test",
    source_candidate: {
      key: name.toLowerCase(),
      name,
      discovery_score: 1.2,
      score_breakdown: {
        builder: 0.5,
        thinker: 0,
        olympiad: 0,
        weirdness: 0,
        identity: 0.2,
      },
      discovered_via: ["linkedin:x"],
      github_url: "https://github.com/example/x",
      website_url: "https://example.com",
    },
    identity: {
      candidate_id: id,
      id_source: "github_username",
      id_raw: name,
      display_name: name,
      github_username: name.toLowerCase(),
    },
    artifacts: {
      references: [
        {
          artifact_id: "art_1",
          kind: "github_repository",
          title: `${name}/engine`,
          canonical_url: "https://github.com/example/engine",
          author_identity_confidence: 0.9,
          candidate_ownership_confidence: 0.8,
          discovered_from: "test",
          selected_reason: "technical_naming",
          collected_at: new Date().toISOString(),
        },
      ],
      github_repositories: {},
      evidence: [
        {
          evidence_id: "ev_test_1",
          artifact_id: "art_1",
          source_type: "github_file",
          source_url: "https://github.com/example/engine",
          observation: "Core module present.",
          supports_claim: "Nontrivial implementation.",
          strength: "strong",
          candidate_ownership_confidence: 0.8,
        },
      ],
    },
    judge_results: {
      technical: {
        judge_type: "technical",
        prompt_version: "technical-v1",
        model: "test",
        input_hash: "h",
        summary: "Deep systems work.",
        dimensions: [
          {
            dimension: "technical_depth",
            score: 8,
            confidence: 0.7,
            definition: "d",
            rationale: "Custom scheduling layer with tests.",
            supporting_evidence_ids: ["ev_test_1"],
            counterevidence: [],
            missing_information: [],
          },
        ],
        strongest_evidence_ids: ["ev_test_1"],
        important_uncertainties: ["Production usage unknown"],
        recommended_human_review: ["Read scheduler.ts"],
        created_at: new Date().toISOString(),
      },
    },
    synthesis: {
      archetype: "independent_systems_builder",
      archetype_assignment: {
        primary: "independent_systems_builder",
        secondary: [],
        evidence_ids: ["ev_test_1"],
        confidence_support: "moderate",
      },
      headline: `${name}: independent systems builder`,
      overall_rationale: "Strong repo evidence.",
      primary_strength: "Technical depth in core modules.",
      reason_to_review: "Inspect scheduler and benchmarks.",
      reason_for_caution: "Production usage unknown.",
      strongest_evidence_ids: ["ev_test_1"],
      important_uncertainties: ["Production usage unknown"],
      domain_scores: {
        technical: 8,
        curiosity: 6,
        ownership: 7,
        evidence_completeness: 0.7,
      },
      priority_score: priority,
      priority_confidence: 0.7,
      weight_version: "priority-v2",
    },
    digest_summary: {
      why_highlighted: [
        {
          claim: "Technical depth",
          rationale: "Custom scheduling layer.",
          evidence_ids: ["ev_test_1"],
        },
      ],
      next_review_step: "Inspect core modules.",
    },
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
}

const run: AssessmentRun = {
  schema_version: ASSESSMENT_SCHEMA_VERSION,
  id: "arun_test",
  created_at: new Date().toISOString(),
  status: "completed",
  source: {
    candidates_path: "output/candidates.json",
    candidates_file_hash: "abc",
  },
  config: {
    candidate_limit: 10,
    repository_limit: 3,
    publication_limit: 3,
    article_limit: 3,
    prompt_versions: {},
    weight_version: "priority-v1",
    mock_llm: true,
  },
  candidate_ids: [],
  errors: [],
};

describe("digest rendering", () => {
  it("orders by assessment priority and keeps discovery score separate", () => {
    const digest = buildDigest({
      run,
      assessments: [
        assessment("cand_a", "Alice", 40),
        assessment("cand_b", "Bob", 90),
      ],
      discoveredCandidateCount: 20,
      minPriority: 0,
    });
    expect(digest.candidates[0]?.name).toBe("Bob");
    expect(digest.candidates[0]?.discovery_score).toBe(1.2);
    expect(digest.candidates[0]?.assessment_priority_score).toBe(90);
    expect(digest.candidates[0]?.brief_rationale).toMatch(/engine/i);
    expect(digest.candidates[0]?.links.github).toMatch(/github/i);
  });

  it("escapes HTML and omits emails", () => {
    const digest = buildDigest({
      run,
      assessments: [
        assessment("cand_x", '<script>alert(1)</script>', 50),
      ],
      discoveredCandidateCount: 1,
      minPriority: 0,
    });
    // inject email into headline via mutation for escape test
    digest.candidates[0]!.headline = `Hello <img src=x onerror=alert(1)> contact me@secret.com`;
    const html = renderHtml(digest);
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;img");
    expect(html).not.toMatch(/mailto:/i);
    const md = renderMarkdown(digest);
    expect(md).toContain("Discovery score");
    expect(md).toContain("Assessment priority");
    expect(md).toMatch(/Profiles:/);
  });

  it("renderer does not call LLM (pure functions)", () => {
    const digest = buildDigest({
      run,
      assessments: [assessment("cand_c", "Cara", 70)],
      discoveredCandidateCount: 5,
      minPriority: 0,
    });
    expect(renderMarkdown(digest).length).toBeGreaterThan(100);
    expect(renderHtml(digest)).toContain("tSearch");
  });

  it("filters below min priority and names specific works", () => {
    const digest = buildDigest({
      run,
      assessments: [
        assessment("cand_low", "Low", 20),
        assessment("cand_high", "High", 80),
      ],
      discoveredCandidateCount: 2,
      minPriority: 50,
      topN: 5,
    });
    expect(digest.candidates.map((c) => c.name)).toEqual(["High"]);
    expect(digest.candidates[0]?.strongest_artifacts[0]?.title).toMatch(/engine/);
    expect(digest.candidates[0]?.brief_rationale).toMatch(/High/);
  });

  it("truncates card brief at a word boundary with an ellipsis", () => {
    const digest = buildDigest({
      run,
      assessments: [assessment("cand_t", "Timo", 80)],
      discoveredCandidateCount: 1,
      minPriority: 0,
    });
    digest.candidates[0]!.brief_rationale = [
      "demonstrates strong technical execution on hard systems problems",
      "with clear ownership evidence across multiple repositories",
      "and sustained iteration through careful tradeoff reasoning",
      "plus reproducible evaluation that a third party can actually run",
      "while documenting failure modes and recovery paths in the core modules",
    ].join(" ");
    expect(digest.candidates[0]!.brief_rationale!.length).toBeGreaterThan(260);
    const html = renderHtml(digest);
    expect(html).toContain("…");
    expect(html).not.toContain("technical ex<");
    expect(
      truncateAtWord(
        "demonstrates strong technical execution on hard systems",
        40
      )
    ).toBe("demonstrates strong technical execution…");
  });
});

describe("digest feedback refinement (Phase 4)", () => {
  const fb = (
    candidate_id: string,
    latest_verdict: "relevant" | "not_relevant" | "explore_network"
  ) => ({
    candidate_id,
    entries: [{ verdict: latest_verdict, at: new Date().toISOString() }],
    latest_verdict,
    updated_at: new Date().toISOString(),
  });

  it("excludes not_relevant candidates and reports the count", () => {
    const digest = buildDigest({
      run,
      assessments: [
        assessment("cand_a", "Alice", 90),
        assessment("cand_b", "Bob", 80),
      ],
      discoveredCandidateCount: 2,
      minPriority: 0,
      feedback: new Map([["cand_a", fb("cand_a", "not_relevant")]]),
    });
    expect(digest.candidates.map((c) => c.name)).toEqual(["Bob"]);
    expect(digest.meta.feedback_excluded_count).toBe(1);
  });

  it("boosts relevant candidates above higher-priority unmarked ones", () => {
    const digest = buildDigest({
      run,
      assessments: [
        assessment("cand_a", "Alice", 90),
        assessment("cand_b", "Bob", 40),
      ],
      discoveredCandidateCount: 2,
      minPriority: 0,
      feedback: new Map([["cand_b", fb("cand_b", "relevant")]]),
    });
    expect(digest.candidates[0]?.name).toBe("Bob");
    expect(digest.candidates[0]?.reviewer_feedback).toBe("relevant");
    // priority_score itself is untouched — only ordering changed
    expect(digest.candidates[0]?.assessment_priority_score).toBe(40);
    expect(digest.meta.feedback_boosted_count).toBe(1);
  });

  it("leaves ranking untouched when no feedback exists", () => {
    const digest = buildDigest({
      run,
      assessments: [
        assessment("cand_a", "Alice", 40),
        assessment("cand_b", "Bob", 90),
      ],
      discoveredCandidateCount: 2,
      minPriority: 0,
    });
    expect(digest.candidates[0]?.name).toBe("Bob");
    expect(digest.meta.feedback_excluded_count).toBeUndefined();
  });
});
