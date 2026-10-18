# find-github-tool

**Find the right open-source tool, app, library, add-on or AI model for any need, in plain language.**

Type **`/find-github-tool`** in your AI assistant and describe what you need, e.g.
*"a free app to make invoices for my shop"* or *"an MIT-licensed Python library to extract text from PDFs"*.

The assistant then:

1. asks up to 4 simple multiple-choice questions (who uses it, where it runs, budget, tech comfort, must-have features);
2. searches **GitHub plus 15 other sources** at once: GitLab, Codeberg, awesome-selfhosted, curated "awesome" lists, Flathub, F-Droid, YunoHost, npm, crates.io, PyPI/Maven/NuGet and more (via ecosyste.ms), Open VSX, WordPress, Obsidian, Hugging Face and the MCP Registry;
3. checks each finalist: is it maintained, how hard is it to set up (hosted? one-click install? Docker?), what the license means for you, security score, known vulnerabilities, which app stores ship it, and what people say on Hacker News, Stack Overflow and Lemmy;
4. reads the docs to confirm your must-haves, with quotes as evidence;
5. explains the **best 3 picks**: recommendation cards in plain words for everyday users, or a comparison table for developers, plus how to start.

It works in **Claude Code, Claude Desktop, claude.ai, Google Antigravity, Cursor, VS Code (Copilot), Windsurf, Gemini CLI, Codex and ChatGPT**, and any other app that supports MCP.

## Supported AI tools

