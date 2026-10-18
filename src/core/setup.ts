import type { CandidateKind, InstallHint, SetupLevel, TechLevel } from "./types.js";

/** Facts gathered about a tool that tell us how hard it is to start using. */
export interface SetupSignals {
  kind: CandidateKind;
  readme?: string;
  homepage?: string;
  /** File names of release downloads, e.g. "app-1.2.0-setup.exe". */
  releaseAssets?: string[];
  /** Repology repository ids where the tool is packaged, e.g. "homebrew", "winget", "flathub". */
  packagedIn?: string[];
  hasDockerCompose?: boolean;
  installHints?: InstallHint[];
}

export interface SetupAssessment {
  level: SetupLevel;
  /** Plain-language label, e.g. "Easy: click to install". */
  label: string;
  reasons: string[];
  hints: InstallHint[];
}

const LEVEL_ORDER: SetupLevel[] = ["easy-hosted", "easy-install", "medium", "hard", "unknown"];

export const SETUP_LABELS: Record<SetupLevel, string> = {
  "easy-hosted": "Easy: use it in your browser, nothing to install",
  "easy-install": "Easy: download and install like any app",
  medium: "Medium: follow step-by-step instructions (some technical comfort helps)",
  hard: "Hard: needs a developer to set up",
  unknown: "Unknown: check the project's instructions",
};

const ASSET_RULES: { pattern: RegExp; method: string; label: string }[] = [
  { pattern: /\.(exe|msi|msix|appx)$/i, method: "windows-installer", label: "Download the Windows installer" },
  { pattern: /\.(dmg|pkg)$/i, method: "mac-installer", label: "Download the Mac installer" },
  { pattern: /\.(appimage|deb|rpm|flatpak|snap)$/i, method: "linux-package", label: "Download the Linux package" },
  { pattern: /\.apk$/i, method: "android-apk", label: "Download the Android app (APK)" },
];

/** Repology repo prefixes mapped to friendly install methods. */
const PACKAGE_REPOS: { prefix: string; method: string; label: string; level: SetupLevel }[] = [
  { prefix: "winget", method: "winget", label: "Install on Windows with winget", level: "easy-install" },
  { prefix: "chocolatey", method: "chocolatey", label: "Install on Windows with Chocolatey", level: "easy-install" },
  { prefix: "scoop", method: "scoop", label: "Install on Windows with Scoop", level: "easy-install" },
  { prefix: "homebrew_casks", method: "homebrew-cask", label: "Install on Mac with Homebrew", level: "easy-install" },
  { prefix: "homebrew", method: "homebrew", label: "Install with Homebrew (Mac/Linux, command line)", level: "medium" },
  { prefix: "flathub", method: "flathub", label: "Install on Linux from Flathub", level: "easy-install" },
  { prefix: "snap", method: "snap", label: "Install on Linux from the Snap Store", level: "easy-install" },
  { prefix: "fdroid", method: "fdroid", label: "Install on Android from F-Droid", level: "easy-install" },
  { prefix: "yunohost", method: "yunohost", label: "One-click install on a YunoHost server", level: "medium" },
  { prefix: "debian", method: "debian", label: "Available in Debian/Ubuntu packages", level: "medium" },
  { prefix: "ubuntu", method: "ubuntu", label: "Available in Ubuntu packages", level: "medium" },
  { prefix: "fedora", method: "fedora", label: "Available in Fedora packages", level: "medium" },
  { prefix: "arch", method: "arch", label: "Available in Arch Linux packages", level: "medium" },
  { prefix: "aur", method: "aur", label: "Available in the Arch User Repository", level: "medium" },
  { prefix: "nix", method: "nix", label: "Available in Nix packages", level: "medium" },
];

const DEPLOY_BUTTONS: { pattern: RegExp; method: string; label: string }[] = [
  { pattern: /railway\.(app|com)\/(new\/)?template/i, method: "railway", label: "One-click deploy on Railway" },
  { pattern: /render\.com\/deploy/i, method: "render", label: "One-click deploy on Render" },
  { pattern: /heroku\.com\/deploy/i, method: "heroku", label: "One-click deploy on Heroku" },
  { pattern: /vercel\.com\/new\/clone/i, method: "vercel", label: "One-click deploy on Vercel" },
  { pattern: /app\.netlify\.com\/start\/deploy/i, method: "netlify", label: "One-click deploy on Netlify" },
  { pattern: /deploy\.cloud\.run/i, method: "cloud-run", label: "One-click deploy on Google Cloud Run" },
  { pattern: /cloud\.digitalocean\.com\/apps\/new|marketplace\.digitalocean\.com/i, method: "digitalocean", label: "One-click deploy on DigitalOcean" },
  { pattern: /pikapods\.com/i, method: "pikapods", label: "Managed hosting on PikaPods" },
  { pattern: /elest\.io/i, method: "elestio", label: "Managed hosting on Elestio" },
];

