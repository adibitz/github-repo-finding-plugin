import type { Config } from "../config.js";
import type { Spec } from "../core/spec.js";
import { huggingFaceSource, mcpRegistrySource } from "./ai.js";
import { awesomeListsSource, awesomeSelfhostedSource } from "./awesome.js";
import { fdroidSource, flathubSource, yunohostSource } from "./catalogs.js";
import { obsidianSource, openVsxSource, wordpressSource } from "./extensions.js";
import { codebergSource, gitlabSource } from "./forges.js";
import { githubSource } from "./github.js";
import { cratesSource, ecosystemsPackagesSource, npmSource } from "./packages.js";
import type { SearchSource, SourceInfo } from "./types.js";

export const SEARCH_SOURCES: readonly SearchSource[] = [
  githubSource,
  awesomeSelfhostedSource,
  awesomeListsSource,
  gitlabSource,
  codebergSource,
  flathubSource,
  fdroidSource,
  yunohostSource,
  npmSource,
  cratesSource,
  ecosystemsPackagesSource,
  openVsxSource,
  wordpressSource,
  obsidianSource,
  huggingFaceSource,
  mcpRegistrySource,
];

/** Sources used for details and reputation rather than search. Listed so users can see and disable them. */
export const SUPPORT_SOURCES: readonly SourceInfo[] = [
  { id: "depsdev", name: "deps.dev", tier: 1, modes: [], description: "Repo stats and OpenSSF Scorecard without using GitHub quota.", homepage: "https://deps.dev", access: "Free, no key needed." },
  { id: "scorecard", name: "OpenSSF Scorecard", tier: 1, modes: [], description: "Security-practices score (0-10) for GitHub projects.", homepage: "https://scorecard.dev", access: "Free, no key needed." },
  { id: "osv", name: "OSV.dev", tier: 1, modes: [], description: "Known security vulnerabilities in packages.", homepage: "https://osv.dev", access: "Free, no key needed." },
  { id: "repology", name: "Repology", tier: 2, modes: [], description: "Which app stores and Linux distros ship the tool (winget, Homebrew, Flathub, Debian…).", homepage: "https://repology.org", access: "Free, 1 request/second." },
  { id: "awesome-lookup", name: "ecosyste.ms awesome", tier: 2, modes: [], description: "How many curated 'awesome' lists recommend the tool.", homepage: "https://awesome.ecosyste.ms", access: "Free open API." },
  { id: "hackernews", name: "Hacker News", tier: 3, modes: [], description: "Discussions about the tool on Hacker News.", homepage: "https://news.ycombinator.com", access: "Free (Algolia search API), no key." },
  { id: "stackoverflow", name: "Stack Overflow", tier: 3, modes: [], description: "Questions about the tool (a sign of real-world use).", homepage: "https://stackoverflow.com", access: "Free: 300 requests/day, 10,000 with a STACKEXCHANGE_KEY." },
  { id: "lemmy", name: "Lemmy", tier: 3, modes: [], description: "Community discussion on the federated Lemmy network (lemmy.world).", homepage: "https://lemmy.world", access: "Free, no key needed." },
];

/** Sites the server deliberately doesn't call; the skill tells the AI to use its own web search for these. */
export const WEB_SEARCH_ONLY = [
  { name: "Reddit", reason: "API is restricted (approval needed, non-commercial only)" },
  { name: "Product Hunt", reason: "API is non-commercial only without permission" },
  { name: "AlternativeTo", reason: "No public API" },
  { name: "SaaSHub / LibHunt", reason: "No public API" },
  { name: "YouTube tutorials", reason: "Best found by web search" },
  { name: "Blogs and 'best X' articles", reason: "Leads only; must be verified" },
] as const;

export function isEnabled(id: string, config: Config): boolean {
  return !config.disabledSources.has(id);
}

/** Sources to ask for this request: enabled, relevant to the spec, optionally limited to `only`. */
export function selectSources(spec: Spec, config: Config, only?: string[]): SearchSource[] {
  const wanted = only && only.length > 0 ? new Set(only) : undefined;
  return SEARCH_SOURCES.filter((s) => isEnabled(s.id, config) && (wanted ? wanted.has(s.id) : s.appliesTo(spec, config)));
}
