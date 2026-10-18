import { describe, expect, it } from "vitest";
import { getToolDetails, parsePackageUrl } from "../src/engine/details.js";
import { extractCodeLinks, htmlToText, readToolDocs } from "../src/engine/docs.js";
import { assertPublicUrl, isPrivateAddress, UnsafeUrlError } from "../src/engine/safe-url.js";
import { searchTools } from "../src/engine/search.js";
import { verifyLead } from "../src/engine/verify.js";
import { spec, testContext } from "./helpers.js";

const publicResolver = async () => ["93.184.215.14"];

const ghRepo = (name: string, extra: Record<string, unknown> = {}) => ({
  full_name: `acme/${name}`,
  name,
  description: `${name} invoice manager`,
  html_url: `https://github.com/acme/${name}`,
  homepage: null,
  stargazers_count: 800,
  forks_count: 90,
  open_issues_count: 10,
  license: { spdx_id: "MIT" },
  language: "PHP",
  topics: ["invoice"],
  pushed_at: "2026-10-01T00:00:00Z",
  archived: false,
  fork: false,
  default_branch: "main",
  ...extra,
});

describe("searchTools", () => {
  it("merges sources, filters, pre-ranks and turns source failures into warnings", async () => {
    const ctx = testContext([
      {
        match: /api\.github\.com\/search\/repositories/,
        body: { total_count: 3, items: [ghRepo("invoicely"), ghRepo("oldinvoice", { pushed_at: "2020-01-01T00:00:00Z" }), ghRepo("weather", { description: "weather app", topics: [] })] },
      },
      { match: /awesome-selfhosted\/master\/README/, text: "## Software\n### Money\n- [Invoicely](https://invoicely.example) - Send invoices. ([Source Code](https://github.com/acme/invoicely)) `MIT` `PHP`\n" },
      { match: /flathub\.org/, status: 500, body: {} },
    ]);
    const result = await searchTools(spec({ mode: "app", keywords: ["invoice"] }), ctx);

    const names = result.candidates.map((c) => c.name);
    expect(names).toContain("invoicely");
    expect(names).not.toContain("weather");
    const invoicely = result.candidates.find((c) => c.name === "invoicely")!;
    expect(invoicely.sources).toEqual(expect.arrayContaining(["github", "awesome-selfhosted"]));
    expect(result.rejected.some((r) => r.name === "oldinvoice" && /Not updated/.test(r.reason))).toBe(true);
    expect(result.warnings.some((w) => w.source === "flathub")).toBe(true);
    expect(result.sourcesUsed.find((s) => s.id === "flathub")?.ok).toBe(false);
    expect(result.notes.some((n) => n.includes("No GITHUB_TOKEN"))).toBe(true);
    expect(result.checkedAt).toBe("2026-10-18");
  });

  it("suggests broadening when few results come back", async () => {
    const result = await searchTools(spec({ keywords: ["zzqx"] }), testContext([]), ["github"]);
    expect(result.candidates).toEqual([]);
    expect(result.warnings).toHaveLength(1);
    expect(result.notes.some((n) => n.startsWith("Few matches"))).toBe(true);
  });
});

