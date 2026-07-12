import { SUBSTACK_DELAY_MS } from "../config.js";

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36";

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function slugGuesses(name: string): string[] {
  const parts = name
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (!parts.length) return [];
  const g = new Set<string>();
  g.add(parts.join(""));
  g.add(parts.join("-"));
  if (parts.length >= 2) {
    g.add(`${parts[0]}-${parts[parts.length - 1]}`);
    g.add(`${parts[0]}${parts[parts.length - 1]}`);
  }
  return [...g];
}

async function fetchUrl(url: string, method: "GET" | "HEAD" = "GET"): Promise<Response | null> {
  try {
    return await fetch(url, {
      method,
      headers: { "User-Agent": USER_AGENT },
      redirect: "follow",
    });
  } catch {
    return null;
  }
}

async function existsSubstack(slug: string): Promise<boolean> {
  const url = `https://${slug}.substack.com`;
  const head = await fetchUrl(url, "HEAD");
  if (head?.ok) return true;
  const get = await fetchUrl(url, "GET");
  return Boolean(get?.ok);
}

export async function searchSubstackByName(
  name: string
): Promise<{ url: string; slug: string } | null> {
  for (const slug of slugGuesses(name)) {
    await sleep(SUBSTACK_DELAY_MS);
    if (await existsSubstack(slug)) {
      return { url: `https://${slug}.substack.com`, slug };
    }
  }

  const q = encodeURIComponent(`${name} site:substack.com`);
  const res = await fetchUrl(
    `https://html.duckduckgo.com/html/?q=${q}`,
    "GET"
  );
  if (!res?.ok) return null;

  const html = await res.text();
  const m = html.match(/uddg=([^&"]+substack\.com[^&"]*)/i);
  if (!m) return null;

  try {
    const decoded = decodeURIComponent(m[1]);
    const u = new URL(decoded);
    const sub = u.hostname.split(".")[0];
    if (sub && sub !== "www" && sub !== "open") {
      return { url: `https://${sub}.substack.com`, slug: sub };
    }
  } catch {
    return null;
  }
  return null;
}
