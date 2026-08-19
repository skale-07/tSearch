import { computePriorityV2 } from "../assessment/scoring/synthesizeCandidate.js";
import { toOverallScore10 } from "../scoring/ageScalar.js";
import type { CandidateAssessmentRecord } from "../assessment/types.js";
import type { ScoreBreakdown } from "../types.js";
import type {
  DigestScoreBreakdown,
  DigestWeightedLine,
} from "./types.js";

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function discoveryParts(sb: ScoreBreakdown): Array<{ label: string; value: number }> {
  const rows: Array<{ label: string; value: number | undefined }> = [
    { label: "Builder", value: sb.builder },
    { label: "Thinker", value: sb.thinker },
    { label: "Olympiad", value: sb.olympiad },
    { label: "Weirdness", value: sb.weirdness },
    { label: "Identity", value: sb.identity },
    { label: "Network", value: sb.convergence },
  ];
  return rows
    .filter((r): r is { label: string; value: number } => typeof r.value === "number")
    .map((r) => ({ label: r.label, value: round2(r.value) }));
}

/** Reconstruct the assessment formula from stored axes (same function as scoring). */
export function digestScoreBreakdown(
  record: CandidateAssessmentRecord
): DigestScoreBreakdown {
  const sb = record.source_candidate.score_breakdown;
  const surf = record.synthesis.surfacing;
  const estimatedAge =
    surf?.estimated_age ?? sb.estimated_age ?? null;
  const axes = record.synthesis.axes;

  let assessment: DigestScoreBreakdown["assessment"] = null;
  if (axes) {
    const priority = computePriorityV2({
      axes,
      identitySupport: record.ownership?.identity_support,
      identityRisks: record.ownership?.identity_risks,
      estimatedAge,
    });
    const c = priority.components;
    const techLabel =
      axes.technical_strength?.summary?.includes("LinkedIn experience")
        ? "Technical (LinkedIn experience)"
        : "Technical";
    const raw: Array<[string, number, number]> = [
      [techLabel, c.technical, c.w_technical],
      ["Ownership", c.ownership, c.w_ownership],
      ["Writing", c.writing, c.w_writing],
      ["Cross-artifact", c.cross_artifact, c.w_cross_artifact],
      ["Unusual problems", c.unusual, c.w_unusual],
      ["Persistence", c.persistence, c.w_persistence],
      ["Relevance", c.cory, c.w_cory],
      ["Evidence coverage", c.evidence_completeness, c.w_evidence_completeness],
    ];
    const lines: DigestWeightedLine[] = raw
      .filter(([, , w]) => (w ?? 0) > 0)
      .map(([label, score, weight]) => ({
        label,
        score: round2(score ?? 0),
        weight: round2(weight ?? 0),
        weighted: round2((score ?? 0) * (weight ?? 0)),
      }));
    assessment = {
      overall_10: toOverallScore10(priority.priority_score),
      priority_100: round2(priority.priority_score),
      lines,
      base: round2(c.base ?? 0),
      age_scalar: round2(c.age_scalar ?? 1),
      estimated_age: estimatedAge,
      caps: priority.caps_applied,
    };
  }

  return {
    assessment,
    discovery: {
      final_score: round2(record.source_candidate.discovery_score),
      overall_10:
        typeof sb.overall_score === "number" ? sb.overall_score : null,
      parts: discoveryParts(sb),
      age_scalar: typeof sb.age_scalar === "number" ? sb.age_scalar : null,
      estimated_age: sb.estimated_age ?? estimatedAge,
    },
    dials: {
      // Assessment nulls obscurity when there is nothing to be undiscovered
      // about. Do not fall back to discovery's ungated number in that case.
      obscurity: surf != null ? surf.obscurity : (sb.obscurity ?? null),
      upside: surf?.upside_score ?? null,
      age_relative: surf?.age_relative_impressiveness ?? null,
      connections: surf?.connections ?? null,
    },
  };
}

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function fmt01(n: number): string {
  return n.toFixed(2);
}

