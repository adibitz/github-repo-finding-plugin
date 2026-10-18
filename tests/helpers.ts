import type { Config } from "../src/config.js";
import { parseSpec, type Spec, type SpecInput } from "../src/core/spec.js";
import type { Candidate } from "../src/core/types.js";
import { MemoryCache } from "../src/sources/cache.js";
import { HttpClient, type FetchLike } from "../src/sources/http.js";
import type { SourceContext } from "../src/sources/types.js";

export const NOW = new Date("2026-10-18T12:00:00Z");

export function testConfig(overrides: Partial<Config> = {}): Config {
  return {
    cacheDir: "unused",
    disabledSources: new Set(),
    userAgent: "find-github-tool-test",
    timeoutMs: 5000,
    ...overrides,
  };
}

export function spec(overrides: Partial<SpecInput> = {}): Spec {
  return parseSpec({ need: "free invoicing app", keywords: ["invoice"], ...overrides });
}

export function candidate(overrides: Partial<Candidate> = {}): Candidate {
  return {
    id: "github.com/acme/tool",
    name: "tool",
    description: "An invoicing tool",
    url: "https://github.com/acme/tool",
    kind: "repo",
    sources: ["github"],
    ...overrides,
  };
}

export interface FakeRoute {
  match: RegExp;
  status?: number;
  body?: unknown;
  text?: string;
  headers?: Record<string, string>;
}

/** A fetch replacement that answers from a route table and records every call. Unmatched URLs return 404. */
export function fakeFetch(routes: FakeRoute[]): FetchLike & { calls: { url: string; init?: RequestInit }[] } {
  const calls: { url: string; init?: RequestInit }[] = [];
  const fn = (async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    const route = routes.find((r) => r.match.test(url));
    if (!route) return new Response("not found", { status: 404 });
    const body = route.text ?? (route.body !== undefined ? JSON.stringify(route.body) : "");
    return new Response(init?.method === "HEAD" ? null : body, { status: route.status ?? 200, headers: route.headers });
  }) as FetchLike & { calls: { url: string; init?: RequestInit }[] };
  fn.calls = calls;
  return fn;
}

export function testContext(routes: FakeRoute[], config: Partial<Config> = {}): SourceContext & { fetch: ReturnType<typeof fakeFetch> } {
  const fetch = fakeFetch(routes);
  const cfg = testConfig(config);
  // Web pages go through the same route table instead of the real network.
  const fetchPage = async (url: URL) => {
    const res = await fetch(url.toString(), { method: "GET" });
    return { status: res.status, location: res.headers.get("location") ?? undefined, body: await res.text(), truncated: false };
  };
  return { http: new HttpClient(cfg, new MemoryCache(), fetch), config: cfg, now: NOW, fetch, fetchPage };
}
