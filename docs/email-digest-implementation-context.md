# tSearch Email Digest — Technical Context Report

**Audience:** Engineer writing an implementation plan for a ranked candidate email digest  
**Repository:** tSearch  
**Audit date:** 2026-07-21  
**Constraint:** Read-only inspection; no code was modified  

**Evidence labels:**

| Label | Meaning |
| ----- | ------- |
| CONFIRMED | Established from executable code or local artifacts |
| PARTIAL | Present but incomplete / unused on the live path |
| DEAD | Defined but not called from production entry points |
| MISSING | Not present in the repository |
| INFERRED | Reasonable from naming/structure; not proven at runtime |

---

# 1. Repository Overview

## Main purpose (CONFIRMED)

tSearch discovers and ranks “unseen talent” by:

1. Seeding from olympiad medalists / named people (`seeds.json`, olympiad CSV).
2. Resolving LinkedIn identities via Playwright Chromium.
3. Enriching via personal websites (HTTP), GitHub REST API, and Substack.
4. Expanding a GitHub collaborator/follower graph (hop 1–2).
5. Scoring candidates and persisting ranked JSON + a seed-centric profile tree.
6. Visualizing the tree in a React UI and allowing on-demand branch expansion.

## Languages and frameworks (CONFIRMED)

| Layer | Stack |
| ----- | ----- |
| Pipeline / API | TypeScript, Node.js, `tsx`, Express 5, Playwright, dotenv |
| Frontend | React 19, Vite 8, `react-force-graph-2d` |
| Utilities | Python (`olympiad_seeds.py`, scrapers) |
| Package manager | npm (`package-lock.json`) |
| Module system | Root `"type": "commonjs"`; web is ESM |

## Major entry points (CONFIRMED)

| Command | Entry | Role |
| ------- | ----- | ---- |
| `npm run login` | `src/linkedin/saveSession.ts` | Capture LinkedIn Playwright storageState |
| `npm run pipeline` | `src/pipeline/runPipeline.ts` | Full resolve → expand → score → persist |
| `npm run seeds` | `olympiad_seeds.py` | Generate olympiad-derived seed JSON |
| `npm run dev:api` | `server/index.ts` | Express API on `:8787` |
| `npm run dev:web` | `web/` Vite | UI |
| `npm run dev` | concurrently | API + web |

## Architecture layers (CONFIRMED)

| Layer | Location | Role |
| ----- | -------- | ---- |
| Frontend | `web/src/` | Seed picker, run controls, radial force graph, profile panel, logs |
| Backend API | `server/` | Spawn pipeline, SSE logs, serve trees/profiles |
| Scraping | `src/linkedin/` | Playwright LinkedIn search + profile extract |
| Data processing | `src/pipeline/`, `src/scoring/`, `src/olympiad/`, `src/website/` | Identity, expand, merge, score |
| GitHub | `src/github/` | REST fetch + expand |
| Persistence | `src/storage/` + filesystem dirs | Cache, people, profiles, candidates |
| Visualization | `web/src/RadialTree.tsx` + `server/tree.ts` | Graph from `profiles/` |

## External services (CONFIRMED)

- LinkedIn (browser automation; authenticated session required)
- GitHub REST API (`api.github.com`)
- Personal websites (HTTP `fetch`)
- Substack (HTTP / feed expansion)
- Optional: `gh auth token` for GitHub auth when `GITHUB_TOKEN` unset

## Local start (CONFIRMED)

```text
npm install
npm run login          # once: LinkedIn session → cookies.json
npm run dev            # API :8787 + Vite UI (proxied /api)
# OR
npm run pipeline       # CLI batch from SEEDS_PATH
```

## Complete pipeline execution (CONFIRMED)

CLI: `runPipeline.ts` → olympiad load → `resolveIdentities` → `expandGraph` → `mergeCandidates`/`scoreCandidate` → write `output/candidates.json` + `seed_tree.json` → `writeSeedTreeProfiles` → `upsertPerson`.

UI: `POST /api/runs` → temp seed file → spawn `npm run pipeline` → SSE logs → on done load `/api/tree/:seedSlug`.

## Important directory tree

```text
tSearch/
  package.json                 # scripts + playwright/express deps
  src/
    config.ts                  # env, paths, caps, browser options
    types.ts                   # Candidate, LinkedIn/GitHub/… schemas
    pipeline/
      runPipeline.ts           # main CLI orchestration
      resolveIdentities.ts     # LinkedIn identity resolution
      expandGraph.ts           # GitHub/Substack expansion + seedTree
      mergeCandidates.ts       # dedupe + score sort
      runBranchExpand.ts       # known-URL branch expand
      candidateLookup.ts       # reuse prior candidates
    linkedin/                  # Playwright session/search/match/extract
    github/                    # REST client + expand
    scoring/computeScore.ts    # final_score formula
    storage/                   # jsonStore, personStore, profileStore
    website/scrapeWebsite.ts   # HTTP site enrichment
    seeds/seeds.json
  server/                      # Express API + tree builder + runs
  web/src/                     # React UI (App, RadialTree, ProfilePanel, api)
  cache/                       # TTL caches (gitignored)
  data/people/                 # PersonRecord upserts (gitignored)
  output/                      # candidates.json, seed_tree.json (gitignored)
  profiles/                    # seed tree folders (currently tracked)
  docs/                        # audits / this report
  olympiad_winners.csv
  cookies.json                 # storageState (gitignored)
```

---

# 2. End-to-End Pipeline

**Corrected flow (CONFIRMED — differs from the prompt’s template):**

