import type { TsearchStore } from "../../config.js";

export const TSEARCH_STORE_UNIMPLEMENTED =
  "TSEARCH_STORE=supabase is not implemented. Keep TSEARCH_STORE=fs (JSON under data/, profiles/, output/). See docs/prompts/integrate-supabase.md.";

export function assertTsearchStoreImplemented(store: TsearchStore): void {
  if (store === "supabase") {
    throw new Error(TSEARCH_STORE_UNIMPLEMENTED);
  }
}
