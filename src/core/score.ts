import { z } from "zod";
import { classifyLicense } from "./license.js";
import type { Spec } from "./spec.js";
import { easeScore } from "./setup.js";
import { monthsSince } from "./text.js";
import type { Candidate, SetupLevel } from "./types.js";

export interface Weights {
  fit: number;
  health: number;
  ease: number;
  cost: number;
  reputation: number;
}

const DEFAULT_WEIGHTS: Record<Spec["techLevel"], Weights> = {
  beginner: { fit: 0.4, health: 0.2, ease: 0.25, cost: 0.1, reputation: 0.05 },
  intermediate: { fit: 0.45, health: 0.25, ease: 0.15, cost: 0.08, reputation: 0.07 },
  developer: { fit: 0.5, health: 0.3, ease: 0.05, cost: 0.05, reputation: 0.1 },
};

/** Weights for this user: tech-level defaults, overridden by explicit priorities, normalised to sum to 1. */
export function weightsFor(spec: Spec): Weights {
  const merged: Weights = { ...DEFAULT_WEIGHTS[spec.techLevel], ...(spec.priorities ?? {}) };
  if (spec.budget === "free") merged.cost = Math.max(merged.cost, 0.1);
  const sum = merged.fit + merged.health + merged.ease + merged.cost + merged.reputation;
  if (sum <= 0) return DEFAULT_WEIGHTS[spec.techLevel];
  return {
    fit: merged.fit / sum,
    health: merged.health / sum,
    ease: merged.ease / sum,
    cost: merged.cost / sum,
    reputation: merged.reputation / sum,
  };
}

/** 0..1 popularity on a log scale: 10 → 0.2, 1k → 0.6, 30k+ → 1. Downloads are scaled down to star-equivalents. */
export function popularityScore(c: Pick<Candidate, "stars" | "downloads" | "downloadsPeriod">): number {
  const starLike =
    c.stars ?? (c.downloads !== undefined ? c.downloads / (c.downloadsPeriod === "total" ? 1000 : c.downloadsPeriod === "week" ? 25 : 100) : 0);
  return Math.min(1, Math.log10(starLike + 1) / 4.5);
}

/**
 * Ranking before the AI reads any docs: relevance first, then popularity (adoption), the
 * sources' own ranking, freshness and how many independent sources found the tool.
 */
export function prelimScore(c: Candidate, now: Date, mode: Spec["mode"] = "any"): number {
  const relevance = c.relevance ?? 0;
  const age = monthsSince(c.lastActivity, now);
  const freshness = age === undefined ? 0.5 : age <= 3 ? 1 : age <= 12 ? 0.7 : 0.3;
  const agreement = Math.min(1, (c.sources.length - 1) / 2);
  // Developers picking a library care more about adoption; descriptions of libraries are terse.
  const [wRel, wPop] = mode === "library" ? [0.3, 0.35] : [0.4, 0.25];
  return wRel * relevance + wPop * popularityScore(c) + 0.15 * (c.sourceRank ?? 0.5) + 0.1 * freshness + 0.1 * agreement;
}

export const requirementStatusSchema = z.enum(["met", "partial", "no", "unknown"]);
export type RequirementStatus = z.infer<typeof requirementStatusSchema>;

export const fitJudgmentSchema = z.object({
  requirement: z.string().min(1).max(200),
  status: requirementStatusSchema,
  evidence: z.string().max(400).optional().describe("Short quote from the README/docs that supports the status."),
});
export type FitJudgment = z.infer<typeof fitJudgmentSchema>;

