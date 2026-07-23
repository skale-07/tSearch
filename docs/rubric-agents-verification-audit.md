# Rubric Agents Post-Implementation Verification Audit

**Date:** 2026-07-21  
**Authority:** Live code call graphs and offline tests only.  
**Implementation report under review:** `docs/rubric-agents-implementation-report.md`  
**Constraint:** No production code changes. No live assessment. No email send.

## Verdict (short)

The implementation report overstates wiring. The live `assess:candidates` path is a **GitHub-centric Phase-A/K/M slice**: selection metadata → repo collect → ownership-v2 → technical judge **v1** (LLM or deterministic) → **deterministic** technical v2 for axes → `synthesizeCandidate` / priority-v2 → assessment-record-v2 → digest-v2.

Blog collection, writing / cross-artifact / Cory judges, relationship extraction, rubric YAML loading, technical judge **v2 LLM**, Phase-D GitHub helpers, and legacy normalization are **implemented as modules/tests but not invoked from `runAssessment`**.

---

## 1. Orchestration

### Entry path

```text
npm run assess:candidates
→ scripts/assessCandidates.ts
→ runAssessment(opts)                    [src/assessment/runAssessment.ts]
→ for each selected candidate: assessOne()
→ writeCandidateAssessment()
→ (unless --skip-digest) renderDigestForRun()
     → buildDigest → renderMarkdown → renderHtml → persist
```

`scripts/assessCandidates.ts` defaults `mockLlm: true` when `OPENAI_API_KEY` is absent, or when `--mock` / `ASSESSMENT_MOCK_LLM=1`.

### Per-candidate live call path (`assessOne`)

| Step | Function | Branch conditions |
| ---- | -------- | ----------------- |
| Identity | requires `selected.identity.github_username` | Else throws `NO_GITHUB` → error record |
| Selection metadata | `collectRepositorySelectionMetadata(username, repoNames)` | **Only if** `!opts.selectionDetailsByUser?.[username]` **and** `!opts.fixtureReposByUser` |
| Repo pick | `selectRepositories({ username, repos, details }, limit)` | Always |
| Collect | `collectRepositoryFromFixture(...)` **or** `await collectRepositoryArtifact(...)` | Fixture map present → fixture; else live GitHub |
| Ownership aggregate | `aggregateCandidateOwnership(repoDetails.map(r => r.ownership))` | Always after collect |
| Technical v1 | `runTechnicalJudge` (OpenAI / injected client) **or** `deterministicTechnicalJudge` | `opts.mockLlm ?? LLM_USE_MOCK`: if mock and no client → deterministic; if mock + client → LLM client; else live → `OpenAiJudgeClient` |
| Technical v2 | **Always** `deterministicTechnicalJudgeV2(...)` when repos exist | **Never** `runTechnicalJudgeV2` |
| Synthesis | `synthesizeCandidate({ technical: technicalV2, ownership, ... })` | Writing / cross / cory args **omitted** |
| Persist | `CandidateAssessmentRecord` with `schema_version: assessment-record-v2` | `judge_results.technical` = **v1** only |
| Digest | `buildDigest` / MD / HTML | Unless `skipDigest` |

### Component wiring table

