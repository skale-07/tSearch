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
| Last reviewed | 2026-10-27 |
| Reviewed by | Scheduled agent review (automated) |
| Repos covered | `skale-07/jobright-application-agent` (private), `skale-07/tSearch` (**public**) |

---

## 0. Delta since 2026-08-07 (read this first)

**jobright-application-agent moved a lot (62 commits, last 2026-10-26); §1 below is partly stale.**
Evidence from `docs/roadmap/*`, the house-rules flag list and `src/` (35 modules):

- **Product pivot to "Dispatch"** (decision 2026-09-23, `launch-checklist-2026-09-14.md`): the engine ships in a
  *desktop app* (Windows first) running on the user's own machine/Chrome; AWS hosts only a control plane (metering
  LLM proxy, dashboard, update bucket); Supabase for auth/user DB; Azure and remote browsers dropped
  (`REMOTE_BROWSER_ENABLED` / Browserbase spike stayed `UNVERIFIED`). Hosted multi-tenant, signup/onboarding and
  free-quota enforcement are now in scope — the "single local operator" vision in §1.1 no longer describes it.
- **Capability surface expanded well past "Greenhouse only"**: Workday, Lever, native/JobRight autofill, essay
  generation (operator directive 2026-08-15), screener LLM prediction, outreach worker, Gmail/Outlook verification,
  `AUTOMATION_ENABLED` unattended auto-cycles, CDP autolaunch, a site-map crawler (`SITEMAP_CRAWL_ENABLED`) and
  the Phase-6 browser-use agent flags. Live apply loops have been run (a READY_TO_SUBMIT livelock was found live 2026-09-23).
  §1.2's "essays and demographics cannot be auto-filled" is **superseded** by the CLAUDE.md carve-outs (opt-in,
  validated, recorded on the plan entry; demographics only from the candidate's own encrypted profile).
- **Workstream C′ status unclear**: `known-limitations.md` still says live feed discovery returns zero cards, yet
  later commits (human pacing/bot-block cooldown, picker, sitemap) imply live runs. Needs the operator to close or
  re-state it. Also note Playwright now defaults `storageState` to include IndexedDB, so the §5 "indexedDB: true"
  hypothesis is likely moot.
- **tSearch**: 5 commits since last review (youth wildcards, corroborated GitHub, 1-10 score, Supabase
  marking/windowing, top-80 cut fix; last 2026-08-24). It now has `CLAUDE.md` house rules, `.mcp.json` oracle
  and `docs/system-brief.md`; the "no safety-flag layer" finding is **partly closed** (rules exist; still no
  fail-closed env-flag or forbidden-API check). PII was **untracked** in `f5ad384` (profiles/, backup/ now gitignored) but
  is **still in git history** (`git log --all -- profiles backup` returns commits).
- Open issues / PRs: **zero** in both repos (re-verified 2026-10-27; jobright PR search was not permitted by the API scope).

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

### 1.2 Core technical details

- **Stack:** TypeScript / Node 20 / Playwright / better-sqlite3 / Zod / OpenAI (one narrow call site only).
- **Source of truth:** SQLite (`data/app.sqlite`) — queue state, transitions, leases, idempotency, review items. `state.json` is a read-only export, never a write target.
- **State machine:** `DISCOVERED → ELIGIBILITY_CHECK → QUEUED → inspect → fill → READY_TO_SUBMIT → SUBMITTING → SUBMITTED/SUBMISSION_VERIFICATION_FAILED → contacts/outreach → COMPLETED`, with `FAILED_RETRYABLE`/`FAILED_FINAL` terminals. Every transition is a DB event; uncertain submissions require a human `review:resolve` (three exits only — submitted / requeue / abandon — never automated).
- **Safety architecture:** every mutation capability sits behind a named fail-closed env flag (`FORM_FILL_ENABLED`, `SUBMIT_ENABLED`, `DRY_RUN`, etc. — full list in that repo's `CLAUDE.md`). `chromium.launch` is confined to three session-infra files. `check:forbidden` CI-fails the build if Outlook send APIs appear anywhere. Free-text/essay and demographic fields are architecturally incapable of being auto-filled — they route to `review_items`.
- **Validation ladder:** `UNIT_CONFIRMED → FIXTURE_CONFIRMED → LIVE_READ_ONLY_CONFIRMED → LIVE_MUTATION_CONFIRMED`, with `UNVERIFIED` as the honest default. A capability's self-reported success (including the fill-healer's) carries no level until independently verified. This ladder is the project's main defense against "fixture green" being mistaken for "live green."
- **ATS coverage today:** Greenhouse only (inspect + fill, live-path shipped, submit gated off). Workday/iCIMS/Oracle are detected and skipped. Lever/Ashby deferred. An "inert" Phase 6a agent-authoring sidecar exists to help *write* new adapters offline; it never drives a live page.
- **Lineage:** the session/storage layer was deliberately hardened from tSearch (see §3) — atomic JSON patterns and the lazy-session-open concept were ported and re-verified; tSearch's product logic (scoring, GitHub graph, olympiad data) was explicitly **not** ported.

### 1.3 Technical direction

Current phase: **5.6 — live validation of already-built Phase 0–13 machinery.**
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
- **No safety-flag layer.** Unlike jobright, tSearch has no `CLAUDE.md`/house-rules file, no fail-closed env-flag convention, and no forbidden-API check. The closest equivalents are undocumented code-level conventions (`ASSESSMENT_MOCK_LLM`, `--skip-digest`, `digest:send --dry-run`). Given this pipeline does live scraping of a third-party site and sends real email via Resend, this is a structural gap relative to its sibling repo, not just a style difference.

### 2.3 Technical direction

