# T-Search Playwright System Audit

**Audit type:** Read-only technical inspection  
**Repository:** `github.com/skale-07/tSearch` (local workspace)  
**Audit date:** 2026-07-17  
**Scope:** Existing Playwright / Chromium LinkedIn automation only  
**Not in scope:** Job-application pipeline, ATS adapters, Outlook, JobRight, new features, code changes  

**Evidence labels used below:**

| Label | Meaning |
| ----- | ------- |
| CONFIRMED | Established by reading executable code or safe local inspection |
| PARTIAL | Declared or wired but unused / incomplete on the live path |
| DEAD | Defined but not called from production entry points |
| IMPLIED | Suggested by structure; not verified at runtime in this audit |
| MISSING | Required capability not present in code |
| ASSUMPTION | Needs live LinkedIn runtime confirmation |

---

# 1. Executive technical summary

T-Search is a **LinkedIn-first identity-resolution pipeline** written in **TypeScript (NodeNext / CommonJS package)** that uses **Playwright Chromium** to:

1. Manually capture a LinkedIn session into a Playwright `storageState` file (`cookies.json` by default).
2. Lazily open one headed Chromium browser, load that state, and validate the session against `/feed/`.
3. For each seed name: search LinkedIn People, pick a result by name match (+ higher confidence when country/olympiad hints are present), scrape the profile (top card, About/Skills/Featured sections, Contact info overlay, dedicated Education/Experience/Honors detail pages), cache results, then optionally scrape the personal website via HTTP (not Playwright).
4. Merge LinkedIn data with GitHub/Substack/Olympiad enrichment and persist candidates / people / profile trees.

**Authentication:** Manual login → `context.storageState({ path })`. No password storage. Session expiry detected only at session open via URL containing `/login` or `/checkpoint`.

**Seed → profile:** `parseSeeds` → olympiad lookup → optional skip via `candidates.json` + `scrape_version` → cached/live people search → `pickBestLinkedInHit` → cached/live `extractLinkedInProfile`.

**Extracted data:** Name, photo URL, headline, location→country, education list (+ primary school/college/degree/graduation_year), experience, honors/awards, skills (best-effort), contact-classified GitHub/Substack/Twitter/personal website/contact_links, keywords. Not extracted from LinkedIn: email, phone, About text as a field, job descriptions, recommendations, projects, publications, certifications, volunteering, etc.

**Outputs:** `output/candidates.json`, `output/seed_tree.json`, `data/people/*.json` (gitignored), `profiles/**` (currently tracked in git), cache under `cache/` (gitignored).

**Reusable:** Browser launch options, storage-state login capture, lazy session wrapper, JSON cache with TTL + scrape version, redirect unwrapping, sequential session reuse. **Not reusable as-is:** LinkedIn selectors, education/experience text parsers, identity matching, seed/olympiad logic.

---

# 2. Repository architecture (Part 1)

## 2.1 Stack (CONFIRMED)

| Item | Value | Evidence |
| ---- | ----- | -------- |
| Language | TypeScript | `tsconfig.json`, `src/**/*.ts` |
| Runtime | Node.js (observed `v22.19.0`) | local `node -v` |
| Package manager | npm (`package-lock.json`) | repo root |
| Module system | `"type": "commonjs"` + TS `NodeNext` | `package.json`, `tsconfig.json` |
| Playwright dependency | `^1.52.0` in `package.json` | package.json L22 |
| Playwright installed | `1.61.1` | `package-lock.json` / `node_modules` |
| Runner | `tsx` for TS entry points | package.json scripts |
| Other languages | Python utilities (`olympiad_seeds.py`, scrapers) | root |
| Frontend | Vite React app in `web/` | `web/`, `npm run dev:web` |
| API | Express in `server/` | `server/index.ts` |

## 2.2 npm scripts → implementation

```json
{
  "command": "npm run login",
  "entry_point": "src/linkedin/saveSession.ts",
  "purpose": "Manual LinkedIn login; write Playwright storageState",
  "inputs": ["User interactive login in headed Chromium", "Enter on stdin"],
  "outputs": ["COOKIES_PATH (default cookies.json)"],
  "uses_playwright": true,
  "side_effects": ["Launches Chromium", "Writes storage state file", "Closes browser"],
  "dependencies": ["playwright", "src/config.ts BROWSER_LAUNCH_OPTIONS, COOKIES_PATH"]
}
```

```json
{
  "command": "npm run pipeline",
  "entry_point": "src/pipeline/runPipeline.ts",
  "purpose": "Full LinkedIn-first resolve → expand → merge → persist",
  "inputs": ["SEEDS_PATH", "OLYMPIAD_CSV_PATH", "COOKIES_PATH (if scrape needed)", "optional BRANCH_EXPAND env"],
  "outputs": ["OUTPUT_PATH candidates.json", "output/seed_tree.json", "PROFILES_DIR", "PEOPLE_DIR", "cache/*"],
  "uses_playwright": true,
  "side_effects": ["Network (LinkedIn/GitHub/Substack/websites)", "Writes output/cache/people/profiles"],
  "dependencies": ["resolveIdentities", "expandGraph", "mergeCandidates", "personStore", "profileStore"]
}
```

```json
{
  "command": "npm run seeds",
  "entry_point": "olympiad_seeds.py",
  "purpose": "Score olympiad CSV medalists into seed JSON candidates",
  "inputs": ["olympiad_winners.csv (or --csv)", "CLI flags"],
  "outputs": ["JSON seed list (default path via --out)"],
  "uses_playwright": false,
  "side_effects": ["Writes seed JSON file"],
  "dependencies": ["Python 3, csv module"]
}
```

```json
{
  "command": "npm run dev:api",
  "entry_point": "server/index.ts",
  "purpose": "Express API for health, seeds, tree, spawning pipeline runs",
  "inputs": ["API_PORT (default 8787)", "profiles/, seeds, cookies existence"],
  "outputs": ["HTTP JSON / SSE-style log events"],
  "uses_playwright": false,
  "side_effects": ["Can spawn `npm run pipeline` child with temp seed file"],
  "dependencies": ["express", "server/runs.ts", "server/tree.ts"]
}
```

```json
{
  "command": "npm run dev:web",
  "entry_point": "web/ (Vite)",
  "purpose": "Web UI for visualizing seed trees / triggering runs",
  "inputs": ["API backend"],
  "outputs": ["Browser UI"],
  "uses_playwright": false,
  "side_effects": ["Dev server"],
  "dependencies": ["web/package.json"]
}
```

```json
{
  "command": "npm run dev",
  "entry_point": "concurrently api + web",
  "purpose": "Local full stack",
  "inputs": [],
  "outputs": ["API + web concurrently"],
  "uses_playwright": false,
  "side_effects": ["Two child processes"],
  "dependencies": ["concurrently"]
}
```

**Alternate pipeline mode (CONFIRMED):** If `BRANCH_EXPAND=1` and related env vars are set, `runPipeline.ts` delegates to `runBranchExpand.ts` (known LinkedIn URL + forced GitHub) instead of seed search.

## 2.3 Directory map (CONFIRMED)

