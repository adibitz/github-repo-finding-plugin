import { TTL } from "../config.js";
import { cleanText } from "../core/text.js";
import { errorMessage } from "./http.js";
import type { SourceContext } from "./types.js";

export interface Mention {
  source: "hackernews" | "stackoverflow" | "lemmy";
  title: string;
  url: string;
  /** Votes / points / score on that site. */
  score: number;
  comments?: number;
  date?: string;
}

export interface CommunityVoice {
  name: string;
  mentions: Mention[];
  totals: Record<Mention["source"], number>;
  warnings: string[];
}

interface HnHit {
  objectID: string;
  title: string | null;
  points: number | null;
  num_comments: number | null;
  created_at: string;
}

interface SeItem {
  title: string;
  link: string;
  score: number;
  answer_count: number;
  creation_date: number;
}

interface LemmyPost {
  post: { name: string; ap_id: string; published: string };
  counts: { score: number; comments: number };
}

/** Only keep threads whose title really mentions the tool, to avoid unrelated matches on common words. */
export function mentionsName(title: string, name: string): boolean {
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "");
  const n = norm(name);
  return n.length >= 3 && norm(title).includes(n);
}

async function hackerNews(ctx: SourceContext, name: string): Promise<Mention[]> {
  const res = await ctx.http.json<{ hits: HnHit[] }>(
    `https://hn.algolia.com/api/v1/search?query=${encodeURIComponent(name)}&tags=story&hitsPerPage=10`,
    { ttlMs: TTL.community },
  );
  return (res?.hits ?? []).map((h) => ({
    source: "hackernews" as const,
    title: cleanText(h.title, 200),
    url: `https://news.ycombinator.com/item?id=${h.objectID}`,
    score: h.points ?? 0,
    comments: h.num_comments ?? 0,
    date: h.created_at,
  }));
}

async function stackOverflow(ctx: SourceContext, name: string): Promise<Mention[]> {
  const key = ctx.config.stackExchangeKey ? `&key=${encodeURIComponent(ctx.config.stackExchangeKey)}` : "";
  const res = await ctx.http.json<{ items: SeItem[] }>(
    `https://api.stackexchange.com/2.3/search/advanced?q=${encodeURIComponent(name)}&site=stackoverflow&pagesize=10&order=desc&sort=relevance${key}`,
    { ttlMs: TTL.community },
  );
  return (res?.items ?? []).map((i) => ({
    source: "stackoverflow" as const,
    title: cleanText(i.title, 200),
    url: i.link,
    score: i.score,
    comments: i.answer_count,
    date: new Date(i.creation_date * 1000).toISOString(),
  }));
}

async function lemmy(ctx: SourceContext, name: string): Promise<Mention[]> {
  const res = await ctx.http.json<{ posts: LemmyPost[] }>(
    `https://lemmy.world/api/v3/search?q=${encodeURIComponent(name)}&type_=Posts&sort=TopAll&limit=10`,
    { ttlMs: TTL.community },
  );
  return (res?.posts ?? []).map((p) => ({
    source: "lemmy" as const,
    title: cleanText(p.post.name, 200),
    url: p.post.ap_id,
    score: p.counts.score,
    comments: p.counts.comments,
    date: p.post.published,
  }));
}

/** What people say about a tool on Hacker News, Stack Overflow and Lemmy. Each site failing is reported, not fatal. */
export async function getCommunityVoice(ctx: SourceContext, name: string, disabled: Set<string> = new Set()): Promise<CommunityVoice> {
  const sites: [Mention["source"], (c: SourceContext, n: string) => Promise<Mention[]>][] = [
    ["hackernews", hackerNews],
    ["stackoverflow", stackOverflow],
    ["lemmy", lemmy],
  ];
  const active = sites.filter(([id]) => !disabled.has(id));
  const results = await Promise.allSettled(active.map(([, fn]) => fn(ctx, name)));
  const warnings: string[] = [];
  const mentions: Mention[] = [];
  results.forEach((r, i) => {
    const id = active[i]?.[0] ?? "unknown";
    if (r.status === "fulfilled") mentions.push(...r.value.filter((m) => mentionsName(m.title, name)));
    else warnings.push(`${id}: ${errorMessage(r.reason)}`);
  });
  mentions.sort((a, b) => b.score - a.score);
  const totals = { hackernews: 0, stackoverflow: 0, lemmy: 0 };
  for (const m of mentions) totals[m.source]++;
  return { name, mentions: mentions.slice(0, 12), totals, warnings };
}
