# Lite mode (no find-github-tool server)

Use this when the `search_tools` tool isn't available. Quality is lower, so tell the user once:
"I'm searching without the full tool-finder engine, so I'll double-check each result by hand."

1. **Interview** exactly as in Step 1 of the main skill.
2. **Search the web** (3–5 searches), for example:
   - `best open source <category> <year>` and `open source alternative to <product>`
   - `site:github.com <category> <key feature>` and `awesome <category> github`
   - `<category> site:awesome-selfhosted.net` for self-hosted apps
   - `<category> site:reddit.com` for real user opinions
3. **Verify each candidate** by opening its repository page (GitHub, GitLab or Codeberg) with
   your web fetch tool. Check that it exists, the last update date, the license, stars, whether it is
   archived, and whether the README mentions a hosted version, downloads or Docker.
4. **Drop** anything archived, not updated in over a year (unless the user accepts that), or
   without a license.
5. **Present** with the same cards or table as the main skill. Mark facts you couldn't check
   as "unknown", and add: "Checked by hand on <date>; install the find-github-tool server for
   deeper checks (health, security score, app-store availability)."
