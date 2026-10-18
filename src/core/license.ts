export type LicenseCategory =
  | "permissive"
  | "weak-copyleft"
  | "copyleft"
  | "foss-unspecified"
  | "source-available"
  | "proprietary"
  | "none"
  | "unknown";
export type BusinessUse = "yes" | "yes-with-conditions" | "check-terms" | "no" | "unclear";

export interface LicenseInfo {
  spdx?: string;
  category: LicenseCategory;
  isOpenSource: boolean | undefined;
  businessUse: BusinessUse;
  /** One plain-language sentence for everyday users. */
  plain: string;
}

/** Marker for catalogs that only list open-source software without naming the license (e.g. F-Droid). */
export const FOSS_UNSPECIFIED = "LicenseRef-FOSS";

const PERMISSIVE = ["MIT", "MIT-0", "APACHE-2.0", "BSD-2-CLAUSE", "BSD-3-CLAUSE", "0BSD", "ISC", "ZLIB", "UNLICENSE", "CC0-1.0", "BSL-1.0", "PSF-2.0", "PYTHON-2.0", "WTFPL", "UPL-1.0", "ARTISTIC-2.0", "POSTGRESQL", "NCSA", "X11"];
const WEAK_COPYLEFT = ["LGPL-2.1", "LGPL-3.0", "MPL-2.0", "EPL-1.0", "EPL-2.0", "CDDL-1.0", "EUPL-1.2", "OSL-3.0", "LGPL-2.1-ONLY", "LGPL-2.1-OR-LATER", "LGPL-3.0-ONLY", "LGPL-3.0-OR-LATER"];
const COPYLEFT = ["GPL-2.0", "GPL-3.0", "AGPL-3.0", "GPL-2.0-ONLY", "GPL-2.0-OR-LATER", "GPL-3.0-ONLY", "GPL-3.0-OR-LATER", "AGPL-3.0-ONLY", "AGPL-3.0-OR-LATER"];
// Licenses that look open but restrict commercial or hosted use.
const SOURCE_AVAILABLE = ["ELV2", "ELASTIC-2.0", "SSPL-1.0", "BUSL-1.1", "BSL-1.1", "COMMONS-CLAUSE", "FSL-1.1-MIT", "FSL-1.1-APACHE-2.0", "POLYFORM-NONCOMMERCIAL-1.0.0", "CC-BY-NC-4.0", "CC-BY-NC-SA-4.0", "SUSTAINABLE-USE-1.0", "NON-STANDARD"];
const UNKNOWN_MARKERS = ["NOASSERTION", "OTHER", "UNKNOWN"];

/** Order from least to most restrictive; used to combine parts of an SPDX expression. */
const RESTRICTIVENESS: LicenseCategory[] = ["permissive", "weak-copyleft", "foss-unspecified", "copyleft", "unknown", "source-available", "proprietary"];

const ALIASES: Record<string, string> = {
  "APACHE 2.0": "APACHE-2.0",
  "APACHE 2": "APACHE-2.0",
  "APACHE LICENSE 2.0": "APACHE-2.0",
  "APACHE-2": "APACHE-2.0",
  GPLV3: "GPL-3.0",
  GPLV2: "GPL-2.0",
  AGPLV3: "AGPL-3.0",
  LGPLV3: "LGPL-3.0",
  BSD: "BSD-3-CLAUSE",
  "BSD-3": "BSD-3-CLAUSE",
  "BSD-2": "BSD-2-CLAUSE",
  "MPL 2.0": "MPL-2.0",
  "ELASTIC LICENSE 2.0": "ELASTIC-2.0",
};

/** Accept strings and the old npm `{ type: "MIT" }` shape; anything else counts as missing. */
function licenseText(raw: unknown): string | undefined {
  if (typeof raw === "string") return raw;
  if (raw && typeof raw === "object" && typeof (raw as { type?: unknown }).type === "string") return (raw as { type: string }).type;
  return undefined;
}

function normalizeSingle(input: string): string | undefined {
  let s = input.replace(/[()]/g, "").trim();
  if (s === "") return undefined;
  s = s.replace(/\s+LICENSE$/, "").replace(/^THE\s+/, "");
  return ALIASES[s] ?? s.replace(/\s+/g, "-");
}

/** Normalise free-form license strings ("MIT License", "apache 2.0", "GPLv3") to an SPDX-like upper-case id. */
export function normalizeLicense(raw: unknown): string | undefined {
  const text = licenseText(raw)?.trim().toUpperCase();
  if (!text) return undefined;
  // Keep SPDX expressions ("MIT OR Apache-2.0") as expressions; normalise each part.
  const parts = text.split(/\s+(OR|AND)\s+/);
  if (parts.length === 1) return normalizeSingle(text);
  return parts.map((p, i) => (i % 2 === 1 ? p : (normalizeSingle(p) ?? p))).join(" ");
}