```text
Seed source (JSON / olympiad CSV / UI temp seed)
→ Seed parsing (parseSeeds)
→ Olympiad lookup (optional scoring hints + country)
→ Existing candidates.json scrape_version skip (optional)
→ LinkedIn people search (Playwright) OR search cache
→ Name-based hit selection (pickBestLinkedInHit)
→ LinkedIn profile scrape OR profile cache
→ Personal-website HTTP enrichment (parallel after LI)
→ GitHub expansion FROM URL (not name search on main path)
→ Collaborator + rich-follower hydration
→ Optional Substack expansion
→ Candidate pool merge + computeScore
→ Ranked candidates.json + seed_tree.json
→ profiles/<seed>/… tree files
→ data/people/*.json person records
→ Frontend: buildTree → RadialTree + ProfilePanel
```

**Important correction:** GitHub identity on the main path comes from **LinkedIn Contact/Featured and/or personal website**, then `expandGithubFromUrl`. `searchGithubUser` / `resolveGithubUsername` exist in `src/github/githubSearch.ts` but are **DEAD on the pipeline path** (no callers under `src/pipeline/`).

## Lifecycle of one seed person

| Step | Function | File | Inputs | Outputs | Side effects | External APIs | Errors / retry | Persistence |
| ---- | -------- | ---- | ------ | ------- | ------------ | ------------- | -------------- | ----------- |
| 1. Load seeds | `parseSeeds` | `src/seeds/parseSeeds.ts` | JSON array | `SeedQuery[]` | none | none | throw on bad shape | none |
| 2. Olympiad index | `loadOlympiadCsv` / `lookupOlympiad` | `src/olympiad/parseOlympiad.ts` | CSV path, name | `OlympiadProfile?` | none | none | skip bad rows | none |
| 3. Skip if known | `findScrapedCandidate` | `src/pipeline/candidateLookup.ts` | existing candidates, seed | Candidate? | none | none | none | reads `OUTPUT_PATH` |
| 4. Open session (lazy) | `openLinkedInSession` | `src/linkedin/linkedinBrowser.ts` | `COOKIES_PATH` | `LinkedInSession` | Chromium | LinkedIn | throw if expired; **no retry** | none |
| 5. Search | `searchLinkedInByName` | `src/linkedin/linkedinSearch.ts` | name, context | `LinkedInSearchHit[]` | browser nav | LinkedIn | empty → `no_results` | `cache/linkedin-search` |
| 6. Match | `pickBestLinkedInHit` | `src/linkedin/linkedinMatch.ts` | hits, MatchContext | hit + confidence | none | none | `no_name_match` | none |
| 7. Scrape | `extractLinkedInProfile` | `src/linkedin/linkedinExtract.ts` | hit, queryName | `LinkedInProfile` | browser nav | LinkedIn | soft contact miss; throw uncaught stops batch | `cache/linkedin-profile-v2` |
| 8. Website | `scrapeWebsite` / `applyWebsiteToLinkedInUrls` | `src/website/scrapeWebsite.ts` | personal_website URL | `WebsiteProfile` | HTTP | personal site | log + null; no retry | `cache/website-profile` |
| 9. Expand GH | `expandGithubFromUrl` | `src/github/githubExpand.ts` | github URL | profile + collaborators | HTTP | GitHub REST | `ghFetch` returns null; 404 cached | `cache/github` |
| 10. Neighbors | loop in `expandGraph` | `src/pipeline/expandGraph.ts` | logins | RawCandidates + SeedTreeEdge | HTTP | GitHub | skip null profiles | none until merge write |
| 11. Merge/score | `mergeCandidates` / `scoreCandidate` | `mergeCandidates.ts`, `computeScore.ts` | RawCandidate[] | ranked `Candidate[]` | none | none | none | none |
| 12. Persist ranked | `runPipeline.main` | `runPipeline.ts` | ranked | files | write | none | exit 1 if zero identities | `output/candidates.json`, `seed_tree.json` |
| 13. Tree profiles | `writeSeedTreeProfiles` | `profileStore.ts` | ranked + tree | ProfileRecords | write | none | none | `profiles/**` |
| 14. People | `upsertPerson` / `persistPeople` | `personStore.ts`, `runPipeline.ts` | ranked + failed | PersonRecords | write | none | none | `data/people/*.json` |
| 15. UI | `buildTree` → `fetchTree` → `RadialTree` | `server/tree.ts`, `web/` | seedSlug | TreeResponse | none | local API | 404 if missing | reads profiles |

---

# 3. API Routing

All application HTTP routes live in `server/index.ts`. No WebSockets. Runs use **Server-Sent Events**. No server actions / RPC framework.

| Method | Route | File | Purpose | Request | Response | Called by |
| ------ | ----- | ---- | ------- | ------- | -------- | --------- |
| GET | `/api/health` | `server/index.ts` | Health + cookies/profiles paths | — | `{ ok, cookies, cookiesPath, profilesDir, activeRunId }` | ops / manual |
| GET | `/api/seeds` | same | Seed list + which have trees | — | `{ seeds: [{name,country,hasTree}], profileSeeds }` | `web/src/api.ts` `fetchSeeds` |
| GET | `/api/trees` | same | List seed slugs with trees | — | `{ seeds: string[] }` | convenience |
| POST | `/api/runs` | same | Start seed pipeline | `{ name, country }` | `202 { runId }` or 4xx | `startRun` in UI |
| POST | `/api/runs/branch` | same | Branch expand | `{ rootSeedSlug, parentSlug, relation }` | `202 { runId }` | `startBranchRun` |
| GET | `/api/runs/:id` | same | Run status snapshot | — | `{ id, name, country, status, …, logCount }` | optional polling |
| GET | `/api/runs/:id/events` | same | SSE log stream | — | SSE `data: {type:log\|done\|error}` | `subscribeRunEvents` |
| GET | `/api/tree/:seedSlug` | same | Graph for UI | — | `TreeResponse` | `fetchTree` |
| GET | `/api/profile/:seedSlug/seed` | same | Seed ProfileRecord | — | `ProfileRecord` | `fetchProfile` |
| GET | `/api/profile/:seedSlug/:relation/:slug` | same | Hop-1 neighbor | relation=`collaborator\|follower` | `ProfileRecord` | UI |
| GET | `/api/profile/:seedSlug/:parentRelation/:parentSlug/:relation/:slug` | same | Hop-2 neighbor | — | `ProfileRecord` | UI |

