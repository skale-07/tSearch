import { afterEach, describe, expect, it } from "vitest";
import {
  llmUseMock,
  resolveLlmApiKey,
  resolveLlmModel,
  resolveLlmProvider,
} from "../../src/assessment/config.js";

describe("LLM provider config", () => {
  const prev = {
    LLM_PROVIDER: process.env.LLM_PROVIDER,
    OPENAI_API_KEY: process.env.OPENAI_API_KEY,
    ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
    LLM_API_KEY: process.env.LLM_API_KEY,
    LLM_MODEL: process.env.LLM_MODEL,
    ASSESSMENT_MOCK_LLM: process.env.ASSESSMENT_MOCK_LLM,
  };

  afterEach(() => {
    for (const [key, value] of Object.entries(prev)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  it("defaults provider to openai", () => {
    delete process.env.LLM_PROVIDER;
    expect(resolveLlmProvider()).toBe("openai");
  });

  it("rejects unknown providers", () => {
    process.env.LLM_PROVIDER = "gemini";
    expect(() => resolveLlmProvider()).toThrow(/Invalid LLM_PROVIDER/);
  });

  it("resolves anthropic key from ANTHROPIC_API_KEY then LLM_API_KEY", () => {
    delete process.env.ANTHROPIC_API_KEY;
    process.env.LLM_API_KEY = "shared-key";
    expect(resolveLlmApiKey("anthropic")).toBe("shared-key");

    process.env.ANTHROPIC_API_KEY = "ant-key";
    expect(resolveLlmApiKey("anthropic")).toBe("ant-key");
  });

  it("defaults model by provider when LLM_MODEL unset", () => {
    delete process.env.LLM_MODEL;
    expect(resolveLlmModel("openai")).toBe("gpt-4o-mini");
    expect(resolveLlmModel("anthropic")).toBe("claude-sonnet-4-5");
  });

  it("lets explicit LLM_MODEL override provider default", () => {
    process.env.LLM_MODEL = "claude-opus-custom";
    expect(resolveLlmModel("anthropic")).toBe("claude-opus-custom");
    expect(resolveLlmModel("openai")).toBe("claude-opus-custom");
  });

  it("uses mock when selected provider key is missing", () => {
    delete process.env.ASSESSMENT_MOCK_LLM;
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.LLM_API_KEY;
    process.env.OPENAI_API_KEY = "sk-openai-only";
    process.env.LLM_PROVIDER = "anthropic";
    expect(resolveLlmApiKey("anthropic")).toBe("");
    expect(llmUseMock()).toBe(true);
  });
});