/** Compact email-safe table. Obscurity is labeled as not in the number. */
export function scoreBreakdownHtml(b: DigestScoreBreakdown): string {
  const a = b.assessment;
  const ageBit =
    a && a.estimated_age != null
      ? `age ~${a.estimated_age} → ×${fmt01(a.age_scalar)}`
      : a
        ? `age unknown → ×${fmt01(a.age_scalar)} (neutral)`
        : b.discovery.age_scalar != null
          ? `age ${b.discovery.estimated_age != null ? `~${b.discovery.estimated_age}` : "unknown"} → ×${fmt01(b.discovery.age_scalar)}`
          : "";

  const assessRows = a
    ? a.lines
        .map(
          (line) =>
            `<tr>
              <td style="padding:2px 8px 2px 0;color:#6b6558;">${esc(line.label)}</td>
              <td style="padding:2px 0;text-align:right;color:#3b372e;white-space:nowrap;">${fmt01(line.score)} × ${fmt01(line.weight)} = ${fmt01(line.weighted)}</td>
            </tr>`
        )
        .join("")
    : "";

  const discParts = b.discovery.parts
    .filter((p) => p.value !== 0)
    .map((p) => `${esc(p.label)} ${fmt01(p.value)}`)
    .join(" + ");

  const obscurity =
    b.dials.obscurity != null
      ? `<p style="margin:8px 0 0;font-size:11px;color:#8a8578;">Obscurity ${fmt01(b.dials.obscurity)} is a surfacing dial (sort/filter) — it is <strong>not</strong> in the 1–10${
          b.dials.upside != null
            ? `; upside ${fmt01(b.dials.upside)} = obscurity × judged substance`
            : ""
        }.</p>`
      : "";

  const caps =
    a?.caps.length
      ? `<p style="margin:4px 0 0;font-size:11px;color:#8a8578;">Caps: ${esc(a.caps.join(", "))}</p>`
      : "";

  const assessBlock = a
    ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="font-size:11px;line-height:1.45;">
        ${assessRows}
        <tr>
          <td style="padding:6px 8px 2px 0;color:#6b6558;border-top:1px solid #eee9dd;">Subtotal</td>
          <td style="padding:6px 0 2px;text-align:right;border-top:1px solid #eee9dd;">${fmt01(a.base)}</td>
        </tr>
        <tr>
          <td style="padding:2px 8px 2px 0;color:#6b6558;">${esc(ageBit || "Age scalar")}</td>
          <td style="padding:2px 0;text-align:right;">× ${fmt01(a.age_scalar)} → ${fmt01(a.priority_100)}/100</td>
        </tr>
        <tr>
          <td style="padding:2px 8px 0 0;color:#1a1408;font-weight:600;">Assessment</td>
          <td style="padding:2px 0 0;text-align:right;font-weight:600;color:#1a1408;">${a.overall_10.toFixed(1)}/10</td>
        </tr>
      </table>${caps}`
    : `<p style="margin:0;font-size:11px;color:#8a8578;">Assessment formula unavailable on this record.</p>`;

  const discAge =
    b.discovery.age_scalar != null
      ? ` × age ${fmt01(b.discovery.age_scalar)}`
      : "";

  return `<div style="margin:0 0 12px;padding:10px 12px;background:#f7f5ef;border:1px solid #eee9dd;border-radius:8px;">
    <div style="font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:#a49e90;margin:0 0 6px;">How the score was computed</div>
    ${assessBlock}
    <p style="margin:10px 0 0;font-size:11px;color:#6b6558;">Discovery ${fmt01(b.discovery.final_score)}${discAge}${discParts ? ` · ${discParts}` : ""} — kept separate from assessment.</p>
    ${obscurity}
  </div>`;
}

export function scoreBreakdownMarkdown(b: DigestScoreBreakdown): string {
  const lines: string[] = ["### How the score was computed", ""];
  if (b.assessment) {
    lines.push(
      `**Assessment ${b.assessment.overall_10.toFixed(1)}/10** (${fmt01(b.assessment.priority_100)}/100 after age)`
    );
    lines.push("");
    for (const line of b.assessment.lines) {
      lines.push(
        `- ${line.label}: ${fmt01(line.score)} × ${fmt01(line.weight)} = ${fmt01(line.weighted)}`
      );
    }
    const ageLabel =
      b.assessment.estimated_age != null
        ? `~${b.assessment.estimated_age}`
        : "unknown";
    lines.push(`- Subtotal: ${fmt01(b.assessment.base)}`);
    lines.push(
      `- Age scalar (${ageLabel}): ×${fmt01(b.assessment.age_scalar)}`
    );
    if (b.assessment.caps.length) {
      lines.push(`- Caps: ${b.assessment.caps.join(", ")}`);
    }
    lines.push("");
  }
  const discBits = b.discovery.parts
    .filter((p) => p.value !== 0)
    .map((p) => `${p.label} ${fmt01(p.value)}`);
  const discAge =
    b.discovery.age_scalar != null
      ? `, × age ${fmt01(b.discovery.age_scalar)}`
      : "";
  lines.push(
    `**Discovery** \`${b.discovery.final_score}\`${discAge}${discBits.length ? ` — ${discBits.join(" + ")}` : ""} (not the assessment number).`
  );
  if (b.dials.obscurity != null) {
    lines.push(
      `**Obscurity** ${fmt01(b.dials.obscurity)} is a surfacing dial and is **not** in either score.` +
        (b.dials.upside != null
          ? ` Upside ${fmt01(b.dials.upside)} = obscurity × judged substance.`
          : "")
    );
  }
  lines.push("");
  return lines.join("\n");
}

