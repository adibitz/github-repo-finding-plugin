// Regression tests for issues found in code review (2026-10-18). Each failed before its fix.
import { describe, expect, it } from "vitest";
import { applyHardFilters } from "../src/core/filters.js";
import { classifyLicense, licenseAllowed } from "../src/core/license.js";
import { getToolDetails, parsePackageUrl } from "../src/engine/details.js";
import { createPageFetcher, publicOnlyLookup } from "../src/engine/page-fetch.js";
import { isPrivateAddress } from "../src/engine/safe-url.js";
import { verifyLead } from "../src/engine/verify.js";
import { codexBlock, upsertTomlServer } from "../src/installer/config-edit.js";
import { isAllowedHttpRequest } from "../src/server/transports.js";
import { fdroidToCandidate, flathubToCandidate } from "../src/sources/catalogs.js";
import { getPackagedIn } from "../src/sources/enrich.js";
import { githubSource } from "../src/sources/github.js";
import { crateToCandidate } from "../src/sources/packages.js";
import { NOW, spec, testContext } from "./helpers.js";

describe("license expressions", () => {
  it("judges AND expressions by their most restrictive part", () => {
    expect(classifyLicense("Apache-2.0 AND Commons-Clause").category).toBe("source-available");
    expect(classifyLicense("MIT AND GPL-3.0").category).toBe("copyleft");
    expect(licenseAllowed("MIT AND SSPL-1.0", ["MIT"])).toBe(false);
    expect(licenseAllowed("MIT OR SSPL-1.0", ["MIT"])).toBe(true);
  });

  it("recognises proprietary apps and rejects them for open-source-only searches", () => {
    expect(classifyLicense("Proprietary")).toMatchObject({ category: "proprietary", isOpenSource: false });
    expect(classifyLicense("LicenseRef-proprietary=https://zoom.us/terms").category).toBe("proprietary");
    const zoom = flathubToCandidate({ name: "Zoom", summary: "Video calls", app_id: "us.zoom.Zoom", is_free_license: false });
    expect(applyHardFilters([zoom], spec(), NOW).kept).toEqual([]);
    expect(applyHardFilters([zoom], spec({ openSourceOnly: false }), NOW).kept).toHaveLength(1);
  });

  it("marks F-Droid apps as open source instead of 'no license'", () => {
    const app = fdroidToCandidate({ name: "Invoice", summary: "x", url: "https://f-droid.org/en/packages/com.x/" });
    expect(classifyLicense(app.license)).toMatchObject({ isOpenSource: true, businessUse: "yes" });
  });

  it("copes with non-string license values from old npm packages", () => {
    expect(classifyLicense({ type: "MIT" } as unknown as string).category).toBe("permissive");
    expect(classifyLicense(42 as unknown as string).category).toBe("none");
  });
});

describe("URL parsing is anchored to the real host", () => {
  it("doesn't treat look-alike paths on other sites as packages", async () => {
    expect(parsePackageUrl("https://scam.example/npmjs.com/package/react")).toBeUndefined();
    expect(parsePackageUrl("https://www.npmjs.com/package/react")).toEqual({ ecosystem: "npm", name: "react" });
    const r = await verifyLead(testContext([{ match: /scam\.example/, text: "<html>buy</html>" }]), { url: "https://scam.example/npmjs.com/package/react" }, async () => ["93.184.215.14"]);
    expect(r.status).not.toBe("verified");
  });
});

describe("SSRF guard covers IPv6 tricks", () => {
  it.each(["::127.0.0.1", "64:ff9b::a9fe:a9fe", "2002:7f00:1::1", "fec0::1", "2001:db8::1", "2001:0:4136:e378:8000:63bf:3fff:fdd2"])("%s is not public", (ip) => {
    expect(isPrivateAddress(ip)).toBe(true);
  });
  it("still allows normal global IPv6", () => {
    expect(isPrivateAddress("2606:4700::1111")).toBe(false);
    expect(isPrivateAddress("2a00:1450:4001:80b::200e")).toBe(false);
  });
});

describe("connect-time DNS check", () => {
  it("refuses to connect when a name resolves to a local address", async () => {
    const err = await new Promise<Error | null>((resolve) => publicOnlyLookup("localhost", {}, (e) => resolve(e)));
    expect(err?.message).toMatch(/Local network addresses are not allowed/);
  });

  it("the real page fetcher never connects to localhost", async () => {
    const fetchPage = createPageFetcher("test", 3000);
    await expect(fetchPage(new URL("http://localhost:9/"))).rejects.toThrow(/Local network addresses/);
  });
});

