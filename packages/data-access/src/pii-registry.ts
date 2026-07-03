import type { UserId } from "@magna-carta/identifiers";

// A GDPR data subject resolves to one of two existing anchors — a Directory entity
// (person/organization, the entity_id axis) or a firm member (the control-plane user_id axis).
// There is no dedicated data_subject table: the Directory IS the registry. This union is consumed
// by the deferred eraseDataSubject orchestrator; it is declared now so the attribution discipline
// exists before the personal-data schema hardens. Home of the reasoning: docs/conventions/compliance.md.
export type SubjectRef =
  | { readonly kind: "entity"; readonly entityId: string } // a directoryPerson_/directoryOrganization_ handle
  | { readonly kind: "user"; readonly userId: UserId };

// What the (deferred) erasure orchestrator does to a table's rows for one subject.
export type ErasureAction =
  | "hard-delete" // remove the subject's rows outright
  | "anonymize" // scrub the PII columns, keep the row (referential integrity / tombstone)
  | "retain-under-matter" // kept: data retained for legal obligations / claims (GDPR Art. 17(3))
  | "pseudonymize-keep" // append-only rows: replace the subject reference, never delete
  | "report-manual"; // free-text / document content — surfaced in the residue report, not auto-erased

// One entry per per-firm (or control-plane) table that holds personal data. `subjectKey` is the
// column that resolves a row to its data subject ("self" = the node's own id). A table may appear
// more than once when it references a subject through more than one column (e.g. an edge's two
// endpoints) — mirroring the directory merge repoint set.
export interface PiiTableEntry {
  readonly table: string;
  readonly subjectKey: string;
  readonly action: ErasureAction;
  readonly note?: string; // e.g. the retention basis for a retain-under-matter row
}

// The PII/erasure registry — sibling to @magna-carta/database's PROTECTED_COLUMNS. Every table with
// a personal-data column appears here; a coverage fitness test forces that completeness. The deferred
// eraseDataSubject orchestrator traverses this list; the entity-axis rows are the same inbound
// references the Directory merge repoints (a drift tripwire keeps them a superset).
export const PII_TABLES: readonly PiiTableEntry[] = [
  // Directory contact & identifier PII — hard-deletable at the entity.
  { table: "directory_identifier", subjectKey: "entity_id", action: "hard-delete" },
  { table: "directory_name", subjectKey: "entity_id", action: "hard-delete" },
  // Phonetic codes are derived from a name row, so they resolve to a subject via name_id →
  // directory_name.entity_id (a two-hop), not a direct entity_id column.
  { table: "directory_name_phonetic_code", subjectKey: "name_id", action: "hard-delete" },
  { table: "directory_email", subjectKey: "entity_id", action: "hard-delete" },
  { table: "directory_phone", subjectKey: "entity_id", action: "hard-delete" },
  { table: "directory_address", subjectKey: "entity_id", action: "hard-delete" },
  { table: "directory_entity_category", subjectKey: "entity_id", action: "hard-delete" },
  // Edges reference a subject on both endpoints (mirrors the merge repoint set).
  { table: "directory_edge", subjectKey: "from_entity_id", action: "hard-delete" },
  { table: "directory_edge", subjectKey: "to_entity_id", action: "hard-delete" },
  // The node itself: anonymize to a tombstone, keep the id for matter-link / audit integrity.
  { table: "directory_person", subjectKey: "self", action: "anonymize" },
  { table: "directory_organization", subjectKey: "self", action: "anonymize" },
  // Matter-corpus references — retained under GDPR Art. 17(3); PII is scrubbed at the entity.
  {
    table: "matter_party",
    subjectKey: "entity_id",
    action: "retain-under-matter",
    note: "a party's role on a matter is itself a matter record",
  },
  { table: "custom_field_value", subjectKey: "value_reference_id", action: "anonymize" },
  { table: "custom_field_value", subjectKey: "target_row_id", action: "anonymize" },
  {
    table: "cost_entry",
    subjectKey: "vendor_id",
    action: "retain-under-matter",
    note: "vendor payee on a financial record",
  },
  { table: "file", subjectKey: "matter_id", action: "retain-under-matter", note: "matter corpus" },
  // User-axis: firm members are data subjects of their own account/activity PII.
  {
    table: "time_entry",
    subjectKey: "timekeeper_user_id",
    action: "retain-under-matter",
    note: "billing record; the narrative free-text is handled by the residue report",
  },
  { table: "incident", subjectKey: "reported_by", action: "pseudonymize-keep" },
  { table: "ai_detection_usage", subjectKey: "requested_by", action: "pseudonymize-keep" },
  // Append-only tables: pseudonymize the subject reference, never delete the row.
  { table: "audit_log", subjectKey: "actor_user_id", action: "pseudonymize-keep" },
  { table: "entity_merge", subjectKey: "subordinate_id", action: "pseudonymize-keep" },
];

