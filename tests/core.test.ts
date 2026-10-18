import { describe, expect, it } from "vitest";
import { applyHardFilters } from "../src/core/filters.js";
import { assessHealth, looksInflated } from "../src/core/health.js";
import { classifyLicense, licenseAllowed, normalizeLicense } from "../src/core/license.js";
import { canonicalRepoId, mergeCandidates, mergeListingsByName } from "../src/core/merge.js";
import { githubRepoQueries, textQueries } from "../src/core/queries.js";
import { fitScore, popularityScore, rankTools, weightsFor } from "../src/core/score.js";
import { assessSetup, easeScore } from "../src/core/setup.js";
import { effectiveMinStars, parseSpec } from "../src/core/spec.js";
import { cleanText, humanAgo, relevanceScore, stem, tokenize } from "../src/core/text.js";
import { looksLikeLibrary } from "../src/engine/search.js";
import { candidate, NOW, spec } from "./helpers.js";

describe("spec", () => {
  it("fills defaults for everyday users", () => {
    const s = parseSpec({ need: "invoice app", keywords: ["invoice"] });
    expect(s).toMatchObject({ mode: "any", techLevel: "beginner", budget: "free", openSourceOnly: true, activeWithinMonths: 12, maxResults: 20 });
    expect(effectiveMinStars(s)).toBe(50);
    expect(effectiveMinStars({ ...s, techLevel: "developer" })).toBe(10);
    expect(effectiveMinStars({ ...s, minStars: 0 })).toBe(0);
  });

  it("rejects missing keywords and oversized input", () => {
    expect(() => parseSpec({ need: "x y z", keywords: [] })).toThrow();
    expect(() => parseSpec({ need: "ok need", keywords: ["a".repeat(201)] })).toThrow();
    expect(() => parseSpec({ need: "ok need", keywords: ["x"], mode: "nonsense" })).toThrow();
  });
});

describe("license", () => {
  it.each([
    ["MIT", "permissive", "yes"],
    ["Apache-2.0", "permissive", "yes"],
    ["MIT License", "permissive", "yes"],
    ["GPL-3.0", "copyleft", "yes-with-conditions"],
    ["AGPL-3.0-or-later", "copyleft", "yes-with-conditions"],
    ["MPL-2.0", "weak-copyleft", "yes"],
    ["Elastic-2.0", "source-available", "check-terms"],
    ["BUSL-1.1", "source-available", "check-terms"],
    ["NOASSERTION", "unknown", "unclear"],
    [undefined, "none", "unclear"],
  ] as const)("%s → %s / %s", (raw, category, businessUse) => {
    const info = classifyLicense(raw);
    expect(info.category).toBe(category);
    expect(info.businessUse).toBe(businessUse);
    expect(info.plain.length).toBeGreaterThan(10);
  });

  it("judges dual licenses by their most permissive part", () => {
    expect(classifyLicense("MIT OR Apache-2.0").category).toBe("permissive");
    expect(classifyLicense("(GPL-2.0-only OR MIT)").category).toBe("permissive");
  });

  it("normalises aliases and checks allow-lists", () => {
    expect(normalizeLicense("apache 2.0")).toBe("APACHE-2.0");
    expect(normalizeLicense("GPLv3")).toBe("GPL-3.0");
    expect(licenseAllowed("MIT", [])).toBe(true);
    expect(licenseAllowed("MIT", ["mit", "Apache-2.0"])).toBe(true);
    expect(licenseAllowed("GPL-3.0", ["MIT"])).toBe(false);
    expect(licenseAllowed(undefined, ["MIT"])).toBe(false);
  });
});

