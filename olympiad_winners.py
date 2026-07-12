#!/usr/bin/env python3
"""
olympiad_winners.py — pull medalists and top ISEF awardees from public sources.

LIMITATIONS (read before trusting output):
  - No birthdate verification; age only when explicitly in ISEF press text.
  - Olympiads have no school/project fields by design.
  - IBO PDF parsing is brittle; some years may fail.
  - ISEF URL slugs change yearly — update ISEF_FULL_AWARDS_URLS for new years.

USAGE:
  python olympiad_winners.py
  python olympiad_winners.py --sources IOI,ISEF --from-year 2024
  python olympiad_winners.py --skip-ibo

REQUIREMENTS:
  pip install requests beautifulsoup4
  pip install pdfplumber   # optional, for IBO
"""

import argparse
import csv
import io
import os
import re
import sys
import time
from datetime import datetime

import requests
from bs4 import BeautifulSoup

SESSION = requests.Session()
SESSION.headers["User-Agent"] = "olympiad-winners-puller/1.0"
lines = []

FIELDS = [
    "source", "competition_year", "name", "age", "school", "country",
    "project", "award", "rank", "likely_under_20_today", "source_url", "parse_notes",
]

ISEF_FULL_AWARDS_URLS = {
    2026: "https://www.societyforscience.org/press-release/regeneron-isef-2026-full-awards/",
    2025: "https://www.societyforscience.org/press-release/regeneron-isef-2025-full-awards/",
    2024: "https://www.societyforscience.org/press-release/regeneron-isef-2024-full-awards/",
    2023: "https://www.societyforscience.org/press-release/regeneron-isef-full-awards-2023/",
    2022: "https://www.societyforscience.org/press-release/regeneron-isef-full-awards-2022/",
}

ISEF_GRAND_AWARDS_URLS = {
    2026: "https://www.societyforscience.org/press-release/regeneron-isef-2026-grand-awards/",
    2025: "https://www.societyforscience.org/press-release/regeneron-isef-2025-grand-awards/",
    2024: "https://www.societyforscience.org/press-release/high-schoolers-win-more-than-9-million-at-regeneron-isef-2024/",
    2023: "https://www.societyforscience.org/press-release/regeneron-isef-2023-grand-award-winners/",
    2022: "https://www.societyforscience.org/press-release/2022-regeneron-isef-top-winners/",
}

IBO_PDF_URLS = {
    2025: "https://www.ibo-info.org/files/downloads/results-reports/results/IBO2025%20Ranking.pdf",
    2024: "https://www.ibo-info.org/files/downloads/results-reports/results/IBO2024%20results%20-%20amended%20version%20January%202025.pdf",
    2023: "https://www.ibo-info.org/files/downloads/results-reports/results/IBO2023.pdf",
    2022: "https://www.ibo-info.org/files/downloads/results-reports/results/IBO2022.pdf",
}

PROJECT_RE = re.compile(r"^([A-Z]{4}\d{3}[A-Z]?) — (.+)$")
PLACE_AWARD_RE = re.compile(r"^(First|Second|Third|Fourth) Award", re.I)
CATEGORY_RE = re.compile(r"^[A-Z][A-Z0-9 &:/\-]{3,}$")
MEDAL_RE = re.compile(r"gold|silver|bronze", re.I)
IMO_MEDAL = {"G": "Gold", "S": "Silver", "B": "Bronze"}
IPHO_MEDAL = {"G": "Gold", "S": "Silver", "B": "Bronze", "H": "Honourable Mention"}


def say(s=""):
    print(s)
    lines.append(s)


def write_output_log():
    if not lines:
        return
    out_txt = os.path.join(os.path.dirname(os.path.abspath(__file__)), "olympiad_winners_output.txt")
    with open(out_txt, "w", encoding="utf-8") as f:
        f.write("\n".join(lines) + "\n")
    print(f"Wrote output to {out_txt}")


def fetch(url, tries=4):
    for i in range(tries):
        try:
            r = SESSION.get(url, timeout=60)
        except requests.RequestException:
            time.sleep(1.5 * (i + 1))
            continue
        if r.status_code == 200:
            return r
        if r.status_code in (429, 503):
            time.sleep(2 + i * 2)
            continue
        return r
    return None


