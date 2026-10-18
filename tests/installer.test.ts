import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { codexBlock, ConfigParseError, removeJsonServer, removeTomlServer, upsertJsonServer, upsertTomlServer } from "../src/installer/config-edit.js";
import { hostTargets, type HostEnv } from "../src/installer/hosts.js";
import { redactedEntry, runInstall, serverEntry } from "../src/installer/install.js";

const entry = { command: "node", args: ["/opt/fgt/dist/find-github-tool.mjs", "serve"] };

describe("JSON config editing", () => {
  it("adds the server and keeps other settings", () => {
    const before = JSON.stringify({ theme: "dark", mcpServers: { other: { command: "x" } } });
    const after = JSON.parse(upsertJsonServer(before, "f", "mcpServers", "find-github-tool", entry));
    expect(after.theme).toBe("dark");
    expect(after.mcpServers.other).toEqual({ command: "x" });
    expect(after.mcpServers["find-github-tool"]).toEqual(entry);
  });

  it("creates new files, supports VS Code's key and stdio type, and removes again", () => {
    const created = upsertJsonServer(undefined, "f", "servers", "find-github-tool", entry, true);
    expect(JSON.parse(created).servers["find-github-tool"].type).toBe("stdio");
    const removed = removeJsonServer(created, "f", "servers", "find-github-tool");
    expect(JSON.parse(removed!).servers).toEqual({});
    expect(removeJsonServer(removed!, "f", "servers", "find-github-tool")).toBeUndefined();
  });

  it("refuses to rewrite files it can't parse (e.g. JSON with comments)", () => {
    expect(() => upsertJsonServer('{ // comment\n "a": 1 }', "f", "mcpServers", "x", entry)).toThrow(ConfigParseError);
    expect(() => upsertJsonServer("[1,2]", "f", "mcpServers", "x", entry)).toThrow(ConfigParseError);
  });
});

describe("Codex TOML editing", () => {
  const block = codexBlock("find-github-tool", entry, ["GITHUB_TOKEN"]);

  it("forwards tokens by name only", () => {
    expect(block).toContain('env_vars = ["GITHUB_TOKEN"]');
    expect(block).toContain('args = ["/opt/fgt/dist/find-github-tool.mjs", "serve"]');
  });

  it("appends, replaces in place and removes our block only", () => {
    const base = 'model = "o5"\n\n[mcp_servers.other]\ncommand = "y"\n';
    const added = upsertTomlServer(base, "find-github-tool", block);
    expect(added).toContain('[mcp_servers.other]\ncommand = "y"');
    expect(added).toContain("[mcp_servers.find-github-tool]");
    const replaced = upsertTomlServer(added.replace('"serve"]', '"old"]'), "find-github-tool", block);
    expect(replaced.match(/\[mcp_servers\.find-github-tool\]/g)).toHaveLength(1);
    expect(replaced).not.toContain('"old"');
    const removed = removeTomlServer(replaced, "find-github-tool")!;
    expect(removed).not.toContain("find-github-tool");
    expect(removed).toContain("[mcp_servers.other]");
  });
});

describe("serverEntry", () => {
  it("uses an absolute path normally and npx when running from the npx cache", () => {
    expect(serverEntry("/opt/fgt", undefined).command).toBe("node");
    expect(serverEntry("C:\\Users\\me\\AppData\\Local\\npm-cache\\_npx\\abc\\node_modules\\find-github-tool", undefined)).toEqual({ command: "npx", args: ["-y", "find-github-tool", "serve"] });
    expect(serverEntry("/opt/fgt", "tok").env).toEqual({ GITHUB_TOKEN: "tok" });
  });
});

describe("hostTargets", () => {
  it("resolves per-OS paths", () => {
    const win = hostTargets({ platform: "win32", home: "C:\\Users\\me", appData: "C:\\Users\\me\\AppData\\Roaming" });
    expect(win.find((h) => h.id === "claude-desktop")?.configs[0]?.path).toBe(join("C:\\Users\\me\\AppData\\Roaming", "Claude", "claude_desktop_config.json"));
    const mac = hostTargets({ platform: "darwin", home: "/Users/me" });
    expect(mac.find((h) => h.id === "vscode")?.configs[0]?.path).toBe(join("/Users/me", "Library", "Application Support", "Code", "User", "mcp.json"));
    expect(mac.find((h) => h.id === "antigravity")?.skillDirs).toEqual([join("/Users/me", ".gemini", "config", "skills"), join("/Users/me", ".gemini", "antigravity-cli", "skills")]);
  });
});

