import fs from "fs";
import path from "path";
import { describe, expect, it } from "vitest";
import { parseTsearchStore } from "../../src/config.js";
import { createSupabaseClient } from "../../src/storage/supabase/client.js";
import {
  assertTsearchStoreImplemented,
  TSEARCH_STORE_UNIMPLEMENTED,
} from "../../src/storage/supabase/storeMode.js";

describe("parseTsearchStore", () => {
  it("defaults to fs", () => {
    expect(parseTsearchStore(undefined)).toBe("fs");
    expect(parseTsearchStore("")).toBe("fs");
    expect(parseTsearchStore("json")).toBe("fs");
    expect(parseTsearchStore("FS")).toBe("fs");
  });

  it("parses supabase without enabling it", () => {
    expect(parseTsearchStore("supabase")).toBe("supabase");
  });
});

describe("assertTsearchStoreImplemented", () => {
  it("allows fs", () => {
    expect(() => assertTsearchStoreImplemented("fs")).not.toThrow();
  });

  it("throws on supabase", () => {
    expect(() => assertTsearchStoreImplemented("supabase")).toThrow(
      TSEARCH_STORE_UNIMPLEMENTED
    );
  });
});

describe("createSupabaseClient", () => {
  it("returns null without url or key when store is fs", () => {
    expect(createSupabaseClient({ store: "fs", url: "", key: "" })).toBeNull();
    expect(
      createSupabaseClient({
        store: "fs",
        url: "https://example.supabase.co",
        key: "",
      })
    ).toBeNull();
  });

  it("throws when store is supabase even with keys", () => {
    expect(() =>
      createSupabaseClient({
        store: "supabase",
        url: "https://example.supabase.co",
        key: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.e30.x",
      })
    ).toThrow(TSEARCH_STORE_UNIMPLEMENTED);
  });

  it("returns a client when store is fs and url+key are set", () => {
    const client = createSupabaseClient({
      store: "fs",
      url: "https://example.supabase.co",
      key: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.e30.x",
    });
    expect(client).not.toBeNull();
  });
});

describe("0001_init.sql", () => {
  const sql = fs.readFileSync(
    path.join(process.cwd(), "supabase/migrations/0001_init.sql"),
    "utf-8"
  );
  const tables = [
    "people",
    "profiles",
    "tree_edges",
    "candidates",
    "marks",
    "feedback",
    "assessment_runs",
  ];

  it("does not insert person rows", () => {
    expect(sql.toLowerCase()).not.toMatch(/\binsert into\b/);
  });

  for (const table of tables) {
    it(`enables RLS and deny-all on ${table}`, () => {
      expect(sql).toMatch(
        new RegExp(`alter table ${table} enable row level security`, "i")
      );
      expect(sql).toContain(`${table}_deny_anon`);
      expect(sql).toContain(`${table}_deny_authenticated`);
    });
  }
});
