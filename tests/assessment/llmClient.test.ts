import crypto from "crypto";
import fs from "fs";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MockLlmJudgeClient } from "../../src/assessment/judges/llmClient.js";
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

void crypto;
void fs;
void path;
void afterEach;
void vi;