| Component | Entry function | Called in live path? | Called in fixture path? | Fallback behavior | Status |
| --------- | -------------- | -------------------: | ----------------------: | ----------------- | ------ |
| Repository-selection metadata | `collectRepositorySelectionMetadata` | Yes (non-fixture, no injected details) | No (skipped when `fixtureReposByUser` set) | Selection proceeds without details | `live_and_wired` |
| Repository artifact collection | `collectRepositoryArtifact` / `collectRepositoryFromFixture` | Yes / yes | Yes (fixture) | Error → incomplete record | `live_and_wired` |
| Ownership-v2 | `collectOwnershipEvidence` (inside collector) + `aggregateCandidateOwnership` | Yes | Yes | Insufficient → class `insufficient_public_evidence` | `live_and_wired` |
| Technical judge v2 (LLM) | `runTechnicalJudgeV2` | **No** | **No** | N/A — never selected | `helper_not_invoked` |
| Technical judge v2 (deterministic) | `deterministicTechnicalJudgeV2` | Yes (axes only) | Yes | Always used for synthesis axes | `deterministic_fallback_only` (production synthesis) |
| Technical judge v1 | `runTechnicalJudge` / `deterministicTechnicalJudge` | Yes (persisted `judge_results`) | Yes | Mock/no key → deterministic | `live_and_wired` (v1) / `partial` vs report “v2” |
| Blog discovery/collection | `collectBlogArtifacts` / `FromFixture` | **No** | **No** (only unit tests) | N/A in orchestrator | `helper_not_invoked` |
| Writing judge | `runWritingJudge` / `deterministicWritingJudge` | **No** | **No** | N/A | `helper_not_invoked` |
| Artifact-relationship extraction | `extractDeterministicLinks` / `inferRelationships` | **No** | **No** | N/A | `helper_not_invoked` |
| Cross-artifact judge | `runCrossArtifactJudge` / deterministic | **No** | **No** | N/A | `helper_not_invoked` |
| Cory relevance | `runCoryRelevance` / `deterministicCoryRelevance` | **No** | **No** | Axis stays unavailable | `helper_not_invoked` |
| `synthesizeCandidate` | `synthesizeCandidate` | Yes | Yes | Missing axes → unavailable + partial weight move | `live_and_wired` |
| Priority-v2 | `computePriorityV2` (via synthesize) | Yes | Yes | Caps + incomplete redistribute | `live_and_wired` |
| Multi-label archetypes | `assignArchetypes` | Yes | Yes | Defaults `insufficient_evidence` | `live_and_wired` |
| Assessment-record-v2 persistence | `writeCandidateAssessment` | Yes | Yes | Error records still written | `live_and_wired` |
| Digest-v2 | `buildDigest` + renderers | Yes (default) | Yes | `--skip-digest` skips | `live_and_wired` |
| Rubric YAML loader | `loadRubricBundle` | **No** | **No** | Hardcoded prompt constants | `helper_not_invoked` |
| Legacy normalize | `normalizeLegacyAssessment` | **No** | **No** | Digest reads records as-is | `helper_not_invoked` |

---

## 2. Judges

### 2.1 Technical judge v2

| Item | Finding |
| ---- | ------- |
| Production LLM | `runTechnicalJudgeV2` in `technicalJudgeV2.ts` |
| Deterministic | `deterministicTechnicalJudgeV2` |
| Mock | Via `MockLlmJudgeClient` + `runTechnicalJudgeV2` (tests only; not orchestrator) |
| With API key (live assess) | **v1** `runTechnicalJudge` for persistence; **deterministic v2** for synthesis — **not** LLM v2 |
| Without API key | Deterministic v1 + deterministic v2 |
| Input | Repos + evidence package; v2 LLM expects `allowed_evidence_ids`, dimensions `TECHNICAL_DIMENSIONS_V2` |
| Output | `TechnicalJudgeResultV2` (`schema_version: technical-judge-v2`) |
| Zod | `technicalJudgeLlmOutputV2Schema` on LLM path; post-validate evidence IDs |
| Prompt version | `technical-prompt-v2` |
| Rubric version | Constant `TECHNICAL_RUBRIC_VERSION = "2.0.0"` / id `technical-repository-v2` (**not** loaded from YAML) |
| Model persistence | LLM path persists `model` on result; deterministic uses `"deterministic-technical-v2"` (or override) |
| Cache namespace | `technical-v2:technical-prompt-v2` (LLM only) |
| Evidence-ID validation | Yes (`validateTechnicalResultV2`) |
| Abstention | Null dimension scores / `insufficient_public_evidence` band |

**Does this operate as an LLM scoring agent in the production path?**  
**No.** Production synthesis uses the deterministic v2 heuristic. LLM v2 is dead code relative to `runAssessment`.

### 2.2 Writing judge

