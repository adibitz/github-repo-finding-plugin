# Windsurf / Devin Desktop

Installer (recommended):

```bash
node dist/find-github-tool.mjs install --app windsurf
```

By hand:
1. Merge [mcp_config.json](mcp_config.json) into ~/.config/devin/mcp_config.json (Windows: %APPDATA%\devin\mcp_config.json); older Windsurf: ~/.codeium/windsurf/mcp_config.json, replacing `ABSOLUTE/PATH/TO` with where this project lives.
2. Copy the `skills/find-github-tool` folder into `~/.agents/skills/` (shared by Cursor, VS Code, Windsurf, Gemini CLI and Codex).
3. Restart the app and ask it to use the find-github-tool skill, e.g. *"Find me a free, self-hosted alternative to Trello."*