| Path | Role |
| ---- | ---- |
| `src/linkedin/` | Playwright session, search, match, extract |
| `src/pipeline/` | Orchestration: resolve, expand, merge, branch |
| `src/storage/` | JSON cache, person records, profile tree |
| `src/website/` | HTTP personal-site scrape (not Playwright) |
| `src/github/`, `src/substack/`, `src/olympiad/`, `src/scoring/`, `src/seeds/` | Non-Playwright enrichment |
| `server/` | Express API + run spawn |
| `web/` | Visualization UI |
| `cache/` | TTL caches (gitignored) |
| `data/` | Per-person records (gitignored) |
| `output/` | Ranked candidates / seed tree (gitignored) |
| `profiles/` | Seed-tree profile folders (**tracked in git**) |
| `backup/` | Snapshot copies (**tracked in git**) |
| `cookies.json` | Playwright storageState (gitignored) |
| `.env` | Secrets/config (gitignored) |
| `tests/` | Default Playwright example only |
| `scripts/debugContact.ts` | Manual contact-info debug helper |

## 2.4 Actual architecture diagram (CONFIRMED)

```text
olympiad_seeds.py / seeds.json
        ↓
runPipeline.ts
        ↓
loadOlympiadCsv + parseSeeds + loadExistingCandidates
        ↓
resolveIdentities.ts  ←── openLinkedInSession (lazy, one browser)
        │                      storageState from cookies.json
        ├── skip if candidates.json has scrape_version match
        ├── linkedin-search cache OR searchLinkedInByName
        ├── pickBestLinkedInHit (name + targeted-search confidence)
        ├── linkedin-profile-v2 cache OR extractLinkedInProfile
        └── enrichIdentityFromWebsite (HTTP fetch, parallelized after LI)
        ↓
expandGraph.ts (GitHub collaborators/followers + Substack)  [no Playwright]
        ↓
mergeCandidates + computeScore
        ↓
output/candidates.json + seed_tree.json
profiles/<seed>/… + data/people/*.json
```

API path: `POST /api/runs` → temp seed JSON in `tmp/` → spawn `npm run pipeline` (`server/runs.ts`).

---

# 3. Complete Playwright execution path (Part 2)

## 3.1 Playwright inventory

| File | Function / site | Playwright object | Purpose |
| ---- | --------------- | ----------------- | ------- |
| `src/linkedin/saveSession.ts` | `main` | `chromium`, `Browser`, `BrowserContext`, `Page`, `storageState` | Manual login capture |
| `src/linkedin/linkedinBrowser.ts` | `openLinkedInSession`, `requireCookies` | `chromium`, `Browser`, `BrowserContext`, `Page` | Session open/validate/close |
| `src/linkedin/linkedinSearch.ts` | `searchLinkedInByName`, helpers | `Page`, `Locator` | People search extraction |
| `src/linkedin/linkedinExtract.ts` | `extractLinkedInProfile`, `fetchContactInfo`, etc. | `Page`, `Locator` | Profile scrape |
| `src/pipeline/resolveIdentities.ts` | `getSession` / `resolveIdentities` | Uses `LinkedInSession` | Lifecycle owner for main pipeline |
| `src/pipeline/runBranchExpand.ts` | `scrapeLinkedInByUrl` | Uses `openLinkedInSession` | Known-URL scrape |
| `scripts/debugContact.ts` | `main` | Uses session + page | Debug contact overlay |
| `playwright.config.ts` | test config | `@playwright/test` | **Unused by pipeline** — example test runner config |
| `tests/example.spec.ts` | Playwright.dev smoke tests | test fixtures | **Not LinkedIn** |

## 3.2 Login sequence (CONFIRMED)

```text
npm run login
  → saveSession.ts main()
  → chromium.launch(BROWSER_LAUNCH_OPTIONS)   // headless:false, slowMo:50
  → browser.newContext()                      // empty; no storageState
  → context.newPage()
  → page.goto("https://www.linkedin.com/login", waitUntil:domcontentloaded)
  → wait for stdin Enter
  → context.storageState({ path: COOKIES_PATH })
  → browser.close(); process.exit(0)
```

## 3.3 Pipeline LinkedIn session sequence (CONFIRMED)

```text
npm run pipeline
  → runPipeline.main()
  → resolveIdentities(seeds, …)
  → for each seed (up to MAX_IDENTITY_RESOLVES):
       resolveIdentity(…)
         → may call getSession() on cache miss
              → openLinkedInSession() once
                   → requireCookies()
                   → chromium.launch(BROWSER_LAUNCH_OPTIONS)
                   → newContext({ storageState: COOKIES_PATH, viewport:1280x900 })
                   → newPage()
                   → goto feed/, wait 1500ms
                   → if URL has /login or /checkpoint → close all, throw
         → search / scrape using same session.page
  → finally: session.close() → context.close + browser.close
  → then await websiteJobs (HTTP)
```

## 3.4 Browser lifecycle answers

| Question | Answer | Evidence |
| -------- | ------ | -------- |
| How Chromium launched | `chromium.launch(BROWSER_LAUNCH_OPTIONS)` | `linkedinBrowser.ts` L24–25, `saveSession.ts` L6 |
| Headed/headless | **headed** `headless: false` | `config.ts` L119–122 |
| slowMo | **50** ms | `config.ts` L121 |
| Viewport | **1280×900** on session context; login context uses default | `linkedinBrowser.ts` L28 |
| Auth creation | Manual UI login + Enter | `saveSession.ts` |
| Auth storage | `COOKIES_PATH` (default `cookies.json`) | `config.ts` L51–54 |
| State load | `storageState: COOKIES_PATH` on `newContext` | `linkedinBrowser.ts` L26–28 |
| Session validity | Feed load; fail if `/login` or `/checkpoint` in URL | `linkedinBrowser.ts` L38–48 |
| Checkpoint detection | URL substring only; no CAPTCHA handling | same |
| One browser across people | **Yes** (lazy singleton per `resolveIdentities` call) | `resolveIdentities.ts` L234–240 |
| One context | **Yes** | module `activeContext` |
| One page | **Yes** — single `page` reused; navigations overwrite | `openLinkedInSession` returns one page |
| Close | `session.close()` in `finally` | `resolveIdentities.ts` L276–280 |
| Exception on open | Throws; browser closed if expired at open | `linkedinBrowser.ts` L40–48 |
| Cross-run leak | New launch each `openLinkedInSession`; module globals cleared on close | CONFIRMED for single process |
| Cross-person leak | Same page reused; extraction reads current navigation. **No isolation of cookies between people** (same LinkedIn account session). Data contamination risk is navigation/stale DOM, not cookie mixing. | IMPLIED for DOM races; ASSUMPTION without runtime |

**MISSING:** Screenshots, traces, retries with backoff, mid-run re-auth, persistent Chrome user-data-dir profiles.

---

# 4. Authentication and cookie audit (Part 3)

## 4.1 Storage state (CONFIRMED via code + local file shape)

| Property | Value |
| -------- | ----- |
| Path | `process.env.COOKIES_PATH` or `cookies.json` at cwd | `config.ts` |
| Format | Playwright **storageState** JSON: `{ cookies, origins }` | local file; Playwright API |
| Cookies | Yes (observed 12 cookies; domains include `.linkedin.com`) | local inspection (values not logged here) |
| localStorage | Yes via `origins[].localStorage` (observed origins: `https://li.protechts.net`, `https://www.google.com`) | local inspection |
| IndexedDB | **Not** part of Playwright `storageState` by default | Playwright semantics |
| Login credentials | **Not stored** by `saveSession.ts` | code |
| Browser password manager | N/A — ephemeral launch, not persistent profile dir | code |
| Gitignored | **Yes** — `.gitignore` line `cookies.json` | `.gitignore` |
| Tracked in git | **No** (`git ls-files cookies.json` empty) | local check |

