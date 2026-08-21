import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import {
  SUPABASE_ANON_KEY,
  SUPABASE_SERVICE_ROLE_KEY,
  SUPABASE_URL,
  TSEARCH_STORE,
  type TsearchStore,
} from "../../config.js";
import { assertTsearchStoreImplemented } from "./storeMode.js";

export interface SupabaseClientOpts {
  store: TsearchStore;
  url: string;
  key: string;
}

/**
 * Fail-closed factory. Returns null when URL or key is missing.
 * Throws if store is `supabase` — that mode is not wired to person/profile stores.
 */
export function createSupabaseClient(
  opts: SupabaseClientOpts
): SupabaseClient | null {
  assertTsearchStoreImplemented(opts.store);
  const url = opts.url.trim();
  const key = opts.key.trim();
  if (!url || !key) return null;
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/** Service-role client for future local pipeline writes. Null if env unset. */
export function getSupabaseAdmin(): SupabaseClient | null {
  return createSupabaseClient({
    store: TSEARCH_STORE,
    url: SUPABASE_URL,
    key: SUPABASE_SERVICE_ROLE_KEY,
  });
}

/** Anon client for future server-side reads. Null if env unset. */
export function getSupabaseAnon(): SupabaseClient | null {
  return createSupabaseClient({
    store: TSEARCH_STORE,
    url: SUPABASE_URL,
    key: SUPABASE_ANON_KEY,
  });
}
