import { TTL } from "../config.js";
import { textQueries } from "../core/queries.js";
import { cleanText, isoMonthsAgo } from "../core/text.js";
import type { Candidate } from "../core/types.js";
import { mapLimit } from "./http.js";
import { modeMatches, type SearchSource, type SourceContext } from "./types.js";

interface GitLabProject {
  id: number;
  name: string;
  description: string | null;
  path_with_namespace: string;
  web_url: string;
  star_count: number;
  forks_count: number;
  last_activity_at: string;
  topics?: string[];
}

interface ForgejoRepo {
  full_name: string;
  name: string;
  description: string;
  html_url: string;
  website: string;
  stars_count: number;
  forks_count: number;
  open_issues_count: number;
  updated_at: string;
  archived: boolean;
  fork: boolean;
  mirror: boolean;
  language: string;
  topics?: string[];
  licenses?: string[];
  default_branch?: string;
}

export function gitlabToCandidate(p: GitLabProject): Candidate {
  return {
    id: `gitlab.com/${p.path_with_namespace.toLowerCase()}`,
    name: p.name,
    description: cleanText(p.description, 300),
    url: p.web_url,
    repoUrl: p.web_url,
    kind: "repo",
    sources: ["gitlab"],
    stars: p.star_count,
    forks: p.forks_count,
    lastActivity: p.last_activity_at,
    topics: p.topics ?? [],
  };
}

export function forgejoToCandidate(r: ForgejoRepo, source: string, host: string): Candidate {
  return {
    id: `${host}/${r.full_name.toLowerCase()}`,
    name: r.name,
    description: cleanText(r.description, 300),
    url: r.html_url,
    repoUrl: r.html_url,
    homepage: r.website || undefined,
    kind: "repo",
    sources: [source],
    stars: r.stars_count,
    forks: r.forks_count,
    lastActivity: r.updated_at,
    archived: r.archived,
    // Mirrors of GitHub projects are copies too; the original will be found on GitHub.
    fork: r.fork || r.mirror,
    language: r.language || undefined,
    topics: r.topics ?? [],
    license: r.licenses?.[0],
  };
}

const forgeModes = ["app", "library", "code", "any"] as const;

export const gitlabSource: SearchSource = {
  id: "gitlab",
  name: "GitLab",
  tier: 2,
  modes: forgeModes,
  description: "Public projects hosted on GitLab.com.",
  homepage: "https://gitlab.com/explore",
  access: "Free, no key needed.",
  appliesTo: (spec) => modeMatches(spec, forgeModes),
  async search(spec, ctx) {
    const since = isoMonthsAgo(spec.activeWithinMonths, ctx.now);
    const pages = await mapLimit(textQueries(spec, 3), 3, (q) =>
      ctx.http.json<GitLabProject[]>(
        `https://gitlab.com/api/v4/projects?search=${encodeURIComponent(q)}&order_by=star_count&sort=desc&per_page=10&last_activity_after=${since}`,
        { ttlMs: TTL.search },
      ),
    );
    return pages.flatMap((p) => (p ?? []).map(gitlabToCandidate));
  },
};

export const codebergSource: SearchSource = {
  id: "codeberg",
  name: "Codeberg",
  tier: 2,
  modes: forgeModes,
  description: "Community-run, non-profit code hosting (Forgejo).",
  homepage: "https://codeberg.org/explore/repos",
  access: "Free, no key needed.",
  appliesTo: (spec) => modeMatches(spec, forgeModes),
  async search(spec, ctx) {
    const pages = await mapLimit(textQueries(spec, 3), 3, (q) =>
      ctx.http.json<{ data: ForgejoRepo[] }>(
        `https://codeberg.org/api/v1/repos/search?q=${encodeURIComponent(q)}&sort=stars&order=desc&limit=10`,
        { ttlMs: TTL.search },
      ),
    );
    return pages.flatMap((p) => (p?.data ?? []).map((r) => forgejoToCandidate(r, "codeberg", "codeberg.org")));
  },
};

export async function getGitlabProject(ctx: SourceContext, path: string): Promise<(GitLabProject & { license?: { key: string } | null }) | undefined> {
  return ctx.http.json(`https://gitlab.com/api/v4/projects/${encodeURIComponent(path)}?license=true`, { ttlMs: TTL.details, allow404: true });
}

export async function getCodebergRepo(ctx: SourceContext, path: string): Promise<ForgejoRepo | undefined> {
  return ctx.http.json(`https://codeberg.org/api/v1/repos/${path}`, { ttlMs: TTL.details, allow404: true });
}
