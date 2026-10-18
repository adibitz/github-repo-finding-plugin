import { TTL } from "../config.js";
import { canonicalRepoId, normalizeName } from "../core/merge.js";
import { cleanText } from "../core/text.js";
import type { Candidate } from "../core/types.js";
import { getDepsDevProject } from "../sources/enrich.js";
import { getCodebergRepo, getGitlabProject } from "../sources/forges.js";
import { getGithubRepo, githubHeaders, parseGithubId, publicOnly, repoToCandidate, type GhRepo } from "../sources/github.js";
import type { SourceContext } from "../sources/types.js";
import { parsePackageUrl } from "./details.js";
import { extractCodeLinks, fetchPublicPage } from "./docs.js";
import type { Resolver } from "./safe-url.js";

export type VerifyStatus = "verified" | "website-only" | "possible-matches" | "not-found";

export interface VerifyResult {
  status: VerifyStatus;
  /** What the AI may safely say about the lead. */
  summary: string;
  candidate?: Candidate;
  matches?: Candidate[];
}

async function verifyRepo(ctx: SourceContext, repoId: string): Promise<Candidate | undefined> {
  if (repoId.startsWith("github.com/")) {
    const deps = await getDepsDevProject(ctx, repoId);
    if (deps) {
      const gh = parseGithubId(repoId)!;
      return {
        id: repoId,
        name: gh.repo,
        description: cleanText(deps.description, 300),
        url: `https://${repoId}`,
        repoUrl: `https://${repoId}`,
        homepage: deps.homepage,
        kind: "repo",
        sources: ["verify"],
        stars: deps.starsCount,
        forks: deps.forksCount,
        license: deps.license,
      };
    }
    const gh = parseGithubId(repoId)!;
    const repo = await getGithubRepo(ctx, gh.owner, gh.repo);
    return repo ? repoToCandidate(repo, "verify") : undefined;
  }
  const path = repoId.split("/").slice(1).join("/");
  if (repoId.startsWith("gitlab.com/")) {
    const p = await getGitlabProject(ctx, path);
    return p
      ? { id: repoId, name: p.name, description: cleanText(p.description, 300), url: p.web_url, repoUrl: p.web_url, kind: "repo", sources: ["verify"], stars: p.star_count, lastActivity: p.last_activity_at }
      : undefined;
  }
  if (repoId.startsWith("codeberg.org/")) {
    const r = await getCodebergRepo(ctx, path);
    return r
      ? { id: repoId, name: r.name, description: cleanText(r.description, 300), url: r.html_url, repoUrl: r.html_url, kind: "repo", sources: ["verify"], stars: r.stars_count, lastActivity: r.updated_at, archived: r.archived }
      : undefined;
  }
  return undefined;
}

async function searchByName(ctx: SourceContext, name: string): Promise<Candidate[]> {
  const q = `${name} in:name archived:false`;
  const res = await ctx.http.json<{ items: GhRepo[] }>(`https://api.github.com/search/repositories?q=${encodeURIComponent(q)}&sort=stars&per_page=5`, {
    headers: githubHeaders(ctx.config),
    ttlMs: TTL.search,
  });
  const wanted = normalizeName(name);
  const items = publicOnly(res?.items ?? []).map((r) => repoToCandidate(r, "verify"));
  // Exact name matches first; they are the likely answer.
  return items.sort((a, b) => Number(normalizeName(b.name) === wanted) - Number(normalizeName(a.name) === wanted));
}

/**
 * Check a lead from web search, a blog or a forum against a primary source. Only verified
 * tools may be recommended; everything else must be presented as unconfirmed.
 */
export async function verifyLead(ctx: SourceContext, input: { url?: string; name?: string }, resolve?: Resolver): Promise<VerifyResult> {
  if (input.url) {
    const repoId = canonicalRepoId(input.url);
    if (repoId) {
      const candidate = await verifyRepo(ctx, repoId);
      return candidate
        ? { status: "verified", summary: `The repository ${repoId} exists.`, candidate }
        : { status: "not-found", summary: `No public repository found at ${repoId}. Don't recommend it.` };
    }
    const pkg = parsePackageUrl(input.url);
    if (pkg) {
      const registry =
        pkg.ecosystem === "npm"
          ? `https://registry.npmjs.org/${pkg.name.replace("/", "%2F")}`
          : pkg.ecosystem === "pypi"
            ? `https://pypi.org/pypi/${encodeURIComponent(pkg.name)}/json`
            : `https://crates.io/api/v1/crates/${encodeURIComponent(pkg.name)}`;
      const found = await ctx.http.json<unknown>(registry, { ttlMs: TTL.details, allow404: true });
      return found
        ? { status: "verified", summary: `The ${pkg.ecosystem} package ${pkg.name} exists.`, candidate: { id: `${pkg.ecosystem}:${pkg.name}`, name: pkg.name, description: "", url: input.url, kind: "package", sources: ["verify"] } }
        : { status: "not-found", summary: `No ${pkg.ecosystem} package named ${pkg.name}. Don't recommend it.` };
    }
    const page = await fetchPublicPage(ctx, input.url, resolve).catch(() => undefined);
    if (!page) return { status: "not-found", summary: "The website could not be reached. Don't recommend it." };
    for (const link of extractCodeLinks(page.html).slice(0, 3)) {
      const id = canonicalRepoId(link);
      const candidate = id ? await verifyRepo(ctx, id) : undefined;
      if (candidate) {
        return { status: "verified", summary: `The website is live and links to its source code at ${id}.`, candidate: { ...candidate, homepage: page.finalUrl } };
      }
    }
    return {
      status: "website-only",
      summary: "The website is live, but no public source code was found. Treat it as a hosted or closed-source product and say so.",
    };
  }
  if (input.name) {
    const matches = await searchByName(ctx, input.name);
    if (matches.length === 0) return { status: "not-found", summary: `No repository named "${input.name}" found.` };
    return { status: "possible-matches", summary: "Repositories with a similar name. Pick the one that matches the lead's description before recommending it.", matches };
  }
  return { status: "not-found", summary: "Give a url or a name to verify." };
}