/** Dark "Learn more" profile page — same facts, theme-safe colors. */
export function scoreBreakdownProfileHtml(b: DigestScoreBreakdown): string {
  const a = b.assessment;
  const rows = a
    ? a.lines
        .map(
          (line) =>
            `<tr><td>${esc(line.label)}</td><td>${fmt01(line.score)} × ${fmt01(line.weight)} = ${fmt01(line.weighted)}</td></tr>`
        )
        .join("")
    : "";
  const age =
    a && a.estimated_age != null
      ? `~${a.estimated_age} → ×${fmt01(a.age_scalar)}`
      : a
        ? `unknown → ×${fmt01(a.age_scalar)} (neutral)`
        : "";
  const disc = b.discovery.parts
    .filter((p) => p.value !== 0)
    .map((p) => `${esc(p.label)} ${fmt01(p.value)}`)
    .join(" + ");
  const assess = a
    ? `<table class="break">${rows}
        <tr class="sum"><td>Subtotal</td><td>${fmt01(a.base)}</td></tr>
        <tr><td>Age ${esc(age)}</td><td>→ ${fmt01(a.priority_100)}/100</td></tr>
        <tr class="sum"><td>Assessment</td><td>${a.overall_10.toFixed(1)}/10</td></tr>
      </table>`
    : `<p class="muted">Assessment formula unavailable on this record.</p>`;
  const discAge =
    b.discovery.age_scalar != null
      ? ` × age ${fmt01(b.discovery.age_scalar)}`
      : "";
  const obsc =
    b.dials.obscurity != null
      ? `<p class="muted">Obscurity ${fmt01(b.dials.obscurity)} is a surfacing dial and is not in the 1–10${
          b.dials.upside != null
            ? `; upside ${fmt01(b.dials.upside)} = obscurity × judged substance`
            : ""
        }.</p>`
      : "";
  return `${assess}
    <p class="muted">Discovery ${fmt01(b.discovery.final_score)}${discAge}${disc ? ` · ${disc}` : ""} — kept separate from assessment.</p>
    ${obsc}`;
}
