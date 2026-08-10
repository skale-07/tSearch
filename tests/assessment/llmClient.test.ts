import crypto from "crypto";
import fs from "fs";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  AnthropicJudgeClient,
  MockLlmJudgeClient,
  OpenAiJudgeClient,
  createLlmJudgeClient,
  toAnthropicInputSchema,
} from "../../src/assessment/judges/llmClient.js";
import {
  writeJudgeCache,
  hashPayload,
  JUDGE_SCHEMA_VERSION,
  LEGACY_RUBRIC_BUNDLE_VERSION,
  TECHNICAL_JUDGE_IMPLEMENTATION_VERSION,
} from "../../src/assessment/storage/judgeCache.js";
import { ensureAssessmentCacheDirs } from "../../src/assessment/storage/artifactCache.js";
import { z } from "zod";

const schema = z.object({ summary: z.string(), score: z.number() });

describe("mock LLM client cache", () => {
  const prevForce = process.env.ASSESSMENT_FORCE_REFRESH;

  beforeEach(() => {
    delete process.env.ASSESSMENT_FORCE_REFRESH;
    ensureAssessmentCacheDirs();
  });

  afterEach(() => {
    if (prevForce === undefined) delete process.env.ASSESSMENT_FORCE_REFRESH;
    else process.env.ASSESSMENT_FORCE_REFRESH = prevForce;
  });
  it("returns structured output and caches", async () => {
    let calls = 0;
    const ns = `test-llm-${Date.now()}-${Math.random()}`;
    const client = new MockLlmJudgeClient(() => {
      calls++;
      return { summary: "ok", score: 1 };
    });
    const a = await client.generateStructured({
      systemPrompt: "sys-v1",
      userPayload: { x: 1 },
      outputSchema: schema,
      cacheNamespace: ns,
    });
    const b = await client.generateStructured({
      systemPrompt: "sys-v1",
      userPayload: { x: 1 },
      outputSchema: schema,
      cacheNamespace: ns,
    });
    expect(a.value.summary).toBe("ok");
    expect(b.from_cache).toBe(true);
    expect(calls).toBe(1);
  });

  it("retries schema failures then succeeds", async () => {
    const client = new MockLlmJudgeClient(({ attempt }) => {
      if (attempt < 2) return { bad: true };
      return { summary: "fixed", score: 2 };
    });
    const result = await client.generateStructured({
      systemPrompt: "sys-repair",
      userPayload: { y: 2 },
      outputSchema: schema,
      cacheNamespace: `test-llm-repair-${Date.now()}`,
    });
    expect(result.value.summary).toBe("fixed");
  });

  it("regenerates when cached JSON is invalid", async () => {
    const ns = `test-llm-invalid-${Date.now()}`;
    const model = "mock-model";
    const systemPrompt = "sys-inv";
    const userPayload = { z: 1 };
    const input_hash = hashPayload({
      model,
      system_prompt_hash: hashPayload(systemPrompt),
      user_payload_hash: hashPayload(userPayload),
      judge_schema_version: JUDGE_SCHEMA_VERSION,
      rubric_bundle_version: LEGACY_RUBRIC_BUNDLE_VERSION,
      judge_implementation_version: TECHNICAL_JUDGE_IMPLEMENTATION_VERSION,
    });
    const cacheKey = `${ns}:${input_hash}`;
    writeJudgeCache(cacheKey, { nope: true });

    let calls = 0;
    const client = new MockLlmJudgeClient(() => {
      calls++;
      return { summary: "regenerated", score: 3 };
    });
    const result = await client.generateStructured({
      systemPrompt,
      userPayload,
      outputSchema: schema,
      cacheNamespace: ns,
      model,
    });
    expect(result.from_cache).toBe(false);
    expect(result.value.summary).toBe("regenerated");
    expect(calls).toBe(1);
  });

  it("misses cache when judge schema version changes", async () => {
    let calls = 0;
    const ns = `test-llm-schema-${Date.now()}`;
    const client = new MockLlmJudgeClient(() => {
      calls++;
      return { summary: "ok", score: calls };
    });
    await client.generateStructured({
      systemPrompt: "p",
      userPayload: { a: 1 },
      outputSchema: schema,
      cacheNamespace: ns,
      judgeSchemaVersion: "v1",
    });
    await client.generateStructured({
      systemPrompt: "p",
      userPayload: { a: 1 },
      outputSchema: schema,
      cacheNamespace: ns,
      judgeSchemaVersion: "v2",
    });
    expect(calls).toBe(2);
  });

  it("misses cache when rubric bundle version changes", async () => {
    let calls = 0;
    const ns = `test-llm-rubric-${Date.now()}`;
    const client = new MockLlmJudgeClient(() => {
      calls++;
      return { summary: "ok", score: calls };
    });
    await client.generateStructured({
      systemPrompt: "p",
      userPayload: { a: 1 },
      outputSchema: schema,
      cacheNamespace: ns,
      rubricBundleVersion: "legacy-phase2",
    });
    await client.generateStructured({
      systemPrompt: "p",
      userPayload: { a: 1 },
      outputSchema: schema,
      cacheNamespace: ns,
      rubricBundleVersion: "rubric-bundle-v1",
    });
    expect(calls).toBe(2);
  });

  it("misses cache when implementation version changes", async () => {
    let calls = 0;
    const ns = `test-llm-impl-${Date.now()}`;
    const client = new MockLlmJudgeClient(() => {
      calls++;
      return { summary: "ok", score: calls };
    });
    await client.generateStructured({
      systemPrompt: "p",
      userPayload: { a: 1 },
      outputSchema: schema,
      cacheNamespace: ns,
      judgeImplementationVersion: "technical-judge-v1",
    });
    await client.generateStructured({
      systemPrompt: "p",
      userPayload: { a: 1 },
      outputSchema: schema,
      cacheNamespace: ns,
      judgeImplementationVersion: "technical-judge-v2",
    });
    expect(calls).toBe(2);
  });
});

