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

// Bootstrap document shape: an array of [matchKeys[], baseUrls[]] tuples.
// matchKeys are TLD labels (for DNS) or CIDR prefixes (for IP).
// We take the first base URL from the matching service entry.
type BootstrapService = [matchKeys: string[], baseUrls: string[]];
type BootstrapDocument = { services?: BootstrapService[] };

// Event action strings defined in RFC 9083 §10.2.3.
const RDAP_EVENT_REGISTRATION = "registration";
const RDAP_EVENT_EXPIRATION = "expiration";
const RDAP_EVENT_LAST_CHANGED = "last changed";

/**
 * Resolve the authoritative RDAP base URL for a given domain or IP target by consulting
 * the IANA bootstrap registry. Returns `null` when the TLD or IP block has no registered
 * RDAP server (the registry omits entries for those, so absence is a valid signal).
 */
export async function resolveRdapBase(
  target: string,
  http: HttpClient,
): Promise<string | null> {
  // Determine whether the target looks like an IP address or a domain name.
  // A simple heuristic: if it contains only digits and dots/colons it is an IP.
  const isIpAddress = /^[\d.:]+$/.test(target);

  const bootstrapUrl = isIpAddress
    ? resolveIpBootstrapUrl(target)
    : IANA_BOOTSTRAP_DOMAIN_URL;

  const response = await http.request({
    method: "GET",
    url: bootstrapUrl,
    headers: { accept: "application/json" },
  });

  if (response.status !== 200) return null;

  const document = (await response.json()) as BootstrapDocument;
  const services = document.services ?? [];

  if (isIpAddress) {
    return resolveIpBase(target, services);
  }

  // For a domain, match by the registrable TLD — the last label of the domain name.
  // "example.com" → "com"; "www.example.co.uk" → "uk" (IANA bootstrap uses single-label TLD keys).
  const tld = extractTld(target);
  if (tld === null) return null;

  for (const [matchKeys, baseUrls] of services) {
    if (matchKeys.includes(tld) && baseUrls.length > 0) {
      return baseUrls[0];
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
  const isIpAddress = /^[\d.:]+$/.test(target);
  const pathSegment = isIpAddress ? "ip" : "domain";

  // Normalise: ensure exactly one slash between the base and the path segment.
  const normalizedBase = base.endsWith("/") ? base : `${base}/`;
  const url = `${normalizedBase}${pathSegment}/${target}`;

  const response = await http.request({
    method: "GET",
    url,
    headers: { accept: "application/rdap+json" },
  });

  // A non-200 response still returns a partial result with source set so callers can
  // distinguish "RDAP responded but the domain was not found" from "RDAP unavailable".
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
    registrar: extractRegistrar(body),
  };
}

// --- Private helpers ---

/** Return the single-label TLD from a domain name, or null if the input has no labels. */
function extractTld(domain: string): string | null {
  const labels = domain.split(".");
  // At minimum "example.com" produces ["example", "com"]; bare hostnames are not domains.
  if (labels.length < 2) return null;
  return labels[labels.length - 1].toLowerCase();
}

/**
 * Choose the IANA bootstrap URL for an IP address.
 * IPv6 addresses contain colons; everything else is treated as IPv4.
 */
function resolveIpBootstrapUrl(ipAddress: string): string {
  return ipAddress.includes(":")
    ? "https://data.iana.org/rdap/ipv6.json"
    : "https://data.iana.org/rdap/ipv4.json";
}

/**
 * Match an IP address against IP-bootstrap services.
 * This is a best-effort MVP that returns the first service whose match keys include a
 * prefix the address starts with (sufficient for the most common delegations).
 */
function resolveIpBase(
  ipAddress: string,
  services: BootstrapService[],
): string | null {
  for (const [matchKeys, baseUrls] of services) {
    for (const prefix of matchKeys) {
      if (ipAddress.startsWith(prefix.split("/")[0].split(".").slice(0, prefix.split("/")[0].split(".").length - 1).join(".") + ".") || ipAddress.startsWith(prefix.split("/")[0])) {
        if (baseUrls.length > 0) return baseUrls[0];
      }
    }
  }
  return null;
}

/** Extract the eventDate for a given eventAction from the RDAP events array. */
function extractEventDate(
  body: Record<string, unknown>,
  action: string,
): string | undefined {
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
function extractNameservers(
  body: Record<string, unknown>,
): readonly string[] | undefined {
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
function extractStatuses(
  body: Record<string, unknown>,
): readonly string[] | undefined {
  const status = body["status"];
  if (!Array.isArray(status) || status.length === 0) return undefined;

  const results = status.filter((s): s is string => typeof s === "string");
  return results.length > 0 ? results : undefined;
}

/**
 * Find the registrar entity — the entity whose `roles` array contains `"registrar"` —
 * and extract its formatted name (`fn`) from its jCard / vCard representation.
 *
 * The vCard array format (RFC 7095 / jCard) is:
 *   ["vcard", [ [propertyName, params, type, value], ... ]]
 *
 * We look for the tuple whose first element is `"fn"` and return its fourth element.
 */
function extractRegistrar(body: Record<string, unknown>): string | undefined {
  const entities = body["entities"];
  if (!Array.isArray(entities)) return undefined;

  for (const entity of entities) {
    if (typeof entity !== "object" || entity === null) continue;

    const entityRecord = entity as Record<string, unknown>;
    const roles = entityRecord["roles"];
    if (!Array.isArray(roles) || !roles.includes("registrar")) continue;

    // Found the registrar entity — extract fn from its vCard.
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
