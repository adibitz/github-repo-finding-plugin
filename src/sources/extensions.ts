import { TTL } from "../config.js";
import { effectiveMinStars } from "../core/spec.js";
import { textQueries } from "../core/queries.js";
import { cleanText } from "../core/text.js";
import type { Candidate } from "../core/types.js";
import { githubHeaders, publicOnly, repoToCandidate, type GhRepo } from "./github.js";
import { mapLimit } from "./http.js";
import type { SearchSource } from "./types.js";

// ---------- Open VSX (VS Code-compatible extensions) ----------

interface OpenVsxExtension {
  name: string;
  namespace: string;
  displayName?: string;
  description?: string;
  downloadCount?: number;
  averageRating?: number;
  timestamp?: string;
  deprecated?: boolean;
  url: string;
}

export function openVsxToCandidate(e: OpenVsxExtension): Candidate {
  const page = `https://open-vsx.org/extension/${e.namespace}/${e.name}`;
  return {
    id: `openvsx:${e.namespace}.${e.name}`.toLowerCase(),
    name: e.displayName ?? e.name,
    description: cleanText(e.description, 300),
    url: page,
    kind: "extension",
    sources: ["openvsx"],
    downloads: e.downloadCount,
    downloadsPeriod: "total",
    lastActivity: e.timestamp,
    archived: e.deprecated,
    installHints: [
      { method: "vscode-marketplace", label: "Install from the Extensions panel in VS Code / Cursor / Windsurf", level: "easy-install", url: page },
    ],
  };
}

export const openVsxSource: SearchSource = {
  id: "openvsx",
  name: "Open VSX",
  tier: 2,
  modes: ["extension"],
  description: "Open registry of VS Code-compatible extensions (used by Cursor, Windsurf, VSCodium).",
  homepage: "https://open-vsx.org",
  access: "Free, no key needed.",
  appliesTo: (spec) => spec.mode === "extension" && spec.extensionFor === "vscode",
  async search(spec, ctx) {
    const pages = await mapLimit(textQueries(spec, 3), 3, (q) =>
      ctx.http.json<{ extensions: OpenVsxExtension[] }>(
        `https://open-vsx.org/api/-/search?query=${encodeURIComponent(q)}&size=10&sortBy=relevance`,
        { ttlMs: TTL.search },
      ),
    );
    return pages.flatMap((p) => (p?.extensions ?? []).map(openVsxToCandidate));
  },
};

// ---------- WordPress plugin directory ----------

interface WpPlugin {
  name: string;
  slug: string;
  short_description?: string;
  active_installs?: number;
  rating?: number;
  last_updated?: string;
  homepage?: string;
}

/** WordPress dates look like "2026-10-01 3:14pm GMT". */
function wpDate(s: string | undefined): string | undefined {
  if (!s) return undefined;
  const t = Date.parse(s.replace(/(\d)(am|pm)/i, "$1 $2"));
  return Number.isNaN(t) ? undefined : new Date(t).toISOString();
}

export function wordpressToCandidate(p: WpPlugin): Candidate {
  const url = `https://wordpress.org/plugins/${p.slug}/`;
  return {
    id: `wordpress:${p.slug}`,
    name: cleanText(p.name, 120),
    description: cleanText(p.short_description, 300),
    url,
    homepage: p.homepage || undefined,
    kind: "extension",
    sources: ["wordpress"],
    downloads: p.active_installs,
    downloadsPeriod: "total",
    // All plugins in the official directory must be GPL-compatible.
    license: "GPL-2.0-or-later",
    lastActivity: wpDate(p.last_updated),
    installHints: [{ method: "wordpress", label: "Install from Plugins → Add New in WordPress", level: "easy-install", url }],
  };
}

export const wordpressSource: SearchSource = {
  id: "wordpress",
  name: "WordPress plugins",
  tier: 2,
  modes: ["extension"],
  description: "The official WordPress.org plugin directory.",
  homepage: "https://wordpress.org/plugins/",
  access: "Free, no key needed.",
  appliesTo: (spec) => spec.mode === "extension" && spec.extensionFor === "wordpress",
  async search(spec, ctx) {
    const pages = await mapLimit(textQueries(spec, 2), 2, (q) =>
      ctx.http.json<{ plugins: WpPlugin[] }>(
        `https://api.wordpress.org/plugins/info/1.2/?action=query_plugins&request[search]=${encodeURIComponent(q)}&request[per_page]=10`,
        { ttlMs: TTL.search },
      ),
    );
    return pages.flatMap((p) => (p?.plugins ?? []).map(wordpressToCandidate));
  },
};

// ---------- Obsidian community plugins (via the obsidian-plugin topic on GitHub) ----------

export const obsidianSource: SearchSource = {
  id: "obsidian",
  name: "Obsidian plugins",
  tier: 2,
  modes: ["extension"],
  description: "Obsidian community plugins, found through GitHub's obsidian-plugin topic.",
  homepage: "https://obsidian.md/plugins",
  access: "Uses one GitHub search per request.",
  appliesTo: (spec) => spec.mode === "extension" && spec.extensionFor === "obsidian",
  async search(spec, ctx) {
    const term = spec.keywords.slice(0, 2).join(" ");
    const q = `${term} topic:obsidian-plugin archived:false stars:>=${Math.min(effectiveMinStars(spec), 10)}`;
    const res = await ctx.http.json<{ items: GhRepo[] }>(`https://api.github.com/search/repositories?q=${encodeURIComponent(q)}&per_page=15`, {
      headers: githubHeaders(ctx.config),
      ttlMs: TTL.search,
    });
    return publicOnly(res?.items ?? []).map((r) => ({
      ...repoToCandidate(r, "obsidian"),
      installHints: [{ method: "obsidian", label: "Install from Settings → Community plugins in Obsidian", level: "easy-install" as const }],
    }));
  },
};