### Example: start run

Request:

```json
POST /api/runs
{ "name": "Varun Madan", "country": "United States" }
```

Response (CONFIRMED shape):

```json
{ "runId": "a1b2c3d4e5f6" }
```

### Example: tree response (CONFIRMED types in `server/tree.ts`)

```json
{
  "seedSlug": "madanva",
  "seed": { "slug": "madanva", "name": "…", "relation": "seed", "hop": 0, "…": "…" },
  "nodes": [
    {
      "id": "madanva",
      "name": "…",
      "relation": "seed",
      "hop": 0,
      "context_score": 0,
      "context_signals": [],
      "can_expand": false
    }
  ],
  "edges": [
    {
      "from": "madanva",
      "to": "someuser",
      "via": "github-collaborator",
      "context_score": 5,
      "hop": 1
    }
  ]
}
```

### Third-party APIs initiated by backend/pipeline (not Express routes)

| Service | Client | Notes |
| ------- | ------ | ----- |
| GitHub REST | `ghFetch` in `githubSearch.ts` | Bearer token; cached |
| LinkedIn | Playwright | Session storageState |
| Arbitrary websites | `scrapeWebsite` | HTTP |
| Substack | `src/substack/*` | HTTP |

**MISSING for digest:** No `/api/digest`, `/api/candidates`, `/api/feedback`, or email endpoints.

---

# 4. Data Models and JSON Structures

## Fragmentation warning (CONFIRMED)

There is **no single canonical Person object**. Person-like data is fragmented across:

| Schema | File | Role |
| ------ | ---- | ---- |
| `SeedQuery` | `parseSeeds.ts` | Input |
| `LinkedInProfile` | `types.ts` | Scraped LI |
| `GitHubProfile` | `types.ts` | GitHub |
| `WebsiteProfile` | `types.ts` | Site scrape |
| `OlympiadProfile` | `types.ts` | CSV enrichment |
| `ResolvedIdentity` | `types.ts` | Post-LI resolve |
| `RawCandidate` | `mergeCandidates.ts` | Pre-score pool |
| `Candidate` | `types.ts` | Ranked output (canonical for digest scores) |
| `PersonRecord` | `personStore.ts` | Accumulating per-person file |
| `ProfileRecord` | `profileStore.ts` | Tree node on disk / UI |
| `TreeNodeSummary` / `TreeEdge` | `server/tree.ts` | UI DTO |
| `RunRecord` | `server/runs.ts` | In-memory run only |

**Best source for a ranked digest:** `Candidate` in `output/candidates.json`.  
**Best source for discovery path in the UI tree:** `ProfileRecord.discovered_via` + `seed_tree.json` edges + `profiles/` layout.  
These are related but not identical views.

## `SeedQuery` — `src/seeds/parseSeeds.ts`

```ts
{ name: string; country?: string }
```

Example: `{ "name": "Varun Madan", "country": "United States" }`  
Also accepts bare string seeds.

## `LinkedInProfile` — `src/types.ts`

Fields: `url, name, photo_url, headline, college, school, degree, country, graduation_year, education[], keywords[], github_url, substack_url, twitter_url, personal_website, website_url, contact_links[], experience[], awards[], skills[], scrape_version?`

Nested: `LinkedInEducation { school, degree, field, years }`, `LinkedInExperience { title, company, dates, location }`, `LinkedInAward { title, issuer, date }`.

Created: `extractLinkedInProfile`. Consumed: resolve, expand, merge, profileStore, UI panel.

## `GitHubProfile` — `src/types.ts`

Fields include: `username, display_name, profile_url, bio, blog, twitter_username, company, location, email, social_accounts[], context_score, context_signals[], repos[], contributors[], stars[], forks[], followers[], following[], recent_commits, active`.

Created: `fetchGithubProfile` / filled further by `expandGithubFromUsername`.

## `WebsiteProfile` — `src/types.ts`

`url, scraped_at, github_url, substack_url, twitter_url, linkedin_url, email, instagram_url, youtube_url, other_links[], all_links[]`.

## `OlympiadProfile` — `src/types.ts`

`name, years[], sources[], prizes[], countries[], olympiadScore, medalScore, recencyScore, ageScore`.

## `Candidate` — `src/types.ts` (digest-critical)

```ts
{
  name: string;
  key: string;                    // usually lowercased name or github login
  discovered_via: string[];
  linkedin?: LinkedInProfile;
  identity_confidence: number;
  github?: GitHubProfile;
  substack?: SubstackProfile;
  website?: WebsiteProfile;
  olympiad?: OlympiadProfile;
  final_score: number;
  score_breakdown: {
    builder: number;
    thinker: number;
    olympiad: number;
    weirdness: number;
    identity: number;
  };
}
```

Created: `mergeCandidates` → `scoreCandidate`. Persisted: `output/candidates.json`.

Example (from local `output/candidates.json`, structure CONFIRMED):

```json
{
  "name": "Varun Madan",
  "key": "varun madan",
  "discovered_via": ["linkedin:Varun Madan", "github-verified:Varun Madan"],
  "identity_confidence": 0.95,
  "final_score": 2.09,
  "score_breakdown": {
    "builder": 0.5,
    "thinker": 0,
    "olympiad": 1.4,
    "weirdness": 0,
    "identity": 0.19
  }
}
```

## `ProfileRecord` — `src/storage/profileStore.ts`

Tree node with `slug, name, kind, relation, hop, seed, discovered_via, parents, linkedin?, github?, website?, olympiad?, links, context_score, context_signals, last_updated`.

Note: stores **GitHub `context_score`**, not `Candidate.final_score`.

## `PersonRecord` — `src/storage/personStore.ts`