describe("getToolDetails", () => {
  it("combines GitHub, deps.dev, README, Repology and awesome data into plain verdicts", async () => {
    const ctx = testContext([
      { match: /api\.github\.com\/repos\/acme\/invoicely\/releases\/latest/, body: { published_at: "2026-09-20T00:00:00Z", tag_name: "v2.0", assets: [{ name: "Invoicely-Setup-2.0.exe", download_count: 5 }] } },
      { match: /api\.github\.com\/repos\/acme\/invoicely$/, body: ghRepo("invoicely") },
      { match: /raw\.githubusercontent\.com\/acme\/invoicely\/HEAD\/README\.md/, text: "# Invoicely\nTry the hosted version: sign up for free at invoicely.example.\nOr run `docker compose up`." },
      { match: /api\.deps\.dev/, body: { starsCount: 800, scorecard: { overallScore: 6.2 } } },
      { match: /awesome\.ecosyste\.ms\/api\/v1\/projects\/lookup/, body: { lists_url: "https://awesome.ecosyste.ms/api/v1/projects/1/lists" } },
      { match: /awesome\.ecosyste\.ms\/api\/v1\/projects\/1\/lists/, body: [{}, {}] },
      { match: /repology\.org\/api\/v1\/project\/invoicely/, body: [{ repo: "winget" }, { repo: "flathub" }] },
    ]);
    const d = await getToolDetails(ctx, "https://github.com/acme/invoicely");
    expect(d.id).toBe("github.com/acme/invoicely");
    expect(d.license).toMatchObject({ category: "permissive", businessUse: "yes" });
    expect(d.health.status).toBe("active");
    expect(d.facts).toMatchObject({ stars: 800, scorecard: 6.2, awesomeLists: 2, packagedIn: ["winget", "flathub"], latestVersion: "v2.0" });
    expect(d.setup.level).toBe("easy-hosted");
    expect(d.setup.hints.map((h) => h.method)).toEqual(expect.arrayContaining(["hosted", "windows-installer", "winget", "flathub", "docker-compose"]));
    expect(d.warnings).toEqual([]);
  });

  it("keeps going when enrichment steps fail and records why", async () => {
    const ctx = testContext([
      { match: /api\.github\.com\/repos\/acme\/x$/, status: 403, body: {}, headers: { "x-ratelimit-remaining": "0" } },
      { match: /api\.deps\.dev/, body: { starsCount: 50, description: "from deps.dev" } },
    ]);
    const d = await getToolDetails(ctx, "https://github.com/acme/x");
    expect(d.description).toBe("from deps.dev");
    expect(d.facts.stars).toBe(50);
    expect(d.warnings.some((w) => w.startsWith("GitHub repo: Rate limit"))).toBe(true);
  });

  it("follows a package to its repository and checks vulnerabilities", async () => {
    const ctx = testContext([
      { match: /registry\.npmjs\.org\/pdf-lib/, body: { description: "Create PDFs", license: "MIT", repository: { url: "git+https://github.com/acme/pdflib.git" }, "dist-tags": { latest: "1.2.3" } } },
      { match: /api\.github\.com\/repos\/acme\/pdflib$/, body: ghRepo("pdflib") },
      { match: /api\.osv\.dev/, body: { vulns: [{ id: "GHSA-1" }] } },
    ]);
    const d = await getToolDetails(ctx, "https://www.npmjs.com/package/pdf-lib");
    expect(d).toMatchObject({ id: "npm:pdf-lib", kind: "package", repoUrl: "https://github.com/acme/pdflib" });
    expect(d.facts.knownVulnerabilities).toBe(1);
    expect(d.facts.latestVersion).toBe("1.2.3");
  });

  it("recognises package URLs", () => {
    expect(parsePackageUrl("https://www.npmjs.com/package/@scope/name")).toEqual({ ecosystem: "npm", name: "@scope/name" });
    expect(parsePackageUrl("https://pypi.org/project/requests/")).toEqual({ ecosystem: "pypi", name: "requests" });
    expect(parsePackageUrl("https://crates.io/crates/serde")).toEqual({ ecosystem: "crates", name: "serde" });
    expect(parsePackageUrl("https://example.com")).toBeUndefined();
  });
});

describe("safe URLs", () => {
  it("knows private addresses", () => {
    for (const ip of ["127.0.0.1", "10.1.2.3", "172.16.0.1", "192.168.1.1", "169.254.169.254", "100.64.0.1", "0.0.0.0", "::1", "fd00::1", "::ffff:127.0.0.1"]) {
      expect(isPrivateAddress(ip), ip).toBe(true);
    }
    for (const ip of ["93.184.215.14", "140.82.112.3", "2606:4700::1111"]) expect(isPrivateAddress(ip), ip).toBe(false);
  });

  it("blocks non-http, credentials, localhost and hosts that resolve privately", async () => {
    await expect(assertPublicUrl("file:///etc/passwd", publicResolver)).rejects.toBeInstanceOf(UnsafeUrlError);
    await expect(assertPublicUrl("https://user:pw@example.com", publicResolver)).rejects.toBeInstanceOf(UnsafeUrlError);
    await expect(assertPublicUrl("http://localhost:8080", publicResolver)).rejects.toBeInstanceOf(UnsafeUrlError);
    await expect(assertPublicUrl("http://169.254.169.254/latest/meta-data", publicResolver)).rejects.toBeInstanceOf(UnsafeUrlError);
    await expect(assertPublicUrl("https://evil.example", async () => ["10.0.0.5"])).rejects.toBeInstanceOf(UnsafeUrlError);
    await expect(assertPublicUrl("https://example.com/page", publicResolver)).resolves.toBeInstanceOf(URL);
  });
});

