# Product vision & technical direction — Dispatch + tSearch

Mirror of `docs/product-vision-and-direction.md` in `skale-07/tSearch`
— keep both files identical when editing. This is a **living document**,
refreshed by a scheduled review. It is not a proof log or a phase-status doc
(those already exist per-repo — see the "Deeper detail" links below) — it
exists so both projects' vision, architecture, and direction stay legible
from one place, and so risks that only show up when you look at *both* repos
together (shared lineage, shared operator, shared data-handling posture)
don't get missed.

| Field | Value |
| --- | --- |
| Last reviewed | 2026-09-29 |
| Reviewed by | Scheduled agent review (automated) |
| Repos covered | `skale-07/jobright-application-agent` — now shipping as **Dispatch** (private; GitHub redirects the old slug, `full_name` still resolves via 301) · `skale-07/tSearch` (**public**) |

---

## 1. Dispatch (engine: the application agent, repo slug still `jobright-application-agent`)

### 1.1 Vision

A **local, deterministic, operator-controlled** Playwright agent that automates
the mechanical parts of *your own* job-application workflow — JobRight.ai /
public ATS-board discovery → employer ATS form fill → gated submit → outreach
→ Outlook drafts — while keeping every judgment call (essays, demographics,
uncertain submissions) with a human. It is explicitly **not** trying to be a
general autonomous browser agent. The product bet is that determinism +
fail-closed gating + an honest validation ladder beats an LLM-driven agent
for a task where a wrong click (an accidental real submission, a leaked
credential, an invented EEO answer) is expensive and hard to undo.

**Material update (surfaced 2026-09-25, still current — no new commits since):
the vision has expanded from "local tool" to "local engine + an
operator-approved hosted plane," and the two reviews before that one had git
tooling too shallow to see it.** That review unshallowed the clone
(previously depth-50, all-autopush) and found the real commit history:
Workday/Lever fill work, a frontend dashboard/onboarding wizard, and an
AWS/Azure-hosted multi-tenant plane all shipped between 2026-08-11 and
2026-09-16, none of it visible from the shallow clone the prior review had
to work from. `docs/roadmap/cloud-deploy.md` records the hosted-plane pivot
as a deliberate, approved decision ("operator direction 2026-09-01"), with
an explicit split-plane rule: the operator's own local `private/`, ATS
credentials, vault, and LLM keys never leave the operator's machine; a
hosted *user's* own onboarded data may cross to the hosted plane, "that is
correct and expected." So this is a real, reasoned pivot, not silent scope
creep — but see §1.3 and §4 for how badly the *status docs* have lagged it.

**Naming note (unchanged from last cycle):** the product is **Dispatch**
end-to-end — `package.json` (`"name": "dispatch"`), `README.md`
title/branding, in-app copy, and the GitHub repo itself (the old
`jobright-application-agent` API path 301-redirects). `CLAUDE.md` still never
mentions "Dispatch" by name — unchanged, still low severity (§4).

### 1.2 Core technical details