def likely_under_20(competition_year):
    return competition_year >= datetime.now().year - 4


def record(source, year, name, award, source_url, rank="", age="", school="",
           country="", project="", notes=""):
    notes_parts = [notes] if notes else []
    if not age:
        notes_parts.append("age_missing")
    if not school and source == "ISEF":
        notes_parts.append("school_missing")
    if source != "ISEF" and not project:
        notes_parts.append("project_na")
    return {
        "source": source,
        "competition_year": year,
        "name": name.strip(),
        "age": age,
        "school": school,
        "country": country,
        "project": project,
        "award": award,
        "rank": str(rank) if rank != "" else "",
        "likely_under_20_today": "true" if likely_under_20(year) else "false",
        "source_url": source_url,
        "parse_notes": ";".join(p for p in notes_parts if p),
    }


def normalize_medal(text):
    t = (text or "").strip()
    if not t:
        return None
    if len(t) == 1 and t.upper() in IMO_MEDAL:
        return IMO_MEDAL[t.upper()]
    low = t.lower()
    if "gold" in low:
        return "Gold"
    if "silver" in low:
        return "Silver"
    if "bronze" in low:
        return "Bronze"
    if "honour" in low or "honor" in low:
        return "Honourable Mention"
    return None


def is_medalist(medal, include_hm=False):
    if not medal:
        return False
    if medal in ("Gold", "Silver", "Bronze"):
        return True
    return include_hm and medal == "Honourable Mention"


def parse_isef_ages(year):
    url = ISEF_GRAND_AWARDS_URLS.get(year)
    if not url:
        return {}
    r = fetch(url)
    if not r or r.status_code != 200:
        return {}
    ages = {}
    for m in re.finditer(r"([A-Z][a-z]+(?:\s+[A-Z][a-z'\.-]+)+),\s*(\d{1,2}),\s+of\s", r.text):
        ages[m.group(1).strip().lower()] = m.group(2)
    if not ages:
        for m in re.finditer(r"([A-Z][a-z]+(?:\s+[A-Z][a-z'\.-]+)+),\s*(\d{1,2}),", r.text):
            ages[m.group(1).strip().lower()] = m.group(2)
    return ages


def split_isef_students(text):
    text = text.strip()
    if not text:
        return []
    marker = "of America "
    chunks = []
    remaining = text
    while True:
        if marker not in remaining:
            if remaining:
                chunks.append(remaining)
            break
        before, after = remaining.split(marker, 1)
        if after and re.match(r"[A-Z][a-z]", after) and "," in after:
            chunks.append((before + marker.rstrip()).strip())
            remaining = after.strip()
        else:
            chunks.append(remaining)
            break
    return chunks


def parse_student_line(line, year, award, project, category, source_url, ages, include_all_isef):
    if PLACE_AWARD_RE.match(award or ""):
        place = award.split()[0].lower()
        if place == "fourth" and not include_all_isef:
            return []
    parts = [p.strip() for p in line.split(",")]
    if len(parts) < 2:
        return []
    name = parts[0]
    if len(name.split()) < 2:
        return []
    school = ", ".join(parts[1:-1]) if len(parts) > 3 else parts[1]
    country = parts[-1] if len(parts) >= 3 else ""
    age = ages.get(name.lower(), "")
    proj_title = project.split(" — ", 1)[1] if " — " in project else project
    full_award = award
    if category and PLACE_AWARD_RE.match(award or ""):
        full_award = f"{category} — {award}"
    return [record("ISEF", year, name, full_award, source_url, age=age, school=school,
                   country=country, project=proj_title)]