**Naming note:** File is called `cookies.json` but is full `storageState`, not cookies-only.

## 4.2 Credential / secret classes (do not conflate)

| Kind | What it is in this repo |
| ---- | ----------------------- |
| Playwright storageState | Session cookies + some localStorage |
| Login credentials | Never persisted by T-Search login script |
| Browser profile data | Not used (`launchPersistentContext` absent) |
| Env vars | `.env`: `GITHUB_TOKEN`, paths, `FORCE_REFRESH`, etc. |
| GitHub token | `GITHUB_TOKEN` env or `gh auth token` | `config.ts` |

## 4.3 Security table

| Item | Storage location | Sensitive | Git-ignored | Runtime use | Risk |
| ---- | ---------------- | --------: | ----------: | ----------- | ---- |
| LinkedIn storageState | `cookies.json` (configurable) | Yes | Yes | Load into Chromium context | Session hijack if leaked |
| `.env` | repo root | Yes (token) | Yes | dotenv at config load | Token leak if committed |
| GitHub token | env / gh CLI | Yes | N/A (not file) | GitHub API | API abuse |
| Cached LinkedIn searches | `cache/linkedin-search/` | Medium (names/URLs) | Yes | Skip search | PII on disk |
| Cached LinkedIn profiles | `cache/linkedin-profile-v2/` | High | Yes | Skip scrape | PII on disk |
| Per-person records | `data/people/` | High | Yes | Upsert | PII on disk |
| `profiles/**` | `profiles/` | High | **No** | Tree UI / expand | **Committed scraped profiles (CRITICAL)** |
| `backup/**` | `backup/` | High | **No** | Manual snapshots | **Committed (CRITICAL)** |
| Ranked candidates | `output/candidates.json` | High | Yes | Merge/reuse | Local disk |
| Scraped contact links | inside LinkedInProfile / website | Medium–High | Depends on dest | Enrichment | URL/email exposure |
| Email addresses | From **website** scrape → person links | High | via `data/`/`cache/` | Persist | PII; may appear in logs |
| Console logs | stdout | Medium | N/A | Debugging | Logs names, URLs, emails (`resolveIdentities` website log) |

**Authentication refresh:** MISSING automatic refresh. Expired session → throw at open; pipeline warns if cookies missing and continues only on caches (`runPipeline.ts` L176–181).

**Mid-run expiry:** CONFIRMED not re-checked after open. Long runs can hit login redirects mid-scrape without structured recovery (IMPLIED failure mode).

---

# 5. Seed inputs and identity resolution (Part 4)

## 5.1 Seed schema (CONFIRMED — `src/seeds/parseSeeds.ts`)

Both forms supported:

```json
[
  "Person Name",
  { "name": "Person Name", "country": "Country" }
]
```

Type: `SeedQuery { name: string; country?: string }`.

Default seeds file: `src/seeds/seeds.json` (objects with name + country). Overridable via `SEEDS_PATH`.

## 5.2 Influences on identity resolution

| Source | Effect | Evidence |
| ------ | ------ | -------- |
| Seed name | Quoted search keyword; name match on cards | `buildSearchTerms`, `nameMatchesQuery` |
| Seed country | Search term via `primaryCountrySearchTerm`; marks search “targeted” | `resolveCountry`, `linkedinSearch`, `isTargetedSearch` |
| Olympiad country | Fallback if seed lacks country | `resolveCountry` |
| Olympiad awards | Search hints (e.g. `IOI`, `gold`) via `olympiadSearchHints` | `searchHints.ts` |
| School | **Accepted in search context API** | `LinkedInSearchContext.school` |
| School in main pipeline | **Never passed** — `resolveIdentities` does not supply `school` | PARTIAL / unused on live path |
| Existing candidate | Skip search+scrape if `scrape_version === PROFILE_SCRAPE_VERSION` (9) | `resolveIdentities.ts` L77–89 |
| Cached search | Namespace `linkedin-search`, TTL `LINKEDIN_SEARCH_CACHE_TTL_MS` (7d default) | config + resolve |
| Cached profile | Namespace `linkedin-profile-v2`, TTL 30d + `isFullLinkedInProfile` | resolve |
| Cap | `MAX_IDENTITY_RESOLVES` (default 40) | config |

## 5.3 Exact sequence for one seed (CONFIRMED)

```text
1. resolveIdentity(seed)
2. lookupOlympiad(name) → olympiad profile or undefined
3. country = seed.country ?? olympiad.countries[0]
4. If findScrapedCandidate(...) with scrape_version===9 → return that identity (no browser)
5. Build searchQuery = formatSearchQuery(name, {school?, country, olympiad_hints})
6. readCache("linkedin-search", searchQuery) OR live searchLinkedInByName
7. If hits empty → failed no_results
8. pickBestLinkedInHit → or failed no_name_match
9. isSearchConfirmed → may bump confidence +0.1
10. readCache("linkedin-profile-v2", url) if full OR extractLinkedInProfile
11. Return ResolvedIdentity { query_name, linkedin, identity_confidence, github_url, substack_url, website:null }
12. After loop body: enqueue enrichIdentityFromWebsite (HTTP)
```

---

# 6. LinkedIn people-search audit (Part 5)

**File:** `src/linkedin/linkedinSearch.ts`  
**Entry:** `searchLinkedInByName(session, name, context?)`

### Search construction

| Piece | Behavior | Function |
| ----- | -------- | -------- |
| Terms | `["\"{name}\"", ...olympiad_hints, countryTerm?, school?]` | `buildSearchTerms` |
| Country term | `primaryCountrySearchTerm` (USA → `"United States"`) | `countryMatch.ts` |
| URL | `https://www.linkedin.com/search/results/people/?keywords={encodeURIComponent(terms joined)}&origin=GLOBAL_SEARCH_HEADER` | `buildSearchUrl` |
| Max results | `MAX_LINKEDIN_RESULTS` default **5** | config |
| After nav | `waitForSelector("main", 20s).catch`, then `sleep(LINKEDIN_DELAY_MS)` default 1200 | search L176–178 |
| Nav timeout | 45000 | L176 |

### Result container selectors

```json
{
  "selector": "li.reusable-search__result-container, div.reusable-search__result-container, .entity-result",
  "purpose": "Primary search-result containers",
  "priority": 1,
  "fallback": false,
  "fields_extracted": ["url", "title", "headline", "location", "snippet"],
  "known_risk": "LinkedIn class names change frequently"
}
```

```json
{
  "selector": "main a[href*=\"/in/\"]",
  "purpose": "Fallback when zero structured hits",
  "priority": 2,
  "fallback": true,
  "fields_extracted": ["url", "title"],
  "known_risk": "Headline/location empty; may pick non-person noise"
}
```

### Per-field extraction (primary path)

