import { z } from "zod";
import { BUDGETS, ECOSYSTEMS, EXTENSION_TARGETS, MODES, PLATFORMS, TECH_LEVELS } from "./types.js";

const shortText = z.string().trim().min(1).max(200);

export const prioritiesSchema = z
  .object({
    fit: z.number().min(0).max(1),
    health: z.number().min(0).max(1),
    ease: z.number().min(0).max(1),
    cost: z.number().min(0).max(1),
    reputation: z.number().min(0).max(1),
  })
  .partial();

/**
 * The structured version of what the user asked for. The AI fills it from the interview;
 * every field except `need` and `keywords` has a sensible default.
 */
export const specShape = {
  need: z.string().trim().min(3).max(1000).describe("The user's need in their own words."),
  keywords: z
    .array(shortText)
    .min(1)
    .max(12)
    .describe("3-10 search phrases: synonyms, category names, feature words. English works best for most sources."),
  alternativeTo: z.array(shortText).max(5).default([]).describe("Paid or known apps the user wants to replace."),
  mode: z.enum(MODES).default("any"),
  platforms: z.array(z.enum(PLATFORMS)).max(8).default([]),
  languages: z.array(shortText).max(5).default([]).describe("Programming languages (developers only)."),
  ecosystems: z.array(z.enum(ECOSYSTEMS)).max(8).default([]),
  extensionFor: z.enum(EXTENSION_TARGETS).optional(),
  budget: z.enum(BUDGETS).default("free"),
  openSourceOnly: z.boolean().default(true),
  commercialUse: z.boolean().default(false).describe("True when it will be used for a business."),
  techLevel: z.enum(TECH_LEVELS).default("beginner"),
  minStars: z.number().int().min(0).max(1_000_000).optional(),
  activeWithinMonths: z.number().int().min(1).max(120).default(12),
  licenses: z.array(shortText).max(10).default([]).describe("Allowed SPDX ids, e.g. MIT, Apache-2.0. Empty = any."),
  mustHaves: z.array(shortText).max(12).default([]),
  niceToHaves: z.array(shortText).max(12).default([]),
  priorities: prioritiesSchema.optional(),
  userLanguage: z.string().trim().max(40).default("en").describe("Language to answer in, e.g. en, hi, es."),
  maxResults: z.number().int().min(3).max(50).default(20),
};

export const specSchema = z.object(specShape);
export type Spec = z.infer<typeof specSchema>;
export type SpecInput = z.input<typeof specSchema>;

export function parseSpec(input: unknown): Spec {
  return specSchema.parse(input);
}

/** Default star floor when the user didn't give one: everyday users get safer, more popular picks. */
export function effectiveMinStars(spec: Spec): number {
  if (spec.minStars !== undefined) return spec.minStars;
  return spec.techLevel === "beginner" ? 50 : 10;
}
