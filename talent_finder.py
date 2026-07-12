#!/usr/bin/env python3
"""
talent_finder.py  —  one-hop co-authorship talent discovery on Semantic Scholar.

WHAT IT DOES
  1. Resolves a set of SEED authors (young technical founders/researchers who publish,
     clustered in one subfield — default: LLM agents / ML systems, anchored on the
     Cognition team).
  2. Pulls each seed's papers and co-authors  (= one hop out).
  3. Counts, per candidate, how many DISTINCT seed authors they co-author with.
  4. Keeps candidates adjacent to >= MIN_SEED_OVERLAP seed authors.
  5. INVERTS FOR "UNSEEN": among those, ranks by LOW individual footprint
     (few papers, low citations, recent first publication) so the top of the list
     is "sits next to multiple strong seeds but is not yet individually prominent."
  6. Drops anyone who looks ESTABLISHED (too many papers / old first-pub / senior),
     because young authors co-author UP and we don't want to surface their advisors.
  7. Writes a ranked CSV + prints the top names with the edges that surfaced them.

WHY THIS SHAPE
  A co-authorship graph can ONLY see people who publish. It structurally cannot find
  the operator archetype (Whop/Cal AI types) — that's a stated limitation, not a bug.
  This tool targets the deep-tech/research slice of the portfolio (Cognition-shaped).

USAGE
  export S2_API_KEY=...            # optional; raises rate limits. Works without it.
  python3 talent_finder.py         # uses default seed names (legacy)
  python3 talent_finder.py --seed-file myseeds.txt   # one author name OR authorId per line
  python3 talent_finder.py --from-query "LLM agents" # auto-build young-author seed, then run
  python3 talent_finder.py --from-query "mechanistic interpretability" --from-category cs.LG

REQUIREMENTS
  pip install requests
"""

import argparse
import csv
import os
import sys
import time
from collections import defaultdict

BASE = "https://api.semanticscholar.org/graph/v1"
API_KEY = os.environ.get("S2_API_KEY", "").strip()

# ---- tunable knobs -------------------------------------------------------
MIN_SEED_OVERLAP   = 2      # candidate must co-author with >= this many DISTINCT seeds
MAX_CANDIDATE_PAPERS = 25   # drop candidates with more papers than this (too established)
MAX_SEED_PAPERS_FOR_HOP = 60  # for a seed with tons of papers, cap how many we pull
ESTABLISHED_CITES  = 2000   # candidate above this citation count = too prominent, drop
RECENT_FIRST_PUB_YEAR = 2019  # candidates whose first pub is >= this get a "young" boost
SEED_MIN_YEAR = 2023        # seed-builder: only papers from this year onward
SEED_MAX_AUTHOR_PAPERS = 15 # seed-builder: drop senior authors above this paper count
SEED_MAX_AUTHOR_CITES = 800 # seed-builder: drop senior authors above this citation count
MAX_SEED_SIZE = 40          # seed-builder: cap final seed list
PAPER_SEARCH_LIMIT = 100    # papers per search page
PAPER_SEARCH_PAGES = 3      # pages to pull per query (tune for density vs rate limits)
# --------------------------------------------------------------------------

# Default seed: Cognition team + a few well-known young LLM-agents / ML-systems names.
# These are NAMES; the script resolves them to authorIds and lets you confirm the match.
# Edit freely. Keep them in ONE subfield for dense overlap.
DEFAULT_SEED_NAMES = [
    "Scott Wu",          # Cognition (Devin) — IOI gold
    "Walden Yan",        # Cognition
    "Steven Hao",        # Cognition
    "Gavin Uberti",      # Etched (ML systems / kernels)
    # add more young ML-systems/agents authors here to densify the seed:
    # "Firstname Lastname",
]

import requests
session = requests.Session()
lines = []

def say(s=""):
    print(s)
    lines.append(s)

def write_output_log():
    if not lines:
        return
    out_txt = os.path.join(os.path.dirname(os.path.abspath(__file__)), "talent_finder_output.txt")
    with open(out_txt, "w", encoding="utf-8") as f:
        f.write("\n".join(lines) + "\n")
    print(f"Wrote output to {out_txt}")


