import { TTL } from "../config.js";
import { assessHealth, type HealthAssessment, type HealthFacts } from "../core/health.js";
import { classifyLicense, FOSS_UNSPECIFIED, type LicenseInfo } from "../core/license.js";
import { canonicalRepoId } from "../core/merge.js";
import { assessSetup, type SetupAssessment } from "../core/setup.js";
import { cleanText } from "../core/text.js";
import type { CandidateKind, InstallHint } from "../core/types.js";
import { getCodebergRepo, getGitlabProject } from "../sources/forges.js";
import { getContributorCount, getGithubReadme, getGithubRepoVisibility, getLatestRelease, githubFileExists, parseGithubId } from "../sources/github.js";
import { getAwesomeListCount, getDepsDevProject, getPackagedIn, getScorecard, getVulnerabilityCount } from "../sources/enrich.js";
import { errorMessage } from "../sources/http.js";
import { isEnabled } from "../sources/registry.js";
import type { SourceContext } from "../sources/types.js";

export interface ToolFacts {
  stars?: number;
  forks?: number;
  contributors?: number;
  openIssues?: number;
  lastActivity?: string;
  latestRelease?: string;
  latestVersion?: string;
  scorecard?: number;
  knownVulnerabilities?: number;
  awesomeLists?: number;
  packagedIn: string[];
  language?: string;
  topics?: string[];
}

export interface ToolDetails {
  url: string;
  id: string;
  name: string;
  description: string;
  kind: CandidateKind;
  repoUrl?: string;
  homepage?: string;
  license: LicenseInfo;
  health: HealthAssessment;
  setup: SetupAssessment;
  facts: ToolFacts;
  /** Steps that couldn't be completed (rate limits, timeouts). The rest of the record is still valid. */
  warnings: string[];
}

interface Collected {
  id: string;
  name: string;
  description: string;
  kind: CandidateKind;
  repoUrl?: string;
  homepage?: string;
  /** Raw license value; registries sometimes send objects, which classifyLicense handles. */
  license?: unknown;
  archived?: boolean;
  readme?: string;
  releaseAssets: string[];
  hasDockerCompose?: boolean;
  installHints: InstallHint[];
  facts: ToolFacts;
  warnings: string[];
}

/** Run an optional enrichment step; a failure is recorded as a warning instead of failing the whole record. */
async function attempt<T>(warnings: string[], label: string, fn: () => Promise<T>): Promise<T | undefined> {
  try {
    return await fn();
  } catch (err) {
    warnings.push(`${label}: ${errorMessage(err)}`);
    return undefined;
  }
}

function emptyCollected(url: string, name?: string): Collected {
  return {
    id: url,
    name: name ?? url,
    description: "",
    kind: "app-listing",
    releaseAssets: [],
    installHints: [],
    facts: { packagedIn: [] },
    warnings: [],
  };
}

