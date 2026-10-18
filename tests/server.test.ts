import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, it } from "vitest";
import { renderHtml, renderMarkdown, type ReportInput } from "../src/core/report.js";
import { createServer } from "../src/server/server.js";
import { MemoryCache } from "../src/sources/cache.js";
import { HttpClient } from "../src/sources/http.js";
import { fakeFetch, NOW, testConfig, type FakeRoute } from "./helpers.js";

async function connect(routes: FakeRoute[] = []) {
  const config = testConfig();
  const server = createServer({ config, cache: new MemoryCache(), http: new HttpClient(config, new MemoryCache(), fakeFetch(routes)), clock: () => NOW, log: () => {} });
  const [clientT, serverT] = InMemoryTransport.createLinkedPair();
  await server.connect(serverT);
  const client = new Client({ name: "test", version: "1" });
  await client.connect(clientT);
  return client;
}

function textOf(result: Awaited<ReturnType<Client["callTool"]>>): string {
  const first = (result.content as { type: string; text: string }[])[0];
  return first?.text ?? "";
}

const REPORT: ReportInput = {
  title: "Invoice apps <for you>",
  need: "free invoices",
  checkedOn: "2026-10-18",
  items: [
    {
      name: "Invoicely",
      url: "https://github.com/acme/invoicely",
      summary: "Send invoices <script>alert(1)</script>",
      whyItFits: ["Free"],
      howToStart: ["Sign up"],
      trust: [{ tone: "good", text: "Active" }],
      watchOut: ["Basic mobile app"],
    },
  ],
  rejected: [{ name: "Old", reason: "Discontinued" }],
};

describe("MCP server", () => {
  it("exposes the tools and the /find-github-tool prompt", async () => {
    const client = await connect();
    const tools = (await client.listTools()).tools.map((t) => t.name).sort();
    expect(tools).toEqual(["export_report", "get_community_voice", "get_tool_details", "list_sources", "rank_tools", "read_tool_docs", "search_tools", "verify_lead"]);
    const prompts = (await client.listPrompts()).prompts.map((p) => p.name);
    expect(prompts).toEqual(["find-github-tool"]);
    const prompt = await client.getPrompt({ name: "find-github-tool", arguments: { request: "free invoice app" } });
    const text = (prompt.messages[0]?.content as { text: string }).text;
    expect(text).toContain("Golden rules");
    expect(text).toContain("free invoice app");
    expect(text).not.toContain("$ARGUMENTS");
    expect(text).toContain("Plain-language glossary");
  });

  it("runs search_tools end to end", async () => {
    const client = await connect([
      {
        match: /search\/repositories/,
        body: { items: [{ full_name: "acme/invoicely", name: "invoicely", description: "Invoice app", html_url: "https://github.com/acme/invoicely", homepage: null, stargazers_count: 900, forks_count: 80, open_issues_count: 3, license: { spdx_id: "MIT" }, language: "PHP", topics: ["invoice"], pushed_at: "2026-10-01T00:00:00Z", archived: false, fork: false, default_branch: "main" }] },
      },
    ]);
    const res = await client.callTool({ name: "search_tools", arguments: { need: "invoice app", keywords: ["invoice"], sources: ["github"] } });
    expect(res.isError).toBeFalsy();
    const body = JSON.parse(textOf(res));
    expect(body.candidates[0]).toMatchObject({ name: "invoicely", stars: 900 });
    expect(body.sourcesUsed).toEqual([expect.objectContaining({ id: "github", ok: true })]);
  });

  it("returns readable errors for invalid input and blocked URLs", async () => {
    const client = await connect();
    const bad = await client.callTool({ name: "read_tool_docs", arguments: { url: "http://127.0.0.1:8080/" } });
    expect(bad.isError).toBe(true);
    expect(textOf(bad)).toMatch(/Local network addresses are not allowed/);
    const invalid = await client.callTool({ name: "search_tools", arguments: { need: "x", keywords: [] } });
    expect(invalid.isError).toBe(true);
  });

  it("ranks and exports reports", async () => {
    const client = await connect();
    const ranked = await client.callTool({
      name: "rank_tools",
      arguments: {
        spec: { need: "invoices", keywords: ["invoice"] },
        tools: [
          { id: "a", name: "A", url: "https://a.dev", mustHaves: [{ requirement: "GST", status: "met" }], setupLevel: "easy-hosted", license: "MIT" },
          { id: "b", name: "B", url: "https://b.dev", mustHaves: [{ requirement: "GST", status: "no" }], setupLevel: "easy-hosted", license: "MIT" },
        ],
      },
    });
    expect(JSON.parse(textOf(ranked)).ranked.map((r: { id: string }) => r.id)).toEqual(["a", "b"]);
    const exported = await client.callTool({ name: "export_report", arguments: { report: REPORT, format: "markdown" } });
    expect(JSON.parse(textOf(exported)).content).toContain("## 🏆 Best pick: [Invoicely](https://github.com/acme/invoicely)");
  });
});

describe("reports", () => {
  it("renders markdown cards with rejected tools", () => {
    const md = renderMarkdown(REPORT);
    expect(md).toContain("_Checked on 2026-10-18._");
    expect(md).toContain("- 🟢 Active");
    expect(md).toContain("- **Old**: Discontinued");
  });

  it("escapes everything in HTML and drops unsafe links", () => {
    const html = renderHtml({ ...REPORT, items: [{ ...REPORT.items[0]!, url: "https://ok.example/?a=1&b=<x>" }] });
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("Invoice apps &lt;for you&gt;");
    expect(html).toContain("prefers-color-scheme:dark");
    expect(() => renderHtml({ ...REPORT, items: [{ ...REPORT.items[0]!, url: "javascript:alert(1)" }] })).not.toThrow();
    expect(renderHtml({ ...REPORT, items: [{ ...REPORT.items[0]!, url: "javascript:alert(1)" }] })).not.toContain("javascript:");
  });
});