// Per-firm tables that hold NO personal data — the explicit non-PII half of the coverage fitness.
// A table added to the schema is unclassified until it appears here or in PII_TABLES, so a new
// personal-data table cannot slip in unattributed. Filled from the coverage test's failure output;
// each is a structural/administrative/catalog/config table with no personal-data column of its own.
export const NO_PII_TABLES: readonly string[] = [
  // Request/event plumbing — ids and redacted, non-privileged payloads only.
  "idempotency_key",
  "outbox",
  // Per-firm RBAC — roles are data, permissions are registry keys; no personal data. `member` mirrors
  // the control-plane user by user_id (the join key) and carries only a display name, kept live for
  // referential integrity across nearly every table below; the user-axis rows already in PII_TABLES
  // (time_entry.timekeeper_user_id, incident.reported_by, audit_log.actor_user_id,
  // ai_detection_usage.requested_by) are the subject's own erasure-relevant ACTIVITY, which is what
  // this registry attributes — `member` itself, and the pure role/location/lock assignment tables
  // below, are current operational state, not an activity record about the subject.
  "member",
  "role",
  "role_permission",
  "member_role",
  "direct_grant",
  // Append-only double-entry ledger — structural accounting rows; a transaction's free-text
  // description is a business record, not personal data (mirrors matter.description below).
  "ledger_account",
  "ledger_entry",
  "ledger_line",
  "account_balance",
  // Firm offices and their staffing — the firm's own addresses/phone numbers, not a person's.
  "location",
  "location_address",
  "member_location",
  // Matters, Locations & File Manager structure — classification catalogs, matter/folder shells, and
  // file-lifecycle bookkeeping.
  "matter_type",
  "document_type",
  "numbering_scheme",
  "matter_number_counter",
  // matter is matter-scoped metadata, BUT matter.client_display_name/client_code can hold a
  // prospective client's name pre-Directory-link, with no structured subject key to resolve — a known
  // residual in the same class as shipment-address JSON (handled by the residue report / a product
  // constraint requiring a Directory link before a client name is stored). See
  // docs/conventions/compliance.md.
  "matter",
  "folder",
  "document_checkout",
  "upload_session",
  "storage_meter",
  "scan_cache",
  "token_usage_meter",
  // file-version metadata (r2_key, hashes, status) — no personal data of its own; the document's
  // matter-corpus retention is expressed by the file entry
  "file_version",
  // Per-firm config — key/value settings; a user-scoped row is application preference data, not the
  // user's own identity/activity PII.
  "setting",
  "scoped_setting",
  // A connection's principal_ref names a firm- or user-scoped OAuth principal, but the row is current
  // connection *state* (mirrors member_role/document_checkout above), not an activity record.
  "integration_connection",
  "firm_secret", // firm-owned integration secrets (encrypted), not data-subject personal data
  // Directory classification catalogs — tag/role names, not entity data.
  "directory_category",
  "directory_party_role",
  // Mailing/shipment records — from/to addresses are opaque JSON (content-level PII discovery in
  // free text is explicitly out of scope for this registry; see docs/conventions/compliance.md).
  "shipment",
  "shipment_label",
  "tracking_event",
  // Custom-field definitions and picklist catalogs — schema/config, not the field *values*
  // (custom_field_value is already registered).
  "custom_field",
  "picklist_option",
  // Billing configuration — rate cards/rates/UTBMS codes/non-billable categories/narrative templates
  // are firm pricing and coding catalogs, not personal data.
  "rate_card",
  "rate",
  "utbms_code",
  "non_billable_category",
  "narrative_template",
];
