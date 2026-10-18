export interface ServerEntry {
  command: string;
  args: string[];
  env?: Record<string, string>;
}

export class ConfigParseError extends Error {
  constructor(path: string) {
    super(`Could not read ${path} as plain JSON (it may contain comments). Add the server by hand using the snippet below.`);
    this.name = "ConfigParseError";
  }
}

/**
 * Add or replace one MCP server in a JSON config, keeping every other setting.
 * `key` is "mcpServers" for most hosts and "servers" for VS Code.
 */
export function upsertJsonServer(text: string | undefined, path: string, key: "mcpServers" | "servers", name: string, entry: ServerEntry, addStdioType = false): string {
  let root: Record<string, unknown> = {};
  if (text !== undefined && text.trim() !== "") {
    try {
      const parsed: unknown = JSON.parse(text);
      if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("not an object");
      root = parsed as Record<string, unknown>;
    } catch {
      throw new ConfigParseError(path);
    }
  }
  const existing = root[key];
  const servers = existing && typeof existing === "object" && !Array.isArray(existing) ? { ...(existing as Record<string, unknown>) } : {};
  servers[name] = addStdioType ? { type: "stdio", ...entry } : { ...entry };
  return `${JSON.stringify({ ...root, [key]: servers }, null, 2)}\n`;
}

/** Remove one server from a JSON config. Returns undefined when there was nothing to remove. */
export function removeJsonServer(text: string, path: string, key: "mcpServers" | "servers", name: string): string | undefined {
  let root: Record<string, unknown>;
  try {
    root = JSON.parse(text) as Record<string, unknown>;
  } catch {
    throw new ConfigParseError(path);
  }
  const servers = root[key] as Record<string, unknown> | undefined;
  if (!servers || !(name in servers)) return undefined;
  const { [name]: _removed, ...rest } = servers;
  return `${JSON.stringify({ ...root, [key]: rest }, null, 2)}\n`;
}

const tomlString = (s: string) => JSON.stringify(s);

/** The Codex `[mcp_servers.<name>]` block. Tokens are forwarded by name (env_vars), never stored. */
export function codexBlock(name: string, entry: ServerEntry, forwardEnv: string[]): string {
  const lines = [`[mcp_servers.${name}]`, `command = ${tomlString(entry.command)}`, `args = [${entry.args.map(tomlString).join(", ")}]`];
  if (forwardEnv.length) lines.push(`env_vars = [${forwardEnv.map(tomlString).join(", ")}]`);
  return `${lines.join("\n")}\n`;
}

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** `[mcp_servers.<name>]` with optional quotes around either key, spaces and a trailing comment. */
function tomlHeaderPattern(name: string, subTable = false): RegExp {
  const key = `(?:${escapeRegExp(name)}|"${escapeRegExp(name)}"|'${escapeRegExp(name)}')`;
  const table = `(?:mcp_servers|"mcp_servers")`;
  return subTable ? new RegExp(`^\\s*\\[\\s*${table}\\s*\\.\\s*${key}\\s*\\.`) : new RegExp(`^\\s*\\[\\s*${table}\\s*\\.\\s*${key}\\s*\\]\\s*(?:#.*)?$`);
}

/** Find our block: from its header to the next header that isn't one of its own sub-tables. */
function findTomlBlock(text: string, name: string): { start: number; end: number } | undefined {
  const lines = text.split(/\r?\n/);
  const header = tomlHeaderPattern(name);
  const sub = tomlHeaderPattern(name, true);
  const start = lines.findIndex((l) => header.test(l));
  if (start === -1) return undefined;
  let end = start + 1;
  while (end < lines.length) {
    const line = lines[end] ?? "";
    if (line.trim().startsWith("[") && !sub.test(line)) break;
    end++;
  }
  return { start, end };
}

export function upsertTomlServer(text: string | undefined, name: string, block: string): string {
  const current = text ?? "";
  const found = findTomlBlock(current, name);
  if (!found) return `${current.replace(/\s*$/, "")}${current.trim() ? "\n\n" : ""}${block}`;
  const lines = current.split(/\r?\n/);
  lines.splice(found.start, found.end - found.start, ...block.trimEnd().split("\n"), "");
  return lines.join("\n");
}

export function removeTomlServer(text: string, name: string): string | undefined {
  const found = findTomlBlock(text, name);
  if (!found) return undefined;
  const lines = text.split(/\r?\n/);
  lines.splice(found.start, found.end - found.start);
  return lines.join("\n").replace(/\n{3,}/g, "\n\n");
}
