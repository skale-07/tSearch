# Integrate tSearch persistence with Supabase

Use this prompt when migrating tSearch off local JSON onto Supabase, or when wiring the hosted Vite UI to read from Supabase. Scaffolding already exists. Do **not** treat this as a greenfield schema.

Follow tSearch house rules: no PII in git; assessment reads a frozen candidate snapshot only; email stays `--dry-run` unless a human approves; LinkedIn pacing + cache; `npm run verify` before any commit; never `git add -f` `profiles/`, `data/`, `cache/`, `output/`, `cookies.json`, or `.env`.

## Current scaffolding (already in the repo)

- Config: `TSEARCH_STORE` defaults to `fs` in [`src/config.ts`](../../src/config.ts). `supabase` is parsed but **not implemented**.
- Server clients: [`src/storage/supabase/client.ts`](../../src/storage/supabase/client.ts) — `getSupabaseAdmin()` / `getSupabaseAnon()` return null without env; **throw** if `TSEARCH_STORE=supabase`.
- Vite seam: [`web/src/dataSource.ts`](../../web/src/dataSource.ts), [`web/src/supabaseClient.ts`](../../web/src/supabaseClient.ts). [`web/src/api.ts`](../../web/src/api.ts) `getWithRetry` calls `assertViteStoreImplemented()`.
- Schema: [`supabase/migrations/0001_init.sql`](../../supabase/migrations/0001_init.sql) — `people`, `profiles`, `tree_edges`, `candidates`, `marks`, `feedback`, `assessment_runs`. RLS enabled. anon/authenticated **deny-all**.
- Host: [`web/vercel.json`](../../web/vercel.json). Vercel Root Directory = `web`. Static SPA only.

JSON stores remain the source of truth until dual-write is proven:

- [`src/storage/personStore.ts`](../../src/storage/personStore.ts)
- [`src/storage/profileStore.ts`](../../src/storage/profileStore.ts)
- [`src/marks/markStore.ts`](../../src/marks/markStore.ts)
- [`src/digest/feedbackStore.ts`](../../src/digest/feedbackStore.ts)
- [`src/assessment/storage/assessmentRunStore.ts`](../../src/assessment/storage/assessmentRunStore.ts)
- frozen [`output/candidates.json`](../../src/config.ts) via `OUTPUT_PATH`

## Hard constraints (fail closed)

1. Keep `TSEARCH_STORE=fs` (and `VITE_TSEARCH_STORE=fs`) until dual-write is proven with tests. Do not flip the flag as the first commit.
2. Dual-write from the stores above. Do **not** delete JSON first. Do not add a “JSON import dump” committed to git.
3. Assessment still reads a **frozen candidate snapshot**, never live LinkedIn, even when that snapshot is a `candidates` row. Do not call resolve/expand from assessment code.
4. Swap [`web/src/api.ts`](../../web/src/api.ts) **GETs** (seeds, tree, profile, marks, candidates, assessment, feedback) to Supabase when `VITE_TSEARCH_STORE=supabase`. POSTs that spawn the pipeline (`/api/runs`, discovery resolve, website-graph ingest, assessment start) stay **local-only**. On Vercel those routes do not exist — return a clear client error, not a fake success.
5. RLS: no public `select` on `people` / `profiles` / `candidates` / `marks` / `feedback` / `assessment_runs` / `tree_edges`. Operator-only read for the hosted anon key, or a single authenticated user (magic link / GitHub OAuth). Auth UI is a prerequisite for loosening deny-all; do not open tables to `anon` “just to see the graph.”
6. Never commit `.env`, SQL dumps, or `profiles/` JSON. Never `git add -f` person data. Never put `SUPABASE_SERVICE_ROLE_KEY` in Vercel `VITE_` env or `web/.env`. Anon key only in the frontend.
7. Tests: JSON path still works with `TSEARCH_STORE=fs`; Supabase client tests mock the SDK / use local fake keys without hitting the network; `npm run verify` before commit.
8. Do **not** host Playwright, `cookies.json`, LinkedIn HTML, `cache/`, or LLM judge caches on Vercel or in Supabase. Those stay on the operator machine.

## Ordered work

### A. Project + secrets (human)

Operator creates a private Supabase project. Apply `0001_init.sql`. Put URL + anon in local `.env` / `web/.env` and Vercel env. Service role **only** in operator `.env` (and optional GitHub Actions secrets if a later sync job exists). Do not log keys.

### B. Dual-write (local pipeline)

1. Remove the “unimplemented” throw from [`src/storage/supabase/client.ts`](../../src/storage/supabase/client.ts) **only after** write helpers exist and tests cover `fs` still winning when the flag is `fs`.
2. After each successful `writeJsonAtomic` in person/profile/mark/feedback/candidate-merge/assessment-run, upsert the matching row with `getSupabaseAdmin()`. Failures must **log and not abort** the pipeline until cutover — JSON remains canonical.
3. Map columns to existing TypeScript types (`PersonRecord`, `ProfileRecord`, `SeedTreeEdge`, `Candidate`, `MarkRecord`, `FeedbackRecord`, `AssessmentRun`). Nested LinkedIn/GitHub stay `jsonb`. Do not invent a parallel product model.
4. Candidate rows are a **snapshot** of frozen `candidates.json`, not a live identity table.

### C. Dual-read (Express still in front)

Add read fallbacks behind `TSEARCH_STORE=supabase` for server tree/profile/marks/candidates APIs **after** writes are proven. Keep Express for local `npm run dev`.

### D. Hosted UI

When `VITE_TSEARCH_STORE=supabase`, [`web/src/api.ts`](../../web/src/api.ts) GETs go through [`getSupabaseBrowser()`](../../web/src/supabaseClient.ts) under RLS. Pipeline POSTs stay disabled in that mode (501-style message: run discovery on the operator machine).

Vercel: Root Directory `web`, env `VITE_SUPABASE_URL` + `VITE_SUPABASE_ANON_KEY` + `VITE_TSEARCH_STORE=supabase` only after C+D work and least-privilege read policies exist. No Express rewrite to `:8787`.

### E. Cutover (last)

Only then consider `TSEARCH_STORE=supabase` as default for a given operator machine. JSON can remain a cache. Do not drop local writes until a restore-from-Supabase path exists.

## Out of scope unless the user asks

- Creating the Supabase project or deploying Vercel (human).
- Hosting the scrape pipeline.
- Committing or uploading existing `profiles/` without an explicit PII review.
- Digest email behavior, LinkedIn pacing, or collapsing `final_score` / `priority_score`.
