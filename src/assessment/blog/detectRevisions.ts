import type { RevisionMarker } from "./types.js";

const UPDATE_MARKERS =
  /\b(updated?|update(?:d)?\s+on|revision|erratum|corrigendum|postscript|addendum|edited\s+on|last\s+updated)\b/i;

/**
 * Detect revision signals from dates and body text markers.
 */
export function detectRevisions(input: {
  published_at?: string;
  modified_at?: string;
  text?: string;
  html?: string;
}): RevisionMarker[] {
  const markers: RevisionMarker[] = [];
  const { published_at, modified_at, text = "", html = "" } = input;

  if (published_at && modified_at && published_at !== modified_at) {
    const pub = Date.parse(published_at);
    const mod = Date.parse(modified_at);
    const days =
      !Number.isNaN(pub) && !Number.isNaN(mod)
        ? Math.round((mod - pub) / (24 * 60 * 60 * 1000))
        : undefined;
    markers.push({
      kind: "date_modified",
      observation:
        days !== undefined && days > 0
          ? `Article modified_at is ${days} day(s) after published_at.`
          : "Article modified_at differs from published_at.",
      published_at,
      modified_at,
      confidence_support: days !== undefined && days >= 1 ? "high" : "moderate",
    });
  }

  const body = `${text}\n${html}`;
  if (UPDATE_MARKERS.test(body)) {
    const snip = body.match(
      /.{0,40}\b(updated?|revision|erratum|addendum|edited\s+on|last\s+updated)\b.{0,60}/i
    );
    markers.push({
      kind: "update_note",
      observation: snip
        ? `Update marker in text: "${snip[0].replace(/\s+/g, " ").trim()}"`
        : "Update/revision language present in article body.",
      published_at,
      modified_at,
      confidence_support: "moderate",
    });
  }

  return markers;
}
