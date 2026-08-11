import type { DigestDocument } from "./types.js";

export function renderMarkdown(digest: DigestDocument): string {
  const lines: string[] = [];
  lines.push(`# tSearch → Cory: Candidate Digest`);
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
  lines.push(`- **Included here:** ${digest.candidates.length}`);
  lines.push("");
  lines.push(`## What this shortlist is for`);
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
    const linkBits = [
      c.links.github ? `[GitHub](${c.links.github})` : null,
      c.links.linkedin ? `[LinkedIn](${c.links.linkedin})` : null,
      c.links.website ? `[Website](${c.links.website})` : null,
      c.links.blog ? `[Blog](${c.links.blog})` : null,
    ].filter(Boolean);
    if (linkBits.length) {
      lines.push(`**Profiles:** ${linkBits.join(" · ")}`);
      lines.push("");
    }
    if (c.network_bridges) {
      const viaCollab = c.network_bridges.collaborator_of.length
        ? ` (co-contributor with ${c.network_bridges.collaborator_of.join(", ")})`
        : "";
      lines.push(
        `**Network bridge:** connected to ${c.network_bridges.seed_count} seed-set members — ${c.network_bridges.seeds.join(", ")}${viaCollab}`
      );
      lines.push("");
    }
    lines.push(
      `**Archetype:** ${c.primary_archetype.replace(/_/g, " ")}` +
        (c.cory_relevance
          ? ` · **Cory relevance:** ${c.cory_relevance}`
          : "")
    );
    if (c.secondary_archetypes?.length) {
      lines.push(
        `**Also:** ${c.secondary_archetypes.map((a) => a.replace(/_/g, " ")).join(", ")}`
      );
    }
    lines.push("");
    lines.push(
      `- Assessment priority: **${c.assessment_priority_score}/100** (confidence ${c.assessment_confidence})`
    );
    lines.push(
      `- Discovery score (pipeline \`final_score\`): **${c.discovery_score}**`
    );
    lines.push("");
    lines.push(`### Why send to Cory`);
    lines.push("");
    lines.push(c.brief_rationale ?? c.why_highlighted[0]?.rationale ?? c.headline);
    lines.push("");
    if (c.cory_reasons?.length) {
      for (const reason of c.cory_reasons) {
        lines.push(`- ${reason}`);
      }
      lines.push("");
    }
    lines.push(`### Specific work to inspect`);
    if (!c.strongest_artifacts.length) {
      lines.push(`- _(no named public artifacts retained)_`);
    } else {
      for (const a of c.strongest_artifacts) {
        lines.push(`- [${a.title}](${a.url})`);
      }
    }
    lines.push("");
    if (c.technical_summary) {
      lines.push(`### Technical`);
      lines.push(
        `Score **${c.technical_summary.score}/5 avg dims**, confidence ${c.technical_summary.confidence}`
      );
      lines.push("");
      lines.push(c.technical_summary.rationale);
      lines.push("");
    }
    if (c.writing_summary?.available) {
      lines.push(`### Writing`);
      lines.push(c.writing_summary.rationale);
      lines.push("");
    }
    lines.push(`### Caveats`);
    for (const u of c.important_uncertainties) {
      lines.push(`- ${u}`);
    }
    lines.push("");
    lines.push(`### Suggested next step`);
    lines.push(c.next_review_step);
    lines.push("");
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
