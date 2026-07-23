# tSearch Rubric and Scoring Agents Implementation

Implement the next production phase of tSearch using the live architecture documented in:

```text
docs/assessment-rubric-architecture-audit.md
```

Read that audit and inspect the current code before modifying anything.

Do not implement against the original Phase 1–2 plan when it conflicts with the live repository.

## Product objective

tSearch should identify candidates whose public projects and personal writing show evidence of:

* Strong technical ability
* Meaningful ownership of difficult work
* Independent problem selection
* Sustained iteration
* Mechanistic reasoning
* Serious investigation of unusual questions
* Cross-artifact coherence between ideas and projects
* High reviewer relevance despite incomplete or nontraditional credentials

The primary evidence sources are:

1. GitHub repositories and public technical contributions
2. Personal blogs, technical essays, and long-form writing
3. Relationships between writing, repositories, experiments, datasets, and follow-up work

Research papers remain optional enrichment. Do not build a mandatory publication-scoring pipeline.

## Non-negotiable principles

### Preserve architectural separation

Keep:

```text
Discovery
→ Assessment
→ Presentation
```

Do not overwrite `Candidate.final_score`.

Continue storing it as the discovery score.

The new assessment score must remain separately named and versioned.

### Separate distinct constructs

Never collapse these into one opaque LLM score:

* Technical artifact quality
* Candidate ownership
* Writing and intellectual depth
* Observable knowledge-seeking behavior
* Cross-artifact coherence
* Evidence completeness
* Identity confidence
* Cory relevance
* Assessment priority

### Evidence-ground every claim

Every substantive judgment must trace:

```text
Observed artifact
→ Evidence item
→ Interpretation
→ Rubric criterion
→ Dimension result
→ Counterevidence or uncertainty
→ Synthesis
→ Digest claim
```

Every judge-generated factual or interpretive claim must cite valid stored evidence IDs.

### Avoid internal-motivation claims

Allowed:

* “Evidence is consistent with sustained self-directed inquiry.”
* “The candidate returned to this question across multiple artifacts.”
* “The visible work shows repeated investigation over time.”
* “No visible formal requirement was identified.”

Disallowed:

* “The candidate is intrinsically motivated.”
* “They did this purely from passion.”
* “They are naturally curious.”
* “They are a genius.”

### Missing evidence is not negative ability evidence

Use:

```text
insufficient_public_evidence
```

Do not convert missing blogs, private repositories, sparse commit history, unavailable full text, or uncertain identity into a negative capability judgment.

# Product decisions already resolved

Implement these decisions without asking for clarification.

## Assessment output

Keep a single `assessment_priority_score` for ranking, but also expose the underlying axes.

The priority score is a reviewer-routing score, not a universal measure of talent.

Persist:

```ts
interface AssessmentAxes {
  technical_strength?: AxisResult;
  ownership_support?: AxisResult;
  writing_intellectual_depth?: AxisResult;
  observable_inquiry?: AxisResult;
  cross_artifact_coherence?: AxisResult;
  evidence_completeness: AxisResult;
  cory_relevance?: AxisResult;
}
```

## Blog absence

GitHub-only candidates remain first-class.

Do not impose a direct penalty for having no public blog.

Missing writing evidence means:

```text
writing_intellectual_depth = unavailable
```

not:

```text
writing_intellectual_depth = 0
```

Blog evidence can increase confidence and cross-artifact support, but its absence must not erase strong technical evidence.

## Archetypes

Move from one mutually exclusive archetype to:

```ts
interface ArchetypeAssignment {
  primary: Archetype;
  secondary: Archetype[];
  evidence_ids: string[];
  confidence_support: "high" | "moderate" | "low";
}
```

The digest may display one primary archetype and up to two secondary tags.

## Candidate-authorship wording

The digest may say “candidate-authored core implementation” only when all are true:

```text
identity support = exact or high
direct core-contribution evidence = true
ownership support = high
evidence coverage = medium or high
no unresolved imported/generated-code conflict
```

Otherwise use qualified wording such as:

* “Public evidence supports substantial contribution.”
* “The candidate appears to have contributed to central implementation.”
* “Ownership is plausible but not fully verifiable.”
* “The visible evidence is insufficient to assign central authorship.”

## Digest identity and immutability

Completed assessment records remain immutable.

Generate deterministic digest IDs from:

```text
assessment_run_id
+ digest_schema_version
+ ordered assessment content hashes
+ rubric bundle version
+ priority weight version
```

Do not derive digest identity from the current hour.

Regenerating the same digest inputs must produce the same digest ID and semantically identical output.

# Implementation order

Complete the work in the phases below.

Do not begin blog or synthesis implementation until Phase A tests pass.

# Phase A: Repair blocking Phase 2 defects

## A1. Fix ownership evidence collection

Current defects include:

* `total_commits_sampled` is effectively the number of candidate commits
* Contribution share therefore approaches `1.0`
* `central_files_authored` currently means selected central files, not files proven to have been authored by the candidate
* Synthesis uses the first repository ownership result rather than an intentional aggregate

