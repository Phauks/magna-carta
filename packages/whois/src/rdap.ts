// RDAP (Registration Data Access Protocol) bootstrap resolution, query, and result parsing.
// RDAP is the successor to port-43 WHOIS; it returns structured JSON responses and is
// standardised by IANA. The IANA bootstrap registry maps TLDs and IP blocks to authoritative
// RDAP base URLs so clients discover the right server without hard-coding it.
//
// All outbound HTTP effects go through the injected HttpClient — this module never calls
// global fetch. See the SSRF invariant note in CLAUDE.md: the caller (lookup.ts) is
// responsible for validating targets with assertPublicTarget before reaching here.

import type { HttpClient } from "@magna-carta/integrations/http";
import { WhoisTransportError } from "./errors.ts";
import type {
  AbuseContact,
  DomainRegistration,
  DsData,
  FieldState,
  IpNetworkRegistration,
  LookupProvenance,
  Nameserver,
  RdapContact,
  RdapEvent,
  RdapRemark,
  Registrar,
  RegistrationResult,
  SecureDns,
} from "./types.ts";
import { notApplicable, notProvided, present, redacted } from "./types.ts";

// IANA bootstrap document URLs for different address families.
const IANA_BOOTSTRAP_DOMAIN_URL = "https://data.iana.org/rdap/dns.json";

// Bootstrap document shape: an array of [matchKeys[], baseUrls[]] tuples.
// matchKeys are TLD labels (for DNS) or CIDR prefixes (for IP).
// We take the first base URL from the matching service entry.
type BootstrapService = [matchKeys: string[], baseUrls: string[]];
type BootstrapDocument = { services?: BootstrapService[] };

// The outcome of consulting the IANA bootstrap registry. These three are deliberately distinct: a
// registry with no RDAP server is a fact about the TLD (fall through to port 43), whereas a non-200
// from the bootstrap fetch is a transport failure (surface it, never silently attempt port 43).
export type RdapBaseResolution =
  | { readonly outcome: "found"; readonly base: string }
  | { readonly outcome: "noRdapForTld" }
  | { readonly outcome: "transportFailure"; readonly url: string; readonly status: number };

/**
 * Resolve the authoritative RDAP base URL for a domain or IP target by consulting the IANA bootstrap
 * registry.
 *
 * Returns a discriminated outcome rather than `string | null` because "no RDAP entry for this TLD"
 * and "the bootstrap fetch failed" are different facts with opposite handling — the first legitimately
 * falls through to a port-43 lookup, the second must be reported as a transport failure. Collapsing
 * both to `null` turned an IANA outage into a bogus port-43 attempt for every RDAP TLD.
 */
export async function resolveRdapBase(
  target: string,
  http: HttpClient,
): Promise<RdapBaseResolution> {
  const isIpAddress = looksLikeIpAddress(target);
  const bootstrapUrl = isIpAddress ? resolveIpBootstrapUrl(target) : IANA_BOOTSTRAP_DOMAIN_URL;

  const response = await http.request({
    method: "GET",
    url: bootstrapUrl,
    headers: { accept: "application/json" },
  });

  if (response.status !== 200) {
    return { outcome: "transportFailure", url: bootstrapUrl, status: response.status };
  }

  const document = ((await safeJson(response)) ?? {}) as BootstrapDocument;
  const services = document.services ?? [];

  const base = isIpAddress
    ? resolveIpBase(target, services)
    : resolveDomainBase(target, services);

  return base === null ? { outcome: "noRdapForTld" } : { outcome: "found", base };
}

/**
 * Query the RDAP server at `base` for `target` (a domain or IP), then map the JSON response into a
 * `RegistrationResult`. Every RDAP field is treated as optional — registries vary widely — so a
 * missing or malformed field degrades to a typed absence rather than throwing. The complete,
 * unmodified response body is retained on the result (`rawRdap`) because the report is an exhibit.
 */