// Phrases that suggest an official hosted version exists. Kept specific to avoid false positives;
// a "demo" is not a hosted service, so it doesn't count.
const HOSTED_PATTERNS = [
  /\b(cloud|hosted|saas) (version|edition|plan|offering|service)\b/i,
  /\bsign up (for free|now|at)\b/i,
  /\btry (it )?for free\b/i,
  /\bfree (cloud )?(tier|plan|account)\b/i,
  /\bmanaged (hosting|service|cloud)\b/i,
  /\bget started (for free|at)\b/i,
];

function easier(a: SetupLevel, b: SetupLevel): SetupLevel {
  return LEVEL_ORDER.indexOf(a) <= LEVEL_ORDER.indexOf(b) ? a : b;
}

/** Decide how hard a tool is to start using, with the evidence behind the decision. */
export function assessSetup(s: SetupSignals): SetupAssessment {
  const hints: InstallHint[] = [...(s.installHints ?? [])];
  const reasons: string[] = [];
  const readme = s.readme ?? "";

  if (s.kind === "extension") {
    hints.push({ method: "marketplace", label: "Install from the add-on marketplace", level: "easy-install" });
    reasons.push("Installs from an add-on marketplace");
  }
  if (s.kind === "space") {
    hints.push({ method: "hf-space", label: "Use it in your browser on Hugging Face", level: "easy-hosted" });
    reasons.push("Runs in the browser on Hugging Face Spaces");
  }

  if (HOSTED_PATTERNS.some((p) => p.test(readme))) {
    hints.push({ method: "hosted", label: "Use the official hosted version", level: "easy-hosted", url: s.homepage });
    reasons.push("README mentions an official hosted/cloud version");
  }

  for (const asset of s.releaseAssets ?? []) {
    const rule = ASSET_RULES.find((r) => r.pattern.test(asset));
    if (rule && !hints.some((h) => h.method === rule.method)) {
      hints.push({ method: rule.method, label: rule.label, level: "easy-install" });
      reasons.push(`Has a ready-made download (${asset})`);
    }
  }

  for (const repo of s.packagedIn ?? []) {
    const rule = PACKAGE_REPOS.find((r) => repo.toLowerCase().startsWith(r.prefix));
    if (rule && !hints.some((h) => h.method === rule.method)) {
      hints.push({ method: rule.method, label: rule.label, level: rule.level });
      reasons.push(`Packaged in ${repo}`);
    }
  }

  for (const button of DEPLOY_BUTTONS) {
    if (button.pattern.test(readme) && !hints.some((h) => h.method === button.method)) {
      hints.push({ method: button.method, label: button.label, level: "medium" });
      reasons.push(`Has a ${button.label.toLowerCase()} button`);
    }
  }

  const mentionsCompose = /docker[- ]compose|compose\.ya?ml/i.test(readme);
  if (s.hasDockerCompose || mentionsCompose) {
    hints.push({ method: "docker-compose", label: "Run with Docker Compose (step-by-step)", level: "medium" });
    reasons.push("Ships a Docker Compose setup");
  } else if (/\bdocker run\b/i.test(readme)) {
    hints.push({ method: "docker", label: "Run with Docker (step-by-step)", level: "medium" });
    reasons.push("Can run with a single Docker command");
  }

  if (s.kind === "package") {
    hints.push({ method: "package-manager", label: "Add it to a software project (for developers)", level: "hard" });
    reasons.push("It's a code library, used inside other software");
  }
  if (s.kind === "model") {
    hints.push({ method: "model", label: "Use it from code or an AI app (for developers)", level: "hard" });
  }

  if (hints.length === 0 && /\b(git clone|make install|cargo build|go build|npm run build|pip install -e)\b/i.test(readme)) {
    hints.push({ method: "build-from-source", label: "Build it from source code", level: "hard" });
    reasons.push("Only build-from-source instructions found");
  }

  const level = hints.reduce<SetupLevel>((best, h) => easier(best, h.level), "unknown");
  hints.sort((a, b) => LEVEL_ORDER.indexOf(a.level) - LEVEL_ORDER.indexOf(b.level));
  return { level, label: SETUP_LABELS[level], reasons, hints };
}

/** 0..1: how well a setup level suits someone with this tech comfort. */
export function easeScore(level: SetupLevel, techLevel: TechLevel): number {
  const table: Record<TechLevel, Record<SetupLevel, number>> = {
    beginner: { "easy-hosted": 1, "easy-install": 0.95, medium: 0.4, hard: 0.05, unknown: 0.3 },
    intermediate: { "easy-hosted": 1, "easy-install": 1, medium: 0.8, hard: 0.3, unknown: 0.5 },
    developer: { "easy-hosted": 0.9, "easy-install": 1, medium: 1, hard: 0.85, unknown: 0.7 },
  };
  return table[techLevel][level];
}
