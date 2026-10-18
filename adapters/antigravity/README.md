# Google Antigravity (IDE and Antigravity CLI)

## Installer (recommended)

```bash
node dist/find-github-tool.mjs install --app antigravity
```

This adds the server to `~/.gemini/config/mcp_config.json` and copies the skill to
`~/.gemini/config/skills/find-github-tool/` (IDE/app) and
`~/.gemini/antigravity-cli/skills/find-github-tool/` (CLI).

## By hand

1. Merge [mcp_config.json](mcp_config.json) into `~/.gemini/config/mcp_config.json`
   (on Windows: `%USERPROFILE%\.gemini\config\mcp_config.json`), fixing the path.
2. Copy the `skills/find-github-tool` folder into `~/.gemini/config/skills/` and/or
   `~/.gemini/antigravity-cli/skills/`. For one project only, use `<project>/.agents/skills/`.
3. Restart Antigravity, then ask: *"Use the find-github-tool skill to find a free app for …"*.

To give the server a GitHub token, add `"env": { "GITHUB_TOKEN": "<token>" }` to the server
entry. The token stays in that file on your computer.
