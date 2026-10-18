import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";
import { FileCache, MemoryCache } from "../src/sources/cache.js";
import { HttpClient, HttpError, mapLimit, RateLimitError } from "../src/sources/http.js";
import { fakeFetch, testConfig } from "./helpers.js";

describe("config", () => {
  it("treats empty and unexpanded token placeholders as unset", () => {
    expect(loadConfig({ GITHUB_TOKEN: "" }).githubToken).toBeUndefined();
    expect(loadConfig({ GITHUB_TOKEN: "${user_config.github_token}" }).githubToken).toBeUndefined();
    expect(loadConfig({ GH_TOKEN: "abc" }).githubToken).toBe("abc");
    expect([...loadConfig({ FGT_DISABLE_SOURCES: "lemmy, flathub ," }).disabledSources]).toEqual(["lemmy", "flathub"]);
    expect(loadConfig({ FGT_CACHE_DIR: "/tmp/x" }).cacheDir).toBe("/tmp/x");
  });
});

describe("HttpClient", () => {
  it("caches successful responses", async () => {
    const f = fakeFetch([{ match: /example\.com/, body: { ok: 1 } }]);
    const http = new HttpClient(testConfig(), new MemoryCache(), f);
    expect(await http.json("https://example.com/a", { ttlMs: 1000 })).toEqual({ ok: 1 });
    expect(await http.json("https://example.com/a", { ttlMs: 1000 })).toEqual({ ok: 1 });
    expect(f.calls).toHaveLength(1);
  });

  it("returns undefined on 404 when allowed and throws otherwise", async () => {
    const http = new HttpClient(testConfig(), new MemoryCache(), fakeFetch([]));
    expect(await http.json("https://example.com/missing", { allow404: true })).toBeUndefined();
    await expect(http.json("https://example.com/missing")).rejects.toBeInstanceOf(HttpError);
  });

  it("reports GitHub rate limits clearly", async () => {
    const http = new HttpClient(
      testConfig(),
      new MemoryCache(),
      fakeFetch([{ match: /api\.github\.com/, status: 403, body: {}, headers: { "x-ratelimit-remaining": "0", "x-ratelimit-reset": "1792331961" } }]),
    );
    const err = await http.json("https://api.github.com/search/repositories?q=x").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(RateLimitError);
    expect((err as RateLimitError).message).toMatch(/Rate limit reached for api\.github\.com/);
    expect(http.lastGithubQuota.remaining).toBe(0);
  });

  it("retries once on a transient error", async () => {
    let n = 0;
    const f = async () => (++n === 1 ? new Response("", { status: 503, headers: { "retry-after": "0" } }) : new Response('{"v":2}', { status: 200 }));
    const http = new HttpClient(testConfig(), new MemoryCache(), f);
    expect(await http.json("https://example.com/flaky")).toEqual({ v: 2 });
    expect(n).toBe(2);
  });

  it("sends the user agent and JSON bodies", async () => {
    const f = fakeFetch([{ match: /osv/, body: { vulns: [] } }]);
    const http = new HttpClient(testConfig(), new MemoryCache(), f);
    await http.json("https://api.osv.dev/v1/query", { body: { a: 1 } });
    const init = f.calls[0]?.init;
    expect(init?.method).toBe("POST");
    expect(init?.body).toBe('{"a":1}');
    expect((init?.headers as Record<string, string>)["User-Agent"]).toBe("find-github-tool-test");
  });

  it("wraps network failures", async () => {
    const http = new HttpClient(testConfig(), new MemoryCache(), async () => {
      throw new Error("ECONNRESET");
    });
    await expect(http.text("https://example.com")).rejects.toThrow(/example\.com failed: ECONNRESET/);
  });
});

describe("FileCache", () => {
  let dir: string | undefined;
  afterEach(async () => {
    if (dir) await rm(dir, { recursive: true, force: true });
  });

  it("persists across instances and expires", async () => {
    dir = await mkdtemp(join(tmpdir(), "fgt-cache-"));
    let now = 1000;
    const a = new FileCache(dir, () => {}, () => now);
    await a.set("k", { x: 1 }, 500);
    expect(await readdir(dir)).toHaveLength(1);
    const b = new FileCache(dir, () => {}, () => now);
    expect(await b.get("k")).toEqual({ x: 1 });
    now = 2000;
    expect(await new FileCache(dir, () => {}, () => now).get("k")).toBeUndefined();
  });

  it("reports an unwritable cache once and keeps working from memory", async () => {
    const errors: string[] = [];
    const cache = new FileCache(join(tmpdir(), "fgt-\0-invalid"), (m) => errors.push(m));
    await cache.set("a", 1, 1000);
    await cache.set("b", 2, 1000);
    expect(await cache.get("a")).toBe(1);
    expect(errors).toHaveLength(1);
  });
});

describe("mapLimit", () => {
  it("keeps order and limits concurrency", async () => {
    let running = 0;
    let peak = 0;
    const out = await mapLimit([1, 2, 3, 4, 5], 2, async (n) => {
      running++;
      peak = Math.max(peak, running);
      await new Promise((r) => setTimeout(r, 5));
      running--;
      return n * 10;
    });
    expect(out).toEqual([10, 20, 30, 40, 50]);
    expect(peak).toBe(2);
  });
});