| Item | Finding |
| ---- | ------- |
| Production LLM | `runWritingJudge` |
| Deterministic | `deterministicWritingJudge` (empty articles → abstain) |
| Mock | `MockLlmJudgeClient` capable; unused by orchestrator |
| With / without API key | **Neither** — not called |
| Schemas | `writingJudgeLlmOutputSchema`; result `WritingJudgeResult` |
| Prompt / rubric | `writing-prompt-v1` / `blog-intellectual-depth-v1` @ `1.0.0` (constants) |
| Cache | `writing-v1:writing-prompt-v1` |
| Evidence validation | Yes |
| Abstention | No articles → insufficient / unavailable depths |

**LLM scoring agent in production path?** **No.**

### 2.3 Cross-artifact judge

| Item | Finding |
| ---- | ------- |
| Production LLM | `runCrossArtifactJudge` |
| Deterministic | `deterministicCrossArtifactJudge` |
| Selection in assess | **Never** |
| Prompt / rubric | `cross-artifact-prompt-v1` / `cross-artifact-inquiry-v1` |
| Cache | `cross-artifact-v1:cross-artifact-prompt-v1` |
| Abstention | No / weak relationships → insufficient |

**LLM scoring agent in production path?** **No.**

### 2.4 Cory relevance judge

| Item | Finding |
| ---- | ------- |
| Production | `runCoryRelevanceJudge` (LLM optional overlay) |
| Deterministic | `deterministicCoryRelevance` (hybrid rules; `CORY_CALIBRATION_VERSION = cory-relevance-v1`) |
| Selection in assess | **Never** — axis always unavailable in live records |
| Cache | `cory-relevance:cory-relevance-v1` (LLM path) |
| Abstention | `insufficient_evidence` when signals sparse |

**LLM scoring agent in production path?** **No.**

### 2.5 Technical judge v1 (actually live)

With `OPENAI_API_KEY` and without `--mock`, production **does** run an LLM specialist (`runTechnicalJudge`, prompt `technical-v1`). That result is what lands in `judge_results.technical` and what digest `avgDims` reads. Priority axes, however, come from **deterministic v2**, so LLM v1 scores and priority-v2 can diverge.

---

## 3. Rubric operational wiring

Claimed chain:

```text
rubrics/*.yaml → loader → validated bundle → prompt builder → cache key → judge → assessment run
```

**Verified chain in production:**

```text
Hardcoded constants in prompt builders
→ (optional) LLM cache key uses rubricBundleVersion argument OR default LEGACY_RUBRIC_BUNDLE_VERSION ("legacy-phase2")
→ judge result
→ assessment run config stores LEGACY_RUBRIC_BUNDLE_VERSION
```

| Rubric file | Status |
| ----------- | ------ |
| `rubrics/rubric-bundle-v1.yaml` | `loaded_but_unused` (loader exists; never called from assess/digest) |
| `ownership-v2.yaml` | `documentation_only` / unused by ownership collector (logic is TypeScript) |
| `technical-repository-v2.yaml` | `loaded_but_unused` — prompt uses string constants matching ids/versions |
| `blog-intellectual-depth-v1.yaml` | `loaded_but_unused` |
| `cross-artifact-inquiry-v1.yaml` | `loaded_but_unused` |
| `cory-relevance-v1.yaml` | `loaded_but_unused` |

**Cache invalidation by editing YAML alone:** **No.**  
Cache keys hash `systemPrompt` text + `rubric_bundle_version` param. YAML is not read into prompts. Changing a YAML file without changing TS prompt strings or the `rubricBundleVersion` argument does **not** invalidate judge cache. Tests prove cache misses when the **version string argument** changes (`llmClient.test.ts`), not when YAML changes.

---

## 4. GitHub live coverage

Live collector (`collectRepositoryArtifact`) uses `ghJson` for: repo metadata, git ref/tree, file blobs, **unfiltered** commits sample, **author-filtered** commits (+ up to 10 commit file lists), pulls list (`/pulls?state=all&per_page=30`), languages. No pagination beyond single `per_page`. No CODEOWNERS, workflows, or releases endpoints. No PR `/files` or `/reviews` fetches.

