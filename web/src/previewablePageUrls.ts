export interface PageUrlOption {
  label: string;
  url: string;
}

function isLinkedInHost(host: string): boolean {
  return host === "linkedin.com" || host.endsWith(".linkedin.com");
}

function isGithubProfileHost(host: string): boolean {
  return host === "github.com" || host.endsWith(".github.com");
}

export function previewUrlKey(url: string): string {
  const u = new URL(url);
  const host = u.hostname.replace(/^www\./i, "").toLowerCase();
  const path = u.pathname.replace(/\/+$/, "") || "";
  return `${host}${path}`;
}

/** http(s) personal/org pages only — not LinkedIn or github.com profiles. */
export function canonicalizePreviewableUrl(raw: string): string | null {
  try {
    const u = new URL(raw.trim());
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    const host = u.hostname.replace(/^www\./i, "").toLowerCase();
    if (isLinkedInHost(host) || isGithubProfileHost(host)) return null;
    u.hash = "";
    if (u.pathname !== "/" && u.pathname.endsWith("/")) {
      u.pathname = u.pathname.replace(/\/+$/, "") || "/";
    }
    return u.toString();
  } catch {
    return null;
  }
}

export function pageUrlOptionLabel(url: string): string {
  const u = new URL(url);
  const host = u.hostname.replace(/^www\./i, "");
  const path = u.pathname.replace(/\/+$/, "") || "/";
  const short = path.length > 36 ? `${path.slice(0, 34)}…` : path;
  return short === "/" ? host : `${host}${short}`;
}

export function matchingPreviewableUrl(
  current: string,
  options: PageUrlOption[]
): string | null {
  const canon = canonicalizePreviewableUrl(current);
  if (!canon) return null;
  const key = previewUrlKey(canon);
  return options.find((o) => previewUrlKey(o.url) === key)?.url ?? null;
}

/** Deduped website / blog / publications (and extras) the sheet can preview. */
export function previewablePageUrls(
  links: {
    website?: string;
    blog?: string;
    publications?: string;
  },
  extra: Array<string | null | undefined> = []
): PageUrlOption[] {
  const seen = new Set<string>();
  const out: PageUrlOption[] = [];
  const entries: Array<{ kind: string; raw?: string | null }> = [
    { kind: "Website", raw: links.website },
    { kind: "Blog", raw: links.blog },
    { kind: "Publications", raw: links.publications },
    ...extra.map((raw) => ({ kind: "Site", raw })),
  ];
  for (const entry of entries) {
    if (!entry.raw?.trim()) continue;
    const url = canonicalizePreviewableUrl(entry.raw);
    if (!url) continue;
    const key = previewUrlKey(url);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      label: `${entry.kind} · ${pageUrlOptionLabel(url)}`,
      url,
    });
  }
  return out;
}