function categoryOf(id: string): LicenseCategory {
  if (PERMISSIVE.includes(id)) return "permissive";
  if (WEAK_COPYLEFT.includes(id)) return "weak-copyleft";
  if (COPYLEFT.includes(id)) return "copyleft";
  if (SOURCE_AVAILABLE.includes(id)) return "source-available";
  if (id === FOSS_UNSPECIFIED.toUpperCase()) return "foss-unspecified";
  if (id === "PROPRIETARY" || id === "COMMERCIAL" || id.startsWith("LICENSEREF-PROPRIETARY")) return "proprietary";
  return "unknown";
}

/**
 * Category of a whole SPDX expression. "A OR B" lets you pick, so the least restrictive part
 * counts; "A AND B" binds you to both, so the most restrictive part counts. AND binds tighter
 * than OR, as in SPDX.
 */
function expressionCategory(spdx: string): LicenseCategory {
  const rank = (c: LicenseCategory) => RESTRICTIVENESS.indexOf(c);
  const alternatives = spdx.split(/\s+OR\s+/).map((alt) =>
    alt
      .split(/\s+AND\s+|\//)
      .map((p) => categoryOf(p.replace(/[()]/g, "").trim()))
      .reduce((worst, c) => (rank(c) > rank(worst) ? c : worst)),
  );
  return alternatives.reduce((best, c) => (rank(c) < rank(best) ? c : best));
}

const PLAIN: Record<Exclude<LicenseCategory, "none" | "unknown">, Omit<LicenseInfo, "spdx" | "category">> = {
  permissive: { isOpenSource: true, businessUse: "yes", plain: "Free to use, including for business." },
  "weak-copyleft": { isOpenSource: true, businessUse: "yes", plain: "Free to use, including for business. If you change its own code, share those changes." },
  copyleft: { isOpenSource: true, businessUse: "yes-with-conditions", plain: "Free to use, including for business. If you modify and distribute it, you must share your changes." },
  "foss-unspecified": { isOpenSource: true, businessUse: "yes", plain: "Free and open source (the store doesn't show which license; check it before modifying or reselling)." },
  "source-available": { isOpenSource: false, businessUse: "check-terms", plain: "The code is public but the license limits some uses (often selling it as a service). Check the terms for business use." },
  proprietary: { isOpenSource: false, businessUse: "check-terms", plain: "Closed-source (proprietary) software. Check its terms and pricing." },
};

export function classifyLicense(raw: unknown): LicenseInfo {
  const spdx = normalizeLicense(raw);
  if (spdx === undefined) {
    return { spdx, category: "none", isOpenSource: undefined, businessUse: "unclear", plain: "No license found, so legally you may not be allowed to use it. Ask the authors first." };
  }
  if (UNKNOWN_MARKERS.includes(spdx)) {
    return { spdx, category: "unknown", isOpenSource: undefined, businessUse: "unclear", plain: "Uses a custom license. Read its terms before using it for business." };
  }
  const category = expressionCategory(spdx);
  if (category === "unknown" || category === "none") {
    return { spdx, category: "unknown", isOpenSource: undefined, businessUse: "unclear", plain: `Uses the ${spdx} license. Check its terms before using it for business.` };
  }
  const info = PLAIN[category];
  if (category === "copyleft" && spdx.includes("AGPL") && !/\b(MIT|APACHE|BSD)/.test(spdx)) {
    return { spdx, category, ...info, plain: "Free to use, including for business. If you modify it and offer it to others over the internet, you must share your changes." };
  }
  return { spdx, category, ...info };
}

/**
 * True when the license satisfies the allow-list: some OR-alternative must consist only of
 * allowed licenses ("MIT AND SSPL-1.0" fails an MIT-only list; "MIT OR SSPL-1.0" passes).
 */
export function licenseAllowed(raw: unknown, allowed: string[]): boolean {
  if (allowed.length === 0) return true;
  const spdx = normalizeLicense(raw);
  if (spdx === undefined) return false;
  const wanted = new Set(allowed.map((a) => normalizeLicense(a)));
  return spdx.split(/\s+OR\s+/).some((alt) =>
    alt
      .split(/\s+AND\s+|\//)
      .map((p) => p.replace(/[()]/g, "").trim())
      .every((p) => wanted.has(p)),
  );
}
