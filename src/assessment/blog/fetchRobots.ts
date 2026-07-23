import type { RobotsRules } from "./types.js";

/**
 * Parse robots.txt Disallow/Allow/Sitemap/Crawl-delay for User-agent: * (or any).
 */
export function parseRobotsTxt(text: string): RobotsRules {
  const lines = text.split(/\r?\n/);
  const disallow: string[] = [];
  const allow: string[] = [];
  const sitemaps: string[] = [];
  let crawl_delay: number | undefined;

  let applies = true;
  let sawUserAgent = false;

  for (const raw of lines) {
    const line = raw.replace(/#.*$/, "").trim();
    if (!line) continue;

    const ua = line.match(/^user-agent:\s*(.+)$/i);
    if (ua) {
      const agent = ua[1].trim().toLowerCase();
      applies = agent === "*" || agent.includes("tsearch");
      sawUserAgent = true;
      continue;
    }

    if (sawUserAgent && !applies) continue;

    const dis = line.match(/^disallow:\s*(.*)$/i);
    if (dis) {
      const path = dis[1].trim();
      if (path) disallow.push(path);
      continue;
    }

    const al = line.match(/^allow:\s*(.*)$/i);
    if (al) {
      const path = al[1].trim();
      if (path) allow.push(path);
      continue;
    }

    const sm = line.match(/^sitemap:\s*(.+)$/i);
    if (sm) {
      sitemaps.push(sm[1].trim());
      continue;
    }

    const cd = line.match(/^crawl-delay:\s*(\d+(?:\.\d+)?)$/i);
    if (cd && applies) {
      crawl_delay = Number(cd[1]);
    }
  }

  return { disallow, allow, sitemaps, crawl_delay };
}

/** True when robots Disallow blocks the URL path (simple prefix match). */
export function isDisallowed(url: string, rules: RobotsRules): boolean {
  let pathname: string;
  try {
    pathname = new URL(url).pathname;
  } catch {
    return false;
  }

  // Longer Allow prefixes win over Disallow when both match.
  let bestAllow = -1;
  let bestDisallow = -1;
  for (const a of rules.allow) {
    if (pathname.startsWith(a) && a.length > bestAllow) bestAllow = a.length;
  }
  for (const d of rules.disallow) {
    if (d === "/") {
      bestDisallow = Math.max(bestDisallow, 1);
      continue;
    }
    if (pathname.startsWith(d) && d.length > bestDisallow) {
      bestDisallow = d.length;
    }
  }
  if (bestDisallow < 0) return false;
  return bestDisallow > bestAllow;
}

export function fetchRobotsFromText(text: string): RobotsRules {
  return parseRobotsTxt(text);
}
