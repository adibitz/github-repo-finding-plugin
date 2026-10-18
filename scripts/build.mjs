// Bundles the CLI + MCP server and all dependencies into one file, so the Claude Code plugin
// (which is installed by copying files, without `npm install`) can run it with plain `node`.
import { build } from "esbuild";
import { chmod } from "node:fs/promises";

const outfile = "dist/find-github-tool.mjs";

await build({
  entryPoints: ["src/cli.ts"],
  outfile,
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node20",
  minify: false,
  legalComments: "eof",
  banner: {
    // Some bundled CommonJS dependencies call require(); give them one in the ESM bundle.
    js: "#!/usr/bin/env node\nimport { createRequire as __fgtCreateRequire } from 'node:module';\nconst require = __fgtCreateRequire(import.meta.url);",
  },
  logLevel: "info",
});

await chmod(outfile, 0o755).catch(() => {});
