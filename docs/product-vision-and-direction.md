# Product vision & technical direction — jobright-application-agent + tSearch

Mirror of `docs/product-vision-and-direction.md` in `skale-07/jobright-application-agent`
— keep both files identical when editing. This is a **living document**,
refreshed by a scheduled review. It is not a proof log or a phase-status doc
(those already exist per-repo — see the "Deeper detail" links below) — it
exists so both projects' vision, architecture, and direction stay legible
from one place, and so risks that only show up when you look at *both* repos
together (shared lineage, shared operator, shared data-handling posture)
don't get missed.

| Field | Value |
| --- | --- |
| Last reviewed | 2026-11-11 |
| Reviewed by | Scheduled agent review (automated) |
| Repos covered | `skale-07/jobright-application-agent` (private), `skale-07/tSearch` (**public**) |

---

## 1. jobright-application-agent

### 1.1 Vision

A **local, deterministic, operator-controlled** Playwright agent that automates
the mechanical parts of *your own* job-application workflow — JobRight.ai
discovery → employer ATS form fill → gated submit → outreach → Outlook
drafts — while keeping every judgment call (essays, demographics, uncertain
submissions) with a human. It is explicitly **not** trying to be a general
autonomous browser agent. The product bet is that determinism + fail-closed
gating + an honest validation ladder beats an LLM-driven agent for a task
where a wrong click (an accidental real submission, a leaked credential, an
invented EEO answer) is expensive and hard to undo.

> **Update 2026-11-03.** The scope above is the original vision. Since August the
> repo has grown a hosted/multi-tenant layer ("Dispatch": Supabase auth + DB,
> `frontend/`, tenant engine, Browserbase remote-browser spike, AWS control plane)
> and then, on 2026-09-23, an operator decision moved the engine into a **desktop
> app running on the user's own machine/Chrome** (AWS keeps only the LLM-metering
> proxy, static dashboard, update bucket; Azure and remote browsers dropped —
> `docs/roadmap/launch-checklist-2026-09-14.md`). Workday native autofill, screener
> banks, and opt-in essay/demographic fill (own encrypted profile only) now exist
> behind flags; see the repo `CLAUDE.md` (~35 fail-closed flags). The bullets in
> §1.2 that say "Greenhouse only" and "essays/demographics architecturally
> incapable of auto-fill" are **superseded** — essays fill when
> `ESSAY_AUTOFILL_ENABLED`/`SCREENER_PREDICT_LLM_ENABLED` is on, demographics only
> from the candidate's own encrypted sensitive profile.

### 1.2 Core technical details

- **Stack:** TypeScript / Node 20 / Playwright / better-sqlite3 / Zod / OpenAI (one narrow call site only — August; now also LLM screener/essay/triage call sites, each flag-gated). Frontend: Vite + shadcn.
- **Source of truth:** SQLite (`data/app.sqlite`) — queue state, transitions, leases, idempotency, review items. `state.json` is a read-only export, never a write target.
- **State machine:** `DISCOVERED → ELIGIBILITY_CHECK → QUEUED → inspect → fill → READY_TO_SUBMIT → SUBMITTING → SUBMITTED/SUBMISSION_VERIFICATION_FAILED → contacts/outreach → COMPLETED`, with `FAILED_RETRYABLE`/`FAILED_FINAL` terminals. Every transition is a DB event; uncertain submissions require a human `review:resolve` (three exits only — submitted / requeue / abandon — never automated).
- **Safety architecture:** every mutation capability sits behind a named fail-closed env flag (`FORM_FILL_ENABLED`, `SUBMIT_ENABLED`, `DRY_RUN`, etc. — full list in that repo's `CLAUDE.md`). `chromium.launch` is confined to three session-infra files. `check:forbidden` CI-fails the build if Outlook send APIs appear anywhere. Free-text/essay and demographic fields are architecturally incapable of being auto-filled — they route to `review_items`.
- **Validation ladder:** `UNIT_CONFIRMED → FIXTURE_CONFIRMED → LIVE_READ_ONLY_CONFIRMED → LIVE_MUTATION_CONFIRMED`, with `UNVERIFIED` as the honest default. A capability's self-reported success (including the fill-healer's) carries no level until independently verified. This ladder is the project's main defense against "fixture green" being mistaken for "live green."
- **ATS coverage today:** Greenhouse only (inspect + fill, live-path shipped, submit gated off). Workday/iCIMS/Oracle are detected and skipped. Lever/Ashby deferred. An "inert" Phase 6a agent-authoring sidecar exists to help *write* new adapters offline; it never drives a live page.
- **Lineage:** the session/storage layer was deliberately hardened from tSearch (see §3) — atomic JSON patterns and the lazy-session-open concept were ported and re-verified; tSearch's product logic (scoring, GitHub graph, olympiad data) was explicitly **not** ported.