| Field | Method |
| ----- | ------ |
| URL | `a[href*="/in/"]` → `normalizeProfileUrl` → `https://www.linkedin.com/in/{slug}/` |
| Name | `.entity-result__title-text span[aria-hidden='true']` then fallbacks; `normalizeCardName` |
| Headline | `.entity-result__primary-subtitle, div[class*='primary-subtitle']` |
| Location | `.entity-result__secondary-subtitle, …` or `inferLocationFromContainer` |
| Snippet | `location \|\| headline` |

### Normalization / edge cases

| Case | Behavior |
| ---- | -------- |
| Tracking params | Dropped by pathname-only normalize | `normalizeProfileUrl` |
| Duplicate URLs | `seen` Set | L181–192 |
| Connection degree in name | Stripped by `normalizeCardName` / `cleanSearchTitle` | |
| No results | Empty array; caller → `no_results`; **empty array still cached** | resolve L110, L113–115 |
| Missing headline/location | Empty string allowed | |
| No readable name | Hit skipped (`!hit.title`) | L190 |
| Non-profile URLs | Fallback filters `/company|school|search/` | L204 |

---

# 7. Profile selection / identity matching (Part 6)

**File:** `src/linkedin/linkedinMatch.ts`

### Name matching (CONFIRMED)

- `cleanSearchTitle`: first line; strip `• 1st/2nd/3rd/Following` and trailing `|`/`•` segments.
- `nameMatchesQuery`: every whitespace-separated query token must appear in cleaned title (case-insensitive). Single-token query → `title.includes(part)`.

### Scoring signals (actual code — not a weighted model)

| Signal | Score effect | Required? | Source | Failure risk |
| ------ | -----------: | --------: | ------ | ------------ |
| Name match on card title | Gate: no match → reject | Yes | hit.title | Wrong person with same name tokens |
| Targeted search (country **or** olympiad_hints) | confidence **0.85** if name matches | No | seed/olympiad | Country wrong but still “targeted” |
| Untargeted (name only) | confidence **0.5** if first hit name-matches | Yes first hit | hits[0] | Ambiguous common names |
| Search confirmed | +0.1 capped at 1.0 | No | `isSearchConfirmed` | Same as targeted+name |
| Country vs hit.location | **Not scored** | — | `expected_country` only toggles targeted | PARTIAL: field set, unused for ranking |
| Headline / olympiad text on card | **Not scored** | — | unused | |
| GitHub/Substack | **Not used at match time** | — | later enrichment | |

`pickBestLinkedInHit`:

- Targeted: prefer first hit if name matches; else first later hit that matches; else null.
- Untargeted: only accept hits[0] if name matches; else null.

### Failure returns

| Reason | When |
| ------ | ---- |
| `no_results` | `hits.length === 0` |
| `no_name_match` | `pickBestLinkedInHit` null |
| `not_attempted` | Seed index ≥ `MAX_IDENTITY_RESOLVES` |

**Manual review:** MISSING.

### Hypothetical examples (from real rules)

1. **Strong name + country:** Query `"Jane Doe"`, country USA → targeted. First card title contains jane+doe → pick confidence **0.85**, then +0.1 if confirmed → **0.95**. Location correctness never checked.
2. **Strong name, wrong country:** Still targeted if country was in query. If LinkedIn ranks wrong-country Jane Doe first and name matches → **accepted at 0.85/0.95**. Country mismatch is **not** a reject signal.
3. **Partial name:** Query `"Jane Marie Doe"` requires jane, marie, and doe all in title. Card `"Jane Doe"` → **no_name_match**.

---

# 8. Profile navigation audit (Part 7)

**Function:** `extractLinkedInProfile` — `src/linkedin/linkedinExtract.ts` L844–985

### Chronological browser actions (CONFIRMED)

```text
page.goto(hit.url, domcontentloaded, 45s)
→ waitForSelector("main", 15s).catch
→ sleep(LINKEDIN_DELAY_MS)
→ read main text + main hrefs
→ read name from main h1 / section h2 (fallback hit.title / queryName)
→ extractTopCardHeadline OR extractHeadlineFromTopSection OR hit.headline
→ extractTopCardLocation OR extractLocationFromTopSection OR hit.location
→ sectionText(About) — hrefs kept; text not stored as field
→ sectionText(Skills) — optional Show all/See all click inside section
→ sectionTextByHeadings(Featured / Featured links / Links)
→ fetchContactInfo:
     scroll top → click contact trigger → wait overlay URL → dialog/modal/body scrape → Escape
→ goto {profile}/details/education/ → main text
→ goto {profile}/details/experience/ → main text
→ goto {profile}/details/honors/ → main text
→ parse*Detail text parsers
→ photo from img[src*="profile-displayphoto"]
→ return LinkedInProfile with scrape_version=9
```

| Capability | Status |
| ---------- | ------ |
| Visible profile page | Yes (top card, about/skills/featured) |
| Dedicated education/experience/honors pages | **Yes** via `fetchDetailSectionText` |
| Contact info overlay | Yes |
| Expand truncated About | Only if section “Show all” button exists (`sectionText`) — About body discarded |
| Lazy scroll beyond section scrollIntoView | Limited; no full-page scroll loop |
| Skills detail page | **No** — main profile Skills section only |
| Return to original profile after details | Not required; scrape ends on honors page |

---

# 9. Selector inventory (Part 8)

## Authentication validation

| Selector / check | File | Function | Notes |
| ---------------- | ---- | -------- | ----- |
| URL includes `/login` or `/checkpoint` | `linkedinBrowser.ts` | `openLinkedInSession` | Primary; no DOM check |

## Search results

| Selector | File | Function | Primary/fallback |
| -------- | ---- | -------- | ---------------- |
| `li.reusable-search__result-container, div.reusable-search__result-container, .entity-result` | linkedinSearch | search loop | Primary |
| `.entity-result__title-text span[aria-hidden='true']` (+ fallbacks) | linkedinSearch | extractNameFromContainer | Primary name |
| `.entity-result__primary-subtitle, div[class*='primary-subtitle']` | linkedinSearch | readHitFromContainer | Headline |
| `.entity-result__secondary-subtitle, div[class*='secondary-subtitle'], .entity-result__summary` | linkedinSearch | location | Primary |
| `a[href*="/in/"]` | linkedinSearch | URL | Primary + fallback |
| `main` | linkedinSearch | wait | Load signal |

## Top card

| Selector | Purpose |
| -------- | ------- |
| `main h1, main section h2` | Name |
| `main .pv-text-details__left-panel .text-body-medium, main .text-body-medium.break-words` | Headline |
| `main .pv-text-details__left-panel, main .ph5.pb5` + `span.text-body-small` | Location |
| `main span.text-body-small.inline.t-black--light` | Location fallback |
| `main section` first — line heuristics | Headline/location fallbacks |
| `main img[src*="profile-displayphoto"]` | Photo |

## About / Skills / Featured

| Method | Selector strategy |
| ------ | ----------------- |
| `section` filtered by `getByRole("heading", { name: /^About$/i })` | Heading text |
| Same for `/^Skills$/i` | |
| Featured: `/^Featured$/i`, `/^Featured links$/i`, `/^Links$/i` | |
| Show all: `getByRole("button", { name: /show all|see all/i })` inside section | |

## Contact info