describe("text", () => {
  it("tokenizes without stop words", () => {
    expect(tokenize("I need a free Invoice app for my shop")).toEqual(["invoice", "shop"]);
  });

  it("scores name and topic hits above description hits", () => {
    const byName = relevanceScore(["invoice"], "invoice-ninja", "billing for freelancers");
    const byDescription = relevanceScore(["invoice"], "ninja", "send an invoice fast");
    const none = relevanceScore(["invoice"], "photos", "gallery app");
    expect(byName).toBe(1);
    expect(byDescription).toBe(0.5);
    expect(none).toBe(0);
  });

  it("stems word forms so they compare equal", () => {
    expect(stem("invoices")).toBe(stem("invoice"));
    expect(stem("invoicing")).toBe(stem("invoice"));
    expect(stem("extraction")).toBe(stem("extractor"));
    expect(stem("parser")).toBe(stem("parsing"));
    expect(stem("classes")).toBe(stem("class"));
    expect(stem("libraries")).toBe("library");
    expect(stem("pdf")).toBe("pdf");
  });

  it("treats search phrases as alternatives, not requirements", () => {
    // Matching one synonym well must not be diluted by the other synonyms.
    const synonyms = ["invoice", "invoicing", "billing", "QuickBooks alternative"];
    expect(relevanceScore(synonyms, "InvoicePlane", "Manage quotes, invoices and payments")).toBeGreaterThanOrEqual(0.9);
    expect(relevanceScore(["pdf text extraction"], "papero-pdf-text-extractor", "")).toBe(1);
    expect(relevanceScore(["pdf parser"], "pypdf", "A pure-python PDF library")).toBeGreaterThan(0.2);
    expect(relevanceScore([], "x", "y")).toBe(0);
  });

  it("cleans HTML and truncates", () => {
    expect(cleanText("<b>Hello</b> &amp; welcome", 100)).toBe("Hello & welcome");
    expect(cleanText("a".repeat(50), 10)).toHaveLength(10);
    expect(cleanText(null)).toBe("");
  });

  it("describes ages in words", () => {
    expect(humanAgo("2026-10-15T12:00:00Z", NOW)).toBe("3 days ago");
    expect(humanAgo("2026-04-18T12:00:00Z", NOW)).toBe("6 months ago");
    expect(humanAgo("2023-10-18T12:00:00Z", NOW)).toBe("3 years ago");
    expect(humanAgo(undefined, NOW)).toBeUndefined();
  });
});

describe("queries", () => {
  it("builds GitHub queries: words (best match), then a topic sorted by stars, then other phrases", () => {
    const qs = githubRepoQueries(spec({ keywords: ["invoice generator", "billing"], licenses: ["MIT"] }), NOW, 5);
    expect(qs[0]?.q).toMatch(/^invoice generator in:name,description,readme /);
    expect(qs[0]?.q).toContain("archived:false");
    expect(qs[0]?.q).toContain("stars:>=50");
    expect(qs[0]?.q).toContain("pushed:>=2025-10-18");
    expect(qs[0]?.q).toContain("license:mit");
    expect(qs[0]?.sort).toBeUndefined();
    expect(qs[1]).toMatchObject({ sort: "stars" });
    expect(qs[1]?.q).toMatch(/^topic:invoice-generator /);
    expect(qs[2]?.q).toMatch(/^billing in:/);
    expect(qs.length).toBeLessThanOrEqual(5);
  });

  it("uses the first word as topic for long phrases and respects the budget", () => {
    const qs = githubRepoQueries(spec({ keywords: ["pdf text extraction", "pdf parser", "ocr"] }), NOW, 3);
    expect(qs.map((x) => x.q.split(" ")[0])).toEqual(["pdf", "topic:pdf", "pdf"]);
    expect(qs).toHaveLength(3);
  });

  it("adds alternative-to phrases and repeats per language", () => {
    expect(textQueries(spec({ keywords: ["crm"], alternativeTo: ["Salesforce"] }), 5)).toEqual(["crm", "Salesforce alternative"]);
    const qs = githubRepoQueries(spec({ keywords: ["pdf"], languages: ["Python", "Go"] }), NOW, 10);
    expect(qs.some((x) => x.q.includes('language:"Python"'))).toBe(true);
    expect(qs.some((x) => x.q.includes('language:"Go"'))).toBe(true);
  });
});

