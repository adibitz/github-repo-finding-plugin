# Cursor

Installer (recommended):

```bash
node dist/find-github-tool.mjs install --app cursor
```

By hand:
1. Merge [mcp.json](mcp.json) into ~/.cursor/mcp.json, replacing `ABSOLUTE/PATH/TO` with where this project lives.
2. Copy the `skills/find-github-tool` folder into `~/.agents/skills/` (shared by Cursor, VS Code, Windsurf, Gemini CLI and Codex).
3. Restart the app and ask it to use the find-github-tool skill, e.g. *"Find me a free, self-hosted alternative to Trello."*
