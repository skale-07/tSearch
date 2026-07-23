/**
 * Normalize article/page URLs for dedup and domain checks.
 * Strips tracking query params, fragments, default ports, and trailing slashes
 * (except root).
 */
export function canonicalizeUrl(raw: string, base?: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  let url: URL;
  try {
    url = base ? new URL(trimmed, base) : new URL(trimmed);
  } catch {
    return null;
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") return null;

  url.hash = "";

  const drop = new Set([
    "utm_source",
    "utm_medium",
    "utm_campaign",
    "utm_term",
    "utm_content",
    "fbclid",
    "gclid",
    "ref",
    "mc_cid",
    "mc_eid",
  ]);
  const kept = new URLSearchParams();
  for (const [k, v] of url.searchParams.entries()) {
    if (!drop.has(k.toLowerCase())) kept.append(k, v);
  }
  url.search = kept.toString() ? `?${kept.toString()}` : "";

  let pathname = url.pathname.replace(/\/{2,}/g, "/");
  if (pathname.length > 1 && pathname.endsWith("/")) {
    pathname = pathname.slice(0, -1);
  }
  url.pathname = pathname || "/";

  url.hostname = url.hostname.toLowerCase();
  if (
    (url.protocol === "https:" && url.port === "443") ||
    (url.protocol === "http:" && url.port === "80")
  ) {
    url.port = "";
  }

  return url.toString();
}

export function hostnameOf(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
}

export function sameRegistrableHost(a: string, b: string): boolean {
  const ha = hostnameOf(a);
  const hb = hostnameOf(b);
  if (!ha || !hb) return false;
  if (ha === hb) return true;
  return ha.endsWith(`.${hb}`) || hb.endsWith(`.${ha}`);
}