Rewrite:

```text
src/assessment/github/collectOwnershipEvidence.ts
```

and the relevant parts of:

```text
src/assessment/github/collectRepositoryArtifact.ts
src/assessment/scoring/archetypes.ts
src/assessment/types.ts
```

## Ownership evidence model

Add:

```ts
type OwnershipSupportClass =
  | "high_ownership_support"
  | "medium_ownership_support"
  | "low_ownership_support"
  | "insufficient_public_evidence";

type EvidenceCoverage =
  | "high"
  | "medium"
  | "low";

interface OwnershipAssessmentV2 {
  schema_version: "ownership-v2";

  support_class: OwnershipSupportClass;
  evidence_coverage: EvidenceCoverage;

  identity_support:
    | "exact"
    | "high"
    | "medium"
    | "low";

  direct_core_contribution_present: boolean;

  contribution_metrics: {
    candidate_commit_count?: number;
    repository_commit_count_sampled?: number;
    candidate_commit_share?: number;

    candidate_pr_count?: number;
    candidate_merged_pr_count?: number;

    candidate_core_file_change_count?: number;
    candidate_core_file_paths?: string[];

    active_weeks?: number;
    contribution_span_days?: number;
  };

  responsibility_signals: Array<{
    type:
      | "review_activity"
      | "release_participation"
      | "codeowners"
      | "maintainer_role"
      | "explicit_contribution_statement";
    evidence_ids: string[];
  }>;

  continuity_signals: Array<{
    type:
      | "active_weeks"
      | "long_contribution_span"
      | "repeat_external_contribution"
      | "post_release_maintenance";
    evidence_ids: string[];
  }>;

  provenance_risks: Array<{
    type:
      | "fork"
      | "template"
      | "imported_history"
      | "generated_code"
      | "vendored_code"
      | "course_assignment"
      | "uncertain_repository_origin";
    severity: "low" | "moderate" | "high";
    evidence_ids: string[];
  }>;

  identity_risks: string[];
  supporting_evidence_ids: string[];
  counterevidence_ids: string[];
  missing_information: string[];
  summary: string;
}
```

## Ownership classification rules

Use hard gates rather than a flat positive-point count.

### Gate 1: Identity

If identity support is `low`, return:

```text
insufficient_public_evidence
```

### Gate 2: Observable contribution

If there are no attributable commits, PRs, contribution statements, release actions, review actions, or CODEOWNERS evidence, return:

```text
insufficient_public_evidence
```

### Gate 3: Direct core contribution

`high_ownership_support` requires direct evidence of central technical contribution.

Acceptable evidence includes:

* Candidate-authored PRs affecting selected central files
* Candidate commits with changed-file details affecting central files
* Reliable blame or line-attribution evidence for central files
* Explicit contribution statements assigning core software or methodology work
* Candidate-created repository plus sustained candidate-authored central implementation

Repository ownership alone is not sufficient.

Creating the repository, review activity, releases, or CODEOWNERS may strengthen ownership but cannot replace core-contribution evidence.

### Gate 4: Provenance caps

Cap at `medium_ownership_support` when:

* Repository history strongly predates candidate involvement
* Imported history is unresolved
* Generated or vendored code dominates candidate-attributed changes
* Identity completeness is only medium
* Squash merges prevent reliable attribution
* Repository appears to be a course scaffold or tutorial with uncertain original contribution

### Aggregate ownership

Replace first-repository ownership selection with an intentional candidate-level aggregation.

Candidate-level ownership should prioritize:

1. Highest-quality repository with direct core-contribution evidence
2. Repeated meaningful contribution across repositories
3. Consistency between repository ownership and external PR evidence

Do not average ownership scores blindly.

Persist both repository-level and candidate-level ownership results.

## A2. Fix live repository selection

Current live execution does not pass repository details into `selectRepositories`.

Update the live path in:

```text
src/assessment/runAssessment.ts
```

so repository selection has access to:

* Fork status
* Template status
* Archived status
* Repository size
* Created date
* Pushed date
* Description
* Topics
* Primary language
* Candidate relationship to repository
* Available commit or PR evidence

Avoid fetching full repository details twice.

Create a lightweight metadata collection or reuse a safely cached response.

The selector must not rank primarily by:

* Stars
* Forks
* Followers
* Repository size
* README polish

It should be capable of selecting:

* An unpopular but technically deep repository
* A meaningful external contribution
* A long-running unusual project
* A repository with weak marketing but strong code
* A research or scientific software project
* A technically meaningful small repository

## A3. Revalidate judge cache entries

Modify:

```text
src/assessment/judges/llmClient.ts
src/assessment/storage/artifactCache.ts
src/assessment/storage/judgeCache.ts
```

Every cached judge response must be validated against the current output schema before use.

Cache identity must include:

```text
model
system prompt hash
user payload hash
judge schema version
rubric bundle version
judge implementation version
```

If cached data fails validation:

1. Mark it invalid
2. Do not crash the full run
3. Regenerate the response
4. Replace the invalid cache entry atomically
5. Log a structured cache invalidation event

## A4. Add interrupted-run resume semantics

Long multi-judge runs must resume safely.

Add options:

```text
--resume <run-id>
--retry-errors
--force-candidate <candidate-id>
```

Rules:

* Completed candidate records are skipped by default
* Candidate records with errors may be retried with `--retry-errors`
* A specific candidate may be regenerated with `--force-candidate`
* Completed runs remain immutable
* Incomplete runs may transition back into processing
* Run configuration compatibility must be checked before resume
* Do not resume into a run created with incompatible rubric, schema, prompt, or weight versions unless explicitly forced into a new run

Add tests for interruption after:

* Artifact collection
* First candidate completion
* Judge failure
* Digest failure
* Rate-limit failure

# Phase B: Versioned rubric system

Create:

```text
rubrics/
  ownership-v2.yaml
  technical-repository-v2.yaml
  blog-intellectual-depth-v1.yaml
  cross-artifact-inquiry-v1.yaml
  cory-relevance-v1.yaml
  rubric-bundle-v1.yaml
```

## Rubric loader

Create:

```text
src/assessment/rubrics/types.ts
src/assessment/rubrics/loadRubric.ts
src/assessment/rubrics/loadRubricBundle.ts
src/assessment/rubrics/validateRubric.ts
```

Use Zod validation.

Every rubric must include:

```ts
interface RubricDefinition {
  rubric_id: string;
  version: string;
  construct: string;
  description: string;

  dimensions: RubricDimension[];

  prohibited_inferences: string[];
  confidence_caps: ConfidenceCapRule[];
  abstention_rules: AbstentionRule[];
  evidence_requirements: EvidenceRequirement[];

  source_notes: Array<{
    statement: string;
    status:
      | "empirically_supported"
      | "platform_constraint"
      | "provisional_product_rule"
      | "requires_calibration";
  }>;
}
```

Every dimension must include:

```ts
interface RubricDimension {
  dimension_id: string;
  description: string;
  applicable_artifacts: string[];

  anchors: Array<{
    score: 0 | 1 | 2 | 3 | 4 | 5;
    description: string;
  }>;

  strong_evidence_examples: string[];
  weak_evidence_examples: string[];
  counterevidence_examples: string[];
  prohibited_shortcuts: string[];
}
```

Persist on every run:

```text
rubric_bundle_id
rubric_bundle_version
rubric_file_hashes
```

Include the rubric bundle hash in judge-cache keys.

# Phase C: Technical repository assessment v2

Replace the current embedded technical rubric with the versioned rubric.

Do not remove the existing judge until migration tests pass.

Create:

```text
src/assessment/judges/technicalJudgeV2.ts
src/assessment/judges/prompts/buildTechnicalPrompt.ts
src/assessment/judges/schemas/technicalJudgeSchema.ts
```

## Technical dimensions

Use these dimensions:

```text
problem_difficulty
mechanism_depth
architecture_depth
algorithmic_or_methodological_depth
implementation_quality
evaluation_and_validation
failure_handling
reproducibility
tradeoff_reasoning
completion_and_operational_reality
persistence_and_iteration
unusual_problem_selection
```

Remove `candidate_ownership` from the technical-quality dimensions.

Ownership is already a separate construct.

## Technical judge output

```ts
interface TechnicalJudgeResultV2 {
  schema_version: "technical-judge-v2";
  judge_type: "technical";

  artifact_ids: string[];
  rubric_id: string;
  rubric_version: string;
  prompt_version: string;
  model: string;

  artifact_reconstruction: {
    problem: string;
    claimed_mechanism: string;
    visible_architecture: string;
    validation_approach: string;
    unresolved_questions: string[];
    evidence_ids: string[];
  };

  dimensions: DimensionAssessmentV2[];

  strongest_evidence_ids: string[];
  counterevidence_ids: string[];
  unsupported_or_unverifiable_claims: string[];
  missing_information: string[];

  overall_technical_strength:
    | "exceptional"
    | "strong"
    | "moderate"
    | "limited"
    | "insufficient_public_evidence";

  evidence_support:
    | "high"
    | "moderate"
    | "low";

  summary: string;
}
```

## Dimension result

```ts
interface DimensionAssessmentV2 {
  dimension_id: string;
  score: 0 | 1 | 2 | 3 | 4 | 5 | null;

  applicability:
    | "applicable"
    | "not_applicable"
    | "insufficient_evidence";

  rationale: string;
  supporting_evidence_ids: string[];
  counterevidence_ids: string[];
  missing_information: string[];
}
```

Do not force a score when evidence is insufficient.

## Originality handling

Do not let the LLM claim broad originality from repository appearance alone.

Create deterministic provenance flags first:

```text
fork
template
known tutorial structure
generated paths
vendored paths
framework scaffold
repository ancestry
copied license or attribution markers
```

The judge may assess:

```text
visible originality of problem framing or implementation choices
```

It may not claim:

```text
globally novel
first of its kind
unprecedented
```

without comparison evidence.

# Phase D: Expand GitHub evidence required by ownership and technical rubrics

Enhance the existing REST collector before adding unnecessary GraphQL complexity.

Create or expand modules for:

```text
src/assessment/github/githubClient.ts
src/assessment/github/rateLimitManager.ts
src/assessment/github/collectCommitEvidence.ts
src/assessment/github/collectPullRequestEvidence.ts
src/assessment/github/collectReviewEvidence.ts
src/assessment/github/collectRepositoryOperations.ts
src/assessment/github/detectRepositoryProvenance.ts
src/assessment/github/githubIdentityMap.ts
```

## Required signals

Implement bounded collection for:

* Commit changed files
* Pull request details
* Pull request changed files
* Pull request commits
* Reviews
* Review comments
* Contributors
* Releases
* Tags
* Workflow files
* Workflow runs linked to candidate PRs or commits
* CODEOWNERS
* External repository contributions
* Contribution continuity
* Candidate identity stitching

Issues and deployments may be implemented only when useful for the rubric. Do not collect them merely because the API exists.

## Scope metadata

Every GitHub evidence item must include:

```ts
type EvidenceScope =
  | "candidate_global_observable"
  | "repository_local"
  | "selected_artifact_only"
  | "derived_partial";
```

## GitHub identity map

Add a candidate-level identity map without changing existing stable candidate IDs.

```ts
interface GitHubIdentityMap {
  candidate_id: string;
  canonical_login: string;
  github_node_id?: string;
  historical_logins: string[];

  commit_identities: Array<{
    login?: string;
    name?: string;
    normalized_email_hash?: string;

    match_class:
      | "verified_login"
      | "verified_email"
      | "strong_cross_link"
      | "name_only"
      | "rejected";

    evidence_ids: string[];
  }>;

  excluded_bot_logins: string[];

  identity_support:
    | "exact"
    | "high"
    | "medium"
    | "low";

  identity_risks: string[];
}
```

Name-only matches must never assign contribution ownership.

## Tree handling

Check GitHub’s `truncated` field.

When recursive trees are truncated:

1. Record the truncation
2. Fetch important top-level source subtrees selectively
3. Record collection coverage
4. Cap evidence support when central code coverage remains poor

## Rate limits

Track:

```text
x-ratelimit-limit
x-ratelimit-remaining
x-ratelimit-used
x-ratelimit-reset
x-ratelimit-resource
retry-after
```

Maintain separate runtime budgets for:

```text
core
search
code_search
graphql
```

Even if GraphQL is not yet used, keep the data model compatible.

Respect `Retry-After`.

Do not convert every rate-limit event into total candidate failure when previously collected evidence remains usable.

Persist a coverage warning.

# Phase E: Generalize artifacts and evidence

The current system is too GitHub-specific for blogs and relationships.

Extend, do not destructively replace, the persisted model.

## Artifact references

```ts
type ArtifactKind =
  | "github_repository"
  | "github_pull_request"
  | "github_release"
  | "personal_blog"
  | "blog_article"
  | "technical_essay"
  | "notebook"
  | "dataset"
  | "demo"
  | "research_publication";

interface ArtifactReferenceV2 {
  artifact_id: string;
  kind: ArtifactKind;
  title: string;
  canonical_url?: string;
  candidate_relationship:
    | "owner"
    | "author"
    | "contributor"
    | "maintainer"
    | "linked"
    | "uncertain";

  collected_at: string;
  content_hash?: string;
  source_version?: string;

  identity_support:
    | "exact"
    | "high"
    | "medium"
    | "low";

  metadata: Record<string, unknown>;
}
```

## Evidence items

Extend `EvidenceItem`:

```ts
interface EvidenceItemV2 {
  evidence_id: string;
  artifact_id: string;

  source_type: string;
  scope: EvidenceScope;

  observation_type:
    | "deterministic_observation"
    | "model_interpretation"
    | "human_annotation";

  strength:
    | "strong"
    | "moderate"
    | "weak";

  summary: string;
  excerpt?: string;

  locator?: {
    url?: string;
    file_path?: string;
    commit_sha?: string;
    pull_request_number?: number;
    article_section?: string;
    line_start?: number;
    line_end?: number;
  };

  collected_by: string;
  collected_at: string;
  provenance: Record<string, unknown>;
}
```

Evidence IDs must remain deterministic for identical source material and locators.

# Phase F: Personal blog collection

Create:

```text
src/assessment/blog/types.ts
src/assessment/blog/schemas.ts
src/assessment/blog/blogClient.ts
src/assessment/blog/discoverBlog.ts
src/assessment/blog/fetchRobots.ts
src/assessment/blog/fetchFeeds.ts
src/assessment/blog/fetchSitemaps.ts
src/assessment/blog/canonicalizeUrl.ts
src/assessment/blog/extractArticle.ts
src/assessment/blog/extractCitations.ts
src/assessment/blog/detectRevisions.ts
src/assessment/blog/buildTopicClusters.ts
src/assessment/blog/selectArticles.ts
src/assessment/blog/collectBlogArtifacts.ts
```