async function collectGithub(ctx: SourceContext, c: Collected, owner: string, repo: string): Promise<void> {
  const w = c.warnings;
  const repoId = `github.com/${owner}/${repo}`.toLowerCase();
  const [visibility, release, readme, deps, contributors] = await Promise.all([
    attempt(w, "GitHub repo", () => getGithubRepoVisibility(ctx, owner, repo)),
    attempt(w, "GitHub releases", () => getLatestRelease(ctx, owner, repo)),
    attempt(w, "README", () => getGithubReadme(ctx, owner, repo)),
    isEnabled("depsdev", ctx.config) ? attempt(w, "deps.dev", () => getDepsDevProject(ctx, repoId)) : undefined,
    attempt(w, "contributors", () => getContributorCount(ctx, owner, repo)),
  ]);
  c.id = repoId;
  c.kind = "repo";
  if (visibility?.isPrivate) {
    // Everything fetched with the token about a private repo is discarded, never shown.
    c.name = repo;
    w.push("This is a private repository, so it was skipped. Only public tools are checked.");
    return;
  }
  const gh = visibility?.repo;
  c.repoUrl = gh?.html_url ?? `https://github.com/${owner}/${repo}`;
  c.name = gh?.name ?? repo;
  c.description = cleanText(gh?.description ?? deps?.description, 400);
  c.homepage = gh?.homepage || deps?.homepage || c.homepage;
  c.license = gh?.license?.spdx_id ?? deps?.license;
  c.archived = gh?.archived;
  c.readme = readme;
  c.releaseAssets = release?.assets ?? [];
  c.facts = {
    ...c.facts,
    stars: gh?.stargazers_count ?? deps?.starsCount,
    forks: gh?.forks_count ?? deps?.forksCount,
    openIssues: gh?.open_issues_count ?? deps?.openIssuesCount,
    contributors,
    lastActivity: gh?.pushed_at,
    latestRelease: release?.publishedAt,
    latestVersion: release?.tag,
    scorecard: deps?.scorecard?.overallScore,
    language: gh?.language ?? undefined,
    topics: gh?.topics,
  };
  if (!gh && !deps) w.push("Could not confirm this repository exists. Check the link.");

  const mentionsCompose = readme !== undefined && /docker[- ]compose|compose\.ya?ml/i.test(readme);
  const [compose, awesome, packaged, scorecard] = await Promise.all([
    mentionsCompose ? Promise.resolve(true) : attempt(w, "docker-compose check", () => githubFileExists(ctx, owner, repo, "docker-compose.yml")),
    isEnabled("awesome-lookup", ctx.config) ? attempt(w, "awesome lists", () => getAwesomeListCount(ctx, c.repoUrl!)) : undefined,
    isEnabled("repology", ctx.config) ? attempt(w, "Repology", () => getPackagedIn(ctx, c.name, c.description)) : undefined,
    c.facts.scorecard === undefined && isEnabled("scorecard", ctx.config) ? attempt(w, "Scorecard", () => getScorecard(ctx, repoId)) : undefined,
  ]);
  c.hasDockerCompose = compose;
  c.facts.awesomeLists = awesome;
  c.facts.packagedIn = packaged ?? [];
  if (scorecard !== undefined) c.facts.scorecard = scorecard;
}

async function collectGitlab(ctx: SourceContext, c: Collected, path: string): Promise<void> {
  const p = await attempt(c.warnings, "GitLab", () => getGitlabProject(ctx, path));
  c.id = `gitlab.com/${path.toLowerCase()}`;
  c.kind = "repo";
  c.repoUrl = p?.web_url ?? `https://gitlab.com/${path}`;
  c.name = p?.name ?? path.split("/").pop() ?? path;
  c.description = cleanText(p?.description, 400);
  c.license = p?.license?.key;
  c.facts = { ...c.facts, stars: p?.star_count, forks: p?.forks_count, lastActivity: p?.last_activity_at, topics: p?.topics };
  c.readme = await attempt(c.warnings, "README", () =>
    ctx.http.text(`https://gitlab.com/${path}/-/raw/HEAD/README.md`, { ttlMs: TTL.details, allow404: true, headers: { Accept: "text/plain" } }),
  );
  const packaged = isEnabled("repology", ctx.config) ? await attempt(c.warnings, "Repology", () => getPackagedIn(ctx, c.name, c.description)) : undefined;
  c.facts.packagedIn = packaged ?? [];
}

async function collectCodeberg(ctx: SourceContext, c: Collected, path: string): Promise<void> {
  const r = await attempt(c.warnings, "Codeberg", () => getCodebergRepo(ctx, path));
  c.id = `codeberg.org/${path.toLowerCase()}`;
  c.kind = "repo";
  c.repoUrl = r?.html_url ?? `https://codeberg.org/${path}`;
  c.name = r?.name ?? path.split("/").pop() ?? path;
  c.description = cleanText(r?.description, 400);
  c.homepage = r?.website || undefined;
  c.license = r?.licenses?.[0];
  c.archived = r?.archived;
  c.facts = { ...c.facts, stars: r?.stars_count, forks: r?.forks_count, openIssues: r?.open_issues_count, lastActivity: r?.updated_at, topics: r?.topics };
  c.readme = await attempt(c.warnings, "README", () =>
    ctx.http.text(`https://codeberg.org/${path}/raw/branch/${r?.default_branch ?? "main"}/README.md`, { ttlMs: TTL.details, allow404: true, headers: { Accept: "text/plain" } }),
  );
}

interface PackageRef {
  ecosystem: "npm" | "pypi" | "crates";
  name: string;
}

