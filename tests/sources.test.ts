import { describe, expect, it } from "vitest";
import { hfModelToCandidate, mcpEntryToCandidate } from "../src/sources/ai.js";
import { awesomeEntryToCandidate, matchEntries, parseAwesomeMarkdown } from "../src/sources/awesome.js";
import { flathubToCandidate, matchYunohost } from "../src/sources/catalogs.js";
import { getCommunityVoice, mentionsName } from "../src/sources/community.js";
import { repologyNames } from "../src/sources/enrich.js";
import { wordpressToCandidate } from "../src/sources/extensions.js";
import { forgejoToCandidate } from "../src/sources/forges.js";
import { githubSource, parseGithubId, repoToCandidate, type GhRepo } from "../src/sources/github.js";
import { npmToCandidate, wantedEcosystems } from "../src/sources/packages.js";
import { selectSources } from "../src/sources/registry.js";
import { spec, testConfig, testContext } from "./helpers.js";

const AWESOME_MD = `
# Awesome Selfhosted
## Table of contents
- [Analytics](#analytics)
## Software
### Money, Budgeting & Management
- [InvoicePlane](https://www.invoiceplane.com/) - Manage quotes, invoices, payments and customers for your small business. ([Source Code](https://github.com/InvoicePlane/InvoicePlane)) \`MIT\` \`PHP\`
- [Firefly III](https://firefly-iii.org/) - Personal finances manager. ([Demo](https://demo.firefly-iii.org/), [Source Code](https://github.com/firefly-iii/firefly-iii)) \`AGPL-3.0\` \`PHP/Docker\`
### Photo Galleries
- [Immich](https://immich.app/) - Photo and video backup. ([Source Code](https://github.com/immich-app/immich)) \`AGPL-3.0\` \`Docker\`
## License
- [CC-BY-SA](https://creativecommons.org) - not software
`;

const GH_REPO: GhRepo = {
  full_name: "InvoiceNinja/invoiceninja",
  name: "invoiceninja",
  description: "Invoices, Expenses and Tasks",
  html_url: "https://github.com/invoiceninja/invoiceninja",
  homepage: "https://invoiceninja.com",
  stargazers_count: 9600,
  forks_count: 2600,
  open_issues_count: 900,
  license: { spdx_id: "NOASSERTION" },
  language: "PHP",
  topics: ["invoice"],
  pushed_at: "2026-10-10T00:00:00Z",
  archived: false,
  fork: false,
  default_branch: "v5-stable",
};

describe("awesome lists", () => {
  it("parses entries, categories, source links and tags, skipping non-software sections", () => {
    const entries = parseAwesomeMarkdown(AWESOME_MD);
    expect(entries.map((e) => e.name)).toEqual(["InvoicePlane", "Firefly III", "Immich"]);
    expect(entries[0]).toMatchObject({
      category: "Money, Budgeting & Management",
      sourceCode: "https://github.com/InvoicePlane/InvoicePlane",
      tags: ["MIT", "PHP"],
      description: "Manage quotes, invoices, payments and customers for your small business.",
    });
    expect(entries[1]?.description).toBe("Personal finances manager.");
  });

  it("turns entries into repo candidates and matches them to a request", () => {
    const entries = parseAwesomeMarkdown(AWESOME_MD);
    const c = awesomeEntryToCandidate(entries[0]!, "awesome-selfhosted");
    expect(c).toMatchObject({ id: "github.com/invoiceplane/invoiceplane", kind: "repo", license: "MIT", language: "PHP", homepage: "https://www.invoiceplane.com/", platforms: ["self-host"] });
    expect(matchEntries(entries, ["invoices"], 5).map((e) => e.name)).toEqual(["InvoicePlane"]);
    expect(matchEntries(entries, ["photo backup"], 5).map((e) => e.name)).toEqual(["Immich"]);
  });
});

describe("GitHub", () => {
  it("maps repos and parses ids", () => {
    const c = repoToCandidate(GH_REPO);
    expect(c).toMatchObject({ id: "github.com/invoiceninja/invoiceninja", stars: 9600, license: "NOASSERTION", lastActivity: "2026-10-10T00:00:00Z" });
    expect(parseGithubId("https://github.com/a/b.git")).toEqual({ owner: "a", repo: "b" });
    expect(parseGithubId("https://gitlab.com/a/b")).toBeUndefined();
  });

  it("uses a small query budget without a token and sends auth with one", async () => {
    const routes = [{ match: /search\/repositories/, body: { total_count: 1, items: [GH_REPO] } }];
    const anon = testContext(routes);
    await githubSource.search(spec({ keywords: ["invoice", "billing", "quotes", "estimates"] }), anon);
    expect(anon.fetch.calls).toHaveLength(3);
    expect((anon.fetch.calls[0]?.init?.headers as Record<string, string>).Authorization).toBeUndefined();

    const authed = testContext(routes, { githubToken: "t0ken" });
    await githubSource.search(spec({ keywords: ["invoice", "billing", "quotes", "estimates"] }), authed);
    expect(authed.fetch.calls.length).toBeGreaterThan(3);
    expect((authed.fetch.calls[0]?.init?.headers as Record<string, string>).Authorization).toBe("Bearer t0ken");
  });

  it("refuses code search without a token", async () => {
    await expect(githubSource.search(spec({ mode: "code" }), testContext([]))).rejects.toThrow(/GITHUB_TOKEN/);
  });
});