| Selector | Role |
| -------- | ---- |
| `a[href*="overlay/contact-info"]` | Trigger |
| `getByRole("link", { name: /contact info/i })` | Trigger |
| `main` text `/^Contact info$/i` | Trigger |
| `main a, main button, main span` filter contact info | Trigger |
| URL `/overlay/contact-info/` | Wait condition |
| `dialog` filter website\|contact info | Overlay root |
| `[role="dialog"], .artdeco-modal, dialog, [aria-modal="true"]` | Fallback root |
| `body` text + hrefs | Last resort |
| `Escape` | Close |

## Detail pages

| URL pattern | Purpose |
| ----------- | ------- |
| `{profile}/details/education/` | Education raw text |
| `{profile}/details/experience/` | Experience raw text |
| `{profile}/details/honors/` | Awards raw text |
| Cut text at `More profiles for you` | Noise trim |

### Robustness ranking (assessment)

| Strategy | Relative robustness |
| -------- | ------------------- |
| Role/accessible name (`getByRole`, Contact info text) | Better |
| URL fragments (`/in/`, `/details/`, overlay path) | Better |
| English heading text (About, Skills, Featured) | Medium — locale fragile |
| LinkedIn CSS (`entity-result__*`, `pv-text-details__*`, `artdeco-modal`) | Fragile |
| Raw line-order text parsers | Fragile |

---

# 10. Exact LinkedIn output schema (Part 9)

**Canonical type:** `LinkedInProfile` in `src/types.ts` L83–109  
**Populated by:** `extractLinkedInProfile` (+ website merge later mutates URLs)  
**Version constant:** `PROFILE_SCRAPE_VERSION = 9` in `linkedinExtract.ts`

## Field matrix

| Field | Type | Declared in | Populated by | Source section | Parsing logic | Reliability |
| ----- | ---- | ----------- | ------------ | -------------- | ------------- | ----------- |
| `url` | string | types | extract / hit | search/profile | hit.url | HIGH |
| `name` | string | types | extract | top card / hit | h1/h2 or cleanSearchTitle(hit) | HIGH |
| `photo_url` | string\|null | types | extract | top card img | profile-displayphoto src | CONDITIONALLY_POPULATED |
| `headline` | string\|null | types | extract | top card / hit | selectors + heuristics | MEDIUM |
| `college` | string\|null | types | primaryEducationSummary | education[0].school | alias of school | MEDIUM |
| `school` | string\|null | types | primaryEducationSummary | education[0] | first education school | MEDIUM |
| `degree` | string\|null | types | primaryEducationSummary | education[0].degree | DEGREE_RE line | MEDIUM |
| `country` | string\|null | types | countryFromLocation | location last comma part | heuristic | MEDIUM |
| `graduation_year` | number\|null | types | primaryEducationSummary | years regex max ≤2035 | often null if years missing | LOW |
| `education[]` | LinkedInEducation | types | parseEducationDetail | /details/education/ | line parser, max 8 | MEDIUM |
| `education[].field` | string\|null | types | parseEducationDetail | — | **never assigned** | DECLARED_BUT_NOT_POPULATED |
| `keywords[]` | string[] | types | extract | headline tokens + skills | slice | LOW |
| `github_url` | string\|null | types | contact/featured only | Contact + Featured | parseGithubUrl | CONDITIONALLY_POPULATED |
| `substack_url` | string\|null | types | contact/featured | same | parseSubstackUrl | CONDITIONALLY_POPULATED |
| `twitter_url` | string\|null | types | contact/featured | same | parseTwitterUrl | CONDITIONALLY_POPULATED |
| `personal_website` | string\|null | types | classifyContactInfo | Contact | scoring / (Personal) label | MEDIUM |
| `website_url` | string\|null | types | same as personal_website often | Contact/blob | duplicate-ish | MEDIUM |
| `contact_links[]` | string[] | types | classifyContactInfo | Contact | collectContactUrls | MEDIUM |
| `experience[]` | LinkedInExperience | types | parseExperienceDetail | /details/experience/ | company→title→dates, max 8 | MEDIUM |
| `awards[]` | LinkedInAward | types | parseHonorsDetail | /details/honors/ | title/date/issuer, max 12 | MEDIUM |
| `skills[]` | string[] | types | Skills section lines | main Skills | slice 0..12 | LOW (sample cache: 0) |
| `scrape_version` | number? | types | extract | constant 9 | cache invalidation | HIGH |

### Nested schemas (as populated)

**Education:** `{ school, degree, field: null always, years }` — `field` unused.

**Experience:** `{ title, company, dates, location }` — descriptions discarded (long lines skipped).

**Awards:** `{ title, issuer, date }`.

### Explicitly NOT extracted from LinkedIn (CONFIRMED absent)

Job descriptions, education descriptions, endorsement counts, recommendations, volunteering, projects, publications, certifications, courses, organizations, languages, interests, followers/connections counts, **email**, **phone**.

Email/phone: only possible later via `scrapeWebsite` → `WebsiteProfile.email` (HTTP), not LinkedIn Contact parsing.

---

# 11–14. Section extraction notes (Parts 10–14)

## Top card (Part 10)

- Final location precedence: top-card selectors → top-section lines → search hit → Contact “Location” regex.
- Country from location’s last comma segment only (`countryFromLocation`).
- Search-result location does **not** override a successful profile location; it is fallback only.
- `extractTopCardRoleLines` exists to read company/school after “Contact info” line — **DEAD** (never called).

## Education (Part 11)

- Detail page text, not structured DOM list items.
- `parseEducationDetail`: school line; optional degree (DEGREE_RE / diploma / in progress) or years (YEARS_RE); **field never set**.
- Primary school = `education[0]` (LinkedIn detail order).
- Cap 8 entries.
- On-profile Education section `sectionText` **not** used for education entries (only detail page).

## Experience (Part 12)

**Parser assumptions (CONFIRMED in code comments/structure):**

- Company line first, then optional tenure `N yr/mo`, then title, skip employment-type lines, then dates (`DATE_RE` / present), then comma location, skip description if length > 100.
- Stops on `paper|publication:` lines.
- Cap 8. Employment type discarded. Current role not flagged. Grouped multi-role companies may mis-parse if layout differs — ASSUMPTION without runtime matrix.

## Awards & skills (Part 13)

- Honors from `/details/honors/` with English header strip `Honors & awards`.
- Skills from main profile section headings; endorsement counts not retained; duplicates not explicitly deduped; max 12 lines after filter.
- Absent section → empty arrays; **not** distinguished from parse failure (both `[]`).

## Contact info & links (Part 14)

Sequence matches code in `fetchContactInfo` (scroll → triggers → overlay URL → dialog/fallback/body → Escape).

Redirect handling: `unwrapRedirectUrl` for `/redir/redirect` and `/safety/go` (`url` query param), strip query, decode `%2E`.

Personal website scoring (`scorePortfolioUrl`):

- Block social hosts (`isBlockedPortfolioHost`)
- +5 `.github.io`, +3 per name token (≥3 chars) in URL, +2 if in Website section
- Accept if score ≥ 3 OR LinkedIn “(Personal)” labeled URL in Website block

`parseAllLinks` on whole-page blob is computed but **GitHub/Substack/Twitter for the profile object intentionally ignore the blob** (only Contact + Featured) to avoid third-party links in activity — CONFIRMED comment L912–915.

