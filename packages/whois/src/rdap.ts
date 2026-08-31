// RDAP (Registration Data Access Protocol) bootstrap resolution, query, and result parsing.
// RDAP is the successor to port-43 WHOIS; it returns structured JSON responses and is
// standardised by IANA. The IANA bootstrap registry maps TLDs and IP blocks to authoritative
// RDAP base URLs so clients discover the right server without hard-coding it.
//
// All outbound HTTP effects go through the injected HttpClient — this module never calls
// global fetch. See the SSRF invariant note in CLAUDE.md: the caller (lookup.ts) is
// responsible for validating targets with assertPublicTarget before reaching here.

import type { HttpClient } from "@magna-carta/integrations/http";
import type { RegistrationResult } from "./types.ts";

// IANA bootstrap document URLs for different address families.
const IANA_BOOTSTRAP_DOMAIN_URL = "https://data.iana.org/rdap/dns.json";
const IANA_BOOTSTRAP_IPV4_URL = "https://data.iana.org/rdap/ipv4.json";
const IANA_BOOTSTRAP_IPV6_URL = "https://data.iana.org/rdap/ipv6.json";

// Bootstrap document shape: an array of [matchKeys[], baseUrls[]] tuples.
// matchKeys are TLD labels (for DNS) or CIDR prefixes (for IP).
// We take the first base URL from the matching service entry.
type BootstrapService = [matchKeys: string[], baseUrls: string[]];
type BootstrapDocument = { services?: BootstrapService[] };

// Standard RDAP event action strings (from the RDAP JSON responses protocol spec).
const RDAP_EVENT_REGISTRATION = "registration";
const RDAP_EVENT_EXPIRATION = "expiration";
const RDAP_EVENT_LAST_CHANGED = "last changed";

/**
 * The RDAP server answered with something other than a record or a not-found. Carries only the
 * upstream HTTP status — never the target or the URL, which are user-supplied and must not leak
 * into an error message or a log (docs/conventions/error-logging.md).
 */
export class RdapUpstreamFailure extends Error {
  constructor(readonly status: number) {
    super(`The RDAP server answered ${status}.`);
    this.name = "RdapUpstreamFailure";
  }
}

/**
 * Resolve the authoritative RDAP base URL for a given domain or IP target by consulting
 * the IANA bootstrap registry. Returns `null` when the TLD or IP block has no registered
 * RDAP server (the registry omits entries for those, so absence is a valid signal).
 */
export async function resolveRdapBase(target: string, http: HttpClient): Promise<string | null> {
  // An IP target is one that actually parses as an address literal — not one that merely looks
  // numeric. The older digits-and-punctuation heuristic mis-classified both directions: it sent
  // hex-bearing IPv6 literals ("2001:db8::1") down the domain path, and sent dotted fragments that
  // are not addresses ("1.2.3") down the IP path.
  const address = parseIpAddress(target);

  const bootstrapUrl =
    address === null
      ? IANA_BOOTSTRAP_DOMAIN_URL
      : address.width === 32
        ? IANA_BOOTSTRAP_IPV4_URL
        : IANA_BOOTSTRAP_IPV6_URL;

  const response = await http.request({
    method: "GET",
    url: bootstrapUrl,
    headers: { accept: "application/json" },
  });

  // A bootstrap document that cannot be fetched is a fault, not an absent registry entry — a null
  // here routes the lookup down the legacy path (or to "cannot be looked up"), which turns a
  // transient IANA hiccup into a wrong answer about the registry.
  if (response.status !== 200) throw new RdapUpstreamFailure(response.status);

  const document = (await response.json()) as BootstrapDocument;
  const services = document.services ?? [];

  if (address !== null) {
    return resolveIpBase(address, services);
  }

  // For a domain, match by the registrable TLD — the last label of the domain name.
  // "example.com" → "com"; "www.example.co.uk" → "uk" (IANA bootstrap uses single-label TLD keys).
  const tld = extractTld(target);
  if (tld === null) return null;

  for (const [matchKeys, baseUrls] of services) {
    if (matchKeys.includes(tld) && baseUrls.length > 0) {
      return baseUrls[0] ?? null;
    }
  }

  return null;
}