export async function queryRdap(
  target: string,
  base: string,
  http: HttpClient,
  retrievedAt: string,
): Promise<RegistrationResult> {
  const isIpAddress = looksLikeIpAddress(target);
  const pathSegment = isIpAddress ? "ip" : "domain";

  // Normalise: ensure exactly one slash between the base and the path segment.
  const normalizedBase = base.endsWith("/") ? base : `${base}/`;
  const url = `${normalizedBase}${pathSegment}/${target}`;

  const response = await http.request({
    method: "GET",
    url,
    headers: { accept: "application/rdap+json" },
  });

  // Read the body defensively regardless of status: an RDAP 404 still returns a JSON error object
  // (with notices explaining the absence) that belongs in the exhibit. A non-object body is retained
  // verbatim as rawRdap but treated as empty for field extraction.
  const rawRdap = await safeJson(response);
  const body = asObject(rawRdap);

  const provenance: LookupProvenance = { target, retrievedAt, respondingServer: base };

  return isIpAddress
    ? extractNetwork(body, rawRdap, provenance)
    : extractDomain(body, rawRdap, provenance);
}

// --- Object extractors ---

function extractDomain(
  body: Record<string, unknown>,
  rawRdap: unknown,
  provenance: LookupProvenance,
): DomainRegistration {
  const entities = asArray(body["entities"]);
  const notice = redactionNotice(body);

  const registrarEntity = findEntityByRole(entities, "registrar");
  const registrar: FieldState<Registrar> =
    registrarEntity === undefined ? notProvided : present(extractRegistrar(registrarEntity));

  return {
    kind: "domain",
    source: "rdap",
    provenance,
    handle: optionalString(body["handle"]),
    ldhName: optionalString(body["ldhName"]),
    unicodeName: optionalString(body["unicodeName"]),
    registrar,
    abuse: extractAbuse(entities),
    registrant: extractContactRole(entities, "registrant", notice),
    administrative: extractContactRole(entities, "administrative", notice),
    technical: extractContactRole(entities, "technical", notice),
    nameservers: extractNameservers(body),
    secureDns: extractSecureDns(body),
    statuses: extractStringArray(body["status"]),
    events: extractEvents(body),
    port43: optionalString(body["port43"]),
    remarks: extractRemarks(body["remarks"]),
    notices: extractRemarks(body["notices"]),
    rdapConformance: extractStringArray(body["rdapConformance"]),
    rawRdap,
  };
}

function extractNetwork(
  body: Record<string, unknown>,
  rawRdap: unknown,
  provenance: LookupProvenance,
): IpNetworkRegistration {
  const entities = asArray(body["entities"]);
  return {
    kind: "ip",
    source: "rdap",
    provenance,
    handle: optionalString(body["handle"]),
    startAddress: optionalString(body["startAddress"]),
    endAddress: optionalString(body["endAddress"]),
    ipVersion: optionalString(body["ipVersion"]),
    name: optionalString(body["name"]),
    type: optionalString(body["type"]),
    country: optionalString(body["country"]),
    parentHandle: optionalString(body["parentHandle"]),
    cidr: extractCidrs(body["cidr0_cidrs"]),
    abuse: extractAbuse(entities),
    // A registrar and nameservers cannot apply to an IP allocation — typed, never a blank cell.
    registrar: notApplicable,
    nameservers: notApplicable,
    statuses: extractStringArray(body["status"]),
    events: extractEvents(body),
    remarks: extractRemarks(body["remarks"]),
    rawRdap,
  };
}

// --- Entity / vCard helpers ---

/** Depth-first search for the first entity carrying `role` (abuse is nested inside registrar). */
function findEntityByRole(
  entities: readonly unknown[],
  role: string,
): Record<string, unknown> | undefined {
  for (const entity of entities) {
    const record = asObjectOrUndefined(entity);
    if (record === undefined) continue;
    const roles = asArray(record["roles"]);
    if (roles.includes(role)) return record;
    const nested = findEntityByRole(asArray(record["entities"]), role);
    if (nested !== undefined) return nested;
  }
  return undefined;
}

