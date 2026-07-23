import { BLOG_BUDGETS, BLOG_USER_AGENT } from "./types.js";

export type FetchImpl = (
  input: string | URL,
  init?: RequestInit
) => Promise<Response>;

export interface BlogClientOptions {
  fetchImpl?: FetchImpl;
  userAgent?: string;
  maxRedirects?: number;
  maxConsecutiveErrors?: number;
  /** Base delay for backoff (ms). */
  backoffBaseMs?: number;
  maxRetries?: number;
}

export interface BlogFetchResult {
  url: string;
  finalUrl: string;
  status: number;
  body: string;
  headers: Record<string, string>;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function isRetryable(status: number): boolean {
  return status === 429 || (status >= 500 && status < 600);
}

/**
 * HTTP fetch with tSearch UA, bounded redirects, and backoff on 429/5xx.
 * Accepts optional fetchImpl for offline tests.
 */
export async function blogFetch(
  url: string,
  opts?: BlogClientOptions & { method?: string }
): Promise<BlogFetchResult> {
  const fetchImpl = opts?.fetchImpl ?? fetch;
  const userAgent = opts?.userAgent ?? BLOG_USER_AGENT;
  const maxRedirects = opts?.maxRedirects ?? BLOG_BUDGETS.MAX_REDIRECTS;
  const maxRetries = opts?.maxRetries ?? BLOG_BUDGETS.MAX_CONSECUTIVE_ERRORS;
  const backoffBaseMs = opts?.backoffBaseMs ?? 250;

  let current = url;
  let redirects = 0;
  let consecutiveErrors = 0;

  for (;;) {
    const res = await fetchImpl(current, {
      method: opts?.method ?? "GET",
      redirect: "manual",
      headers: {
        "User-Agent": userAgent,
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      },
    });

    if ([301, 302, 303, 307, 308].includes(res.status)) {
      const loc = res.headers.get("location");
      if (!loc) {
        throw new Error(`Redirect without Location from ${current}`);
      }
      redirects += 1;
      if (redirects > maxRedirects) {
        throw new Error(
          `Redirect bound exceeded (${maxRedirects}) at ${current}`
        );
      }
      current = new URL(loc, current).toString();
      continue;
    }

    if (isRetryable(res.status)) {
      consecutiveErrors += 1;
      if (consecutiveErrors > maxRetries) {
        throw new Error(
          `Too many consecutive server errors (${res.status}) fetching ${current}`
        );
      }
      await sleep(backoffBaseMs * 2 ** (consecutiveErrors - 1));
      continue;
    }

    const body = await res.text();
    const headers: Record<string, string> = {};
    res.headers.forEach((v, k) => {
      headers[k.toLowerCase()] = v;
    });

    return {
      url,
      finalUrl: current,
      status: res.status,
      body,
      headers,
    };
  }
}
