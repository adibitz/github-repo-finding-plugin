# Claude Desktop

## Option A: one-click extension (.mcpb)

Build the bundle once (developers), then share the `.mcpb` file. Everyone else just double-clicks it.

```bash
npm install
npm run build
node scripts/pack-mcpb.mjs
npx @anthropic-ai/mcpb pack build/mcpb find-github-tool.mcpb
```

Double-click `find-github-tool.mcpb`. Claude Desktop shows an install screen with an optional
GitHub token field. Then start a chat and pick the **find-github-tool** prompt (or just ask
"find me an open-source tool for …").

## Option B: installer

```bash
node dist/find-github-tool.mjs install --app claude-desktop
```

Restart Claude Desktop afterwards.

## The skill (optional, recommended)

Claude Desktop loads skills from a ZIP upload: zip the `skills/find-github-tool` folder and upload
it in **Customize → Skills** (code execution must be on). The MCP prompt already contains the
same playbook, so this is optional.
