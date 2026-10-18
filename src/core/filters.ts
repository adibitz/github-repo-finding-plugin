import { classifyLicense, licenseAllowed } from "./license.js";
import { effectiveMinStars, type Spec } from "./spec.js";
import { monthsSince } from "./text.js";
import type { Candidate } from "./types.js";

export interface Rejection {
  id: string;
  name: string;
  reason: string;
}

export interface FilterResult {
  kept: Candidate[];
  rejected: Rejection[];
}

/** First rule this candidate breaks, or undefined when it passes. Unknown facts never reject. */
export function rejectionReason(c: Candidate, spec: Spec, now: Date): string | undefined {
  if (c.archived) return "Discontinued (archived by its authors)";
  if (c.fork) return "A copy (fork) of another project";
  const age = monthsSince(c.lastActivity, now);
  if (age !== undefined && age > spec.activeWithinMonths) {
    return `Not updated in ${Math.round(age)} months (limit ${spec.activeWithinMonths})`;
  }
  if (c.kind === "repo" && c.stars !== undefined && c.stars < effectiveMinStars(spec)) {
    return `Too few users yet (${c.stars} stars, minimum ${effectiveMinStars(spec)})`;
  }
  if (c.license !== undefined && spec.licenses.length > 0 && !licenseAllowed(c.license, spec.licenses)) {
    return `License ${c.license} is not in the allowed list`;
  }
  if (spec.openSourceOnly && c.license !== undefined) {
    const category = classifyLicense(c.license).category;
    if (category === "proprietary") return "Closed-source (proprietary)";
    if (category === "source-available") return `Not fully open source (${c.license} license limits some uses)`;
  }
  if (spec.platforms.length > 0 && c.platforms && c.platforms.length > 0) {
    const wanted = new Set(spec.platforms);
    if (!c.platforms.some((p) => wanted.has(p))) return `Doesn't run on ${spec.platforms.join(" / ")}`;
  }
  return undefined;
}

/** Split candidates into those that meet the hard requirements and those that don't (with reasons). */
export function applyHardFilters(candidates: Candidate[], spec: Spec, now: Date): FilterResult {
  const kept: Candidate[] = [];
  const rejected: Rejection[] = [];
  for (const c of candidates) {
    const reason = rejectionReason(c, spec, now);
    if (reason) rejected.push({ id: c.id, name: c.name, reason });
    else kept.push(c);
  }
  return { kept, rejected };
}