def fetch_isef(years, include_all_isef):
    rows = []
    for year in years:
        url = ISEF_FULL_AWARDS_URLS.get(year)
        if not url:
            say(f"  ISEF {year}: no URL map entry, skipped")
            continue
        r = fetch(url)
        if not r or r.status_code != 200:
            say(f"  ISEF {year}: fetch failed ({r.status_code if r else 'no response'})")
            continue
        ages = parse_isef_ages(year)
        soup = BeautifulSoup(r.text, "html.parser")
        main = soup.find("article") or soup
        state = {"category": None, "award": None, "project": None, "special": None}
        year_rows = 0
        for el in main.find_all(["h3", "p", "ul"]):
            t = el.get_text(" ", strip=True)
            if not t:
                continue
            if el.name == "h3" and "Award" in t and len(t) < 120:
                state = {"category": None, "award": "Top Award", "project": None, "special": t}
                continue
            if el.name == "p" and CATEGORY_RE.match(t) and "AWARD" not in t and "—" not in t:
                state["category"] = t
                state["special"] = None
                state["project"] = None
                continue
            if el.name == "p" and PLACE_AWARD_RE.match(t):
                state["award"] = t.split(" of ")[0].strip()
                state["project"] = None
                if not include_all_isef and state["award"].lower().startswith("fourth"):
                    state["award"] = None
                continue
            if el.name == "p":
                m = PROJECT_RE.match(t)
                if m:
                    state["project"] = t
                    continue
            if el.name == "ul" and state.get("project") and state.get("award"):
                award = state["special"] if state.get("special") and state["award"] == "Top Award" else state["award"]
                if not award:
                    continue
                if not include_all_isef and PLACE_AWARD_RE.match(award) and award.lower().startswith("fourth"):
                    continue
                for chunk in split_isef_students(el.get_text(" ", strip=True)):
                    recs = parse_student_line(chunk, year, award, state["project"],
                                              state.get("category"), url, ages, include_all_isef)
                    rows.extend(recs)
                    year_rows += len(recs)
                state["project"] = None
        say(f"  ISEF {year}: {year_rows} records")
    return rows


def fetch_ioi(years, include_hm):
    rows = []
    for year in years:
        url = f"https://stats.ioinformatics.org/results/{year}"
        r = fetch(url)
        if not r or r.status_code != 200:
            say(f"  IOI {year}: fetch failed")
            continue
        soup = BeautifulSoup(r.text, "html.parser")
        n = 0
        for tr in soup.find_all("tr"):
            tds = tr.find_all("td")
            if len(tds) < 4:
                continue
            rank = tds[0].get_text(strip=True).rstrip("*")
            name = tds[1].get_text(strip=True)
            country = tds[2].get_text(strip=True)
            award = normalize_medal(tds[-1].get_text(strip=True))
            if not name or "http" in country.lower():
                continue
            if not is_medalist(award, include_hm):
                continue
            rows.append(record("IOI", year, name, award, url, rank=rank, country=country))
            n += 1
        say(f"  IOI {year}: {n} medalists")
    return rows


def clean_imo_country(raw):
    raw = (raw or "").strip()
    if not raw:
        return ""
    m = re.search(r"([A-Z]{3})$", raw)
    if m:
        return raw[: -3].strip()
    return raw


def fetch_imo(years, include_hm):
    rows = []
    for year in years:
        url = f"https://www.imo-official.org/results/individual/year/{year}/"
        r = fetch(url)
        if not r or r.status_code != 200:
            say(f"  IMO {year}: fetch failed")
            continue
        soup = BeautifulSoup(r.text, "html.parser")
        n = 0
        for tr in soup.find_all("tr"):
            tds = tr.find_all("td")
            if len(tds) < 5:
                continue
            name = tds[0].get_text(strip=True)
            if name.lower() == "contestant":
                continue
            country = clean_imo_country(tds[1].get_text(strip=True))
            rank = tds[2].get_text(strip=True)
            award = normalize_medal(tds[3].get_text(strip=True))
            if not is_medalist(award, include_hm):
                continue
            rows.append(record("IMO", year, name, award, url, rank=rank, country=country))
            n += 1
        say(f"  IMO {year}: {n} medalists")
    return rows


