# Cory Calibration Protocol

## Labels

Treat these as distinct labels:[file:43]

- technical_strength
- research_strength
- writing_intellectual_depth
- candidate_ownership
- cory_relevance
- identity_correctness
- evidence_completeness
- explore_network_action

## Candidate sets

### 20 candidates

Purpose: label and interface debugging.[file:43]

- Sample obvious positives, obvious negatives, and ambiguous identity cases.
- Include at least 3 duplicate hidden items.
- Include abstain option on every label.
- Goal: find broken instructions and missing evidence views.

### 50 candidates

Purpose: initial calibration.[file:43]

- Balance archetypes across software, research, writing-heavy, mixed, sparse-public-artifact, and wrong-identity candidates.
- Add pairwise comparisons for top/middle/bottom uncertainty bands.
- Include blind rerating after a time gap.

### 100 candidates

Purpose: holdout-tested ranking revision.[file:43]

- Use train/calibration/test split.
- Keep duplicate hidden items and hard negatives.
- Evaluate pairwise ranking and ordinal prediction separately by label.

## Recommended modeling

- Up to 20 labels: simple weighted rules and descriptive analysis only.
- Around 50 labels: ordinal logistic regression for ordinal dimensions; Bradley-Terry or pairwise logistic ranking for pairwise ranking tasks.
- Around 100 labels: compare ordinal logistic, Bradley-Terry, and pairwise logistic ranking; add isotonic calibration only for monotonic post-processing when enough holdout data exists.
- Do not use Bayesian preference learning unless label volume grows materially beyond this plan.[file:43]

## Agreement and evaluation

- Inter-rater or test-retest agreement on duplicate hidden items.
- Abstention rate and abstention correctness.
- Pairwise accuracy on held-out pairs.
- Spearman/Kendall rank correlation for candidate ordering within dimension.
- Unsupported-rationale rate.
- Wrong-identity detection precision.

## Success criteria

- Stable repeated labels on duplicates.
- Reduced unsupported-claim rate after rubric revision.
- Improved held-out ranking agreement versus simple baseline ordering by raw artifact counts.
