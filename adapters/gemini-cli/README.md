# Gemini CLI

Installer (recommended):

```bash
node dist/find-github-tool.mjs install --app gemini-cli
```

By hand:
1. Merge [settings.json](settings.json) into ~/.gemini/settings.json, replacing `ABSOLUTE/PATH/TO` with where this project lives.
2. Copy the `skills/find-github-tool` folder into `~/.agents/skills/` (shared by Cursor, VS Code, Windsurf, Gemini CLI and Codex).
3. Restart the app and ask it to use the find-github-tool skill, e.g. *"Find me a free, self-hosted alternative to Trello."*
