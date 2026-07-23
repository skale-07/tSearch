import type { DigestDocument } from "./types.js";

export function renderMarkdown(digest: DigestDocument): string {
  const lines: string[] = [];
  lines.push(`# tSearch Candidate Assessment Digest`);
  lines.push("");
  lines.push(`- **Assessment run:** \`${digest.assessment_run_id}\``);
  lines.push(`- **Digest ID:** \`${digest.digest_id}\``);
  lines.push(`- **Generated:** ${digest.generated_at}`);
  lines.push(
    `- **Discovered candidates:** ${digest.meta.discovered_candidate_count}`
  );
  lines.push(
    `- **Deeply assessed:** ${digest.meta.assessed_candidate_count}`
  );
  lines.push("");
  lines.push(`## What this assessment prioritizes`);
  lines.push("");
  lines.push(digest.criteria_summary.purpose);
  lines.push("");
  lines.push(
    `Dimensions: ${digest.criteria_summary.dimensions.join(", ")}.`
  );
  lines.push("");
  lines.push(`### Explicitly not treated as proof of talent`);
  for (const n of digest.criteria_summary.important_non_signals) {
    lines.push(`- ${n}`);
  }
  lines.push("");
  lines.push(`### Limitations`);
  for (const n of digest.criteria_summary.limitations) {
    lines.push(`- ${n}`);
  }
  lines.push("");

  for (const c of digest.candidates) {
    lines.push(`---`);
    lines.push("");
    lines.push(`## ${c.rank}. ${c.name}`);
    lines.push("");
    lines.push(`**Archetype:** ${c.primary_archetype.replace(/_/g, " ")}`);
    if (c.secondary_archetypes?.length) {
      lines.push(
        `**Also:** ${c.secondary_archetypes.map((a) => a.replace(/_/g, " ")).join(", ")}`
      );
    }
    lines.push("");
    lines.push(c.headline);
    lines.push("");
    lines.push(
      `- Discovery score (pipeline \`final_score\`): **${c.discovery_score}**`
    );
    lines.push(
      `- Assessment priority: **${c.assessment_priority_score}/100** (confidence ${c.assessment_confidence})`
    );
    lines.push("");
    lines.push(`### Why highlighted`);
    for (const w of c.why_highlighted) {
      lines.push(`- **${w.claim}** — ${w.rationale}`);
    }
    lines.push("");
    if (c.technical_summary) {
      lines.push(`### Technical depth`);
      lines.push(
        `Score **${c.technical_summary.score}/10**, confidence ${c.technical_summary.confidence}`
      );
      lines.push("");
      lines.push(c.technical_summary.rationale);
      lines.push("");
    }
    lines.push(`### Curiosity / unusual project signal`);
    lines.push(
      `Score **${c.curiosity_summary.score}/10**, confidence ${c.curiosity_summary.confidence}`
    );
    lines.push("");
    lines.push(c.curiosity_summary.rationale);
    lines.push("");
    lines.push(`### Best artifacts`);
    for (const a of c.strongest_artifacts) {
      lines.push(`- [${a.title}](${a.url}) — ${a.reason_selected}`);
    }
    lines.push("");
    lines.push(`### Why the assessment may be wrong`);
    for (const u of c.important_uncertainties) {
      lines.push(`- ${u}`);
    }
    lines.push("");
    lines.push(`### What to inspect next`);
    lines.push(c.next_review_step);
    lines.push("");
    const linkBits = [
      c.links.github ? `[GitHub](${c.links.github})` : null,
      c.links.linkedin ? `[LinkedIn](${c.links.linkedin})` : null,
      c.links.website ? `[Website](${c.links.website})` : null,
      c.links.blog ? `[Blog](${c.links.blog})` : null,
    ].filter(Boolean);
    if (linkBits.length) {
      lines.push(`Links: ${linkBits.join(" · ")}`);
      lines.push("");
    }
  }

  lines.push(`### Version footer`);
  lines.push("");
  lines.push(`- Assessment run: \`${digest.assessment_run_id}\``);
  lines.push(`- Digest ID: \`${digest.digest_id}\``);
  lines.push(
    `- Assessment schema: ${digest.versions?.assessment_schema_version ?? digest.schema_version}`
  );
  lines.push(
    `- Rubric bundle: ${digest.versions?.rubric_bundle_version ?? "n/a"}`
  );
  lines.push(
    `- Priority weights: ${digest.versions?.priority_weight_version ?? "n/a"}`
  );
  lines.push("");

  return lines.join("\n");
}
