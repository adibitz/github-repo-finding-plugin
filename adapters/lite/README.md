# Lite skill (no server)

A web-search-only version of the playbook for AI apps where you can add a skill but can't run
the find-github-tool server (for example claude.ai with skills enabled). Results are less
thorough: there's no health score, security score or app-store check.

- **claude.ai / Claude Desktop:** zip the `find-github-tool-lite` folder and upload it in
  Customize → Skills.
- **Any app with skill folders:** copy `find-github-tool-lite/` into its skills folder
  (e.g. `~/.agents/skills/`).
- **Apps without skills:** paste the contents of `SKILL.md` into the chat or the app's custom
  instructions.
