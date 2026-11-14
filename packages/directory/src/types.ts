// Re-export the directory branded id types from @magna-carta/identifiers.
// The brands are defined once in the identifiers package and re-exported here so
// consumers import from a single domain entry point rather than reaching into identifiers directly.
export type {
  DirectoryPersonId,
  DirectoryOrganizationId,
  DirectoryNameId,
  DirectoryIdentifierId,
  DirectoryEdgeId,
  DirectoryCategoryId,
  DirectoryEmailId,
  DirectoryPhoneId,
  DirectoryAddressId,
  DirectoryPartyRoleId,
  MatterPartyId,
  EntityMergeId,
} from "@magna-carta/identifiers/types";

// ── EntityKind ──────────────────────────────────────────────────────────────
// The two node kinds in the directory graph. DB-enforced: directory_name.entity_kind CHECK
// constrains to exactly these two values.
export const ENTITY_KINDS = ["person", "organization"] as const;
export type EntityKind = (typeof ENTITY_KINDS)[number];

// ── NameRole ─────────────────────────────────────────────────────────────────
// The role a name record plays for an entity. The schema allows any non-empty string
// (directory_name.name_role CHECK is length > 0 only); this union is the application-level
// catalog of well-known values. Code that stores a name role should use one of these unless
// explicitly extending the catalog.
export const NAME_ROLES = ["current", "former", "alias", "aka", "maiden", "dba"] as const;
export type NameRole = (typeof NAME_ROLES)[number];

// ── PhoneticScheme ────────────────────────────────────────────────────────────
// The phonetic encoding scheme for a name's phonetic code row. The
// directory_name_phonetic_code.scheme CHECK is open (length > 0), not a closed enum.
// This array is the application-level catalog of known schemes; only the two double_metaphone
// schemes are emitted today (soundex/metaphone are reserved for future encoders). Double
// Metaphone produces two codes per input (primary and secondary); they are stored as separate
// rows so the blocking/search layer treats all schemes uniformly.
//
// THE OPEN CHECK IS NOT THE WHOLE SEAM, and a reader planning a new encoder needs the other half:
// directory_name_phonetic_code's PRIMARY KEY is (name_id, scheme), so the table physically holds at
// most ONE code per name per scheme. That fits any encoder returning a fixed, small number of codes
// — Soundex returns one, Double Metaphone two, and each takes a scheme of its own. It does not fit
// an encoder returning a VARIABLE SET per name — Beider-Morse returns tens of phonemes for one
// surname — which needs a table keyed by the CODE. Match the table to the encoder's shape rather
// than assuming the open CHECK is the whole seam.
export const PHONETIC_SCHEMES = [
  "soundex",
  "metaphone",
  "double_metaphone_primary",
  "double_metaphone_secondary",
] as const;
export type PhoneticScheme = (typeof PHONETIC_SCHEMES)[number];

// ── EdgeType ──────────────────────────────────────────────────────────────────
// The relationship type on a directory_edge row. The schema allows any non-empty string
// (directory_edge.edge_type CHECK is length > 0 only); this union is the application-level
// catalog of well-known values.
//
// The membership family below replaces the single `affiliation` for new writes. `affiliation` stays
// in the catalog and keeps its meaning for the rows already recorded — it is the legacy, unclassified
// membership — and the record screen stops offering it. Which of these can bind an organization is
// the distinction Rule 4.2 draws, and it is why they are separate types rather than a role string
// on one: the conflicts traversal classes an edge by its type, and prints it.
export const EDGE_TYPES = [
  "affiliation",
  "relationship",
  "corporate_parent",
  "corporate_subsidiary",
  "corporate_successor",
  "representation",
  "role_assignment",
  // Constituents who can bind or direct the organization.
  "officer_of",
  "director_of",
  "partner_of",
  "trustee_of",
  "personal_representative_of",
  "agent_of",
  // Constituents who cannot.
  "employment",
  "member_of",
  "shareholder_of",
  // A legal capacity or an interest over a person or an estate, not a control.
  "beneficiary_of",
  "guardian_of",
  // Who the firm talks to at an organization — frequently not an employee at all.
  "point_of_contact_for",
  // Named family ties between two people. `relationship` stays for the rows recorded before these
  // existed and for a personal tie that is not family; a tie the list does not name is
  // `family_member_of`. Each reads from its origin ("is the parent of"), so a Child and a Parent
  // edge are the same fact recorded from either end, and both are offered because the reader
  // records from the record they have open.
  "spouse_of",
  "parent_of",
  "child_of",
  "sibling_of",
  "grandparent_of",
  "grandchild_of",
  "family_member_of",
] as const;
export type EdgeType = (typeof EDGE_TYPES)[number];

