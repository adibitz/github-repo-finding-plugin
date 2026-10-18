const STOP_WORDS = new Set([
  "a", "an", "and", "app", "application", "for", "free", "i", "in", "is", "it", "me", "my", "need", "of", "on",
  "open", "or", "source", "the", "to", "tool", "want", "with", "software", "that", "like", "best", "good",
]);

/** Lower-case word tokens with stop words removed. */
export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^\p{L}\p{N}+#.]+/u)
    .map((t) => t.replace(/^\.+|\.+$/g, ""))
    .filter((t) => t.length > 1 && !STOP_WORDS.has(t));
}

const SUFFIXES = ["ations", "ation", "ings", "ing", "ions", "ion", "ers", "ors", "es", "er", "or", "ed", "s"];

/** Light stemming so "invoice", "invoices" and "invoicing" (or "extraction" and "extractor") compare equal. */
export function stem(word: string): string {
  let w = word.toLowerCase();
  if (w.endsWith("ies") && w.length > 4) return `${w.slice(0, -3)}y`;
  for (const suffix of SUFFIXES) {
    if (suffix === "s" && w.endsWith("ss")) break;
    if (w.endsWith(suffix) && w.length - suffix.length >= 3) {
      w = w.slice(0, -suffix.length);
      break;
    }
  }
  return w.length > 3 && w.endsWith("e") ? w.slice(0, -1) : w;
}

function stems(text: string): Set<string> {
  return new Set(tokenize(text).map(stem));
}

/** True when two texts share at least one meaningful word (stemmed, 4+ letters). */
export function sharesTerms(a: string, b: string): boolean {
  const left = [...stems(a)].filter((s) => s.length >= 4);
  const right = stems(b);
  return left.some((s) => right.has(s));
}

/** Exact stem match, or one stem is a prefix of the other ("invoic" ⊂ "invoiceplan"). */
function hit(set: Set<string>, term: string): boolean {
  if (set.has(term)) return true;
  if (term.length < 4) return false;
  for (const s of set) if (s.length >= 4 && (s.startsWith(term) || term.startsWith(s))) return true;
  return false;
}

/**
 * How well a candidate matches the request (0..1). Each phrase is scored on its own because
 * search phrases are alternatives ("invoicing" OR "billing"), and the best phrase wins, with a
 * small bonus when several phrases match. Name and topic hits count double a description hit.
 */
export function relevanceScore(phrases: string[], name: string, description: string, topics: string[] = []): number {
  const strong = new Set([...stems(name.replace(/[-_]/g, " ").replace(/([a-z])([A-Z])/g, "$1 $2")), ...stems(name), ...topics.flatMap((t) => [...stems(t.replace(/-/g, " "))])]);
  const weak = stems(description);
  // Short words hidden inside a name ("pdf" in "pypdf", "crm" in "suitecrm") still count, a bit less.
  const compactName = name.toLowerCase().replace(/[^a-z0-9]+/g, "");
  const inName = (t: string) => t.length >= 3 && compactName.includes(t);
  const scores: number[] = [];
  for (const phrase of phrases) {
    const terms = [...stems(phrase)];
    if (terms.length === 0) continue;
    const total = terms.reduce((sum, t) => sum + (hit(strong, t) ? 1 : inName(t) ? 0.75 : hit(weak, t) ? 0.5 : 0), 0);
    scores.push(total / terms.length);
  }
  if (scores.length === 0) return 0;
  const best = Math.max(...scores);
  const bonus = Math.min(0.15, 0.05 * Math.max(0, scores.filter((s) => s >= 0.5).length - 1));
  return Math.min(1, best + bonus);
}

/** Collapse whitespace, strip HTML tags and entities, and cut to `max` characters. */
export function cleanText(input: string | undefined | null, max = 300): string {
  if (!input) return "";
  const text = input
    .replace(/<[^>]*>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&[a-z]+;|&#\d+;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}

/** Months between an ISO date and `now`. Returns undefined for missing or invalid dates. */
export function monthsSince(iso: string | undefined, now: Date): number | undefined {
  if (!iso) return undefined;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return undefined;
  return (now.getTime() - t) / (1000 * 60 * 60 * 24 * 30.44);
}

/** "3 days ago", "5 months ago", "2 years ago". */
export function humanAgo(iso: string | undefined, now: Date): string | undefined {
  const months = monthsSince(iso, now);
  if (months === undefined) return undefined;
  const days = Math.max(0, Math.round(months * 30.44));
  if (days < 1) return "today";
  if (days < 45) return `${days} day${days === 1 ? "" : "s"} ago`;
  if (months < 18) return `${Math.round(months)} months ago`;
  return `${Math.round(months / 12)} years ago`;
}

/** ISO date (YYYY-MM-DD) `months` before `now`. */
export function isoMonthsAgo(months: number, now: Date): string {
  const d = new Date(now.getTime());
  d.setUTCMonth(d.getUTCMonth() - months);
  return d.toISOString().slice(0, 10);
}