---

# 15. LinkedIn-only vs later enrichment (Part 15)

| Final field | Primary source | Secondary | Override behavior |
| ----------- | -------------- | --------- | ----------------- |
| Person name | LinkedIn top card | Seed query name | LI wins if present |
| LinkedIn URL | Search hit | Branch env URL | Fixed at pick time |
| Country | Profile location | Search location; seed/olympiad for search only | Profile-derived |
| School/college | Education detail | — | First edu entry |
| GitHub URL | LI Contact/Featured | Personal website scrape | **Website overrides LI** (`applyWebsiteToLinkedInUrls`) |
| Substack / Twitter | LI Contact/Featured | Website | Website overrides |
| Personal website | LI Contact classify | — | Website scrape updates URL to final fetch URL |
| Email | **Website only** | — | Not from LinkedIn |
| Company | Experience parser / (dead top-card helper) | GitHub company later | Separate systems |
| Olympiad | CSV | — | Not from LinkedIn |

---

# 16. Caching and scrape-version (Part 16)

| Cache | Namespace | Key | TTL default | Writer |
| ----- | --------- | --- | -----------: | ------ |
| Search | `linkedin-search` | full search query string | 7d (`LINKEDIN_SEARCH_CACHE_TTL_MS`) | resolveIdentity |
| Profile | `linkedin-profile-v2` | profile URL | 30d | resolveIdentity |
| Website | `website-profile` | website URL | 7d | scrapeWebsite |

- Location: `CACHE_DIR` / namespace / `{slug}-{sha1[:8]}.json`
- Writes: atomic tmp+rename (`writeJsonAtomic`); failures swallowed
- `FORCE_REFRESH=1` → all `readCache` miss
- `PROFILE_SCRAPE_VERSION` (9): existing `candidates.json` skip requires exact version match; cache “full” check requires version + arrays present (**empty arrays count as full**)
- Failed/empty searches: **cached** (including `[]`)
- Errors during scrape: not specially cached as error objects; incomplete throw would abort that seed path (session may still continue for next seeds if error not thrown — extract errors would reject the await and fail the whole resolveIdentities try unless caught — **resolveIdentity does not try/catch around extract**, so a throw stops the batch after finally closes browser)

**Concurrent runs:** No file locking; two processes can race cache writes (last writer wins). API serializes UI runs via `activeRunId`.

---

# 17. Timing, throttling, concurrency (Part 17)

| Operation | Delay/timeout | Configurable | Source |
| --------- | ------------: | -----------: | ------ |
| Browser slowMo | 50ms | No (hardcoded in config object) | `BROWSER_LAUNCH_OPTIONS` |
| LINKEDIN_DELAY_MS | 1200 default | Yes env | config / search / details |
| Feed validate wait | 1500ms | No | linkedinBrowser |
| Contact scroll wait | 400ms | No | fetchContactInfo |
| Contact post-click | 700ms / Escape 400ms | No | fetchContactInfo |
| Section show-all | 300–500ms | No | sectionText |
| Nav timeout | 45000 | No | goto calls |
| main wait search | 20000 | No | search |
| main wait profile/details | 15000 | No | extract |
| overlay URL wait | 8000 | No | contact |
| MAX_LINKEDIN_RESULTS | 5 | Yes | config |
| MAX_IDENTITY_RESOLVES | 40 | Yes | config |
| Website fetch timeout | 12000 | Yes `WEBSITE_FETCH_TIMEOUT_MS` | scrapeWebsite |

**Concurrency model (CONFIRMED):**

- LinkedIn: **strictly sequential** on one page/session.
- Website scrapes: started as promises during resolve loop, awaited with `Promise.all` after browser close — **overlap with subsequent LinkedIn work**, not with browser close wait ordering for LI itself.
- No parallel LinkedIn pages.
- One failed seed with thrown exception can abort remaining resolves (no per-seed try/catch in loop).

**Retries / backoff:** MISSING for LinkedIn.

---

# 18. Failure-state matrix (Part 18)

```json
[
  {
    "failure": "Missing storage state file",
    "detected_by": "requireCookies / runPipeline warn / API startRun",
    "current_behavior": "Throw on session open; pipeline can continue if all LinkedIn data cached",
    "logged": true,
    "recoverable": true,
    "stops_seed": true,
    "stops_pipeline": false,
    "stored_for_retry": false
  },
  {
    "failure": "Expired session at open",
    "detected_by": "URL /login or /checkpoint after feed goto",
    "current_behavior": "Close browser; throw Error instructing npm run login",
    "logged": true,
    "recoverable": true,
    "stops_seed": true,
    "stops_pipeline": true,
    "stored_for_retry": false
  },
  {
    "failure": "Mid-run auth redirect",
    "detected_by": "MISSING structured detection",
    "current_behavior": "Likely empty/wrong extraction or thrown nav errors",
    "logged": false,
    "recoverable": false,
    "stops_seed": "unknown",
    "stops_pipeline": "unknown",
    "stored_for_retry": false
  },
  {
    "failure": "no_results",
    "detected_by": "hits.length===0",
    "current_behavior": "failed list; upsertPerson identity status",
    "logged": true,
    "recoverable": true,
    "stops_seed": true,
    "stops_pipeline": false,
    "stored_for_retry": true
  },
  {
    "failure": "no_name_match",
    "detected_by": "pickBestLinkedInHit null",
    "current_behavior": "failed list; logs top titles",
    "logged": true,
    "recoverable": true,
    "stops_seed": true,
    "stops_pipeline": false,
    "stored_for_retry": true
  },
  {
    "failure": "Contact info trigger/modal missing",
    "detected_by": "fetchContactInfo returns null + console.log",
    "current_behavior": "Continue with null socials/website from contact",
    "logged": true,
    "recoverable": true,
    "stops_seed": false,
    "stops_pipeline": false,
    "stored_for_retry": false
  },
  {
    "failure": "Missing profile sections",
    "detected_by": "empty detail text / empty arrays",
    "current_behavior": "Empty education/experience/awards/skills",
    "logged": false,
    "recoverable": true,
    "stops_seed": false,
    "stops_pipeline": false,
    "stored_for_retry": false
  },
  {
    "failure": "Personal-site scrape failure",
    "detected_by": "scrapeWebsite catch/HTTP",
    "current_behavior": "Log; leave LI URLs unchanged",
    "logged": true,
    "recoverable": true,
    "stops_seed": false,
    "stops_pipeline": false,
    "stored_for_retry": false
  }
]
```

**Absent vs failed:** Mostly **not distinguished**. Empty `education: []` means “parser found nothing or section empty,” not “navigation failed.” Contact failure is partially distinguished via logs + null contact fields.

---

# 19. Persistence and output lifecycle (Part 19)

```text
LinkedInProfile (in-memory)
  → writeCache linkedin-profile-v2
  → ResolvedIdentity
  → (website merge mutates linkedin.* URLs)
  → expandGraph RawCandidate pool
  → mergeCandidates → Candidate[]
  → output/candidates.json
  → writeSeedTreeProfiles → profiles/<seed>/...
  → persistPeople → data/people/<slug>.json
  → API tree.ts reads profiles/ for UI
```

