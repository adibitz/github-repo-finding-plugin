# ChatGPT

ChatGPT can only connect to **remote** MCP servers over a public **HTTPS** URL (Plugins →
"+" → Add custom MCP server; availability depends on your plan). It can't start a local
program.

1. Pick a long random secret and run the server in HTTP mode on a machine you control. Beyond
   localhost the server refuses to start without `FGT_HTTP_TOKEN`, and rejects requests that
   don't send it as `Authorization: Bearer <token>`:
   ```bash
   FGT_HTTP_TOKEN=<long-random-secret> node dist/find-github-tool.mjs serve --http --host 0.0.0.0 --port 3333
   ```
2. Put it behind HTTPS (a reverse proxy such as Caddy or nginx, or a tunnel).
3. In ChatGPT, add the custom MCP server with the URL `https://<your-domain>/mcp` and the bearer
   token as its authentication.
4. Ask ChatGPT to use the `find-github-tool` prompt, or paste the contents of
   `skills/find-github-tool/SKILL.md` into the conversation or a custom GPT's instructions.

A shared hosted server (paste one URL, no setup) is planned. See PLAN.md §7.
