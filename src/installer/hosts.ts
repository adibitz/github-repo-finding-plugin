import { join } from "node:path";

export type ConfigFormat = "json-mcpServers" | "json-servers" | "toml-codex";

export interface HostTarget {
  id: string;
  name: string;
  /** MCP config files to update. Optional ones are only touched if they already exist. */
  configs: { path: string; format: ConfigFormat; optional?: boolean; addStdioType?: boolean }[];
  /** Skill folders to copy the skill into (each gets a find-github-tool/ subfolder). */
  skillDirs: string[];
  /** Extra steps the user must do by hand. */
  manualSteps: string[];
}

export interface HostEnv {
  platform: NodeJS.Platform;
  home: string;
  appData?: string;
  xdgConfig?: string;
}

/** Folder read by Cursor, VS Code Copilot, Windsurf/Devin, Gemini CLI and Codex. */
export function sharedSkillsDir(env: HostEnv): string {
  return join(env.home, ".agents", "skills");
}

function appSupport(env: HostEnv, appFolder: string): string {
  if (env.platform === "win32") return join(env.appData ?? join(env.home, "AppData", "Roaming"), appFolder);
  if (env.platform === "darwin") return join(env.home, "Library", "Application Support", appFolder);
  return join(env.xdgConfig ?? join(env.home, ".config"), appFolder);
}

/**
 * Where each AI tool keeps its user-level MCP config and skills (checked against official docs
 * on 2026-10-18). Paths change between releases, so the installer backs files up first.
 */
export function hostTargets(env: HostEnv): HostTarget[] {
  const shared = sharedSkillsDir(env);
  return [
    {
      id: "claude-desktop",
      name: "Claude Desktop",
      configs: [{ path: join(appSupport(env, "Claude"), "claude_desktop_config.json"), format: "json-mcpServers" }],
      skillDirs: [],
      manualSteps: [
        "Restart Claude Desktop.",
        "Optional: upload the skill as a ZIP in Claude → Customize → Skills (zip the skills/find-github-tool folder).",
      ],
    },
    {
      id: "cursor",
      name: "Cursor",
      configs: [{ path: join(env.home, ".cursor", "mcp.json"), format: "json-mcpServers", addStdioType: true }],
      skillDirs: [shared],
      manualSteps: ["Restart Cursor, then check Settings → MCP shows find-github-tool as connected."],
    },
    {
      id: "vscode",
      name: "VS Code (GitHub Copilot)",
      configs: [{ path: join(appSupport(env, "Code"), "User", "mcp.json"), format: "json-servers", addStdioType: true }],
      skillDirs: [shared],
      manualSteps: ["Reload VS Code. In Copilot Chat (Agent mode), type /find-github-tool."],
    },
    {
      id: "windsurf",
      name: "Windsurf / Devin Desktop",
      configs: [
        {
          path: env.platform === "win32" ? join(env.appData ?? join(env.home, "AppData", "Roaming"), "devin", "mcp_config.json") : join(env.xdgConfig ?? join(env.home, ".config"), "devin", "mcp_config.json"),
          format: "json-mcpServers",
        },
        { path: join(env.home, ".codeium", "windsurf", "mcp_config.json"), format: "json-mcpServers", optional: true },
      ],
      skillDirs: [shared],
      manualSteps: ["Restart Windsurf / Devin Desktop."],
    },
    {
      id: "antigravity",
      name: "Google Antigravity (IDE + CLI)",
      configs: [{ path: join(env.home, ".gemini", "config", "mcp_config.json"), format: "json-mcpServers" }],
      skillDirs: [join(env.home, ".gemini", "config", "skills"), join(env.home, ".gemini", "antigravity-cli", "skills")],
      manualSteps: ["Restart Antigravity. Ask the agent: \"Use the find-github-tool skill to find …\"."],
    },
    {
      id: "gemini-cli",
      name: "Gemini CLI",
      configs: [{ path: join(env.home, ".gemini", "settings.json"), format: "json-mcpServers" }],
      skillDirs: [shared],
      manualSteps: ["Start gemini and type /find-github-tool (the MCP prompt)."],
    },
    {
      id: "codex",
      name: "OpenAI Codex CLI",
      configs: [{ path: join(env.home, ".codex", "config.toml"), format: "toml-codex" }],
      skillDirs: [shared],
      manualSteps: ["Start codex and ask it to use the find-github-tool skill."],
    },
  ];
}