### 1.3 Technical direction

Current state (2026-11-03): the project is well past "Phase 5.6" in practice — the
apply loop has run live (Workday applications, 125-cycle loops observed, ~600
loop cycles by 2026-09-23) and the latest merged work (PR #70, 2026-10-26) is the
**JobRight site map** (`docs/jobright-sitemap/`, `SITEMAP_CRAWL_ENABLED`, drift
check), human pacing + bot-block cooldown, picker fairness, and email
verification. Direction: desktop-app distribution, tenant-zero soak, launch
checklist. The Phase-5.6 text below is retained for history but
`docs/current-state-and-phase56.md` and `docs/known-limitations.md` have **not**
been updated to match (still say "zero live evidence" / C′ failing).

Original (August) framing — Phase **5.6 — live validation of already-built Phase 0–13 machinery.**
Nothing in 5.6 adds new capability surface; it exists to move already-shipped
code from `FIXTURE_CONFIRMED` to `LIVE_*_CONFIRMED` under an operator's hand.

- **Immediate blocker (workstream C′):** live JobRight feed discovery returns
  `jobs_inspected: 0` against a real session, while the identical parser
  handles the fixture capture fine. This is the single blocking defect for
  the whole product — every application in SQLite today is fixture-derived,
  so there is no live closed loop yet. Leading hypothesis: `storageState()`
  doesn't capture IndexedDB, and Google OAuth session state for JobRight may
  live there (see §5 for a concrete fix).
- **Next after C′:** re-confirm the (code-complete) CAPTCHA false-positive
  fix on a live Greenhouse board, then guarded live fill with submit still
  off.
- **Deliberately not in scope right now:** employer submit going live, essay
  generation, Outlook send (permanently out of scope, not just "not yet"),
  silent multi-ATS expansion, restoring the Phase 6 `autofillCompare` stash,
  or replacing the Greenhouse adapter with an LLM agent as the default path.
- **Longer arc (post-5.6):** Phase 6 constrained-agent fallback — *only* as a
  fill-assist for unsupported ATS (Workday first candidate), gated behind
  `AGENT_FALLBACK_ENABLED`, still passing through the same approved-plan +
  read-back verification gates. Not a replacement for the deterministic
  Greenhouse path, which stays the default.

Deeper detail (in `skale-07/jobright-application-agent`, not this repo):
`docs/architecture.md` · `docs/current-state-and-phase56.md` ·
`docs/known-limitations.md` · `docs/validation-levels.md`

---

## 2. tSearch

### 2.1 Vision

"Unseen talent discovery": find people whose ability shows up in public
artifacts (GitHub repos, technical writing) rather than credentials — starting
from named seeds (olympiad medalists, referrals), expanding outward through
their real collaboration graph (GitHub collaborators/followers, Substack),
scoring on evidence of building + thinking + pedigree, then running LLM
"judges" over their actual public work to produce a defensible, evidence-cited
priority score for a recruiter digest. The stated non-negotiable design
principle (`implementation-prompt.md`) is that every judgment must be
evidence-grounded and that missing evidence maps to `insufficient_public_evidence`,
never to a negative capability judgment — the system is built to avoid
confidently ranking someone down for something it simply couldn't see.

### 2.2 Core technical details

- **Stack:** TypeScript / Node / Playwright (headed, LinkedIn only) / Express + Vite (radial-graph UI) / OpenAI / Resend.
- **Pipeline:** `resolve identity (LinkedIn + website) → expand graph hop-1 (GitHub collaborators/followers, Substack) → optional hop-2 (UI-driven only) → score (final_score heuristic) → persist (candidates.json, profiles/, data/people/) → assess (LLM judges, priority_score) → digest email`.
- **Discovery/Assessment/Presentation separation is load-bearing:** assessment reads only the frozen `output/candidates.json` — it never re-runs LinkedIn discovery or corrects a wrong identity match. `final_score` (discovery) and `priority_score` (assessment) are deliberately never collapsed into one number.
- **Judge system:** rubric-YAML-driven (`rubrics/`), technical + writing judges running in parallel where both apply, then a cross-artifact/synthesis pass. Judges are instructed to coerce (demote/backfill) rather than hard-fail on missing evidence IDs.
- **Safety posture (updated 2026-11-03).** tSearch now has a `CLAUDE.md` (hard boundaries: no PII in git, frozen-input assessment, `--dry-run` default for digests, paced LinkedIn, mock-LLM default), a `LinkedInAuthError` fail-loud on session expiry, and `profiles/`/`backup/` are gitignored. Still no mechanical forbidden-API / pre-commit PII check equivalent to jobright's `check:forbidden` + `check:secrets`.
- **Added since August:** award registry + seed-source refresh, obscurity multiplier / age-relative impressiveness, youth wildcards, experience-distinctiveness judge, LLM tiered recruiter labels, digest sending from the UI (configurable from/to), reviewer feedback loop reordering digests, Supabase migrations, `tsearch-oracle` MCP + generated system brief.

### 2.3 Technical direction

- Digest feedback capture/ranking refinement (Phases 3–4 in
  `email-digest-implementation-context.md`) were "designed but not built" in
  August; per the system brief they now exist (reviewer feedback reorders
  digests, never rewrites `priority_score`). **Not re-verified this run.** Last
  tSearch commit is 2026-08-24 — the repo has been idle ~10 weeks.
- Per `all-agents-wiring-verification.md` (the most recent audit pass), the
  blog/writing/cross-artifact/Cory judge wiring that an earlier self-report
  had claimed as complete is now genuinely wired end-to-end and passes an
  offline 4-candidate smoke test — but the docs are explicit that this has
  **not** been proven safe for a full-size (~39 candidate) live run: GitHub +
  blog rate-limit and OpenAI cost exposure at that scale is untested.
  Phase-D GitHub helpers (PR files/reviews/CODEOWNERS/workflows) remain
  unwired. Priority-v2 scoring and the "Cory" persona calibration are both
  flagged `requires_calibration` — not yet trustworthy as a ranking signal
  on their own.
- Open product question the docs flag as unresolved: whether digest emails
  should surface global top-N candidates or per-seed neighbors, and whether
  Substack-only (no GitHub) candidates should be filtered out of the digest
  at all.

Deeper detail: [`docs/implementation-prompt.md`](./implementation-prompt.md) ·
[`docs/all-agents-wiring-verification.md`](./all-agents-wiring-verification.md) ·
[`docs/email-digest-implementation-context.md`](./email-digest-implementation-context.md)

---

## 3. How the two projects relate

jobright-application-agent is a **hardened descendant** of tSearch's session/
scraping infrastructure, not an unrelated project. That repo's
`docs/tsearch-reuse-map.md` records the original reuse plan: tSearch's
`saveSession.ts` / `linkedinBrowser.ts` concepts (manual storageState login,
lazy session open/validate) and atomic-JSON-store pattern were the seed for
jobright's `ServiceSession` and `src/storage/` layers, explicitly rebuilt
with more hardening (coverage statuses, mid-run auth checks,
traces/screenshots, no committed profile artifacts — a design choice that,
per §4 below, tSearch itself does not currently follow). tSearch's product
logic — olympiad scoring, GitHub graph expansion, the seed-tree UI — was
deliberately **not** ported; the two products solve different problems
(apply vs. discover) and share only the "safely drive a browser session
against a third-party site" substrate.

One document is now stale on this point: jobright's `docs/tsearch-reuse-map.md`
still describes porting `linkedinExtract.ts` into a `packages/linkedin-enrichment`
module "in Phase 10," but jobright's `current-state-and-phase56.md` records
that LinkedIn enrichment was **dropped by decision** for the MVP (JobRight
contact context only). Low-severity, but worth a one-line update to the
reuse map so a future reader doesn't plan around a decision that was already
reversed.

---

## 4. Risk triage

Severity reflects blast radius and reversibility, not effort to fix.

| Severity | Repo | Risk | Why it matters |
| --- | --- | --- | --- |
| **High** (was Critical) | tSearch | **Partially remediated.** `profiles/` and `backup/` were untracked and gitignored (commit `f5ad384`) and are absent at `main` tip, but **history was not purged**: 349 `profiles/`/`backup/` objects remain reachable via `git rev-list --all`, and the repo is public. | Scraped real-person LinkedIn data (names, URLs, photos, education) is still clonable from history. Needs `git filter-repo`/BFG + force-push (and cache-clear/GitHub support request for orphaned commits), or take the repo private. Operator decision required; not done by this routine. |
| **High** | jobright | Docs drift on the core claim: `known-limitations.md` / `current-state-and-phase56.md` still say live discovery returns 0 cards and "no live evidence for anything", while roadmap docs show weeks of live loop runs. Either C′ was resolved without the ladder being updated, or the docs are right and the loop runs on something else. | The repo's central discipline is the validation ladder; stale levels in both directions (under- and over-claiming) undermine it. Reconcile with a `sandbox-retest` pass and update levels. |
| **High** | jobright | READY_TO_SUBMIT livelock (2026-09-23): cold Workday rows re-fill for ~630s against a 300s deadline, are cooldown-exempt, and outrank everything, starving the queue. Picker-side fix landed, **live read-back pending** per the doc. | Burns browser time and essay LLM spend with zero submits; recurs every few hours. Confirm the fix live and add a regression guard. |
| **Medium** | jobright | Scope/architecture pivot (hosted engine → desktop app, 2026-09-23) leaves hosted-era code and docs (tenant engine, Browserbase, Azure) partly superseded; tenant-zero soak and Browserbase spike remain `UNVERIFIED`. | Dead-weight surface behind flags, and a launch checklist that mixes superseded and current steps. Mark/retire superseded milestones. |
| **Medium** | jobright | Vision doc "never auto-fill essays/demographics" is no longer true (opt-in, flag-gated). Safety rests on flags + `validateDraft` + own-encrypted-profile rule rather than architectural impossibility. | Acceptable by operator directive, but it is a weaker guarantee than August's framing; ensure tests keep flags off and the sensitive-profile path stays tenant-isolated. |
| **Medium** | tSearch | Ownership-share denominator bias (`assessment-rubric-architecture-audit.md`) — no evidence of a fix since August (no assessment commits after 2026-08-24; the system brief says ownership share is now omitted when no unfiltered sample exists, which mitigates but is not verified). | Silent scoring-correctness risk in `priority_score`. |
| **Medium** | tSearch | LinkedIn audit items: zero LinkedIn tests, no trace/screenshot on scrape failure, country not used to reject homonyms. Mid-run auth detection now exists (`LinkedInAuthError`). | Wrong-person matches and hard-to-diagnose live failures. |
| **Low** | jobright | CAPTCHA false-positive fix and live Greenhouse fill still not marked live-confirmed in docs. | Ladder discipline. |
| **Low** | tSearch | Open product questions (global vs per-seed top-N, Substack-only filtering) and Phase-D GitHub helpers remain unresolved; repo idle since 2026-08-24. | Drift risk; confirm whether tSearch is paused or active. |
| **Low** | both | `docs/tsearch-reuse-map.md` in jobright still describes a dropped LinkedIn-enrichment port; this doc is a mirror that must be kept identical in both repos. | Doc drift. |

---

## 5. Amendments worth considering (external scan)

**jobright-application-agent**

- **`storageState({ indexedDB: true })`** (Playwright ≥1.51) — directly targets
  the live-discovery blocker in §1.3/§4: Google OAuth session state for
  JobRight plausibly lives in IndexedDB, which default `storageState()`
  silently drops. Worth trying before deeper SPA-hydration-timing debugging.
  https://playwright.dev/docs/auth
- **Stagehand** (`browserbase/stagehand`) — a pattern more than a dependency
  recommendation: mixes deterministic Playwright code with narrow, *cached*
  LLM calls for one step (e.g. "find the equivalent field on this Workday
  form"), replaying deterministically once resolved instead of calling an
  LLM on every run. Closer architectural fit for the planned Phase 6
  constrained-fallback than a full autonomous agent. https://github.com/browserbase/stagehand
- **browser-use** — the concrete, widely-adopted library already named in
  that repo's own `browser-use-evaluation.md` as the Phase 6 candidate;
  external validation that it's a reasonable choice *scoped strictly to
  fill-assist*, with its output still required to pass through the existing
  approved-plan + `SUBMIT_ENABLED` + read-back-verify gates.

**tSearch**

- **Autorubric** (arXiv; now also an installable Python library, PyPI
  `autorubric` v1.0.0, 100+ providers via LiteLLM, few-shot calibration with
  verdict-balanced sampling and multi-judge ensembles — noted 2026-11-11, which
  turns this from "paper to read" into "dependency to trial" for the
  `requires_calibration` judges) — formalizes rubric-based LLM-judge design
  using psychometric/education-testing principles (decomposing criteria to
  avoid halo effects, per-criterion reliability measurement). Directly
  applicable to hardening the existing rubric YAML system and to actually
  measuring which judge dimensions are noisy, rather than assuming the
  rubric is well-calibrated. https://arxiv.org/html/2603.00077v2
- **Prometheus 2 / GLIDER** — open-source judge models purpose-trained for
  rubric-conditioned evaluation; GLIDER adds span-level explainability
  (which part of a repo or post triggered a score), which would let the
  recruiter digest show *why* a candidate scored well, not just the number.
- **GitHub-graph-first identity resolution** (pattern: `theArjun/github-social-graph`,
  GitHub GraphQL API over followers/stargazers/forks + NetworkX for
  community detection) — a ToS-compliant complement that could shift weight
  away from LinkedIn scraping as the primary signal. Worth noting: Proxycurl,
  a major LinkedIn-data API provider, was sued by LinkedIn and shut down in
  July 2025 — concrete, recent evidence that the ban/legal risk this repo's
  own README already flags under "LinkedIn caveats" is real and escalating,
  which strengthens the case for treating LinkedIn as a low-volume
  confirmation step rather than the primary discovery mechanism.

---

## Changelog

- **2026-08-07** — Initial creation. Full read of both repos' docs trees,
  git history, and current GitHub issue/PR state (both repos: zero open
  issues, zero open PRs at time of review). Verified the critical PII/public-repo
  finding directly (`git ls-files`, file content, repo visibility) rather
  than relying solely on subagent report.
- **2026-11-03** — Refresh. Open issues/PRs: zero in both repos. jobright:
  62 commits since August (hosted "Dispatch" layer → desktop-app pivot,
  site map, Workday native autofill, livelock fix); tSearch: 20+ commits, all
  by 2026-08-24, then idle. PII risk downgraded Critical → High (untracked,
  history not purged — verified `git rev-list --all`, 349 objects). §5
  external scan was **not re-run** this refresh (amendments carried over from
  August); rescan next run, particularly Playwright `indexedDB` storageState
  relevance now that C′ status is unclear. §1 text was amended with a dated
  update block rather than rewritten.
- **2026-11-05** — No-change check. Zero open issues/PRs in both repos; no new
  commits on tSearch `main` (last 2026-08-24) or jobright `master` (last
  2026-10-26) since the 2026-11-03 refresh. Risk table unchanged (PII history
  purge still pending — High). External scan refreshed: added RULERS (frozen,
  evidence-anchored rubric judge; arXiv 2601.08654) as a calibration approach for
  tSearch's `requires_calibration` judges, and re-confirmed Playwright
  `storageState({ indexedDB: true })` (v1.51+) as a fallback if jobright live
  auth regresses.
- **2026-11-07** — No-change check. Zero open issues/PRs in both repos; tSearch
  `main` still a52881b (2026-08-24), jobright `master` still 51008787 (2026-10-26).
  Risk table and amendments unchanged from 2026-11-05 (PII history purge still
  pending — High).
- **2026-11-09** — No-change check. Zero open issues/PRs in both repos; tSearch
  `main` still a52881b (2026-08-24), jobright `master` still 51008787 (2026-10-26).
  Risk table and amendments unchanged (PII history purge still pending — High;
  `profiles/`/`backup/` remain absent at `main` tip). No new risks surfaced.
- **2026-11-11** — No-change check. Zero open issues/PRs in both repos; tSearch
  `main` still a52881b (2026-08-24), jobright `master` still 51008787 (2026-10-26).
  PII finding re-verified directly: 349 `profiles/`/`backup/` objects still
  reachable in public history, 0 tracked at tip — High, purge still pending.
  Risk table otherwise unchanged. External scan (light): Autorubric has shipped
  as a PyPI library (v1.0.0) — §5 note updated; SAJA (ACL 2026 industry) adds a
  lightweight calibration head over judge outputs (reported 9B+SAJA ρ=0.70 vs
  raw GPT-4.1 ρ=0.60), a candidate approach for the `requires_calibration`
  judges; Playwright 1.64 (Oct 2026) is reported to include behavior-changing
  (non-additive) updates — check release notes before any Playwright bump in
  either repo.