| Module | Export | Called by | Live requests made | Persisted output | Status |
| ------ | ------ | --------- | ------------------ | ---------------- | ------ |
| `githubClient.ts` | re-exports `ghJson`, `RateLimitManager` | Nothing in assess path (dead façade) | None via this module | — | `helper_not_invoked` |
| `rateLimitManager.ts` | `RateLimitManager` | Only re-exported; **unused** in collector | None (no separate budgets) | — | `helper_not_invoked` |
| `githubIdentityMap.ts` | `buildGitHubIdentityMap` | **Unused** in live path | None | — | `helper_not_invoked` |
| `matchCommitLogin.ts` | `commitMatchesCanonicalLogin`, `buildPhaseAIdentityMap` | `collectRepositoryArtifact` (+ tests) | N/A (pure) | Affects share / match counts | `live_and_wired` |
| `collectRepositorySelectionMetadata.ts` | `collectRepositorySelectionMetadata` | `runAssessment` (live non-fixture) | Repo metadata for selection | Used in-memory / metaCache | `live_and_wired` |
| `selectRepositories.ts` | `selectRepositories` | `runAssessment` | None | Selection reasons | `live_and_wired` |
| `collectRepositoryArtifact.ts` | `ghJson`, collect live/fixture | `runAssessment` | Commits, files, pulls list, languages, tree | Artifact + ownership + evidence | `live_and_wired` |
| `collectOwnershipEvidence.ts` | `collectOwnershipEvidence`, `aggregateCandidateOwnership`, adapter | Collector + synthesize | None (pure) | Ownership-v2 on artifact | `live_and_wired` |
| `selectSourceFiles.ts` | `selectSourceFiles`, ignore helpers | Collector | None | Central/test/manifest paths | `live_and_wired` |
| `collectCommitEvidence.ts` | `intersectCentralChanges` | **Tests/helpers only** — live uses inline intersection | None | — | `helper_not_invoked` |
| `collectPullRequestEvidence.ts` | `filterCandidatePulls` | **Unused** by collector (inline filter) | None | — | `helper_not_invoked` |
| `collectReviewEvidence.ts` | `candidateAuthoredReviews` | **Unused** | None | — | `helper_not_invoked` |
| `collectRepositoryOperations.ts` | `emptyOperationsSnapshot` | **Unused** | CODEOWNERS/workflows/releases **not** fetched | — | `stub` / `helper_not_invoked` |
| `detectRepositoryProvenance.ts` | `detectRepositoryProvenance` | **Unused** — flags set ad hoc in collector | None | Partial flags via meta (fork/template/course heuristic) | `helper_not_invoked` |

**PR files, reviews, CODEOWNERS, workflows, releases, pagination, separate rate-limit budgets:** helpers or stubs only — **not** in the live assessment path.

---

## 5. Ownership-v2

### Fixture path

`collectRepositoryFromFixture` → `computeShareFromSample` (unfiltered `repository_commit_sample` + login match) → candidate commit file maps → central ∩ changed → `collectOwnershipEvidence` → later `aggregateCandidateOwnership`.

### Live path

Unfiltered `/commits?per_page=N` → login match share → separate `/commits?author=` for inspection files (≤10 detail fetches) → `collectOwnershipEvidence` → aggregate.

### Checks

| Requirement | Verified? | Evidence |
| ----------- | --------: | -------- |
| Author-filtered commits never supply share numerator | Yes | Share from unfiltered sample only; author list is separate |
| Selected files alone never become authored files | Yes | Core paths require candidate-changed ∩ central (`isCoreContributionPath`); ownership tests |
| Aggregation not first-repo-blind | Yes | Prefers `direct_core_contribution_present`, then highest `support_class` |
| High ownership requires direct core | Yes | High branch requires `direct_core`; extra gate if `!direct_core` demotes high |
| Provenance caps enforced | Yes | `capMedium` demotes high → medium |
| Login-unmatched remain unmatched | Yes | `commitMatchesCanonicalLogin` — no name/email match |

Legacy adapter `ownershipV2ToLegacy` is used for digest claim wording in `assessOne`, not for priority-v2 scoring (priority uses v2 classes via `ownershipSupportToScore`).

---

## 6. Blog live path

Claimed: website → domain → robots → feeds → sitemaps → discovery → extract → select → persist → writing judge.

**Modules exist** (`collectBlogArtifacts`, `blogFetch`, robots/feeds/sitemaps, budgets, metadata-only fallback). **`runAssessment` never calls them.** Writing judge never receives articles.

