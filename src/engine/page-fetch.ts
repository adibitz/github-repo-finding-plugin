import { lookup as dnsLookup, type LookupAddress } from "node:dns";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import type { LookupFunction } from "node:net";
import { isPrivateAddress, UnsafeUrlError } from "./safe-url.js";

export interface PageResponse {
  status: number;
  location?: string;
  body: string;
  truncated: boolean;
}

/** Fetches one URL without following redirects. Injected so tests don't touch the network. */
export type PageFetcher = (url: URL) => Promise<PageResponse>;

export const MAX_PAGE_BYTES = 2_000_000;

/**
 * DNS lookup that refuses private addresses. Because the HTTP client connects to exactly the
 * address this returns, a domain can't pass an earlier check and then re-resolve to an
 * internal address (DNS rebinding).
 */
export const publicOnlyLookup: LookupFunction = (hostname, options, callback) => {
  dnsLookup(hostname, { ...options, all: true }, (err, addresses) => {
    if (err) return callback(err, "", 4);
    const list = addresses as unknown as LookupAddress[];
    if (list.length === 0 || list.some((a) => isPrivateAddress(a.address))) {
      return callback(new UnsafeUrlError("Local network addresses are not allowed"), "", 4);
    }
    if (options.all) return (callback as unknown as (e: null, a: LookupAddress[]) => void)(null, list);
    const first = list[0]!;
    callback(null, first.address, first.family);
  });
};

/** Real page fetcher: pinned public DNS, no redirects followed, body capped at MAX_PAGE_BYTES. */
export function createPageFetcher(userAgent: string, timeoutMs: number): PageFetcher {
  return (url) =>
    new Promise((resolve, reject) => {
      const request = url.protocol === "https:" ? httpsRequest : httpRequest;
      const req = request(
        url,
        {
          method: "GET",
          lookup: publicOnlyLookup,
          timeout: timeoutMs,
          headers: { "User-Agent": userAgent, Accept: "text/html,text/plain;q=0.9,*/*;q=0.5" },
        },
        (res) => {
          const status = res.statusCode ?? 0;
          if (status >= 300 && status < 400) {
            res.resume();
            resolve({ status, location: res.headers.location, body: "", truncated: false });
            return;
          }
          const chunks: Buffer[] = [];
          let size = 0;
          let done = false;
          const finish = (truncated: boolean) => {
            if (done) return;
            done = true;
            resolve({ status, body: Buffer.concat(chunks).toString("utf8"), truncated });
          };
          res.on("data", (chunk: Buffer) => {
            if (done) return;
            const room = MAX_PAGE_BYTES - size;
            if (chunk.length >= room) {
              chunks.push(chunk.subarray(0, room));
              size = MAX_PAGE_BYTES;
              finish(true);
              res.destroy();
              return;
            }
            chunks.push(chunk);
            size += chunk.length;
          });
          res.on("end", () => finish(false));
          res.on("error", (err) => (done ? undefined : reject(err)));
        },
      );
      req.on("timeout", () => req.destroy(new Error(`Request to ${url.hostname} timed out`)));
      req.on("error", reject);
      req.end();
    });
}
