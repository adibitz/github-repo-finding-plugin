import type { Config } from "../config.js";
import type { Spec } from "../core/spec.js";
import type { Candidate, Mode } from "../core/types.js";
import type { PageFetcher } from "../engine/page-fetch.js";
import type { HttpClient } from "./http.js";

export interface SourceContext {
  http: HttpClient;
  config: Config;
  now: Date;
  /** Fetcher for arbitrary web pages (docs, lead verification). Defaults to the SSRF-safe one. */
  fetchPage?: PageFetcher;
}

export interface SourceInfo {
  id: string;
  name: string;
  /** 1 = core, 2 = chosen by need, 3 = community reputation. (Tier 4 is the AI's own web search.) */
  tier: 1 | 2 | 3;
  modes: readonly Mode[];
  description: string;
  homepage: string;
  /** Plain note about keys or limits, shown by list_sources. */
  access: string;
}

export interface SearchSource extends SourceInfo {
  /** Whether this source is worth asking for this request. */
  appliesTo(spec: Spec, config: Config): boolean;
  search(spec: Spec, ctx: SourceContext): Promise<Candidate[]>;
}

/** True when the spec's mode is one of `modes`, or the spec accepts any mode. */
export function modeMatches(spec: Spec, modes: readonly Mode[]): boolean {
  return spec.mode === "any" || modes.includes(spec.mode);
}