function parsedUrl(url: string): URL | undefined {
  try {
    return new URL(url);
  } catch {
    return undefined;
  }
}

/** Recognise npm, PyPI and crates.io package pages, on those exact hosts only. */
export function parsePackageUrl(url: string): PackageRef | undefined {
  const u = parsedUrl(url);
  if (!u) return undefined;
  const host = u.hostname.toLowerCase();
  const path = u.pathname;
  if (host === "www.npmjs.com" || host === "npmjs.com") {
    const m = /^\/package\/((?:@[^/]+\/)?[^/]+)/.exec(path);
    if (m?.[1]) return { ecosystem: "npm", name: decodeURIComponent(m[1]) };
  }
  if (host === "pypi.org") {
    const m = /^\/project\/([^/]+)/.exec(path);
    if (m?.[1]) return { ecosystem: "pypi", name: m[1] };
  }
  if (host === "crates.io") {
    const m = /^\/crates\/([^/]+)/.exec(path);
    if (m?.[1]) return { ecosystem: "crates", name: m[1] };
  }
  return undefined;
}

/** Flathub app id from a flathub.org app page. */
export function parseFlathubUrl(url: string): string | undefined {
  const u = parsedUrl(url);
  if (!u || u.hostname.toLowerCase() !== "flathub.org") return undefined;
  return /^\/(?:[a-z-]+\/)?apps\/(?:details\/)?([A-Za-z0-9._-]+)/i.exec(u.pathname)?.[1];
}

/** Repository URL declared by a package, used to pull full repo health. */
async function packageRepoUrl(ctx: SourceContext, pkg: PackageRef): Promise<{ repo?: string; description?: string; license?: unknown; version?: string; updated?: string }> {
  if (pkg.ecosystem === "npm") {
    const d = await ctx.http.json<{
      description?: string;
      license?: unknown;
      repository?: { url?: string } | string;
      "dist-tags"?: { latest?: string };
      time?: { modified?: string };
    }>(`https://registry.npmjs.org/${pkg.name.replace("/", "%2F")}`, { ttlMs: TTL.details, allow404: true, headers: { Accept: "application/vnd.npm.install-v1+json; q=0.5, application/json" } });
    const repo = typeof d?.repository === "string" ? d.repository : d?.repository?.url;
    return { repo, description: d?.description, license: d?.license, version: d?.["dist-tags"]?.latest, updated: d?.time?.modified };
  }
  if (pkg.ecosystem === "pypi") {
    const d = await ctx.http.json<{ info: { summary?: string; license?: string; version?: string; home_page?: string; project_urls?: Record<string, string> } }>(
      `https://pypi.org/pypi/${encodeURIComponent(pkg.name)}/json`,
      { ttlMs: TTL.details, allow404: true },
    );
    const urls = Object.values(d?.info.project_urls ?? {});
    const repo = [...urls, d?.info.home_page ?? ""].find((u) => canonicalRepoId(u));
    return { repo, description: d?.info.summary, license: d?.info.license && d.info.license.length < 40 ? d.info.license : undefined, version: d?.info.version };
  }
  const d = await ctx.http.json<{ crate: { repository?: string; description?: string; max_version?: string; updated_at?: string } }>(
    `https://crates.io/api/v1/crates/${encodeURIComponent(pkg.name)}`,
    { ttlMs: TTL.details, allow404: true },
  );
  return { repo: d?.crate.repository, description: d?.crate.description, version: d?.crate.max_version, updated: d?.crate.updated_at };
}

async function collectPackage(ctx: SourceContext, c: Collected, url: string, pkg: PackageRef): Promise<void> {
  const meta = (await attempt(c.warnings, `${pkg.ecosystem} registry`, () => packageRepoUrl(ctx, pkg))) ?? {};
  const repoId = canonicalRepoId(meta.repo);
  if (repoId?.startsWith("github.com/")) {
    const gh = parseGithubId(repoId);
    if (gh) await collectGithub(ctx, c, gh.owner, gh.repo);
  }
  c.id = `${pkg.ecosystem}:${pkg.name}`;
  c.kind = "package";
  c.name = pkg.name;
  c.description = c.description || cleanText(meta.description, 400);
  c.license = c.license ?? meta.license;
  c.facts.latestVersion = meta.version ?? c.facts.latestVersion;
  c.facts.lastActivity = c.facts.lastActivity ?? meta.updated;
  if (isEnabled("osv", ctx.config)) {
    c.facts.knownVulnerabilities = await attempt(c.warnings, "OSV", () => getVulnerabilityCount(ctx, pkg.ecosystem, pkg.name));
  }
  c.homepage = c.homepage ?? url;
}

