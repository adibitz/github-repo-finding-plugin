# Setting up find-github-tool in each AI app

The easiest way for every app below is the installer, which edits the config files for you
(with a backup) and copies the skill:

```bash
node dist/find-github-tool.mjs install --app <app-id>
```

App ids: `claude-desktop`, `cursor`, `vscode`, `windsurf`, `antigravity`, `gemini-cli`, `codex`,
or `all`. Add `--dry-run` to preview. The snippets below are for doing it by hand. Replace
`ABSOLUTE/PATH/TO` with the folder where you cloned or installed this project.

| App | MCP config file | Skill folder | Snippet |
|---|---|---|---|
| Claude Code | (use the plugin) | (plugin) | see main README |
| Claude Desktop | `%APPDATA%\Claude\claude_desktop_config.json` (Windows), `~/Library/Application Support/Claude/claude_desktop_config.json` (Mac) | upload a ZIP in Customize → Skills | [claude-desktop](claude-desktop/) |
| Antigravity (IDE + CLI) | `~/.gemini/config/mcp_config.json` | `~/.gemini/config/skills/`, `~/.gemini/antigravity-cli/skills/` | [antigravity](antigravity/) |
| Cursor | `~/.cursor/mcp.json` | `~/.agents/skills/` or `~/.cursor/skills/` | [cursor](cursor/) |
| VS Code (Copilot) | user `mcp.json` (Command Palette → "MCP: Open User Configuration") | `~/.agents/skills/` or `~/.copilot/skills/` | [vscode](vscode/) |
| Windsurf / Devin Desktop | `~/.config/devin/mcp_config.json` (`%APPDATA%\devin\` on Windows); legacy `~/.codeium/windsurf/mcp_config.json` | `~/.agents/skills/` | [windsurf](windsurf/) |
| Gemini CLI | `~/.gemini/settings.json` | `~/.agents/skills/` or `~/.gemini/skills/` | [gemini-cli](gemini-cli/) |
| Codex CLI | `~/.codex/config.toml` | `~/.agents/skills/` | [codex](codex/) |
| ChatGPT | remote HTTPS server only | n/a | [chatgpt](chatgpt/) |
| Anything else / no server | n/a | upload [lite skill](lite/find-github-tool-lite/) | [lite](lite/) |

The skill folder to copy is `skills/find-github-tool/` (the whole folder, including `references/`).

Paths were checked against each app's official docs on 2026-10-18. Apps move these files
between releases, so if one doesn't work, check the app's MCP and skills docs.
