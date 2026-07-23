import { canonicalizeUrl, hostnameOf } from "./canonicalizeUrl.js";

export interface DiscoverBlogResult {
  input_url: string;
  canonical_url: string;
  canonical_domain: string;
}

/**
 * Resolve a candidate website URL to a canonical domain (no network).
 * Uses URL hostname; optional html may supply <link rel="canonical">.
 */
export function discoverBlog(
  websiteUrl: string,
  opts?: { html?: string; resolvedUrl?: string }
): DiscoverBlogResult {
  const fromHtml = opts?.html
    ? extractCanonicalFromHtml(opts.html, websiteUrl)
    : null;
  const preferred =
    opts?.resolvedUrl ?? fromHtml ?? websiteUrl;
  const canonical_url =
    canonicalizeUrl(preferred) ?? canonicalizeUrl(websiteUrl) ?? websiteUrl;
  const host = hostnameOf(canonical_url);
  if (!host) {
    throw new Error(`Cannot derive domain from website URL: ${websiteUrl}`);
  }
  return {
    input_url: websiteUrl,
    canonical_url,
    canonical_domain: host,
  };
}

export function extractCanonicalFromHtml(
  html: string,
  base: string
): string | null {
  const m = html.match(
    /<link[^>]+rel=["']canonical["'][^>]*href=["']([^"']+)["']/i
  ) ?? html.match(
    /<link[^>]+href=["']([^"']+)["'][^>]*rel=["']canonical["']/i
  );
  if (!m?.[1]) return null;
  return canonicalizeUrl(m[1], base);
}
