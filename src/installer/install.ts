import { cp, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { APP_NAME } from "../config.js";
import { codexBlock, ConfigParseError, removeJsonServer, removeTomlServer, upsertJsonServer, upsertTomlServer, type ServerEntry } from "./config-edit.js";
import { hostTargets, type HostEnv, type HostTarget } from "./hosts.js";

export interface InstallOptions {
  hosts: string[];
  dryRun: boolean;
  /** Write the current GITHUB_TOKEN value into JSON configs (off by default; Codex always forwards by name). */
  saveToken: boolean;
  uninstall: boolean;
  out: (line: string) => void;
}

export function currentHostEnv(): HostEnv {
  return { platform: process.platform, home: homedir(), appData: process.env.APPDATA, xdgConfig: process.env.XDG_CONFIG_HOME };
}

/** Folder holding dist/ and skills/, resolved from this bundle's location. */
export function packageRoot(): string {
  return resolve(dirname(fileURLToPath(import.meta.url)), "..");
}

/**
 * How AI apps should start the server. A path inside the npx cache disappears later, so npx
 * installs use `npx -y find-github-tool serve` instead of an absolute path.
 */
export function serverEntry(root: string, token: string | undefined): ServerEntry {
  const bundle = join(root, "dist", `${APP_NAME}.mjs`);
  const viaNpx = /[\\/]_npx[\\/]/.test(root);
  const entry: ServerEntry = viaNpx ? { command: "npx", args: ["-y", APP_NAME, "serve"] } : { command: "node", args: [bundle, "serve"] };
  if (token) entry.env = { GITHUB_TOKEN: token };
  return entry;
}

async function exists(path: string): Promise<boolean> {
  return stat(path).then(
    () => true,
    () => false,
  );
}

async function readIfExists(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw err;
  }
}

// Config files can hold tokens: new files and backups are readable by the owner only.
// (An existing file keeps its own permissions when rewritten.)
const PRIVATE_FILE = { encoding: "utf8", mode: 0o600 } as const;

async function writeWithBackup(path: string, before: string | undefined, after: string): Promise<string | undefined> {
  await mkdir(dirname(path), { recursive: true });
  let backup: string | undefined;
  if (before !== undefined) {
    backup = `${path}.bak-${new Date().toISOString().replace(/[:.]/g, "-")}`;
    await writeFile(backup, before, PRIVATE_FILE);
  }
  await writeFile(path, after, PRIVATE_FILE);
  return backup;
}

/** The server entry for printing: a saved token is replaced by a placeholder. */
export function redactedEntry(entry: ServerEntry): ServerEntry {
  return entry.env ? { ...entry, env: Object.fromEntries(Object.keys(entry.env).map((k) => [k, `<your ${k}>`])) } : entry;
}

async function applyHost(host: HostTarget, entry: ServerEntry, root: string, opts: InstallOptions, keepSkillDirs: Set<string>): Promise<boolean> {
  const { out } = opts;
  out(`\n${host.name}`);
  let okAll = true;
  for (const cfg of host.configs) {
    if (cfg.optional && !(await exists(cfg.path))) continue;
    const before = await readIfExists(cfg.path);
    try {
      let after: string | undefined;
      if (cfg.format === "toml-codex") {
        // Codex forwards the token by variable name, so its value is never written to disk.
        const tomlEntry = { command: entry.command, args: entry.args };
        after = opts.uninstall ? (before ? removeTomlServer(before, APP_NAME) : undefined) : upsertTomlServer(before, APP_NAME, codexBlock(APP_NAME, tomlEntry, ["GITHUB_TOKEN", "STACKEXCHANGE_KEY"]));
      } else {
        const key = cfg.format === "json-servers" ? "servers" : "mcpServers";
        after = opts.uninstall ? (before ? removeJsonServer(before, cfg.path, key, APP_NAME) : undefined) : upsertJsonServer(before, cfg.path, key, APP_NAME, entry, cfg.addStdioType);
      }
      if (after === undefined) {
        out(`  - ${cfg.path}: nothing to remove`);
        continue;
      }
      if (opts.dryRun) {
        out(`  - would ${opts.uninstall ? "update" : before === undefined ? "create" : "update"} ${cfg.path}`);
        continue;
      }
      const backup = await writeWithBackup(cfg.path, before, after);
      out(`  ✓ ${opts.uninstall ? "removed from" : "registered in"} ${cfg.path}${backup ? ` (backup: ${backup})` : ""}`);
    } catch (err) {
      okAll = false;
      out(`  ✗ ${err instanceof Error ? err.message : String(err)}`);
      if (err instanceof ConfigParseError) out(`    Snippet: ${JSON.stringify({ [APP_NAME]: redactedEntry(entry) })}`);
    }
  }

  const skillSource = join(root, "skills", APP_NAME);
  for (const dir of host.skillDirs) {
    const target = join(dir, APP_NAME);
    if (opts.uninstall && keepSkillDirs.has(dir)) {
      out(`  - kept skill ${target} (other AI apps use this folder too)`);
      continue;
    }
    if (opts.dryRun) {
      out(`  - would ${opts.uninstall ? "remove" : "copy skill to"} ${target}`);
      continue;
    }
    try {
      if (opts.uninstall) {
        await rm(target, { recursive: true, force: true });
        out(`  ✓ removed skill ${target}`);
      } else {
        await mkdir(dir, { recursive: true });
        await cp(skillSource, target, { recursive: true, force: true });
        out(`  ✓ skill copied to ${target}`);
      }
    } catch (err) {
      okAll = false;
      out(`  ✗ skill: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  if (!opts.uninstall && !opts.dryRun) for (const step of host.manualSteps) out(`  → ${step}`);
  return okAll;
}

/** Register the MCP server and copy the skill into the chosen AI tools. Returns false if any step failed. */
export async function runInstall(opts: InstallOptions, env: HostEnv = currentHostEnv(), root: string = packageRoot()): Promise<boolean> {
  const targets = hostTargets(env);
  const ids = opts.hosts.includes("all") ? targets.map((t) => t.id) : opts.hosts;
  const unknown = ids.filter((id) => !targets.some((t) => t.id === id));
  if (unknown.length) {
    opts.out(`Unknown app(s): ${unknown.join(", ")}. Choose from: ${targets.map((t) => t.id).join(", ")}, all`);
    return false;
  }
  if (!(await exists(join(root, "skills", APP_NAME, "SKILL.md")))) {
    opts.out(`Installation looks incomplete: ${join(root, "skills", APP_NAME, "SKILL.md")} is missing.`);
    return false;
  }
  const token = opts.saveToken ? (process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN) : undefined;
  if (opts.saveToken && !token) opts.out("--save-token was given but GITHUB_TOKEN is not set; continuing without a token.");
  if (token) opts.out("Note: your GitHub token will be stored in the apps' config files on this computer.");
  const entry = serverEntry(root, token);
  // Skill folders shared with apps that stay installed (e.g. ~/.agents/skills) are kept on uninstall.
  const keepSkillDirs = new Set(targets.filter((t) => !ids.includes(t.id)).flatMap((t) => t.skillDirs));
  let ok = true;
  for (const id of ids) ok = (await applyHost(targets.find((t) => t.id === id)!, entry, root, opts, keepSkillDirs)) && ok;
  if (!opts.uninstall && !opts.dryRun) {
    opts.out("\nClaude Code users: install the plugin instead (see README): /plugin marketplace add <this repo>, then /plugin install find-github-tool");
  }
  return ok;
}
