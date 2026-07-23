# Rubric Agents Implementation Report

**Date:** 2026-07-21  
**Scope:** Phases A–P (production path + offline fixtures). No live assessment. No email send.

## 1. Summary

Implemented audit blocker repairs (Phase A), versioned rubrics (B), technical judge v2 + GitHub foundations (C–D), generalized assessment types + blog collector + writing/cross-artifact/Cory judges (E–J), priority-v2 synthesis and multi-label archetypes (K–L), digest-v2 with deterministic IDs (M), lightweight paper hooks deferred as optional (N), offline tests (O), and legacy normalization (P).

Still thin / provisional:

- Full live GitHub PR-file/review/CODEOWNERS/workflow collectors (hooks exist; deep pagination/rate-limit budgets not fully wired into every live call)
- Live blog crawl depends on injectable fetch; production hardening ongoing
- Cory weights marked `requires_calibration`
- Optional paper enrichment not deeply implemented

## 2. Files changed (grouped)

### Blocker repairs
- `src/assessment/github/collectOwnershipEvidence.ts` — OwnershipAssessmentV2 hard gates
- `src/assessment/github/collectRepositoryArtifact.ts` — same-sample commit share, core-file authorship
- `src/assessment/github/matchCommitLogin.ts` — Phase-A login-only matching
- `src/assessment/github/collectRepositorySelectionMetadata.ts` — lightweight selection metadata
- `src/assessment/github/selectRepositories.ts` — template/topics metadata
- `src/assessment/judges/llmClient.ts` — schema revalidation + versioned cache keys
- `src/assessment/storage/artifactCache.ts` / `judgeCache.ts`
- `src/assessment/storage/assessmentRunStore.ts` — resume, snapshot hash, digest invalidation
- `src/assessment/runAssessment.ts` — orchestration, resume CLI options
- `scripts/assessCandidates.ts` — `--resume`, `--retry-errors`, `--force-candidate`

### Rubrics
- `rubrics/*.yaml`, `src/assessment/rubrics/*`

### GitHub evidence
- `src/assessment/github/githubClient.ts`, `rateLimitManager.ts`, `githubIdentityMap.ts`
- `collectCommitEvidence.ts`, `collectPullRequestEvidence.ts`, `collectReviewEvidence.ts`
- `collectRepositoryOperations.ts`, `detectRepositoryProvenance.ts`

### Blog collection
- `src/assessment/blog/*`

### Judges
- `technicalJudgeV2.ts`, `writingJudge.ts`, `crossArtifactJudge.ts`, `coryRelevanceJudge.ts` + schemas/prompts

### Relationships
- `src/assessment/relationships/*`

### Scoring / archetypes
- `src/assessment/scoring/synthesizeCandidate.ts`, updated `archetypes.ts`

### Digest
- `src/digest/types.ts`, `buildDigest.ts`, `renderMarkdown.ts` (digest-v2)

### Migration
- `src/assessment/migration/normalizeLegacyAssessment.ts`

### Tests
- Updated ownership, llmClient, priority, resume, integration, digest tests
- `tests/assessment/blog/`, `tests/assessment/relationships/`, `judgesAndScoring.test.ts`

## 3. Architecture diagram

```text
Discovery (unchanged final_score)
→ candidate selection + stable cand_* id
→ GitHub selection metadata → selectRepositories
→ repository collection + ownership-v2
→ (optional) blog fixture/live collection
→ evidence store
→ technical judge (v1 compat + v2 deterministic)
→ writing / cross-artifact / Cory (when artifacts present)
→ relationships (deterministic extract)
→ synthesizeCandidate (priority-v2 + axes + multi-label archetypes)
→ assessment-record-v2 persistence
→ digest-v2 (deterministic digest_id, evidence-filtered claims)
```

## 4. Persisted schemas

| Version | Role |
| ------- | ---- |
| `assessment-record-v2` | Candidate assessment records |
| `ownership-v2` | Ownership assessments |
| `technical-judge-v2` | Technical specialist (v2 path) |
| `writing-judge-v1` | Writing judge |
| `cross-artifact-judge-v1` | Cross-artifact judge |
| `priority-v2` | Assessment priority weights |
| `digest-v2` | Digest documents |
| `rubric-bundle-v1` | External rubric bundle |
| `legacy-phase2` | Judge cache rubric placeholder until fully migrated |

## 5. Scoring formula (priority-v2)

Normalized inputs 0..1:

```text
technical 0.30 + ownership 0.15 + writing 0.10 + cross_artifact 0.15
+ unusual 0.08 + persistence 0.07 + cory 0.10 + evidence_completeness 0.05
```

Missing writing: move **at most half** of writing weight to technical + persistence; remainder unused.  
Missing cross-artifact: at most half to technical + ownership; remainder unused.  
Identity / evidence-support caps applied in `synthesizeCandidate`.

## 6. Evidence lineage (fixture)

```text
repository_commit_sample (unfiltered)
→ login-exact match → candidate_commit_share
→ commit files ∩ selected central paths → direct_core_contribution
→ OwnershipAssessmentV2 support_class
→ technical v2 dimensions (0–5|null)
→ AssessmentAxes + priority_score
→ digest why_highlighted (evidence IDs validated)
```

## 7. Blocker verification

1. **Ownership share** — same unfiltered sample; author-filtered list is not numerator; fixtures with 2/20 → share 0.1  
2. **Live selection details** — `selectionDetailsByUser` / `collectRepositorySelectionMetadata` passed into `selectRepositories`  
3. **Judge cache** — key includes model/prompt/payload/schema/rubric/impl versions; invalid cache regenerates  
4. **Resume** — incomplete runs skip completed candidates; completed runs immutable; digest invalidation by exact `digest_id`

## 8. Test results

```text
npm run typecheck     → pass
npm run test:assessment / npm test → 14 files, 64 passed
```

No skipped tests in vitest run. No live assessment. No `digest:send`.

## 9. Sample fixture archetypes covered in tests

- Deep independent builder (integration + ownership fixtures)
- Uncertain ownership / share dilution (ownership tests)
- Writing/cross-artifact/Cory deterministic paths (`judgesAndScoring.test.ts`)
- Digest ordering + HTML escape + deterministic digest id fields

## 10. Known limitations

- Public-artifact availability bias remains
- Private repos invisible
- Login-only identity undercounts commits without `author.login`
- Blog authorship uncertainty
- LLM interpretation limits on live OpenAI path
- Cory weights uncalibrated
- Optional paper enrichment not implemented deeply
- Some Phase D collectors are foundational helpers pending full live wiring

## 11. Git / process confirmation

- No email sent
- No live candidate assessment executed
- Offline typecheck + vitest only