Accumulating record with `identity`, `graph`, `scores`, `score_history[{run_at, final_score}]`, `freshness`, `links`, etc.

## `SeedTreeEdge` — `expandGraph.ts`

`from, from_github, to_github, via, context_score?, context_signals?, hop?, via_node?, root_github?, parent_relation?`.

## `RunRecord` — `server/runs.ts`

In-memory only: `id, name, country, status, startedAt, finishedAt?, seedSlug?, error?, logs[], listeners, child?, kind?`. **Not persisted to disk.**

---

# 5. Persistence and Storage

| Store | Tech | Path | Purpose | Gitignored? |
| ----- | ---- | ---- | ------- | ----------- |
| Ranked candidates | JSON file | `output/candidates.json` (`OUTPUT_PATH`) | Global ranked list | Yes |
| Seed tree edges | JSON | `output/seed_tree.json` | Discovery graph for profiles write | Yes |
| Profile tree | JSON files | `profiles/<seed>/…/profile.json` | UI tree | **No (tracked)** |
| People | JSON files | `data/people/<slug>.json` | Accumulating person metadata | Yes |
| Caches | JSON | `cache/{github,linkedin-search,linkedin-profile-v2,website-profile,substack}/` | TTL caches | Yes |
| LinkedIn session | storageState | `cookies.json` | Auth | Yes |
| UI runs | memory Map | `server/runs.ts` | Active/recent runs | N/A |
| DB | **None** | — | — | — |

**Duplicate detection:** `mergeCandidates` / `addRaw` key by `key` or normalized name; LinkedIn search dedupes URLs; GitHub logins lowercased in maps.

**Identity resolution:** LinkedIn name match + targeted search confidence; GitHub via URL not name search on main path; olympiad name key lookup.

**Search runs:** Ephemeral `runId` (12 hex chars) in memory only. No durable run archive.

**Historic rankings:** `PersonRecord.score_history` appends `{run_at, final_score}` when scores upserted. Full ranked lists overwrite `candidates.json` (no versioned history of full digests).

### Can a digest be regenerated without re-scraping? (CONFIRMED)

**Mostly yes**, if these exist:

- `output/candidates.json` (scores, breakdown, links, discovered_via, LI/GH blobs)
- Optionally `output/seed_tree.json` + `profiles/**` for path visualization
- Optionally `data/people/*.json` for score history

**Caveats:** No durable “run ID” tying a digest to a specific pipeline execution; `candidates.json` is overwritten; tree UI filters by `context_score`, not `final_score`.

---

# 6. LinkedIn and Playwright Scraping

(Summary consistent with `docs/tsearch-playwright-system-audit.md`; condensed for digest planning.)

| Setting | Value | Source |
| ------- | ----- | ------ |
| Launch | `chromium.launch({ headless: false, slowMo: 50 })` | `config.ts` `BROWSER_LAUNCH_OPTIONS` |
| Persistent context | **No** | code |
| Auth | Manual login → `storageState` → `COOKIES_PATH` | `saveSession.ts` |
| Session validate | Feed URL; fail on `/login` or `/checkpoint` | `linkedinBrowser.ts` |
| Parallelism | One page, sequential people | `resolveIdentities.ts` |
| Delay | `LINKEDIN_DELAY_MS` default 1200 | config |
| Retry | **None** for LI | — |
| Captcha / 2FA | Not handled; checkpoint = session expired | — |
| Screenshots/traces | **None** in pipeline | — |

### Extracted fields (digest-relevant)

| Field | Locator / logic | Output | Fallback |
| ----- | --------------- | ------ | -------- |
| name | `main h1` / section h2 | `LinkedInProfile.name` | search hit title / query |
| headline | `.text-body-medium` / heuristics | `headline` | search headline |
| location→country | top-card small text / lines | `country` | search location |
| education | `/details/education/` text parse | `education[]`, school/college/degree | empty |
| experience | `/details/experience/` | `experience[]` | empty |
| awards | `/details/honors/` | `awards[]` | empty |
| skills | Skills section lines | `skills[]` | empty (often) |
| github/substack/twitter | Contact + Featured only | URLs | website scrape overrides |
| personal_website | Contact classify / score | `personal_website` | null |
| photo | `img[src*="profile-displayphoto"]` | `photo_url` | null |

**Brittle:** LinkedIn CSS classes; English headings; fixed sleeps; raw line parsers; no mid-run auth check.

---

# 7. GitHub Integration

## Auth (CONFIRMED)

- `GITHUB_TOKEN` env, else `gh auth token` CLI (`config.ts`).
- Header: `Authorization: Bearer …` when token present (`githubSearch.ts` `headers()`).
- Client: raw `fetch` to `https://api.github.com` — **REST only, no GraphQL**.

## Rate limiting / caching (CONFIRMED)

- Sleep `GITHUB_DELAY_MS` (default 800) before each uncached call.
- Cache namespace `github`, TTL `GITHUB_CACHE_TTL_MS` (7d).
- 404/410 cached as null; 429/5xx **not** cached (retry next run only).
- No explicit X-RateLimit handling.

## API calls

| API call | Code location | Input | Output fields used | Downstream |
| -------- | ------------- | ----- | ------------------ | ---------- |
| `GET /users/{user}` | `fetchGithubProfile` | login | profile fields | Candidate.github, context_score |
| `GET /users/{user}/repos?sort=pushed&per_page=30` | same | login | repos, topics, stars | expand + builder/weirdness |
| `GET /users/{user}/social_accounts` | same | login | social links | context_score, LinkedIn URL |
| `GET /repos/{user}/{repo}/commits?since=…` | same | top 5 repos | recent_commits count | `active`, builder score |
| `GET /users/{user}/followers?per_page=30` | `fetchFollowersFollowing` | login | logins | follower expand |
| `GET /users/{user}/following?per_page=30` | same | login | logins | peripheral set only |
| `GET /repos/{user}/{repo}/contributors?per_page=30` | `fetchRepoContributors` | top repos | logins | **collaborators** |
| `GET /repos/{user}/{repo}/stargazers` | `fetchStargazers` | top repos | logins | peripheral |
| `GET /repos/{user}/{repo}/forks` | `fetchForkers` | top repos | owner logins | peripheral |
| `GET /search/users?q=` | `searchGithubUser` | name | items | **DEAD on pipeline** |