describe("runInstall (temp home)", () => {
  let home: string;
  let root: string;
  let env: HostEnv;
  const lines: string[] = [];
  const out = (l: string) => lines.push(l);

  beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), "fgt-home-"));
    root = await mkdtemp(join(tmpdir(), "fgt-root-"));
    await mkdir(join(root, "skills", "find-github-tool", "references"), { recursive: true });
    await writeFile(join(root, "skills", "find-github-tool", "SKILL.md"), "---\nname: find-github-tool\n---\nbody");
    await writeFile(join(root, "skills", "find-github-tool", "references", "glossary.md"), "g");
    env = { platform: "linux", home, xdgConfig: join(home, ".config") };
    lines.length = 0;
  });
  afterEach(async () => {
    await rm(home, { recursive: true, force: true });
    await rm(root, { recursive: true, force: true });
  });

  it("registers the server, copies the skill, backs up existing configs, then uninstalls", async () => {
    const cursorCfg = join(home, ".cursor", "mcp.json");
    await mkdir(join(home, ".cursor"), { recursive: true });
    await writeFile(cursorCfg, JSON.stringify({ mcpServers: { keep: { command: "k" } } }));

    expect(await runInstall({ hosts: ["cursor", "codex", "antigravity"], dryRun: false, saveToken: false, uninstall: false, out }, env, root)).toBe(true);

    const cursor = JSON.parse(await readFile(cursorCfg, "utf8"));
    expect(cursor.mcpServers.keep).toEqual({ command: "k" });
    expect(cursor.mcpServers["find-github-tool"]).toMatchObject({ type: "stdio", command: "node" });
    expect((await readdir(join(home, ".cursor"))).some((f) => f.startsWith("mcp.json.bak-"))).toBe(true);
    expect(await readFile(join(home, ".codex", "config.toml"), "utf8")).toContain('env_vars = ["GITHUB_TOKEN", "STACKEXCHANGE_KEY"]');
    expect(await readFile(join(home, ".agents", "skills", "find-github-tool", "references", "glossary.md"), "utf8")).toBe("g");
    expect(await readFile(join(home, ".gemini", "antigravity-cli", "skills", "find-github-tool", "SKILL.md"), "utf8")).toContain("name: find-github-tool");

    expect(await runInstall({ hosts: ["cursor", "codex"], dryRun: false, saveToken: false, uninstall: true, out }, env, root)).toBe(true);
    expect(JSON.parse(await readFile(cursorCfg, "utf8")).mcpServers).toEqual({ keep: { command: "k" } });
    expect(await readFile(join(home, ".codex", "config.toml"), "utf8")).not.toContain("find-github-tool");
  });

  it("keeps the shared skill folder when other apps still use it, and never prints a saved token", async () => {
    await runInstall({ hosts: ["cursor"], dryRun: false, saveToken: false, uninstall: false, out }, env, root);
    await runInstall({ hosts: ["cursor"], dryRun: false, saveToken: false, uninstall: true, out }, env, root);
    expect(await readFile(join(home, ".agents", "skills", "find-github-tool", "SKILL.md"), "utf8")).toContain("find-github-tool");
    expect(lines.some((l) => l.includes("kept skill"))).toBe(true);
    expect(redactedEntry({ command: "node", args: [], env: { GITHUB_TOKEN: "ghp_secret" } }).env).toEqual({ GITHUB_TOKEN: "<your GITHUB_TOKEN>" });
  });

  it("changes nothing in dry-run mode and rejects unknown apps", async () => {
    expect(await runInstall({ hosts: ["all"], dryRun: true, saveToken: false, uninstall: false, out }, env, root)).toBe(true);
    expect(await readdir(home)).toEqual([]);
    expect(lines.some((l) => l.includes("would create"))).toBe(true);
    expect(await runInstall({ hosts: ["notepad"], dryRun: true, saveToken: false, uninstall: false, out }, env, root)).toBe(false);
  });
});
