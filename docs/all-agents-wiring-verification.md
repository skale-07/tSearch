# All-Agents Wiring Verification Audit

**Date:** 2026-07-21  
**Scope:** Post-wiring verification of `runAssessment` agent orchestration.  
**Authority:** Live code + tests. Prior: `docs/rubric-agents-verification-audit.md`, Wire All Agents plan.  
**Live 39-candidate run:** not executed. **Email:** not sent. **Discovery:** not invoked.

## Blocking fixes applied during this pass

1. **Judge cache vs `.env`:** `ASSESSMENT_FORCE_REFRESH` was captured once at module load, so `.env` force-refresh broke cache hit tests. Fixed with `assessmentForceRefresh()` read-at-call-site; `llmClient.test.ts` clears the env in `beforeEach`.
2. **Cory Zod:** Deterministic Cory could emit `relevance: "low"` with empty `reasons` (limited writing-only). Schema requires `reasons.min(1)`. Fixed reason/score for `writePts === 1` and a low-relevance fallback reason.

---

## Part 1: Production call graph

```text
npm run assess:candidates
→ scripts/assessCandidates.ts
→ runAssessment()                         [src/assessment/runAssessment.ts]
   → loadRubricBundle() once
   → writeSourceCandidates(full input array) → source-candidates.json + hash
   → for each selected id: assessOne()
→ writeCandidateAssessment()
→ renderDigestForRun() → buildDigest → renderMarkdown → renderHtml
```

No imports of `runPipeline`, `expandGraph`, LinkedIn discovery, or branch-expand in `runAssessment.ts` or `scripts/assessCandidates.ts`.

### Module table

| Component | Called by `assessOne`? | Condition | Persisted? | Test | Status |
| --------- | ---------------------: | --------- | ---------: | ---- | ------ |
| `loadRubricBundle` | Via `runAssessment` (once/run), not inside `assessOne` | Always at run start | `run.config.rubric_bundle_version` | orchestrator “loads rubric YAML…” | `verified` |
| `collectRepositorySelectionMetadata` | Yes | GitHub username **and** no fixtureRepos **and** no injected selection details | In-memory / metaCache only | resume selection wiring | `verified` |
| `collectRepositoryArtifact` / fixture | Yes | GitHub username; live vs `fixtureReposByUser` | `artifacts.github_repositories`, evidence, refs | integration + orchestrator | `verified` |
| `aggregateCandidateOwnership` | Yes | After repo collect (also empty → `undefined`) | `ownership` on record | ownership + orchestrator | `verified` |
| `runTechnicalJudgeV2` | Yes | GitHub repos collected **and** live LLM (`!mockLlm` + client) | `judge_results.technical` | spy: mock does **not** call it | `verified` |
| `deterministicTechnicalJudgeV2` | Yes | GitHub repos **and** mock / no live client | `judge_results.technical` | “mock mode uses deterministic…” | `verified` |
| `collectBlogArtifacts` / FromFixture | Yes | Website/blog URL present; fixture key or live fetch | `blog_articles`, refs, evidence | “website invokes collectBlog…” | `verified` |
| `runWritingJudge` / deterministic | Yes | After blog collect; empty articles → deterministic abstain | `judge_results.writing` | blog + writing-only tests | `verified` |
| `extractDeterministicLinks` | Yes | Both repo refs **and** article refs nonempty | `relationships` | “generates deterministic relationships…” | `verified` |
| `filterValidRelationships` | Yes | After extract | Filtered `relationships` | same + relationships unit tests | `verified` |
| `runCrossArtifactJudge` / deterministic | Yes | `deterministic` relationships length &gt; 0 | `judge_results.cross_artifact` | cross with/without links tests | `verified` |
| `runCoryRelevanceJudge` / deterministic / abstain | Yes | Substantive tech **or** writing → judge; else abstention **without** Cory LLM | `judge_results.cory` | Cory synthesis + sparse abstain | `verified` |
| `synthesizeCandidate` | Yes | Always (including sparse/error paths) | `synthesis` | all orchestrator paths | `verified` |
| `buildDigest` | Via `renderDigestForRun` | Unless `--skip-digest` | digest JSON/MD/HTML | integration + digest tests | `verified` |

**Not treated as wired:** `inferRelationships` (intentionally unused), technical-v1 judges (not called from orchestrator), Phase-D GitHub helpers (`RateLimitManager`, PR/review collectors, etc.).

---

## Part 2: Technical-v2 is primary

