import type { Candidate, InstallHint } from "./types.js";

const FORGE_HOSTS = ["github.com", "gitlab.com", "codeberg.org", "bitbucket.org", "sr.ht", "git.sr.ht"];

/**
 * Canonical "host/owner/repo" for a code-forge URL, or undefined for anything else.
 * Handles `.git` suffixes, trailing paths (`/tree/main`), `www.` and `git+https://` prefixes.
 */
export function canonicalRepoId(url: string | undefined | null): string | undefined {
  if (!url) return undefined;
  const cleaned = url.trim().replace(/^git\+/, "").replace(/^git:\/\//, "https://").replace(/^git@([^:]+):/, "https://$1/");
  let parsed: URL;
  try {
    parsed = new URL(cleaned.includes("://") ? cleaned : `https://${cleaned}`);
  } catch {
    return undefined;
  }
  const host = parsed.hostname.toLowerCase().replace(/^www\./, "");
  if (!FORGE_HOSTS.includes(host)) return undefined;
  const parts = parsed.pathname.split("/").filter(Boolean);
  // GitLab allows nested groups; everything before a "/-/" marker is the project path.
  const dash = parts.indexOf("-");
  const pathParts = host === "gitlab.com" ? parts.slice(0, dash === -1 ? parts.length : dash) : parts.slice(0, 2);
  if (pathParts.length < 2) return undefined;
  const path = pathParts.join("/").replace(/\.git$/i, "").toLowerCase();
  return `${host}/${path}`;
}

/** https URL for a canonical repo id. */
export function repoUrlFromId(id: string): string {
  return `https://${id}`;
}

function mergeHints(a: InstallHint[] = [], b: InstallHint[] = []): InstallHint[] | undefined {
  const seen = new Map<string, InstallHint>();
  for (const h of [...a, ...b]) if (!seen.has(h.method)) seen.set(h.method, h);
  return seen.size > 0 ? [...seen.values()] : undefined;
}

function maxDefined(a: number | undefined, b: number | undefined): number | undefined {
  if (a === undefined) return b;
  if (b === undefined) return a;
  return Math.max(a, b);
}

function realLicense(license: string | undefined): string | undefined {
  return license && license !== "NOASSERTION" && license.toLowerCase() !== "other" ? license : undefined;
}

function laterDate(a: string | undefined, b: string | undefined): string | undefined {
  if (!a) return b;
  if (!b) return a;
  return Date.parse(a) >= Date.parse(b) ? a : b;
}

/** Combine two records of the same tool, keeping the richest value of each field. */
export function mergeTwo(a: Candidate, b: Candidate): Candidate {
  const preferRepo = a.kind === "repo" ? a : b.kind === "repo" ? b : a;
  const other = preferRepo === a ? b : a;
  return {
    ...other,
    ...preferRepo,
    description: preferRepo.description || other.description,
    sources: [...new Set([...a.sources, ...b.sources])],
    repoUrl: preferRepo.repoUrl ?? other.repoUrl,
    homepage: preferRepo.homepage ?? other.homepage,
    stars: maxDefined(a.stars, b.stars),
    forks: maxDefined(a.forks, b.forks),
    downloads: preferRepo.downloads ?? other.downloads,
    downloadsPeriod: preferRepo.downloads !== undefined ? preferRepo.downloadsPeriod : other.downloadsPeriod,
    // GitHub says NOASSERTION for licenses it can't classify; a curated source's real id is better.
    license: realLicense(preferRepo.license) ?? realLicense(other.license) ?? preferRepo.license ?? other.license,
    sourceRank: maxDefined(a.sourceRank, b.sourceRank),
    language: preferRepo.language ?? other.language,
    topics: [...new Set([...(a.topics ?? []), ...(b.topics ?? [])])],
    lastActivity: laterDate(a.lastActivity, b.lastActivity),
    archived: a.archived || b.archived ? true : (preferRepo.archived ?? other.archived),
    platforms: [...new Set([...(a.platforms ?? []), ...(b.platforms ?? [])])],
    installHints: mergeHints(a.installHints, b.installHints),
  };
}

/** Key used to detect the same tool across sources: repo id first, then the candidate's own id. */
export function mergeKey(c: Candidate): string {
  return canonicalRepoId(c.repoUrl) ?? canonicalRepoId(c.url) ?? c.id;
}

/** "Invoice Ninja", "invoice-ninja" and "invoiceninja" all normalise to "invoiceninja". */
export function normalizeName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

/**
 * App-store listings often carry no repo link. When a listing has exactly the same normalised
 * name as one repo candidate, fold the listing (its install hints, platforms, downloads) into it.
 */
export function mergeListingsByName(list: Candidate[]): Candidate[] {
  const repos = new Map<string, Candidate[]>();
  for (const c of list) {
    if (c.kind !== "repo") continue;
    const key = normalizeName(c.name);
    repos.set(key, [...(repos.get(key) ?? []), c]);
  }
  const absorbed = new Set<Candidate>();
  const replaced = new Map<Candidate, Candidate>();
  for (const c of list) {
    if (c.kind !== "app-listing" || c.repoUrl) continue;
    const key = normalizeName(c.name);
    const matches = repos.get(key);
    if (key.length < 4 || !matches || matches.length !== 1 || !matches[0]) continue;
    const target = replaced.get(matches[0]) ?? matches[0];
    const merged = { ...mergeTwo(target, c), id: target.id, url: target.url, kind: target.kind };
    replaced.set(matches[0], merged);
    absorbed.add(c);
  }
  return list.filter((c) => !absorbed.has(c)).map((c) => replaced.get(c) ?? c);
}

/** Merge duplicates (same repo / same id) into one record per tool. Order of first appearance is kept. */
export function mergeCandidates(list: Candidate[]): Candidate[] {
  const byKey = new Map<string, Candidate>();
  for (const c of list) {
    const key = mergeKey(c);
    const existing = byKey.get(key);
    if (!existing) {
      const repoId = canonicalRepoId(c.repoUrl) ?? canonicalRepoId(c.url);
      byKey.set(key, repoId ? { ...c, id: repoId, repoUrl: c.repoUrl ?? repoUrlFromId(repoId) } : c);
    } else {
      byKey.set(key, mergeTwo(existing, c));
    }
  }
  return [...byKey.values()];
}
