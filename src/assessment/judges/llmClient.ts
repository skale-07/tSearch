import OpenAI from "openai";
import type { z } from "zod";
import { LLM_API_KEY, LLM_MODEL } from "../config.js";
import { parseWithSchema } from "../schemas.js";
import {
  hashPayload,
  readJudgeCacheEnvelope,
  writeJudgeCache,
  invalidateJudgeCache,
  LEGACY_RUBRIC_BUNDLE_VERSION,
  TECHNICAL_JUDGE_IMPLEMENTATION_VERSION,
  JUDGE_SCHEMA_VERSION,
} from "../storage/judgeCache.js";
import { normalizeLlmPayload } from "./normalizeLlmPayload.js";

export interface LlmJudgeClient {
  generateStructured<T>(input: {
    systemPrompt: string;
    userPayload: unknown;
    outputSchema: z.ZodType<T>;
    /** OpenAI strict JSON Schema; when omitted, falls back to json_object */
    jsonSchema?: Record<string, unknown>;
    jsonSchemaName?: string;
    model?: string;
    temperature?: number;
    cacheNamespace?: string;
    judgeSchemaVersion?: string;
    rubricBundleVersion?: string;
    judgeImplementationVersion?: string;
  }): Promise<{
    value: T;
    model: string;
    rawResponseId?: string;
    usage?: { inputTokens?: number; outputTokens?: number };
    input_hash: string;
    from_cache: boolean;
  }>;
}

const MAX_SCHEMA_RETRIES = 2;

function buildCacheKey(input: {
  systemPrompt: string;
  userPayload: unknown;
  model: string;
  cacheNamespace?: string;
  judgeSchemaVersion?: string;
  rubricBundleVersion?: string;
  judgeImplementationVersion?: string;
}): { cacheKey: string; input_hash: string } {
  const system_prompt_hash = hashPayload(input.systemPrompt);
  const user_payload_hash = hashPayload(input.userPayload);
  const judge_schema_version =
    input.judgeSchemaVersion ?? JUDGE_SCHEMA_VERSION;
  const rubric_bundle_version =
    input.rubricBundleVersion ?? LEGACY_RUBRIC_BUNDLE_VERSION;
  const judge_implementation_version =
    input.judgeImplementationVersion ?? TECHNICAL_JUDGE_IMPLEMENTATION_VERSION;
  const input_hash = hashPayload({
    model: input.model,
    system_prompt_hash,
    user_payload_hash,
    judge_schema_version,
    rubric_bundle_version,
    judge_implementation_version,
  });
  const cacheKey = `${input.cacheNamespace ?? "judge"}:${input_hash}`;
  return { cacheKey, input_hash };
}

function tryReadValidatedCache<T>(
  cacheKey: string,
  outputSchema: z.ZodType<T>
): T | null {
  const envelope = readJudgeCacheEnvelope(cacheKey);
  if (!envelope) return null;
  const parsed = outputSchema.safeParse(envelope.data);
  if (parsed.success) return parsed.data;
  console.log(
    JSON.stringify({
      stage: "judge_cache_invalid",
      cache_key_prefix: cacheKey.slice(0, 24),
      reason: "schema_validation_failed",
    })
  );
  invalidateJudgeCache(cacheKey);
  return null;
}

function parseNormalized<T>(
  outputSchema: z.ZodType<T>,
  raw: unknown,
  label: string
): T {
  return parseWithSchema(outputSchema, normalizeLlmPayload(raw), label);
}

export class MockLlmJudgeClient implements LlmJudgeClient {
  constructor(
    private readonly responder: (input: {
      systemPrompt: string;
      userPayload: unknown;
      attempt: number;
    }) => unknown
  ) {}