| Check | Evidence | Pass? |
| ----- | -------- | ----: |
| Live LLM → `runTechnicalJudgeV2` | `useLiveLlm && llmClient` branch in `assessOne` | Yes |
| Mock → `deterministicTechnicalJudgeV2` | Else branch; orchestrator spy | Yes |
| Persisted schema `technical-judge-v2` | `judge_results.technical.schema_version`; tests | Yes |
| Same object into synthesis | Single `technical` variable → `synthesizeCandidate({ technical })` and `judge_results: { technical }` | Yes |
| Priority uses that v2 | `buildAxes` reads `TechnicalJudgeResultV2` | Yes |
| Digest uses v2 dims | `avgDims` reads `dimension_id` | Yes |
| v1 not driving assess | No `runTechnicalJudge` / `deterministicTechnicalJudge` imports in orchestrator | Yes |

**Verdict:** Pass. Persisted technical and synthesis technical are the same v2 result.

---

## Part 3: Blog and writing

Confirmed path when `websiteOrBlogUrl(selected)` is set:

```text
URL → collectBlogArtifacts(|FromFixture)
→ selected articles → ArtifactReference + blog_articles + evidence
→ runWritingJudge | deterministicWritingJudge
→ judge_results.writing → writing_intellectual_depth axis
```

| Check | Result |
| ----- | ------ |
| No website → writing unavailable (not zero) | Yes — axis `available: false`, `score: null` |
| No articles → writing abstains | Yes — `deterministicWritingJudge({ articles: [] })` |
| Writing-only completes | Yes — orchestrator test + offline smoke |
| Article links do not add candidates | Yes — candidate_ids frozen; no discovery imports |
| Blog fixture injection | `blogFixtureByKey` | Yes |
| Live fetch only for input candidates | Yes — only `assessOne` for selected snapshot ids |

---

## Part 4: Relationships and cross-artifact

```text
repo README text + article body
→ extractDeterministicLinks
→ filterValidRelationships
→ relationships on record
→ if deterministic.length > 0 → cross-artifact judge
```

| Check | Result |
| ----- | ------ |
| Only deterministic links trigger cross | Yes — filters `r.deterministic` |
| Topic similarity alone unused | `inferRelationships` not called |
| Missing artifact IDs rejected/filtered | `filterValidRelationships` + unit tests |
| No relationships → cross axis unavailable | Yes |
| Relationship IDs on record | Yes (`relationships` field) |
| Digest relationship claims | Cross axis/summary can appear; relationship evidence IDs are on record; digest claims primarily use synthesis evidence IDs | `partially_verified` |

Offline smoke: GitHub+blog produced **2** deterministic relationships and ran cross-artifact judge.

---

## Part 5: Cory relevance

| Check | Result |
| ----- | ------ |
| Inputs: tech, ownership, writing, cross, completeness | Passed into `runCoryRelevanceJudge` / `deterministicCoryRelevance` | Yes |
| Abstain without Cory LLM when no substantive signal | Sparse path: `coryAbstention()` | Yes |
| Persisted `judge_results.cory` | Yes |
| Axis reaches synthesis | Yes |
| Calibration metadata | `calibration_version: cory-relevance-v1`; priority `requires_calibration` | Yes |

---

## Part 6: Rubric wiring

```text
rubrics/rubric-bundle-v1.yaml
→ loadRubricBundle (validated)
→ rubricBundleVersionLabel = version + sha256(version + JSON.stringify(sortKeys(file_hashes)))[:16]
→ run.config.rubric_bundle_version
→ LLM judges: rubric def appended to prompts + rubricBundleVersion in generateStructured cache key
```

| Check | Result |
| ----- | ------ |
| Loads once per run | Yes |
| Injected into LLM prompts | technical / writing / cross via `build*Prompt(rubric)` | Yes |
| Deterministic judges skip prompts | Expected — cache identity still on run | OK |
| Sorted file hashes | `sortKeys` in `rubricCacheIdentity` | Yes |
| YAML content edit changes identity | Offline probe: append to copy of `technical-repository-v2.yaml` → identity changed | Yes |
| New runs ≠ `legacy-phase2` | `1.0.0:<hash>` | Yes |
| Cache miss on rubric version change | `llmClient` + orchestrator tests | Yes |

---

## Part 7: Fixed candidate input

| Check | Result |
| ----- | ------ |
| `backup/20260713-144834/candidates.json` has 39 records | Yes |
| CLI `--input` | `scripts/assessCandidates.ts` → `opts.inputPath` | Yes |
| Snapshot = full loaded candidate array | `writeSourceCandidates(run.id, allCandidates)` | Yes |
| Hash persisted | `source_candidates_hash` | Yes |
| Resume from snapshot only | `loadSnapshotCandidates`; no reread of backup after create | Yes |
| No discovery / graph expand | No pipeline imports in assess path | Yes |
| Contributors not promoted | Orchestrator test + frozen `candidate_ids` | Yes |
| Count cannot increase | Explicit check throws if `candidate_ids` change | Yes |

