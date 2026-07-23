import crypto from "crypto";
import { canonicalizeUrl } from "./canonicalizeUrl.js";
import type { CitationReference } from "./types.js";

const DOI_RE =
  /\b(?:doi:\s*)?(?:https?:\/\/(?:dx\.)?doi\.org\/)?(10\.\d{4,9}\/[-._;()/:A-Z0-9]+)\b/gi;

const GITHUB_RE =
  /https?:\/\/(?:www\.)?github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+(?:\/[^\s"'<>]*)?/gi;

const URL_RE = /https?:\/\/[^\s"'<>)\]]+/gi;

/**
 * Extract DOI, GitHub, and generic URL citations from article text/HTML.
 */
export function extractCitations(
  text: string,
  opts?: { baseUrl?: string; html?: string }
): CitationReference[] {
  const out: CitationReference[] = [];
  const seen = new Set<string>();

  const add = (
    kind: CitationReference["kind"],
    raw: string,
    normalized?: string,
    context?: string
  ) => {
    const key = `${kind}:${(normalized ?? raw).toLowerCase()}`;
    if (seen.has(key)) return;
    seen.add(key);
    const citation_id = `cit_${crypto
      .createHash("sha1")
      .update(key)
      .digest("hex")
      .slice(0, 10)}`;
    out.push({
      citation_id,
      kind,
      raw,
      normalized_url: normalized,
      context,
    });
  };

  const source = [text, opts?.html ?? ""].join("\n");

  for (const m of source.matchAll(DOI_RE)) {
    const doi = m[1].replace(/[).,;]+$/, "");
    add("doi", m[0], `https://doi.org/${doi}`);
  }

  for (const m of source.matchAll(GITHUB_RE)) {
    const raw = m[0].replace(/[).,;]+$/, "");
    const norm = canonicalizeUrl(raw, opts?.baseUrl) ?? raw;
    add("github", raw, norm);
  }

  for (const m of source.matchAll(URL_RE)) {
    const raw = m[0].replace(/[).,;]+$/, "");
    if (/doi\.org/i.test(raw) || /github\.com/i.test(raw)) continue;
    const norm = canonicalizeUrl(raw, opts?.baseUrl) ?? raw;
    add("url", raw, norm);
  }

  return out;
}
