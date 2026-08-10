#!/usr/bin/env node
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { answerQuestion, ORACLE_LIVE_LLM } from "./answer.js";
import {
  buildIndex,
  isStale,
  searchIndex,
  type OracleIndex,
} from "./index.js";

/**
 * tsearch-oracle: a read-only MCP server any agent (Claude Code, Cursor, …)
 * can optionally call for grounded, cited answers about this system. It is a
 * resource, not a rule — agents with sufficient context can ignore it.
 * Registered in .mcp.json (Claude Code) and .cursor/mcp.json (Cursor).
 */

let index: OracleIndex = buildIndex();

function freshIndex(): OracleIndex {
  if (isStale(index)) index = buildIndex();
  return index;
}

const server = new Server(
  { name: "tsearch-oracle", version: "1.0.0" },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "ask_system",
      description:
        "Ask a technical or product question about the tSearch system (architecture, pipeline stages, scoring, assessment, storage, UI, conventions, risks). Returns an answer grounded in the repo's docs and source with file:line citations. Use when you lack starting context — cheaper and faster than crawling the repo.",
      inputSchema: {
        type: "object",
        properties: {
          question: {
            type: "string",
            description: "The question, in natural language.",
          },
        },
        required: ["question"],
      },
    },
    {
      name: "search_system",
      description:
        "Raw retrieval over the tSearch knowledge index (docs, README, CLAUDE.md, rubrics, src, server, tests, web, scripts). Returns the top-matching passages with file:line references. Use when you want source material rather than an answer.",
      inputSchema: {
        type: "object",
        properties: {
          query: { type: "string", description: "Search terms." },
          k: {
            type: "number",
            description: "Max passages to return (default 8).",
          },
        },
        required: ["query"],
      },
    },
    {
      name: "refresh_index",
      description:
        "Force a rebuild of the oracle's index (it also auto-rebuilds when indexed files change).",
      inputSchema: { type: "object", properties: {} },
    },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const { name, arguments: args } = req.params;

  if (name === "ask_system") {
    const question = String(args?.question ?? "").trim();
    if (!question) {
      return {
        content: [{ type: "text", text: "ask_system requires { question }" }],
        isError: true,
      };
    }
    const result = await answerQuestion(freshIndex(), question);
    const cites = result.citations
      .map((c) => `${c.file}:${c.lines}`)
      .join(", ");
    return {
      content: [
        {
          type: "text",
          text: `${result.answer}\n\n[mode: ${result.mode}${cites ? ` · sources: ${cites}` : ""}]`,
        },
      ],
    };
  }

  if (name === "search_system") {
    const query = String(args?.query ?? "").trim();
    if (!query) {
      return {
        content: [{ type: "text", text: "search_system requires { query }" }],
        isError: true,
      };
    }
    const k = typeof args?.k === "number" ? args.k : 8;
    const hits = searchIndex(freshIndex(), query, k);
    const text = hits.length
      ? hits
          .map(
            (h) =>
              `## ${h.chunk.file}:${h.chunk.start_line}-${h.chunk.end_line} (score ${h.score.toFixed(2)})\n${h.chunk.text}`
          )
          .join("\n\n")
      : "No matches in the index.";
    return { content: [{ type: "text", text }] };
  }

  if (name === "refresh_index") {
    index = buildIndex();
    return {
      content: [
        {
          type: "text",
          text: `Rebuilt: ${index.chunks.length} chunks from ${index.fileStamps.size} files at ${index.built_at}.`,
        },
      ],
    };
  }

  return {
    content: [{ type: "text", text: `Unknown tool: ${name}` }],
    isError: true,
  };
});

async function main(): Promise<void> {
  await server.connect(new StdioServerTransport());
  // stdout is the MCP transport — log status to stderr only.
  console.error(
    `[oracle] tsearch-oracle up — ${index.chunks.length} chunks / ${index.fileStamps.size} files · LLM synthesis ${ORACLE_LIVE_LLM ? "LIVE" : "off (extractive)"}`
  );
}

main().catch((err) => {
  console.error("[oracle] fatal:", err);
  process.exit(1);
});