| Question | Answer |
| -------- | ------ |
| Default production fetch? | Yes — `blogFetch` / undici-style HTTP in `blogClient.ts` |
| Constructed by `runAssessment`? | **No** |
| Crawl budgets enforced? | Yes inside collector (`BLOG_BUDGETS`) when invoked |
| Robots respected? | Yes (`isDisallowed`) when invoked |
| JS / browser fallback? | Type allows `browser_rendered`; **no Playwright/JS implementation** |
| Inaccessible → metadata-only? | Yes in collector |
| Artifacts survive into assessment records? | **No** — never attached in orchestrator |

**Classification:** `not_wired` (fixture-capable library, production path absent).  
Secondary label if forced: `live_but_partial` **only** as a standalone API — not as assessment subsystem.

---

## 7. Relationships and cross-artifact judging

Deterministic extractors and validators work in **unit tests** (`relationships.test.ts`): exact article↔repo URLs, README↔article, missing IDs rejected, inferred marked `deterministic: false`.

In production assess:

- Relationships are **not** generated.
- Cross-artifact judge is **not** called.
- Digest claims cannot carry relationship evidence IDs from this pipeline.

Status: `fixture_only` / `helper_not_invoked`.

---

## 8. Priority-v2

### Formula (implemented)

Base weights (`PRIORITY_V2_WEIGHTS`):

```text
technical 0.30, ownership 0.15, writing 0.10, cross_artifact 0.15,
unusual 0.08, persistence 0.07, cory 0.10, evidence_completeness 0.05
```

Missing writing: set `wWrite = 0`; move **half** of original writing weight split into technical + persistence; **other half unused**.  
Missing cross-artifact: same pattern into technical + ownership.

```text
base = Σ (w_i * axis_i)   # unavailable writing/cross contribute 0 with w=0
                          # unavailable cory: score forced 0 but w_cory kept
priority_score = round(clamp(base * 100), 2 decimals)

caps:
  identity_support == "low" → min(base, 0.70)
  identity_risks nonempty → min(base, 0.75)
  (tech or ownership evidence_support includes "low") && tech >= 0.7 → min(base, 0.80)
```

Missing writing is **unavailable** (`score: null`, `available: false`), not zeroed as an available axis — verified in `buildAxes` + weight logic. Cory weight is **not** redistributed when unavailable (score 0 with weight retained) — different from writing/cross.

### Offline fixture scenarios

Computed offline against `computePriorityV2` + `assignArchetypes` with representative axis vectors (not live candidates). Writing/cross unavailable unless noted.

| # | Scenario | Key axes (0–1) | Missing | Weights after redistribute | Caps | Priority | Primary | Secondary (typical) |
| - | -------- | -------------- | ------- | -------------------------- | ---- | -------: | ------- | ------------------- |
| 1 | Deep independent builder | tech 0.85, own 0.80, unu 0.70, per 0.80, comp 0.90 | writing, cross, cory, inquiry | wTech 0.3625, wOwn 0.1875, wWrite 0, wCross 0, wPer 0.095, wCory 0.10 | none | **~63.5** | `independent_systems_builder` | `unusual_experimentalist` |
| 2 | Strong tech, uncertain ownership | tech 0.80, own 0.30 (low support), unu 0.50, per 0.60, comp 0.70 | writing, cross, cory | same as #1 | high_signal_low_evidence possible (inactive at this base) | **~47.8** | `high_potential_weakly_verified` | may include builder flags |
| 3 | Deep writer, limited code | tech 0.35, own 0.30, **write 0.85**, unu/per 0.40, comp 0.60 | cross, cory | wTech 0.3375, wOwn 0.1875, wWrite 0.10, wCross 0 | none | **~34.9** | `deep_technical_writer` | `cross_domain_knowledge_seeker` |
| 4 | Cross-artifact investigator | tech 0.55, own 0.60, write 0.70, **cross 0.80**, unu/per 0.50, comp 0.80 | cory | full base weights (write+cross present) | none | **~56.0** | `independent_systems_builder` | writer / cross-seeker |
| 5 | Polished but shallow | tech 0.30, own 0.60, unu/per 0.20, comp 0.70 | writing, cross, cory | as #1 | none | **~29.1** | `insufficient_evidence` | [] *(early exit: tech/writing/cross all &lt; 0.35)* |
| 6 | High-potential weakly verified | tech 0.70, own 0.20, unu 0.55, per 0.50, comp 0.40 | writing, cross, cory | as #1 | low-evidence cap may apply | **~40.3** | `high_potential_weakly_verified` | — |
| 7 | Insufficient evidence | tech 0.20, own 0.20, comp 0.10; unu/per unavailable→0 | writing, cross, cory, unu, per | as #1 | identity low → 0.7 cap (nonbinding) | **~11.5** | `insufficient_evidence` | [] |
| 8 | GitHub-only strong builder | tech 0.80, own 0.80, unu 0.65, per 0.75, comp 0.85 | writing, cross, cory | as #1 | none | **~61–63** | `independent_systems_builder` | unusual if unu≥0.6 |

