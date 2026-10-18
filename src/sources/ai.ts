import { TTL } from "../config.js";
import { textQueries } from "../core/queries.js";
import { cleanText } from "../core/text.js";
import type { Candidate } from "../core/types.js";
import { mapLimit } from "./http.js";
import type { SearchSource } from "./types.js";

// ---------- Hugging Face (models and Spaces) ----------

interface HfModel {
  id: string;
  likes?: number;
  downloads?: number;
  tags?: string[];
  pipeline_tag?: string;
  lastModified?: string;
}

interface HfSpace {
  id: string;
  likes?: number;
  sdk?: string;
  tags?: string[];
  lastModified?: string;
}

function hfLicense(tags: string[] = []): string | undefined {
  return tags.find((t) => t.startsWith("license:"))?.slice("license:".length);
}

export function hfModelToCandidate(m: HfModel): Candidate {
  return {
    id: `hf-model:${m.id.toLowerCase()}`,
    name: m.id,
    description: cleanText([m.pipeline_tag?.replace(/-/g, " "), ...(m.tags ?? []).filter((t) => !t.includes(":")).slice(0, 6)].filter(Boolean).join(", "), 300),
    url: `https://huggingface.co/${m.id}`,
    kind: "model",
    sources: ["huggingface"],
    stars: m.likes,
    downloads: m.downloads,
    downloadsPeriod: "month",
    license: hfLicense(m.tags),
    topics: (m.tags ?? []).filter((t) => !t.includes(":")),
    lastActivity: m.lastModified,
  };
}

export function hfSpaceToCandidate(s: HfSpace): Candidate {
  return {
    id: `hf-space:${s.id.toLowerCase()}`,
    name: s.id,
    description: cleanText(`Web app demo (${s.sdk ?? "app"}): ${(s.tags ?? []).filter((t) => !t.includes(":")).slice(0, 6).join(", ")}`, 300),
    url: `https://huggingface.co/spaces/${s.id}`,
    kind: "space",
    sources: ["huggingface"],
    stars: s.likes,
    license: hfLicense(s.tags),
    lastActivity: s.lastModified,
    platforms: ["web"],
  };
}

export const huggingFaceSource: SearchSource = {
  id: "huggingface",
  name: "Hugging Face",
  tier: 2,
  modes: ["ai"],
  description: "AI models and ready-to-use AI web apps (Spaces).",
  homepage: "https://huggingface.co",
  access: "Free, no key needed.",
  appliesTo: (spec) => spec.mode === "ai",
  async search(spec, ctx) {
    const queries = textQueries(spec, 2);
    const [models, spaces] = await Promise.all([
      mapLimit(queries, 2, (q) =>
        ctx.http.json<HfModel[]>(`https://huggingface.co/api/models?search=${encodeURIComponent(q)}&sort=downloads&limit=8&full=false`, { ttlMs: TTL.search }),
      ),
      mapLimit(queries, 2, (q) =>
        ctx.http.json<HfSpace[]>(`https://huggingface.co/api/spaces?search=${encodeURIComponent(q)}&sort=likes&limit=6`, { ttlMs: TTL.search }),
      ),
    ]);
    // Everyday users can use a Space in the browser; models need a developer.
    const spaceCandidates = spaces.flatMap((p) => (p ?? []).map(hfSpaceToCandidate));
    const modelCandidates = models.flatMap((p) => (p ?? []).map(hfModelToCandidate));
    return spec.techLevel === "beginner" ? [...spaceCandidates, ...modelCandidates.slice(0, 4)] : [...modelCandidates, ...spaceCandidates];
  },
};

// ---------- Official MCP Registry (tools for AI assistants) ----------

interface McpRegistryEntry {
  server: {
    name: string;
    description?: string;
    version?: string;
    websiteUrl?: string;
    repository?: { url?: string };
  };
  _meta?: Record<string, { status?: string; updatedAt?: string; isLatest?: boolean }>;
}

export function mcpEntryToCandidate(e: McpRegistryEntry): Candidate {
  const meta = e._meta?.["io.modelcontextprotocol.registry/official"];
  const repo = e.server.repository?.url || undefined;
  return {
    id: `mcp:${e.server.name.toLowerCase()}`,
    name: e.server.name,
    description: cleanText(e.server.description, 300),
    url: repo ?? e.server.websiteUrl ?? `https://registry.modelcontextprotocol.io/v0/servers?search=${encodeURIComponent(e.server.name)}`,
    repoUrl: repo,
    homepage: e.server.websiteUrl,
    kind: "mcp-server",
    sources: ["mcp-registry"],
    lastActivity: meta?.updatedAt,
    archived: meta?.status !== undefined && meta.status !== "active",
  };
}

export const mcpRegistrySource: SearchSource = {
  id: "mcp-registry",
  name: "MCP Registry",
  tier: 2,
  modes: ["ai"],
  description: "Official registry of MCP servers: add-ons that give AI assistants new tools.",
  homepage: "https://registry.modelcontextprotocol.io",
  access: "Free, no key needed (registry is in preview).",
  appliesTo: (spec) => spec.mode === "ai",
  async search(spec, ctx) {
    const pages = await mapLimit(textQueries(spec, 2), 2, (q) =>
      ctx.http.json<{ servers: McpRegistryEntry[] }>(`https://registry.modelcontextprotocol.io/v0/servers?search=${encodeURIComponent(q)}&limit=10`, {
        ttlMs: TTL.search,
        timeoutMs: 25_000,
      }),
    );
    return pages.flatMap((p) => (p?.servers ?? []).filter((e) => e._meta?.["io.modelcontextprotocol.registry/official"]?.isLatest !== false).map(mcpEntryToCandidate));
  },
};