- Digest delivery is currently a one-shot brief (Phase 1–2 of the documented
  4-phase roadmap in `email-digest-implementation-context.md`). Phases 3–4 —
  feedback capture (relevant / not relevant / explore-network) and
  ranking refinement from that feedback — are **designed but not built**.
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
| **Critical → High (partially mitigated)** | tSearch | Scraped real-people LinkedIn data (`profiles/`, `backup/`; 202 files) was committed and pushed to the **public** repo. 2026-10: files are untracked and gitignored (`f5ad384`), but **history still contains them** — anyone can `git checkout` an old commit or clone and read them. | Removal alone does not clear history. Still needed: `git filter-repo`/BFG purge + force-push, rotate/consider repo private until done, check forks/caches, and confirm `data/people/`, `cache/` were never tracked. Operator decision needed; not done by this routine. |
| **High (re-verify)** | jobright | Live JobRight feed discovery returned 0 cards (docs not updated since; later commits suggest live runs happened — operator to confirm C′ closed) against a real session while the fixture path works — every application in the DB today is fixture-derived, so the product has **never completed a live closed loop**. | This blocks the entire product, not one feature; it's the current top engineering priority per the repo's own docs (workstream C′). |
| **High** | tSearch | `assessment-rubric-architecture-audit.md` flags the ownership-share metric's denominator as the candidate's own commit count, which structurally biases toward false `primary_creator` attribution on any repo where the candidate is already a heavy committer. | This is a scoring-correctness bug in the exact mechanism recruiters are meant to trust; it's silent (no error, just a wrong number feeding `priority_score`). |
| **Medium (narrowed)** | tSearch | `CLAUDE.md` house rules now exist, but no env-flag convention or forbidden-API/PII-path CI check (e.g. a check that fails if `profiles/` is tracked) despite live third-party scraping and real outbound email via Resend. jobright's own `docs/tsearch-reuse-map.md` explicitly names "no committed profile artifacts" as one of the hardening improvements made *over* tSearch — a gap tSearch has evidently not closed on itself. | As the assessment/digest surface grows (feedback loops, more automation), the absence of an explicit gating convention increases the chance a future change accidentally auto-sends or auto-escalates something that should have needed a human. |
| **Medium** | tSearch | `tsearch-playwright-system-audit.md` (HIGH-severity items): no mid-run re-authentication detection on the LinkedIn session (a silently expired session can produce garbage extractions with no error), zero LinkedIn tests, no retry/trace/screenshot capture on scrape failures, and country is captured but never used to reject homonym mismatches. | Directly threatens data quality (wrong-person matches silently entering the candidate graph) and makes live failures hard to diagnose after the fact — same class of problem jobright already solved for its own live paths via traces/screenshots/read-back verification. |
| **Medium** | jobright | CAPTCHA false-positive fix and live Greenhouse fill are both code-complete and `FIXTURE_CONFIRMED` but not yet retested against a live board (workstream G). | Not urgent, but "fixed" language shouldn't be read as "proven" until the live retest closes the checkbox — consistent with the project's own validation-ladder discipline. |
| **High** | jobright | Doc/vision drift: `known-limitations.md`, `current-state-and-phase56.md` and `architecture.md` still describe a Greenhouse-only, no-essay, single-operator tool while the code runs Workday/Lever, essays, unattended automation and a hosted/desktop product. | The validation ladder is the repo's main defense; stale limitation lists make it impossible to tell which capabilities have live evidence. Reconcile with a per-capability ladder table. |
| **Medium** | jobright | Scope growth vs. the "deterministic, operator-controlled" bet: ~35 flags, unattended `AUTOMATION_ENABLED`, `ARTIFACT_AUTOPUSH_ENABLED` (dozens of `art:` commits of run artifacts) and multi-tenant data. | Autopushed artifacts in git risk leaking candidate/screenshot/PII data and bloating history; hosted users' sensitive profiles (EEO) raise the stakes of any gating regression. Audit autopush contents and keep submit gating tests heavy-gate mandatory. |
| **Medium** | tSearch | Scoring changed repeatedly (weights, youth wildcards, 1-10 score) without updated calibration; `requires_calibration` flags on priority-v2/Cory remain. | Recruiter-facing rank could drift silently; keep `final_score`/`priority_score` separation. |
| **Low** | tSearch | Digest-loop design (feedback capture → ranking refinement) is speced but unbuilt; open product questions (global vs. per-seed top-N, Substack-only filtering) are unresolved in the docs. | Not a defect, just unfinished direction — worth tracking so it doesn't silently drop off the roadmap. |
| **Low** | jobright | `docs/tsearch-reuse-map.md` still describes a Phase 10 LinkedIn-enrichment port that was later dropped by decision (§3). | Doc drift; a future reader could plan work against a stale decision. |

---

## 5. Amendments worth considering (external scan)

**jobright-application-agent**

- **`storageState` IndexedDB** (Playwright ≥1.51; a later change made inclusion the default, opt-out via `indexedDB: false`) — check the pinned Playwright version still matches; if C′ is still open, verify IndexedDB is actually captured — directly targets
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

- **Autorubric** (arXiv, 2025) — formalizes rubric-based LLM-judge design
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

- **2026-10-27** — Scheduled refresh. Added §0 delta; PII narrowed from tracked to history-only; added doc-drift, scope-growth and calibration risks. Both repos still have zero open issues. Search note: Stagehand v3 claims were not re-verified this run.
- **2026-08-07** — Initial creation. Full read of both repos' docs trees,
  git history, and current GitHub issue/PR state (both repos: zero open
  issues, zero open PRs at time of review). Verified the critical PII/public-repo
  finding directly (`git ls-files`, file content, repo visibility) rather
  than relying solely on subagent report.