/**
 * Query the RDAP server at `base` for `target` (a domain or IP), then map the JSON response
 * into a `RegistrationResult`. Every field is treated as optional — a missing or malformed
 * field is silently omitted rather than causing a throw, because RDAP responses vary widely
 * across registries.
 */
export async function queryRdap(
  target: string,
  base: string,
  http: HttpClient,
): Promise<RegistrationResult> {
  const pathSegment = parseIpAddress(target) === null ? "domain" : "ip";

  // Normalise: ensure exactly one slash between the base and the path segment.
  const normalizedBase = base.endsWith("/") ? base : `${base}/`;
  const url = `${normalizedBase}${pathSegment}/${target}`;

  const response = await http.request({
    method: "GET",
    url,
    headers: { accept: "application/rdap+json" },
  });

  // RDAP distinguishes "this name or block is not registered" (a 404 — an answer) from every
  // other non-200 (a rate limit, an outage — a fault). Only the 404 may parse as absence: folding
  // faults into the empty result made a registry's transient 429 read as "no registration record
  // found" on the page, which the very next retry contradicted with the real record.
  if (response.status !== 200 && response.status !== 404) {
    throw new RdapUpstreamFailure(response.status);
  }

  const rawBody = response.status === 200 ? await response.json() : {};
  const body = (rawBody ?? {}) as Record<string, unknown>;

  return {
    source: "rdap",
    target,
    registeredAt: extractEventDate(body, RDAP_EVENT_REGISTRATION),
    expiresAt: extractEventDate(body, RDAP_EVENT_EXPIRATION),
    lastChangedAt: extractEventDate(body, RDAP_EVENT_LAST_CHANGED),
    nameservers: extractNameservers(body),
    statuses: extractStatuses(body),
    registrar: extractEntityName(body, "registrar"),
    registrant: extractEntityName(body, "registrant"),
  };
}

// --- Private helpers ---

/** Return the single-label TLD from a domain name, or null if the input has no labels. */
function extractTld(domain: string): string | null {
  const labels = domain.split(".");
  // At minimum "example.com" produces ["example", "com"]; bare hostnames are not domains.
  if (labels.length < 2) return null;
  // labels.length >= 2 guarantees labels[labels.length - 1] is defined.
  const lastLabel = labels[labels.length - 1] ?? null;
  return lastLabel === null ? null : lastLabel.toLowerCase();
}

/** A parsed IP address: its numeric value and the address family's bit width. */
interface IpAddress {
  readonly value: bigint;
  readonly width: 32 | 128;
}

/** A parsed CIDR block: the masked network address, its bit width, and the prefix length. */
interface CidrBlock {
  readonly network: bigint;
  readonly width: 32 | 128;
  readonly prefixLength: number;
}

/**
 * Parse an IPv4 or IPv6 literal into its numeric value, or return null when the text is not an
 * address. Surrounding brackets on an IPv6 literal (`[2001:db8::1]`) are stripped, and an IPv4
 * mapped tail (`::ffff:192.0.2.1`) is folded into the low 32 bits, so both spellings of the same
 * address compare equal.
 */
function parseIpAddress(text: string): IpAddress | null {
  const trimmed = text.trim();
  const unbracketed =
    trimmed.startsWith("[") && trimmed.endsWith("]") ? trimmed.slice(1, -1) : trimmed;
  if (unbracketed.includes(":")) {
    const value = parseIpv6(unbracketed);
    return value === null ? null : { value, width: 128 };
  }
  const value = parseIpv4(unbracketed);
  return value === null ? null : { value, width: 32 };
}

