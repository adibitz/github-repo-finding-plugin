import { humanAgo, monthsSince } from "./text.js";
import type { PlainSignal } from "./types.js";

export interface HealthFacts {
  archived?: boolean;
  lastActivity?: string;
  latestRelease?: string;
  stars?: number;
  forks?: number;
  contributors?: number;
  openIssues?: number;
  /** OpenSSF Scorecard 0..10. */
  scorecard?: number;
  knownVulnerabilities?: number;
  /** Number of curated "awesome" lists that include the tool. */
  awesomeLists?: number;
  /** Number of package repositories (distros, app stores) that ship it. */
  packagedIn?: number;
}

export type HealthStatus = "active" | "slowing" | "stale" | "discontinued" | "unknown";

export interface HealthAssessment {
  status: HealthStatus;
  /** 0..1, higher is healthier. */
  score: number;
  signals: PlainSignal[];
  /** Warnings worth showing even to everyday users. */
  redFlags: string[];
}

const STATUS_TEXT: Record<HealthStatus, string> = {
  active: "Actively maintained",
  slowing: "Updates are slowing down",
  stale: "Rarely updated: may be abandoned",
  discontinued: "Discontinued by its authors",
  unknown: "Maintenance status unknown",
};

/** Turn raw project facts into a health status, a 0..1 score and plain-language signals. */
export function assessHealth(f: HealthFacts, now: Date): HealthAssessment {
  const signals: PlainSignal[] = [];
  const redFlags: string[] = [];
  const age = monthsSince(f.lastActivity, now);
  const ago = humanAgo(f.lastActivity, now);

  let status: HealthStatus;
  if (f.archived) status = "discontinued";
  else if (age === undefined) status = "unknown";
  else if (age <= 3) status = "active";
  else if (age <= 12) status = "slowing";
  else status = "stale";

  const statusTone = { active: "good", slowing: "ok", stale: "warn", discontinued: "bad", unknown: "ok" } as const;
  signals.push({ tone: statusTone[status], text: ago ? `${STATUS_TEXT[status]} (last update ${ago})` : STATUS_TEXT[status] });
  if (status === "discontinued") redFlags.push("Discontinued: no more updates or security fixes");
  if (status === "stale") redFlags.push("Not updated for over a year");

  const releaseAgo = humanAgo(f.latestRelease, now);
  if (releaseAgo) signals.push({ tone: (monthsSince(f.latestRelease, now) ?? 99) <= 6 ? "good" : "ok", text: `Latest release ${releaseAgo}` });

  if (f.contributors !== undefined) {
    if (f.contributors >= 20) signals.push({ tone: "good", text: `Large team behind it (${f.contributors}+ contributors)` });
    else if (f.contributors >= 4) signals.push({ tone: "ok", text: `Small team (${f.contributors} contributors)` });
    else {
      signals.push({ tone: "warn", text: `Depends on ${f.contributors <= 1 ? "one person" : "very few people"}` });
      redFlags.push("Depends on very few people, so it could stop if they leave");
    }
  }

  if (f.stars !== undefined) {
    const tone = f.stars >= 1000 ? "good" : f.stars >= 100 ? "ok" : "warn";
    signals.push({ tone, text: `Popularity: ${f.stars.toLocaleString("en-US")} stars` });
  }

  if (f.scorecard !== undefined) {
    const tone = f.scorecard >= 7 ? "good" : f.scorecard >= 4 ? "ok" : "warn";
    signals.push({ tone, text: `Security practices score ${f.scorecard.toFixed(1)}/10 (OpenSSF)` });
  }
  if (f.knownVulnerabilities !== undefined) {
    if (f.knownVulnerabilities === 0) signals.push({ tone: "good", text: "No known security problems" });
    else {
      signals.push({ tone: "warn", text: `${f.knownVulnerabilities} known security issue(s) on record. Use the latest version` });
    }
  }
  if (f.awesomeLists !== undefined && f.awesomeLists > 0) {
    signals.push({ tone: "good", text: `Recommended in ${f.awesomeLists} curated list(s)` });
  }
  if (f.packagedIn !== undefined && f.packagedIn > 0) {
    signals.push({ tone: "good", text: `Available from ${f.packagedIn} app stores / package sources` });
  }

  if (looksInflated(f)) {
    redFlags.push("Popularity may be inflated: many stars but very little real activity");
    signals.push({ tone: "warn", text: "Star count looks unusually high for its activity" });
  }

  return { status, score: healthScore(f, status, age), signals, redFlags };
}

/** Many stars with almost no forks or contributors is a common sign of bought or viral-only stars. */
export function looksInflated(f: HealthFacts): boolean {
  if (f.stars === undefined || f.stars < 1000) return false;
  const forkRatio = f.forks !== undefined ? f.forks / f.stars : undefined;
  const fewForks = forkRatio !== undefined && forkRatio < 0.01;
  const fewPeople = f.contributors !== undefined && f.contributors <= 2;
  return fewForks && fewPeople;
}

function healthScore(f: HealthFacts, status: HealthStatus, age: number | undefined): number {
  if (status === "discontinued") return 0;
  const parts: { value: number; weight: number }[] = [];
  if (age !== undefined) parts.push({ value: age <= 1 ? 1 : age <= 3 ? 0.9 : age <= 6 ? 0.75 : age <= 12 ? 0.5 : 0.15, weight: 3 });
  if (f.contributors !== undefined) parts.push({ value: Math.min(1, Math.log10(f.contributors + 1) / Math.log10(51)), weight: 2 });
  if (f.stars !== undefined) parts.push({ value: Math.min(1, Math.log10(f.stars + 1) / 4.5), weight: 1 });
  if (f.scorecard !== undefined) parts.push({ value: f.scorecard / 10, weight: 1 });
  if (f.knownVulnerabilities !== undefined) parts.push({ value: f.knownVulnerabilities === 0 ? 1 : 0.5, weight: 0.5 });
  if (parts.length === 0) return 0.4;
  const total = parts.reduce((s, p) => s + p.value * p.weight, 0) / parts.reduce((s, p) => s + p.weight, 0);
  return looksInflated(f) ? total * 0.7 : total;
}
