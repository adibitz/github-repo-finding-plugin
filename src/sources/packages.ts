import { TTL } from "../config.js";
import { textQueries } from "../core/queries.js";
import type { Spec } from "../core/spec.js";
import { cleanText, relevanceScore } from "../core/text.js";
import type { Candidate, Ecosystem } from "../core/types.js";
import { mapLimit } from "./http.js";
import { modeMatches, type SearchSource } from "./types.js";

const LANGUAGE_TO_ECOSYSTEM: Record<string, Ecosystem> = {
  javascript: "npm",
  typescript: "npm",
  node: "npm",
  "node.js": "npm",
  python: "pypi",
  rust: "crates",
  java: "maven",
  kotlin: "maven",
  scala: "maven",
  "c#": "nuget",
  csharp: "nuget",
  ".net": "nuget",
  php: "packagist",
  ruby: "rubygems",
  go: "go",
  golang: "go",
};

/** Ecosystems the user asked for, directly or through their programming languages. */
export function wantedEcosystems(spec: Spec): Set<Ecosystem> {
  const set = new Set<Ecosystem>(spec.ecosystems);
  for (const lang of spec.languages) {
    const eco = LANGUAGE_TO_ECOSYSTEM[lang.toLowerCase()];
    if (eco) set.add(eco);
  }
  return set;
}

/** Library mode, or "any" mode where the user named package ecosystems explicitly. */
const libraryMode = (spec: Spec) => spec.mode === "library" || (modeMatches(spec, ["library"]) && spec.ecosystems.length > 0);

// ---------- npm ----------

interface NpmObject {
  downloads?: { monthly?: number; weekly?: number };
  updated?: string;
  package: {
    name: string;
    description?: string;
    keywords?: string[];
    license?: string;
    date?: string;
    links?: { npm?: string; homepage?: string; repository?: string };
  };
}

export function npmToCandidate(o: NpmObject): Candidate {
  const p = o.package;
  return {
    id: `npm:${p.name}`,
    name: p.name,
    description: cleanText(p.description, 300),
    url: p.links?.npm ?? `https://www.npmjs.com/package/${p.name}`,
    repoUrl: p.links?.repository,
    homepage: p.links?.homepage,
    kind: "package",
    sources: ["npm"],
    downloads: o.downloads?.monthly,
    downloadsPeriod: "month",
    license: p.license,
    language: "JavaScript",
    topics: p.keywords ?? [],
    lastActivity: p.date,
  };
}

export const npmSource: SearchSource = {
  id: "npm",
  name: "npm",
  tier: 2,
  modes: ["library"],
  description: "JavaScript / TypeScript package registry.",
  homepage: "https://www.npmjs.com",
  access: "Free, no key needed.",
  appliesTo: (spec) => libraryMode(spec) && wantedEcosystems(spec).has("npm"),
  async search(spec, ctx) {
    const pages = await mapLimit(textQueries(spec, 3), 3, (q) =>
      ctx.http.json<{ objects: NpmObject[] }>(`https://registry.npmjs.org/-/v1/search?text=${encodeURIComponent(q)}&size=10`, { ttlMs: TTL.search }),
    );
    // Type-definition packages are never the answer to "find me a library".
    return pages.flatMap((p) => (p?.objects ?? []).filter((o) => !o.package.name.startsWith("@types/")).map(npmToCandidate));
  },
};

// ---------- crates.io ----------

interface Crate {
  name: string;
  description: string | null;
  downloads: number;
  recent_downloads: number | null;
  updated_at: string;
  repository: string | null;
  homepage: string | null;
}

export function crateToCandidate(c: Crate): Candidate {
  return {
    id: `crates:${c.name}`,
    name: c.name,
    description: cleanText(c.description, 300),
    url: `https://crates.io/crates/${c.name}`,
    repoUrl: c.repository ?? undefined,
    homepage: c.homepage ?? undefined,
    kind: "package",
    sources: ["crates"],
    // crates.io's recent_downloads covers 90 days; a third of it is comparable to npm's monthly count.
    downloads: c.recent_downloads !== null ? Math.round(c.recent_downloads / 3) : c.downloads,
    downloadsPeriod: c.recent_downloads !== null ? "month" : "total",
    language: "Rust",
    lastActivity: c.updated_at,
  };
}