Reuse:

* Artifact cache
* Evidence store
* Candidate error isolation
* Run persistence
* LLM client
* Judge cache

Do not reuse GitHub-specific payload types.

## Collection flow

```text
Candidate website
→ canonical domain
→ robots.txt
→ feeds
→ sitemaps
→ blog index discovery
→ article canonicalization
→ article extraction
→ citation extraction
→ revision detection
→ topic clustering
→ deterministic article selection
```

## Crawl rules

* Respect robots exclusions
* Use a clear tSearch user agent
* Stay within the canonical domain unless the site explicitly declares an external blog
* Bound redirects
* Back off on `429` and `5xx`
* Bound pages per domain
* Bound JavaScript-rendered fallbacks
* Store paywalled or inaccessible articles as metadata-only
* Do not downrank non-English writing solely due to language
* Do not bypass authentication or paywalls

## Default crawl budgets

Set configurable provisional limits:

```text
maximum feed entries inspected: 100
maximum sitemap URLs inspected: 500
maximum candidate article pages fetched: 40
maximum selected articles judged: 5
maximum redirects: 5
maximum article text characters: 60,000
maximum PDF size: 15 MB
maximum browser-rendered pages: 5
maximum consecutive server errors: 3
```

Classify these as:

```text
provisional_product_rule
```

## Blog schemas

```ts
interface BlogCorpus {
  corpus_id: string;
  candidate_id: string;
  canonical_domain: string;

  discovery_sources: string[];
  article_ids: string[];
  selected_article_ids: string[];

  topic_clusters: TopicCluster[];
  series: ArticleSeries[];

  coverage: {
    discovered_article_count: number;
    extracted_article_count: number;
    full_text_count: number;
    metadata_only_count: number;
    earliest_date?: string;
    latest_date?: string;
  };

  collection_warnings: string[];
}
```

```ts
interface BlogArticle {
  article_id: string;
  artifact_id: string;
  canonical_url: string;
  title: string;

  author_text?: string;
  language?: string;

  published_at?: string;
  modified_at?: string;
  date_support:
    | "high"
    | "moderate"
    | "low";

  extraction_method:
    | "feed"
    | "readability"
    | "site_selector"
    | "json_ld"
    | "pdf"
    | "browser_rendered"
    | "metadata_only";

  content_hash?: string;
  sections: ArticleSection[];
  citations: CitationReference[];
  revision_markers: RevisionMarker[];
  original_analysis_artifacts: OriginalAnalysisArtifact[];

  internal_links: string[];
  external_links: string[];

  collection_warnings: string[];
}
```

## Deterministic versus interpreted signals

Store deterministic facts separately from judge interpretations.

Examples:

Deterministic:

* Article contains a “Limitations” heading
* Article links to a GitHub repository
* Article contains a DOI
* Article was updated three months later
* Article includes an original figure
* Candidate returned to a topic across four dated posts

Interpreted:

* Limitations are substantively evaluated
* Sources are integrated rather than listed
* The article demonstrates mechanistic reasoning
* The update reflects meaningful belief revision
* The linked repository tests the article’s thesis

# Phase G: Blog and intellectual-depth judge

Create:

```text
src/assessment/judges/writingJudge.ts
src/assessment/judges/prompts/buildWritingPrompt.ts
src/assessment/judges/schemas/writingJudgeSchema.ts
```

## Blog dimensions

Use:

```text
question_quality
research_depth
source_quality_and_integration
reasoning_rigor
mechanistic_explanation
original_analysis
cross_domain_synthesis
intellectual_honesty
uncertainty_and_limitations
observable_self_directed_inquiry
topic_persistence
clarity
```

Do not score:

* Article length
* Vocabulary complexity
* Citation count by itself
* Visual polish
* Academic tone
* Prestige of sources without examining relevance
* Number of posts by itself

## Writing judge output

```ts
interface WritingJudgeResult {
  schema_version: "writing-judge-v1";
  judge_type: "writing";

  artifact_ids: string[];
  rubric_id: string;
  rubric_version: string;
  prompt_version: string;
  model: string;

  corpus_reconstruction: {
    recurring_questions: Array<{
      question: string;
      artifact_ids: string[];
      evidence_ids: string[];
    }>;

    observable_trajectory: string;
    explicit_revisions: string[];
    original_analysis_artifacts: string[];
    evidence_ids: string[];
  };

  dimensions: DimensionAssessmentV2[];

  strongest_evidence_ids: string[];
  counterevidence_ids: string[];
  missing_information: string[];

  overall_writing_depth:
    | "exceptional"
    | "strong"
    | "moderate"
    | "limited"
    | "insufficient_public_evidence";

  evidence_support:
    | "high"
    | "moderate"
    | "low";

  summary: string;
}
```

Judge at both levels:

1. Article-level reasoning
2. Corpus-level trajectory

Do not infer a stable personality trait from one article.

