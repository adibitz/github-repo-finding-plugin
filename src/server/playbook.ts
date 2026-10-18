import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// The skill folder is the single source of truth for the playbook. It sits next to dist/ in the
// plugin and npm package, and two levels up from src/server/ during development and tests.
const SKILL_DIRS = ["../skills/find-github-tool/", "../../skills/find-github-tool/"];
const REFERENCES = ["interview.md", "output-formats.md", "glossary.md", "lite-mode.md"];

function readSkillFile(rel: string): string {
  for (const dir of SKILL_DIRS) {
    try {
      return readFileSync(fileURLToPath(new URL(dir + rel, import.meta.url)), "utf8");
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
    }
  }
  throw new Error(`Playbook file missing from the installation: skills/find-github-tool/${rel}`);
}

let cached: string | undefined;

/**
 * The skill's instructions plus its reference files, for hosts that only support MCP prompts
 * (they can't open the skill's linked files). Front matter is removed.
 */
export function loadPlaybook(): string {
  if (cached !== undefined) return cached;
  const body = readSkillFile("SKILL.md").replace(/^---[\s\S]*?\n---\s*\n/, "").trim();
  const refs = REFERENCES.map((name) => `\n\n---\n\n<!-- references/${name} -->\n${readSkillFile(`references/${name}`).trim()}`).join("");
  cached = body + refs;
  return cached;
}

/** The playbook with the user's request filled in where the skill expects $ARGUMENTS. */
export function playbookFor(request: string | undefined): string {
  const filled = request?.trim() || "(not given yet: start by asking what they need)";
  return loadPlaybook().replace(/\$ARGUMENTS/g, () => filled);
}