def fetch_ipho(years, include_hm):
    url = "https://ipho-unofficial.org/search/estudiantes.csv"
    r = fetch(url)
    if not r or r.status_code != 200:
        say("  IPhO: CSV fetch failed")
        return []
    r.encoding = "utf-8"
    rows = []
    reader = csv.reader(io.StringIO(r.text))
    for parts in reader:
        if len(parts) < 5:
            continue
        try:
            year = int(parts[0])
        except ValueError:
            continue
        if year not in years:
            continue
        rank, name, country, code = parts[1], parts[2], parts[3], parts[4]
        award = normalize_medal(IPHO_MEDAL.get(code.upper(), code))
        if not is_medalist(award, include_hm):
            continue
        rows.append(record("IPhO", year, name, award, url, rank=rank, country=country))
    say(f"  IPhO: {len(rows)} medalists across {years}")
    return rows


def fetch_icho(years, include_hm):
    idx = fetch("https://www.icho-official.org/results/index.php")
    if not idx or idx.status_code != 200:
        say("  IChO: index fetch failed")
        return []
    soup = BeautifulSoup(idx.text, "html.parser")
    year_map = {}
    for a in soup.find_all("a", href=True):
        m = re.search(r"results\.php\?id=(\d+)&year=(\d{4})", a["href"])
        if m:
            year_map[int(m.group(2))] = m.group(1)
    rows = []
    for year in years:
        rid = year_map.get(year)
        if not rid:
            say(f"  IChO {year}: no results id")
            continue
        url = f"https://www.icho-official.org/results/results.php?id={rid}&year={year}"
        r = fetch(url)
        if not r or r.status_code != 200:
            say(f"  IChO {year}: fetch failed")
            continue
        psoup = BeautifulSoup(r.text, "html.parser")
        n = 0
        for tr in psoup.find_all("tr"):
            tds = tr.find_all("td")
            if len(tds) < 5:
                continue
            name = tds[0].get_text(strip=True)
            if name.lower() in ("contestant", "individual results"):
                continue
            country = tds[2].get_text(strip=True)
            rank = tds[3].get_text(strip=True)
            award = normalize_medal(tds[4].get_text(strip=True))
            if not is_medalist(award, include_hm):
                continue
            rows.append(record("IChO", year, name, award, url, rank=rank, country=country))
            n += 1
        say(f"  IChO {year}: {n} medalists")
    return rows


def parse_ibo_line(line, year, url):
    m = re.search(r"\s(Gold|Silver|Bronze)\s*$", line, re.I)
    if not m:
        return None
    medal = m.group(1).capitalize()
    left = line[: m.start()].strip()
    parts = left.split()
    if not parts or not parts[0].isdigit():
        return None
    rank = parts[0]
    rest = parts[1:]
    if not rest:
        return None
    country = ""
    if rest[0].isupper() and rest[0].isalpha() and len(rest[0]) >= 3:
        country = rest[0]
        rest = rest[1:]
    name_parts = []
    for tok in rest:
        if re.match(r"^[\d,\.]+$", tok):
            break
        name_parts.append(tok)
    name = " ".join(name_parts).strip()
    if not name:
        return None
    return record("IBO", year, name, medal, url, rank=rank, country=country, notes="ibo_pdf")


def fetch_ibo(years, include_hm):
    try:
        import pdfplumber
    except ImportError:
        say("  IBO: pdfplumber not installed, skipped")
        return []
    rows = []
    for year in years:
        url = IBO_PDF_URLS.get(year)
        if not url:
            say(f"  IBO {year}: no PDF URL map entry, skipped")
            continue
        r = fetch(url)
        if not r or r.status_code != 200:
            say(f"  IBO {year}: PDF fetch failed")
            continue
        n = 0
        try:
            with pdfplumber.open(io.BytesIO(r.content)) as pdf:
                text = "\n".join((p.extract_text() or "") for p in pdf.pages)
        except Exception as e:
            say(f"  IBO {year}: PDF parse error ({e})")
            continue
        for line in text.splitlines():
            line = line.strip()
            if not line or line.startswith("#"):
                continue
            rec = parse_ibo_line(line, year, url)
            if not rec:
                continue
            if not is_medalist(rec["award"], include_hm):
                continue
            rows.append(rec)
            n += 1
        say(f"  IBO {year}: {n} medalists")
    return rows