  async generateStructured<T>(input: {
    systemPrompt: string;
    userPayload: unknown;
    outputSchema: z.ZodType<T>;
    jsonSchema?: Record<string, unknown>;
    jsonSchemaName?: string;
    model?: string;
    temperature?: number;
    cacheNamespace?: string;
    judgeSchemaVersion?: string;
    rubricBundleVersion?: string;
    judgeImplementationVersion?: string;
  }): Promise<{
    value: T;
    model: string;
    rawResponseId?: string;
    usage?: { inputTokens?: number; outputTokens?: number };
    input_hash: string;
    from_cache: boolean;
  }> {
    const model = input.model ?? "mock-model";
    const { cacheKey, input_hash } = buildCacheKey({
      ...input,
      model,
    });
    const cached = tryReadValidatedCache(cacheKey, input.outputSchema);
    if (cached) {
      return { value: cached, model, input_hash, from_cache: true };
    }

    let lastError: unknown;
    for (let attempt = 0; attempt <= MAX_SCHEMA_RETRIES; attempt++) {
      const raw = this.responder({
        systemPrompt: input.systemPrompt,
        userPayload: input.userPayload,
        attempt,
      });
      try {
        const value = parseNormalized(input.outputSchema, raw, "mock-llm");
        writeJudgeCache(cacheKey, value);
        return {
          value,
          model,
          input_hash,
          from_cache: false,
          rawResponseId: `mock-${attempt}`,
        };
      } catch (err) {
        lastError = err;
      }
    }
    throw lastError instanceof Error
      ? lastError
      : new Error(String(lastError));
  }
}

export class OpenAiJudgeClient implements LlmJudgeClient {
  private client: OpenAI;

  constructor(apiKey = LLM_API_KEY, private defaultModel = LLM_MODEL) {
    if (!apiKey) {
      throw new Error(
        "OPENAI_API_KEY or LLM_API_KEY is required for OpenAiJudgeClient"
      );
    }
    this.client = new OpenAI({ apiKey });
  }

  async generateStructured<T>(input: {
    systemPrompt: string;
    userPayload: unknown;
    outputSchema: z.ZodType<T>;
    jsonSchema?: Record<string, unknown>;
    jsonSchemaName?: string;
    model?: string;
    temperature?: number;
    cacheNamespace?: string;
    judgeSchemaVersion?: string;
    rubricBundleVersion?: string;
    judgeImplementationVersion?: string;
  }): Promise<{
    value: T;
    model: string;
    rawResponseId?: string;
    usage?: { inputTokens?: number; outputTokens?: number };
    input_hash: string;
    from_cache: boolean;
  }> {
    const model = input.model ?? this.defaultModel;
    const { cacheKey, input_hash } = buildCacheKey({ ...input, model });
    const cached = tryReadValidatedCache(cacheKey, input.outputSchema);
    if (cached) {
      return { value: cached, model, input_hash, from_cache: true };
    }

    let lastError: unknown;
    let lastRaw: string | undefined;

    for (let attempt = 0; attempt <= MAX_SCHEMA_RETRIES; attempt++) {
      try {
        const repairNote =
          attempt === 0
            ? ""
            : `\n\nPrevious response failed schema validation. Return corrected JSON only.\nError: ${
                lastError instanceof Error ? lastError.message : String(lastError)
              }\nInvalid response excerpt: ${(lastRaw ?? "").slice(0, 500)}`;

        const responseFormat = input.jsonSchema
          ? {
              type: "json_schema" as const,
              json_schema: {
                name: input.jsonSchemaName ?? "judge_output",
                strict: true as const,
                schema: input.jsonSchema,
              },
            }
          : { type: "json_object" as const };

        const completion = await this.client.chat.completions.create({
          model,
          temperature: input.temperature ?? 0.1,
          response_format: responseFormat,
          messages: [
            { role: "system", content: input.systemPrompt + repairNote },
            {
              role: "user",
              content: JSON.stringify({
                payload: input.userPayload,
              }),
            },
          ],
        });

        lastRaw = completion.choices[0]?.message?.content ?? "";
        const parsed = JSON.parse(lastRaw);
        const value = parseNormalized(input.outputSchema, parsed, "openai-llm");
        writeJudgeCache(cacheKey, value);
        return {
          value,
          model,
          input_hash,
          from_cache: false,
          rawResponseId: completion.id,
          usage: {
            inputTokens: completion.usage?.prompt_tokens,
            outputTokens: completion.usage?.completion_tokens,
          },
        };
      } catch (err) {
        lastError = err;
      }
    }
    throw lastError instanceof Error
      ? lastError
      : new Error(String(lastError));
  }
}

export function createLlmClient(opts?: {
  mock?: boolean;
  mockResponder?: (input: {
    systemPrompt: string;
    userPayload: unknown;
    attempt: number;
  }) => unknown;
}): LlmJudgeClient {
  if (opts?.mock) {
    if (!opts.mockResponder) {
      throw new Error("mockResponder required when mock=true");
    }
    return new MockLlmJudgeClient(opts.mockResponder);
  }
  return new OpenAiJudgeClient();
}