## Distinctions (CONFIRMED)

| Concept | Distinguished? | How used |
| ------- | -------------- | -------- |
| Followers | Yes | Hydrated; rich filter → seed tree `github-follower` |
| Following | Yes | Collected into `peripheral`; **not** separately expanded as tree edges |
| Repo contributors | Yes | Treated as **collaborators** (primary edges) |
| Repo collaborators (GitHub Collaborators API) | **No** | Uses contributors endpoint, not collaborator invitation API |
| Org members | **No** | |
| Commit co-authors | **No** | Only commit count for activity |
| Stargazers / forkers | Yes | Peripheral; not primary tree edges in expandGraph |

## Identity matching LinkedIn → GitHub (CONFIRMED)

1. LinkedIn Contact/Featured github URL and/or website scrape github URL.  
2. `githubUsernameFromUrl` → `expandGithubFromUrl`.  
3. Name-based GitHub search exists but is unused by pipeline.

## Scoring signals from GitHub (CONFIRMED)

- **Candidate `final_score` builder/weirdness:** `active`, repo count, recent_commits, weird topics (`computeScore.ts`).
- **Separate `context_score`:** blog/twitter/email/bio/company/location/socials/repos (`computeGithubContextScore`) — used for expand/UI filtering, **not** added into `final_score`.

---

# 8. Candidate Discovery and Graph Expansion

## Sources (CONFIRMED)

1. Seed LinkedIn identities  
2. GitHub repo contributors → collaborators (hop 1)  
3. GitHub followers with `context_score >= MIN_CONTEXT_SCORE_TO_EXPAND` (default 2) → followers (hop 1)  
4. Substack 1-hop neighbors (into candidate pool; not the profile tree layout)  
5. UI branch expand (`runBranchExpand`) for hop-2 under a hop-1 node with LinkedIn  

Stargazers/following are discovered into `peripheral` / `discovered_logins` but **expandGraph does not create seed-tree edges for them**.

## Pseudocode matching `expandGraph` (CONFIRMED)

```text
for each ResolvedIdentity:
  add seed to pool (linkedin + olympiad + website)
  githubUrl = website.github_url ?? identity.github_url
  if githubUrl:
    gh = expandGithubFromUrl(githubUrl)  # profile + collaborators + followers lists
    merge seed github into pool
    for login in collaborators[:MAX_COLLABORATOR_PROFILES=15]:
      fetchGithubProfile(login)
      push SeedTreeEdge via=github-collaborator hop=1
      addRaw neighbor (identity_confidence=0)
    fetch followers[:MAX_FOLLOWER_PROFILES=20]
    keep those with context_score >= MIN_CONTEXT_SCORE_TO_EXPAND
    for each rich follower:
      push SeedTreeEdge via=github-follower hop=1
      addRaw neighbor
  if substack_url:
    expand substack + add up to 10 neighbor slugs to pool
return { pool, neighbors, seedTree }
```

| Property | Value |
| -------- | ----- |
| Max depth (auto) | Hop 1 from seed in `expandGraph`; hop 2 via UI/branch mode |
| Branching limits | 15 collaborators, 20 followers fetched, rich filter |
| Dedup | Map keys; Set of logins |
| Cycles | Self-login filtered; no deep graph cycle walk |
| Sync vs async | Awaited sequential awaits in loops; website jobs parallelized during resolve |
| Cache | Per GitHub API path in `cache/github` |

**Expand conditions:** Need GitHub URL; followers need min context_score.  
**Prevent expand (UI):** Hop-1 node needs LinkedIn URL (`can_expand`); bots filtered in tree display.

---

# 9. Ranking and Scoring

## Candidate `final_score` — `computeScore` in `src/scoring/computeScore.ts` (CONFIRMED)

| Feature | Source | Calculation | Weight / contribution | Normalization | Missing data |
| ------- | ------ | ----------- | --------------------- | ------------- | ------------ |
| Builder: active | `github.active` (`repos>3` OR `recent_commits>5`) | +0.3 if true | additive | none | 0 if no github |
| Builder: repos | `github.repos.length` | +0.2 if >3 | additive | none | 0 |
| Builder: recent commits | `github.recent_commits` | +0.2 if >5 | additive | none | 0 |
| Thinker: active | `substack.active` | +0.3 | additive | none | 0 |
| Thinker: posts | `substack.posts` | +0.2 if >5 | additive | none | 0 |
| Olympiad composite | OlympiadProfile | `olympiadScore*0.3 + medalScore*0.2 + recencyScore*0.1` | additive | none | 0 |
| Weirdness | repo topics vs `WEIRD_TOPICS` | +0.3 if any match | additive | none | 0 |
| Identity | `identity_confidence` | `* 0.2` | additive | none | 0 |

**Final formula (CONFIRMED):**

```text
final_score = round(
  builder + thinker + olympiad + weirdness + identity,
  2
)
```

**Ranking order:** `mergeCandidates` sorts `b.final_score - a.final_score` (descending).  
**Tie-break:** None explicit (stable sort by insertion of Map values — JS Map insertion order).  
**Hard filters:** None in scorer; pool trimmed to `MAX_CANDIDATES` (80) after sort.  
**Confidence:** Only via identity component; LinkedIn match confidence 0.5 / 0.85 / +0.1.  
**Penalties:** None.  
**Cross-run comparability:** Same formula if inputs comparable; olympiad/github freshness and caps can change scores.  
**Explanations:** Numeric `score_breakdown` only — **no prose explanation generator**.  
**Model-based signals:** **None** — fully deterministic heuristics.