def s2_get(path, params=None, tries=5):
    """GET with polite retry/backoff. Honors S2_API_KEY if present."""
    headers = {"x-api-key": API_KEY} if API_KEY else {}
    for i in range(tries):
        try:
            r = session.get(f"{BASE}{path}", params=params or {}, headers=headers, timeout=40)
        except requests.RequestException as e:
            time.sleep(1.5 * (i + 1))
            continue
        if r.status_code == 200:
            return r.json()
        if r.status_code in (429, 503):
            wait = 2 + i * 3
            time.sleep(wait)
            continue
        # 4xx other than 429 — return the error so caller can log it
        return {"_error": r.status_code, "_body": r.text[:300]}
    return {"_error": "retries_exhausted"}


def polite_sleep():
    # Without a key S2 shares a global bucket; with a key you start at 1 rps.
    time.sleep(1.1 if API_KEY else 0.4)


def resolve_seed(entry):
    """entry is either an authorId (all digits) or a name to search."""
    entry = entry.strip()
    if not entry:
        return None
    if entry.isdigit():
        d = s2_get(f"/author/{entry}",
                   {"fields": "name,paperCount,citationCount,affiliations"})
        if "_error" in d:
            say(f"  ! authorId {entry} error: {d}")
            return None
        return {"authorId": d["authorId"], "name": d.get("name"),
                "paperCount": d.get("paperCount"), "citationCount": d.get("citationCount")}
    # name search — take the best-matching candidate, but PRINT options so you can verify
    d = s2_get("/author/search",
               {"query": entry, "fields": "name,paperCount,citationCount,affiliations"})
    polite_sleep()
    if "_error" in d or not d.get("data"):
        say(f"  ! could not resolve '{entry}': {d if '_error' in d else 'no results'}")
        return None
    opts = d["data"][:5]
    say(f"  '{entry}' ->")
    for a in opts:
        say(f"why       candidate id={a['authorId']} {a['name']} "
              f"papers={a.get('paperCount')} cites={a.get('citationCount')} "
              f"aff={a.get('affiliations')}")
    # heuristic pick: prefer the one with a modest-but-nonzero paper count (young researcher),
    # not the 500-paper namesake. You should eyeball the printed options and hard-code IDs
    # into a seed-file for a real run.
    ranked = sorted(opts, key=lambda a: (a.get("paperCount") or 0))
    pick = None
    for a in ranked:
        if (a.get("paperCount") or 0) > 0:
            pick = a
            break
    pick = pick or opts[0]
    say(f"    -> picked id={pick['authorId']} ({pick['name']}). "
          f"Override via --seed-file with explicit IDs if wrong.")
    return {"authorId": pick["authorId"], "name": pick.get("name"),
            "paperCount": pick.get("paperCount"), "citationCount": pick.get("citationCount")}


def seed_coauthors(seed):
    """Return set of (candidateId) -> info for all co-authors of this seed (one hop)."""
    aid = seed["authorId"]
    # pull this author's papers, each with its author list
    d = s2_get(f"/author/{aid}/papers",
               {"fields": "title,year,authors", "limit": 100})
    polite_sleep()
    if "_error" in d:
        say(f"  ! papers error for {seed['name']}: {d}")
        return {}
    papers = d.get("data", [])[:MAX_SEED_PAPERS_FOR_HOP]
    found = {}
    for p in papers:
        for au in p.get("authors", []):
            cid = au.get("authorId")
            if not cid or cid == aid:
                continue
            found.setdefault(cid, {"authorId": cid, "name": au.get("name"),
                                   "via_papers": []})
            found[cid]["via_papers"].append((p.get("title"), p.get("year"), seed["name"]))
    return found


def enrich_candidate(cid):
    """Fetch footprint metrics for a candidate so we can rank by LOW prominence."""
    d = s2_get(f"/author/{cid}",
               {"fields": "name,paperCount,citationCount,hIndex,affiliations,homepage,papers.year"})
    polite_sleep()
    if "_error" in d:
        return None
    years = [p.get("year") for p in (d.get("papers") or []) if p.get("year")]
    first_year = min(years) if years else None
    return {
        "authorId": cid,
        "name": d.get("name"),
        "paperCount": d.get("paperCount") or 0,
        "citationCount": d.get("citationCount") or 0,
        "hIndex": d.get("hIndex") or 0,
        "affiliations": d.get("affiliations") or [],
        "homepage": d.get("homepage"),
        "firstPubYear": first_year,
    }


