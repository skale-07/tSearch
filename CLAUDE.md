# CLAUDE.md — house rules for tSearch

tSearch is an unseen-talent-discovery system: resolve olympiad/named seeds on
LinkedIn (Playwright, headed), enrich from personal websites, expand a
GitHub/Substack collaboration graph, inspect people on a radial-tree UI,
run rubric-driven LLM judges over their public work, and email a recruiter
digest. Full architecture: `README.md`. Living vision/risk doc:
`docs/product-vision-and-direction.md`.

## Session start ritual

At the start of every session, before taking on the task:

1. Read `docs/product-vision-and-direction.md` (§4 Risk triage, §5 Amendments).
2. Check for a fresher copy on unmerged `claude/epic-pasteur*` branches —
   the scheduled triage routine pushes refreshes there every ~2 days
   (`git fetch && git branch -r --list '*epic-pasteur*'`).
3. Brainstorm 2–3 concrete implementations the triage findings suggest, note
   whether the current task advances or conflicts with any of them, and
   surface anything Critical/High to the user before starting.

## The coding loop

Work in small verified iterations, not big batches:

1. Make one focused change.
2. `npm run typecheck` — strict `tsc --noEmit`, must stay clean.
3. `npm run test` — vitest suite (`tests/`). Scope while iterating:
   `npx vitest run tests/assessment`, `tests/digest`, `tests/web`.
4. `npm run verify` — typecheck + full test run; the gate before any commit.
5. Commit small; repeat.

For continuous loops: `npx vitest` (watch mode) alongside edits, and
`npm run dev` (API :8787 + Vite :5173) when touching `server/` or `web/`.
Never conclude a change works from typecheck alone; never mark work done
with a failing gate.

## Hard boundaries (fail closed)

- **No PII in git — ever.** `profiles/`, `backup/`, `data/`, `cache/`,
  `output/`, `cookies.json`, `.env` are all gitignored and must stay so.
  This repo is public and previously leaked scraped LinkedIn profiles
  (see vision doc §4, Critical). Never `git add -f` any of these; if a new
  path stores scraped/derived person data, gitignore it in the same commit
  that creates it.
- **Assessment reads frozen `output/candidates.json` only.** It never
  re-runs LinkedIn discovery or corrects an identity match. Keep
  `final_score` (discovery) and `priority_score` (assessment) separate —
  never collapse them into one number.
- **Email sends are gated.** `digest:send` without `--dry-run` sends real
  email via Resend. Default to `--dry-run` in all automation, tests, and
  examples; a real send requires an explicit human go-ahead in the session.
- **LinkedIn scraping is the most fragile, highest-risk surface.** Respect
  `LINKEDIN_DELAY_MS` pacing and the `cache/` layer; never add an unpaced
  live-scrape loop, never bypass the cache to "refresh" in bulk
  (`FORCE_REFRESH=1` is for single targeted retries). Ban/captcha is an
  expected failure mode — code must degrade to cache, not retry-hammer.
- **LLM calls cost money.** Offline paths (`ASSESSMENT_MOCK_LLM=1`) are the
  default for tests and iteration; full-size live assessment runs need the
  user's explicit OK.

## Conventions

- Strong typing, `strict` mode; internal imports use `.js` extensions
  (NodeNext resolution).
- Config lives in `src/config.ts`, env-overridable, with defaults in code —
  document new vars in `.env.example`.
- Storage goes through `src/storage/` (`jsonStore` cache envelope,
  `personStore`/`profileStore` per-person records, atomic writes) — don't
  hand-roll `fs.writeFileSync` JSON persistence elsewhere.
- Console logging uses the `[stage] message` style.
- Comments explain constraints, not narration.