### Separate score: GitHub `context_score` (CONFIRMED)

Used for follower richness and tree visibility (`MIN_TREE_CONTEXT_SCORE` default 4). Points: blog+3, twitter+2, email+2, bio+1, company+1, location+1, each new social provider+2, repos≥5 +1. **Not part of `final_score`.**

### Olympiad sub-scores (CONFIRMED in `parseOlympiad.ts`)

Built from CSV: max source points, medal points, recency (`year-2020`), age score, repeat bonus. Fed into olympiad term above. `ageScore` / `countryBonus` stored on profile; `countryBonus` currently always returns 0 (dead effect).

### Worked example (CONFIRMED arithmetic)

Hypothetical:

- GitHub active, 10 repos, 20 recent commits → builder = 0.3+0.2+0.2 = **0.7**
- No Substack → thinker = **0**
- Olympiad: olympiadScore=3, medalScore=3, recencyScore=5 → 3*0.3+3*0.2+5*0.1 = 0.9+0.6+0.5 = **2.0**
- Weird topic present → weirdness = **0.3**
- identity_confidence 0.95 → identity = **0.19**

`final_score` = 0.7+0+2.0+0.3+0.19 = **3.19**

Local observed top candidate used olympiad-heavy breakdown (~2.09) with builder 0.5, identity 0.19.

---

# 10. Current Output and Frontend Visualization

## Data path to UI (CONFIRMED)

`profiles/` on disk → `buildTree(seedSlug)` → `GET /api/tree/:seedSlug` → `sanitizeTree` (client) → `RadialTree` (`react-force-graph-2d`).

Node click → `fetchProfile` → `ProfilePanel`.

## Graph library

`react-force-graph-2d` in `web/src/RadialTree.tsx`.

## Displayed metadata (CONFIRMED)

- Nodes: name, relation, hop, `context_score`, photo, linkedin_url, `can_expand`
- Panel: headline, school, links (GH/LI/site/blog/twitter), olympiad prizes, github bio/repos snippet, expand button
- **Not displayed:** `Candidate.final_score`, `score_breakdown`, global rank, prose “why highlighted”

## Behaviors

- Run pipeline / expand branch with SSE logs drawer
- Loading/error banners; panel loading state
- Tree auto-loads first available seed (prefers `madanva`)

## Digest readiness of frontend

Frontend has **discovery-path and profile context** for a **seed-centric tree**, not a **global ranked highlight list**. Enough link/context for a person card; **insufficient** for “top 5–10 by final_score with ranking criteria summary” without also reading `candidates.json` (not exposed via API today).

---

# 11. Existing Export or Notification Functionality

| Capability | Status |
| ---------- | ------ |
| Email / SMTP / Resend / SendGrid / Postmark / SES | **MISSING** |
| Notification system | **MISSING** |
| HTML/Markdown email templates | **MISSING** |
| CSV export | `candidates.csv` exists at repo root — **INFERRED** legacy/manual; not wired in TS pipeline |
| JSON export | **CONFIRMED** — `output/candidates.json`, people, profiles |
| PDF | **MISSING** |
| Cron / scheduled jobs / queues / webhooks | **MISSING** (CI Playwright workflow only) |
| Feedback (relevant / not relevant) | **MISSING** |

**Reusable for digest:** JSON candidate dump + score_breakdown + discovered_via + profile links. Everything else (email transport, templates, feedback store) must be new.

---

# 12. Environment Variables and Configuration

| Variable | Used in | Purpose | Required | Sensitive | Example |
| -------- | ------- | ------- | -------- | --------- | ------- |
| `GITHUB_TOKEN` | `config.ts` | GitHub API auth | No (gh CLI fallback) | Yes | `ghp_…` |
| `GITHUB_DELAY_MS` | config / ghFetch | Delay between GH calls | No | No | `800` |
| `SUBSTACK_DELAY_MS` | config | Substack pacing | No | No | `600` |
| `LINKEDIN_DELAY_MS` | config / LI | LI pacing | No | No | `1200` |
| `SEEDS_PATH` | config | Seeds JSON | No | No | `src/seeds/seeds.json` |
| `OLYMPIAD_CSV` | config | Olympiad CSV | No | No | `olympiad_winners.csv` |
| `OUTPUT_PATH` | config | Ranked candidates path | No | No | `output/candidates.json` |
| `COOKIES_PATH` | config | LI storageState | No | Yes | `cookies.json` |
| `CACHE_DIR` | config | Cache root | No | Medium | `cache` |
| `PEOPLE_DIR` | config | Person records | No | Medium | `data/people` |
| `PROFILES_DIR` | config | Tree profiles | No | Medium | `profiles` |
| `MAX_FOLLOWER_PROFILES` | config | Follower fetch cap | No | No | `20` |
| `MIN_CONTEXT_SCORE_TO_EXPAND` | config | Rich follower gate | No | No | `2` |
| `MIN_TREE_CONTEXT_SCORE` | config / tree | UI tree filter | No | No | `4` |
| `GITHUB_CACHE_TTL_MS` | config | GH cache TTL | No | No | ms |
| `LINKEDIN_CACHE_TTL_MS` | config | LI profile TTL | No | No | ms |
| `LINKEDIN_SEARCH_CACHE_TTL_MS` | config | LI search TTL | No | No | ms |
| `SUBSTACK_CACHE_TTL_MS` | config | Substack TTL | No | No | ms |
| `FORCE_REFRESH` | config | Bypass caches if `1` | No | No | `1` |
| `MAX_LINKEDIN_RESULTS` | config | Search hits | No | No | `5` |
| `MAX_STARGAZERS_PER_REPO` | config | Star/fork page size | No | No | `15` |
| `MAX_REPOS_EXPAND` | config | Repos for contrib expand | No | No | `5` |
| `MAX_CANDIDATES` | config | Ranked list trim | No | No | `80` |
| `MAX_IDENTITY_RESOLVES` | config | Seed resolve cap | No | No | `40` |
| `MAX_COLLABORATOR_PROFILES` | expandGraph / branch | Collaborator hydrate cap | No | No | `15` |
| `WEBSITE_CACHE_TTL_MS` | scrapeWebsite | Site cache | No | No | ms |
| `WEBSITE_FETCH_TIMEOUT_MS` | scrapeWebsite | Fetch timeout | No | No | `12000` |
| `API_PORT` | `server/index.ts` | API port | No | No | `8787` |
| `BRANCH_EXPAND` | runBranchExpand | Enable branch mode | No | No | `1` |
| `BRANCH_ROOT` / `BRANCH_PARENT` / `BRANCH_RELATION` / `BRANCH_LINKEDIN` / `BRANCH_GITHUB` / `BRANCH_NAME` | runBranchExpand | Branch expand params | When branch | Medium | strings |

