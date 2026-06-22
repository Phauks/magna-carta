// Guards user-supplied targets before any outbound fetch originating inside Cloudflare. A request
// handler must never be tricked into reaching internal/cloud-metadata addresses, so we reject every
// non-public target. The resolved-IP check (optional resolver) closes the DNS-rebinding gap; the
// literal-IP and scheme checks are always applied. Kept dependency-free so it is trivially testable.

export type TargetClass =
  | "public"
  | "loopback"
  | "private"
  | "link-local"
  | "reserved"
  | "invalid-scheme"
  | "invalid-host";

export interface ParsedTarget {
  readonly url: URL;
  readonly host: string;
}

export class SsrfRejection extends Error {
  readonly targetClass: TargetClass;
  constructor(targetClass: TargetClass, message: string) {
    super(message);
    this.name = "SsrfRejection";
    this.targetClass = targetClass;
  }
}

function classifyIpv4(parts: readonly [number, number, number, number]): TargetClass {
  const [a, b] = parts;
  if (a === 127) return "loopback";
  if (a === 10) return "private";
  if (a === 172 && b >= 16 && b <= 31) return "private";
  if (a === 192 && b === 168) return "private";
  if (a === 169 && b === 254) return "link-local";
  if (a === 0 || a >= 224) return "reserved"; // 0.x, multicast, future-use
  if (a === 100 && b >= 64 && b <= 127) return "reserved"; // carrier-grade NAT
  return "public";
}

function parseIpv4(host: string): readonly [number, number, number, number] | null {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (!m) return null;
  const parts = m.slice(1, 5).map((p) => Number(p));
  if (!parts.every((p) => p >= 0 && p <= 255)) return null;
  // The regex guarantees exactly four capture groups, and the range check above ensures
  // all four are valid octets — the tuple assertion is sound.
  return parts as unknown as [number, number, number, number];
}

// Two IPv6 hextets (each a 1-4 char hex group) carry a 32-bit IPv4. Expand them to four octets.
function hextetPairToIpv4(
  hi: string,
  lo: string,
): readonly [number, number, number, number] | null {
  if (!/^[0-9a-f]{1,4}$/.test(hi) || !/^[0-9a-f]{1,4}$/.test(lo)) return null;
  const high = Number.parseInt(hi, 16);
  const low = Number.parseInt(lo, 16);
  return [(high >> 8) & 0xff, high & 0xff, (low >> 8) & 0xff, low & 0xff];
}

// Extracts the IPv4 embedded in the IPv6 forms that carry one — IPv4-mapped (`::ffff:`), 6to4
// (`2002:`), and NAT64 (`64:ff9b::`) — in either dotted (`::ffff:127.0.0.1`) or hex-hextet
// (`::ffff:7f00:1`) representation. The WHATWG URL parser emits the mapped form in hex hextets, so a
// dotted-only check is bypassable: classify by the embedded address instead. Returns null when the
// literal embeds no IPv4. `lower` is already lowercased and bracket-stripped.
function embeddedIpv4(lower: string): readonly [number, number, number, number] | null {
  // The embedded IPv4 is the final 32 bits for the mapped and NAT64 prefixes…
  const tailOf = (prefix: string): readonly [number, number, number, number] | null => {
    const tail = lower.slice(prefix.length);
    if (tail.includes(".")) return parseIpv4(tail);
    const groups = tail.split(":").filter((group) => group.length > 0);
    if (groups.length < 2) return null;
    return hextetPairToIpv4(
      groups[groups.length - 2] as string,
      groups[groups.length - 1] as string,
    );
  };
  if (lower.startsWith("::ffff:")) return tailOf("::ffff:");
  if (lower.startsWith("64:ff9b::")) return tailOf("64:ff9b::");
  // …and the two hextets immediately after the prefix for 6to4.
  if (lower.startsWith("2002:")) {
    const groups = lower
      .slice("2002:".length)
      .split(":")
      .filter((group) => group.length > 0);
    if (groups.length < 2) return null;
    return hextetPairToIpv4(groups[0] as string, groups[1] as string);
  }
  return null;
}

export function classifyHost(host: string): TargetClass {
  const lower = host.toLowerCase().replace(/^\[|\]$/g, ""); // strip IPv6 brackets
  if (lower === "localhost" || lower.endsWith(".localhost")) return "loopback";

  const v4 = parseIpv4(lower);
  if (v4) return classifyIpv4(v4);

  if (lower.includes(":")) {
    // IPv6 literal
    if (lower === "::1") return "loopback";
    if (lower === "::") return "reserved";
    if (lower.startsWith("fe80")) return "link-local";
    if (lower.startsWith("fc") || lower.startsWith("fd")) return "private"; // unique-local fc00::/7
    if (lower.startsWith("ff")) return "reserved"; // IPv6 multicast ff00::/8
    // Forms that embed an IPv4 (mapped/6to4/NAT64): classify by the embedded address so a non-public
    // IPv4 cannot tunnel through as "public". Covers both the dotted and hex-hextet representations.
    const embedded = embeddedIpv4(lower);
    if (embedded) {
      const embeddedClass = classifyIpv4(embedded);
      if (embeddedClass !== "public") return embeddedClass;
    }
    return "public";
  }

  // A DNS name: structurally public. The resolver pass (in assertPublicTarget) classifies its IPs.
  return /^[a-z0-9.-]+$/.test(lower) && lower.includes(".") ? "public" : "invalid-host";
}

export async function assertPublicTarget(
  input: string,
  resolve?: (host: string) => Promise<readonly string[]>,
): Promise<ParsedTarget> {
  const raw = /^[a-z][a-z0-9+.-]*:\/\//i.test(input) ? input : `https://${input}`;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new SsrfRejection("invalid-host", "target is not a valid URL");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new SsrfRejection("invalid-scheme", `scheme ${url.protocol} is not allowed`);
  }
  const host = url.hostname;
  const literal = classifyHost(host);
  if (literal !== "public") {
    throw new SsrfRejection(literal, `target host is ${literal}`);
  }
  if (resolve) {
    const ips = await resolve(host);
    if (ips.length === 0) throw new SsrfRejection("invalid-host", "host did not resolve");
    for (const ip of ips) {
      const c = classifyHost(ip);
      if (c !== "public") throw new SsrfRejection(c, `resolved IP ${ip} is ${c}`);
    }
  }
  return { url, host };
}