Note: Scenario 5 shows archetype rules and “polished” label do not align when blog axes are absent — polished primary is effectively unreachable on the current GitHub-only production axis set.

`PRIORITY_V2_REQUIRES_CALIBRATION = true` is persisted in components.

---

## 9. Digest-v2

```text
persisted assessment-record-v2
→ renderDigestForRun
→ buildDigest (pure)
→ renderMarkdown / renderHtml
→ writeRunDigestFiles + output/digests/{digest_id}.{json,md,html}
```

| Check | Result |
| ----- | ------ |
| No GitHub call | Yes — pure transform |
| No LLM call | Yes |
| Deterministic digest ID | Yes — SHA1 of run id + schema + ordered content hashes + rubric/weight versions |
| Same input → same ID | Yes (modulo `generated_at` field elsewhere; **id** excludes timestamp) |
| Evidence IDs resolve | `filterClaims` drops claims whose IDs are not in `artifacts.evidence` (except incomplete stub) |
| Unsupported claims removed | Yes via filter |
| Ownership wording gated | **No dedicated authorship-language gate found** in digest renderers |
| Version footer | **Markdown yes**; **HTML** only has a generic “did not call an LLM” line — **no rubric/weight/schema footer parity** |
| Legacy records render | Structurally yes if fields present; `normalizeLegacyAssessment` **not** called |
| MD + HTML support v2 document | Yes (`DIGEST_SCHEMA_VERSION = digest-v2`) |
| Email transport consume v2 without send | Yes — `TestEmailTransport`; `sendDigest` optional Resend |

---

## 10. Migration

| Case | Behavior |
| ---- | -------- |
| Legacy Phase 2 record | `normalizeLegacyAssessment` can bump `schema_version` and fill default `archetype_assignment` **in memory only** |
| New assessment-record-v2 | Written by assess; unchanged |
| Mixed fixture set | Digest sorts whatever is on disk; no rewrite |
| Legacy files rewritten? | **No** — helper docstring + no caller in digest/assess |

**Information lost / not backfilled on normalize:** axes, ownership-v2 fields if absent, writing/cross/cory judge results, relationships, priority-v2 components, weight redistribution history. Only shallow schema/archetype defaults.

---

## 11. Test quality

### Commands run (this audit)

| Command | Result |
| ------- | ------ |
| `npm run typecheck` | **pass** (`tsc --noEmit`) |
| `npm run test:assessment` | **pass** — 14 files, 64 tests |
| `npm test` | **pass** — 14 files, 64 tests |

### Feature → test map

