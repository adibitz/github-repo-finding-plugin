import { z } from "zod";

const signalSchema = z.object({ tone: z.enum(["good", "ok", "warn", "bad"]), text: z.string().max(300) });

/** One finished recommendation, written by the AI after ranking. */
export const reportItemSchema = z.object({
  name: z.string().min(1).max(200),
  url: z.string().url(),
  summary: z.string().max(500).describe("One sentence: what it is."),
  whyItFits: z.array(z.string().max(300)).max(10).default([]),
  cost: z.string().max(200).optional(),
  howToStart: z.array(z.string().max(300)).max(6).default([]),
  trust: z.array(signalSchema).max(10).default([]),
  watchOut: z.array(z.string().max(300)).max(6).default([]),
  score: z.number().min(0).max(1).optional(),
  license: z.string().max(100).optional(),
  setup: z.string().max(200).optional(),
});

export const reportSchema = z.object({
  title: z.string().min(1).max(200),
  need: z.string().max(1000),
  audience: z.enum(["everyday", "developer"]).default("everyday"),
  checkedOn: z.string().max(40).describe("Date the data was checked, YYYY-MM-DD."),
  items: z.array(reportItemSchema).min(1).max(10),
  rejected: z.array(z.object({ name: z.string().max(200), reason: z.string().max(300) })).max(30).default([]),
});
export type Report = z.infer<typeof reportSchema>;
export type ReportInput = z.input<typeof reportSchema>;

const DOT: Record<z.infer<typeof signalSchema>["tone"], string> = { good: "🟢", ok: "🟡", warn: "🟠", bad: "🔴" };
const MEDALS = ["🏆 Best pick", "🥈 Runner-up", "🥉 Also good"];

function medal(i: number): string {
  return MEDALS[i] ?? `#${i + 1}`;
}

/** Markdown links can't contain raw ")" or spaces in the URL, and text can't break out of the brackets. */
function mdLink(text: string, url: string): string {
  const safeUrl = url.replace(/ /g, "%20").replace(/\(/g, "%28").replace(/\)/g, "%29");
  return `[${text.replace(/[[\]]/g, "")}](${safeUrl})`;
}

export function renderMarkdown(input: ReportInput): string {
  const r = reportSchema.parse(input);
  const out: string[] = [`# ${r.title}`, "", `**What you asked for:** ${r.need}`, "", `_Checked on ${r.checkedOn}._`, ""];
  r.items.forEach((item, i) => {
    out.push(`## ${medal(i)}: ${mdLink(item.name, item.url)}`, "", item.summary, "");
    if (item.whyItFits.length) out.push("**Why it fits you**", ...item.whyItFits.map((w) => `- ${w}`), "");
    if (item.cost) out.push(`**Cost:** ${item.cost}`, "");
    if (item.howToStart.length) out.push("**How to start**", ...item.howToStart.map((s, n) => `${n + 1}. ${s}`), "");
    if (item.trust.length) out.push("**Trust**", ...item.trust.map((t) => `- ${DOT[t.tone]} ${t.text}`), "");
    if (item.watchOut.length) out.push("**Watch out**", ...item.watchOut.map((w) => `- ⚠️ ${w}`), "");
    if (r.audience === "developer") {
      const facts = [item.license && `License: ${item.license}`, item.setup && `Setup: ${item.setup}`, item.score !== undefined && `Score: ${item.score.toFixed(2)}`].filter(Boolean);
      if (facts.length) out.push(`_${facts.join(" · ")}_`, "");
    }
  });
  if (r.rejected.length) {
    out.push("## Considered but not recommended", "", ...r.rejected.map((x) => `- **${x.name}**: ${x.reason}`), "");
  }
  out.push("---", "_Made with find-github-tool. Always check a tool's own site before relying on it._", "");
  return out.join("\n");
}

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

function safeHref(url: string): string {
  try {
    const u = new URL(url);
    return u.protocol === "https:" || u.protocol === "http:" ? esc(u.toString()) : "#";
  } catch {
    return "#";
  }
}

/** Self-contained HTML page with light/dark support. Every piece of text is escaped. */
export function renderHtml(input: ReportInput): string {
  const r = reportSchema.parse(input);
  const list = (title: string, items: string[], ordered = false) =>
    items.length ? `<h3>${title}</h3><${ordered ? "ol" : "ul"}>${items.map((x) => `<li>${esc(x)}</li>`).join("")}</${ordered ? "ol" : "ul"}>` : "";
  const cards = r.items
    .map(
      (item, i) => `<article class="card">
<p class="medal">${esc(medal(i))}</p>
<h2><a href="${safeHref(item.url)}" rel="noopener noreferrer">${esc(item.name)}</a></h2>
<p>${esc(item.summary)}</p>
${list("Why it fits you", item.whyItFits)}
${item.cost ? `<p><strong>Cost:</strong> ${esc(item.cost)}</p>` : ""}
${list("How to start", item.howToStart, true)}
${item.trust.length ? `<h3>Trust</h3><ul class="trust">${item.trust.map((t) => `<li><span aria-hidden="true">${DOT[t.tone]}</span> ${esc(t.text)}</li>`).join("")}</ul>` : ""}
${list("Watch out", item.watchOut)}
</article>`,
    )
    .join("\n");
  const rejected = r.rejected.length
    ? `<section><h2>Considered but not recommended</h2><ul>${r.rejected.map((x) => `<li><strong>${esc(x.name)}</strong>: ${esc(x.reason)}</li>`).join("")}</ul></section>`
    : "";
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(r.title)}</title>
<style>
:root{--bg:#fafaf9;--fg:#1c1917;--muted:#57534e;--card:#fff;--line:#e7e5e4;--link:#1d4ed8}
@media (prefers-color-scheme:dark){:root{--bg:#1c1917;--fg:#f5f5f4;--muted:#a8a29e;--card:#292524;--line:#44403c;--link:#93c5fd}}
body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.55 system-ui,sans-serif}
main{max-width:760px;margin:0 auto;padding:24px 16px}
.card{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:16px 20px;margin:16px 0}
.medal{margin:0;color:var(--muted);font-weight:600}
h2{margin:.2em 0}a{color:var(--link)}a:focus-visible{outline:2px solid var(--link);outline-offset:2px}
h3{font-size:1rem;margin:1em 0 .3em}.trust{list-style:none;padding-left:0}
.meta{color:var(--muted)}
</style></head>
<body><main>
<h1>${esc(r.title)}</h1>
<p><strong>What you asked for:</strong> ${esc(r.need)}</p>
<p class="meta">Checked on ${esc(r.checkedOn)}</p>
${cards}
${rejected}
<p class="meta">Made with find-github-tool. Always check a tool's own site before relying on it.</p>
</main></body></html>
`;
}