def print_summary(all_rows, failed_years):
    by_source = {}
    for r in all_rows:
        by_source.setdefault(r["source"], 0)
        by_source[r["source"]] += 1
    say("\n=== SUMMARY ===")
    for src in sorted(by_source):
        say(f"  {src}: {by_source[src]} records")
    total = len(all_rows)
    if total:
        say(f"  age populated: {sum(1 for r in all_rows if r['age'])}/{total} "
            f"({100*sum(1 for r in all_rows if r['age'])//total}%)")
        say(f"  school populated: {sum(1 for r in all_rows if r['school'])}/{total} "
            f"({100*sum(1 for r in all_rows if r['school'])//total}%)")
        say(f"  project populated: {sum(1 for r in all_rows if r['project'])}/{total} "
            f"({100*sum(1 for r in all_rows if r['project'])//total}%)")
        say(f"  likely_under_20_today=true: {sum(1 for r in all_rows if r['likely_under_20_today']=='true')}")
    if failed_years:
        say(f"  failed/empty: {', '.join(failed_years)}")
    say(f"\nTotal records: {total}")


def main():
    try:
        _run()
    finally:
        write_output_log()


def _run():
    ap = argparse.ArgumentParser(description="Pull olympiad medalists and ISEF top awardees")
    ap.add_argument("--sources", default="ISEF,IOI,IMO,IPhO,IChO,IBO",
                    help="comma-separated: ISEF,IOI,IMO,IPhO,IChO,IBO")
    ap.add_argument("--from-year", type=int, default=2022)
    ap.add_argument("--to-year", type=int, default=datetime.now().year)
    ap.add_argument("--include-hm", action="store_true", help="include honourable mentions")
    ap.add_argument("--include-all-isef", action="store_true", help="include ISEF 4th place")
    ap.add_argument("--skip-ibo", action="store_true")
    ap.add_argument("--out", default="olympiad_winners.csv")
    args = ap.parse_args()

    sources = {s.strip().upper() for s in args.sources.split(",") if s.strip()}
    years = list(range(args.from_year, args.to_year + 1))
    say(f"Pulling sources={sorted(sources)} years={years[0]}–{years[-1]}")

    all_rows = []
    failed = []

    if "ISEF" in sources:
        say("\n--- ISEF ---")
        all_rows.extend(fetch_isef(years, args.include_all_isef))
    if "IOI" in sources:
        say("\n--- IOI ---")
        all_rows.extend(fetch_ioi(years, args.include_hm))
    if "IMO" in sources:
        say("\n--- IMO ---")
        all_rows.extend(fetch_imo(years, args.include_hm))
    if "IPHO" in sources:
        say("\n--- IPhO ---")
        all_rows.extend(fetch_ipho(years, args.include_hm))
    if "ICHO" in sources:
        say("\n--- IChO ---")
        all_rows.extend(fetch_icho(years, args.include_hm))
    if "IBO" in sources and not args.skip_ibo:
        say("\n--- IBO ---")
        all_rows.extend(fetch_ibo(years, args.include_hm))
    elif "IBO" in sources:
        say("\n--- IBO --- skipped (--skip-ibo)")

    for src in sources:
        for y in years:
            if src == "ISEF" and not any(r["source"] == "ISEF" and r["competition_year"] == y for r in all_rows):
                if y in ISEF_FULL_AWARDS_URLS:
                    failed.append(f"ISEF-{y}")
            elif src in ("IOI", "IMO", "ICHO") and not any(
                r["source"].upper() == src and r["competition_year"] == y for r in all_rows
            ):
                failed.append(f"{src}-{y}")

    out_path = args.out
    if not os.path.isabs(out_path):
        out_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), out_path)
    with open(out_path, "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=FIELDS)
        w.writeheader()
        w.writerows(all_rows)

    say(f"\nWrote {len(all_rows)} rows -> {out_path}")
    print_summary(all_rows, failed)

    if all_rows:
        say("\n=== SAMPLE (first 5) ===")
        for r in all_rows[:5]:
            say(f"  [{r['source']} {r['competition_year']}] {r['name']} | {r['award']} | "
                f"school={r['school'] or '-'} | project={(r['project'] or '-')[:50]}")


if __name__ == "__main__":
    main()