async function collectFlathub(ctx: SourceContext, c: Collected, appId: string): Promise<void> {
  const d = await attempt(c.warnings, "Flathub", () =>
    ctx.http.json<{ name?: string; summary?: string; project_license?: string; urls?: Record<string, string> }>(
      `https://flathub.org/api/v2/appstream/${encodeURIComponent(appId)}`,
      { ttlMs: TTL.details, allow404: true },
    ),
  );
  const vcs = d?.urls?.vcs_browser;
  const gh = vcs ? parseGithubId(vcs) : undefined;
  if (gh) await collectGithub(ctx, c, gh.owner, gh.repo);
  c.name = d?.name ?? c.name;
  c.description = c.description || cleanText(d?.summary, 400);
  c.license = c.license ?? d?.project_license;
  c.homepage = c.homepage ?? d?.urls?.homepage;
  c.installHints.push({ method: "flathub", label: "Install on Linux from Flathub", level: "easy-install", url: `https://flathub.org/apps/${appId}` });
  if (!gh) {
    c.id = `flathub:${appId.toLowerCase()}`;
    c.kind = "app-listing";
  }
}

/** Gather facts about one tool from its link and turn them into plain-language health, setup and license verdicts. */
export async function getToolDetails(ctx: SourceContext, url: string, nameHint?: string): Promise<ToolDetails> {
  const c = emptyCollected(url, nameHint);
  const repoId = canonicalRepoId(url);
  const pkg = parsePackageUrl(url);
  const flathub = parseFlathubUrl(url);

  if (repoId?.startsWith("github.com/")) {
    const gh = parseGithubId(repoId)!;
    await collectGithub(ctx, c, gh.owner, gh.repo);
  } else if (repoId?.startsWith("gitlab.com/")) {
    await collectGitlab(ctx, c, repoId.slice("gitlab.com/".length));
  } else if (repoId?.startsWith("codeberg.org/")) {
    await collectCodeberg(ctx, c, repoId.slice("codeberg.org/".length));
  } else if (pkg) {
    await collectPackage(ctx, c, url, pkg);
  } else if (flathub) {
    await collectFlathub(ctx, c, flathub);
  } else {
    const host = parsedUrl(url)?.hostname.toLowerCase() ?? "";
    c.kind = host === "huggingface.co" ? (url.includes("/spaces/") ? "space" : "model") : host === "open-vsx.org" || host === "wordpress.org" ? "extension" : "app-listing";
    if (host === "f-droid.org") c.license = FOSS_UNSPECIFIED;
    c.warnings.push("Limited details for this kind of link. Use read_tool_docs to read the page, or verify_lead to find its source code.");
  }

  const now = ctx.now;
  const healthFacts: HealthFacts = {
    archived: c.archived,
    lastActivity: c.facts.lastActivity,
    latestRelease: c.facts.latestRelease,
    stars: c.facts.stars,
    forks: c.facts.forks,
    contributors: c.facts.contributors,
    openIssues: c.facts.openIssues,
    scorecard: c.facts.scorecard,
    knownVulnerabilities: c.facts.knownVulnerabilities,
    awesomeLists: c.facts.awesomeLists,
    packagedIn: c.facts.packagedIn.length || undefined,
  };
  return {
    url,
    id: c.id,
    name: c.name,
    description: c.description,
    kind: c.kind,
    repoUrl: c.repoUrl,
    homepage: c.homepage,
    license: classifyLicense(c.license),
    health: assessHealth(healthFacts, now),
    setup: assessSetup({
      kind: c.kind,
      readme: c.readme,
      homepage: c.homepage,
      releaseAssets: c.releaseAssets,
      packagedIn: c.facts.packagedIn,
      hasDockerCompose: c.hasDockerCompose,
      installHints: c.installHints,
    }),
    facts: c.facts,
    warnings: c.warnings,
  };
}
