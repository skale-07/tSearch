import { MARK_SOURCES, type MarkSource } from "../src/marks/markStore.js";
import {
  locateWebsiteGraphHost,
  prepareWebsiteGraphIngest,
  previewWebsiteGraph,
  WEBSITE_GRAPH_INGEST_LIMIT,
} from "../src/pipeline/websiteGraph.js";
import { startWebsiteGraphRun } from "./runs.js";

export { MARK_SOURCES };

export function postWebsiteGraphHost(body: {
  seed_slug?: unknown;
  host_slug?: unknown;
  candidate_id?: unknown;
}): unknown {
  const seed_slug =
    typeof body.seed_slug === "string" ? body.seed_slug.trim() : undefined;
  const host_slug =
    typeof body.host_slug === "string" ? body.host_slug.trim() : undefined;
  const candidate_id =
    typeof body.candidate_id === "string" ? body.candidate_id.trim() : undefined;
  return locateWebsiteGraphHost({ seed_slug, host_slug, candidate_id });
}

export async function postWebsiteGraphPreview(body: {
  seed_slug?: unknown;
  host_slug?: unknown;
  url?: unknown;
}): Promise<unknown> {
  const seed_slug =
    typeof body.seed_slug === "string" ? body.seed_slug.trim() : "";
  if (!seed_slug) {
    return { error: "seed_slug required", status: 400 };
  }
  const url = typeof body.url === "string" ? body.url.trim() : undefined;
  const host_slug =
    typeof body.host_slug === "string" ? body.host_slug.trim() : undefined;
  return previewWebsiteGraph({ seed_slug, url, host_slug });
}

export function postWebsiteGraphIngest(body: {
  seed_slug?: unknown;
  host_slug?: unknown;
  url?: unknown;
  names?: unknown;
  org_hint?: unknown;
  hints?: unknown;
}):
  | { runId: string; batch: string[]; cap: number }
  | { error: string; status: number } {
  const seed_slug =
    typeof body.seed_slug === "string" ? body.seed_slug.trim() : "";
  const host_slug =
    typeof body.host_slug === "string" ? body.host_slug.trim() : undefined;
  const url = typeof body.url === "string" ? body.url.trim() : "";
  const org_hint =
    typeof body.org_hint === "string" ? body.org_hint.trim() : undefined;
  const names = Array.isArray(body.names)
    ? body.names.filter((n): n is string => typeof n === "string")
    : [];
  const hints =
    body.hints && typeof body.hints === "object" && !Array.isArray(body.hints)
      ? (body.hints as Record<
          string,
          { linkedin_url?: string; github_url?: string; org_hint?: string }
        >)
      : undefined;

  const job = prepareWebsiteGraphIngest({
    seed_slug,
    host_slug,
    url,
    names,
    org_hint,
    hints,
  });
  if ("error" in job) return job;
  const started = startWebsiteGraphRun(job);
  if ("error" in started) return started;
  return {
    runId: started.runId,
    batch: started.batch,
    cap: WEBSITE_GRAPH_INGEST_LIMIT,
  };
}

export function isMarkSource(value: unknown): value is MarkSource {
  return (
    typeof value === "string" &&
    (MARK_SOURCES as readonly string[]).includes(value)
  );
}