// ── IdentifierType ────────────────────────────────────────────────────────────
// The kind of a directory_identifier row. The schema allows any non-empty string
// (directory_identifier.identifier_type CHECK is length > 0 only); this union is the
// application-level catalog of well-known values used in the protected-field declarations
// and blind-index policy. What each kind is made of, and whether a value fits it, is
// identifier-shape.ts. A date of birth is not a kind: it is a date on the person, in the clear,
// beside the date of death, because a birthday sealed as a secret can be neither shown on a
// record nor used to tell two people of one name apart.
export const IDENTIFIER_TYPES = [
  "ssn",
  "ein",
  "account",
  "drivers_license",
  "ssn_last_four",
  "bar_number",
] as const;
export type IdentifierType = (typeof IDENTIFIER_TYPES)[number];

// ── ContactSystem ─────────────────────────────────────────────────────────────
// What communications technology answers a telephone number. Orthogonal to the CONTEXT the number
// is used in (that is ContactUse below), and the two are separate columns because one flat axis
// cannot express them: "mobile fax" and "work mobile" are both real, and a single list containing
// both `fax` and `work` makes the pair uninterpretable.
//
// Fax is a technology and not a label. A delivery path asking "may this be faxed to opposing
// counsel" must not answer from a column where `fax`, `Fax`, `facsimile` and `office/fax` mean the
// same thing to a person and nothing to a program; service by facsimile is a distinct permitted
// method whose consent the firm records; and a voice line must never be fax-dialled.
//
// A number that answers BOTH voice and fax is two rows, not a combined value: they are separately
// verifiable facts carrying separate verification dates, and one row cannot hold two.
//
// The directory_phone.contact_system column carries no closed CHECK — a committed migration is
// immutable, so a closed IN (...) would make every catalog addition a migration against every firm.
// The route's enum is the gate; this array is the catalog it gates against.
export const CONTACT_SYSTEMS = ["voice", "fax", "sms", "pager"] as const;
export type ContactSystem = (typeof CONTACT_SYSTEMS)[number];

// ── ContactUse ────────────────────────────────────────────────────────────────
// The CONTEXT a telephone number or email address is used in, independent of the technology behind
// it. Shared by directory_phone and directory_email so a screen offers one vocabulary.
export const CONTACT_USES = ["work", "home", "mobile", "other", "former", "temporary"] as const;
export type ContactUse = (typeof CONTACT_USES)[number];

// ── AddressUse / AddressType ──────────────────────────────────────────────────
// A postal address's context, and whether the location physically exists. The two are separate
// because personal service turns on the second one: a post office box is `postal` and cannot be
// served, while a registered office is `physical` and can.
export const ADDRESS_USES = [
  "residential",
  "business",
  "postal",
  "registered",
  "service",
  "former",
  "temporary",
] as const;
export type AddressUse = (typeof ADDRESS_USES)[number];

export const ADDRESS_TYPES = ["physical", "postal", "both"] as const;
export type AddressType = (typeof ADDRESS_TYPES)[number];

// ── ContactVerificationStatus ─────────────────────────────────────────────────
// Whether the firm has confirmed that a contact point is still true, and the record of it having
// stopped being true. `failed` is the state that earns the column: returned mail, a bounced message,
// a disconnected line — the three facts a firm most needs recorded and had nowhere to record.
//
// A failure NEVER gates a send. It is surfaced to the member who is about to send, and the send
// proceeds: a bounce is frequently temporary, and a platform that refuses on a stale failure teaches
// its users that the warning is noise. Recording and surfacing are the whole of the behaviour.
export const CONTACT_VERIFICATION_STATUSES = ["unverified", "verified", "failed"] as const;
export type ContactVerificationStatus = (typeof CONTACT_VERIFICATION_STATUSES)[number];
