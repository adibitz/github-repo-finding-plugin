// Assembles build/mcpb/ (manifest + bundle + skill files) for a Claude Desktop extension.
// Then pack it with: npx @anthropic-ai/mcpb pack build/mcpb find-github-tool.mcpb
import { cp, mkdir, rm } from "node:fs/promises";

const out = "build/mcpb";
await rm(out, { recursive: true, force: true });
await mkdir(out, { recursive: true });
await cp("adapters/claude-desktop/manifest.json", `${out}/manifest.json`);
await cp("dist", `${out}/dist`, { recursive: true });
// The server reads its playbook from skills/ next to dist/.
await cp("skills", `${out}/skills`, { recursive: true });
await cp("README.md", `${out}/README.md`);
console.log(`Assembled ${out}. Next: npx @anthropic-ai/mcpb pack ${out} find-github-tool.mcpb`);
