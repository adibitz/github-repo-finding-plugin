import { TTL } from "../config.js";
import { canonicalRepoId } from "../core/merge.js";
import { relevanceScore } from "../core/text.js";
import { cleanText } from "../core/text.js";
import type { Candidate } from "../core/types.js";
import { githubHeaders, parseGithubId, publicOnly } from "./github.js";
import { mapLimit } from "./http.js";
import { modeMatches, type SearchSource, type SourceContext } from "./types.js";

export interface AwesomeEntry {
  name: string;
  url: string;
  description: string;
  category: string;
  sourceCode?: string;
  /** Backtick tags at the end of the line, e.g. ["MIT", "PHP/Docker"]. */
  tags: string[];
}

const ENTRY = /^\s*[-*]\s+\[([^\]]+)\]\(([^)\s]+)\)\s*(?:[-–—:]\s*)?(.*)$/;

/**
 * Parse an awesome-list README into entries. Works for awesome-selfhosted's
 * "- [Name](url) - Description. ([Source Code](url)) `License` `Language`" format and for the
 * simpler "- [Name](url) - Description" lines most awesome lists use.
 */
export function parseAwesomeMarkdown(markdown: string): AwesomeEntry[] {
  const entries: AwesomeEntry[] = [];
  let category = "";
  let inSoftware = true;
  for (const line of markdown.split(/\r?\n/)) {
    const heading = /^(#{2,4})\s+(.+?)\s*$/.exec(line);
    if (heading?.[2]) {
      category = heading[2].replace(/[*_`]/g, "");
      inSoftware = !/^(table of contents|contents|contributing|license|related|footnotes|external links)$/i.test(category);
      continue;
    }
    if (!inSoftware) continue;
    const m = ENTRY.exec(line);
    if (!m || !m[1] || !m[2]) continue;
    const rest = m[3] ?? "";
    if (!/^https?:\/\//i.test(m[2])) continue;
    const tags = [...rest.matchAll(/`([^`]+)`/g)].map((t) => t[1] ?? "").filter(Boolean);
    const source = /\[Source Code\]\(([^)\s]+)\)/i.exec(rest)?.[1];
    const description = rest
      .replace(/\s*\((?:\[[^\]]+\]\([^)]*\)(?:,\s*)?)+\)/g, "")
      .replace(/`[^`]+`/g, "")
      .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
      .replace(/[⚠️]/gu, "")
      .trim();
    entries.push({ name: m[1].replace(/[*_`]/g, ""), url: m[2], description: cleanText(description, 300), category, sourceCode: source, tags });
  }
  return entries;
}

export function awesomeEntryToCandidate(e: AwesomeEntry, source: string): Candidate {
  const repo = e.sourceCode && canonicalRepoId(e.sourceCode) ? e.sourceCode : canonicalRepoId(e.url) ? e.url : undefined;
  const license = e.tags.find((t) => /^[A-Za-z0-9.+-]+$/.test(t) && /\d|MIT|BSD|ISC|Unlicense|Zlib|WTFPL/i.test(t) && !/\//.test(t));
  const lang = e.tags.find((t) => t !== license);
  return {
    id: repo ? canonicalRepoId(repo)! : `${source}:${e.name.toLowerCase()}`,
    name: e.name,
    description: e.description,
    url: repo ?? e.url,
    repoUrl: repo,
    homepage: repo && e.url !== repo ? e.url : undefined,
    kind: repo ? "repo" : "app-listing",
    sources: [source],
    license,
    language: lang?.split("/")[0],
    topics: e.category ? [e.category] : [],
    platforms: source === "awesome-selfhosted" ? ["self-host"] : undefined,
  };
}

/** Entries whose name, description or category match the request, best first. */
export function matchEntries(entries: AwesomeEntry[], terms: string[], limit: number): AwesomeEntry[] {
  return entries
    .map((e) => ({ e, score: relevanceScore(terms, e.name, e.description, [e.category]) }))
    .filter((x) => x.score >= 0.34)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((x) => x.e);
}

const SELFHOSTED_README = "https://raw.githubusercontent.com/awesome-selfhosted/awesome-selfhosted/master/README.md";

export const awesomeSelfhostedSource: SearchSource = {
  id: "awesome-selfhosted",
  name: "awesome-selfhosted",
  tier: 1,
  modes: ["app", "any"],
  description: "Community-curated list of 1,000+ apps you can run on your own server.",
  homepage: "https://awesome-selfhosted.net",
  access: "Free open data (CC-BY-SA). Downloaded once a week and cached.",
  appliesTo: (spec) => modeMatches(spec, ["app"]) && (spec.platforms.length === 0 || spec.platforms.some((p) => p === "self-host" || p === "web")),
  async search(spec, ctx) {
    const md = await ctx.http.text(SELFHOSTED_README, { ttlMs: TTL.catalog, headers: { Accept: "text/plain" } });
    if (!md) return [];
    const terms = [...spec.keywords, ...spec.alternativeTo];
    return matchEntries(parseAwesomeMarkdown(md), terms, 15).map((e) => awesomeEntryToCandidate(e, "awesome-selfhosted"));
  },
};

interface GhListRepo {
  full_name: string;
  stargazers_count: number;
  default_branch: string;
  private?: boolean;
}

/**
 * Finds the most-starred "awesome-<topic>" list on GitHub and pulls matching entries from it.
 * Costs one GitHub search call; the list itself is fetched from raw content (no quota).
 */
export const awesomeListsSource: SearchSource = {
  id: "awesome-lists",
  name: "Awesome lists",
  tier: 2,
  modes: ["app", "library", "extension", "ai", "any"],
  description: "Community-curated 'awesome' lists for the topic, found on GitHub.",
  homepage: "https://github.com/topics/awesome",
  access: "Uses one GitHub search per request; list content is free.",
  appliesTo: (spec) => spec.mode !== "code",
  async search(spec, ctx) {
    const topic = spec.keywords[0];
    if (!topic) return [];
    const q = `awesome ${topic} in:name,description stars:>=100 archived:false`;
    const found = await ctx.http.json<{ items: GhListRepo[] }>(
      `https://api.github.com/search/repositories?q=${encodeURIComponent(q)}&sort=stars&per_page=3`,
      { headers: githubHeaders(ctx.config), ttlMs: TTL.catalog },
    );
    const lists = publicOnly(found?.items ?? []).filter((r) => /awesome/i.test(r.full_name)).slice(0, 2);
    const terms = [...spec.keywords, ...spec.alternativeTo];
    const perList = await mapLimit(lists, 2, async (list) => {
      const md = await fetchListReadme(ctx, list.full_name, list.default_branch);
      if (!md) return [];
      return matchEntries(parseAwesomeMarkdown(md), terms, 10).map((e) => awesomeEntryToCandidate(e, `awesome:${list.full_name}`));
    });
    return perList.flat().map((c) => ({ ...c, sources: ["awesome-lists"] }));
  },
};

async function fetchListReadme(ctx: SourceContext, fullName: string, branch: string): Promise<string | undefined> {
  const id = parseGithubId(`github.com/${fullName}`);
  if (!id) return undefined;
  for (const name of ["README.md", "readme.md"]) {
    const md = await ctx.http.text(`https://raw.githubusercontent.com/${id.owner}/${id.repo}/${branch}/${name}`, {
      ttlMs: TTL.catalog,
      allow404: true,
      headers: { Accept: "text/plain" },
    });
    if (md) return md;
  }
  return undefined;
}
