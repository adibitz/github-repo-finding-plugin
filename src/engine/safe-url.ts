import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

export class UnsafeUrlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnsafeUrlError";
  }
}

/** Eight 16-bit groups of an IPv6 address, or undefined if it can't be parsed. Handles "::" and embedded IPv4. */
function ipv6Groups(ip: string): number[] | undefined {
  let s = ip.toLowerCase().split("%")[0] ?? "";
  const v4 = /(\d+\.\d+\.\d+\.\d+)$/.exec(s);
  if (v4?.[1]) {
    const p = v4[1].split(".").map(Number);
    if (p.length !== 4 || p.some((n) => !(n >= 0 && n <= 255))) return undefined;
    s = s.slice(0, -v4[1].length) + `${((p[0]! << 8) | p[1]!).toString(16)}:${((p[2]! << 8) | p[3]!).toString(16)}`;
  }
  const [head, tail, extra] = s.split("::");
  if (extra !== undefined) return undefined;
  const h = head ? head.split(":") : [];
  const t = tail !== undefined && tail !== "" ? tail.split(":") : [];
  const fill = tail !== undefined ? 8 - h.length - t.length : 0;
  if (fill < 0 || (tail === undefined && h.length !== 8)) return undefined;
  const groups = [...h, ...Array<string>(fill).fill("0"), ...t].map((g) => Number.parseInt(g, 16));
  return groups.length === 8 && groups.every((g) => g >= 0 && g <= 0xffff) ? groups : undefined;
}

/**
 * True for anything that isn't a plain public address: loopback, private, link-local, CGNAT,
 * multicast, and for IPv6 everything outside global unicast (2000::/3) plus the transition
 * ranges that can tunnel to internal IPv4 (6to4, Teredo, NAT64) and documentation space.
 */
export function isPrivateAddress(ip: string): boolean {
  if (isIP(ip) === 6) {
    const g = ipv6Groups(ip);
    if (!g) return true;
    // IPv4-mapped (::ffff:a.b.c.d): judge the embedded IPv4 address.
    if (g.slice(0, 5).every((x) => x === 0) && g[5] === 0xffff) {
      return isPrivateAddress(`${g[6]! >> 8}.${g[6]! & 255}.${g[7]! >> 8}.${g[7]! & 255}`);
    }
    const first = g[0]!;
    if (first < 0x2000 || first > 0x3fff) return true;
    if (first === 0x2002) return true; // 6to4
    if (first === 0x2001 && (g[1] === 0x0000 || g[1] === 0x0db8)) return true; // Teredo, documentation
    return false;
  }
  const parts = ip.split(".").map(Number);
  if (parts.length !== 4 || parts.some((p) => !Number.isInteger(p) || p < 0 || p > 255)) return true;
  const [a, b] = parts as [number, number, number, number];
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) ||
    a >= 224
  );
}

export type Resolver = (host: string) => Promise<string[]>;

const defaultResolver: Resolver = async (host) => (await lookup(host, { all: true })).map((r) => r.address);

/**
 * Only public http(s) URLs may be fetched on a user's behalf. This blocks reading local files,
 * internal services or cloud metadata endpoints through a crafted link.
 */
export async function assertPublicUrl(raw: string, resolve: Resolver = defaultResolver): Promise<URL> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new UnsafeUrlError("Not a valid URL");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new UnsafeUrlError("Only http and https links can be read");
  if (url.username || url.password) throw new UnsafeUrlError("Links with embedded credentials are not allowed");
  const host = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal")) {
    throw new UnsafeUrlError("Local network addresses are not allowed");
  }
  const addresses = isIP(host) ? [host] : await resolve(host).catch(() => {
    throw new UnsafeUrlError(`Could not resolve ${host}`);
  });
  if (addresses.length === 0 || addresses.some(isPrivateAddress)) throw new UnsafeUrlError("Local network addresses are not allowed");
  return url;
}