**Feature flags:** `FORCE_REFRESH`, `BRANCH_EXPAND` only.  
**Dev vs prod:** No distinct production config; headed Chromium always; runs in-memory.

Hardcoded ranking weights live in `computeScore.ts` / `WEIRD_TOPICS` in `config.ts` — not env-driven.

---

# 13. Testing Infrastructure

| Item | Status |
| ---- | ------ |
| Framework | Playwright Test (`@playwright/test` via playwright package) |
| Unit tests (score, merge, identity) | **MISSING** |
| Integration tests | **MISSING** |
| E2E LinkedIn/GitHub | **MISSING** |
| Existing tests | `tests/example.spec.ts` — Playwright.dev smoke only |
| Fixtures / mocks | **MISSING** for product logic |
| CI | `.github/workflows/playwright.yml` runs example tests |
| Coverage | **MISSING** |

Commands: `npx playwright test` (CI). No `npm test` script in root `package.json`.

**Untested paths critical to digest:** `computeScore`, `mergeCandidates`, discovery path strings, candidates.json schema, any future digest renderer/email sender, feedback APIs.

---

# 14. Error Handling and Observability

| Area | Behavior |
| ---- | -------- |
| Logging | `console.log` with step tags (`[resolve]`, `[expand]`, `[api]`); UI SSE mirrors child stdout |
| Structured logger / metrics / tracing | **MISSING** |
| LI session expired | Throw; pipeline fails if scrape needed |
| LI soft failures | Contact miss → continue with empties |
| GH failures | `ghFetch` → null; neighbor skipped |
| Website failures | Log; continue |
| Per-seed try/catch in resolve loop | **MISSING** — throw aborts remaining seeds after `finally` closes browser |
| Run status | `running\|done\|failed` in memory; SSE `done`/`error` |
| User-visible errors | UI banner + log drawer |
| Associate failure to candidate | Partial: failed seeds → `upsertPerson` with identity status; GH neighbor misses silent |

---

# 15. Security, Privacy, and Compliance Constraints

| Topic | Finding |
| ----- | ------- |
| Cookies / storageState | `cookies.json` gitignored; full storageState |
| Credentials committed | `.env` gitignored; **profiles/backup with PII are tracked** |
| Scraped PII persisted | Yes — profiles, candidates, people, caches |
| Frontend exposure | Profile panel can show email from `links.email` / website |
| Client-side API keys | GitHub token server-side only (CONFIRMED) |
| Data deletion | **MISSING** |
| Audit trail | Weak — score_history + logs only |
| Email digest links | N/A yet; slug/name keys are guessable; emails in JSON are sensitive |
| ToS / rate limits | LinkedIn automation + GitHub rate limits are operational risks; no bypass tooling in repo |

Do not build digest features that re-scrape LinkedIn at email-open time; prefer offline generation from stored JSON.

---

# 16. Email Digest Readiness

| Digest field | Available now? | Current source | Missing work |
| ------------ | -------------- | -------------- | ------------ |
| Candidate name | Yes | `Candidate.name` / ProfileRecord | — |
| Rank | Partial | Implicit sort order in `candidates.json` | Persist explicit `rank` + run id |
| Score | Yes | `final_score` | Expose via API or digest builder |
| Background summary | Partial | LI headline, GH bio, education, olympiad prizes | **Prose summary generator** (template or LLM) |
| Ranking explanation | Partial | `score_breakdown` numbers | Human-readable criteria + per-signal bullets |
| LinkedIn URL | Yes | `linkedin.url` / links | — |
| GitHub URL | Yes | `github.profile_url` / links | — |
| Personal website | Yes | `linkedin.personal_website` / website.url | — |
| Blog URL | Partial | `github.blog` / Substack URL | Treat Substack as blog; unify field |
| Discovery path | Yes | `discovered_via[]` + seed_tree edges | Format for email; hop-2 path clarity |
| Shared connections | Partial | Edge `from_github` / parents | Explicit “shared with seed X” copy |
| Relevant repositories | Partial | `github.repos` (top by stars/pushed) | Select/filter for digest |
| Feedback actions | No | — | Endpoints + storage + mailto/links |
| Ranking criteria summary | Partial | Formula in code only | Static text in digest from documented weights |

### Direct answers

1. **Digest without re-scrape?** Yes, from `output/candidates.json` (+ optionally profiles/seed_tree).  
2. **Explanation stored?** Numeric breakdown yes; prose no — reconstruct from breakdown + thresholds.  
3. **Stable search-run ID?** Only ephemeral API `runId` in memory — **not durable**.  
4. **Stable candidate ID?** `Candidate.key` (name or login) and/or GitHub username / LinkedIn URL — **not UUIDs**.  
5. **Link to discovery path?** Yes via `discovered_via` and `seed_tree.json` / profile parents.  
6. **Biggest gaps for reviewer digest:** prose “why”, explicit rank, durable run snapshot, feedback, email delivery, ranking-criteria blurb, API to fetch top-N without reading files by hand.

---