| Feature | Test coverage | Kind |
| ------- | ------------- | ---- |
| Selection metadata wiring | `resume.test.ts` (injected details) | Orchestrator |
| Fixture assess + digest | `integration.fixture.test.ts` | Orchestrator / fixture |
| Ownership share / core / login | `ownership.test.ts` | Unit |
| Repo selection | `selectRepositories.test.ts` | Unit |
| Source file select | `selectSourceFiles.test.ts` | Unit |
| Judge cache versions | `llmClient.test.ts` | Unit |
| Deterministic judges + priority-v2 redistribute | `judgesAndScoring.test.ts` | Unit |
| Priority-v1 legacy helper | `priority.test.ts` | Unit (v1 — **not** production priority-v2 path) |
| Blog collector | `blogCollector.test.ts` | Fixture-only / unit — **no orchestrator wiring** |
| Relationships | `relationships.test.ts` | Fixture-only / unit — **no orchestrator wiring** |
| Evidence validation | `evidenceValidation.test.ts` | Unit |
| Digest render | `digest/render.test.ts` | Unit |
| Resume skip | `resume.test.ts` | Orchestrator |
| Run store | `runStore.test.ts` | Unit |
| Candidate IDs | `candidateIdentity.test.ts` | Unit |
| `runTechnicalJudgeV2` live wiring | **No test** | No test |
| Blog in `runAssessment` | **No test** | No test |
| Writing/cross/Cory in `runAssessment` | **No test** | No test |
| Rubric YAML → cache invalidation | **No test** | No test |
| `normalizeLegacyAssessment` in digest | **No test** | No test |

**Helpers proven without production wiring:** blog suite, relationships suite, deterministic writing/cross/cory unit tests, Phase-D GitHub helper modules (largely untested *and* unwired).

---

## 12. Diff inspection

### `git status --short` (source-relevant; `node_modules` / cache omitted)

```text
 M .env.example
 M package-lock.json
 M package.json
 M playwright.config.ts
?? docs/
?? rubrics/
?? scripts/assessCandidates.ts
?? scripts/generateDigest.ts
?? scripts/sendDigest.ts
?? src/assessment/
?? src/digest/
?? tests/assessment/
?? tests/digest/
?? vitest.config.ts
```

### `git diff --stat` (tracked files only)

```text
 .env.example         |   21 +
 package-lock.json    | 1486 +++++...
 package.json         |   18 +-
 playwright.config.ts |    1 +
 4 files changed, 1478 insertions(+), 48 deletions(-)
```

Almost the entire assessment/digest system is **untracked**, not a small patch on mainline.

### Summary

| Category | Notes |
| -------- | ----- |
| Added (untracked) | Full `src/assessment/**`, `src/digest/**`, `rubrics/**`, scripts, tests, docs |
| Modified tracked | `package.json` / lock, `.env.example`, minor `playwright.config.ts` |
| Dependencies added | `yaml`, `openai`, `resend`, `vitest` (+ types), etc. |
| Package scripts | `assess:candidates`, `digest:generate`, `digest:send`, `test`, `test:assessment`, `typecheck` |
| Schema migrations | Soft: `assessment-record-v2`, `digest-v2`, ownership-v2 — no DB; filesystem JSON |
| Potential dead code | `runTechnicalJudgeV2`, blog collector vs orchestrator, relationships, Phase-D helpers, `normalizeLegacyAssessment`, `RateLimitManager`, `githubClient` façade |
| Duplicate implementations | Technical v1 + v2; priority-v1 (`computeAssessmentPriority`) + priority-v2; identity map Phase-A vs Phase-D |
| Compatibility adapters | `ownershipV2ToLegacy`, `synthesizeFromTechnical`, `normalizeLegacyAssessment` |
| TODOs / placeholders | `PRIORITY_V2_REQUIRES_CALIBRATION`; Cory `requires_calibration`; `LEGACY_RUBRIC_BUNDLE_VERSION`; `browser_rendered` unimplemented |

No secrets or candidate PII inspected beyond structural code.

---

## 13. Phase table (report claims vs verification)

