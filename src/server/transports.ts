import { timingSafeEqual } from "node:crypto";
import { createServer as createHttpServer, type IncomingMessage, type ServerResponse } from "node:http";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { APP_NAME, type Config } from "../config.js";
import { FileCache } from "../sources/cache.js";
import { HttpClient } from "../sources/http.js";
import { createServer } from "./server.js";

const log = (m: string) => process.stderr.write(`[${APP_NAME}] ${m}\n`);
const MAX_BODY_BYTES = 1_000_000;

/** Local mode: the AI app starts this process and talks over stdin/stdout. Logs go to stderr only. */
export async function serveStdio(config: Config): Promise<void> {
  const server = createServer({ config, log });
  await server.connect(new StdioServerTransport());
  log(`ready (stdio)${config.githubToken ? "" : ". No GITHUB_TOKEN: GitHub quota is limited"}`);
}

function readBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error("Request body too large"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      try {
        resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : undefined);
      } catch {
        reject(new Error("Invalid JSON"));
      }
    });
    req.on("error", reject);
  });
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "Content-Type": "application/json" }).end(JSON.stringify(body));
}

export interface HttpOptions {
  host: string;
  port: number;
}

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);

function hostnameOf(hostHeader: string): string {
  return hostHeader.startsWith("[") ? hostHeader.slice(0, hostHeader.indexOf("]") + 1) : (hostHeader.split(":")[0] ?? "");
}

function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

/**
 * Who may call the HTTP endpoint. With a token (FGT_HTTP_TOKEN), callers must send it as a
 * bearer token. Without one, the server only answers loopback Host names and same-machine
 * origins, which blocks web pages that use DNS rebinding to reach a local server.
 */
export function isAllowedHttpRequest(headers: { host?: string; origin?: string; authorization?: string }, opts: HttpOptions, token: string | undefined): boolean {
  if (token) return safeEqual(headers.authorization ?? "", `Bearer ${token}`);
  if (!LOOPBACK_HOSTS.has(hostnameOf(headers.host ?? ""))) return false;
  if (headers.origin) {
    try {
      if (!LOOPBACK_HOSTS.has(new URL(headers.origin).hostname)) return false;
    } catch {
      return false;
    }
  }
  return LOOPBACK_HOSTS.has(opts.host);
}

/**
 * Remote mode (Streamable HTTP, stateless): one MCP server per request, sharing one cache and
 * HTTP client so rate limits and cached results are shared. Binds to localhost by default;
 * beyond localhost it requires FGT_HTTP_TOKEN and should sit behind HTTPS.
 */
export async function serveHttp(config: Config, opts: HttpOptions): Promise<void> {
  if (!LOOPBACK_HOSTS.has(opts.host) && !config.httpToken) {
    throw new Error("Refusing to listen beyond localhost without FGT_HTTP_TOKEN. Set it, and put the server behind HTTPS.");
  }
  const cache = new FileCache(config.cacheDir, log);
  const http = new HttpClient(config, cache);

  const httpServer = createHttpServer(async (req, res) => {
    const path = new URL(req.url ?? "/", "http://localhost").pathname;
    if (req.method === "GET" && path === "/health") return sendJson(res, 200, { ok: true });
    if (path !== "/mcp") return sendJson(res, 404, { error: "Not found. The MCP endpoint is /mcp" });
    if (!isAllowedHttpRequest({ host: req.headers.host, origin: req.headers.origin, authorization: req.headers.authorization }, opts, config.httpToken)) {
      return sendJson(res, 403, { jsonrpc: "2.0", error: { code: -32001, message: "Forbidden" }, id: null });
    }
    if (req.method !== "POST") {
      res.setHeader("Allow", "POST");
      return sendJson(res, 405, { jsonrpc: "2.0", error: { code: -32000, message: "Method not allowed (stateless server: use POST)" }, id: null });
    }
    try {
      const body = await readBody(req);
      const server = createServer({ config, cache, http, log });
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
      res.on("close", () => {
        void transport.close();
        void server.close();
      });
      await server.connect(transport);
      await transport.handleRequest(req, res, body);
    } catch (err) {
      log(`HTTP request failed: ${err instanceof Error ? err.message : String(err)}`);
      if (!res.headersSent) sendJson(res, 400, { jsonrpc: "2.0", error: { code: -32700, message: "Bad request" }, id: null });
    }
  });

  await new Promise<void>((resolve, reject) => {
    httpServer.once("error", reject);
    httpServer.listen(opts.port, opts.host, () => resolve());
  });
  log(`ready (HTTP) at http://${opts.host}:${opts.port}/mcp`);
  if (!LOOPBACK_HOSTS.has(opts.host)) log("Listening beyond localhost: callers must send the FGT_HTTP_TOKEN bearer token. Use HTTPS in front of it.");
}
