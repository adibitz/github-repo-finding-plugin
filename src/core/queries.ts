import { effectiveMinStars, type Spec } from "./spec.js";
import { isoMonthsAgo, tokenize } from "./text.js";

/** Search phrases for sources that take plain text: keywords first, then "X alternative" phrases. */
export function textQueries(spec: Spec, max: number): string[] {
  const phrases = [...spec.keywords, ...spec.alternativeTo.map((a) => `${a} alternative`)];
  return [...new Set(phrases.map((p) => p.trim()).filter(Boolean))].slice(0, max);
}

/** GitHub search qualifiers shared by every query built from this spec. */
export function githubQualifiers(spec: Spec, now: Date, language?: string): string {
  const q: string[] = ["archived:false", "fork:false", `stars:>=${effectiveMinStars(spec)}`];
  q.push(`pushed:>=${isoMonthsAgo(spec.activeWithinMonths, now)}`);
  if (language) q.push(`language:"${language.replace(/"/g, "")}"`);
  // GitHub accepts one license qualifier per query; more than one is filtered after the search.
  if (spec.licenses.length === 1 && spec.licenses[0]) q.push(`license:${spec.licenses[0].toLowerCase()}`);
  return q.join(" ");
}

export interface GithubQuery {
  q: string;
  /** Undefined = GitHub's best match; "stars" surfaces the most adopted projects. */
  sort?: "stars";
}

/** GitHub topic slug for a phrase: "PDF parser" → "pdf-parser". */
export function topicSlug(phrase: string): string {
  return phrase.toLowerCase().trim().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "");
}

/**
 * GitHub repository-search queries, most useful first:
 * 1. the first phrase as words (all must appear in name, description or README), best match;
 * 2. a topic query sorted by stars, which surfaces the established projects in the category;
 * 3. the remaining phrases, best match.
 * Words are not quoted: exact-phrase search misses projects that say "extract text from PDFs".
 */
export function githubRepoQueries(spec: Spec, now: Date, max: number): GithubQuery[] {
  const phrases = textQueries(spec, max);
  const languages = spec.languages.length > 0 ? spec.languages : [undefined];
  const wordsQuery = (phrase: string, lang: string | undefined) => `${phrase.replace(/"/g, "")} in:name,description,readme ${githubQualifiers(spec, now, lang)}`;

  const queries: GithubQuery[] = [];
  const [first, ...rest] = phrases;
  if (first) {
    for (const lang of languages) queries.push({ q: wordsQuery(first, lang) });
    // Topic: the whole phrase as a slug if short, otherwise its first meaningful word.
    const words = tokenize(first);
    const topic = words.length <= 2 ? topicSlug(first) : topicSlug(words[0] ?? first);
    if (topic) queries.push({ q: `topic:${topic} ${githubQualifiers(spec, now, spec.languages[0])}`, sort: "stars" });
  }
  for (const phrase of rest) for (const lang of languages) queries.push({ q: wordsQuery(phrase, lang) });

  const seen = new Set<string>();
  return queries.filter((x) => !seen.has(x.q + x.sort) && seen.add(x.q + x.sort)).slice(0, max);
}
