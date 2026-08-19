import { describe, it, expect, beforeAll, vi } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "tsearch-jsonstore-"));
process.env.CACHE_DIR = tmpDir;
// dotenv will not override existing keys. Must be "0", not deleted — otherwise
// an operator .env with FORCE_REFRESH=1 makes every readCache miss.
process.env.FORCE_REFRESH = "0";

type JsonStore = typeof import("../../src/storage/jsonStore.js");
let store: JsonStore;

beforeAll(async () => {
  vi.resetModules();
  store = await import("../../src/storage/jsonStore.js");
});

describe("slugify", () => {
  it("strips diacritics and non-alphanumerics", () => {
    expect(store.slugify("Adam Gąsienica-Samek")).toBe("adam-gasienica-samek");
  });

  it("never returns an empty filename", () => {
    expect(store.slugify("???")).toBe("unnamed");
  });
});

describe("readCache / writeCache", () => {
  it("round-trips a fresh entry", () => {
    store.writeCache("test", "/users/foo?per_page=5", { hello: "world" });
    const hit = store.readCache<{ hello: string }>(
      "test",
      "/users/foo?per_page=5",
      60_000
    );
    expect(hit?.data.hello).toBe("world");
  });

  it("misses when the entry is older than the TTL", () => {
    store.writeCache("test", "expiring", 1);
    expect(store.readCache("test", "expiring", -1)).toBeNull();
  });

  it("returns a fresh envelope for negative entries (data: null)", () => {
    store.writeCache("test", "missing-user", null);
    const negative = store.readCache<null>("test", "missing-user", 60_000);
    expect(negative).not.toBeNull();
    expect(negative!.data).toBeNull();
  });

  it("does not collide keys that slugify identically", () => {
    store.writeCache("test", "/users/a/b", 1);
    store.writeCache("test", "/users/a-b", 2);
    expect(store.readCache<number>("test", "/users/a/b", 60_000)!.data).toBe(1);
    expect(store.readCache<number>("test", "/users/a-b", 60_000)!.data).toBe(2);
  });
});

describe("writeJsonAtomic", () => {
  it("replaces an existing file and leaves no tmp files behind", () => {
    const target = path.join(tmpDir, "atomic.json");
    store.writeJsonAtomic(target, { v: 1 });
    store.writeJsonAtomic(target, { v: 2 });
    expect(store.readJson<{ v: number }>(target)!.v).toBe(2);
    const leftovers = fs
      .readdirSync(tmpDir)
      .filter((f) => f.includes(".tmp"));
    expect(leftovers).toEqual([]);
  });
});