| AI tool | How you start it | Setup |
|---|---|---|
| [Claude Code](#claude-code) (terminal, desktop app, VS Code / JetBrains extension) | `/find-github-tool` | Plugin, 2 commands |
| [Claude Desktop](#claude-desktop) | Pick the **find-github-tool** prompt, or just ask | Double-click `.mcpb`, or installer |
| [claude.ai](#claudeai-web-and-mobile) (web and mobile) | Ask for a tool | Upload the lite skill |
| [Google Antigravity](#google-antigravity-ide-and-cli) (IDE and CLI) | "Use the find-github-tool skill to …" | Installer |
| [Cursor](#cursor) | "Use the find-github-tool skill to …" | Installer |
| [VS Code + GitHub Copilot](#vs-code--github-copilot) | `/find-github-tool` in Copilot Chat (Agent mode) | Installer |
| [Windsurf / Devin Desktop](#windsurf--devin-desktop) | "Use the find-github-tool skill to …" | Installer |
| [Gemini CLI](#gemini-cli) | `/find-github-tool` | Installer |
| [OpenAI Codex CLI](#openai-codex-cli) | "Use the find-github-tool skill to …" | Installer |
| [ChatGPT](#chatgpt) | Ask for a tool | Self-hosted HTTPS server |
| [Any other MCP app](#any-other-mcp-app) | Depends on the app | Manual config |

---

## Install

> **Before you start:** replace `YOUR-GITHUB-USER` below with the GitHub account that hosts this
> repository. You need [Node.js](https://nodejs.org) 20 or newer for every option except
> claude.ai. Check with `node --version`.

### Step 1: Get the files (all apps except Claude Code)

Claude Code downloads the plugin for you, so skip to [Claude Code](#claude-code). For every
other app, put a copy of this project somewhere permanent (not a temporary or Downloads folder):

```bash
git clone https://github.com/YOUR-GITHUB-USER/find-github-tool.git
```

No `npm install` is needed: the ready-to-run server is already in `dist/`.

### Step 2: Run the installer for your app

```bash
node find-github-tool/dist/find-github-tool.mjs install --app <app-id>
```

App ids: `claude-desktop`, `antigravity`, `cursor`, `vscode`, `windsurf`, `gemini-cli`, `codex`,
or `all` for every app on your computer.

The installer:
- adds the server to the app's MCP config file, after saving a backup copy (`*.bak-<date>`);
- never rewrites a file it can't read safely: it prints a snippet for you to paste instead;
- copies the skill (the playbook) into the app's skills folder;
- prints what to do next (usually: restart the app).

Preview without changing anything: add `--dry-run`. Remove it again: `uninstall --app <app-id>`.
Check everything works: `node find-github-tool/dist/find-github-tool.mjs doctor`.

The sections below give the details per app, including how to set it up by hand.

---

### Claude Code

Works in the Claude Code terminal, the Claude desktop app's Code tab, and the VS Code and
JetBrains extensions.

**Install from GitHub.** Inside Claude Code, run:

```
/plugin marketplace add YOUR-GITHUB-USER/find-github-tool
/plugin install find-github-tool@find-github-tool
```

Or from a terminal:

```bash
claude plugin marketplace add YOUR-GITHUB-USER/find-github-tool
```

```bash
claude plugin install find-github-tool@find-github-tool
```

**Install from a local copy** (after `git clone`):

```
/plugin marketplace add ./find-github-tool
/plugin install find-github-tool@find-github-tool
```

**Try it for one session without installing:**

```bash
claude --plugin-dir ./find-github-tool
```

**Use it:** type `/find-github-tool` followed by what you need, for example
`/find-github-tool free app to make invoices for my shop`.

**Check it's connected:** run `/mcp`. You should see `plugin:find-github-tool:finder` as connected.
When you enable the plugin, Claude Code asks for an optional GitHub token (see [below](#add-a-github-token-optional-recommended)).

**Update:** `/plugin marketplace update find-github-tool`. **Remove:** `/plugin uninstall find-github-tool`.

The plugin includes the `/find-github-tool` skill, the MCP server, and a `tool-scout` subagent
that can run a whole search in the background.

---

### Claude Desktop

**Option A: one-click extension (`.mcpb`).** If someone shared a `find-github-tool.mcpb` file,
double-click it. Claude Desktop shows an install screen with an optional GitHub token field. To
build the file yourself, see [adapters/claude-desktop](adapters/claude-desktop/README.md).

**Option B: installer**

```bash
node find-github-tool/dist/find-github-tool.mjs install --app claude-desktop
```

Then quit and reopen Claude Desktop.

**Option C: by hand.** Open Settings → Developer → Edit Config, which opens
`claude_desktop_config.json` (`%APPDATA%\Claude\` on Windows,
`~/Library/Application Support/Claude/` on Mac). Add this, using your real path:

```json
{
  "mcpServers": {
    "find-github-tool": {
      "command": "node",
      "args": ["C:/path/to/find-github-tool/dist/find-github-tool.mjs", "serve"]
    }
  }
}
```

**Use it:** click **+** → find-github-tool prompt, or just ask *"Find me a free open-source app for …"*.
Optionally, zip the `skills/find-github-tool` folder and upload it in Customize → Skills.

---

### claude.ai (web and mobile)

claude.ai can't start a program on your computer, so it uses the **lite skill**. The lite skill
relies on Claude's web search and does fewer checks (no health or security scores).

1. Zip the folder [adapters/lite/find-github-tool-lite](adapters/lite/find-github-tool-lite/).
2. In claude.ai, go to Customize → Skills → upload the ZIP. Code execution must be turned on.
3. Ask: *"Find me an open-source alternative to Trello."*

---

### Google Antigravity (IDE and CLI)

```bash
node find-github-tool/dist/find-github-tool.mjs install --app antigravity
```

This registers the server in `~/.gemini/config/mcp_config.json` and copies the skill to
`~/.gemini/config/skills/` (IDE) and `~/.gemini/antigravity-cli/skills/` (CLI). Restart
Antigravity.

**By hand:** add this to `~/.gemini/config/mcp_config.json` (on Windows:
`%USERPROFILE%\.gemini\config\mcp_config.json`):

```json
{
  "mcpServers": {
    "find-github-tool": {
      "command": "node",
      "args": ["C:/path/to/find-github-tool/dist/find-github-tool.mjs", "serve"]
    }
  }
}
```

Then copy the `skills/find-github-tool` folder into `~/.gemini/config/skills/`. For a single
project only, copy it to `<project>/.agents/skills/` instead.

**Use it:** *"Use the find-github-tool skill to find a free invoicing app."*

---

### Cursor

```bash
node find-github-tool/dist/find-github-tool.mjs install --app cursor
```

**By hand:** add to `~/.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "find-github-tool": {
      "type": "stdio",
      "command": "node",
      "args": ["C:/path/to/find-github-tool/dist/find-github-tool.mjs", "serve"],
      "env": { "GITHUB_TOKEN": "${env:GITHUB_TOKEN}" }
    }
  }
}
```

Then copy `skills/find-github-tool` into `~/.agents/skills/` (or `~/.cursor/skills/`).

**Check:** Settings → MCP shows find-github-tool as connected. **Use it:** *"Use the
find-github-tool skill to find a VS Code extension for Markdown tables."*

---

### VS Code + GitHub Copilot

```bash
node find-github-tool/dist/find-github-tool.mjs install --app vscode
```

**By hand:** Command Palette → **MCP: Open User Configuration**, then add (note the key is
`servers`, not `mcpServers`):

```json
{
  "servers": {
    "find-github-tool": {
      "type": "stdio",
      "command": "node",
      "args": ["C:/path/to/find-github-tool/dist/find-github-tool.mjs", "serve"]
    }
  }
}
```

Then copy `skills/find-github-tool` into `~/.agents/skills/` (or `~/.copilot/skills/`).

**Use it:** open Copilot Chat, switch to **Agent** mode, and type `/find-github-tool`.

---

### Windsurf / Devin Desktop

```bash
node find-github-tool/dist/find-github-tool.mjs install --app windsurf
```

**By hand:** add the same `mcpServers` block as for Antigravity to
`~/.config/devin/mcp_config.json` (Windows: `%APPDATA%\devin\mcp_config.json`). Older Windsurf
versions use `~/.codeium/windsurf/mcp_config.json`. Copy `skills/find-github-tool` into
`~/.agents/skills/`, then restart.

---

### Gemini CLI

```bash
node find-github-tool/dist/find-github-tool.mjs install --app gemini-cli
```

**By hand:** add the same `mcpServers` block as for Antigravity to `~/.gemini/settings.json`, and
copy `skills/find-github-tool` into `~/.agents/skills/`.

**Use it:** start `gemini` and type `/find-github-tool`.

> Since June 2026, Google moved free-tier and Google One users from Gemini CLI to the
> Antigravity CLI. If that's you, follow the [Antigravity](#google-antigravity-ide-and-cli) steps.

---

### OpenAI Codex CLI

```bash
node find-github-tool/dist/find-github-tool.mjs install --app codex
```

**By hand:** add to `~/.codex/config.toml`:

```toml
[mcp_servers.find-github-tool]
command = "node"
args = ["C:/path/to/find-github-tool/dist/find-github-tool.mjs", "serve"]
env_vars = ["GITHUB_TOKEN", "STACKEXCHANGE_KEY"]
```

`env_vars` passes your token through without storing it in the file. Copy
`skills/find-github-tool` into `~/.agents/skills/`.

**Use it:** start `codex` and ask it to use the find-github-tool skill.

---

### ChatGPT

ChatGPT only connects to **remote HTTPS** MCP servers, so you run the server yourself:

```bash
FGT_HTTP_TOKEN=<long-random-secret> node find-github-tool/dist/find-github-tool.mjs serve --http --host 0.0.0.0 --port 3333
```

Put it behind HTTPS (Caddy, nginx or a tunnel), then in ChatGPT add a custom MCP server with the
URL `https://<your-domain>/mcp` and the secret as a bearer token. The server refuses to listen
beyond localhost without `FGT_HTTP_TOKEN`. Full steps: [adapters/chatgpt](adapters/chatgpt/README.md).

---

### Any other MCP app

Any app that supports MCP servers over stdio can use it. Register this command:

```
node /path/to/find-github-tool/dist/find-github-tool.mjs serve
```

Then give the AI the playbook in one of these ways:
- copy `skills/find-github-tool` into the app's skills folder (many apps read `~/.agents/skills/`);
- use the server's `find-github-tool` MCP prompt; or
- paste [SKILL.md](skills/find-github-tool/SKILL.md) into the chat or the app's custom instructions.

All config files, with paths per OS: [adapters/README.md](adapters/README.md).

---

## Add a GitHub token (optional, recommended)

Without a token, GitHub allows 10 searches a minute and 60 calls an hour, which is enough for a
few searches. With a free token it's 30 searches a minute and 5,000 calls an hour.

1. Go to GitHub → Settings → Developer settings → Personal access tokens → **Fine-grained tokens** → Generate.
2. Give it a name, choose "Public repositories (read-only)", and add **no** extra permissions.
3. Where to put it:
   - **Claude Code:** paste it when the plugin asks for its GitHub token.
   - **Claude Desktop (.mcpb):** paste it in the extension's settings.
   - **Codex:** set the `GITHUB_TOKEN` environment variable; it's forwarded automatically.
   - **Other apps:** set `GITHUB_TOKEN` in your environment before starting the app, or add
     `"env": { "GITHUB_TOKEN": "<token>" }` to the server entry. You can also run the installer
     with `--save-token`, which writes it into the app's config file on your computer.

The token is only sent to `api.github.com`.

## Troubleshooting

| Problem | Fix |
|---|---|
| The tools don't appear | Restart the app fully. Check the path in the config points to `dist/find-github-tool.mjs`. Run `doctor`. |
| `node` not found | Install Node.js 20+, or use the full path to `node` in the config's `command`. |
| "Rate limit reached for api.github.com" | Wait for the reset time shown, or add a GitHub token. Other sources keep working. |
| Few or odd results | Answer the interview questions, or ask the AI to broaden the keywords or remove a filter. |
| The installer says it couldn't read a config | That file has comments or unusual formatting. Paste the printed snippet in by hand. |

---

## How it works

```
/find-github-tool "free invoice app"
        │
        ▼
 Skill (playbook) ── interview ──► search spec
        │
        ▼
 MCP server (dist/find-github-tool.mjs)
   search_tools ──► 16 sources in parallel ──► merge duplicates ──► hard filters ──► pre-rank
   get_tool_details ──► GitHub · deps.dev · Scorecard · OSV · Repology · awesome lists
   read_tool_docs ──► README / homepage text (marked untrusted)
   get_community_voice ──► Hacker News · Stack Overflow · Lemmy
   verify_lead ──► confirms web-search leads against a real repo / package
   rank_tools ──► fit · health · ease · cost · reputation (weights follow the user's tech level)
   export_report ──► Markdown / HTML
        │
        ▼
 Plain-language cards (everyday users) or comparison table (developers)
```

- **The code collects facts; the AI makes the judgments.** Facts come from public APIs. The AI
  decides whether a tool meets each need, and must quote the docs as evidence.
- **Nothing made up:** the skill only allows recommending tools a tool returned or `verify_lead` confirmed.
- **Weak sources can only suggest:** Reddit, AlternativeTo, Product Hunt and blog posts (found by
  the assistant's own web search) are leads, never proof.
- **Safe by design:** page text is labelled untrusted; links to private or local network
  addresses are refused, with the IP checked again at connect time and through every redirect;
  pages are capped at 2 MB; private GitHub repos are never shown; report HTML is escaped; the
  HTTP server only answers localhost unless a bearer token is set; and nothing is installed on
  your machine unless you ask.
- **Polite to APIs:** results are cached (1 hour for searches, 1 day for details, 1 week for
  catalogs), requests are spaced where APIs ask for it, and a failing source becomes a warning
  instead of breaking the search.

See [PLAN.md](PLAN.md) for the full design, source list and roadmap.

## Commands

| Command | What it does |
|---|---|
| `find-github-tool serve` | MCP server over stdio (what AI apps start) |
| `find-github-tool serve --http [--port 3333] [--host 127.0.0.1]` | Streamable HTTP server at `/mcp` |
| `find-github-tool install --app <id\|all> [--dry-run] [--save-token]` | Add to AI apps |
| `find-github-tool uninstall --app <id\|all>` | Remove again |
| `find-github-tool doctor` | Check setup, GitHub quota and that sources are reachable |
| `find-github-tool search "<need>" [--mode app] [--level beginner]` | Quick terminal search (testing) |

Environment variables: `GITHUB_TOKEN` (or `GH_TOKEN`), `STACKEXCHANGE_KEY`, `FGT_CACHE_DIR`,
`FGT_DISABLE_SOURCES` (comma-separated source ids), `FGT_TIMEOUT_MS`, `FGT_CONTACT`
(added to the User-Agent so API operators can reach you), `FGT_HTTP_TOKEN` (bearer token for
the HTTP server; required when it listens beyond localhost).

Use a GitHub token with **no** extra permissions. The server drops private repositories even if
a token can see them, but a read-only public token keeps it simple.

## Development

```bash
npm install
```

```bash
npm run check
```

`check` runs the typecheck, the unit tests (no network) and the build. `npm run smoke` runs a
live end-to-end search through the bundled stdio server against the real APIs.

The bundle in `dist/` is committed on purpose: Claude Code installs plugins by copying files, with
no `npm install` step, so the plugin needs a ready-to-run file. Rebuild it (`npm run build`)
after changing `src/`.

| Folder | Contents |
|---|---|
| `skills/find-github-tool/` | The playbook (SKILL.md) and references; single source of truth, also served as the MCP prompt |
| `src/core/` | Pure logic: spec, queries, merge, filters, setup, health, license, scoring, reports |
| `src/sources/` | One connector per API, plus the shared HTTP client, cache and registry |
| `src/engine/` | Search, details, docs reading, lead verification, URL safety |
| `src/server/` | MCP tools, prompt, stdio and HTTP transports |
| `src/installer/` | Config writers for other AI apps |
| `adapters/` | Per-app setup notes, snippets, Claude Desktop manifest, lite skill |
| `tests/` | Unit tests with recorded API shapes |

## License

MIT