# 17. Recommended Implementation Boundaries

## Phase 1: Static digest generation

Generate Markdown/HTML from existing `candidates.json` (top 5–10).

| Area | Likely work |
| ---- | ----------- |
| Files | New `src/digest/` (builder), maybe `scripts/generateDigest.ts`; read-only use of `types.ts` / `computeScore` docs |
| Data model | Optional `DigestDocument` type; optional write `output/digests/{timestamp}.json` |
| API | Optional `GET /api/digest/latest` or CLI-only first |
| Frontend | Optional preview page — not required for MVP |
| Tests | Unit tests: top-N selection, breakdown→explanation mapping |
| Deps | None required |
| Risks | Overwriting candidates.json mid-read; confusing `final_score` vs `context_score` |

## Phase 2: Email delivery

Send Phase-1 HTML to one configured reviewer.

| Area | Likely work |
| ---- | ----------- |
| Files | `src/digest/send.ts`, env for provider |
| Config | `DIGEST_TO`, provider API key |
| Deps | Resend/Postmark/SES SDK or SMTP |
| Risks | PII in email; no unsubscribe/audit yet |

## Phase 3: Feedback capture

Relevant / Not relevant / Explore network.

| Area | Likely work |
| ---- | ----------- |
| Files | `data/feedback/` or people upsert; `POST /api/feedback`; signed links or UI |
| Explore | Reuse `POST /api/runs/branch` or seed run |
| Risks | Auth of feedback links; mapping feedback to `Candidate.key` |

## Phase 4: Ranking refinement

Use feedback to adjust weights or filters.

| Area | Likely work |
| ---- | ----------- |
| Files | `computeScore.ts`, config weights, feedback aggregation |
| Risks | Overfitting; need baseline + eval set; currently no A/B harness |

Keep phases additive; do not rewrite Playwright or GitHub expand for MVP.

---

# 18. Open Questions and Ambiguities

1. **Digest unit of work:** Is a digest per seed tree, per full `candidates.json` batch, or per UI run? Matters for ranking pool and discovery-path wording.  
2. **Who is “highlighted”?** Global top by `final_score`, or top neighbors under one seed by `context_score`? UI emphasizes the latter; product text implies the former.  
3. **Reviewer identity / Cory delivery channel:** Preferred email provider and whether local CLI send is enough for MVP.  
4. **Background summary authorship:** Template from structured fields vs LLM? Affects cost, hallucination policy, and deps.  
5. **Feedback binding:** Bind to `key`, LinkedIn URL, or GitHub login when names collide?  
6. **Historic digests:** Should each pipeline run snapshot candidates immutably? Today overwrite makes “digest of run X” ambiguous.  
7. **Substack-only candidates:** Appear in pool with weak scores — include in digest or filter to LI/GH-backed people?  
8. **PII policy for email:** Include emails scraped from websites or omit from digest body?

---

# 19. Final Implementation Context Package

## Current architecture

TypeScript/Node pipeline + Express API + React force-graph UI. LinkedIn via headed Playwright + storageState. GitHub/Substack/websites via HTTP. Persistence is filesystem JSON (candidates, seed_tree, profiles, people, caches). No database, no email, no feedback.

## Current pipeline

Seeds → LI search/match/scrape → website enrich → GitHub URL expand (contributors + rich followers) → optional Substack → merge → `computeScore` → `candidates.json` + seed tree profiles → UI tree.

## Relevant routes

`GET /api/seeds`, `POST /api/runs`, `GET /api/runs/:id/events`, `GET /api/tree/:seedSlug`, `GET /api/profile/...`, `POST /api/runs/branch`. **No digest/feedback routes.**

## Canonical schemas (digest)

Use **`Candidate`** from `src/types.ts` / `output/candidates.json` for rank/score/breakdown/links/discovered_via. Use **`SeedTreeEdge` / `ProfileRecord`** when explaining network path under a seed. Do not treat `context_score` as the highlight score unless product chooses seed-tree mode.

## Ranking formula

```text
builder = (active?0.3:0) + (repos>3?0.2:0) + (recent_commits>5?0.2:0)
thinker = (substack.active?0.3:0) + (posts>5?0.2:0)
olympiad = olympiadScore*0.3 + medalScore*0.2 + recencyScore*0.1
weirdness = weird_topics?0.3:0
identity = identity_confidence*0.2
final_score = round(sum, 2)
sort descending; slice MAX_CANDIDATES
```

## Storage model

Overwrite `output/candidates.json`; append `score_history` on people; profiles tree on disk; runs ephemeral in memory.

## Files likely to change

| Path | Current role |
| ---- | ------------ |
| `src/scoring/computeScore.ts` | Score formula |
| `src/types.ts` | Candidate schema |
| `src/pipeline/runPipeline.ts` | Writes candidates; hook digest snapshot |
| `src/pipeline/mergeCandidates.ts` | Rank sort |
| `src/storage/personStore.ts` | score_history / future feedback |
| `server/index.ts` | New digest/feedback routes |
| `web/src/*` | Optional preview/feedback UI |
| **New** `src/digest/*` | Build/send digest |

## Missing capabilities

Durable run snapshots; digest builder; prose explanations; email transport; feedback storage; API for top-N; confusion between final_score and context_score; tests for scoring/digest.

## Constraints

No LI auth bypass; headed Playwright; PII on disk (and currently in git for profiles); GitHub rate limits; no mid-run LI re-auth; deterministic scores only today.

## Recommended MVP boundary

**Offline/CLI (or one GET endpoint) that reads `output/candidates.json`, takes top 5–10 by `final_score`, renders Markdown/HTML including name, rank, score, score_breakdown bullets mapped to plain English, key links, `discovered_via`, and a static “ranking criteria” footer — write `output/digests/<iso>.{md,html,json}` — optionally email that file to one address. Defer feedback and weight learning.**

---

*End of report. No application source code was modified; this file is documentation only.*