LinkedIn fields feed scoring via `identity_confidence` and presence of profile; GitHub/Substack scoring is separate (`computeScore.ts` — not Playwright).

---

# 20. Tests and verifiability (Part 20)

| Area | Coverage |
| ---- | -------- |
| LinkedIn unit tests | **None** |
| Selector fixtures / HTML fixtures | **None** |
| `tests/example.spec.ts` | Playwright.dev demo only |
| Login expiry tests | **None** |
| Parser tests | **None** |

### Verification plan (no production mutation)

1. Run `npm run login` on a throwaway account if needed; confirm `cookies.json` has `cookies` + `origins` without committing it.
2. Point `SEEDS_PATH` at a one-name temp seed; set `MAX_IDENTITY_RESOLVES=1`.
3. First run: observe Chromium search → profile → details URLs in headed mode.
4. Second run: confirm search/profile cache hits in logs; delete one cache file to force refresh.
5. Set `FORCE_REFRESH=1` and confirm caches ignored.
6. Rename/move `cookies.json` and confirm warn + cache-only behavior.
7. Corrupt session (edit cookie values) and confirm `/login` or `/checkpoint` throw.
8. Unit-test pure functions offline by extracting fixtures later: `nameMatchesQuery`, `parseEducationDetail`, `classifyContactInfo`, `unwrapRedirectUrl` (functions are already pure-exportable).

---

# 21. Reusable Playwright infrastructure (Part 21)

```json
[
  {
    "component": "Browser launch options",
    "file": "src/config.ts",
    "functions": ["BROWSER_LAUNCH_OPTIONS"],
    "current_linkedin_assumptions": ["headed debugging for LinkedIn"],
    "generic_reuse_value": "MEDIUM",
    "changes_needed_before_reuse": ["Parameterize headless for CI", "Avoid global slowMo"],
    "security_considerations": ["Headed sessions visible on shared machines"]
  },
  {
    "component": "Manual storageState capture",
    "file": "src/linkedin/saveSession.ts",
    "functions": ["main"],
    "current_linkedin_assumptions": ["LinkedIn login URL"],
    "generic_reuse_value": "HIGH",
    "changes_needed_before_reuse": ["Parameterize target URL and output path"],
    "security_considerations": ["Never commit storageState"]
  },
  {
    "component": "Lazy authenticated session",
    "file": "src/linkedin/linkedinBrowser.ts",
    "functions": ["openLinkedInSession", "requireCookies", "sleep"],
    "current_linkedin_assumptions": ["feed URL", "login/checkpoint URL substrings"],
    "generic_reuse_value": "HIGH",
    "changes_needed_before_reuse": ["Inject validateUrl predicate", "Avoid module globals or document single-flight"],
    "security_considerations": ["Separate storageState per service"]
  },
  {
    "component": "JSON TTL cache",
    "file": "src/storage/jsonStore.ts",
    "functions": ["readCache", "writeCache", "writeJsonAtomic"],
    "current_linkedin_assumptions": [],
    "generic_reuse_value": "HIGH",
    "changes_needed_before_reuse": ["Optional locking for multi-process"],
    "security_considerations": ["Cache may hold PII; keep gitignored"]
  },
  {
    "component": "Redirect URL unwrap",
    "file": "src/linkedin/linkedinExtract.ts",
    "functions": ["unwrapRedirectUrl"],
    "current_linkedin_assumptions": ["LinkedIn redir/safety/go shapes"],
    "generic_reuse_value": "MEDIUM",
    "changes_needed_before_reuse": ["Generalize host allowlists"],
    "security_considerations": ["Open redirect decoding"]
  },
  {
    "component": "Scrape-version gate",
    "file": "src/linkedin/linkedinExtract.ts + resolveIdentities.ts",
    "functions": ["PROFILE_SCRAPE_VERSION", "isFullLinkedInProfile"],
    "current_linkedin_assumptions": ["LinkedInProfile shape"],
    "generic_reuse_value": "MEDIUM",
    "changes_needed_before_reuse": ["Empty-array should not imply completeness"],
    "security_considerations": []
  },
  {
    "component": "People search + selectors",
    "file": "src/linkedin/linkedinSearch.ts",
    "functions": ["searchLinkedInByName"],
    "current_linkedin_assumptions": ["LinkedIn people search DOM"],
    "generic_reuse_value": "LOW",
    "changes_needed_before_reuse": ["Do not reuse selectors outside LinkedIn"],
    "security_considerations": ["ToS / scraping policy"]
  },
  {
    "component": "Profile extractors / parsers",
    "file": "src/linkedin/linkedinExtract.ts",
    "functions": ["extractLinkedInProfile", "parse*Detail", "fetchContactInfo"],
    "current_linkedin_assumptions": ["English headings", "detail URL layout", "line-order parsers"],
    "generic_reuse_value": "LOW",
    "changes_needed_before_reuse": ["Treat as LinkedIn-only module"],
    "security_considerations": ["PII extraction"]
  },
  {
    "component": "Identity match / olympiad seeds",
    "file": "linkedinMatch.ts, parseSeeds.ts, olympiad/*",
    "functions": ["pickBestLinkedInHit", "parseSeeds", "olympiadSearchHints"],
    "current_linkedin_assumptions": ["T-Search seed product"],
    "generic_reuse_value": "LOW",
    "changes_needed_before_reuse": ["Keep isolated from other automations"],
    "security_considerations": []
  }
]
```

---

# 22. Fragility and technical debt (Part 22)

| Issue | Severity | Evidence | Likely failure | Impact | Affects reuse? |
| ----- | -------- | -------- | -------------- | ------ | -------------- |
| CSS class selectors for search/top card | HIGH | `entity-result__*`, `pv-text-details__*` | Zero hits / null location | Wrong or missed identities | Yes — LI module breaks |
| English-only headings | HIGH | About/Skills/Featured/Honors regexes | Empty sections | Partial profiles | Yes |
| Raw line-order experience/education parsers | HIGH | `parseExperienceDetail` assumptions | Swapped title/company | Bad structured data | Yes |
| Country not used in result ranking | HIGH | `expected_country` unused for scoring | Wrong-country homonyms accepted | Identity errors | Product logic |
| `school` search hint unused on main path | MEDIUM | resolveIdentities omits school | Weaker disambiguation | PARTIAL feature | Product |
| `education.field` never populated | MEDIUM | parser | Always null | Schema lie | Low for reuse |
| No mid-run auth detection | HIGH | only open-time check | Silent garbage extracts | Bad data / hard debug | Yes |
| No screenshots/traces/retries | HIGH | absent | Opaque failures | Ops cost | Yes |
| Empty arrays treated as full profile | MEDIUM | `isFullLinkedInProfile` | Cache sticks on hollow scrape | Stale empties | Yes |
| Module-level browser globals | MEDIUM | activeBrowser | Concurrent open hazards | Process bugs | Yes |
| Logs include emails/URLs/names | MEDIUM | resolveIdentities website log | PII in terminals/CI logs | Privacy | Yes |
| **`profiles/` and `backup/` committed** | CRITICAL | git ls-files counts | Public PII exposure | Security | Policy |
| Misleading `cookies.json` name | LOW | storageState | Operator confusion | Mistaken sharing | Docs |
| Zero LinkedIn tests | HIGH | tests/ | Regressions unnoticed | Fragility | Yes |
| Dead code | LOW | `profileFromSearchHit`, `extractProfileLinksOnly`, `extractTopCardRoleLines`, `cleanSectionLines` | Confusion | Maintainability | Low |