function parseIpv4(text: string): bigint | null {
  const octets = text.split(".");
  if (octets.length !== 4) return null;
  let value = 0n;
  for (const octet of octets) {
    // Reject "01", "+1", "0x0a" and empty labels: only a plain 0-255 decimal is an octet.
    if (!/^(0|[1-9]\d{0,2})$/.test(octet)) return null;
    const parsed = Number(octet);
    if (parsed > 255) return null;
    value = (value << 8n) | BigInt(parsed);
  }
  return value;
}

function parseIpv6(text: string): bigint | null {
  // Split on the one permitted "::" run, then expand it to the zero groups it stands for.
  const halves = text.split("::");
  if (halves.length > 2) return null;
  const headText = halves[0] ?? "";
  const tailText = halves.length === 2 ? (halves[1] ?? "") : "";

  const head = headText === "" ? [] : headText.split(":");
  const tail = tailText === "" ? [] : tailText.split(":");
  const groups: bigint[] = [];

  // A trailing dotted-quad occupies the final two groups (`::ffff:192.0.2.1`).
  const last = tail.length > 0 ? tail[tail.length - 1] : head[head.length - 1];
  let embeddedIpv4: bigint | null = null;
  if (last !== undefined && last.includes(".")) {
    embeddedIpv4 = parseIpv4(last);
    if (embeddedIpv4 === null) return null;
    if (tail.length > 0) tail.pop();
    else head.pop();
  }

  const embeddedGroups = embeddedIpv4 === null ? 0 : 2;
  const explicitGroups = head.length + tail.length + embeddedGroups;
  if (halves.length === 1 ? explicitGroups !== 8 : explicitGroups > 7) return null;

  for (const group of [...head, ...tail]) {
    if (!/^[0-9a-fA-F]{1,4}$/.test(group)) return null;
  }

  for (const group of head) groups.push(BigInt(Number.parseInt(group, 16)));
  const zeroGroups = 8 - explicitGroups;
  for (let index = 0; index < zeroGroups; index += 1) groups.push(0n);
  for (const group of tail) groups.push(BigInt(Number.parseInt(group, 16)));
  if (embeddedIpv4 !== null) {
    groups.push((embeddedIpv4 >> 16n) & 0xffffn, embeddedIpv4 & 0xffffn);
  }
  if (groups.length !== 8) return null;

  let value = 0n;
  for (const group of groups) value = (value << 16n) | group;
  return value;
}

/** Parse a bootstrap match key ("198.51.100.0/22", "2001:db8::/32") into a masked CIDR block. */
function parseCidrBlock(text: string): CidrBlock | null {
  const slash = text.lastIndexOf("/");
  // A bootstrap key may omit the prefix length; a bare address is its own host route.
  const addressText = slash === -1 ? text : text.slice(0, slash);
  const address = parseIpAddress(addressText);
  if (address === null) return null;
  let prefixLength: number = address.width;
  if (slash !== -1) {
    const lengthText = text.slice(slash + 1);
    if (!/^\d{1,3}$/.test(lengthText)) return null;
    prefixLength = Number(lengthText);
    if (prefixLength > address.width) return null;
  }
  return {
    network: address.value & maskFor(address.width, prefixLength),
    width: address.width,
    prefixLength,
  };
}

/** The contiguous high-bit mask for a prefix of `prefixLength` bits in a `width`-bit space. */
function maskFor(width: number, prefixLength: number): bigint {
  const hostBits = BigInt(width - prefixLength);
  const all = (1n << BigInt(width)) - 1n;
  return (all >> hostBits) << hostBits;
}

/** True when `address` falls inside `block` — masked-integer containment, not text comparison. */
function cidrContains(block: CidrBlock, address: IpAddress): boolean {
  if (block.width !== address.width) return false;
  return (address.value & maskFor(block.width, block.prefixLength)) === block.network;
}

/**
 * Match an IP address against the IP-bootstrap services by real CIDR containment, longest prefix
 * first. Text comparison cannot do this: a prefix that does not land on an octet boundary
 * ("198.51.100.0/22") covers addresses whose text shares no leading label with the network
 * address, and a shorter prefix that happens to share leading text is not a match at all.
 * Longest-prefix wins because IANA delegates sub-blocks out of larger ones, and the most specific
 * delegation is the authoritative one.
 */
