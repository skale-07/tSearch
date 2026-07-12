import { GITHUB_DELAY_MS, GITHUB_TOKEN } from "../config.js";

export interface GhSearchUser {
  login: string;
  id: number;
  type: string;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function headers(): Record<string, string> {
  const h: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "User-Agent": "tsearch-unseen-talent",
  };
  if (GITHUB_TOKEN) h.Authorization = `Bearer ${GITHUB_TOKEN}`;
  return h;
}

export async function ghFetch<T>(path: string): Promise<T | null> {
  await sleep(GITHUB_DELAY_MS);
  try {
    const res = await fetch(`https://api.github.com${path}`, { headers: headers() });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

function norm(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function scoreMatch(name: string, login: string, display: string | null): number {
  const target = norm(name);
  const l = norm(login);
  const d = display ? norm(display) : "";
  if (l === target || d === target) return 100;
  if (target.includes(l) || l.includes(target)) return 70;
  if (d && (target.includes(d) || d.includes(target))) return 60;
  const parts = name.toLowerCase().split(/\s+/).filter(Boolean);
  if (parts.length >= 2) {
    const combo = norm(parts[0] + parts[parts.length - 1]);
    if (l.includes(combo)) return 50;
  }
  return 10;
}

export async function searchGithubUser(
  name: string
): Promise<GhSearchUser | null> {
  const q = encodeURIComponent(name);
  const data = await ghFetch<{ items?: GhSearchUser[] }>(
    `/search/users?q=${q}&per_page=5`
  );
  if (!data?.items?.length) return null;

  let best: GhSearchUser | null = null;
  let bestScore = 0;
  for (const user of data.items) {
    const detail = await ghFetch<{ login: string; name: string | null }>(
      `/users/${user.login}`
    );
    const s = scoreMatch(name, user.login, detail?.name ?? null);
    if (s > bestScore) {
      bestScore = s;
      best = user;
    }
  }
  return bestScore >= 40 ? best : null;
}

export async function resolveGithubUsername(
  nameOrLogin: string
): Promise<string | null> {
  if (/^[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,37}[a-zA-Z0-9])?$/.test(nameOrLogin)) {
    const u = await ghFetch<{ login: string }>(`/users/${nameOrLogin}`);
    if (u?.login) return u.login;
  }
  const found = await searchGithubUser(nameOrLogin);
  return found?.login ?? null;
}
