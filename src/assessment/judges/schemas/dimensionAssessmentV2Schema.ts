import { z } from "zod";

export const dimensionScoreV2Schema = z.union([
  z.literal(0),
  z.literal(1),
  z.literal(2),
  z.literal(3),
  z.literal(4),
  z.literal(5),
  z.null(),
]);

export const dimensionApplicabilitySchema = z.enum([
  "applicable",
  "not_applicable",
  "insufficient_evidence",
]);

export const dimensionAssessmentV2Schema = z
  .object({
    dimension_id: z.string().min(1),
    score: dimensionScoreV2Schema,
    applicability: dimensionApplicabilitySchema,
    rationale: z.string().min(1),
    supporting_evidence_ids: z.array(z.string()),
    counterevidence_ids: z.array(z.string()),
    missing_information: z.array(z.string()),
  })
  .superRefine((dim, ctx) => {
    if (dim.applicability === "applicable" && dim.score === null) {
      ctx.addIssue({
        code: "custom",
        message: "applicable dimensions require a 0-5 score",
        path: ["score"],
      });
    }
    if (dim.applicability !== "applicable" && dim.score !== null) {
      ctx.addIssue({
        code: "custom",
        message: `score must be null when applicability is ${dim.applicability}`,
        path: ["score"],
      });
    }
  });

export const overallStrengthBandSchema = z.enum([
  "exceptional",
  "strong",
  "moderate",
  "limited",
  "insufficient_public_evidence",
]);

export const evidenceSupportLevelSchema = z.enum(["high", "moderate", "low"]);
