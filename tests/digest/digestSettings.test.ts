import { describe, it, expect, beforeAll } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "tsearch-dsettings-"));
process.env.DIGEST_SETTINGS_PATH = path.join(tmpDir, "digest-settings.json");
process.env.DIGEST_EMAIL_FROM = "env-from@example.com";
process.env.DIGEST_EMAIL_TO = "env-to@example.com";

type Settings = typeof import("../../src/digest/digestSettings.js");
let mod: Settings;

beforeAll(async () => {
  mod = await import("../../src/digest/digestSettings.js");
});

describe("digest settings", () => {
  it("falls back to env vars when nothing is stored", () => {
    expect(mod.effectiveDigestSettings()).toEqual({
      from: "env-from@example.com",
      to: "env-to@example.com",
    });
  });

  it("stored values win over env; partial updates merge", () => {
    mod.saveDigestSettings({ to: "cory@example.com, grace@example.com" });
    expect(mod.effectiveDigestSettings()).toEqual({
      from: "env-from@example.com",
      to: "cory@example.com, grace@example.com",
    });
    mod.saveDigestSettings({ from: "tSearch <digest@me.dev>" });
    expect(mod.effectiveDigestSettings().to).toBe(
      "cory@example.com, grace@example.com"
    );
    expect(mod.effectiveDigestSettings().from).toBe("tSearch <digest@me.dev>");
  });

  it("validates addresses, including Name <addr> form and comma lists", () => {
    expect(mod.validateSettings({ from: "tSearch <a@b.co>" })).toBeNull();
    expect(mod.validateSettings({ to: "a@b.co, c@d.io" })).toBeNull();
    expect(mod.validateSettings({ from: "not-an-email" })).toMatch(/not a valid/);
    expect(mod.validateSettings({ to: "a@b.co, nope" })).toMatch(/nope/);
  });

  it("clearing a stored value falls back to env", () => {
    mod.saveDigestSettings({ from: "" });
    expect(mod.effectiveDigestSettings().from).toBe("env-from@example.com");
  });
});
