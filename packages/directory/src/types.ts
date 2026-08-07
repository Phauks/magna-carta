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
// directory_name_phonetic_code.scheme CHECK is open (length > 0), not a closed enum, so a
// new scheme (e.g. Beider-Morse) can be added later as additive rows without a migration.
// This array is the application-level catalog of known schemes; only the two double_metaphone
// schemes are emitted today (soundex/metaphone are reserved for future encoders). Double
// Metaphone produces two codes per input (primary and secondary); they are stored as separate
// rows so the blocking/search layer treats all schemes uniformly.
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
export const EDGE_TYPES = [
  "affiliation",
  "relationship",
  "corporate_parent",
  "corporate_subsidiary",
  "corporate_successor",
  "representation",
  "role_assignment",
] as const;
export type EdgeType = (typeof EDGE_TYPES)[number];

// ── IdentifierType ────────────────────────────────────────────────────────────
// The kind of a directory_identifier row. The schema allows any non-empty string
// (directory_identifier.identifier_type CHECK is length > 0 only); this union is the
// application-level catalog of well-known values used in the protected-field declarations
// and blind-index policy.
export const IDENTIFIER_TYPES = [
  "ssn",
  "ein",
  "dob",
  "account",
  "drivers_license",
  "ssn_last_four",
  "bar_number",
] as const;
export type IdentifierType = (typeof IDENTIFIER_TYPES)[number];