# Phase H: Artifact relationships

Create:

```text
src/assessment/relationships/types.ts
src/assessment/relationships/schemas.ts
src/assessment/relationships/extractDeterministicLinks.ts
src/assessment/relationships/inferRelationships.ts
src/assessment/relationships/validateRelationships.ts
```

## Relationship schema

```ts
interface ArtifactRelationship {
  relationship_id: string;
  source_artifact_id: string;
  target_artifact_id: string;

  relationship_type:
    | "article_links_repository"
    | "repository_links_article"
    | "repository_supports_article"
    | "article_documents_project"
    | "article_revises_prior_article"
    | "shared_topic"
    | "follow_up_artifact"
    | "explicitly_cited"
    | "derived_from"
    | "inferred_connection";

  deterministic: boolean;

  confidence_support:
    | "high"
    | "moderate"
    | "low";

  evidence_ids: string[];
  explanation?: string;
}
```

Deterministic relationships should be extracted before LLM inference.

Examples:

* Exact repository URL in article
* Exact blog URL in README
* Shared canonical project URL
* Article explicitly names repository
* README explicitly links article
* Follow-up post links earlier post

LLM-inferred relationships must never be stored as deterministic.

# Phase I: Cross-artifact inquiry judge

Create:

```text
src/assessment/judges/crossArtifactJudge.ts
src/assessment/judges/prompts/buildCrossArtifactPrompt.ts
src/assessment/judges/schemas/crossArtifactJudgeSchema.ts
```

This judge evaluates patterns across artifacts.

It must not rescore technical implementation quality or writing quality.

## Cross-artifact dimensions

```text
question_to_artifact_translation
idea_project_alignment
iteration_across_artifacts
evidence_of_belief_updating
cross_domain_connection_quality
sustained_inquiry
experiment_and_feedback_loop
coherence_without_redundancy
```

## Required distinctions

Strong pattern:

```text
Article identifies a technical question
→ repository implements an experiment
→ follow-up article discusses results and limitations
```

Weak pattern:

```text
Candidate has unrelated repositories and unrelated essays
```

Do not reward mere thematic keyword overlap.

## Output

```ts
interface CrossArtifactJudgeResult {
  schema_version: "cross-artifact-judge-v1";
  judge_type: "cross_artifact";

  relationship_ids: string[];
  artifact_ids: string[];

  reconstructed_inquiry_threads: Array<{
    thread_id: string;
    question_or_theme: string;
    ordered_artifact_ids: string[];
    relationship_ids: string[];
    evidence_ids: string[];
    interpretation: string;
    counterevidence: string[];
  }>;

  dimensions: DimensionAssessmentV2[];

  overall_inquiry_support:
    | "exceptional"
    | "strong"
    | "moderate"
    | "limited"
    | "insufficient_public_evidence";

  evidence_support:
    | "high"
    | "moderate"
    | "low";

  strongest_evidence_ids: string[];
  counterevidence_ids: string[];
  missing_information: string[];
  summary: string;
}
```

# Phase J: Cory relevance

Cory relevance is a reviewer-specific routing label.

It must remain separate from general technical or intellectual quality.

Create:

```text
rubrics/cory-relevance-v1.yaml
src/assessment/judges/coryRelevanceJudge.ts
src/assessment/judges/schemas/coryRelevanceSchema.ts
```

Initially use a transparent rule-plus-judge hybrid.

Inputs may include:

* Technical strength
* Ownership support
* Writing depth
* Cross-artifact inquiry support
* Unusual problem selection
* Evidence completeness
* Candidate stage
* Sparse-evidence upside
* Current Cory calibration weights

Do not train a complex preference model yet.

Persist:

```ts
interface CoryRelevanceResult {
  relevance:
    | "high"
    | "medium"
    | "low"
    | "insufficient_evidence";

  reasons: string[];
  evidence_ids: string[];
  calibration_version: string;
  human_review_recommended: boolean;
}
```

# Phase K: Candidate synthesis and scoring v2

Replace:

```text
synthesizeFromTechnical
```

with:

```text
synthesizeCandidate
```

Create:

```text
src/assessment/scoring/synthesizeCandidate.ts
```

Keep a compatibility adapter while migrating existing tests.

## Do not use one opaque weighted average

Persist the axis results separately.

Then calculate a reviewer-routing priority.

## Priority v2 inputs

Use:

* Technical strength
* Ownership support
* Writing depth when available
* Cross-artifact inquiry when available
* Unusual problem selection
* Persistence and iteration
* Evidence completeness
* Cory relevance
* Identity risk
* High-potential sparse-evidence flag

## Missing domains

Do not zero missing writing or cross-artifact domains.

Redistribute only within documented limits.

Do not let the absence of a blog increase another score so aggressively that GitHub-only candidates become artificially inflated.

## Suggested initial formula

All normalized inputs are `0..1`.

```text
technical_component          0.30
ownership_component          0.15
writing_component            0.10
cross_artifact_component     0.15
unusual_selection_component  0.08
persistence_component        0.07
cory_relevance_component     0.10
evidence_completeness        0.05
```

