import { TTL, type Config } from "../config.js";
import { githubRepoQueries, textQueries } from "../core/queries.js";
import { cleanText } from "../core/text.js";
import type { Candidate } from "../core/types.js";
import { mapLimit } from "./http.js";
import type { SearchSource, SourceContext } from "./types.js";

const API = "https://api.github.com";
const RAW = "https://raw.githubusercontent.com";

export interface GhRepo {
  full_name: string;
  name: string;
  description: string | null;
  html_url: string;
  homepage: string | null;
  stargazers_count: number;
  forks_count: number;
  open_issues_count: number;
  license: { spdx_id: string | null } | null;
  language: string | null;
  topics?: string[];
  pushed_at: string;
  archived: boolean;
  fork: boolean;
  default_branch: string;
  private?: boolean;
}

/**
 * With a token, GitHub also returns private repos the token can see. This tool only ever
 * deals with public software, so private repos are dropped everywhere to avoid leaking them.
 */
export function publicOnly<T extends { private?: boolean }>(items: T[]): T[] {
  return items.filter((r) => r.private !== true);
}

interface GhSearch<T> {
  total_count: number;
  items: T[];
}

interface GhCodeHit {
  repository: { full_name: string; html_url: string; description: string | null; private?: boolean };
}

interface GhRelease {
  published_at: string | null;
  tag_name: string;
  assets: { name: string; download_count: number }[];
}

