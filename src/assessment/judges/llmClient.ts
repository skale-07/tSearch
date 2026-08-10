import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";
import type { z } from "zod";
import {
  resolveLlmApiKey,
  resolveLlmModel,
  resolveLlmProvider,
  type LlmProvider,
} from "../config.js";
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
    /** Provider JSON Schema; when omitted, falls back to free-form JSON object */
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
const ANTHROPIC_MAX_TOKENS = 8192;

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

function repairNote(
  attempt: number,
  lastError: unknown,
  lastRaw: string | undefined
): string {
  if (attempt === 0) return "";
  return `\n\nPrevious response failed schema validation. Return corrected JSON only.\nError: ${
    lastError instanceof Error ? lastError.message : String(lastError)
  }\nInvalid response excerpt: ${(lastRaw ?? "").slice(0, 500)}`;
}

/**
 * Anthropic tool input_schema is JSON Schema-like but rejects some OpenAI
 * strict-mode keywords. Strip only those that break tool registration.
 */
export function toAnthropicInputSchema(
  schema: Record<string, unknown>
): Anthropic.Tool.InputSchema {
  const strip = (node: unknown): unknown => {
    if (Array.isArray(node)) return node.map(strip);
    if (!node || typeof node !== "object") return node;
    const obj = node as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj)) {
      if (key === "$schema" || key === "strict") continue;
      out[key] = strip(value);
    }
    return out;
  };
  const cleaned = strip(schema) as Record<string, unknown>;
  if (cleaned.type !== "object") {
    throw new Error("Anthropic tool input_schema must be a top-level object");
  }
  return cleaned as Anthropic.Tool.InputSchema;
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

  constructor(
    apiKey = resolveLlmApiKey("openai"),
    private defaultModel = resolveLlmModel("openai")
  ) {
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
            {
              role: "system",
              content:
                input.systemPrompt + repairNote(attempt, lastError, lastRaw),
            },
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

/** Narrow Messages.create surface for tests (no live SDK required). */
export type AnthropicMessagesCreate = (params: {
  model: string;
  max_tokens: number;
  temperature?: number;
  system: string;
  messages: Array<{ role: "user"; content: string }>;
  tools?: Array<{
    name: string;
    description: string;
    input_schema: Anthropic.Tool.InputSchema;
  }>;
  tool_choice?: { type: "tool"; name: string };
}) => Promise<{
  id: string;
  content: Array<
    | { type: "tool_use"; id?: string; name: string; input: unknown }
    | { type: "text"; text: string }
  >;
  usage?: { input_tokens?: number; output_tokens?: number };
}>;

export class AnthropicJudgeClient implements LlmJudgeClient {
  private client: Anthropic | null;

  constructor(
    apiKey = resolveLlmApiKey("anthropic"),
    private defaultModel = resolveLlmModel("anthropic"),
    /** Injectable for tests — Messages API subset. */
    private readonly messagesCreate?: AnthropicMessagesCreate
  ) {
    if (!apiKey && !messagesCreate) {
      throw new Error(
        "ANTHROPIC_API_KEY or LLM_API_KEY is required for AnthropicJudgeClient"
      );
    }
    this.client = messagesCreate
      ? null
      : new Anthropic({ apiKey: apiKey as string });
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

    const create: AnthropicMessagesCreate =
      this.messagesCreate ??
      ((params) =>
        this.client!.messages.create(
          params as Parameters<Anthropic["messages"]["create"]>[0]
        ) as ReturnType<AnthropicMessagesCreate>);
    let lastError: unknown;
    let lastRaw: string | undefined;
    const toolName = input.jsonSchemaName ?? "judge_output";

    for (let attempt = 0; attempt <= MAX_SCHEMA_RETRIES; attempt++) {
      try {
        const system =
          input.systemPrompt + repairNote(attempt, lastError, lastRaw);
        const userContent = JSON.stringify({ payload: input.userPayload });

        const response = input.jsonSchema
          ? await create({
              model,
              max_tokens: ANTHROPIC_MAX_TOKENS,
              temperature: input.temperature ?? 0.1,
              system,
              messages: [{ role: "user", content: userContent }],
              tools: [
                {
                  name: toolName,
                  description:
                    "Return the structured judge assessment for this candidate artifact.",
                  input_schema: toAnthropicInputSchema(input.jsonSchema),
                },
              ],
              tool_choice: { type: "tool", name: toolName },
            })
          : await create({
              model,
              max_tokens: ANTHROPIC_MAX_TOKENS,
              temperature: input.temperature ?? 0.1,
              system:
                system +
                "\n\nRespond with a single JSON object only. No markdown fences.",
              messages: [{ role: "user", content: userContent }],
            });

        let parsed: unknown;
        if (input.jsonSchema) {
          const toolBlock = response.content.find(
            (block) => block.type === "tool_use" && block.name === toolName
          );
          if (!toolBlock || toolBlock.type !== "tool_use") {
            lastRaw = JSON.stringify(response.content);
            throw new Error("Anthropic response missing expected tool_use block");
          }
          parsed = toolBlock.input;
          lastRaw = JSON.stringify(parsed);
        } else {
          const text = response.content
            .filter((block) => block.type === "text")
            .map((block) => (block.type === "text" ? block.text : ""))
            .join("")
            .trim();
          lastRaw = text;
          parsed = JSON.parse(text);
        }

        const value = parseNormalized(
          input.outputSchema,
          parsed,
          "anthropic-llm"
        );
        writeJudgeCache(cacheKey, value);
        return {
          value,
          model,
          input_hash,
          from_cache: false,
          rawResponseId: response.id,
          usage: {
            inputTokens: response.usage?.input_tokens,
            outputTokens: response.usage?.output_tokens,
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

export function createLlmJudgeClient(opts?: {
  mock?: boolean;
  mockResponder?: (input: {
    systemPrompt: string;
    userPayload: unknown;
    attempt: number;
  }) => unknown;
  provider?: LlmProvider;
}): LlmJudgeClient {
  if (opts?.mock) {
    if (!opts.mockResponder) {
      throw new Error("mockResponder required when mock=true");
    }
    return new MockLlmJudgeClient(opts.mockResponder);
  }
  const provider = opts?.provider ?? resolveLlmProvider();
  if (provider === "anthropic") {
    return new AnthropicJudgeClient();
  }
  return new OpenAiJudgeClient();
}

/** @deprecated use createLlmJudgeClient */
export function createLlmClient(opts?: {
  mock?: boolean;
  mockResponder?: (input: {
    systemPrompt: string;
    userPayload: unknown;
    attempt: number;
  }) => unknown;
}): LlmJudgeClient {
  return createLlmJudgeClient(opts);
}
