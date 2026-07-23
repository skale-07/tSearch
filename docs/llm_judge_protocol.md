# LLM Judge Protocol

## Stages

| Stage | Input | Prompt purpose | Output schema | Validation | Retry behavior | Abstention rule | Cost estimate |
|---|---|---|---|---|---|---|---|
| 0 deterministic validation | typed evidence package | verify IDs and structure | pass/fail plus error list | schema validation, evidence-ID existence, duplicate check | repair once, else fail | abstain not applicable | low |
| 1 ownership judge | repository package | classify ownership support and cite evidence IDs | JSON with class, rationale, counterevidence, unsupported_claims | rationale must cite valid IDs; no hidden evidence | retry once on invalid schema | abstain if identity weak or core-file coverage poor | medium |
| 2 technical-depth judge | repository or paper package | score problem/mechanism/validation/tradeoffs | JSON anchored scores plus evidence IDs | valid anchors only; contradiction scan | retry once | abstain on sparse core evidence | medium |
| 3 originality judge | repository package | classify fork/template/tutorial/wrapper/generated risk | JSON with flags and support | deterministic-source cross-check | retry once | abstain on ambiguous similarity | medium |
| 4 blog-depth judge | article package | score source integration, reasoning, humility, synthesis | JSON anchored scores plus evidence IDs | citation and section checks | retry once | abstain on missing full text | medium |
| 5 synthesis judge | outputs from prior stages | combine without changing evidence facts | JSON summary with uncertainty and human-review flags | consistency checks across prior stage outputs | no silent repair | abstain if stage disagreement high | medium |

## Call counts

- Per repository: 3 specialist calls minimum, ownership + technical depth + originality; 1 synthesis call after validation.
- Per paper: 2 specialist calls minimum, research depth + contribution/ownership; 1 synthesis call.
- Per article: 1 blog-depth specialist call; second judge only on high-stakes or disagreement cases.

## Evidence package limits

- Repository package: repo metadata, up to 20 core files, up to 10 PRs, up to 10 reviews, up to 10 workflow/release artifacts.
- Paper package: metadata, abstract, methods/eval snippets if public, linked code/data metadata, contribution statement if present.
- Article package: title, summary, sections, citations, revision metadata, internal-link context.

## Chunking

- Large repositories are chunked by core-file clusters plus top PRs affecting those clusters.
- Cross-file mechanisms are reconstructed from README, build manifests, entry points, import graph summaries, and PR/file linkages.

## Bias reduction

- Mask prestige fields for talent judgments: venue prestige, stars, followers, institutional brand, citation counts unless the judged dimension is explicitly impact/context.
- Randomize artifact order inside same-evidence sets.
- Separate ownership from quality calls.

## Invalid evidence handling

- Reject any rationale citing a nonexistent evidence ID.
- Reject any ownership statement that depends on unstated private evidence.
- Detect rationale-score contradictions by rule checks such as low evidence with high score and no counterevidence.

## Independent second judge triggers

- identity confidence below high
- ownership and technical signals conflict
- novelty/originality flags ambiguous
- first judge abstains
- critical candidate for top ranking
