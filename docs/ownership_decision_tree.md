# Ownership Decision Tree

## Principle

This is a provisional operational decision tree, not a validated universal formula.[file:43]

## Output classes

- `high_ownership_support`
- `medium_ownership_support`
- `low_ownership_support`
- `insufficient_public_evidence`

## Required evidence vector

```yaml
identity_confidence: exact|high|medium|low
candidate_created_repo: true|false|unknown
central_file_change_share: 0..1 or unknown
accepted_pr_count: integer
active_weeks: integer
contribution_span_days: integer
review_activity_present: true|false
release_participation_present: true|false
codeowners_present: true|false|unknown
candidate_contribution_statement_present: true|false
work_predates_candidate: true|false|unknown
imported_or_generated_code_heavy: true|false|unknown
team_size_bucket: solo|small|medium|large|unknown
squash_merge_prevalence: low|medium|high|unknown
identity_completeness: high|medium|low
```

## Decision tree

1. If identity confidence is low, output `insufficient_public_evidence`.
2. If the repository is candidate-created, identity confidence is exact or high, and at least two of the following are present — central-file changes, repeated accepted PRs, release participation, CODEOWNERS, sustained active weeks — output `high_ownership_support`.
3. If the candidate did not create the repo but has repeated accepted PRs, central-file changes, and sustained contribution span, output `medium_ownership_support` unless maintainer/reviewer evidence or release evidence lifts it to high.
4. If contributions are present but mostly peripheral, short-lived, or non-central, output `low_ownership_support`.
5. If the repo strongly predates the candidate, identity completeness is weak, or imported/generated code dominates observable changes, cap at `medium_ownership_support` and often return `insufficient_public_evidence`.

## Rule table

| Rule | Required evidence | Confidence effect | Counterexamples | Domain limitations |
|---|---|---|---|---|
| Candidate-created repo plus sustained central activity | repo created by candidate, exact/high identity, active weeks, central-file evidence | strong positive | scaffolded repo with little original work | created repo does not guarantee architectural ownership |
| Repeated accepted PRs to central code | merged PRs, changed files, centrality support | moderate positive | many small fixes or docs-only PRs | monorepos can distort centrality |
| Maintainer/reviewer/release role | reviews performed, release authoring, CODEOWNERS | strong positive | nominal maintainer with little code authorship | roles differ by project norms |
| Work predating candidate involvement | repo timeline plus first observed activity | negative cap | candidate may have contributed before public identity stabilized | imported histories and renamed accounts complicate timing |
| Heavy generated/imported code | generated markers, vendored dirs, license fingerprints | negative cap | original glue/architecture may still be significant | more common in web/mobile and ML repos |

## Pseudocode

```text
function classifyOwnership(v):
  if v.identity_confidence == 'low':
      return insufficient_public_evidence

  positive = 0
  if v.candidate_created_repo == true: positive += 1
  if v.central_file_change_share not unknown and v.central_file_change_share >= threshold: positive += 1
  if v.accepted_pr_count >= accepted_pr_threshold: positive += 1
  if v.active_weeks >= active_week_threshold: positive += 1
  if v.review_activity_present: positive += 1
  if v.release_participation_present: positive += 1
  if v.codeowners_present == true: positive += 1
  if v.candidate_contribution_statement_present: positive += 1

  if v.work_predates_candidate == true: positive -= 1
  if v.imported_or_generated_code_heavy == true: positive -= 1
  if v.identity_completeness == 'low': positive -= 1

  if positive >= 4 and v.identity_confidence in ['exact','high']:
      return high_ownership_support
  if positive >= 2:
      return medium_ownership_support
  if positive >= 1:
      return low_ownership_support
  return insufficient_public_evidence
```