def unseen_score(c, overlap):
    """
    Higher = more interesting = high adjacency, LOW individual footprint, young.
    We reward seed-overlap and penalize prominence.
    """
    score = 0.0
    score += overlap * 10                      # adjacency is the main signal
    score += max(0, 8 - c["paperCount"]) * 1.0 # fewer papers = more "unseen"
    score += max(0, 500 - c["citationCount"]) / 100.0
    if c["firstPubYear"] and c["firstPubYear"] >= RECENT_FIRST_PUB_YEAR:
        score += 5                              # recent entrant
    score -= c["hIndex"] * 0.5                  # high h-index = already established
    return round(score, 2)


def looks_established(c):
    if c["paperCount"] > MAX_CANDIDATE_PAPERS:
        return True
    if c["citationCount"] > ESTABLISHED_CITES:
        return True
    # crude "faculty" tell
    affs = " ".join(c.get("affiliations") or []).lower()
    if any(w in affs for w in ["professor", "faculty", "principal", "director"]):
        return True
    return False


def is_young_seed_author(author):
    papers = author.get("paperCount") or 0
    cites = author.get("citationCount") or 0
    return papers <= SEED_MAX_AUTHOR_PAPERS and cites <= SEED_MAX_AUTHOR_CITES


def build_seed_from_query(query, category=None):
    """Pull recent papers, keep young peer authors as seeds."""
    q = query.strip()
    if category:
        q = f"{q} {category.strip()}"
    say(f"Building seed from query: {q!r} (papers >= {SEED_MIN_YEAR})\n")

    authors = {}  # authorId -> {authorId, name, paperCount, citationCount, latest_year}
    papers_seen = 0
    for page in range(PAPER_SEARCH_PAGES):
        offset = page * PAPER_SEARCH_LIMIT
        d = s2_get("/paper/search", {
            "query": q,
            "fields": "title,year,authors,authors.authorId,authors.name,authors.paperCount,authors.citationCount",
            "limit": PAPER_SEARCH_LIMIT,
            "offset": offset,
        })
        polite_sleep()
        if "_error" in d:
            say(f"  ! paper search error: {d}")
            break
        batch = d.get("data") or []
        if not batch:
            break
        for p in batch:
            year = p.get("year") or 0
            if year < SEED_MIN_YEAR:
                continue
            papers_seen += 1
            for au in p.get("authors") or []:
                aid = au.get("authorId")
                if not aid:
                    continue
                if not is_young_seed_author(au):
                    continue
                prev = authors.get(aid)
                latest = max(year, (prev or {}).get("latest_year", 0))
                authors[aid] = {
                    "authorId": aid,
                    "name": au.get("name"),
                    "paperCount": au.get("paperCount") or 0,
                    "citationCount": au.get("citationCount") or 0,
                    "latest_year": latest,
                }
        say(f"  page {page + 1}: {len(batch)} papers, {papers_seen} recent, {len(authors)} young authors so far")
        if len(batch) < PAPER_SEARCH_LIMIT:
            break

    ranked = sorted(authors.values(), key=lambda a: (-a["latest_year"], a["paperCount"]))
    seeds = ranked[:MAX_SEED_SIZE]
    say(f"\nSeed list ({len(seeds)} authors, capped at {MAX_SEED_SIZE}):\n")
    for a in seeds:
        say(f"  id={a['authorId']}  {a['name']}  papers={a['paperCount']}  cites={a['citationCount']}  latest={a['latest_year']}")
    return seeds


