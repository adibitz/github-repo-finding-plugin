export const MODES = ["app", "library", "extension", "ai", "code", "any"] as const;
export type Mode = (typeof MODES)[number];

export const PLATFORMS = ["web", "windows", "mac", "linux", "android", "ios", "self-host", "cli"] as const;
export type Platform = (typeof PLATFORMS)[number];

export const TECH_LEVELS = ["beginner", "intermediate", "developer"] as const;
export type TechLevel = (typeof TECH_LEVELS)[number];

export const BUDGETS = ["free", "low", "any"] as const;
export type Budget = (typeof BUDGETS)[number];

export const ECOSYSTEMS = ["npm", "pypi", "crates", "maven", "nuget", "packagist", "rubygems", "go"] as const;
export type Ecosystem = (typeof ECOSYSTEMS)[number];

export const EXTENSION_TARGETS = ["vscode", "wordpress", "obsidian"] as const;
export type ExtensionTarget = (typeof EXTENSION_TARGETS)[number];

export type CandidateKind = "repo" | "package" | "app-listing" | "extension" | "model" | "space" | "mcp-server";

/** How hard it is for a person to start using a tool, from easiest to hardest. */
export type SetupLevel = "easy-hosted" | "easy-install" | "medium" | "hard" | "unknown";

export interface InstallHint {
  /** Machine id, e.g. "flathub", "winget", "docker-compose", "hosted". */
  method: string;
  /** Plain-language label shown to users, e.g. "Install from Flathub". */
  label: string;
  level: SetupLevel;
  url?: string;
  command?: string;
}

/** One tool found by one or more sources. Only facts; no judgments. */
export interface Candidate {
  /** Canonical key, e.g. "github.com/owner/repo", "npm:express", "flathub:org.app.Id". */
  id: string;
  name: string;
  description: string;
  /** Best page to open: the repo if known, else the listing. */
  url: string;
  kind: CandidateKind;
  sources: string[];
  repoUrl?: string;
  homepage?: string;
  stars?: number;
  forks?: number;
  downloads?: number;
  downloadsPeriod?: "week" | "month" | "total";
  license?: string;
  language?: string;
  topics?: string[];
  /** ISO date of the last known activity (push, release or update). */
  lastActivity?: string;
  archived?: boolean;
  fork?: boolean;
  platforms?: Platform[];
  installHints?: InstallHint[];
  /** 0..1 keyword match between the request and this candidate. Set by the pipeline. */
  relevance?: number;
  /** 0..1 position in the source's own ranking (1 = its top result). Best across sources. Set by the pipeline. */
  sourceRank?: number;
  /** 0..1 ranking before the AI reads docs. Set by the pipeline. */
  prelimScore?: number;
}

export interface SourceWarning {
  source: string;
  message: string;
}

export interface PlainSignal {
  /** "good" | "ok" | "warn" | "bad" drives the colour dot shown to users. */
  tone: "good" | "ok" | "warn" | "bad";
  text: string;
}
