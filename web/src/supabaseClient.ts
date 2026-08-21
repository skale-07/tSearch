import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import {
  assertViteStoreImplemented,
  dataSource,
  VITE_STORE_UNIMPLEMENTED,
  type DataSource,
} from "./dataSource";

export interface BrowserSupabaseOpts {
  store: DataSource;
  url: string;
  anonKey: string;
}

/**
 * Hosted UI client (anon key only). Unused by api.ts until the integration
 * prompt swaps GETs. Service-role must never appear in VITE_ env.
 */
export function createBrowserSupabaseClient(
  opts: BrowserSupabaseOpts
): SupabaseClient | null {
  if (opts.store === "supabase") {
    throw new Error(VITE_STORE_UNIMPLEMENTED);
  }
  const url = opts.url.trim();
  const anonKey = opts.anonKey.trim();
  if (!url || !anonKey) return null;
  return createClient(url, anonKey, {
    auth: { persistSession: true, autoRefreshToken: true },
  });
}

export function getSupabaseBrowser(): SupabaseClient | null {
  assertViteStoreImplemented();
  return createBrowserSupabaseClient({
    store: dataSource,
    url: String(import.meta.env.VITE_SUPABASE_URL ?? ""),
    anonKey: String(import.meta.env.VITE_SUPABASE_ANON_KEY ?? ""),
  });
}
