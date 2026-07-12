#!/usr/bin/env python3
"""GitHub edge-data smoke test — single-seed probe only."""
import os, sys, requests

TOKEN = os.environ.get("GITHUB_TOKEN")
if not TOKEN:
    print("GITHUB_TOKEN not set. Run:\n  $env:GITHUB_TOKEN=\"ghp_your_token_here\"   # PowerShell\n  export GITHUB_TOKEN=ghp_your_token_here          # bash/WSL")
    sys.exit(1)

BASE = "https://api.github.com"
HDRS = {"Authorization": f"Bearer {TOKEN}", "Accept": "application/vnd.github+json"}
errors = []
first_r = None
lines = []

def say(s=""):
    print(s)
    lines.append(s)

def get(path, params=None):
    global first_r
    r = requests.get(f"{BASE}{path}", headers=HDRS, params=params or {})
    if first_r is None:
        first_r = r
    if r.status_code >= 400:
        errors.append(f"{path} -> {r.status_code}")
        return None
    return r.json()

def resolve_user(login):
    data = get(f"/users/{login}")
    if data:
        return login, data
    msg = first_r.json().get("message", "") if first_r else ""
    print(f"User '{login}' failed: {first_r.status_code} {msg}")
    if login != "VaishantK":
        print("Trying fallback: VaishantK")
        return resolve_user("VaishantK")
    sys.exit(1)

seed = sys.argv[1] if len(sys.argv) > 1 else "zachyadegari"
resolved, user = resolve_user(seed)
say(f"Resolved seed: {resolved}\n")
say(f"X-RateLimit-Remaining: {first_r.headers.get('X-RateLimit-Remaining', 'N/A')}\n")

say("=== PROFILE ===")
for k in ("login", "name", "bio", "company", "blog", "twitter_username", "public_repos", "followers", "created_at"):
    say(f"  {k}: {user.get(k)}")

followers = get(f"/users/{resolved}/followers", {"per_page": 100}) or []
following = get(f"/users/{resolved}/following", {"per_page": 100}) or []
say(f"\n=== FOLLOWERS ({len(followers)} returned) ===")
say("  " + ", ".join(u["login"] for u in followers[:15]))
say(f"\n=== FOLLOWING ({len(following)} returned) ===")
say("  " + ", ".join(u["login"] for u in following[:15]))

repos = get(f"/users/{resolved}/repos", {"per_page": 100, "sort": "pushed"}) or []
if not repos:
    errors.append("repos -> empty")
    top_repo, top_stars = None, 0
else:
    top = max(repos, key=lambda r: r.get("stargazers_count", 0))
    top_repo, top_stars = top["name"], top["stargazers_count"]
say(f"\n=== TOP REPO ===")
say(f"  {top_repo} ({top_stars} stars)" if top_repo else "  (none)")

contributors = (get(f"/repos/{resolved}/{top_repo}/contributors", {"per_page": 100}) or []) if top_repo else []
say(f"\n=== CONTRIBUTORS ({len(contributors)} returned) ===")
for c in contributors[:15]:
    say(f"  {c['login']}: {c.get('contributions', '?')}")

say("\n=== SUMMARY ===")
say(f"  followers pulled: {len(followers)}")
say(f"  following pulled: {len(following)}")
say(f"  top repo: {top_repo} ({top_stars} stars)" if top_repo else "  top repo: NONE")
say(f"  contributors pulled: {len(contributors)}")
say(f"  issues: {', '.join(errors) if errors else 'none'}")

out_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "gh_probe_output.txt")
with open(out_path, "w", encoding="utf-8") as f:
    f.write("\n".join(lines) + "\n")
print(f"\nWrote output to {out_path}")