def run_pipeline(seeds, min_overlap, out_path):
    if not seeds:
        say("No seeds. Exiting.")
        sys.exit(1)

    say(f"\nPulling one-hop co-authors from {len(seeds)} seeds (min_overlap={min_overlap})...\n")

    overlap_seeds = defaultdict(set)
    edges = defaultdict(list)
    total_coauthor_slots = 0
    for s in seeds:
        co = seed_coauthors(s)
        total_coauthor_slots += len(co)
        say(f"  {s['name']}: {len(co)} co-authors")
        for cid, info in co.items():
            overlap_seeds[cid].add(s["authorId"])
            edges[cid].extend(info["via_papers"])

    seed_ids = {s["authorId"] for s in seeds}
    candidates = {cid: sids for cid, sids in overlap_seeds.items()
                  if cid not in seed_ids and len(sids) >= min_overlap}
    say(f"\n{len(candidates)} candidates connect to >= {min_overlap} distinct seeds.")
    if not candidates:
        say("No multi-seed overlap. Seed is too sparse or overlap threshold too strict — "
            "try densifying the query, raising MAX_SEED_SIZE, or --min-overlap 1.")
        say(f"DIAGNOSTIC: seed={len(seeds)} unique_coauthors={len(overlap_seeds)} "
            f"overlap_cleared=0 survived_established=0")
        sys.exit(0)

    say("Enriching candidates with footprint metrics...\n")
    rows = []
    established_dropped = 0
    for cid, sids in candidates.items():
        c = enrich_candidate(cid)
        if not c:
            continue
        if looks_established(c):
            established_dropped += 1
            continue
        overlap = len(sids)
        c["overlap"] = overlap
        c["score"] = unseen_score(c, overlap)
        c["edges"] = edges[cid][:4]
        rows.append(c)

    rows.sort(key=lambda x: x["score"], reverse=True)

    with open(out_path, "w", newline="") as f:
        w = csv.writer(f)
        w.writerow(["rank", "name", "authorId", "score", "seed_overlap",
                    "paperCount", "citationCount", "hIndex", "firstPubYear",
                    "affiliations", "homepage", "surfaced_via"])
        for i, c in enumerate(rows, 1):
            via = " | ".join(f"{t} ({y}) w/ {sn}" for (t, y, sn) in c["edges"])
            w.writerow([i, c["name"], c["authorId"], c["score"], c["overlap"],
                        c["paperCount"], c["citationCount"], c["hIndex"],
                        c["firstPubYear"], "; ".join(c["affiliations"]),
                        c["homepage"] or "", via])

    say(f"=== TOP CANDIDATES (unseen-ranked) ===  [full CSV -> {out_path}]\n")
    for i, c in enumerate(rows[:15], 1):
        say(f"{i:2}. {c['name']}  (score={c['score']}, "
            f"adjacent to {c['overlap']} seeds, "
            f"{c['paperCount']} papers, {c['citationCount']} cites, "
            f"first pub {c['firstPubYear']})")
        for (t, y, sn) in c["edges"][:2]:
            say(f"why      surfaced via: \"{t}\" ({y}) co-authored with {sn}")
        if c["homepage"]:
            say(f"        homepage: {c['homepage']}")

    say(f"\nDIAGNOSTIC: seed={len(seeds)} unique_coauthors={len(overlap_seeds)} "
        f"overlap_cleared={len(candidates)} survived_established={len(rows)} "
        f"(dropped_established={established_dropped})")
    if not rows:
        say("Zero survivors after established filter — try raising ESTABLISHED_CITES / MAX_CANDIDATE_PAPERS "
            "or tightening seed-builder senior filters.")
    say("\nDone. Hand-inspect the top ~10: for each, ask 'would Cory already know this name?'")
    say("The winners are high-overlap + thin-individual-footprint people.")


def main():
    try:
        _run()
    finally:
        write_output_log()


def _run():
    ap = argparse.ArgumentParser()
    ap.add_argument("--seed-file", help="file with one author name OR authorId per line")
    ap.add_argument("--from-query", help="build young-author seed from S2 paper search query")
    ap.add_argument("--from-category", help="optional arxiv category tag appended to --from-query")
    ap.add_argument("--min-overlap", type=int, default=MIN_SEED_OVERLAP,
                    help=f"candidates must co-author with >= N seeds (default {MIN_SEED_OVERLAP})")
    ap.add_argument("--out", default="candidates.csv")
    args = ap.parse_args()

    if args.from_query and args.seed_file:
        ap.error("use either --from-query or --seed-file, not both")

    say(f"KEY: {'present' if API_KEY else 'NONE (using shared unauth pool)'}")

    if args.from_query:
        seeds = build_seed_from_query(args.from_query, args.from_category)
        run_pipeline(seeds, args.min_overlap, args.out)
        return

    if args.seed_file:
        with open(args.seed_file) as f:
            seed_entries = [ln.strip() for ln in f if ln.strip() and not ln.startswith("#")]
    else:
        seed_entries = DEFAULT_SEED_NAMES

    say(f"Resolving {len(seed_entries)} seed authors...\n")

    seeds = []
    for e in seed_entries:
        s = resolve_seed(e)
        if s:
            seeds.append(s)
    if not seeds:
        say("No seeds resolved. Exiting.")
        sys.exit(1)

    say(f"\nResolved {len(seeds)} seeds.")
    run_pipeline(seeds, args.min_overlap, args.out)


if __name__ == "__main__":
    main()