describe("AnthropicJudgeClient", () => {
  const prevForce = process.env.ASSESSMENT_FORCE_REFRESH;

  beforeEach(() => {
    delete process.env.ASSESSMENT_FORCE_REFRESH;
    ensureAssessmentCacheDirs();
  });

  afterEach(() => {
    if (prevForce === undefined) delete process.env.ASSESSMENT_FORCE_REFRESH;
    else process.env.ASSESSMENT_FORCE_REFRESH = prevForce;
  });

  it("parses forced tool_use input as structured output", async () => {
    let calls = 0;
    const client = new AnthropicJudgeClient("test-key", "claude-test", async () => {
      calls++;
      return {
        id: "msg_1",
        content: [
          {
            type: "tool_use",
            id: "tool_1",
            name: "judge_output",
            input: { summary: "claude-ok", score: 4 },
          },
        ],
        usage: { input_tokens: 10, output_tokens: 5 },
      };
    });

    const result = await client.generateStructured({
      systemPrompt: "sys",
      userPayload: { x: 1 },
      outputSchema: schema,
      jsonSchema: {
        type: "object",
        properties: {
          summary: { type: "string" },
          score: { type: "number" },
        },
        required: ["summary", "score"],
      },
      cacheNamespace: `test-anthropic-${Date.now()}`,
    });

    expect(result.value.summary).toBe("claude-ok");
    expect(result.value.score).toBe(4);
    expect(result.from_cache).toBe(false);
    expect(result.usage?.inputTokens).toBe(10);
    expect(calls).toBe(1);
  });

  it("retries when tool payload fails schema then succeeds", async () => {
    let calls = 0;
    const client = new AnthropicJudgeClient("test-key", "claude-test", async () => {
      calls++;
      if (calls === 1) {
        return {
          id: "msg_bad",
          content: [
            {
              type: "tool_use",
              name: "judge_output",
              input: { bad: true },
            },
          ],
        };
      }
      return {
        id: "msg_ok",
        content: [
          {
            type: "tool_use",
            name: "judge_output",
            input: { summary: "repaired", score: 2 },
          },
        ],
      };
    });

    const result = await client.generateStructured({
      systemPrompt: "sys",
      userPayload: { y: 2 },
      outputSchema: schema,
      jsonSchema: {
        type: "object",
        properties: {
          summary: { type: "string" },
          score: { type: "number" },
        },
        required: ["summary", "score"],
      },
      cacheNamespace: `test-anthropic-repair-${Date.now()}`,
    });

    expect(result.value.summary).toBe("repaired");
    expect(calls).toBe(2);
  });

  it("strips OpenAI-only keywords from tool schemas", () => {
    const cleaned = toAnthropicInputSchema({
      $schema: "https://json-schema.org/draft/2020-12/schema",
      strict: true,
      type: "object",
      properties: { summary: { type: "string" } },
      required: ["summary"],
    });
    expect(cleaned).toEqual({
      type: "object",
      properties: { summary: { type: "string" } },
      required: ["summary"],
    });
  });
});

describe("createLlmJudgeClient provider selection", () => {
  const prev = {
    provider: process.env.LLM_PROVIDER,
    openai: process.env.OPENAI_API_KEY,
    anthropic: process.env.ANTHROPIC_API_KEY,
    shared: process.env.LLM_API_KEY,
  };

  afterEach(() => {
    for (const [key, value] of Object.entries(prev)) {
      const envKey =
        key === "provider"
          ? "LLM_PROVIDER"
          : key === "openai"
            ? "OPENAI_API_KEY"
            : key === "anthropic"
              ? "ANTHROPIC_API_KEY"
              : "LLM_API_KEY";
      if (value === undefined) delete process.env[envKey];
      else process.env[envKey] = value;
    }
  });

  it("returns OpenAiJudgeClient for openai provider", () => {
    process.env.LLM_PROVIDER = "openai";
    process.env.OPENAI_API_KEY = "sk-test";
    const client = createLlmJudgeClient({ provider: "openai" });
    expect(client).toBeInstanceOf(OpenAiJudgeClient);
  });

  it("returns AnthropicJudgeClient for anthropic provider", () => {
    process.env.LLM_PROVIDER = "anthropic";
    process.env.ANTHROPIC_API_KEY = "sk-ant-test";
    const client = createLlmJudgeClient({ provider: "anthropic" });
    expect(client).toBeInstanceOf(AnthropicJudgeClient);
  });
});

void crypto;
void fs;
void path;
void vi;
