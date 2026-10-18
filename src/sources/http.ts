import type { Config } from "../config.js";
import type { Cache } from "./cache.js";

export class HttpError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly url: string,
  ) {
    super(message);
    this.name = "HttpError";
  }
}

/** The API refused because a quota ran out. `resetAt` is when it frees up, if the API said. */
export class RateLimitError extends HttpError {
  constructor(
    url: string,
    status: number,
    readonly resetAt?: Date,
  ) {
    const when = resetAt ? ` until ${resetAt.toISOString().slice(11, 16)} UTC` : "";
    super(`Rate limit reached for ${new URL(url).hostname}${when}`, status, url);
    this.name = "RateLimitError";
  }
}

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface RequestOptions {
  method?: "GET" | "POST" | "HEAD";
  headers?: Record<string, string>;
  body?: unknown;
  /** Cache lifetime. 0 or undefined = don't cache. */
  ttlMs?: number;
  timeoutMs?: number;
  /** Return undefined instead of throwing on 404. */
  allow404?: boolean;
}

/** Minimum gap between requests to hosts that ask for it (milliseconds). */
const HOST_MIN_INTERVAL: Record<string, number> = {
  "repology.org": 1100,
};

const RETRYABLE = new Set([429, 502, 503, 504]);
const MAX_RETRY_WAIT_MS = 5000;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Small fetch wrapper used by every source: timeouts, a user agent, caching, polite per-host
 * spacing, one retry on transient errors, and clear errors for rate limits.
 */
export class HttpClient {
  private readonly lastRequestAt = new Map<string, number>();

  constructor(
    private readonly config: Config,
    private readonly cache: Cache,
    private readonly fetchImpl: FetchLike = (input, init) => fetch(input, init),
  ) {}

  async json<T>(url: string, opts: RequestOptions = {}): Promise<T | undefined> {
    return this.request(url, opts, async (res) => (await res.json()) as T);
  }

  async text(url: string, opts: RequestOptions = {}): Promise<string | undefined> {
    return this.request(url, opts, (res) => res.text());
  }

  /** Run a custom reader over the response, e.g. to read headers. Cached like json(). */
  async read<T>(url: string, opts: RequestOptions, reader: (res: Response) => Promise<T>): Promise<T | undefined> {
    return this.request(url, opts, reader);
  }

  /** True if the URL answers 2xx to a HEAD request. Never throws for 4xx. */
  async exists(url: string, opts: RequestOptions = {}): Promise<boolean> {
    const result = await this.request(url, { ...opts, method: "HEAD", allow404: true }, async () => true).catch((err: unknown) => {
      if (err instanceof HttpError && err.status < 500) return false;
      throw err;
    });
    return result === true;
  }

  /** Response headers of the last GitHub call are useful for quota reporting. */
  lastGithubQuota: { remaining?: number; resetAt?: Date; resource?: string } = {};

  private async request<T>(url: string, opts: RequestOptions, read: (res: Response) => Promise<T>): Promise<T | undefined> {
    const method = opts.method ?? (opts.body !== undefined ? "POST" : "GET");
    const cacheKey = `${method} ${url} ${opts.body !== undefined ? JSON.stringify(opts.body) : ""} ${opts.headers?.Authorization ? "auth" : ""}`;
    if (opts.ttlMs) {
      const hit = await this.cache.get<{ v: T | null }>(cacheKey);
      if (hit !== undefined) return hit.v ?? undefined;
    }

    const host = new URL(url).hostname;
    const headers: Record<string, string> = { "User-Agent": this.config.userAgent, Accept: "application/json", ...opts.headers };
    if (opts.body !== undefined) headers["Content-Type"] = "application/json";

    for (let attempt = 0; ; attempt++) {
      await this.space(host);
      let res: Response;
      try {
        res = await this.fetchImpl(url, {
          method,
          headers,
          body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
          signal: AbortSignal.timeout(opts.timeoutMs ?? this.config.timeoutMs),
          redirect: "follow",
        });
      } catch (err) {
        const reason = err instanceof Error && err.name === "TimeoutError" ? "timed out" : err instanceof Error ? err.message : String(err);
        throw new HttpError(`Request to ${host} failed: ${reason}`, 0, url);
      }

      if (host === "api.github.com") this.trackGithubQuota(res);

      if (res.ok) {
        const value = await read(res);
        if (opts.ttlMs) await this.cache.set(cacheKey, { v: value }, opts.ttlMs);
        return value;
      }
      if (res.status === 404 && opts.allow404) {
        if (opts.ttlMs) await this.cache.set(cacheKey, { v: null }, opts.ttlMs);
        return undefined;
      }
      if (this.isRateLimited(res, host)) {
        throw new RateLimitError(url, res.status, this.resetTime(res));
      }
      const retryAfter = Number(res.headers.get("retry-after") ?? "1") * 1000;
      if (attempt === 0 && RETRYABLE.has(res.status) && retryAfter <= MAX_RETRY_WAIT_MS) {
        await sleep(Math.max(500, retryAfter));
        continue;
      }
      if (res.status === 429) throw new RateLimitError(url, res.status, this.resetTime(res));
      throw new HttpError(`${host} answered ${res.status} ${res.statusText}`.trim(), res.status, url);
    }
  }

  private async space(host: string): Promise<void> {
    const gap = HOST_MIN_INTERVAL[host];
    if (!gap) return;
    const last = this.lastRequestAt.get(host) ?? 0;
    const wait = last + gap - Date.now();
    this.lastRequestAt.set(host, Math.max(Date.now(), last + gap));
    if (wait > 0) await sleep(wait);
  }

  private isRateLimited(res: Response, host: string): boolean {
    if (host === "api.github.com" && (res.status === 403 || res.status === 429)) {
      return res.headers.get("x-ratelimit-remaining") === "0" || res.headers.has("retry-after");
    }
    return false;
  }

  private resetTime(res: Response): Date | undefined {
    const reset = Number(res.headers.get("x-ratelimit-reset"));
    if (Number.isFinite(reset) && reset > 0) return new Date(reset * 1000);
    const retryAfter = Number(res.headers.get("retry-after"));
    if (Number.isFinite(retryAfter) && retryAfter > 0) return new Date(Date.now() + retryAfter * 1000);
    return undefined;
  }

  private trackGithubQuota(res: Response): void {
    const remaining = Number(res.headers.get("x-ratelimit-remaining"));
    if (!Number.isFinite(remaining)) return;
    this.lastGithubQuota = {
      remaining,
      resetAt: this.resetTime(res),
      resource: res.headers.get("x-ratelimit-resource") ?? undefined,
    };
  }
}

/** Run `fn` over `items` with at most `limit` running at once, keeping input order. */
export async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i] as T, i);
    }
  });
  await Promise.all(workers);
  return results;
}

export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