function resolveIpBase(address: IpAddress, services: BootstrapService[]): string | null {
  let bestPrefixLength = -1;
  let bestBase: string | null = null;
  for (const [matchKeys, baseUrls] of services) {
    const base = baseUrls[0];
    if (base === undefined) continue;
    for (const key of matchKeys) {
      const block = parseCidrBlock(key);
      if (block === null) continue;
      if (block.prefixLength <= bestPrefixLength) continue;
      if (!cidrContains(block, address)) continue;
      bestPrefixLength = block.prefixLength;
      bestBase = base;
    }
  }
  return bestBase;
}

/** Extract the eventDate for a given eventAction from the RDAP events array. */
function extractEventDate(body: Record<string, unknown>, action: string): string | undefined {
  const events = body["events"];
  if (!Array.isArray(events)) return undefined;

  for (const event of events) {
    if (
      typeof event === "object" &&
      event !== null &&
      (event as Record<string, unknown>)["eventAction"] === action
    ) {
      const date = (event as Record<string, unknown>)["eventDate"];
      return typeof date === "string" ? date : undefined;
    }
  }

  return undefined;
}

/**
 * Extract the LDH (Letters, Digits, Hyphens) nameserver names from the RDAP nameservers
 * array. The `ldhName` field is the canonical ASCII hostname for a nameserver.
 */
function extractNameservers(body: Record<string, unknown>): readonly string[] | undefined {
  const nameservers = body["nameservers"];
  if (!Array.isArray(nameservers) || nameservers.length === 0) return undefined;

  const results: string[] = [];
  for (const nameserver of nameservers) {
    if (typeof nameserver === "object" && nameserver !== null) {
      const ldhName = (nameserver as Record<string, unknown>)["ldhName"];
      if (typeof ldhName === "string") results.push(ldhName);
    }
  }

  return results.length > 0 ? results : undefined;
}

/** Copy the top-level `status` array from the RDAP response into `statuses`. */
function extractStatuses(body: Record<string, unknown>): readonly string[] | undefined {
  const status = body["status"];
  if (!Array.isArray(status) || status.length === 0) return undefined;

  const results = status.filter((s): s is string => typeof s === "string");
  return results.length > 0 ? results : undefined;
}

/**
 * Find the entity holding `role` — `"registrar"` on a domain record, `"registrant"` on a domain
 * or an IP-network record (an address block's holder, e.g. the organization ARIN delegated it
 * to) — and extract its formatted name (`fn`) from its jCard / vCard representation.
 *
 * The vCard array format (RFC 7095 / jCard) is:
 *   ["vcard", [ [propertyName, params, type, value], ... ]]
 *
 * We look for the tuple whose first element is `"fn"` and return its fourth element.
 */
function extractEntityName(body: Record<string, unknown>, role: string): string | undefined {
  const entities = body["entities"];
  if (!Array.isArray(entities)) return undefined;

  for (const entity of entities) {
    if (typeof entity !== "object" || entity === null) continue;

    const entityRecord = entity as Record<string, unknown>;
    const roles = entityRecord["roles"];
    if (!Array.isArray(roles) || !roles.includes(role)) continue;

    // Found the entity holding the role — extract fn from its vCard.
    const vcardArray = entityRecord["vcardArray"];
    if (!Array.isArray(vcardArray) || vcardArray.length < 2) continue;

    // vcardArray[1] is the array of property tuples.
    const properties = vcardArray[1];
    if (!Array.isArray(properties)) continue;

    for (const property of properties) {
      if (!Array.isArray(property) || property.length < 4) continue;
      if (property[0] === "fn") {
        const value = property[3];
        return typeof value === "string" ? value : undefined;
      }
    }
  }

  return undefined;
}
