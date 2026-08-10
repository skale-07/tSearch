import { LLM_API_KEY, LLM_MODEL } from "../assessment/config.js";
import { searchIndex, type OracleHit, type OracleIndex } from "./index.js";

/**
 * Answer layer. Default is extractive — top passages with file:line citations,
 * zero cost, nothing leaves the machine. Live LLM synthesis is opt-in via
 * ORACLE_LLM=1 (house rule: LLM calls cost money; offline is the default).
 */

export const ORACLE_LIVE_LLM =
  process.env.ORACLE_LLM === "1" && Boolean(LLM_API_KEY);

const EXCERPT_MAX_LINES = 28;

export interface OracleCitation {
  file: string;
  lines: string;
  score: number;
}

export interface OracleAnswer {
  mode: "extractive" | "llm";
  question: string;
  answer: string;
  citations: OracleCitation[];
}

function citation(hit: OracleHit): OracleCitation {
  return {
    file: hit.chunk.file,
    lines: `${hit.chunk.start_line}-${hit.chunk.end_line}`,
    score: Math.round(hit.score * 100) / 100,
  };
}

function excerpt(text: string): string {
  const lines = text.split("\n");
  return lines.length <= EXCERPT_MAX_LINES
    ? text
    : `${lines.slice(0, EXCERPT_MAX_LINES).join("\n")}\n… (${lines.length - EXCERPT_MAX_LINES} more lines)`;
}

function extractiveAnswer(question: string, hits: OracleHit[]): OracleAnswer {
  if (!hits.length) {
    return {
      mode: "extractive",
      question,
      answer:
        "No indexed passage matches this question. The oracle indexes docs/, README, CLAUDE.md, rubrics/, src/, server/, tests/, web/src/, and scripts/ — person data (profiles/, data/, cache/, output/) is deliberately excluded. Try rephrasing with terms from the code/docs.",
      citations: [],
    };
  }
  const body = hits
    .map(
      (h) =>
        `### ${h.chunk.file}:${h.chunk.start_line}-${h.chunk.end_line}\n\n${excerpt(h.chunk.text)}`
    )
    .join("\n\n---\n\n");
  return {
    mode: "extractive",
    question,
    answer: `Extractive mode (no LLM call). The ${hits.length} most relevant passages, best first — read top-down and follow the file:line citations:\n\n${body}`,
    citations: hits.map(citation),
  };
}

async function llmAnswer(
  question: string,
  hits: OracleHit[]
): Promise<OracleAnswer> {
  const { default: OpenAI } = await import("openai");
  const client = new OpenAI({ apiKey: LLM_API_KEY });

  const passages = hits
    .map(
      (h, i) =>
        `[${i + 1}] ${h.chunk.file}:${h.chunk.start_line}-${h.chunk.end_line}\n${h.chunk.text}`
    )
    .join("\n\n");

  const res = await client.chat.completions.create({
    model: LLM_MODEL,
    messages: [
      {
        role: "system",
        content:
          "You answer technical/product questions about the tSearch codebase using ONLY the numbered passages provided. Cite every claim with its passage's file:line reference (e.g. src/pipeline/runPipeline.ts:58-150). If the passages do not cover the question, say so plainly instead of guessing — never invent behavior. Be concise and concrete.",
      },
      {
        role: "user",
        content: `Question: ${question}\n\nPassages:\n\n${passages}`,
      },
    ],
  });

  const text = res.choices[0]?.message?.content?.trim();
  if (!text) return extractiveAnswer(question, hits);
  return {
    mode: "llm",
    question,
    answer: text,
    citations: hits.map(citation),
  };
}

export async function answerQuestion(
  index: OracleIndex,
  question: string,
  opts?: { k?: number; live?: boolean }
): Promise<OracleAnswer> {
  const hits = searchIndex(index, question, opts?.k ?? 8);
  const live = opts?.live ?? ORACLE_LIVE_LLM;
  if (live && hits.length) {
    try {
      return await llmAnswer(question, hits);
    } catch {
      // Fall back rather than fail: cited passages still answer the question.
      return extractiveAnswer(question, hits);
    }
  }
  return extractiveAnswer(question, hits);
}
