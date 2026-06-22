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

function classifyIpv4(parts: readonly number[]): TargetClass {
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

function parseIpv4(host: string): readonly number[] | null {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (!m) return null;
  const parts = m.slice(1, 5).map((p) => Number(p));
  return parts.every((p) => p >= 0 && p <= 255) ? parts : null;
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
    if (lower.startsWith("::ffff:")) {
      const mapped = parseIpv4(lower.slice("::ffff:".length));
      if (mapped) return classifyIpv4(mapped); // IPv4-mapped IPv6
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
