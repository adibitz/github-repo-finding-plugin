import { applyHardFilters, type Rejection } from "../core/filters.js";
import { mergeCandidates, mergeListingsByName } from "../core/merge.js";
import { prelimScore } from "../core/score.js";
import type { Spec } from "../core/spec.js";
import { relevanceScore } from "../core/text.js";
import type { Candidate, SourceWarning } from "../core/types.js";
import { errorMessage } from "../sources/http.js";
import { selectSources, WEB_SEARCH_ONLY } from "../sources/registry.js";
import type { SourceContext } from "../sources/types.js";

export interface SourceRun {
  id: string;
  found: number;
  ms: number;
  ok: boolean;
}

export interface SearchResult {
  checkedAt: string;
  candidates: Candidate[];
  totalFound: number;
  rejected: Rejection[];
  sourcesUsed: SourceRun[];
  warnings: SourceWarning[];
  notes: string[];
}

/** Candidates below this keyword match are noise from broad searches. */
const MIN_RELEVANCE = 0.1;

/**
 * Ask every relevant source in parallel, merge duplicates, drop what breaks hard requirements,
 * and pre-rank the rest. One source failing never fails the search; it becomes a warning.
 */
export async function searchTools(spec: Spec, ctx: SourceContext, only?: string[]): Promise<SearchResult> {
  const sources = selectSources(spec, ctx.config, only);
  const runs = await Promise.allSettled(
    sources.map(async (s) => {
      const started = Date.now();
      const found = await s.search(spec, ctx);
      return { id: s.id, found, ms: Date.now() - started };
    }),
  );

  const all: Candidate[] = [];
  const sourcesUsed: SourceRun[] = [];
  const warnings: SourceWarning[] = [];
  runs.forEach((r, i) => {
    const id = sources[i]?.id ?? "unknown";
    if (r.status === "fulfilled") {
      // Keep each source's own ordering as a signal: its first result gets 1, its last ~0.
      const n = r.value.found.length;
      all.push(...r.value.found.map((c, pos) => ({ ...c, sourceRank: n > 1 ? 1 - pos / (n - 1) : 1 })));
      sourcesUsed.push({ id, found: r.value.found.length, ms: r.value.ms, ok: true });
    } else {
      sourcesUsed.push({ id, found: 0, ms: 0, ok: false });
      warnings.push({ source: id, message: errorMessage(r.reason) });
    }
  });

  const terms = [...spec.keywords, ...spec.alternativeTo.map((a) => `${a} alternative`)];
  const merged = mergeListingsByName(mergeCandidates(all)).map((c) => {
    const base = relevanceScore(terms, c.name, c.description, c.topics);
    const penalty = spec.mode === "app" && looksLikeLibrary(c) ? 0.5 : 1;
    return { ...c, relevance: Math.round(base * penalty * 100) / 100 };
  });
  // Curated sources already matched the request themselves, so keep their picks even with a weak text match.
  const relevant = merged.filter((c) => (c.relevance ?? 0) >= MIN_RELEVANCE || c.sources.some((s) => s.startsWith("awesome") || s === "yunohost"));
  const { kept, rejected } = applyHardFilters(relevant, spec, ctx.now);
  const ranked = kept
    .map((c) => ({ ...c, prelimScore: Math.round(prelimScore(c, ctx.now, spec.mode) * 100) / 100 }))
    .sort((a, b) => (b.prelimScore ?? 0) - (a.prelimScore ?? 0));

  return {
    checkedAt: ctx.now.toISOString().slice(0, 10),
    candidates: ranked.slice(0, spec.maxResults),
    totalFound: merged.length,
    rejected: rejected.slice(0, 15),
    sourcesUsed,
    warnings,
    notes: buildNotes(ctx, warnings, ranked.length),
  };
}

const LIBRARY_WORDS = /\b(library|sdk|framework|bindings?|wrapper|api client|toolkit|package for|module for)\b/i;

/** Someone asking for an app wants something to use, not a building block for programmers. */
export function looksLikeLibrary(c: Candidate): boolean {
  if (c.kind === "package") return true;
  return LIBRARY_WORDS.test(c.description) || (c.topics ?? []).some((t) => /^(library|sdk|framework|python-library|java-library|dotnet-library)$/i.test(t));
}

function buildNotes(ctx: SourceContext, warnings: SourceWarning[], kept: number): string[] {
  const notes: string[] = [];
  if (!ctx.config.githubToken) {
    notes.push("No GITHUB_TOKEN set: GitHub searches are limited (10/min, 60 calls/hour). Results may be thinner; suggest adding a token if searches fail.");
  }
  if (warnings.some((w) => w.message.includes("Rate limit"))) {
    const quota = ctx.http.lastGithubQuota;
    notes.push(`A source hit its rate limit${quota.resetAt ? ` (GitHub resets at ${quota.resetAt.toISOString().slice(11, 16)} UTC)` : ""}. Retry later or rely on the other sources.`);
  }
  if (kept < 3) {
    notes.push("Few matches. Try broader or different keywords, remove a filter, or use your web search for leads and check them with verify_lead.");
  }
  notes.push(`Not searched by this server (use your own web search, then verify_lead): ${WEB_SEARCH_ONLY.map((w) => w.name).join(", ")}.`);
  return notes;
}