describe("catalog and registry mappers", () => {
  it("Flathub listing → Linux app with install hint", () => {
    const c = flathubToCandidate({ name: "Invoice Ninja", summary: "Create invoices", app_id: "com.invoiceninja.InvoiceNinja", project_license: "AAL", installs_last_month: 366, updated_at: 1779266669 });
    expect(c).toMatchObject({ id: "flathub:com.invoiceninja.invoiceninja", platforms: ["linux"], downloads: 366, downloadsPeriod: "month" });
    expect(c.lastActivity?.startsWith("2026-")).toBe(true);
    expect(c.installHints?.[0]?.level).toBe("easy-install");
  });

  it("YunoHost matching uses 'alternative to' and skips broken packages", () => {
    const apps = [
      { id: "nextcloud", state: "working", potential_alternative_to: ["Dropbox", "Google Drive"], manifest: { name: "Nextcloud", description: { en: "Online storage" } } },
      { id: "broken", state: "notworking", potential_alternative_to: ["Dropbox"], manifest: { name: "Broken", description: { en: "Online storage" } } },
      { id: "wiki", state: "working", manifest: { name: "Wiki", description: { en: "Docs" } } },
    ];
    expect(matchYunohost(apps, ["dropbox"], ["Dropbox"], 5).map((a) => a.id)).toEqual(["nextcloud"]);
  });

  it("maps Codeberg mirrors as copies, npm, WordPress, Hugging Face and MCP entries", () => {
    const fj = forgejoToCandidate({ full_name: "a/b", name: "b", description: "", html_url: "https://codeberg.org/a/b", website: "", stars_count: 1, forks_count: 0, open_issues_count: 0, updated_at: "2026-01-01", archived: false, fork: false, mirror: true, language: "Go" }, "codeberg", "codeberg.org");
    expect(fj.fork).toBe(true);
    expect(npmToCandidate({ downloads: { monthly: 5 }, package: { name: "pdf-lib", license: "MIT", links: { repository: "git+https://github.com/Hopding/pdf-lib.git" } } })).toMatchObject({ id: "npm:pdf-lib", downloads: 5, kind: "package" });
    expect(wordpressToCandidate({ name: "PDF &amp; Invoices", slug: "pdf-inv", last_updated: "2026-10-01 3:14pm GMT" })).toMatchObject({ name: "PDF & Invoices", url: "https://wordpress.org/plugins/pdf-inv/" });
    expect(hfModelToCandidate({ id: "openai/whisper", tags: ["license:mit", "asr"], likes: 10 })).toMatchObject({ license: "mit", kind: "model", url: "https://huggingface.co/openai/whisper" });
    expect(mcpEntryToCandidate({ server: { name: "io.github/x", repository: { url: "https://github.com/x/y" } }, _meta: { "io.modelcontextprotocol.registry/official": { status: "deprecated" } } }).archived).toBe(true);
  });

  it("derives package ecosystems from languages", () => {
    expect([...wantedEcosystems(spec({ languages: ["TypeScript", "Rust"], ecosystems: ["pypi"] }))].sort()).toEqual(["crates", "npm", "pypi"]);
  });

  it("guesses Repology names", () => {
    expect(repologyNames("Invoice Ninja")).toEqual(["invoice-ninja", "invoiceninja"]);
  });
});

describe("source selection", () => {
  it("picks sources by mode, platform and ecosystem, and honours disabled ones", () => {
    const ids = (s: ReturnType<typeof spec>, disabled: string[] = []) => selectSources(s, testConfig({ disabledSources: new Set(disabled) })).map((x) => x.id);
    expect(ids(spec({ mode: "app" }))).toEqual(expect.arrayContaining(["github", "awesome-selfhosted", "flathub", "fdroid", "yunohost"]));
    expect(ids(spec({ mode: "app", platforms: ["android"] }))).not.toContain("flathub");
    expect(ids(spec({ mode: "library", languages: ["Python"] }))).toEqual(expect.arrayContaining(["github", "ecosystems"]));
    expect(ids(spec({ mode: "library", languages: ["Python"] }))).not.toContain("npm");
    expect(ids(spec({ mode: "extension", extensionFor: "vscode" }))).toContain("openvsx");
    expect(ids(spec({ mode: "ai" }))).toEqual(expect.arrayContaining(["huggingface", "mcp-registry"]));
    expect(ids(spec({ mode: "app" }), ["flathub"])).not.toContain("flathub");
    expect(selectSources(spec(), testConfig(), ["npm"]).map((s) => s.id)).toEqual(["npm"]);
  });
});

describe("community voice", () => {
  it("keeps only real mentions and reports failing sites", async () => {
    const ctx = testContext([
      { match: /hn\.algolia/, body: { hits: [{ objectID: "1", title: "Show HN: Invoice Ninja v5", points: 120, num_comments: 40, created_at: "2026-01-01" }, { objectID: "2", title: "Unrelated ninja story", points: 999, num_comments: 1, created_at: "2026-01-01" }] } },
      { match: /stackexchange/, status: 500, body: {} },
      { match: /lemmy/, body: { posts: [{ post: { name: "Invoiceninja self-hosted review", ap_id: "https://lemmy.world/post/1", published: "2026-02-01" }, counts: { score: 30, comments: 9 } }] } },
    ]);
    const voice = await getCommunityVoice(ctx, "Invoice Ninja");
    expect(voice.mentions.map((m) => m.source)).toEqual(["hackernews", "lemmy"]);
    expect(voice.totals).toEqual({ hackernews: 1, stackoverflow: 0, lemmy: 1 });
    expect(voice.warnings[0]).toMatch(/^stackoverflow:/);
    expect(mentionsName("Why I use FireFly-III", "Firefly III")).toBe(true);
  });
});