/** Everything the final ranking needs about one tool: facts from tools plus the AI's fit judgments. */
export const rankInputSchema = z.object({
  id: z.string().min(1).max(300),
  name: z.string().min(1).max(200),
  url: z.string().url(),
  mustHaves: z.array(fitJudgmentSchema).max(20).default([]),
  niceToHaves: z.array(fitJudgmentSchema).max(20).default([]),
  healthScore: z.number().min(0).max(1).optional(),
  setupLevel: z.enum(["easy-hosted", "easy-install", "medium", "hard", "unknown"]).optional(),
  license: z.string().max(100).optional(),
  hasFreeOption: z.boolean().optional().describe("True if a free version or free tier exists."),
  stars: z.number().int().min(0).optional(),
  awesomeLists: z.number().int().min(0).optional(),
  communityMentions: z.number().int().min(0).optional(),
  packagedIn: z.number().int().min(0).optional(),
});
export type RankInput = z.input<typeof rankInputSchema>;
export type RankInputParsed = z.infer<typeof rankInputSchema>;

export interface RankedTool {
  id: string;
  name: string;
  url: string;
  total: number;
  breakdown: Weights;
  failsMustHave: boolean;
  unknownMustHaves: number;
}

const STATUS_VALUE: Record<RequirementStatus, number> = { met: 1, partial: 0.5, unknown: 0.35, no: 0 };

/** 0..1 fit: must-haves dominate; nice-to-haves add up to 20%. */
export function fitScore(mustHaves: FitJudgment[], niceToHaves: FitJudgment[]): number {
  const avg = (list: FitJudgment[]) => (list.length === 0 ? 1 : list.reduce((s, j) => s + STATUS_VALUE[j.status], 0) / list.length);
  return niceToHaves.length === 0 ? avg(mustHaves) : 0.8 * avg(mustHaves) + 0.2 * avg(niceToHaves);
}

function costScore(t: RankInputParsed, spec: Spec): number {
  if (spec.budget === "any") return 1;
  const lic = classifyLicense(t.license);
  if (t.hasFreeOption === false) return spec.budget === "free" ? 0 : 0.6;
  if (lic.isOpenSource || t.hasFreeOption) return 1;
  if (lic.category === "source-available") return 0.7;
  return 0.5;
}

function reputationScore(t: RankInputParsed): number {
  const parts = [
    t.stars !== undefined ? Math.min(1, Math.log10(t.stars + 1) / 4.5) : undefined,
    t.awesomeLists !== undefined ? Math.min(1, t.awesomeLists / 5) : undefined,
    t.communityMentions !== undefined ? Math.min(1, t.communityMentions / 10) : undefined,
    t.packagedIn !== undefined ? Math.min(1, t.packagedIn / 10) : undefined,
  ].filter((v): v is number => v !== undefined);
  return parts.length === 0 ? 0.4 : parts.reduce((s, v) => s + v, 0) / parts.length;
}

/** Final ranking. A tool that clearly fails a must-have sinks below every tool that doesn't. */
export function rankTools(inputs: RankInput[], spec: Spec): RankedTool[] {
  const w = weightsFor(spec);
  const ranked = inputs.map((raw) => {
    const t = rankInputSchema.parse(raw);
    const fit = fitScore(t.mustHaves, t.niceToHaves);
    const parts: Weights = {
      fit,
      health: t.healthScore ?? 0.4,
      ease: easeScore((t.setupLevel ?? "unknown") as SetupLevel, spec.techLevel),
      cost: costScore(t, spec),
      reputation: reputationScore(t),
    };
    const failsMustHave = t.mustHaves.some((j) => j.status === "no");
    const weighted =
      parts.fit * w.fit + parts.health * w.health + parts.ease * w.ease + parts.cost * w.cost + parts.reputation * w.reputation;
    const round = (n: number) => Math.round(n * 100) / 100;
    return {
      id: t.id,
      name: t.name,
      url: t.url,
      total: round(failsMustHave ? weighted * 0.5 : weighted),
      breakdown: {
        fit: round(parts.fit),
        health: round(parts.health),
        ease: round(parts.ease),
        cost: round(parts.cost),
        reputation: round(parts.reputation),
      },
      failsMustHave,
      unknownMustHaves: t.mustHaves.filter((j) => j.status === "unknown").length,
    };
  });
  return ranked.sort((a, b) => Number(a.failsMustHave) - Number(b.failsMustHave) || b.total - a.total);
}
