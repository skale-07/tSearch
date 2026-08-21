export type DataSource = "fs" | "supabase";

export const VITE_STORE_UNIMPLEMENTED =
  "VITE_TSEARCH_STORE=supabase is not implemented. Keep VITE_TSEARCH_STORE=fs and use Express /api. See docs/prompts/integrate-supabase.md.";

export function parseViteDataSource(raw: string | undefined): DataSource {
  const v = (raw ?? "fs").trim().toLowerCase();
  return v === "supabase" ? "supabase" : "fs";
}

export const dataSource: DataSource = parseViteDataSource(
  import.meta.env.VITE_TSEARCH_STORE as string | undefined
);

/** Call from /api helpers so a premature supabase flag fails closed. */
export function assertViteStoreImplemented(): void {
  if (dataSource === "supabase") {
    throw new Error(VITE_STORE_UNIMPLEMENTED);
  }
}
