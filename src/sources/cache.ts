import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

interface Entry {
  expires: number;
  value: unknown;
}

export interface Cache {
  get<T>(key: string): Promise<T | undefined>;
  set(key: string, value: unknown, ttlMs: number): Promise<void>;
}

/** In-memory cache only. Used in tests and when the disk cache can't be written. */
export class MemoryCache implements Cache {
  private readonly entries = new Map<string, Entry>();
  constructor(private readonly clock: () => number = Date.now) {}

  async get<T>(key: string): Promise<T | undefined> {
    const e = this.entries.get(key);
    if (!e) return undefined;
    if (e.expires <= this.clock()) {
      this.entries.delete(key);
      return undefined;
    }
    return e.value as T;
  }

  async set(key: string, value: unknown, ttlMs: number): Promise<void> {
    this.entries.set(key, { expires: this.clock() + ttlMs, value });
  }
}

/**
 * Memory cache backed by JSON files, so results survive restarts and spare API rate limits.
 * Disk failures don't break searches: they are reported once through `onError` and the
 * memory layer keeps working.
 */
export class FileCache implements Cache {
  private readonly memory: MemoryCache;
  private dirReady: Promise<void> | undefined;
  private reported = false;

  constructor(
    private readonly dir: string,
    private readonly onError: (message: string) => void,
    private readonly clock: () => number = Date.now,
  ) {
    this.memory = new MemoryCache(clock);
  }

  private file(key: string): string {
    return join(this.dir, `${createHash("sha256").update(key).digest("hex").slice(0, 40)}.json`);
  }

  private report(err: unknown): void {
    if (this.reported) return;
    this.reported = true;
    this.onError(`Disk cache unavailable at ${this.dir}: ${err instanceof Error ? err.message : String(err)}`);
  }

  async get<T>(key: string): Promise<T | undefined> {
    const hit = await this.memory.get<T>(key);
    if (hit !== undefined) return hit;
    try {
      const entry = JSON.parse(await readFile(this.file(key), "utf8")) as Entry;
      if (entry.expires <= this.clock()) return undefined;
      await this.memory.set(key, entry.value, entry.expires - this.clock());
      return entry.value as T;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") this.report(err);
      return undefined;
    }
  }

  async set(key: string, value: unknown, ttlMs: number): Promise<void> {
    await this.memory.set(key, value, ttlMs);
    try {
      this.dirReady ??= mkdir(this.dir, { recursive: true }).then(() => undefined);
      await this.dirReady;
      const entry: Entry = { expires: this.clock() + ttlMs, value };
      await writeFile(this.file(key), JSON.stringify(entry), "utf8");
    } catch (err) {
      this.report(err);
    }
  }
}
