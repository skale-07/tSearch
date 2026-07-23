# Assessment and digest (Phase 1–2)

## What this adds

Additive layer beside discovery:

1. `npm run assess:candidates` — deep GitHub artifact assessment from `output/candidates.json`
2. Durable runs under `output/assessment-runs/<id>/`
3. Digests under `output/digests/` (JSON + Markdown + HTML)
4. `npm run digest:generate -- --run <id>` — regenerate digest without LLM/GitHub
5. `npm run digest:send -- --digest <id>` — explicit email send via Resend (not automatic)

Does **not** change `Candidate.final_score` or LinkedIn scraping.

## Commands

```bash
# Offline / CI-friendly (deterministic judge, no OpenAI)
ASSESSMENT_MOCK_LLM=1 npm run assess:candidates -- --input output/candidates.json --limit 5 --mock

# Live OpenAI technical judge + live GitHub collection
npm run assess:candidates -- --input output/candidates.json --limit 5

# Regenerate digest from a completed run (no LLM)
npm run digest:generate -- --run arun_...

# Send email (requires DIGEST_EMAIL_* and RESEND key)
npm run digest:send -- --digest digest_...
npm run digest:send -- --digest digest_... --dry-run
```

## Scores

| Score | Meaning |
| ----- | ------- |
| `discovery_score` | Existing pipeline `final_score` (shown in digest only) |
| `assessment_priority_score` | New 0–100 artifact-depth priority |

## Tests

```bash
npm test
npm run typecheck
```
