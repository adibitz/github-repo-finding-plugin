import { TTL } from "../config.js";
import { textQueries } from "../core/queries.js";
import { FOSS_UNSPECIFIED } from "../core/license.js";
import { cleanText, relevanceScore } from "../core/text.js";
import type { Candidate } from "../core/types.js";
import { mapLimit } from "./http.js";
import { modeMatches, type SearchSource } from "./types.js";

// ---------- Flathub (Linux desktop app store) ----------

interface FlathubHit {
  name: string;
  summary: string;
  app_id: string;
  project_license?: string;
  is_free_license?: boolean;
  installs_last_month?: number;
  updated_at?: number | string;
  developer_name?: string;
  type?: string;
}

function epochToIso(v: number | string | undefined): string | undefined {
  if (v === undefined) return undefined;
  if (typeof v === "number") return new Date(v * 1000).toISOString();
  const t = Date.parse(v);
  return Number.isNaN(t) ? undefined : new Date(t).toISOString();
}

export function flathubToCandidate(h: FlathubHit): Candidate {
  const url = `https://flathub.org/apps/${h.app_id}`;
  return {
    id: `flathub:${h.app_id.toLowerCase()}`,
    name: h.name,
    description: cleanText(h.summary, 300),
    url,
    kind: "app-listing",
    sources: ["flathub"],
    downloads: h.installs_last_month,
    downloadsPeriod: "month",
    license: h.is_free_license === false ? "Proprietary" : h.project_license,
    lastActivity: epochToIso(h.updated_at),
    platforms: ["linux"],
    installHints: [{ method: "flathub", label: "Install on Linux from Flathub", level: "easy-install", url }],
  };
}

const desktop = (platforms: string[]) => platforms.length === 0 || platforms.some((p) => p === "linux" || p === "windows" || p === "mac");

export const flathubSource: SearchSource = {
  id: "flathub",
  name: "Flathub",
  tier: 2,
  modes: ["app", "any"],
  description: "The main app store for Linux desktop apps. Also shows that a real desktop app exists.",
  homepage: "https://flathub.org",
  access: "Free, no key needed.",
  appliesTo: (spec) => modeMatches(spec, ["app"]) && desktop(spec.platforms),
  async search(spec, ctx) {
    const pages = await mapLimit(textQueries(spec, 2), 2, (q) =>
      ctx.http.json<{ hits: FlathubHit[] }>("https://flathub.org/api/v2/search?locale=en", {
        body: { query: q, filters: [] },
        ttlMs: TTL.search,
      }),
    );
    return pages.flatMap((p) => (p?.hits ?? []).filter((h) => !h.type || h.type === "desktop-application").slice(0, 8).map(flathubToCandidate));
  },
};

// ---------- F-Droid (free Android apps) ----------

interface FdroidApp {
  name: string;
  summary: string;
  url: string;
}

export function fdroidToCandidate(a: FdroidApp): Candidate {
  const pkg = a.url.split("/packages/")[1]?.replace(/\/$/, "") ?? a.name;
  return {
    id: `fdroid:${pkg.toLowerCase()}`,
    name: a.name,
    description: cleanText(a.summary, 300),
    url: a.url,
    kind: "app-listing",
    sources: ["fdroid"],
    // Everything on F-Droid must be free and open source; the search API doesn't say which license.
    license: FOSS_UNSPECIFIED,
    platforms: ["android"],
    installHints: [{ method: "fdroid", label: "Install on Android from F-Droid", level: "easy-install", url: a.url }],
  };
}

export const fdroidSource: SearchSource = {
  id: "fdroid",
  name: "F-Droid",
  tier: 2,
  modes: ["app", "any"],
  description: "App store of free and open-source Android apps.",
  homepage: "https://f-droid.org",
  access: "Free, no key needed.",
  appliesTo: (spec) => modeMatches(spec, ["app"]) && (spec.platforms.length === 0 || spec.platforms.includes("android")),
  async search(spec, ctx) {
    const pages = await mapLimit(textQueries(spec, 2), 2, (q) =>
      ctx.http.json<{ apps: FdroidApp[] }>(`https://search.f-droid.org/api/search_apps?q=${encodeURIComponent(q)}`, { ttlMs: TTL.search }),
    );
    const terms = [...spec.keywords, ...spec.alternativeTo];
    return pages
      .flatMap((p) => p?.apps ?? [])
      .filter((a) => relevanceScore(terms, a.name, a.summary) >= 0.34)
      .slice(0, 8)
      .map(fdroidToCandidate);
  },
};

// ---------- YunoHost (one-click self-hosting catalog) ----------

interface YunohostApp {
  id: string;
  category?: string;
  level?: number;
  state?: string;
  maintained?: boolean;
  lastUpdate?: number;
  potential_alternative_to?: string[];
  antifeatures?: string[];
  manifest?: {
    name?: string;
    description?: Record<string, string>;
    upstream?: { code?: string; license?: string; website?: string; demo?: string };
  };
}

export function yunohostToCandidate(a: YunohostApp): Candidate {
  const listing = `https://apps.yunohost.org/app/${a.id}`;
  const code = a.manifest?.upstream?.code;
  return {
    id: `yunohost:${a.id}`,
    name: a.manifest?.name ?? a.id,
    description: cleanText(a.manifest?.description?.en, 300),
    url: code ?? listing,
    repoUrl: code,
    homepage: a.manifest?.upstream?.website,
    kind: "app-listing",
    sources: ["yunohost"],
    license: a.manifest?.upstream?.license,
    topics: [a.category, ...(a.potential_alternative_to ?? []).map((x) => `alternative to ${x}`)].filter((x): x is string => !!x),
    platforms: ["self-host", "web"],
    installHints: [{ method: "yunohost", label: "One-click install on a YunoHost server", level: "medium", url: listing }],
  };
}

/** Apps whose description, category or "alternative to" list match the request. Broken or unmaintained packages are skipped. */
export function matchYunohost(apps: YunohostApp[], terms: string[], alternativeTo: string[], limit: number): YunohostApp[] {
  const alts = alternativeTo.map((a) => a.toLowerCase());
  return apps
    .filter((a) => a.state === "working" && a.maintained !== false)
    .map((a) => {
      const altHit = (a.potential_alternative_to ?? []).some((x) => alts.some((w) => x.toLowerCase().includes(w)));
      const score = relevanceScore(terms, a.manifest?.name ?? a.id, a.manifest?.description?.en ?? "", [a.category ?? ""]) + (altHit ? 1 : 0);
      return { a, score };
    })
    .filter((x) => x.score >= 0.34)
    .sort((x, y) => y.score - x.score)
    .slice(0, limit)
    .map((x) => x.a);
}

export const yunohostSource: SearchSource = {
  id: "yunohost",
  name: "YunoHost apps",
  tier: 2,
  modes: ["app", "any"],
  description: "Catalog of ~700 self-hosted apps with one-click install on a YunoHost server; lists what each app replaces.",
  homepage: "https://apps.yunohost.org",
  access: "Free open data. Downloaded once a week and cached.",
  appliesTo: (spec) => modeMatches(spec, ["app"]) && (spec.platforms.length === 0 || spec.platforms.some((p) => p === "self-host" || p === "web")),
  async search(spec, ctx) {
    const data = await ctx.http.json<{ apps: Record<string, YunohostApp> }>("https://app.yunohost.org/default/v3/apps.json", { ttlMs: TTL.catalog });
    if (!data) return [];
    return matchYunohost(Object.values(data.apps), [...spec.keywords, ...spec.alternativeTo], spec.alternativeTo, 10).map(yunohostToCandidate);
  },
};