describe("docs", () => {
  it("extracts readable text and code links from HTML", () => {
    const html = `<html><head><title>Invoicely</title><script>alert(1)</script></head><body><nav>menu</nav><h1>Invoicely</h1><p>Send invoices &amp; get paid.</p>
      <a href="https://github.com/acme/invoicely">GitHub</a> <a href="https://github.com/acme/invoicely/issues">Issues</a> <a href="https://github.com/sponsors/acme">Sponsor</a></body></html>`;
    const { title, text } = htmlToText(html);
    expect(title).toBe("Invoicely");
    expect(text).toContain("Send invoices & get paid.");
    expect(text).not.toContain("alert");
    expect(text).not.toContain("menu");
    expect(extractCodeLinks(html)).toEqual(["https://github.com/acme/invoicely"]);
  });

  it("reads a README for repos and labels it untrusted", async () => {
    const ctx = testContext([{ match: /raw\.githubusercontent\.com\/acme\/x\/HEAD\/README\.md/, text: "# X\n" + "word ".repeat(500) }]);
    const docs = await readToolDocs(ctx, "https://github.com/acme/x", 600);
    expect(docs.truncated).toBe(true);
    expect(docs.text.length).toBeLessThan(700);
    expect(docs.notice).toMatch(/UNTRUSTED/);
  });

  it("refuses to read private network pages, including after a redirect", async () => {
    await expect(readToolDocs(testContext([]), "http://127.0.0.1/admin", 1000)).rejects.toBeInstanceOf(UnsafeUrlError);
    const ctx = testContext([{ match: /^https:\/\/example\.com\/go$/, status: 302, text: "", headers: { location: "http://192.168.0.1/secret" } }]);
    await expect(readToolDocs(ctx, "https://example.com/go", 1000, publicResolver)).rejects.toBeInstanceOf(UnsafeUrlError);
  });
});

describe("verifyLead", () => {
  it("verifies a repo via deps.dev without using GitHub quota", async () => {
    const ctx = testContext([{ match: /api\.deps\.dev\/v3\/projects\/github\.com%2Facme%2Finvoicely/, body: { starsCount: 800, description: "Invoices", license: "MIT" } }]);
    const r = await verifyLead(ctx, { url: "https://github.com/acme/invoicely" });
    expect(r.status).toBe("verified");
    expect(r.candidate).toMatchObject({ id: "github.com/acme/invoicely", stars: 800 });
    expect(ctx.fetch.calls.some((c) => c.url.includes("api.github.com"))).toBe(false);
  });

  it("reports missing repos and website-only products", async () => {
    expect((await verifyLead(testContext([]), { url: "https://github.com/acme/nope" })).status).toBe("not-found");
    const ctx = testContext([{ match: /^https:\/\/saas\.example\/$/, text: "<html><body><h1>Pricing</h1></body></html>" }]);
    expect((await verifyLead(ctx, { url: "https://saas.example/" }, publicResolver)).status).toBe("website-only");
  });

  it("finds a website's source code", async () => {
    const ctx = testContext([
      { match: /^https:\/\/invoicely\.example\/$/, text: '<html><body><a href="https://github.com/acme/invoicely">Code</a></body></html>' },
      { match: /api\.deps\.dev/, body: { starsCount: 800 } },
    ]);
    const r = await verifyLead(ctx, { url: "https://invoicely.example/" }, publicResolver);
    expect(r.status).toBe("verified");
    expect(r.candidate?.homepage).toBe("https://invoicely.example/");
  });

  it("returns possible matches for a name, exact name first", async () => {
    const ctx = testContext([{ match: /search\/repositories/, body: { items: [ghRepo("invoicely-fork"), ghRepo("Invoicely")] } }]);
    const r = await verifyLead(ctx, { name: "invoicely" });
    expect(r.status).toBe("possible-matches");
    expect(r.matches?.[0]?.name).toBe("Invoicely");
  });
});