| Phase | Claimed status | Verified status | Production wired? | Evidence | Required follow-up |
| ----- | -------------- | --------------- | ----------------: | -------- | ------------------ |
| A Blockers (ownership, selection, cache, resume) | complete | `complete_with_known_limits` | Yes | Live collect + tests | Keep; document share sample bounds |
| B Rubric YAML | complete | `partial` | **No** load | Loader unused; constants only | Wire loader → prompts → cache version from bundle |
| C Technical judge v2 | complete | `partial` | Deterministic only | LLM v2 never called | Call `runTechnicalJudgeV2` when key present; persist v2 |
| D GitHub expansion | complete / thin | `stub` / `partial` | Minimal live APIs | Helpers unused | Wire PR files/reviews/ops or delete dead modules |
| E Artifact generalization | partial | `partial` | GitHub only | Types exist; blog kinds unused in assess | Attach blog artifacts to record |
| F Blog collector | complete / hardening | `fixture_only` / `not_wired` | **No** | No `runAssessment` import | Invoke collector; persist evidence |
| G Writing judge | complete | `fixture_only` | **No** | Unit only | Wire after blog |
| H Relationships | complete | `fixture_only` | **No** | Unit only | Generate + persist relationships |
| I Cross-artifact judge | complete | `fixture_only` | **No** | Unit only | Wire with relationships |
| J Cory relevance | complete | `fixture_only` | **No** | Unit only | Wire; calibrate weights |
| K Priority-v2 / synthesis | complete | `complete_with_known_limits` | Yes | Always runs; many axes unavailable | Expect GitHub-skewed scores |
| L Multi-label archetypes | complete | `complete_with_known_limits` | Yes | Polished path weak without writing | Revisit early-exit vs polished |
| M Digest-v2 | complete | `complete_with_known_limits` | Yes | HTML footer / ownership gate gaps | Align HTML footer; optional wording gate |
| N Paper enrichment | deferred | `not_found` / stub | No | Not in assess path | Explicit defer OK |
| O Tests | complete | `complete_with_known_limits` | N/A | 64 pass; wiring gaps untested | Orchestrator tests for blog/judges |
| P Migration | complete | `partial` | Helper unused | No rewrite (good); unused normalize | Call normalize in digest or document |

---

## Final JSON

```json
{
  "safe_for_live_fixture_smoke_test": true,
  "safe_for_real_candidate_assessment": false,
  "fully_live_judges": [
    "technical_v1_llm_when_openai_key_present"
  ],
  "deterministic_only_judges": [
    "technical_v2_for_synthesis_axes",
    "technical_v1_when_mock_or_no_key"
  ],
  "fixture_only_components": [
    "blog_collector",
    "writing_judge",
    "cross_artifact_judge",
    "cory_relevance_judge",
    "artifact_relationships",
    "rubric_yaml_bundle",
    "technical_judge_v2_llm"
  ],
  "unwired_helpers": [
    "RateLimitManager",
    "buildGitHubIdentityMap",
    "collectCommitEvidence.intersectCentralChanges",
    "collectPullRequestEvidence",
    "collectReviewEvidence",
    "collectRepositoryOperations",
    "detectRepositoryProvenance",
    "loadRubricBundle",
    "normalizeLegacyAssessment",
    "runTechnicalJudgeV2",
    "collectBlogArtifacts",
    "extractDeterministicLinks",
    "runWritingJudge",
    "runCrossArtifactJudge",
    "deterministicCoryRelevance"
  ],
  "blocking_defects": [
    "Implementation report architecture diagram implies blog/writing/cross/cory/relationships run in assess; runAssessment does not call them",
    "Technical LLM v2 unused; priority axes ignore LLM v1 scores — dual scoring systems",
    "Rubric YAML changes do not invalidate judge cache or alter prompts",
    "Real-candidate assessment cannot exercise writing/cross/cory axes; priority retains unused weight mass and always-zero cory term"
  ],
  "nonblocking_limitations": [
    "No PR file/review/CODEOWNERS/workflow/release collection in live path",
    "No separate GitHub rate-limit budgets",
    "Blog JS/browser fallback unimplemented",
    "Digest HTML lacks markdown version footer parity",
    "No ownership authorship wording gate in digest",
    "priority-v2 marked requires_calibration",
    "Polished archetype effectively unreachable on GitHub-only axis sets"
  ],
  "tests_run": [
    "npm run typecheck",
    "npm run test:assessment",
    "npm test"
  ],
  "tests_failed": []
}
```

---

## Audit artifacts

- **Audit path:** `docs/rubric-agents-verification-audit.md`
- **Tests run:** typecheck, `test:assessment`, `test` — all passed (64/64)
- **Git diff summary:** 4 tracked files modified; assessment/digest/rubrics/scripts/tests largely untracked additions
