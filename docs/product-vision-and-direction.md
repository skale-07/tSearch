# Product vision & technical direction — Dispatch + tSearch

Mirror of `docs/product-vision-and-direction.md` in `skale-07/tSearch`
— keep both files identical when editing. This is a **living document**,
refreshed by a scheduled review. It is not a proof log or a phase-status doc
(those exist per-repo — see "Deeper detail" links) — it keeps both projects'
vision, architecture, and direction legible from one place, and catches risks
that only show up looking at *both* repos together.

| Field | Value |
| --- | --- |
| Last reviewed | 2026-10-25 |
| Reviewed by | Scheduled agent review (automated) |
| Repos covered | `skale-07/dispatch` (private; formerly `jobright-application-agent`, old slug still redirects) · `skale-07/tSearch` (**public**) |

---

## 1. Dispatch (formerly jobright-application-agent)

### 1.1 Vision

**Changed materially since the 2026-10-01 review (hosted-engine removal, 09-28).** The hosted multi-tenant
plane described in the Sept reviews **no longer exists**. Commit `14db27d69`
(2026-09-28, "The hosted engine is removed: nothing here runs another
person's applications") deleted 31 source files / ~4,800 lines
(`src/tenants`, remote sign-in browser, Browser Use Cloud + its SDK dep,
hosted console, queue client, `deploy/engine.Dockerfile`). Dispatch is now a
**desktop app**: each person's deterministic engine runs on their own
machine, in their own browser, with their own session. The cloud side is a
thin **AWS control plane** (marketing/waitlist site, update feed, an LLM
metering proxy, observability, Supabase for sign-in/profile/status mirror) —
it holds a user's profile and application-status mirror, never runs
applications. This is a *narrowing* of the 09-01 split-plane decision and
consistent with the original thesis: determinism + fail-closed gating + an
honest validation ladder beats an autonomous agent where a wrong click is
expensive. Still explicitly not a general autonomous browser agent.

### 1.2 Core technical details

- **Stack:** TypeScript / Node 20 / Playwright / better-sqlite3 / Zod / Electron desktop shell (`desktop/`, packaged runner, OS-sealed device key, self-updater) / React frontend / AWS CloudFormation control plane (`deploy/aws/`) / Supabase.
- **Source of truth:** SQLite per device. State machine unchanged (`DISCOVERED → … → READY_TO_SUBMIT → SUBMITTING → SUBMITTED/…`); uncertain submissions need human `review:resolve`.
- **Safety architecture, tightened by the pivot:** console binds loopback only (no hosted switch); engine attaches over CDP to a browser on the same machine only; browsers launch with a reduced env (no secrets); self-identification data arrives sealed with the device key. Five flags (`CONSOLE_HOSTED_MODE_ENABLED`, `TENANT_ENGINE_ENABLED`, `REMOTE_BROWSER_ENABLED`, `BROWSER_USE_ENABLED`, `BROWSER_USE_AGENT_ENABLED`) are no longer read. `check:forbidden`, `assertExecutableApprovedEntry`, submit gating unchanged.
- **Validation ladder:** `docs/desktop-proof.md` (as of 2026-10-02) is now the per-capability index and is candid: **no person has signed in inside the installed app, the app's own loop has never run a cycle, the installer has never been run, no update has been downloaded by an installed app, and the signed macOS build has never been opened on a Mac.** Proven: packaged app boots (`LIVE_READ_ONLY`), page cannot reach the machine, mac build signed + notarized on CI (`LIVE_MUTATION`), profile pull for one path, model proxy admits/refuses/meters, update feed published (0.1.0, both platforms).
- **ATS coverage (carried from 09-25 independent grading, no new receipts found since):** Greenhouse and Ashby `LIVE_MUTATION_CONFIRMED`; Lever adapter real, not receipt-confirmed; Workday fill/navigation `LIVE_READ_ONLY` only — no automated `confirmed` submission receipt; iCIMS/Oracle skipped.
- **10-03 additions (12 non-autopush commits, version 0.1.1):** first-launch guided setup tour with profile built inside the app; every proxied model call runs on Sonnet, chooser calls on Haiku, applier prompt cache kept alive an hour; unopenable device key with nothing sealed under it is set aside and remade; Gmail draft step opens a Gmail session (not JobRight); Jev navigation-context scaffold (off by default); Route 53 DNS for the domain; waitlist page rewrite. No signing/artifact-policy change found — both High risks below still stand.
- **10-10 → 10-11 additions (7 non-autopush commits):** the model proxy now runs on OpenAI with the desktop's Anthropic-shaped calls translated (`686c95334`) — this **supersedes the 10-03 "every proxied call runs on Sonnet" note**; mark-applied menu is tied to its card and only a click costs an attempt (`7d71096eb`); bounded wait for the Workday apply page after portal auth (`be407a1c9`); Lever hidden-location re-pick after resume parse (`b3d092a85`); discovery only spends cycles on postings this build will apply to (`9a06361fe`); outreach worker records why a tail drafted nothing; fixture fills now write to a throwaway DB/artifacts dir instead of the operator's (`b4a210ff2`). No signing, artifact-policy or `desktop-proof.md` change — the High risks below still stand.
- **Recent engine fixes:** cold `READY_TO_SUBMIT` livelock (`8bb58f1bc`), wedged browser no longer burns Gmail verification attempts (`601c85023`), outreach v4, prompt caching.

### 1.3 Technical direction

Current phase: **ship the desktop beta.** Open on the critical path per `desktop-proof.md`: first in-app sign-in, first in-app loop cycle, installer run on a clean Windows box, first Mac launch, first real update download, production sign-in mail (SES sandbox), beta-site sign-in (redirect allow-list), wiring the outreach-drafts push and the web app's now-dead "Connect JobRight / Connect Gmail" buttons (enqueue work nothing leases). Phase 6 constrained-agent fallback remains a longer arc; Browser Use Cloud is gone, so Stagehand/Skyvern-style local options are the live candidates again.

Deeper detail (in the Dispatch repo): `docs/desktop-proof.md` · `docs/architecture.md` · `docs/validation-levels.md` · `docs/roadmap/cloud-deploy.md` · `docs/operator-guide.md`

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

**Codebase unchanged for a seventh consecutive review** — `origin/main` is
still at commit `a52881b` ("Isolate youth wildcards on Score and stop
dropping seed-tree neighbors below the top-80 cut"), same as every cycle since
2026-09-23 (dated 2026-08-24 — quiet for ~7 weeks). Everything below was independently re-verified against
source today rather than carried forward on trust.

- **Stack:** TypeScript / Node / Playwright (headed, LinkedIn only) / Express + Vite (radial-graph UI) / OpenAI / Resend / Supabase (sync work in progress, see §2.3).
- **Pipeline:** `resolve identity (LinkedIn + website) → expand graph hop-1 (GitHub collaborators/followers, Substack) → optional hop-2 (UI-driven only) → score (final_score heuristic) → persist (candidates.json, profiles/, data/people/) → assess (LLM judges, priority_score) → digest email → feedback (relevant / not relevant / explore-network)`.
- **Discovery/Assessment/Presentation separation is load-bearing:** assessment reads only the frozen `output/candidates.json` — it never re-runs LinkedIn discovery or corrects a wrong identity match. `final_score` (discovery) and `priority_score` (assessment) are deliberately never collapsed into one number.
- **Judge system:** rubric-YAML-driven (`rubrics/`), technical + writing judges running in parallel where both apply, then a cross-artifact/synthesis pass. Judges are instructed to coerce (demote/backfill) rather than hard-fail on missing evidence IDs.
- **Safety-flag layer exists on convention, still not on enforcement — reconfirmed today.** `package.json` has no `check:forbidden`-style script; `.husky/` doesn't exist; `.git/hooks/` contains only the default `.sample` files, nothing installed. Nothing mechanically stops a future commit from re-adding PII — exactly how the Critical risk below happened in the first place.

### 2.3 Technical direction

- No new development for a second straight cycle (codebase identical since 08-24). Carried forward from the last two reviews, all still accurate as of today:
  - **Digest feedback loop** (`src/digest/feedbackStore.ts`, `POST /api/feedback`, `GET /api/feedback/explore-queue`) is shipped and wired into `buildDigest.ts`. The global-top-N-vs-per-seed-neighbors question remains unresolved in the docs.
  - **Scoring model** is materially more sophisticated than the Aug 7 baseline: ownership-share fix, mid-run LinkedIn re-auth detection, an experience-distinctiveness judge, tiered recruiter labels, a conviction-in-writing rubric v2, an obscurity multiplier + age-relative impressiveness, an award registry, LinkedIn-connections capture, a restored Discover UI, and the youth-wildcard/top-80-cut fix. Priority-v2 and the "Cory" persona calibration remain flagged `requires_calibration` in the docs — no evidence found this cycle that external calibration tooling has been applied yet (see §5).
  - **Supabase sync** remains in-progress, uncommitted-shaped work (`docs/prompts/integrate-supabase.md`; most recent commit message is literally "current progress on window, supabase, marking changes"). Still worth tracking as an open workstream.
  - Phase-D GitHub helpers (PR files/reviews/CODEOWNERS/workflows) — still no new evidence either way; still unwired pending a closer look.
- **Two Medium gaps independently reconfirmed today by direct source read, not carried forward on trust:**
  - No retry/trace/screenshot capture anywhere in `src/linkedin/*.ts` on scrape failure (grepped for `retry|trace|screenshot`; the only unrelated hit is a rubric-tier code comment in `labelJudge.ts`).
  - Country is captured and used to *target* LinkedIn search (`isTargetedSearch`, confidence weighting pre-extraction) but the scraped profile's own extracted country/location, populated after `extractLinkedInProfile()` runs, is never compared back against the seed's expected country anywhere in `resolveIdentities.ts` — only name-match confirmation and a GitHub-login cross-check adjust confidence post-extraction. A homonym with the right name and wrong country would not be rejected.

Deeper detail: [`docs/implementation-prompt.md`](./implementation-prompt.md) ·
[`docs/all-agents-wiring-verification.md`](./all-agents-wiring-verification.md) ·
[`docs/email-digest-implementation-context.md`](./email-digest-implementation-context.md) ·
[`docs/system-brief.md`](./system-brief.md)

---

## 3. How the two projects relate

Dispatch is a **hardened descendant** of tSearch's session/scraping substrate
(manual storageState login, lazy session open, atomic JSON store); product
logic was deliberately not ported. They now also diverge in posture: Dispatch
is converging on a packaged, signed, per-device product with mechanical gates
(`check:forbidden`, `check:secrets`, pre-commit hook), while tSearch remains
a convention-only research tool on a public repo.

**Cross-cutting pattern:** docs lag shipped reality in both repos. Dispatch's
`known-limitations.md` (last touched 09-28 but still says "no live evidence
for any of them", "live JobRight feed returns zero cards", "Lever/Ashby
deferred", "Dashboard not started") contradicts its own newer
`desktop-proof.md`; `docs/tsearch-reuse-map.md` still says LinkedIn enrichment
is a Phase 2/10 port (dropped by decision) — flagged now for a 5th cycle.
Convention worth adopting: when a doc-named issue is fixed or a decision is
reversed, the doc gets one line saying so.

---

## 4. Risk triage

Severity reflects blast radius and reversibility. Resolved items are noted in
the changelog, not kept here.

| Severity | Repo | Risk | Why it matters |
| --- | --- | --- | --- |
| **Critical — unresolved, 16th cycle** | tSearch | Git history still holds scraped LinkedIn PII. Reverified 2026-10-13 (repo still public via API 2026-10-19): `f5ad384~1` still contains 202 `profiles/`+`backup/` files; commits `9b9a310`, `bc86684`, `bb366e7`, `700e2f6` are still ancestors of `origin/main`; 0 PII files tracked at HEAD; repo still **public** (`private:false`, `pushed_at` 2026-10-19 = review-branch pushes only; no PII at HEAD since `f5ad384`, 2026-08-10). | Anyone can clone and walk history unauthenticated. Needs `git filter-repo`/BFG + force-push (and collaborators re-clone), or make the repo private until purged. |
| **High — new** | Dispatch | **Windows installer is unsigned and the live update feed serves it** (`desktop-proof.md`: "The Windows installer there is unsigned"; `desktop/README.md`: "unsigned build can update itself"). `electron-builder.yml` has no Windows signing config and no update-signature pinning beyond the generic provider over HTTPS. | An auto-updater that applies unsigned/unverifiable binaries is a code-execution channel on every user's machine — and the app holds sealed ATS/Gmail-adjacent data. Also `runAsNode: true` and `asar: false` widen tamper surface. Get an Authenticode/EV (or Azure Trusted Signing) cert and make signature verification a hard gate before wider distribution. |
| **High — new** | Dispatch | `artifacts/` is tracked in git by the autopush path: 64,179 files incl. **16,929 resume-named PDFs** (was 59,203 / 15,379 on 10-05) (`artifacts/applications/*/materials/resume-*.pdf`), `.gitignore` has `# artifacts/` commented out. `CLAUDE.md` says "never commit … real resumes/PDFs". Repo is private today. | Direct conflict between the house rules and `ARTIFACT_AUTOPUSH_ENABLED` behavior; PII (resumes, application answers, receipts) sits in permanent history, repo size is 227 MB and growing ~1 commit/40s, and any visibility change, collaborator add, or CI log leak exposes it. Either amend the rule to name the exception (and keep the repo private permanently) or move artifacts to a separate private store/branch. |
| **High — carried** | Dispatch | `known-limitations.md`, `current-state-and-phase56.md`, README banner still describe a fixture-only, dashboard-less product; `browser-use-evaluation.md` still reads as a live decision though Browser Use Cloud code is now deleted. | Operators trust these to know what is live. `desktop-proof.md` is the accurate index; the older docs should be corrected or marked superseded. |
| **High — carried** | Dispatch | Workday: no automated `LIVE_MUTATION_CONFIRMED` receipt. | Capability claim ahead of evidence; gates themselves are intact. |
| **Medium — new** | Dispatch | Pivot leftovers: `CLAUDE.md` / `.cursor/rules/house-rules.mdc` still list the 5 removed flags (a test pins them as known-stale); `ESSAY_REQUIRED_GATE_ENABLED` still absent from the flag list; the web app's Connect JobRight/Gmail buttons enqueue work nothing processes; ignored `deploy/*/.env.engine` files hold a `TENANT_MASTER_KEY` and `private/tenants` may hold sessions sealed with it. | The house-rules flag list is the contract; stale entries and missing ones erode it. Dead UI buttons mislead users. Retire/rotate the leftover master key. |
| **Medium** | Dispatch | `DispatchAutoCycle` unattended mode: once `SUBMIT_REQUIRES_LOCAL_CONFIRMATION=false` and `MAX_UNATTENDED_SUBMISSIONS_PER_RUN>0`, it submits unattended; "explicit operator confirmation" then means a pre-authorized batch. | Operator should re-affirm. Matters more now that the same engine ships to other people's desktops — confirm these defaults can never be flipped by the app's UI. |
| **Medium** | Dispatch | JobRight live-feed `jobs_inspected: 0` hypothesis (IndexedDB in `storageState`) never confirmed tested; public-board discovery works around it. | Still open; see §5. |
| **Medium** | tSearch | Open HIGH items from the Playwright audit: no retry/trace/screenshot capture on scrape failure; scraped country never compared to seed country (homonym mismatch not rejected). | Wrong-person matches enter the graph; failures are hard to diagnose. |
| **Low** | tSearch | No mechanical enforcement of CLAUDE.md boundaries (no check script, no hook installed). | Nothing blocks a repeat of the PII incident. |
| **Low** | Dispatch | Autopush volume (~1 commit/40s during runs) buries real history; the artifacts count grew ~5k files in 6 days. | Related to the artifacts row; fix both together. |
| **Low** | both | `tsearch-reuse-map.md` stale (5th cycle); tSearch digest global-vs-per-seed question and Supabase sync unresolved. | Doc drift / open threads. |

**Resolved since last review:** hosted-plane risks (tenant master-key blast radius, Browser Use Cloud "Rejected" verdict mismatch, hosted-mode doc gaps) are moot — the hosted engine and Browser Use Cloud were removed. The 09-25 note that Dispatch had "no commits since 09-16" was wrong for the 10-01 review: ~70 real commits landed 09-23 → 10-02 (desktop app, control plane, signing); the earlier reviews' "codebase went quiet" reading is retracted.

---

## 5. Amendments worth considering (external scan)

**Dispatch**

- **Update-channel hardening for the Electron app.** Doyensec's [secure Electron updater write-up](https://blog.doyensec.com/2026/02/16/electron-safe-updater.html) and 2026 guidance ([Capgo signature verification](https://capgo.app/blog/signature-verification/)) converge on: signature verification as a hard requirement on every code-executing update path, download-to-temp → verify → atomic rename, public key embedded in the app, staged rollout channels. Directly addresses the unsigned-Windows-update High risk above; also consider flipping `onlyLoadAppFromAsar` once the packaged run is proven.
- **`storageState({ indexedDB: true })`** (Playwright ≥1.51, [release notes](https://playwright.dev/docs/release-notes)) — still the cheapest test of the JobRight live-session hypothesis; built for apps (Firebase-style) that keep auth tokens in IndexedDB.
- **Stagehand / Skyvern** as local, cached-LLM fill-assist for unsupported ATS now that Browser Use Cloud is deleted. Stagehand's Feb-2026 caching (a `cacheDir` replays recorded actions with no LLM call, DOM-hash validated, falls back to the model on page change; works locally) fits the Workday-first fallback: cache hits stay deterministic and every miss is an auditable event ([docs](https://docs.stagehand.dev/v3/best-practices/caching.md), [changelog](https://browserbase.com/changelog/stagehand-caching)). https://github.com/browserbase/stagehand · https://github.com/Skyvern-AI/skyvern

**tSearch**

- **Judge Reliability Harness** (RAND, [arXiv 2603.05399](https://arxiv.org/pdf/2603.05399): paraphrase/verbosity invariance, repeat-sample stability, ordinal calibration) with **Autorubric** ([arXiv 2603.00077](https://arxiv.org/html/2603.00077): Cohen's κ agreement, multi-judge ensembles) and and **CalibratedRubric** (arXiv 2607.29252) — still unapplied; direct match for the `requires_calibration` flags on Priority-v2 / "Cory". Worth scheduling.
- **GitHub-graph-first identity resolution** (`theArjun/github-social-graph` pattern) to reduce LinkedIn scraping dependence; LinkedIn's stipulated judgment against ProAPIs (2026-09-16) is current evidence of active enforcement ([source](https://therecord.media/linkedin-wins-court-order-blocking-mass-scraping)).

---

## Changelog

- **2026-10-25** — Seventeenth scheduled review; no material change. tSearch `main` still `a52881b` (2026-08-24), repo still **public** (API `private:false`, `pushed_at` 2026-10-23 = review-branch pushes only), `f5ad384~1` (202 `profiles/`+`backup/` files) still an ancestor of `main`; 0 PII files tracked at HEAD (Critical, 17th cycle). Dispatch `master` head still `67057fde` (2026-10-11, autopush), 0 commits since 10-12; `artifacts/` still tracked (64,179 files), unsigned-Windows-updater High risk stands. Both repos: 0 open issues, 0 open PRs. External scan skipped (rescanned 10-11). Base text is the 10-23 refresh from the `vj3xq1` branches, carried onto this cycle's `hhe6uh` branches.

- **2026-10-23** — Sixteenth scheduled review; no material change. tSearch `main` still `a52881b` (2026-08-24), repo still **public** (API `private:false`, `pushed_at` 2026-10-21 = review-branch pushes only), `f5ad384~1` still holds the scraped `profiles/`+`backup/` data and is still an ancestor of `main` (Critical, 16th cycle). Dispatch `master` head still `67057fde` (2026-10-11, autopush), 0 commits since 10-12; `artifacts/` still tracked (64,179 files), `# artifacts/` still commented out; `desktop-proof.md`/`electron-builder.yml` untouched, so the unsigned-Windows-updater High risk stands. Both repos: 0 open issues, 0 open PRs. External scan skipped (rescanned 10-11). Base text is the 10-21 refresh from the `z7jm3y` branches, carried onto this cycle's `vj3xq1` branches.

- **2026-10-21** — Fifteenth scheduled review; no material change. tSearch `main` still `a52881b` (2026-08-24), repo still **public** (API `private:false`), scraped-PII commits still in history (Critical, 15th cycle). Dispatch `master` head still `67057fde6` (2026-10-11, autopush); no non-autopush commit since `7d71096eb` (2026-10-10); `artifacts/` still tracked (64,179 files), `# artifacts/` still commented out in `.gitignore`; unsigned-Windows-updater High risk stands. Both repos: 0 open issues, 0 open PRs. External scan skipped (rescanned 10-11). Base text is the 10-19 refresh from the `v32gis` branches, carried onto this cycle's `z7jm3y` branches.

- **2026-10-19** — Fourteenth scheduled review; no material change. tSearch `main` still `a52881b` (2026-08-24), repo still **public** (API `private:false`, `pushed_at` 2026-10-17 = review-branch pushes only), scraped-PII commits still in history (Critical, 14th cycle). Dispatch `master`: last commit 2026-10-11 (autopush), no non-autopush commit since `7d71096eb` (2026-10-10); `artifacts/` still tracked (64,179 files, `# artifacts/` still commented out); `desktop-proof.md`/`electron-builder.yml` untouched, so the unsigned-Windows-updater High risk stands. Both repos: 0 open issues, 0 open PRs. External scan skipped (rescanned 10-11). Base text is the 10-17 refresh from the `w691mc` branches, carried onto this cycle's `v32gis` branches.

- **2026-10-17** — Thirteenth scheduled review; no material change. tSearch `main` still `a52881b` (2026-08-24), repo still **public** (API `private:false`), scraped-PII commits still in history (Critical, 13th cycle). Dispatch `master`: no non-autopush commit since 2026-10-10/11; `artifacts/` still tracked (64,179 files), `# artifacts/` still commented out in `.gitignore`; unsigned-Windows-updater High risk stands. New unmerged branch `jobright-feed-touchups` seen on Dispatch (not reviewed in depth). Both repos: 0 open issues, 0 open PRs. External scan skipped (rescanned 10-11). Base text is the 10-15 refresh from the `7ndl5l` branches.

- **2026-10-15** — Twelfth scheduled review; no material change. tSearch `main` still `a52881b` (2026-08-24), repo still **public** (API `private:false`), scraped-PII commits still in history (Critical, 12th cycle). Dispatch: no non-autopush commit since `7d71096eb`-era work (2026-10-10/11); the unsigned-Windows-updater and tracked-`artifacts/` High risks stand (no changes to `desktop-proof.md`, `electron-builder.yml` or `.gitignore`). Both repos: 0 open issues, 0 open PRs (re-checked via API). External scan skipped (rescanned 10-11). Base text is the 10-13 refresh from the `e81bw8` branches, carried onto this cycle's `7ndl5l` branches.

- **2026-10-13** — Eleventh scheduled review; no material change. tSearch `main` still `a52881b` (2026-08-24), repo still **public** (`private:false`, API `pushed_at` 2026-10-11 = review-branch pushes only), scraped-PII commits still in history (Critical, 11th cycle). Dispatch: no non-autopush commit since `7d71096eb` (2026-10-10); `artifacts/` still tracked (64,179 files / 16,929 resume-named PDFs, `# artifacts/` still commented out); `desktop-proof.md` and `electron-builder.yml` untouched, so the unsigned-Windows-updater High risk stands. Both repos: 0 open issues, 0 open PRs. External scan skipped (rescanned 10-11). Base text is the 10-11 refresh from `epic-pasteur-uuqtk0`, carried onto this cycle's `e81bw8` branches.

- **2026-10-11** — Tenth scheduled review. tSearch `main` still `a52881b` (2026-08-24); repo still **public**; scraped-PII commits still in history (Critical, 10th cycle; re-verified `f5ad384~1` holds 202 files). Dispatch had 7 real commits 10-10/10-11 (model proxy moved to OpenAI, Workday/Lever fixes, mark-applied, discovery filtering, fixture isolation) — none touch the open High risks; `artifacts/` grew to 64,179 tracked files / 16,929 resume-named PDFs and `# artifacts/` is still commented out. Both repos: 0 open issues, 0 open PRs. External scan: added Stagehand's caching mechanics and Autorubric to §5. The Dispatch-repo copy of this file had drifted to a pre-pivot text; both copies are now re-synced to this version.

- **2026-10-09** — Ninth scheduled review; no material change. tSearch `main` still `a52881b` (2026-08-24), repo still **public**, PII commits still in history (Critical, 9th cycle). Dispatch `master` has no non-autopush commit since 2026-10-03 (`b324c33c2`); `artifacts/` still tracked (59,203 files, `# artifacts/` still commented out), Windows build still unsigned per `desktop-proof.md`. Both repos: 0 open issues, 0 open PRs. External scan skipped (rescanned 10-05). This copy is the 10-05 refresh carried onto this cycle's `u8w8rc` branches, since earlier refreshes never reached `main`/`master`.

- **2026-10-05** — Eighth scheduled review. tSearch unchanged (`a52881b`, 08-24), still public, PII commits still in history (Critical, 8th cycle). Dispatch: 12 real commits 10-03 (desktop 0.1.1: onboarding tour, model-tier routing, device-key recovery, Gmail-draft session fix, DNS); unsigned Windows installer and tracked `artifacts/` (59,203 files, 15,379 resume PDFs, `# artifacts/` still commented out in `.gitignore`) re-verified unchanged. Both repos: 0 open issues, 0 open PRs. External scan: no new finds beyond §5.

- **2026-10-03** — Seventh scheduled review. **Dispatch changed a lot; the repo was not quiet.** Hosted engine removed (09-28), product is now a desktop app + AWS control plane; signed/notarized Mac build, update feed live, waitlist + beta site up (10-02). New risks: unsigned Windows installer served by the update feed (High); `artifacts/` with 15k resume PDFs tracked in git, contradicting the house rules (High). Vision/§1 rewritten; hosted-plane risks retired. tSearch unchanged since 08-24 (`a52881b`), still public, PII commits still in history (Critical, 7th cycle). Both repos: 0 open issues/PRs (Dispatch API slug is now `skale-07/dispatch`).

- **2026-10-01** — Sixth scheduled review; no material change. tSearch: `main`
  still at `a52881b` (2026-08-24), repo still **public**, zero issues/PRs.
  Dispatch (`jobright-application-agent`): `master` head is a 2026-09-28
  `(autopush)` artifact commit; no code/docs commits since 2026-09-16; zero
  issues/PRs. The 4 history commits carrying scraped LinkedIn PII are still
  ancestors of `origin/main` — Critical risk unchanged (6th cycle). The
  Dispatch status-doc staleness (High) and Workday receipt gap (High) are also
  unchanged. External scan skipped (rescanned 2026-09-29, nothing new). This
  file re-pushed to this cycle's `claude/*-yqhds8` branches in both repos so
  both copies read current.
- **2026-09-29** — Fifth scheduled review; no material change. tSearch: still
  at `a52881b` (2026-08-24), no commits, zero issues/PRs. Dispatch
  (`jobright-application-agent`): only `(autopush)` artifact commits
  (automation-session/auto-cycle reports, ~1 per 40 s on 2026-09-28) — no
  code or docs commits since 2026-09-16 — zero issues/PRs. Reverified
  tSearch PII: untracked at `main` HEAD since `f5ad384` (2026-08-10) and
  `profiles/`+`backup/` are gitignored, but 4 earlier commits still carry
  the scraped data in history, and the repo is still **public** — Critical
  risk unchanged (5th cycle). New observation (Low): Dispatch's autopush
  volume bloats `master` history and buries real commits; consider
  batching/squashing artifact pushes or moving them to a separate branch.
  No external-scan changes.
- **2026-09-27** — Fourth scheduled review. Both codebases are unchanged
  since the last cycle (Dispatch: no non-autopush commit since `9a9a5843b`,
  2026-09-16; tSearch: still at `a52881b`, 2026-08-24), so this review is
  independent-reverification-plus-doc-maintenance rather than a fresh
  audit. Reconfirmed directly against source/API today, not carried forward
  on trust: the tSearch PII git-history exposure (same 4 commits, repo still
  public, `pushed_at` 2026-09-25) is unresolved for a **fourth** cycle;
  Dispatch's `known-limitations.md`/`current-state-and-phase56.md`/
  `browser-use-evaluation.md` are all still last-edited 2026-08-07, unchanged;
  both repos still show zero open issues and zero open PRs. The concrete
  action this cycle: this vision doc — whose Dispatch-repo copy had been
  stuck at "Last reviewed 2026-08-07" for two full cycles because the
  2026-09-23 and 2026-09-25 refreshes only ever landed on unmerged
  tSearch-side branches — is now pushed to both repos' active feature
  branches (`claude/busy-clarke-sfxscd` in Dispatch, `claude/epic-pasteur-sfxscd`
  in tSearch), closing that specific propagation gap; the underlying
  staleness in the docs it's *about* is untouched and remains the High risk
  in §4. A light external rescan (Workday-automation tooling,
  git-history-purge practice) found nothing new in the 2-day window; all §5
  amendments are carried forward unchanged.
- **2026-09-25** — Third scheduled review. Two parallel deep-dive agents
  independently audited each repo since the 09-23 cycle; tSearch's five
  carried-forward findings were all independently reconfirmed against
  source/git today (not taken on trust). Dispatch's clone was unshallowed
  for the first time (2,825 commits vs. the prior 50), surfacing ~5 weeks of
  real feature work the last two reviews couldn't see from git alone:
  Workday/Lever ATS adapters, a dashboard/onboarding wizard, and an
  AWS/Azure-hosted multi-tenant plane with Browser Use Cloud v4 — all real
  and mostly well-reasoned in scattered docs, but landing on top of core
  status docs (`known-limitations.md`, `current-state-and-phase56.md`,
  README's banner, and this doc's own Dispatch-repo copy) that hadn't been
  touched since 2026-08-07. Headline findings: (1) Dispatch's status docs
  are broadly, not narrowly, stale — reframed from last cycle's single
  "Employer Submit scope" contradiction; (2) Workday reaches real employer
  forms but has no automated live-mutation receipt yet, a capability-overclaim
  risk distinct from the doc-staleness one; (3) a security "Rejected" verdict
  on Browser Use Cloud was silently reversed by shipped code with no doc
  update — the same silent-reversal pattern CLAUDE.md itself handles
  correctly elsewhere, just not here; (4) tSearch's Critical PII exposure
  remains fully unresolved for a third straight cycle, independently
  reverified at the object level today. Both repos: zero open issues, zero
  open PRs.
- **2026-09-23** — Second scheduled review. Two parallel deep-dive agents
  independently audited each repo's git/doc state since 2026-08-07; findings
  cross-checked directly (git history object walk and gitignore state for
  the tSearch PII item, GitHub API redirect + package.json/README for the
  Dispatch rename, source-level fix verification for the ownership-share
  bug) rather than taken on the subagents' word alone. Both repos: zero open
  issues, zero open PRs. Headline changes: the tSearch Critical PII risk is
  **not** resolved (history never purged, repo still public — a second
  consecutive review flagging the same live exposure); the ownership-share
  bug and the digest feedback loop **are** resolved; Dispatch was renamed
  end-to-end and appears to have shipped real live-mutation submissions
  while its own phase-status docs still describe submit as out of scope —
  flagged as a new High-severity doc-contradiction / possible scope-creep
  risk. New cross-cutting observation: both repos independently let
  audit/status docs go stale after the underlying issue was fixed. (This
  refresh was authored on an unmerged `claude/epic-pasteur-jdjpiy` branch
  and did not propagate to the Dispatch repo's copy of this file until the
  following cycle — see the 2026-09-25 entry above.)
- **2026-08-07** — Initial creation. Full read of both repos' docs trees,
  git history, and current GitHub issue/PR state (both repos: zero open
  issues, zero open PRs at time of review). Verified the critical PII/public-repo
  finding directly (`git ls-files`, file content, repo visibility) rather
  than relying solely on subagent report.