function extractRegistrar(entity: Record<string, unknown>): Registrar {
  const registrar: { name?: string; ianaId?: string } = {};
  const name = vcardValue(entity, "fn");
  if (name !== undefined) registrar.name = name;
  const ianaId = ianaRegistrarId(entity);
  if (ianaId !== undefined) registrar.ianaId = ianaId;
  return registrar;
}

/** The IANA Registrar ID from an entity's publicIds — a name is not unique, this identifier is. */
function ianaRegistrarId(entity: Record<string, unknown>): string | undefined {
  for (const publicId of asArray(entity["publicIds"])) {
    const record = asObjectOrUndefined(publicId);
    if (record === undefined) continue;
    const type = optionalString(record["type"]);
    if (type !== undefined && type.toLowerCase().includes("iana")) {
      const identifier = optionalString(record["identifier"]);
      if (identifier !== undefined) return identifier;
    }
  }
  return undefined;
}

function extractAbuse(entities: readonly unknown[]): FieldState<AbuseContact> {
  const entity = findEntityByRole(entities, "abuse");
  if (entity === undefined) return notProvided;
  const abuse: { email?: string; phone?: string } = {};
  const email = vcardValue(entity, "email");
  if (email !== undefined) abuse.email = email;
  const phone = vcardValue(entity, "tel");
  if (phone !== undefined) abuse.phone = phone;
  return present(abuse);
}

/**
 * Extract a contact role (registrant / administrative / technical), distinguishing the three
 * silences. If the registry withheld the contact and said so in remarks[], the field is `redacted`
 * quoting the registry's own words; if the entity is simply absent, it is `notProvided`.
 */
function extractContactRole(
  entities: readonly unknown[],
  role: string,
  notice: string | undefined,
): FieldState<RdapContact> {
  const entity = findEntityByRole(entities, role);
  if (entity === undefined) {
    return notice === undefined ? notProvided : redacted(notice);
  }
  const contact = extractContact(entity);
  if (isEmptyContact(contact)) {
    // The entity exists but carries no readable fields — a redaction remark, if present, explains it.
    return notice === undefined ? notProvided : redacted(notice);
  }
  return present(contact);
}

function extractContact(entity: Record<string, unknown>): RdapContact {
  const contact: {
    name?: string;
    organization?: string;
    email?: string;
    phone?: string;
    address?: readonly string[];
  } = {};
  const name = vcardValue(entity, "fn");
  if (name !== undefined) contact.name = name;
  const organization = vcardValue(entity, "org");
  if (organization !== undefined) contact.organization = organization;
  const email = vcardValue(entity, "email");
  if (email !== undefined) contact.email = email;
  const phone = vcardValue(entity, "tel");
  if (phone !== undefined) contact.phone = phone;
  const address = vcardAddress(entity);
  if (address !== undefined) contact.address = address;
  return contact;
}

function isEmptyContact(contact: RdapContact): boolean {
  return (
    contact.name === undefined &&
    contact.organization === undefined &&
    contact.email === undefined &&
    contact.phone === undefined &&
    contact.address === undefined
  );
}

/**
 * Read a scalar jCard/vCard property value. The jCard array form (RFC 7095) is:
 *   ["vcard", [ [propertyName, params, type, value], ... ]]
 * We return the fourth element of the first tuple whose name matches, when it is a string.
 */
function vcardValue(entity: Record<string, unknown>, propertyName: string): string | undefined {
  for (const property of vcardProperties(entity)) {
    if (property[0] === propertyName && typeof property[3] === "string" && property[3].length > 0) {
      return property[3];
    }
  }
  return undefined;
}

/** The "adr" property's value is an array of components; return the non-empty ones in order. */
function vcardAddress(entity: Record<string, unknown>): readonly string[] | undefined {
  for (const property of vcardProperties(entity)) {
    if (property[0] !== "adr") continue;
    const value = property[3];
    if (!Array.isArray(value)) continue;
    const parts = value.filter((part): part is string => typeof part === "string" && part.length > 0);
    if (parts.length > 0) return parts;
  }
  return undefined;
}

