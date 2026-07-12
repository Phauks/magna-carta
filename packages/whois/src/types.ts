import type { HttpClient } from "@magna-carta/integrations/http";

// A WHOIS/RDAP lookup is meant to become a printable exhibit, so the result models three things a
// bare "value or nothing" shape cannot: which kind of object answered (a domain registration, an IP
// network allocation, or verbatim legacy registry text), why a field is silent (never provided,
// withheld by the registry, or not applicable to this object kind), and the provenance a document
// offered as evidence needs (what was asked, when in UTC, and which server answered).

// --- Absence is evidence: a field's silence is typed, never a blank ---
//
// A report must not render an empty cell that a reader could mistake for the wrong fact. Every field
// whose silence is ambiguous carries one of these states instead of being merely absent:
//   - present:       the registry returned a value.
//   - notProvided:   the field is simply absent from the response.
//   - redacted:      the registry withheld it and said so; `notice` quotes the registry's own words
//                    (from remarks[]), because quoting the registry is stronger than inferring.
//   - notApplicable: the field cannot apply to this object kind (a registrar or nameservers on an IP
//                    allocation), so its emptiness is a category fact, not missing data.
export type FieldState<T> =
  | { readonly state: "present"; readonly value: T }
  | { readonly state: "notProvided" }
  | { readonly state: "redacted"; readonly notice: string }
  | { readonly state: "notApplicable" };

export const present = <T>(value: T): FieldState<T> => ({ state: "present", value });
export const notProvided: FieldState<never> = { state: "notProvided" };
export const notApplicable: FieldState<never> = { state: "notApplicable" };
export const redacted = (notice: string): FieldState<never> => ({ state: "redacted", notice });

// --- Provenance: the report is an exhibit ---
export interface LookupProvenance {
  // The exact target queried, after SSRF normalization (the host that was actually looked up).
  readonly target: string;
  // The instant of the lookup, ISO 8601 in UTC (a trailing "Z"). Never a local-zone time — a reader
  // in another timezone must see the same instant. The page formats it; this layer never does.
  readonly retrievedAt: string;
  // Which server answered: the bootstrap-resolved RDAP base URL, or the port-43 host for legacy text.
  readonly respondingServer: string;
}

// --- RDAP sub-structures (RFC 9083) ---

// A contact drawn from an entity's jCard/vCard (RFC 7095). Most registries redact these; some ccTLDs
// publish a full postal address, which is personal data — hence the audited read on the route.
export interface RdapContact {
  readonly name?: string; // vCard "fn"
  readonly organization?: string; // vCard "org"
  readonly email?: string;
  readonly phone?: string; // vCard "tel"
  readonly address?: readonly string[]; // vCard "adr", non-empty components in order
}

// The abuse contact (an entity with role "abuse", usually nested inside the registrar entity). ICANN
// requires it and it survives privacy redaction, so a report can always name where to complain.
export interface AbuseContact {
  readonly email?: string;
  readonly phone?: string;
}

export interface Nameserver {
  readonly ldhName: string;
  readonly ipv4?: readonly string[]; // glue records
  readonly ipv6?: readonly string[];
}

export interface DsData {
  readonly keyTag?: number;
  readonly algorithm?: number;
  readonly digestType?: number;
  readonly digest?: string;
}

export interface SecureDns {
  readonly delegationSigned: boolean;
  readonly dsData?: readonly DsData[];
}

export interface RdapEvent {
  readonly action: string; // eventAction, e.g. "registration", "transfer"
  readonly date: string; // eventDate, as the registry published it (RDAP is RFC 3339)
}

export interface Registrar {
  readonly name?: string; // vCard "fn"
  readonly ianaId?: string; // publicIds type "IANA Registrar ID" — a name is not unique, this is
}

// A remark or notice: where a registry states "REDACTED FOR PRIVACY" and where legal/status notes ride.
export interface RdapRemark {
  readonly title?: string;
  readonly type?: string;
  readonly description: readonly string[];
}

// --- Domain registration (an RDAP domain object) ---
export interface DomainRegistration {
  readonly kind: "domain";
  readonly source: "rdap";
  readonly provenance: LookupProvenance;

  readonly handle?: string; // registry Domain ID (ROID)
  readonly ldhName?: string; // the ASCII (Letters/Digits/Hyphens) name
  readonly unicodeName?: string; // the IDN form; xn-- names are unreadable without it

  readonly registrar: FieldState<Registrar>;
  readonly abuse: FieldState<AbuseContact>;
  readonly registrant: FieldState<RdapContact>;
  readonly administrative: FieldState<RdapContact>;
  readonly technical: FieldState<RdapContact>;

  readonly nameservers: FieldState<readonly Nameserver[]>;
  readonly secureDns?: SecureDns;

  readonly statuses?: readonly string[];
  readonly events?: readonly RdapEvent[];
  readonly port43?: string; // the registry's legacy WHOIS host (provenance)
  readonly remarks?: readonly RdapRemark[];
  readonly notices?: readonly RdapRemark[];
  readonly rdapConformance?: readonly string[]; // which RDAP profile answered

  readonly rawRdap: unknown; // the complete, unmodified response body
}

// --- IP network allocation (an RDAP network object) ---
//
// A network object has no registrar role and no nameservers array, so those are typed notApplicable
// rather than left blank — a sparse IP result must never read as "no registration found".
export interface IpNetworkRegistration {
  readonly kind: "ip";
  readonly source: "rdap";
  readonly provenance: LookupProvenance;

  readonly handle?: string;
  readonly startAddress?: string;
  readonly endAddress?: string;
  readonly ipVersion?: string; // "v4" | "v6" per RDAP
  readonly name?: string; // the network's name
  readonly type?: string; // allocation type, e.g. "ALLOCATED PA"
  readonly country?: string;
  readonly parentHandle?: string;
  readonly cidr?: readonly string[]; // cidr0_cidrs rendered "prefix/length"

  readonly abuse: FieldState<AbuseContact>;
  // Neither applies to an IP allocation — typed so the page renders "not applicable", never a blank.
  readonly registrar: FieldState<Registrar>;
  readonly nameservers: FieldState<readonly Nameserver[]>;

  readonly statuses?: readonly string[];
  readonly events?: readonly RdapEvent[];
  readonly remarks?: readonly RdapRemark[];

  readonly rawRdap: unknown;
}

// --- Legacy port-43 registry text ---
//
// The four registries that still answer only on port 43 publish incompatible formats whose dates
// carry no timezone, so their text is never parsed into the shared fields (see legacy.ts). The
// verbatim text is the record, marked as timezone-unspecified so the page never converts it to UTC.
export interface LegacyWhoisRecord {
  readonly kind: "legacy";
  readonly source: "whois-43";
  readonly provenance: LookupProvenance;
  readonly raw: string; // verbatim registry text
  readonly timezoneUnspecified: true;
}

export type RegistrationResult = DomainRegistration | IpNetworkRegistration | LegacyWhoisRecord;

// Opens a port-43 WHOIS connection. Worker backs it with cloudflare:sockets; tests pass a fake.
export interface WhoisSocket {
  query(host: string, request: string): Promise<string>;
}

export interface WhoisDeps {
  readonly http: HttpClient;
  readonly socket: WhoisSocket;
  readonly resolve?: (host: string) => Promise<readonly string[]>;
  // The lookup clock, injectable so tests pin the provenance timestamp. Must return ISO 8601 UTC.
  readonly now?: () => string;
}