export function githubHeaders(config: Config): Record<string, string> {
  const h: Record<string, string> = { Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" };
  if (config.githubToken) h.Authorization = `Bearer ${config.githubToken}`;
  return h;
}

export function repoToCandidate(r: GhRepo, source = "github"): Candidate {
  const spdx = r.license?.spdx_id ?? undefined;
  return {
    id: `github.com/${r.full_name.toLowerCase()}`,
    name: r.name,
    description: cleanText(r.description, 300),
    url: r.html_url,
    repoUrl: r.html_url,
    homepage: r.homepage || undefined,
    kind: "repo",
    sources: [source],
    stars: r.stargazers_count,
    forks: r.forks_count,
    license: spdx && spdx !== "NOASSERTION" ? spdx : r.license ? "NOASSERTION" : undefined,
    language: r.language ?? undefined,
    topics: r.topics ?? [],
    lastActivity: r.pushed_at,
    archived: r.archived,
    fork: r.fork,
  };
}

/** Split "https://github.com/owner/repo" or "github.com/owner/repo" into parts. */
export function parseGithubId(idOrUrl: string): { owner: string; repo: string } | undefined {
  const m = /github\.com\/([^/\s]+)\/([^/\s#?]+)/i.exec(idOrUrl);
  if (!m || !m[1] || !m[2]) return undefined;
  return { owner: m[1], repo: m[2].replace(/\.git$/i, "") };
}

export const githubSource: SearchSource = {
  id: "github",
  name: "GitHub",
  tier: 1,
  modes: ["app", "library", "extension", "ai", "code", "any"],
  description: "Repository search across all public GitHub projects.",
  homepage: "https://github.com/search",
  access: "Works without a key (10 searches/min, 60 calls/hour). A GITHUB_TOKEN raises this to 30 searches/min and 5,000 calls/hour.",
  appliesTo: () => true,
  async search(spec, ctx) {
    if (spec.mode === "code") return searchCode(spec, ctx);
    const budget = ctx.config.githubToken ? 6 : 3;
    const perPage = ctx.config.githubToken ? 25 : 15;
    const queries = githubRepoQueries(spec, ctx.now, budget);
    const pages = await mapLimit(queries, 2, ({ q, sort }) =>
      ctx.http.json<GhSearch<GhRepo>>(`${API}/search/repositories?q=${encodeURIComponent(q)}&per_page=${perPage}${sort ? `&sort=${sort}` : ""}`, {
        headers: githubHeaders(ctx.config),
        ttlMs: TTL.search,
      }),
    );
    return pages.flatMap((p) => publicOnly(p?.items ?? []).map((r) => repoToCandidate(r)));
  },
};

/** Code search finds repos that contain matching code. GitHub only allows it with a token. */
async function searchCode(spec: Parameters<SearchSource["search"]>[0], ctx: SourceContext): Promise<Candidate[]> {
  if (!ctx.config.githubToken) {
    throw new Error("GitHub code search needs a GITHUB_TOKEN. Falling back to repository search is recommended.");
  }
  const lang = spec.languages[0] ? ` language:"${spec.languages[0]}"` : "";
  const queries = textQueries(spec, 3).map((q) => `${q}${lang}`);
  const pages = await mapLimit(queries, 2, (q) =>
    ctx.http.json<GhSearch<GhCodeHit>>(`${API}/search/code?q=${encodeURIComponent(q)}&per_page=30`, {
      headers: githubHeaders(ctx.config),
      ttlMs: TTL.search,
    }),
  );
  const seen = new Map<string, Candidate>();
  for (const hit of pages.flatMap((p) => p?.items ?? [])) {
    const r = hit.repository;
    if (r.private === true || seen.has(r.full_name)) continue;
    seen.set(r.full_name, {
      id: `github.com/${r.full_name.toLowerCase()}`,
      name: r.full_name.split("/")[1] ?? r.full_name,
      description: cleanText(r.description, 300),
      url: r.html_url,
      repoUrl: r.html_url,
      kind: "repo",
      sources: ["github-code"],
    });
  }
  return [...seen.values()];
}

/** Repo metadata, telling "private" apart from "missing" so callers can discard related data. */
export async function getGithubRepoVisibility(ctx: SourceContext, owner: string, repo: string): Promise<{ repo?: GhRepo; isPrivate: boolean }> {
  const r = await ctx.http.json<GhRepo>(`${API}/repos/${owner}/${repo}`, { headers: githubHeaders(ctx.config), ttlMs: TTL.details, allow404: true });
  return r?.private === true ? { isPrivate: true } : { repo: r, isPrivate: false };
}

/** Public repo metadata. A private repo the token happens to see is reported as not found. */
export async function getGithubRepo(ctx: SourceContext, owner: string, repo: string): Promise<GhRepo | undefined> {
  return (await getGithubRepoVisibility(ctx, owner, repo)).repo;
}

export async function getLatestRelease(
  ctx: SourceContext,
  owner: string,
  repo: string,
): Promise<{ publishedAt?: string; tag: string; assets: string[] } | undefined> {
  const r = await ctx.http.json<GhRelease>(`${API}/repos/${owner}/${repo}/releases/latest`, {
    headers: githubHeaders(ctx.config),
    ttlMs: TTL.details,
    allow404: true,
  });
  if (!r) return undefined;
  return { publishedAt: r.published_at ?? undefined, tag: r.tag_name, assets: r.assets.map((a) => a.name) };
}

/**
 * Contributor count from the "last page" link with one item per page. Costs one API call,
 * so it is only used when a token is available.
 */
export async function getContributorCount(ctx: SourceContext, owner: string, repo: string): Promise<number | undefined> {
  if (!ctx.config.githubToken) return undefined;
  const url = `${API}/repos/${owner}/${repo}/contributors?per_page=1&anon=true`;
  return ctx.http.read(url, { headers: githubHeaders(ctx.config), ttlMs: TTL.details, allow404: true }, async (res) => {
    const m = /[?&]page=(\d+)>;\s*rel="last"/.exec(res.headers.get("link") ?? "");
    if (m?.[1]) return Number(m[1]);
    const body = (await res.json()) as unknown[];
    return body.length;
  });
}

const README_NAMES = ["README.md", "readme.md", "README.rst", "README", "Readme.md", "README.markdown"];

/**
 * README text. Tries raw.githubusercontent.com first because it doesn't use the API quota,
 * then falls back to the API when a token is available.
 */
export async function getGithubReadme(ctx: SourceContext, owner: string, repo: string): Promise<string | undefined> {
  for (const name of README_NAMES) {
    const text = await ctx.http.text(`${RAW}/${owner}/${repo}/HEAD/${name}`, { ttlMs: TTL.details, allow404: true, headers: { Accept: "text/plain" } });
    if (text) return text;
  }
  if (!ctx.config.githubToken) return undefined;
  // Deliberately unauthenticated: a token could otherwise read a private repo's README.
  return ctx.http.text(`${API}/repos/${owner}/${repo}/readme`, {
    headers: { Accept: "application/vnd.github.raw+json", "X-GitHub-Api-Version": "2022-11-28" },
    ttlMs: TTL.details,
    allow404: true,
  });
}

/** Whether a file exists at the repo root, checked via raw content (no API quota). */
export async function githubFileExists(ctx: SourceContext, owner: string, repo: string, path: string): Promise<boolean> {
  return ctx.http.exists(`${RAW}/${owner}/${repo}/HEAD/${path}`, { ttlMs: TTL.details });
}