describe("details batch resilience", () => {
  it("one odd package doesn't fail the record", async () => {
    const ctx = testContext([{ match: /registry\.npmjs\.org\/oldpkg/, body: { description: "old", license: { type: "MIT" } } }]);
    const d = await getToolDetails(ctx, "https://www.npmjs.com/package/oldpkg");
    expect(d.license.category).toBe("permissive");
  });
});

describe("private repositories are never exposed", () => {
  it("drops private repos from search results", async () => {
    const repo = (name: string, priv: boolean) => ({ full_name: `me/${name}`, name, description: "invoice", html_url: `https://github.com/me/${name}`, homepage: null, stargazers_count: 100, forks_count: 1, open_issues_count: 0, license: null, language: null, pushed_at: "2026-10-01", archived: false, fork: false, default_branch: "main", private: priv });
    const ctx = testContext([{ match: /search\/repositories/, body: { items: [repo("secret", true), repo("open", false)] } }], { githubToken: "t" });
    const found = await githubSource.search(spec(), ctx);
    expect(found.map((c) => c.name)).not.toContain("secret");
  });

  it("treats a private repo as not found in details", async () => {
    const ctx = testContext(
      [{ match: /api\.github\.com\/repos\/me\/secret$/, body: { full_name: "me/secret", name: "secret", description: "private stuff", html_url: "https://github.com/me/secret", private: true, stargazers_count: 0, forks_count: 0, open_issues_count: 0, license: null, language: null, pushed_at: "2026-10-01", archived: false, fork: false, default_branch: "main", homepage: null } }],
      { githubToken: "t" },
    );
    const d = await getToolDetails(ctx, "https://github.com/me/secret");
    expect(d.description).not.toContain("private stuff");
  });
});

describe("Codex TOML header variants", () => {
  it("finds quoted and commented headers instead of adding a duplicate", () => {
    const block = codexBlock("find-github-tool", { command: "node", args: ["x"] }, []);
    for (const header of ['[mcp_servers."find-github-tool"]', "[mcp_servers.find-github-tool] # mine", "  [mcp_servers.find-github-tool]"]) {
      const out = upsertTomlServer(`${header}\ncommand = "old"\n`, "find-github-tool", block);
      expect(out.match(/mcp_servers\.?"?find-github-tool"?\]/g), header).toHaveLength(1);
      expect(out).not.toContain('"old"');
    }
  });
});

describe("HTTP transport request checks", () => {
  it("blocks DNS-rebinding hosts and requires the token when one is set", () => {
    const local = { host: "127.0.0.1", port: 3333 };
    expect(isAllowedHttpRequest({ host: "127.0.0.1:3333" }, local, undefined)).toBe(true);
    expect(isAllowedHttpRequest({ host: "localhost:3333" }, local, undefined)).toBe(true);
    expect(isAllowedHttpRequest({ host: "evil.example:3333" }, local, undefined)).toBe(false);
    expect(isAllowedHttpRequest({ host: "localhost:3333", origin: "https://evil.example" }, local, undefined)).toBe(false);
    expect(isAllowedHttpRequest({ host: "tools.example.com", authorization: "Bearer s3cret" }, { host: "0.0.0.0", port: 3333 }, "s3cret")).toBe(true);
    expect(isAllowedHttpRequest({ host: "tools.example.com", authorization: "Bearer wrong" }, { host: "0.0.0.0", port: 3333 }, "s3cret")).toBe(false);
  });
});

describe("enrichment accuracy", () => {
  it("labels crates.io's 90-day downloads as a monthly figure", () => {
    const c = crateToCandidate({ name: "x", description: null, downloads: 1000, recent_downloads: 900, updated_at: "2026-01-01", repository: null, homepage: null });
    expect(c.downloads).toBe(300);
  });

  it("ignores Repology packages that describe a different project with the same name", async () => {
    const ctx = testContext([{ match: /repology\.org\/api\/v1\/project\/notes/, body: [{ repo: "winget", summary: "Sticky notes for the desktop" }] }]);
    expect(await getPackagedIn(ctx, "notes", "A command-line tool for kubernetes cluster audits")).toEqual([]);
    expect(await getPackagedIn(ctx, "notes", "Sticky notes on your desktop")).toEqual(["winget"]);
  });
});