Rules:

1. If writing is unavailable, move at most half of its weight into technical and persistence.
2. If cross-artifact evidence is unavailable because only one artifact type exists, move at most half of its weight into technical and ownership.
3. Unused weight must not automatically be fully redistributed.
4. Apply identity and evidence-support caps after the base calculation.
5. Preserve a `high_potential_weakly_verified` route for candidates with strong visible artifacts but low coverage.
6. Version the formula as `priority-v2`.
7. Mark all weights as `requires_calibration`.

## Confidence and evidence support

Do not use an LLM-provided floating-point confidence as the final confidence.

Compute deterministic evidence support from:

```text
identity support
artifact coverage
core-file coverage
full-text coverage
direct ownership evidence
number of independent supporting evidence items
counterevidence count
judge agreement
schema validation
collection warnings
```

Store:

```ts
interface EvidenceSupportResult {
  level: "high" | "moderate" | "low";
  reasons: string[];
  caps_applied: string[];
}
```

# Phase L: Archetypes v2

Support:

```text
independent_systems_builder
cross_domain_knowledge_seeker
unusual_experimentalist
deep_technical_writer
research_first_technical_investigator
high_potential_weakly_verified
polished_profile_limited_artifact_depth
insufficient_evidence
```

Use multi-label rules.

Examples:

## Independent systems builder

Requires:

* Strong technical support
* Medium or high ownership support
* Visible architectural or implementation depth

## Cross-domain knowledge seeker

Requires:

* Strong writing or cross-artifact evidence
* Meaningful cross-domain connection
* More than superficial keyword overlap

## Unusual experimentalist

Requires:

* High unusual-problem score
* Visible implementation or experimentation
* At least moderate completion or iteration evidence

## Deep technical writer

Requires:

* Strong writing depth
* Mechanistic explanation
* Source integration or original analysis

## High-potential weakly verified

Requires:

* Strong signal on at least one primary axis
* Low evidence coverage or ownership uncertainty
* No strong counterevidence of shallow work

## Polished profile with limited artifact depth

Requires:

* Strong presentation or documentation
* Limited central technical or analytical evidence
* Do not infer this from a polished README alone

# Phase M: Digest v2

Update:

```text
src/digest/types.ts
src/digest/buildDigest.ts
src/digest/renderMarkdown.ts
src/digest/renderHtml.ts
```

Render only persisted assessment data.

Never call GitHub or an LLM during rendering.

## Candidate digest card

Include:

```text
Name
Primary archetype
Secondary archetypes
Assessment priority
Discovery score
Technical strength
Ownership support
Writing depth
Cross-artifact inquiry
Evidence support
Why highlighted
Strongest artifacts
Inquiry threads
Important uncertainties
Why the assessment may be wrong
Recommended human review action
```

## Evidence links

Every major digest claim must include resolvable evidence IDs.

Before rendering, validate:

* Evidence ID exists
* Referenced artifact exists
* URL is safe
* Claim is compatible with evidence scope
* Candidate-authorship wording passes ownership thresholds

Do not render unsupported `why_highlighted` claims.

## Version footer

Include:

```text
assessment run ID
assessment schema version
rubric bundle version
priority weight version
judge prompt versions
generated digest ID
```

# Phase N: Optional paper enrichment only

Do not implement deep paper scoring.

Keep or add only lightweight optional relationships:

```text
DOI
ORCID
paper title
candidate identity support
explicit contribution statement
linked repository
linked dataset
linked personal article
open-access URL
```

Trigger enrichment only when:

* Candidate website directly lists the paper
* A blog post links the paper
* A repository links the paper
* A contribution statement may clarify ownership
* Candidate appears primarily research-oriented with sparse public code

Do not include publication count, venue prestige, or citation count in assessment priority.

# Phase O: Tests

All new tests must be offline and fixture-based.

Create test coverage for:

## Blocker repairs

* Ownership denominator uses repository-level denominator
* Candidate commit share is not always `1.0`
* Selected central files are not treated as authored without changed-file evidence
* Repository owner with scaffold-only work cannot receive high ownership
* Live selection receives metadata
* Fork and archived penalties operate on live path
* Judge cache is revalidated
* Invalid cached schema regenerates
* Interrupted runs resume candidate-by-candidate

## Technical rubric

* Not-applicable dimensions remain null
* Sparse evidence causes abstention
* High scores require strong evidence
* Ownership is not duplicated in technical scoring
* Originality cannot be claimed globally
* Counterevidence persists

## Blog collector

* Robots exclusions
* Redirect bounds
* RSS discovery
* Sitemap discovery
* Canonical URL deduplication
* Metadata-only paywall handling
* Article extraction fallback
* Revision detection
* DOI extraction
* Internal-link graph
* Non-English preservation
* Crawl budget enforcement

## Writing judge

