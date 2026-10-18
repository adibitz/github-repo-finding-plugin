import { TTL } from "../config.js";
import { sharesTerms } from "../core/text.js";
import type { SourceContext } from "./types.js";

// ---------- deps.dev: repo stats + OpenSSF Scorecard without using GitHub quota ----------

export interface DepsDevProject {
  starsCount?: number;
  forksCount?: number;
  openIssuesCount?: number;
  license?: string;
  description?: string;
  homepage?: string;
  scorecard?: { date?: string; overallScore?: number };
}

/** `repoId` is a canonical "github.com/owner/repo" (also works for gitlab.com and bitbucket.org). */
export async function getDepsDevProject(ctx: SourceContext, repoId: string): Promise<DepsDevProject | undefined> {
  return ctx.http.json<DepsDevProject>(`https://api.deps.dev/v3/projects/${encodeURIComponent(repoId)}`, {
    ttlMs: TTL.details,
    allow404: true,
  });
}

// ---------- OpenSSF Scorecard (fallback when deps.dev has no score) ----------

export async function getScorecard(ctx: SourceContext, repoId: string): Promise<number | undefined> {
  if (!repoId.startsWith("github.com/")) return undefined;
  const res = await ctx.http.json<{ score?: number }>(`https://api.securityscorecards.dev/projects/${repoId}`, {
    ttlMs: TTL.details,
    allow404: true,
  });
  return res?.score;
}

// ---------- OSV: known vulnerabilities of a package ----------

const OSV_ECOSYSTEM: Record<string, string> = {
  npm: "npm",
  pypi: "PyPI",
  crates: "crates.io",
  cargo: "crates.io",
  maven: "Maven",
  nuget: "NuGet",
  packagist: "Packagist",
  rubygems: "RubyGems",
  go: "Go",
};

/** Number of published vulnerabilities for a package (all versions). Undefined if the ecosystem isn't covered. */
export async function getVulnerabilityCount(ctx: SourceContext, ecosystem: string, name: string): Promise<number | undefined> {
  const eco = OSV_ECOSYSTEM[ecosystem.toLowerCase()];
  if (!eco) return undefined;
  const res = await ctx.http.json<{ vulns?: unknown[] }>("https://api.osv.dev/v1/query", {
    body: { package: { name, ecosystem: eco } },
    ttlMs: TTL.details,
  });
  return res?.vulns?.length ?? 0;
}

// ---------- Repology: where a project is packaged (app stores, distros) ----------

interface RepologyPackage {
  repo: string;
  srcname?: string;
  visiblename?: string;
  status?: string;
  summary?: string;
}

/** Names this long rarely collide; shorter ones ("notes", "screen") often belong to other projects. */
const DISTINCTIVE_NAME_LENGTH = 8;

/**
 * Repology matches by project name only, so a short generic name can pick up another project's
 * packages. Accept a match only when a package summary shares a word with the tool's own
 * description, or, when there's nothing to compare, the name is distinctive.
 */
export function repologyMatches(pkgs: RepologyPackage[], name: string, description: string | undefined): boolean {
  const summaries = pkgs.map((p) => p.summary ?? "").filter(Boolean);
  if (description && summaries.length > 0) return summaries.some((s) => sharesTerms(s, description));
  return name.replace(/[^a-z0-9]/gi, "").length >= DISTINCTIVE_NAME_LENGTH;
}

/** Repology project names are lower-case with dashes, e.g. "invoice-ninja" or "invoiceninja". */
export function repologyNames(name: string): string[] {
  const base = name.toLowerCase().trim();
  return [...new Set([base.replace(/[\s_.]+/g, "-"), base.replace(/[\s_.-]+/g, "")])].filter((n) => /^[a-z0-9][a-z0-9+-]*$/.test(n));
}

/** Package repositories (e.g. "winget", "homebrew_casks", "flathub", "debian_12") that ship this project. */
export async function getPackagedIn(ctx: SourceContext, name: string, description?: string): Promise<string[]> {
  for (const candidate of repologyNames(name)) {
    const pkgs = await ctx.http.json<RepologyPackage[]>(`https://repology.org/api/v1/project/${encodeURIComponent(candidate)}`, {
      ttlMs: TTL.catalog,
      allow404: true,
    });
    if (pkgs && pkgs.length > 0) return repologyMatches(pkgs, name, description) ? [...new Set(pkgs.map((p) => p.repo))] : [];
  }
  return [];
}

// ---------- awesome.ecosyste.ms: how many curated lists include a repo ----------

interface AwesomeProject {
  lists_url?: string;
}

export async function getAwesomeListCount(ctx: SourceContext, repoUrl: string): Promise<number | undefined> {
  const project = await ctx.http.json<AwesomeProject>(`https://awesome.ecosyste.ms/api/v1/projects/lookup?url=${encodeURIComponent(repoUrl)}`, {
    ttlMs: TTL.catalog,
    allow404: true,
  });
  if (!project?.lists_url) return project ? 0 : undefined;
  const lists = await ctx.http.json<unknown[]>(`${project.lists_url}?per_page=100`, { ttlMs: TTL.catalog, allow404: true });
  return lists?.length;
}
