// Live end-to-end check: starts the bundled server over stdio exactly like an AI app would,
// and runs one beginner and one developer search against the real APIs.
// Usage: npm run build && npm run smoke
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const transport = new StdioClientTransport({
  command: process.execPath,
  args: ["dist/find-github-tool.mjs", "serve"],
  env: { ...process.env },
  stderr: "inherit",
});
const client = new Client({ name: "smoke", version: "1" });
await client.connect(transport);

const call = async (name, args) => {
  const started = Date.now();
  const res = await client.callTool({ name, arguments: args });
  const text = res.content?.[0]?.text ?? "";
  if (res.isError) throw new Error(`${name} failed: ${text}`);
  console.log(`\n✓ ${name} (${Date.now() - started} ms)`);
  return JSON.parse(text);
};

const tools = (await client.listTools()).tools.map((t) => t.name);
console.log("tools:", tools.join(", "));
const prompt = await client.getPrompt({ name: "find-github-tool", arguments: { request: "free invoice app" } });
console.log(`prompt: ${prompt.messages[0].content.text.length} chars`);

// Everyday user: a free invoicing app, easy setup.
const beginner = await call("search_tools", {
  need: "a free app to make invoices for my small shop",
  keywords: ["invoice", "invoicing", "billing"],
  alternativeTo: ["QuickBooks"],
  mode: "app",
  techLevel: "beginner",
  mustHaves: ["recurring invoices"],
});
for (const c of beginner.candidates.slice(0, 8)) console.log(`  ${c.prelimScore}  ${c.name}  ${c.url}  [${c.sources.join(",")}]`);
console.log("  sources:", beginner.sourcesUsed.map((s) => `${s.id}:${s.ok ? s.found : "ERR"}`).join(" "));
if (beginner.warnings?.length) console.log("  warnings:", beginner.warnings);

const top = beginner.candidates.filter((c) => c.url.includes("github.com")).slice(0, 2).map((c) => c.url);
if (top.length) {
  const details = await call("get_tool_details", { urls: top });
  for (const d of details.tools) {
    console.log(`  ${d.name}: health=${d.health.status} (${d.health.score?.toFixed?.(2)}) setup=${d.setup.level} license=${d.license.spdx ?? "none"} (${d.license.businessUse})`);
    console.log(`    hints: ${d.setup.hints.map((h) => h.method).join(", ")}  packagedIn: ${(d.facts.packagedIn ?? []).slice(0, 6).join(", ")}`);
    if (d.warnings?.length) console.log("    warnings:", d.warnings);
  }
  const docs = await call("read_tool_docs", { url: top[0], maxChars: 800 });
  console.log(`  docs: ${docs.title} (${docs.text.length} chars, truncated=${docs.truncated})`);
  const voice = await call("get_community_voice", { name: details.tools[0].name });
  console.log(`  community: ${JSON.stringify(voice.totals)}`);
}

// Developer: a Python PDF library.
const dev = await call("search_tools", {
  need: "MIT or Apache licensed Python library to extract text from PDFs",
  keywords: ["pdf text extraction", "pdf parser"],
  mode: "library",
  languages: ["Python"],
  techLevel: "developer",
  licenses: ["MIT", "Apache-2.0"],
});
for (const c of dev.candidates.slice(0, 6)) console.log(`  ${c.prelimScore}  ${c.name}  ${c.url}  [${c.sources.join(",")}] ★${c.stars ?? "-"}`);
console.log("  sources:", dev.sourcesUsed.map((s) => `${s.id}:${s.ok ? s.found : "ERR"}`).join(" "));
if (dev.warnings?.length) console.log("  warnings:", dev.warnings);

const lead = await call("verify_lead", { url: "https://github.com/invoiceninja/invoiceninja" });
console.log(`  verify: ${lead.status}`);

// A real web page through the SSRF-safe fetcher, and a website lead traced to its source code.
const page = await call("read_tool_docs", { url: "https://www.invoiceplane.com/", maxChars: 500 });
console.log(`  homepage: "${page.title}" (${page.text.length} chars) codeLinks=${(page.codeLinks ?? []).join(", ")}`);
const siteLead = await call("verify_lead", { url: "https://www.invoiceplane.com/" });
console.log(`  website lead: ${siteLead.status} → ${siteLead.candidate?.id ?? "-"}`);
const blocked = await client.callTool({ name: "read_tool_docs", arguments: { url: "http://169.254.169.254/latest/meta-data/" } });
console.log(`  metadata endpoint blocked: ${blocked.isError === true}`);

await client.close();
console.log("\nSmoke test finished.");