* Citation count alone does not raise score
* Long article alone does not raise score
* “Limitations” heading alone does not prove intellectual honesty
* Strong source integration receives support
* Belief revision requires explicit evidence
* One article cannot establish corpus persistence

## Relationships

* Exact repo link creates deterministic relationship
* Keyword similarity alone does not create high-confidence relationship
* Inferred relationships are marked nondeterministic
* Missing artifact IDs are rejected

## Cross-artifact judge

* Blog → repo → follow-up sequence scores higher than unrelated artifacts
* Unrelated same-topic artifacts do not imply a coherent inquiry thread
* Sparse cross-artifact evidence abstains
* Relationship evidence IDs are validated

## Priority v2

* GitHub-only candidate remains first-class
* Missing blog does not equal zero
* Missing blog does not lead to unlimited weight redistribution
* High technical but weak ownership remains qualified
* Strong blog but no technical artifacts does not become an independent systems builder
* Sparse but strong evidence can become high-potential weakly verified
* Identity risk applies caps

## Digest

* Deterministic digest ID
* No GitHub calls
* No LLM calls
* Every major claim has valid evidence IDs
* Candidate-authorship language is gated
* PII exclusion
* HTML escaping
* Version footer
* Same inputs generate same output

# Phase P: Migration and compatibility

Do not invalidate existing completed runs.

Support reading existing Phase 2 records as:

```text
legacy assessment schema
```

Add a compatibility normalization layer for digest regeneration.

Do not rewrite historical assessment JSON files.

New runs should use new schema versions.

Recommended versions:

```text
assessment-record-v2
ownership-v2
technical-judge-v2
writing-judge-v1
cross-artifact-judge-v1
priority-v2
digest-v2
rubric-bundle-v1
```

# Required implementation sequence

Use this order:

1. Run current typecheck and tests
2. Add failing regression tests for the four blockers
3. Fix Phase A blockers
4. Add rubric loader and bundle versioning
5. Implement technical judge v2
6. Expand GitHub evidence needed for ownership and technical judging
7. Generalize artifact and evidence types
8. Implement blog collector
9. Implement writing judge
10. Implement artifact relationships
11. Implement cross-artifact judge
12. Implement Cory relevance
13. Implement synthesis and priority v2
14. Implement multi-label archetypes
15. Implement digest v2
16. Add compatibility reader for legacy runs
17. Run full test and typecheck suite
18. Produce a fixture-generated sample digest
19. Document the artifact-to-evidence-to-score chain
20. Stop without sending email or running live candidate assessment

# Required commands

Run:

```text
npm run typecheck
npm run test:assessment
npm test
```

Run any new offline assessment fixture command you add.

Do not run:

```text
npm run digest:send
```

Do not run live assessment against real candidates unless explicitly instructed later.

# Required final report

Create:

```text
docs/rubric-agents-implementation-report.md
```

Include:

## 1. Summary

What was implemented and what remains optional.

## 2. Files changed

Group by:

* Blocker repairs
* Rubrics
* GitHub evidence
* Blog collection
* Judges
* Relationships
* Scoring
* Archetypes
* Digest
* Tests
* Migration

## 3. Architecture diagram

Show the final flow:

```text
Discovery
→ candidate selection
→ GitHub collection
→ blog collection
→ evidence store
→ ownership judge
→ technical judge
→ writing judge
→ artifact relationships
→ cross-artifact judge
→ Cory relevance
→ synthesis
→ priority v2
→ persisted assessment
→ digest v2
```

## 4. Persisted schemas

List all schema versions.

## 5. Scoring formula

Show the exact implemented formula and missing-domain handling.

## 6. Evidence lineage

Show one fixture chain:

```text
repository or article
→ evidence item
→ dimension
→ axis
→ synthesis
→ priority
→ digest
```

## 7. Blocker verification

Show how each of the four audited blockers was fixed.

## 8. Test results

Include commands, passing counts, failures, and skipped tests.

## 9. Sample fixture output

Include a sanitized digest summary for:

* Deep independent builder
* Strong technical contributor with uncertain ownership
* Deep writer with limited code
* Cross-artifact investigator
* Polished but shallow candidate
* High-potential weakly verified candidate
* Insufficient evidence candidate

## 10. Known limitations

Be explicit about:

* Public-artifact availability bias
* Private repository blindness
* Git identity gaps
* Blog authorship uncertainty
* LLM interpretation limits
* Uncalibrated Cory weights
* Optional paper enrichment not implemented

## 11. Git diff summary

Confirm no email was sent and no live candidate assessment was run.

# Completion criteria

The implementation is complete only when:

* All four audit blockers are fixed
* Rubrics are external and versioned
* Technical ownership is separated from artifact quality
* Blog collection works from offline fixtures
* Writing and cross-artifact judges use validated schemas
* Missing blogs do not become zero scores
* Priority v2 exposes underlying axes
* Archetypes support primary and secondary labels
* Digest claims are evidence-valid
* Digest IDs are deterministic
* Legacy completed runs remain readable
* Typecheck passes
* All offline tests pass
* No live email is sent
* No live candidate assessment is executed
