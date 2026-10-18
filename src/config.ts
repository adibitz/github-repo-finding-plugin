import { homedir } from "node:os";
import { join } from "node:path";

export const APP_NAME = "find-github-tool";
export const APP_VERSION = "0.1.0";

export interface Config {
  githubToken?: string;
  stackExchangeKey?: string;
  /** Bearer token required by the HTTP transport (needed when listening beyond localhost). */
  httpToken?: string;
  cacheDir: string;
  disabledSources: Set<string>;
  userAgent: string;
  timeoutMs: number;
}

/** Treat empty strings and unexpanded "${VAR}" placeholders (from host configs) as "not set". */
function secret(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  const v = value.trim();
  if (v === "" || /^\$\{.*\}$/.test(v)) return undefined;
  return v;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const timeout = Number(env.FGT_TIMEOUT_MS);
  return {
    githubToken: secret(env.GITHUB_TOKEN) ?? secret(env.GH_TOKEN),
    stackExchangeKey: secret(env.STACKEXCHANGE_KEY),
    httpToken: secret(env.FGT_HTTP_TOKEN),
    cacheDir: secret(env.FGT_CACHE_DIR) ?? secret(env.CLAUDE_PLUGIN_DATA) ?? join(homedir(), ".cache", APP_NAME),
    disabledSources: new Set(
      (env.FGT_DISABLE_SOURCES ?? "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean),
    ),
    userAgent: `${APP_NAME}/${APP_VERSION}${secret(env.FGT_CONTACT) ? ` (${secret(env.FGT_CONTACT)})` : ""}`,
    timeoutMs: Number.isFinite(timeout) && timeout > 0 ? timeout : 15_000,
  };
}

/** Cache lifetimes in milliseconds. */
export const TTL = {
  search: 60 * 60 * 1000,
  details: 24 * 60 * 60 * 1000,
  catalog: 7 * 24 * 60 * 60 * 1000,
  community: 12 * 60 * 60 * 1000,
} as const;