---

# Deliverable 2 — Complete execution-flow diagram

```text
[npm run login]
  chromium → LinkedIn /login → user Enter → storageState(cookies.json) → close

[npm run pipeline] / [API spawn]
  parseSeeds + olympiad CSV + load candidates.json
       ↓
  resolveIdentities (cap MAX_IDENTITY_RESOLVES)
       ├─ cache hit candidates scrape_version=9? → reuse → website job?
       ├─ search cache? else openSession? → searchLinkedInByName → cache
       ├─ pickBestLinkedInHit → no_results / no_name_match
       ├─ profile cache full v9? else extractLinkedInProfile → cache
       └─ confidence adjust
       ↓
  finally close Chromium
       ↓
  await website HTTP scrapes (override social URLs)
       ↓
  expandGraph (GitHub/Substack) → merge → score
       ↓
  output/candidates.json + seed_tree.json
  profiles/** + data/people/**
```

---

# Deliverable 3 — File-by-file Playwright inventory

| File | Responsibility |
| ---- | -------------- |
| `src/config.ts` | Env, paths, TTLs, `BROWSER_LAUNCH_OPTIONS`, delays |
| `src/types.ts` | `LinkedInProfile` and nested types |
| `src/linkedin/saveSession.ts` | Manual login + storageState write |
| `src/linkedin/linkedinBrowser.ts` | Open/validate/close session |
| `src/linkedin/linkedinSearch.ts` | People search URL + DOM extract |
| `src/linkedin/linkedinMatch.ts` | Name match + pick best hit |
| `src/linkedin/countryMatch.ts` | Country aliases / location→country |
| `src/linkedin/linkedinExtract.ts` | Full profile scrape + parsers + contact classify |
| `src/pipeline/resolveIdentities.ts` | Orchestrates search/match/scrape/cache/session |
| `src/pipeline/runPipeline.ts` | CLI entry; wires resolve→expand→persist |
| `src/pipeline/runBranchExpand.ts` | Known-URL LinkedIn scrape path |
| `src/pipeline/candidateLookup.ts` | Reuse prior candidates |
| `src/storage/jsonStore.ts` | Cache I/O |
| `src/website/scrapeWebsite.ts` | Post-LI HTTP enrichment |
| `scripts/debugContact.ts` | Manual contact debug |
| `playwright.config.ts` | Test runner only (not pipeline) |
| `tests/example.spec.ts` | Unrelated example tests |

---

# Deliverable 6 — Authentication and security report (summary)

- Auth = Playwright storageState on disk; gitignored; not credentials.
- Session validated only at feed open via URL heuristics.
- GitHub token via env/gh CLI; `.env` gitignored.
- **Critical:** scraped `profiles/` (39 tracked files observed) and `backup/` (131 tracked) contain personal graph/profile JSON and are **not** gitignored.
- Logs can print personal website emails.
- No encryption of artifacts at rest.

---

# Deliverable 10 — Context handoff

## T-Search Playwright System Context for Future Projects

**Runtime and language:** Node.js + TypeScript (`tsx`), npm, CommonJS package. Playwright **1.61.1** installed (`package.json` allows `^1.52.0`).

**Browser launch settings:** `chromium.launch({ headless: false, slowMo: 50 })`. Pipeline context viewport `1280×900`. No persistent user-data-dir. No proxy/stealth code.

**Authentication approach:** Operator runs `npm run login` → headed Chromium → LinkedIn login page → press Enter → `context.storageState` written to `COOKIES_PATH` (default `cookies.json`). Contains cookies + some localStorage origins. Passwords are not saved by the script.

**Session lifecycle:** `openLinkedInSession()` loads storageState, opens `/feed/`, rejects if URL contains `/login` or `/checkpoint`, returns `{ page, close }`. `resolveIdentities` opens **one** session lazily for the whole seed batch and closes it in `finally`. One page is reused for all searches and profile navigations.

**Search approach:** Build keywords `"Name"` + optional olympiad hints + country term (+ school if provided). Navigate LinkedIn people search. Parse up to `MAX_LINKEDIN_RESULTS` (5) from `reusable-search__result-container` / `.entity-result`, else fallback `/in/` links in `main`.

**Matching approach:** Require all query name tokens in the result title. If country or olympiad hints present (“targeted”), accept first name-matching result at confidence 0.85 (+0.1 if confirmed). Else only accept the first result at 0.5. **Does not score country agreement with the card location.**

**Extracted profile fields:** `url, name, photo_url, headline, college, school, degree, country, graduation_year, education[], keywords[], github_url, substack_url, twitter_url, personal_website, website_url, contact_links[], experience[], awards[], skills[], scrape_version`. Education `field` is declared but never filled. About text is not stored. Email/phone are not taken from LinkedIn.

**Contact-info approach:** Click Contact info (multiple trigger selectors), wait for overlay URL or modal/dialog, scrape text+hrefs, classify personal website (Personal label or score≥3), parse GitHub/Substack/Twitter from contact (and Featured), unwrap LinkedIn redirect URLs, close with Escape.

**Cache approach:** Filesystem JSON under `cache/` with SHA1-suffixed names, TTLs (search 7d, profile 30d), `FORCE_REFRESH=1` bypass, `scrape_version` 9 invalidates candidate reuse / “full profile” checks. Empty search results are cached.

**Timing approach:** `LINKEDIN_DELAY_MS` (default 1200) after many navigations; assorted fixed sleeps; 45s navigation timeouts; headed + slowMo 50. Sequential LinkedIn; parallel website HTTP after/during resolve.

**Error-handling approach:** Soft failures for contact/sections (empty fields). Hard failures for missing/expired session at open. Seed-level `no_results` / `no_name_match` recorded. No structured retries, screenshots, or traces. Thrown scrape errors are not per-seed isolated.

**Output locations:** `output/candidates.json`, `output/seed_tree.json`, `cache/linkedin-*`, `data/people/` (gitignored), `profiles/` (currently committed).

**Reusable components:** storageState login capture; launch options; lazy session open/validate/close; `sleep`; JSON TTL cache; atomic writes; redirect unwrap; scrape-version idea.

**Non-reusable LinkedIn-specific pieces:** All people-search/top-card/contact/detail selectors; education/experience/honors line parsers; olympiad/seed identity matching; T-Search graph expansion product logic.

**Known limitations:** Fragile DOM; English UI assumptions; country not used to reject wrong matches; school hint unused in main pipeline; no mid-run auth detection; hollow profiles cacheable; committed profile backups; no LinkedIn automated tests; About/email/phone/job descriptions not extracted.

**Open questions (need runtime testing):**

1. How often search CSS containers still match current LinkedIn DOM.
2. Experience parser accuracy on multi-role company groupings.
3. Skills extraction success rate (observed cache sample had 0 skills).
4. Behavior when session expires mid-batch.
5. Whether Contact info `<dialog>` path vs body-scrape path dominates in current UI.
6. Whether `origins` localStorage entries are required for session validity or incidental.

---

*End of audit. No application source files were modified. Only this documentation file was added.*
