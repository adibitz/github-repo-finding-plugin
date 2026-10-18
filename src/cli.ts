import { parseArgs } from "node:util";
import { APP_NAME, APP_VERSION, loadConfig } from "./config.js";
import { parseSpec } from "./core/spec.js";
import { MODES, TECH_LEVELS } from "./core/types.js";
import { searchTools } from "./engine/search.js";
import { runInstall } from "./installer/install.js";
import { hostTargets } from "./installer/hosts.js";
import { currentHostEnv } from "./installer/install.js";
import { compactJson } from "./server/server.js";
import { serveHttp, serveStdio } from "./server/transports.js";
import { FileCache } from "./sources/cache.js";
import { errorMessage, HttpClient } from "./sources/http.js";

const HELP = `${APP_NAME} ${APP_VERSION}: find the right open-source tool for any need.

Usage:
  ${APP_NAME} serve                       Start the MCP server (stdio), for AI apps
  ${APP_NAME} serve --http [--port 3333] [--host 127.0.0.1]
                                          Start it as a Streamable HTTP server at /mcp
  ${APP_NAME} install --app <id|all> [--dry-run] [--save-token]
                                          Add it to your AI apps: ${hostTargets(currentHostEnv()).map((h) => h.id).join(", ")}
  ${APP_NAME} uninstall --app <id|all>    Remove it again
  ${APP_NAME} doctor                      Check your setup and that the sources are reachable
  ${APP_NAME} search "<what you need>" [--mode app|library|…] [--level beginner|developer]
                                          Quick search from the terminal (for testing)

Environment:
  GITHUB_TOKEN        Optional, strongly recommended (higher GitHub limits)
  STACKEXCHANGE_KEY   Optional (more Stack Overflow lookups)
  FGT_CACHE_DIR       Cache folder (default ~/.cache/${APP_NAME})
  FGT_DISABLE_SOURCES Comma-separated source ids to skip
  FGT_HTTP_TOKEN      Bearer token for the HTTP server (required beyond localhost)
`;

const out = (line: string) => process.stdout.write(`${line}\n`);

async function doctor(): Promise<number> {
  const config = loadConfig();
  const http = new HttpClient(config, new FileCache(config.cacheDir, out));
  out(`${APP_NAME} ${APP_VERSION} on Node ${process.versions.node}`);
  out(`GitHub token: ${config.githubToken ? "set" : "not set (works, but with low GitHub limits)"}`);
  out(`Cache: ${config.cacheDir}`);
  let failed = 0;
  try {
    // The rate_limit endpoint is free to call and shows how much GitHub quota is left.
    const rl = await http.json<{ resources: Record<"core" | "search", { remaining: number; limit: number; reset: number }> }>("https://api.github.com/rate_limit", {
      headers: config.githubToken ? { Authorization: `Bearer ${config.githubToken}` } : {},
      timeoutMs: 15_000,
    });
    const core = rl?.resources.core;
    const search = rl?.resources.search;
    const resetAt = core ? new Date(core.reset * 1000).toLocaleTimeString() : "?";
    const empty = core?.remaining === 0 || search?.remaining === 0;
    out(`${empty ? "!" : "✓"} GitHub: ${core?.remaining}/${core?.limit} calls and ${search?.remaining}/${search?.limit} searches left${empty ? ` (resets at ${resetAt}; other sources still work)` : ""}`);
  } catch (err) {
    failed++;
    out(`✗ GitHub: ${errorMessage(err)}`);
  }
  const checks: [string, string][] = [
    ["deps.dev", "https://api.deps.dev/v3/projects/github.com%2Fnodejs%2Fnode"],
    ["Flathub", "https://flathub.org/api/v2/stats"],
    ["Hacker News", "https://hn.algolia.com/api/v1/search?query=test&hitsPerPage=1"],
    ["awesome-selfhosted", "https://raw.githubusercontent.com/awesome-selfhosted/awesome-selfhosted/master/README.md"],
  ];
  for (const [name, url] of checks) {
    try {
      const reachable = await http.exists(url, { timeoutMs: 15_000 });
      out(`${reachable ? "✓" : "✗"} ${name}`);
      if (!reachable) failed++;
    } catch (err) {
      failed++;
      out(`✗ ${name}: ${errorMessage(err)}`);
    }
  }
  return failed === 0 ? 0 : 1;
}

async function quickSearch(query: string, mode: string | undefined, level: string | undefined): Promise<number> {
  const config = loadConfig();
  const http = new HttpClient(config, new FileCache(config.cacheDir, out));
  const spec = parseSpec({
    need: query,
    keywords: [query],
    mode: mode && (MODES as readonly string[]).includes(mode) ? mode : "any",
    techLevel: level && (TECH_LEVELS as readonly string[]).includes(level) ? level : "beginner",
    maxResults: 10,
  });
  const result = await searchTools(spec, { http, config, now: new Date() });
  for (const c of result.candidates) {
    out(`${(c.prelimScore ?? 0).toFixed(2)}  ${c.name}  ${c.url}  [${c.sources.join(", ")}]${c.stars !== undefined ? `  ★${c.stars}` : ""}`);
  }
  out(compactJson({ sourcesUsed: result.sourcesUsed, warnings: result.warnings, rejected: result.rejected.length }));
  return result.candidates.length > 0 ? 0 : 1;
}

export async function main(argv: string[]): Promise<number> {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      http: { type: "boolean", default: false },
      port: { type: "string", default: "3333" },
      host: { type: "string", default: "127.0.0.1" },
      app: { type: "string", multiple: true },
      "dry-run": { type: "boolean", default: false },
      "save-token": { type: "boolean", default: false },
      mode: { type: "string" },
      level: { type: "string" },
      help: { type: "boolean", short: "h", default: false },
      version: { type: "boolean", short: "v", default: false },
    },
  });
  const [command, ...rest] = positionals;
  if (values.version) {
    out(APP_VERSION);
    return 0;
  }
  if (values.help || !command) {
    out(HELP);
    return command || values.help ? 0 : 1;
  }
  switch (command) {
    case "serve": {
      const config = loadConfig();
      if (!values.http) {
        await serveStdio(config);
        return -1; // keep running
      }
      const port = Number(values.port);
      if (!Number.isInteger(port) || port < 1 || port > 65535) {
        out("--port must be a number between 1 and 65535");
        return 1;
      }
      await serveHttp(config, { host: values.host, port });
      return -1;
    }
    case "install":
    case "uninstall": {
      const apps = (values.app ?? []).flatMap((a) => a.split(",")).map((a) => a.trim()).filter(Boolean);
      if (apps.length === 0) {
        out(`Choose which AI app(s) with --app: ${hostTargets(currentHostEnv()).map((h) => h.id).join(", ")}, all`);
        return 1;
      }
      const ok = await runInstall({ hosts: apps, dryRun: values["dry-run"], saveToken: values["save-token"], uninstall: command === "uninstall", out });
      return ok ? 0 : 1;
    }
    case "doctor":
      return doctor();
    case "search": {
      const query = rest.join(" ").trim();
      if (!query) {
        out('Usage: search "<what you need>"');
        return 1;
      }
      return quickSearch(query, values.mode, values.level);
    }
    default:
      out(`Unknown command "${command}".\n`);
      out(HELP);
      return 1;
  }
}

main(process.argv.slice(2)).then(
  (code) => {
    if (code >= 0) process.exitCode = code;
  },
  (err: unknown) => {
    process.stderr.write(`${APP_NAME}: ${errorMessage(err)}\n`);
    process.exitCode = 1;
  },
);