export const cratesSource: SearchSource = {
  id: "crates",
  name: "crates.io",
  tier: 2,
  modes: ["library"],
  description: "Rust package registry.",
  homepage: "https://crates.io",
  access: "Free, no key needed (1 request/second policy).",
  appliesTo: (spec) => libraryMode(spec) && wantedEcosystems(spec).has("crates"),
  async search(spec, ctx) {
    const pages = await mapLimit(textQueries(spec, 2), 1, (q) =>
      ctx.http.json<{ crates: Crate[] }>(`https://crates.io/api/v1/crates?q=${encodeURIComponent(q)}&per_page=10`, { ttlMs: TTL.search }),
    );
    return pages.flatMap((p) => (p?.crates ?? []).map(crateToCandidate));
  },
};

// ---------- ecosyste.ms keywords (PyPI, Maven, NuGet, Packagist, RubyGems, Go …) ----------

interface EcoPackage {
  name: string;
  ecosystem: string;
  description: string | null;
  homepage: string | null;
  repository_url: string | null;
  registry_url: string | null;
  normalized_licenses?: string[];
  downloads: number | null;
  downloads_period: string | null;
  latest_release_published_at: string | null;
  dependent_repos_count?: number | null;
  status?: string | null;
}

const ECOSYSTEMS_REGISTRY_NAME: Record<Ecosystem, string> = {
  npm: "npm",
  pypi: "pypi",
  crates: "cargo",
  maven: "maven",
  nuget: "nuget",
  packagist: "packagist",
  rubygems: "rubygems",
  go: "go",
};

export function ecoPackageToCandidate(p: EcoPackage): Candidate {
  const period = p.downloads_period === "last-month" ? "month" : p.downloads_period === "total" ? "total" : undefined;
  return {
    id: `${p.ecosystem}:${p.name}`,
    name: p.name,
    description: cleanText(p.description, 300),
    url: p.registry_url ?? p.homepage ?? p.repository_url ?? "",
    repoUrl: p.repository_url ?? undefined,
    homepage: p.homepage ?? undefined,
    kind: "package",
    sources: ["ecosystems"],
    downloads: p.downloads ?? undefined,
    downloadsPeriod: period,
    license: p.normalized_licenses?.[0],
    lastActivity: p.latest_release_published_at ?? undefined,
  };
}

export const ecosystemsPackagesSource: SearchSource = {
  id: "ecosystems",
  name: "ecosyste.ms packages",
  tier: 2,
  modes: ["library"],
  description: "Packages tagged with a keyword across PyPI, Maven, NuGet, Packagist, RubyGems, Go and more.",
  homepage: "https://packages.ecosyste.ms",
  access: "Free open API (about 5,000 requests/hour).",
  appliesTo: (spec) => {
    const eco = wantedEcosystems(spec);
    return libraryMode(spec) && [...eco].some((e) => e !== "npm" && e !== "crates");
  },
  async search(spec, ctx) {
    const wanted = new Set([...wantedEcosystems(spec)].map((e) => ECOSYSTEMS_REGISTRY_NAME[e]));
    const keywords = spec.keywords
      .map((k) => k.toLowerCase().trim().replace(/\s+/g, "-"))
      .filter((k) => /^[a-z0-9.+-]+$/.test(k))
      .slice(0, 2);
    const pages = await mapLimit(keywords, 2, (k) =>
      ctx.http.json<{ packages: EcoPackage[] }>(`https://packages.ecosyste.ms/api/v1/keywords/${encodeURIComponent(k)}?per_page=100`, {
        ttlMs: TTL.search,
        allow404: true,
        timeoutMs: 30_000,
      }),
    );
    const terms = [...spec.keywords];
    return pages
      .flatMap((p) => p?.packages ?? [])
      .filter((p) => wanted.has(p.ecosystem) && p.status !== "removed" && relevanceScore(terms, p.name, p.description ?? "") > 0)
      .sort((a, b) => (b.downloads ?? 0) - (a.downloads ?? 0))
      .slice(0, 15)
      .map(ecoPackageToCandidate);
  },
};