---

## Part 8: Offline four-candidate fixture smoke

Ran offline mock assessment (fixtures only; temp dirs cleaned). Zod validated judge payloads with existing schemas.

| Candidate type | Technical | Ownership | Writing | Relationships | Cross | Cory | Priority | Error |
| -------------- | --------- | --------- | ------- | ------------- | ----- | ---- | -------- | ----- |
| GitHub-only | technical-judge-v2 / limited | high_ownership_support | unavailable | 0 | unavailable | medium (cory-relevance-v1) | 45.7 | none |
| GitHub + blog + link | technical-judge-v2 / limited | high_ownership_support | writing-judge-v1 / limited | 2 | cross-artifact-judge-v1 / moderate | medium | 52.33 | none |
| Writing-only | absent | absent | writing-judge-v1 / limited | 0 | unavailable | low | 7.13 | none |
| Insufficient evidence | absent | absent | unavailable | 0 | unavailable | insufficient_evidence | 0 | none |

Expectations met: GitHub-only completes with writing/cross unavailable; linked pair runs all applicable agents; writing-only completes without GitHub; sparse persists abstention and does not stop the run. Snapshot count = 4; `rubric_bundle_version` = `1.0.0:c7ce10db86cf9589`.

---

## Part 9: Digest compatibility

| Check | Result |
| ----- | ------ |
| Reads technical-v2 `dimension_id` | Yes (`avgDims`) |
| Missing writing/cross/Cory | Axes optional; render continues | Yes |
| No GitHub / LLM in digest | Pure functions | Yes |
| Evidence ID filter on claims | `filterClaims` | Yes |
| MD + HTML render | Smoke: both nonempty; MD has version footer | Yes |
| Deterministic digest ID | Same input → same `digest_id` in smoke | Yes |
| Authorship wording gate | Still no dedicated gate | Limitation |
| HTML version footer parity | Still weaker than MD | Limitation |

Email not sent.

---

## Part 10: Commands

| Command | Result |
| ------- | ------ |
| `npm run typecheck` | pass |
| `npm run test:assessment` | **15 files, 79 passed** |
| `npm test` | **15 files, 79 passed** |

### Git (source-relevant)

```text
 M .env.example
 M package-lock.json
 M package.json
 M playwright.config.ts
?? docs/…
?? rubrics/…
?? scripts/assessCandidates.ts (and digest scripts)
?? src/assessment/…
?? src/digest/…
?? tests/assessment/…
?? tests/digest/…
?? vitest.config.ts
```

`git diff --stat` (tracked only): 4 files, +1478 / −48 (deps/scripts/env example). Assessment system remains largely untracked.

---

## Part 11: Verdict

Wiring claimed by the Wire All Agents plan is **present in the production assess path** and covered by orchestrator tests plus an offline four-candidate smoke. Safe for a **small live smoke** with API keys and rate-limit awareness; **not** automatically safe for a full 39-candidate run until live blog crawl + GitHub budgets are watched.

```json
{
  "production_call_graph_verified": true,
  "technical_v2_primary": true,
  "blog_wired": true,
  "writing_wired": true,
  "relationships_wired": true,
  "cross_artifact_wired": true,
  "cory_wired": true,
  "rubric_yaml_operational": true,
  "writing_only_supported": true,
  "fixed_input_enforced": true,
  "discovery_invoked": false,
  "new_candidates_created": 0,
  "offline_fixture_smoke_test_passed": true,
  "safe_for_three_candidate_live_smoke_test": true,
  "safe_for_full_39_candidate_run": false,
  "blocking_defects": [],
  "nonblocking_limitations": [
    "Phase-D GitHub helpers (PR files/reviews/CODEOWNERS/workflows/rate budgets) remain unwired",
    "inferRelationships intentionally unused",
    "technical-v1 modules remain in tree but are not called from runAssessment",
    "Deterministic judges do not embed YAML rubric text (LLM path does)",
    "Digest HTML lacks Markdown version-footer parity; no authorship wording gate",
    "priority-v2 and Cory remain marked requires_calibration",
    "Full 39-candidate live run risks GitHub + blog crawl rate limits / cost; not exercised here"
  ],
  "tests_run": [
    "npm run typecheck",
    "npm run test:assessment",
    "npm test",
    "offline 4-candidate fixture smoke"
  ],
  "tests_failed": []
}
```