function vcardProperties(entity: Record<string, unknown>): readonly unknown[][] {
  const vcardArray = entity["vcardArray"];
  if (!Array.isArray(vcardArray) || vcardArray.length < 2) return [];
  const properties = vcardArray[1];
  if (!Array.isArray(properties)) return [];
  return properties.filter((p): p is unknown[] => Array.isArray(p) && p.length >= 4);
}

// --- Field extractors ---

function extractNameservers(body: Record<string, unknown>): FieldState<readonly Nameserver[]> {
  const nameservers = asArray(body["nameservers"]);
  const results: Nameserver[] = [];
  for (const nameserver of nameservers) {
    const record = asObjectOrUndefined(nameserver);
    if (record === undefined) continue;
    const ldhName = optionalString(record["ldhName"]);
    if (ldhName === undefined) continue;
    const ipAddresses = asObjectOrUndefined(record["ipAddresses"]);
    const entry: { ldhName: string; ipv4?: readonly string[]; ipv6?: readonly string[] } = {
      ldhName,
    };
    if (ipAddresses !== undefined) {
      const ipv4 = extractStringArray(ipAddresses["v4"]);
      if (ipv4 !== undefined) entry.ipv4 = ipv4;
      const ipv6 = extractStringArray(ipAddresses["v6"]);
      if (ipv6 !== undefined) entry.ipv6 = ipv6;
    }
    results.push(entry);
  }
  return results.length > 0 ? present(results) : notProvided;
}

function extractSecureDns(body: Record<string, unknown>): SecureDns | undefined {
  const secureDns = asObjectOrUndefined(body["secureDNS"]);
  if (secureDns === undefined) return undefined;
  const delegationSigned = secureDns["delegationSigned"];
  if (typeof delegationSigned !== "boolean") return undefined;
  const result: { delegationSigned: boolean; dsData?: readonly DsData[] } = { delegationSigned };
  const dsData: DsData[] = [];
  for (const entry of asArray(secureDns["dsData"])) {
    const record = asObjectOrUndefined(entry);
    if (record === undefined) continue;
    const ds: DsData = {
      keyTag: optionalNumber(record["keyTag"]),
      algorithm: optionalNumber(record["algorithm"]),
      digestType: optionalNumber(record["digestType"]),
      digest: optionalString(record["digest"]),
    };
    dsData.push(ds);
  }
  if (dsData.length > 0) result.dsData = dsData;
  return result;
}

/** Every event, not just registration/expiration/last-changed — transfer history matters in disputes. */
function extractEvents(body: Record<string, unknown>): readonly RdapEvent[] | undefined {
  const events: RdapEvent[] = [];
  for (const event of asArray(body["events"])) {
    const record = asObjectOrUndefined(event);
    if (record === undefined) continue;
    const action = optionalString(record["eventAction"]);
    const date = optionalString(record["eventDate"]);
    if (action !== undefined && date !== undefined) events.push({ action, date });
  }
  return events.length > 0 ? events : undefined;
}

function extractRemarks(value: unknown): readonly RdapRemark[] | undefined {
  const remarks: RdapRemark[] = [];
  for (const remark of asArray(value)) {
    const record = asObjectOrUndefined(remark);
    if (record === undefined) continue;
    const description = extractStringArray(record["description"]) ?? [];
    const entry: { title?: string; type?: string; description: readonly string[] } = { description };
    const title = optionalString(record["title"]);
    if (title !== undefined) entry.title = title;
    const type = optionalString(record["type"]);
    if (type !== undefined) entry.type = type;
    remarks.push(entry);
  }
  return remarks.length > 0 ? remarks : undefined;
}

