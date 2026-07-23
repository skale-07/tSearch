export type GithubRateLimitResource =
  | "core"
  | "search"
  | "code_search"
  | "graphql";

export interface RateLimitBudget {
  resource: GithubRateLimitResource;
  limit?: number;
  remaining?: number;
  used?: number;
  reset?: number;
  retryAfterSeconds?: number;
}

export class RateLimitManager {
  private budgets = new Map<GithubRateLimitResource, RateLimitBudget>();

  updateFromHeaders(
    resource: GithubRateLimitResource,
    headers: Headers | Record<string, string>
  ): void {
    const get = (k: string) =>
      typeof (headers as Headers).get === "function"
        ? (headers as Headers).get(k)
        : (headers as Record<string, string>)[k];
    const limit = Number(get("x-ratelimit-limit") ?? "");
    const remaining = Number(get("x-ratelimit-remaining") ?? "");
    const used = Number(get("x-ratelimit-used") ?? "");
    const reset = Number(get("x-ratelimit-reset") ?? "");
    const retryAfter = Number(get("retry-after") ?? "");
    this.budgets.set(resource, {
      resource,
      limit: Number.isFinite(limit) ? limit : undefined,
      remaining: Number.isFinite(remaining) ? remaining : undefined,
      used: Number.isFinite(used) ? used : undefined,
      reset: Number.isFinite(reset) ? reset : undefined,
      retryAfterSeconds: Number.isFinite(retryAfter) ? retryAfter : undefined,
    });
  }

  get(resource: GithubRateLimitResource): RateLimitBudget | undefined {
    return this.budgets.get(resource);
  }
}
