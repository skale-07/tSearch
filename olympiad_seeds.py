#!/usr/bin/env python3
"""
Score olympiad medalists from CSV and output top high-signal seed candidates.

Expects columns: source, competition_year, name, age, school, country, award, rank
(compatible with olympiad_winners.csv — medal may be in award or rank).

USAGE:
  python olympiad_seeds.py
  python olympiad_seeds.py --csv olympiad_winners.csv --out output/olympiad_seeds.json --top 15
"""

import argparse
import csv
import json
import os
import re
import sys

OLY_SOURCES = {"IMO", "IOI", "IPHO", "ICHO"}

OLY_SCORE = {
    "IMO": 3,
    "IOI": 3,
    "IPHO": 2,
    "ICHO": 1,
}

MEDAL_SCORE = {"gold": 3, "silver": 2, "bronze": 1}

HIGH_SIGNAL_COUNTRIES = {
    "usa", "united states", "united states of america", "u.s.", "us",
    "china", "people's republic of china", "prc", "chn",
    "india",
    "singapore", "sgp",
    "south korea", "korea", "republic of korea", "kor",
    "romania", "rou",
    "russia", "russian federation", "rus",
    "vietnam", "viet nam", "vnm",
    "canada", "can",
    "uk", "united kingdom", "great britain", "gbr",
    "germany", "deu", "ger",
}

MIN_YEAR = 2023
MAX_OUTPUT = 15


def normalize_name(name: str) -> str:
    return re.sub(r"\s+", " ", (name or "").strip()).lower()


def normalize_country(country: str) -> str:
    return re.sub(r"\s+", " ", (country or "").strip()).lower()


def parse_age(raw: str) -> int | None:
    raw = (raw or "").strip()
    if not raw:
        return None
    try:
        age = int(float(raw))
        return age if 0 < age < 30 else None
    except ValueError:
        return None


def parse_medal(award: str, rank: str) -> tuple[str, int]:
    text = f"{award or ''} {rank or ''}".strip().lower()
    for medal, score in MEDAL_SCORE.items():
        if medal in text:
            return medal.capitalize(), score
    return (award or rank or "").strip() or "Unknown", 0


def olympiad_score(source: str) -> int:
    return OLY_SCORE.get((source or "").strip().upper(), 0)


def age_score(age: int | None) -> int:
    if age is None:
        return 0
    if age in (16, 17):
        return 2
    if age in (18, 19):
        return 1
    return 0


def country_score(country: str) -> int:
    c = normalize_country(country)
    if not c:
        return 0
    for key in HIGH_SIGNAL_COUNTRIES:
        if c == key or key in c or c in key:
            return 2
    return 0


def row_score(row: dict) -> dict:
    year = int(row["competition_year"])
    source = row["source"].strip().upper()
    medal_label, medal_pts = parse_medal(row.get("award", ""), row.get("rank", ""))
    age = parse_age(row.get("age", ""))
    country = row.get("country", "")

    components = {
        "year_pts": year - 2020,
        "olympiad_pts": olympiad_score(source),
        "medal_pts": medal_pts,
        "age_pts": age_score(age),
        "country_pts": country_score(country),
    }
    components["row_total"] = sum(components.values())
    components["medal_label"] = medal_label
    components["age"] = age
    return components


def load_rows(path: str) -> list[dict]:
    with open(path, newline="", encoding="utf-8") as f:
        return list(csv.DictReader(f))


def build_candidates(rows: list[dict]) -> list[dict]:
    filtered = []
    for row in rows:
        try:
            year = int(row.get("competition_year", 0))
        except ValueError:
            continue
        source = (row.get("source") or "").strip().upper()
        name = (row.get("name") or "").strip()
        if not name or year < MIN_YEAR or source not in OLY_SOURCES:
            continue
        filtered.append(row)

    by_name: dict[str, list[dict]] = {}
    for row in filtered:
        key = normalize_name(row["name"])
        by_name.setdefault(key, []).append(row)

    candidates = []
    for key, person_rows in by_name.items():
        person_rows.sort(key=lambda r: int(r["competition_year"]), reverse=True)
        display_name = person_rows[0]["name"].strip()

        row_totals = []
        for row in person_rows:
            scored = row_score(row)
            row_totals.append(scored["row_total"])

        repeat_score = 3 * (len(person_rows) - 1)
        final_score = sum(row_totals) + repeat_score

        years = sorted({int(r["competition_year"]) for r in person_rows}, reverse=True)
        sources = sorted({r["source"].strip().upper() for r in person_rows})
        ages = [a for a in (parse_age(r.get("age", "")) for r in person_rows) if a is not None]
        countries = sorted({(r.get("country") or "").strip() for r in person_rows if r.get("country", "").strip()})
        prizes = []
        for r in person_rows:
            medal_label, _ = parse_medal(r.get("award", ""), r.get("rank", ""))
            tag = f"{r['source']} {r['competition_year']} {medal_label}"
            prizes.append(tag)

        candidates.append({
            "name": display_name,
            "competition_years": years,
            "sources": sources,
            "ages": ages,
            "countries": countries,
            "prizes": prizes,
            "final_score": final_score,
            "repeat_score": repeat_score,
            "row_count": len(person_rows),
        })

    candidates.sort(key=lambda c: (-c["final_score"], -max(c["competition_years"]), c["name"]))
    return candidates


def main():
    ap = argparse.ArgumentParser(description="Score and rank high-signal olympiad medalists")
    ap.add_argument("--csv", default="olympiad_winners.csv", help="input CSV path")
    ap.add_argument("--out", default="output/olympiad_seeds.json", help="output JSON path")
    ap.add_argument("--top", type=int, default=15, help="max candidates (10-15 recommended)")
    args = ap.parse_args()

    top_n = max(1, min(args.top, MAX_OUTPUT))

    csv_path = args.csv
    if not os.path.isabs(csv_path):
        csv_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), csv_path)

    if not os.path.exists(csv_path):
        print(f"CSV not found: {csv_path}", file=sys.stderr)
        sys.exit(1)

    rows = load_rows(csv_path)
    candidates = build_candidates(rows)
    seed_set = candidates[:top_n]

    out_path = args.out
    if not os.path.isabs(out_path):
        out_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), out_path)
    os.makedirs(os.path.dirname(out_path) or ".", exist_ok=True)

    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(seed_set, f, indent=2, ensure_ascii=False)

    print(f"\n=== OLYMPIAD SEED SET (top {len(seed_set)} of {len(candidates)} candidates, year >= {MIN_YEAR}) ===\n")
    for i, c in enumerate(seed_set, 1):
        yrs = ", ".join(str(y) for y in c["competition_years"])
        srcs = ", ".join(c["sources"])
        age_s = ", ".join(str(a) for a in c["ages"]) if c["ages"] else "?"
        cty = ", ".join(c["countries"][:2]) or "?"
        print(f"{i:2}. {c['name']:<28} score={c['final_score']:<3}  [{srcs} {yrs}]  ages={age_s}  {cty}")
        if c["row_count"] > 1:
            print(f"    repeat medalist ({c['row_count']} rows, +{c['repeat_score']} repeat)")
        print(f"    {', '.join(c['prizes'][:4])}{'...' if len(c['prizes']) > 4 else ''}")

    print(f"\nWrote {len(seed_set)} candidates -> {out_path}")


if __name__ == "__main__":
    main()
