#!/usr/bin/env node
/**
 * CLI for the system oracle: npm run oracle:ask -- "how does scoring work?"
 * Extractive (free) by default; ORACLE_LLM=1 enables LLM synthesis.
 */
import { answerQuestion } from "../src/oracle/answer.js";
import { buildIndex } from "../src/oracle/index.js";

async function main(): Promise<void> {
  const question = process.argv.slice(2).join(" ").trim();
  if (!question) {
    console.error('Usage: npm run oracle:ask -- "your question"');
    process.exit(1);
  }
  const index = buildIndex();
  console.error(
    `[oracle] index: ${index.chunks.length} chunks / ${index.fileStamps.size} files`
  );
  const result = await answerQuestion(index, question);
  console.log(result.answer);
  if (result.citations.length) {
    console.log(
      `\nSources: ${result.citations.map((c) => `${c.file}:${c.lines}`).join(", ")}`
    );
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