/**
 * The registry's own redaction language, if the response carries a redaction remark. Under the ICANN
 * RDAP response profile a withheld object is announced in remarks[] with a redaction type (e.g.
 * "object redacted due to authorization") or a "REDACTED FOR PRIVACY" title. We quote it verbatim —
 * inferring redaction would put words in the registry's mouth.
 */
function redactionNotice(body: Record<string, unknown>): string | undefined {
  for (const remark of asArray(body["remarks"])) {
    const record = asObjectOrUndefined(remark);
    if (record === undefined) continue;
    const type = (optionalString(record["type"]) ?? "").toLowerCase();
    const title = (optionalString(record["title"]) ?? "").toLowerCase();
    const isRedaction =
      type.includes("redacted") ||
      type.includes("authorization") ||
      title.includes("redacted") ||
      title.includes("privacy");
    if (!isRedaction) continue;
    const description = extractStringArray(record["description"]);
    if (description !== undefined && description.length > 0) return description.join(" ");
    const originalTitle = optionalString(record["title"]);
    if (originalTitle !== undefined) return originalTitle;
  }
  return undefined;
}

/** Render cidr0_cidrs entries ({v4prefix|v6prefix, length}) as "prefix/length". */
function extractCidrs(value: unknown): readonly string[] | undefined {
  const cidrs: string[] = [];
  for (const entry of asArray(value)) {
    const record = asObjectOrUndefined(entry);
    if (record === undefined) continue;
    const prefix = optionalString(record["v4prefix"]) ?? optionalString(record["v6prefix"]);
    const length = optionalNumber(record["length"]);
    if (prefix !== undefined && length !== undefined) cidrs.push(`${prefix}/${length}`);
  }
  return cidrs.length > 0 ? cidrs : undefined;
}

// --- Bootstrap matching ---

function resolveDomainBase(target: string, services: BootstrapService[]): string | null {
  const tld = extractTld(target);
  if (tld === null) return null;
  for (const [matchKeys, baseUrls] of services) {
    if (matchKeys.includes(tld) && baseUrls.length > 0) return baseUrls[0] ?? null;
  }
  return null;
}

/** Return the single-label TLD from a domain name, or null if the input has no labels. */
function extractTld(domain: string): string | null {
  const labels = domain.split(".");
  if (labels.length < 2) return null;
  const lastLabel = labels[labels.length - 1] ?? null;
  return lastLabel === null ? null : lastLabel.toLowerCase();
}

function resolveIpBootstrapUrl(ipAddress: string): string {
  return ipAddress.includes(":")
    ? "https://data.iana.org/rdap/ipv6.json"
    : "https://data.iana.org/rdap/ipv4.json";
}

/**
 * Match an IP address against IP-bootstrap services. Best-effort: returns the first service whose
 * match keys include a prefix the address starts with (sufficient for the common delegations).
 */
function resolveIpBase(ipAddress: string, services: BootstrapService[]): string | null {
  for (const [matchKeys, baseUrls] of services) {
    for (const prefix of matchKeys) {
      const networkAddress = prefix.split("/")[0] ?? "";
      const parentNetwork =
        networkAddress
          .split(".")
          .slice(0, networkAddress.split(".").length - 1)
          .join(".") + ".";
      if (ipAddress.startsWith(parentNetwork) || ipAddress.startsWith(networkAddress)) {
        if (baseUrls.length > 0) return baseUrls[0] ?? null;
      }
    }
  }
  return null;
}

// --- Value coercion helpers ---

function looksLikeIpAddress(target: string): boolean {
  return /^[\d.:]+$/.test(target);
}

async function safeJson(response: { json(): Promise<unknown> }): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return undefined;
  }
}

function asObject(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function asObjectOrUndefined(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function asArray(value: unknown): readonly unknown[] {
  return Array.isArray(value) ? value : [];
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function optionalNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function extractStringArray(value: unknown): readonly string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const results = value.filter((s): s is string => typeof s === "string" && s.length > 0);
  return results.length > 0 ? results : undefined;
}