- **Stack:** TypeScript / Node 20 / Playwright / better-sqlite3 / Zod / OpenAI (one narrow call site only). Shipped since the 08-07 baseline (surfaced 09-25, unchanged since): an AWS/Azure-hosted engine image, a frontend dashboard + onboarding wizard, and Browser Use Cloud v4 as an optional remote-browser provider for the hosted plane.
- **Source of truth:** SQLite (`data/app.sqlite`) — queue state, transitions, leases, idempotency, review items. `state.json` is a read-only export, never a write target.
- **State machine:** `DISCOVERED → ELIGIBILITY_CHECK → QUEUED → inspect → fill → READY_TO_SUBMIT → SUBMITTING → SUBMITTED/SUBMISSION_VERIFICATION_FAILED → contacts/outreach → COMPLETED`, with `FAILED_RETRYABLE`/`FAILED_FINAL` terminals. Every transition is a DB event; uncertain submissions require a human `review:resolve` (three exits only — submitted / requeue / abandon — never automated).
- **Safety architecture — re-verified directly today, not just carried forward:** every mutation capability sits behind a named fail-closed env flag. `chromium.launch`/`launchPersistentContext` calls are confined to exactly `src/auth/loginFlow.ts`, `src/auth/serviceSession.ts`, and `src/browser/fixtureSession.ts` (grepped today). `check:forbidden`/`src/outlook/sendGuards.ts` are unweakened (the only change to the scanner since baseline is a narrow, justified `.claude/`-scope exclusion, `15367adb8`, 2026-09-01). The pre-commit hook is installed (`core.hooksPath` → `.githooks/`, confirmed today) and still hard-blocks on `check:secrets`. Submit gating (`assertExecutableApprovedEntry`, `SUBMIT_ENABLED`, approved plan entry) is unchanged and applies identically to every ATS adapter including Workday. One drift, reconfirmed present today: `.env.example`'s `ESSAY_REQUIRED_GATE_ENABLED` (a real, live, fail-closed-by-default pipeline hard-stop, `src/config/env.ts`) still isn't in `CLAUDE.md`'s enumerated flag list.
- **Validation ladder:** `UNIT_CONFIRMED → FIXTURE_CONFIRMED → LIVE_READ_ONLY_CONFIRMED → LIVE_MUTATION_CONFIRMED`, `UNVERIFIED` as the honest default. Applied to Workday specifically (see §1.3), surfaced 09-25 and unchanged since, rather than taken from the repo's own framing.
- **ATS coverage today, independently re-graded against artifacts, not doc claims:**
  - **Greenhouse, Ashby:** `LIVE_MUTATION_CONFIRMED` real submissions with receipts (Neuralink, Old Mission, DV Trading via Greenhouse; Exa via Ashby — unchanged from last cycle).
  - **Lever:** adapter is real and actively hardened (`fix(lever+picker): Lever's hidden location selection is the commit`, 2026-09-14) — status between `FIXTURE_CONFIRMED` and live; no receipted live submission found this cycle, treat as not yet `LIVE_MUTATION_CONFIRMED`.
  - **Workday:** a full, real adapter exists (sign-in, My Information, My Experience rows from the candidate's structured history, resume upload, final wizard submit click) and reaches real employer tenants (Intel's `myworkdayjobs.com` board, live artifacts dated 2026-09-15). But all 6 automated submit attempts captured in `artifacts/applications/e52e2060-.../submission/submit-run-{1..6}.json` for that application ended `REFUSED`/`FAILED_BEFORE_CLICK`/`UNCERTAIN` — **none was auto-verified `confirmed`** by `workdayVerifySubmission`. A later report shows that same application as `SUBMITTED`, most likely via a human `review:resolve`, not an automated receipt. Honest grade: **`LIVE_READ_ONLY_CONFIRMED` for fill/navigation; no `LIVE_MUTATION_CONFIRMED` automated Workday receipt found.** This is a step below what "Workday support" reads as in commit messages and the README — flagged as a High risk in §4, not because the safety gates are weak (they aren't — same gates as every adapter) but because the *capability claim itself* is ahead of the evidence.
  - iCIMS/Oracle: still detected and skipped.
- **Lineage:** the session/storage layer was deliberately hardened from tSearch (see §3) — atomic JSON patterns and the lazy-session-open concept were ported and re-verified; tSearch's product logic (scoring, GitHub graph, olympiad data) was explicitly **not** ported.

### 1.3 Technical direction

**Standing finding, reconfirmed unchanged this cycle: the product's own status docs are badly, broadly stale — not just on one section, on nearly everything.** `docs/known-limitations.md`, `docs/current-state-and-phase56.md`, and `docs/browser-use-evaluation.md` are all still last edited 2026-08-07 (`a41dad019`) — reconfirmed by direct `git log` today, zero non-autopush commits have landed on `master` since `9a9a5843b` (2026-09-16). They still assert, in the present tense, things that are false by the repo's own evidence: "live JobRight feed discovery currently returns zero cards" (superseded — see below), "Dashboard not started" (a dashboard shipped, `915ebf092`), and "Lever/Ashby/Workday fill: Deferred" (all three now have real adapters, §1.2). `README.md`'s own "Current state" banner, still dated 2026-08-31, is now ~4 weeks stale relative to the Sept 14–16 hosted/tenant/Workday-experience work and mentions none of it. **This copy of the vision doc, in the Dispatch repo itself, was found stuck at "Last reviewed 2026-08-07" going into today's review** — the 2026-09-23 and 2026-09-25 refreshes both only ever landed on unmerged tSearch-side branches (see the session-start ritual in `tSearch/CLAUDE.md`) and were never propagated here, the exact failure mode that ritual step exists to catch. **This review closes that specific gap**: this file is now pushed to both repos' active feature branches (`claude/busy-clarke-sfxscd` here, `claude/epic-pasteur-sfxscd` in tSearch) so a reader landing in either repo sees the current version, not a stale copy. That's a process fix, not a content one — the underlying doc-staleness problem in `known-limitations.md` et al. is unchanged and still needs a real editing pass, not just a re-push of this file.

Net read on the underlying JobRight-feed question: no new evidence either way on the original `storageState()`/IndexedDB hypothesis (§5 still has the concrete fix) — still open. What *is* confirmed is that the product moved forward on the public-board-discovery workaround before the codebase went quiet on 2026-09-16, and on that path shipped real submissions across three ATS platforms and stood up an entire hosted plane — while its own core status docs still describe a fixture-only, dashboard-less product. Given this project's whole value proposition is disciplined, legible, one-phase-at-a-time progression, docs this stale aren't cosmetic — they're the mechanism an operator would use to know what's actually safe/live, and right now that mechanism is unreliable.

- **Hosted plane is a real, approved decision — but one dependent doc was never updated to match it.** `docs/roadmap/cloud-deploy.md` documents the split-plane architecture and its approval clearly (see §1.1). However `docs/browser-use-evaluation.md` still says, verbatim, that Browser Use Cloud was **"Rejected"** because a session/PII would leave the operator's machine, "contradicts `security.md`." Commit `daa96b370` ("Browser Use Cloud v4 as a remote-browser provider") reverses that verdict — defensibly, since in the hosted-plane context it's the *user's own* remote browser for their *own* JobRight session, not the operator's local one — but the reversal was never written back into `browser-use-evaluation.md`, so a reader hitting that doc cold would reasonably conclude the integration that now exists is banned. `docs/security.md` doesn't mention hosted mode at all. This is the same "a decision changes and the doc that named the old decision never gets a closing note" pattern flagged for tSearch's audit docs last cycle (§3) — now confirmed happening inside Dispatch too, on a security-relevant call this time.
- **`DispatchAutoCycle` (the unattended scheduler) does not weaken submit gating — but "explicit operator confirmation" in that mode means a pre-authorized batch, not a live per-submission click, and that's worth the operator explicitly re-affirming.** It's a plain Windows Scheduled Task running `npm run auto:cycle` every 4 hours (`docs/operator-guide.md:1719`); it refuses to run with any capability flag missing and refuses while `SUBMIT_REQUIRES_LOCAL_CONFIRMATION=true` (the default). Submit still requires `SUBMIT_ENABLED`, an approved plan entry, and `--yes`; unattended `--yes` submission additionally requires `MAX_UNATTENDED_SUBMISSIONS_PER_RUN > 0` (default `0`, fail-closed) and flipping `SUBMIT_REQUIRES_LOCAL_CONFIRMATION` to `false`. So: once an operator deliberately flips both of those flags once, a scheduled cycle *can* submit real applications, unattended, up to a persisted numeric cap — a documented, named escape hatch, not a bypass. Flagged as Medium because the phrase "explicit operator confirmation" (as CLAUDE.md's house rules put it) is doing more work here than it first reads as.
- **Deliberately not in scope (per docs, largely holding):** essay generation expansion, Outlook send (permanently out of scope), silent multi-ATS expansion beyond what's now shipped, replacing the deterministic adapters with an LLM agent as the default path.
- **Longer arc:** Phase 6 constrained-agent fallback — *only* as a fill-assist for unsupported ATS, gated behind `AGENT_FALLBACK_ENABLED`, passing through the same approved-plan + read-back-verification gates. Note: the "evaluate browser-use as a Phase 6 fallback candidate" amendment from prior cycles has now effectively been **actioned** — Browser Use Cloud v4 is live, gated behind `BROWSER_USE_ENABLED`/`BROWSER_USE_AGENT_ENABLED` with a per-run cost cap (`BROWSER_USE_MAX_COST_USD`, default/max $1, `docs/operator-guide.md:772-774`) — though it shipped as a *hosted-plane remote-browser provider*, not specifically as the Phase 6 unsupported-ATS fallback the earlier amendment was scoped to; whether it also gets used that way is still open.
- **Git tooling note (resolved 2026-09-25, still holding):** the prior shallow-clone limitation (depth 50, single-day autopush noise) stayed fixed — full history (2,825 commits) is how the Workday/hosted work was found, and this review confirmed the same 2,825-commit history is still there with zero non-autopush additions since.

Deeper detail (in `skale-07/jobright-application-agent`, not this repo):
`docs/architecture.md` · `docs/current-state-and-phase56.md` ·
`docs/known-limitations.md` · `docs/validation-levels.md` ·
`docs/roadmap/cloud-deploy.md`

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

**Codebase is unchanged for a second consecutive review** — `origin/main` is
still at commit `a52881b` ("Isolate youth wildcards on Score and stop
dropping seed-tree neighbors below the top-80 cut"), same as both the
2026-09-23 and 2026-09-25 cycles (dated 2026-08-24 — the repo has been quiet
a full month). Everything below was independently re-verified against
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

Dispatch is a **hardened descendant** of tSearch's session/
scraping infrastructure, not an unrelated project. `docs/tsearch-reuse-map.md`
(in the Dispatch repo) records the original reuse plan: tSearch's
`saveSession.ts` / `linkedinBrowser.ts` concepts (manual storageState login,
lazy session open/validate) and atomic-JSON-store pattern were the seed for
Dispatch's `ServiceSession` and `src/storage/` layers, explicitly rebuilt with
more hardening (coverage statuses, mid-run auth checks, traces/screenshots, no
committed profile artifacts — a design choice that, per §4 below, tSearch
itself does not currently follow, and has not closed out even after four
review cycles). tSearch's product logic — olympiad scoring, GitHub graph
expansion, the seed-tree UI — was deliberately **not** ported; the two
products solve different problems (apply vs. discover) and share only the
"safely drive a browser session against a third-party site" substrate.

**Cross-cutting pattern, reconfirmed unchanged this cycle (both codebases
frozen, nothing new to find): status/decision docs lagging shipped reality,
in both repos, on both "a fix ships without a doc update" and "a decision
reverses without a doc update."** In Dispatch: `known-limitations.md` and
`current-state-and-phase56.md` still describe a fixture-only, dashboard-less,
Workday/Lever-deferred product that's false on essentially every count
(§1.3); separately, `browser-use-evaluation.md`'s explicit security
"Rejected" verdict on Browser Use Cloud is still not reconciled with the
shipped code that overtook it, no recorded reversal note (§1.3) — the same
failure mode CLAUDE.md itself names and handles correctly for the 2026-09-11
EEO-fields decision reversal (dated, explained, cross-referenced), just not
applied here. In tSearch: `assessment-rubric-architecture-audit.md` and
`tsearch-playwright-system-audit.md` still describe bugs fixed weeks ago
(unchanged, codebase identical). Worth a shared, lightweight convention
across both repos: when a doc-named issue is fixed *or a doc-recorded
decision is reversed*, the doc gets one line saying so, not just a silent
code change.

`docs/tsearch-reuse-map.md` is still stale on the LinkedIn-enrichment point,
now for a **fourth consecutive review**: it still frames LinkedIn enrichment
as "Phase 1 — no LinkedIn code ported yet / port in Phase 2," while both
`known-limitations.md` and `current-state-and-phase56.md`'s capability matrix
say it was **dropped by decision**. Flagged four cycles running now with no
update — see §4.

---

## 4. Risk triage

Severity reflects blast radius and reversibility, not effort to fix. Items
resolved since the last review are removed from the table and noted in the
changelog instead, so this table reflects **current** standing risk only.

| Severity | Repo | Risk | Why it matters |
| --- | --- | --- | --- |
| **Critical — unresolved for 4th cycle** | tSearch | `profiles/`/`backup/` are gitignored and the current tree is clean (independently reverified today: 0 tracked files, correct `.gitignore` coverage) — but git history was never purged. Independently reverified today: the same 4 add-commits (`9b9a310`, `bc86684`, `bb366e7`, `700e2f6`) are still present and still ancestors of `origin/main`, containing real scraped LinkedIn PII (a `backup/` snapshot for a real named person's full profile, confirmed present). Repo independently reconfirmed **still public** via the GitHub API today (`"private": false`, 0 open issues/PRs, `pushed_at` 2026-09-25). | Unambiguous, live, public PII exposure — anyone can clone and walk history with no auth. Needs `git filter-repo`/BFG + force-push, or the repo going private until purged — same recommendation for a fourth straight cycle, now well past overdue. |
| **High — unresolved, reconfirmed today** | Dispatch | Dispatch's core status docs (`known-limitations.md`, `current-state-and-phase56.md`, README's "Current state" banner) are still broadly stale, not just on one point: they describe a fixture-only, dashboard-less, Workday/Lever/Ashby-deferred product, while the repo's own commits and artifacts show real Greenhouse/Ashby `LIVE_MUTATION_CONFIRMED` submissions, a shipped dashboard/onboarding wizard, and a real (if not yet receipt-confirmed — see next row) Workday adapter. This vision doc's own Dispatch-repo copy was part of the same pattern (stuck at 2026-08-07) until today's push closed that one instance — the underlying docs it's about are still untouched. | An operator or future engineer trusting these docs would misjudge what's already live across nearly the whole product surface, not one feature. The fix is a doc pass, but the scope of what's wrong is now known precisely — no excuse to only patch the one line already flagged in prior cycles. |
| **High — unresolved, reconfirmed today** | Dispatch | Workday is a real, live-reaching adapter (real employer tenant, real wizard submit click) but **no automated `LIVE_MUTATION_CONFIRMED` receipt exists in the artifacts** — all 6 captured live submit attempts on one real application ended `REFUSED`/`FAILED_BEFORE_CLICK`/`UNCERTAIN`, with the application's later `SUBMITTED` state most plausibly reflecting a manual `review:resolve`, not an automated confirmation. Commit messages and the README read as "Workday support" without this caveat. | Distinct from the doc-staleness row above: this is a *capability overclaim* risk, not just a stale-doc risk — a reader trusting shipped Workday code to reliably confirm its own submissions would be wrong today. The safety gates themselves are intact (same gating as every adapter); the risk is trusting an unproven receipt path. |
| **Medium** | Dispatch | `DispatchAutoCycle` (a Windows Scheduled Task running the pipeline every 4h) can, once an operator has deliberately flipped `SUBMIT_REQUIRES_LOCAL_CONFIRMATION=false` and set `MAX_UNATTENDED_SUBMISSIONS_PER_RUN>0` (both `0`/`true` fail-closed by default), submit real applications fully unattended up to a persisted cap. This is a documented, intentional escape hatch, not a bypass. | Worth the operator explicitly re-affirming this is desired: "explicit operator confirmation" (CLAUDE.md's own phrasing) means a pre-authorized batch in this mode, not a synchronous per-submission click — a meaningfully weaker reading than the phrase suggests on first read. |
| **Medium — unresolved, reconfirmed today** | Dispatch | `docs/browser-use-evaluation.md`'s explicit "Rejected" security verdict on Browser Use Cloud (would leak operator session/PII off-machine, "contradicts security.md") was never updated after commit `daa96b370` shipped Browser Use Cloud v4 as a remote-browser provider for the (differently-scoped, user-owned) hosted plane. `docs/security.md` doesn't mention hosted mode at all. | The reversal is defensible given the new split-plane architecture, but a reader hitting the old doc would reasonably believe a live integration is banned — same "decision changes silently" pattern as the doc-staleness rows above, just on a security verdict specifically. |
| **Medium** | Dispatch | The original JobRight-feed live-discovery blocker (`jobs_inspected: 0`) — no new evidence, this cycle or the last, that the underlying `storageState()`/IndexedDB hypothesis was tested or fixed. Product had, before the codebase went quiet on 2026-09-16, routed around it via public ATS-board discovery (3 ATS platforms, hosted plane). | Still worth closing properly — the workaround only covers boards with public APIs, not the full intended JobRight-driven discovery surface. |
| **Medium** | tSearch | `tsearch-playwright-system-audit.md` HIGH items — half fixed, half open, reconfirmed by direct source read today. **Fixed:** mid-run LinkedIn re-auth detection, LinkedIn test coverage (4 test files). **Still open:** no retry/trace/screenshot capture on scrape failure; scraped-profile country is never compared against the expected/seed country post-extraction to reject a homonym match — only pre-extraction search targeting and post-extraction name/GitHub-login checks exist. | Directly threatens data-quality (wrong-person matches entering the candidate graph) and diagnosability of live scrape failures. |
| **Low** | tSearch | No automated enforcement behind `CLAUDE.md`'s safety conventions — reconfirmed today: no `check:forbidden`-style script in `package.json`, no `.husky/`, nothing installed under `.git/hooks/` beyond the default `.sample` files. | Convention-only means nothing mechanically prevents a repeat of the Critical PII issue at the *next* commit. |
| **Low** | Dispatch | `.env.example`'s `ESSAY_REQUIRED_GATE_ENABLED` flag still isn't in `CLAUDE.md`'s enumerated flag list — reconfirmed unchanged this cycle. | Minor doc/CLAUDE.md drift; a future reader of the house-rules list would miss one fail-closed gate. |
| **Low — unresolved 4 cycles running** | Dispatch | `docs/tsearch-reuse-map.md` still frames tSearch LinkedIn-enrichment porting as a not-yet-done Phase 1/2 item, contradicting two other in-repo docs that say it was dropped by decision. | Doc drift; a future reader could plan work against a stale, already-reversed decision. Flagged four times now with no fix — worth just doing it. |
| **Low** | tSearch | Global-vs-per-seed digest question still unresolved; Supabase sync integration still mid-flight. | Not defects, just open threads worth tracking so they don't silently stall. |

**Resolved since last review (removed from the active table):**
- Dispatch — this vision doc's own Dispatch-repo copy, which had lagged the tSearch-side branch for two consecutive cycles (flagged as part of the High doc-staleness row above), is resolved as of today: this file is now pushed to `claude/busy-clarke-sfxscd` here and `claude/epic-pasteur-sfxscd` in tSearch, both current. This does not touch the underlying `known-limitations.md`/`current-state-and-phase56.md`/README staleness, which remains open.
- No other items resolved this cycle in either repo — both codebases are unchanged since the prior review (Dispatch since 09-16, tSearch since 08-24), so no code-level risk closed on its own.

---

## 5. Amendments worth considering (external scan)

**This cycle's rescan (2 days after the last one) found nothing materially
new** — a targeted check on Workday-automation tooling and git-history-purge
best practice turned up the same landscape (`git-filter-repo`/BFG still the
standard remediation path, no new Workday-specific adapter project worth
displacing the in-repo one). All items below are carried forward unchanged
rather than re-argued.

**Dispatch**

- **`storageState({ indexedDB: true })`** (Playwright ≥1.51) — unchanged
  recommendation, still the most direct fix for the underlying (still-open,
  per §4) JobRight live-session blocker. https://playwright.dev/docs/auth
- **Tenant secret storage: consider a namespaced/vault pattern over a single
  "tenant master key."** M24 introduced "tenant master key from the host's
  secret store" for the new hosted plane. Current (2026) multi-tenant
  secrets practice increasingly avoids a single master-key model in favor of
  per-tenant namespacing with no shared secret material — e.g. HashiCorp
  Vault's namespace isolation, or Akeyless's Distributed Fragments
  Cryptography (no master key to compromise at all). Worth a scoped review
  now that real user credentials (Gmail-via-remote-Chrome, ATS logins) sit
  behind this key at hosted scale — a single compromised master key is a
  larger blast radius than the local-only threat model this project was
  originally designed around.
- **Browser Use Cloud's Managed Auth / 1Password integration** — since the
  Dispatch is now a paying Browser Use Cloud customer (v4, ~$0.02/hr
  sessions, 1.2x provider-rate hosted-agent pricing per their published
  2026 pricing), its built-in Managed Auth (keeps credentials out of the
  model prompt entirely) is worth evaluating as the credential path for the
  hosted plane's remote-browser sign-ins, rather than building bespoke
  credential handling on top of the raw session API.
- **Skyvern / Stagehand** — unchanged from last cycle: still worth a scoped
  evaluation as Phase 6 fallback candidates for the messiest unsupported ATS
  forms (Workday's own struggles before the codebase went quiet — day32
  listbox/wizard-identity walls — are a concrete data point for why a fallback path still has
  value even with a deterministic Workday adapter now shipped).
  https://github.com/browserbase/stagehand · https://github.com/Skyvern-AI/skyvern

**tSearch**

- **Judge Reliability Harness** (arXiv 2603.05399) and **CalibratedRubric**
  (arXiv 2607.29252) — unchanged recommendations, now flagged for a **fourth
  cycle**; still a direct match for the docs' own `requires_calibration`
  flags on Priority-v2 and the "Cory" persona, and no evidence either has
  been applied. Worth actually scheduling rather than continuing to carry
  forward as an open question.
- **LinkedIn v. ProAPIs — correction and nuance on last cycle's note.** The
  consent judgment was finalized **2026-09-16** (not 09-21 as last cycle
  stated) — permanent scraping/fake-account ban plus a data-destruction
  order. Important nuance last cycle's note didn't carry: the defendants
  denied liability and it's a *stipulated* judgment, so it "sets no
  precedent" for scraping generally. Still directly relevant here on the
  facts, not the precedent: it's current, concrete evidence LinkedIn is
  actively litigating and winning against scraping operations at a scale
  this repo's activity resembles, which strengthens the case for git-history
  remediation (§4) regardless of precedent value.
  https://therecord.media/linkedin-wins-court-order-blocking-mass-scraping
- **GitHub-graph-first identity resolution** (pattern:
  `theArjun/github-social-graph`) — unchanged recommendation: a
  ToS-compliant complement that could shift weight away from LinkedIn
  scraping as the primary signal.

---

## Changelog

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