describe("merge", () => {
  it("canonicalises forge URLs", () => {
    expect(canonicalRepoId("https://github.com/Owner/Repo.git")).toBe("github.com/owner/repo");
    expect(canonicalRepoId("git+https://github.com/owner/repo/tree/main/src")).toBe("github.com/owner/repo");
    expect(canonicalRepoId("git@github.com:owner/repo.git")).toBe("github.com/owner/repo");
    expect(canonicalRepoId("https://gitlab.com/group/sub/project/-/tree/main")).toBe("gitlab.com/group/sub/project");
    expect(canonicalRepoId("https://example.com/owner/repo")).toBeUndefined();
    expect(canonicalRepoId("https://github.com/owner")).toBeUndefined();
    expect(canonicalRepoId("not a url at all")).toBeUndefined();
  });

  it("merges the same repo found by different sources", () => {
    const merged = mergeCandidates([
      candidate({ stars: 10, sources: ["github"], lastActivity: "2026-01-01" }),
      candidate({ id: "yunohost:tool", kind: "app-listing", url: "https://apps.yunohost.org/app/tool", repoUrl: "https://github.com/ACME/tool", sources: ["yunohost"], installHints: [{ method: "yunohost", label: "x", level: "medium" }] }),
    ]);
    expect(merged).toHaveLength(1);
    expect(merged[0]).toMatchObject({ id: "github.com/acme/tool", kind: "repo", sources: ["github", "yunohost"], stars: 10 });
    expect(merged[0]?.installHints?.[0]?.method).toBe("yunohost");
  });

  it("prefers a real license id over GitHub's NOASSERTION and keeps the best source rank", () => {
    const [m] = mergeCandidates([
      candidate({ license: "NOASSERTION", sourceRank: 0.2 }),
      candidate({ id: "awesome-selfhosted:tool", kind: "app-listing", repoUrl: "https://github.com/acme/tool", license: "MIT", sources: ["awesome-selfhosted"], sourceRank: 0.9 }),
    ]);
    expect(m?.license).toBe("MIT");
    expect(m?.sourceRank).toBe(0.9);
  });

  it("folds app-store listings into a repo with the same name", () => {
    const list = mergeListingsByName([
      candidate({ name: "invoiceninja", id: "github.com/invoiceninja/invoiceninja" }),
      candidate({ name: "Invoice Ninja", id: "flathub:com.invoiceninja", kind: "app-listing", url: "https://flathub.org/apps/x", repoUrl: undefined, sources: ["flathub"], platforms: ["linux"] }),
      candidate({ name: "Other", id: "flathub:other", kind: "app-listing", url: "https://flathub.org/apps/y", repoUrl: undefined, sources: ["flathub"] }),
    ]);
    expect(list).toHaveLength(2);
    expect(list[0]?.sources).toEqual(["github", "flathub"]);
    expect(list[0]?.platforms).toEqual(["linux"]);
  });
});

describe("filters", () => {
  const s = spec({ activeWithinMonths: 12, licenses: [] });
  it("rejects archived, forks, stale, unpopular and restricted-license tools with reasons", () => {
    const { kept, rejected } = applyHardFilters(
      [
        candidate({ id: "a", archived: true }),
        candidate({ id: "b", fork: true }),
        candidate({ id: "c", lastActivity: "2024-01-01" }),
        candidate({ id: "d", stars: 3 }),
        candidate({ id: "e", license: "BUSL-1.1", stars: 500 }),
        candidate({ id: "f", stars: 500, lastActivity: "2026-09-01" }),
        candidate({ id: "g", kind: "app-listing", platforms: ["android"] }),
      ],
      { ...s, platforms: ["web"] },
      NOW,
    );
    expect(kept.map((c) => c.id)).toEqual(["f"]);
    expect(rejected.map((r) => r.id)).toEqual(["a", "b", "c", "d", "e", "g"]);
    expect(rejected[0]?.reason).toMatch(/Discontinued/);
  });

  it("keeps candidates whose facts are unknown", () => {
    expect(applyHardFilters([candidate({ stars: undefined, lastActivity: undefined })], s, NOW).kept).toHaveLength(1);
  });
});

describe("setup", () => {
  it("finds the easiest way to start", () => {
    const hosted = assessSetup({ kind: "repo", readme: "Sign up for free at example.com or self-host with docker compose up" });
    expect(hosted.level).toBe("easy-hosted");
    expect(hosted.hints.map((h) => h.method)).toEqual(["hosted", "docker-compose"]);

    const desktop = assessSetup({ kind: "repo", releaseAssets: ["App-Setup-1.0.exe", "App-1.0.dmg"], packagedIn: ["winget", "homebrew_casks", "flathub"] });
    expect(desktop.level).toBe("easy-install");
    expect(desktop.hints.map((h) => h.method)).toEqual(expect.arrayContaining(["windows-installer", "mac-installer", "winget", "homebrew-cask", "flathub"]));

    expect(assessSetup({ kind: "repo", readme: "git clone and then make install" }).level).toBe("hard");
    expect(assessSetup({ kind: "repo" }).level).toBe("unknown");
    expect(assessSetup({ kind: "package" }).level).toBe("hard");
  });

  it("doesn't mistake a demo for a hosted version", () => {
    expect(assessSetup({ kind: "repo", readme: "Try the demo at demo.example.com" }).level).toBe("unknown");
    expect(assessSetup({ kind: "repo", readme: "Try it for free on our cloud" }).level).toBe("easy-hosted");
  });

  it("spots libraries when the user wants an app", () => {
    expect(looksLikeLibrary(candidate({ description: "A .NET library for generating PDF documents" }))).toBe(true);
    expect(looksLikeLibrary(candidate({ kind: "package" }))).toBe(true);
    expect(looksLikeLibrary(candidate({ description: "Invoicing app for freelancers" }))).toBe(false);
  });

  it("rates ease by tech comfort", () => {
    expect(easeScore("hard", "beginner")).toBeLessThan(0.1);
    expect(easeScore("hard", "developer")).toBeGreaterThan(0.8);
    expect(easeScore("easy-hosted", "beginner")).toBe(1);
  });
});

describe("health", () => {
  it("rates an active, well-staffed project highly", () => {
    const h = assessHealth({ lastActivity: "2026-10-10", stars: 9000, forks: 2000, contributors: 150, scorecard: 7.5, knownVulnerabilities: 0 }, NOW);
    expect(h.status).toBe("active");
    expect(h.score).toBeGreaterThan(0.8);
    expect(h.redFlags).toEqual([]);
    expect(h.signals[0]?.text).toMatch(/Actively maintained/);
  });

  it("flags discontinued, stale and one-person projects", () => {
    expect(assessHealth({ archived: true }, NOW)).toMatchObject({ status: "discontinued", score: 0 });
    const stale = assessHealth({ lastActivity: "2024-06-01", contributors: 1 }, NOW);
    expect(stale.status).toBe("stale");
    expect(stale.redFlags.length).toBe(2);
  });

  it("spots inflated popularity", () => {
    expect(looksInflated({ stars: 20000, forks: 50, contributors: 1 })).toBe(true);
    expect(looksInflated({ stars: 20000, forks: 3000, contributors: 1 })).toBe(false);
    expect(looksInflated({ stars: 500, forks: 1, contributors: 1 })).toBe(false);
  });
});

describe("scoring", () => {
  it("normalises weights and respects priorities", () => {
    const w = weightsFor(spec({ techLevel: "developer", priorities: { health: 1 } }));
    const sum = w.fit + w.health + w.ease + w.cost + w.reputation;
    expect(sum).toBeCloseTo(1, 5);
    expect(w.health).toBeGreaterThan(w.fit);
  });

  it("computes fit from judgments", () => {
    expect(fitScore([], [])).toBe(1);
    expect(fitScore([{ requirement: "a", status: "met" }, { requirement: "b", status: "partial" }], [])).toBe(0.75);
    expect(fitScore([{ requirement: "a", status: "met" }], [{ requirement: "n", status: "no" }])).toBeCloseTo(0.8);
  });

  it("puts tools that fail a must-have last", () => {
    const ranked = rankTools(
      [
        { id: "x", name: "X", url: "https://x.dev", mustHaves: [{ requirement: "GST", status: "no" }], healthScore: 1, setupLevel: "easy-hosted", license: "MIT", stars: 50000 },
        { id: "y", name: "Y", url: "https://y.dev", mustHaves: [{ requirement: "GST", status: "met" }], healthScore: 0.6, setupLevel: "medium", license: "MIT" },
      ],
      spec(),
    );
    expect(ranked.map((r) => r.id)).toEqual(["y", "x"]);
    expect(ranked[1]?.failsMustHave).toBe(true);
  });

  it("prefers easy setup for beginners and depth for developers", () => {
    const tools = [
      { id: "easy", name: "Easy", url: "https://e.dev", healthScore: 0.6, setupLevel: "easy-hosted" as const, license: "MIT" },
      { id: "hard", name: "Hard", url: "https://h.dev", healthScore: 0.9, setupLevel: "hard" as const, license: "MIT" },
    ];
    expect(rankTools(tools, spec({ techLevel: "beginner" }))[0]?.id).toBe("easy");
    expect(rankTools(tools, spec({ techLevel: "developer" }))[0]?.id).toBe("hard");
  });

  it("scores popularity on a log scale", () => {
    expect(popularityScore({ stars: 0 })).toBe(0);
    expect(popularityScore({ stars: 31622 })).toBeCloseTo(1, 1);
    expect(popularityScore({ downloads: 100000, downloadsPeriod: "month" })).toBeCloseTo(popularityScore({ stars: 1000 }), 5);
  });
});
