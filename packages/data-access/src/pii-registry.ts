import type { UserId } from "@magna-carta/identifiers/types";

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
  // The conflicts log — append-only compliance records whose RAISE(ABORT) triggers forbid deletion, so
  // the subject reference is pseudonymized in place and the row is never removed (the same discipline as
  // audit_log / entity_merge). Each table resolves to its own structured subject: the check to the firm
  // user who ran it, the hit to the surfaced Directory entity, the disposition to the reviewing member.
  // The entity/identifier references carried inside inputs_json and the free-text rationale are
  // content-level residue, out of this registry's structured scope (mirrors audit_log's metadata JSON).
  { table: "conflicts_check", subjectKey: "actor_user_id", action: "pseudonymize-keep" },
  { table: "conflicts_hit", subjectKey: "entity_id", action: "pseudonymize-keep" },
  { table: "conflicts_disposition", subjectKey: "reviewer_user_id", action: "pseudonymize-keep" },
  // Email filing — a captured message is correspondence on the matter file, so the retention basis is
  // the matter corpus and the subject-side scrub happens at the Directory entity, as with matter_party.
  // These rows resolve to a subject by frozen address VALUE as well as by resolved entity id, the only
  // entries here that do: the address string is what the capture core itself resolves against through
  // the Directory reverse address lookup, and a participant the Directory never matched
  // (directory_entity_id null) carries no id at all — keying only on the id would leave exactly the
  // unresolved people, the ones with no Directory record to scrub, invisible to erasure.
  {
    table: "email_message",
    subjectKey: "from_address",
    action: "retain-under-matter",
    // The DKIM columns are deliberately not a second subject key: the verdict and its reason are facts
    // about a signature, and the verified domain names the ORGANIZATION that signed — a mail domain,
    // not a person's mailbox, so it resolves to no data subject the way from_address does.
    note: "the sender frozen as-at receipt; the subject line and the verbatim R2 original are content-level residue for the residue report",
  },
  {
    table: "email_participant",
    subjectKey: "directory_entity_id",
    action: "retain-under-matter",
    note: "who was on a message is part of the correspondence record",
  },
  {
    table: "email_participant",
    subjectKey: "address",
    action: "retain-under-matter",
    note: "the frozen header string is itself the record, and the only handle on a participant left unresolved",
  },
  {
    table: "email_matter_link",
    subjectKey: "linked_by",
    action: "retain-under-matter",
    note: "which firm member filed a message to a matter, and when, is the filing's provenance on that matter record",
  },
  // An auto-file rule resolves to a subject by its match VALUE for one of its two kinds: a
  // correspondent rule's match value IS a person's mailbox, frozen the same way email_participant's
  // address is and reachable by erasure the same way (a thread rule's match value is an internal
  // thread handle and names nobody). It is retained on the matter's footing rather than deleted
  // because the rule is the authorizing record behind every automatic filing already made on that
  // matter — the answer to "why is this message here" — and the subject-side scrub happens at the
  // Directory entity, as it does for every other row in this group. created_by is the delegating
  // member and is administrative provenance on the same row, not a second subject key.
  {
    table: "email_auto_file_rule",
    subjectKey: "match_value",
    action: "retain-under-matter",
    note: "a correspondent rule's match value is the sender's mailbox, and the rule is what explains every automatic filing it produced",
  },
  // Document automation — the assembly record is the provenance of a document on a matter file, so it
  // is retained on the same basis as the document itself. Its structured subject is the member who
  // requested the assembly; the absent-field key list it also carries names FIELDS, never values, and
  // by construction held nothing.
  {
    table: "document_assembly",
    subjectKey: "requested_by",
    action: "retain-under-matter",
    note: "who produced a document on a matter, and from which template version, is that document's provenance",
  },
  // The firm's merge-field mapping library. Its CONTENT is about documents, not people — a Word field
  // name and the merge key the firm confirmed it means — so the only subject reference is the member
  // who confirmed the mapping. That is administrative provenance on a firm-configuration row, the line
  // integration_connection.created_by and email_capture_address.created_by already sit on, so the
  // reference is pseudonymized and the mapping itself outlives the member: a template registered under
  // it must stay explicable after that person leaves.
  {
    table: "document_template_field_mapping",
    subjectKey: "confirmed_by",
    action: "pseudonymize-keep",
    note: "which member confirmed what a Word field name means is configuration provenance the firm keeps",
  },
  // Custodian — the register of physical client originals a firm holds. Its METADATA alone is
  // sensitive: "this firm holds an original will for Jane Smith" is a disclosure with no document
  // attached. Three tables carry a structured reference to a person; the rest of the group is
  // location structure, catalogs, and bookkeeping and is declared non-personal below.
  //
  // The owner link and the depositor take retain-under-matter on the same reasoning matter_party
  // does: the fact that a firm holds property for a person is itself a record it is obliged to
  // keep — it is what makes the property releasable to the right person — and the subject-side
  // scrub happens at the Directory entity.
  {
    table: "custody_owner",
    subjectKey: "entity_id",
    action: "retain-under-matter",
    note: "whose property the firm physically holds is the record that makes it releasable at all",
  },
  {
    table: "custody_packet",
    subjectKey: "depositor_entity_id",
    action: "retain-under-matter",
    note: "who handed the property over is a fact about the deposit event, not current state",
  },
  // The movement ledger is append-only (RAISE(ABORT) triggers forbid deletion), so its subject
  // references are pseudonymized in place and the row is never removed — the same discipline
  // audit_log, entity_merge, and the conflicts log take. It resolves to a subject two ways, and the
  // second is why one key is not enough: an EXTERNAL borrower (a courier's named driver signing for
  // a deed) has no Directory record by construction, so keying only on the entity id would leave
  // exactly those people unreachable by erasure. The frozen-name key follows the frozen-address
  // precedent email_message and email_participant already set.
  { table: "custody_movement", subjectKey: "borrower_entity_id", action: "pseudonymize-keep" },
  {
    table: "custody_movement",
    subjectKey: "borrower_name",
    action: "pseudonymize-keep",
    note: "an external borrower with no Directory record — the only handle erasure has on them",
  },
  // The release gate's identity capture resolves to the same person the borrower columns above name —
  // whoever collected the property — so it is keyed and pseudonymized on the same footing, and for the
  // same reason the frozen borrower name is: an external collector has no Directory record to scrub at.
  // The verifier and the witness are firm members, and sit in the administrative-provenance class
  // recorded_by_user_id already sits in. release_authority_basis is deliberately NOT a key: it
  // describes a document ("grant of probate dated 3 March"), and where it names a person it does so as
  // free text with no structured subject to resolve — the residue class custody_item.description and
  // matter.description sit in, alongside this table's own reason and note.
  {
    table: "custody_movement",
    subjectKey: "release_identity_evidence",
    action: "pseudonymize-keep",
    note: "how the person collecting an original was identified, frozen on an append-only row that can never be edited",
  },
  // Trust accounting. The sub-ledger node is the one trust table with a structured subject
  // reference: it says the firm holds money for this client on this matter. That is retained on the
  // same basis as matter_party and the custody owner link — a record of client money the firm is
  // obliged to keep and to be able to account for, and the subject-side scrub happens at the
  // Directory entity. Erasing it would leave a balance nobody could return.
  {
    table: "trust_ledger_node",
    subjectKey: "client_entity_id",
    action: "retain-under-matter",
    note: "whose money the firm holds is the record that makes it returnable, and the record a bar examiner asks for",
  },
  // The movement record's counterparty is who the money came from or went to, written as free text
  // rather than as a Directory link — the payee on a trust check is frequently not a contact the
  // firm holds, and a required link would push firms into inventing entities. So there is no
  // structured subject to resolve, which puts it in the residue class alongside custody_item's
  // description and the time-entry narrative: surfaced in the report rather than auto-erased. Its
  // retention basis is stronger than most of that class — the payee is one of the columns the trust
  // record-keeping rules name for the client ledger, on a row that is append-only by trigger.
  {
    table: "trust_movement",
    subjectKey: "counterparty_name",
    action: "report-manual",
    note: "the source or payee on a client-ledger record the rules require the firm to keep, held as free text with no structured subject",
  },
  // A pending disbursement request names its payee as free text for exactly the reason the movement
  // does — the payee on a trust check is frequently not a Directory contact — so it takes the same
  // report-manual treatment on the same reasoning. It is not merely a draft of the movement: a
  // request that was refused or withdrawn has no movement to inherit, and who the firm was ASKED to
  // pay is a record of its own on an append-only row.
  {
    table: "trust_disbursement_request",
    subjectKey: "payee",
    action: "report-manual",
    note: "who a proposed trust payment would have gone to, held as free text with no structured subject, on an append-only row that survives a refusal",
  },
  // A bank statement line names the other party as the BANK printed it — frequently not what the
  // firm called them, and frequently not a Directory contact at all. It is the same free-text
  // residue class the movement's counterparty sits in, and it takes the same treatment for the same
  // reason, with one difference worth stating: this text is the institution's record rather than the
  // firm's, so the firm cannot correct it without the statement ceasing to be what the bank sent.
  {
    table: "trust_bank_statement_line",
    subjectKey: "counterparty_name",
    action: "report-manual",
    note: "the other party as the bank named it on a statement line, held as free text with no structured subject, on an append-only row the firm did not author",
  },
  // Billing. The invoice header is the one billing table with a structured subject reference: it
  // says the firm charged this client. It is retained on the same basis as matter_party and the
  // trust sub-ledger node — a bill the firm issued is a financial record it is obliged to keep and
  // to be able to account for, and the subject-side scrub happens at the Directory entity. Erasing
  // it would leave a receivable in the ledger nobody could attribute.
  {
    table: "invoice",
    subjectKey: "client_entity_id",
    action: "retain-under-matter",
    note: "who the firm billed, on a record it must be able to produce for its own accounts and for a fee dispute",
  },
  // The billing name and letterhead snapshot are the client's name as it was PRINTED on a bill the
  // firm has already given somebody. There is no separate structured subject to resolve — the row's
  // client_entity_id above is it — and re-writing the printed name would make the finalized invoice
  // stop being the document the client received, which is the property the whole snapshot exists to
  // give. The residue class matter.description and custody_item.description sit in.
  {
    table: "invoice",
    subjectKey: "client_billing_name",
    action: "report-manual",
    note: "the client's name as it was printed on a bill already issued, frozen so the finalized invoice re-renders as the document the client received",
  },
  // An invoice line's description is the firm's own narrative of work done, snapshot at composition.
  // Where it names a person it does so as free text with no structured subject — the same residue
  // class the time-entry narrative it was composed from sits in, and it takes the same treatment for
  // the same reason, with the line frozen once its invoice is finalized.
  {
    table: "invoice_line",
    subjectKey: "description",
    action: "report-manual",
    note: "what the client was told the firm did, held as free text with no structured subject, frozen once the invoice is finalized",
  },
  // The case calendar. Only one of its four tables carries a structured reference to a person: who
  // was, or will be, at a hearing. It resolves to a subject three ways because all three shapes
  // really occur, and the third is why one key would not be enough — an EXTERNAL participant (the
  // court reporter, an interpreter, a witness nobody in the firm has a Directory record for) has no
  // entity id by construction, so keying only on that column would leave exactly those people
  // unreachable by erasure. The frozen-name key follows the precedent email_participant.address and
  // custody_movement.borrower_name already set.
  //
  // Retention is the matter's: who appeared on a case, and in what role, is part of that matter's
  // record for the same reason matter_party is, and the subject-side scrub happens at the Directory
  // entity. The member key is the firm member's own attendance — activity, the line
  // time_entry.timekeeper_user_id sits on, rather than the current-state line member_role sits on.
  {
    table: "matter_event_participant",
    subjectKey: "entity_id",
    action: "retain-under-matter",
    note: "who attended a proceeding on a matter is part of that matter's record",
  },
  {
    table: "matter_event_participant",
    subjectKey: "participant_name",
    action: "retain-under-matter",
    note: "an external participant with no Directory record — the only handle erasure has on them",
  },
  {
    table: "matter_event_participant",
    subjectKey: "member_user_id",
    action: "retain-under-matter",
    note: "which firm member appeared, and when, is that matter's record of the appearance",
  },
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
  // The drawn-number allocation ledger behind that counter: a scope key, the integer drawn, the matter
  // it went to, and when. Numbering bookkeeping about a matter, carrying no column about a person.
  "matter_number_allocation",
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
  // Repair/carve provenance for a file version — operation kind, recovery flag, a structural
  // manifest, and source media type. Operational bookkeeping keyed to file_version, no personal
  // data of its own (the underlying document's retention is the file entry's, as above).
  "file_repair_provenance",
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
  // Discovery search-index catalog — index metadata only (split object key, document/byte counts,
  // schema generation, timestamps, and the matter id). The searchable text and any personal data it
  // contains live in the split object in R2 and are erased by re-indexing the source, not by a row
  // here; this catalog carries no data-subject personal data.
  "index_split",
  // Email filing structure — the personal data of a captured message lives on email_message and
  // email_participant (both registered above); these three carry none of their own.
  // A thread row is the conversation grouping key plus a normalized-subject fallback; a subject line is
  // message content, not a structured data-subject column (mirrors matter.description above).
  "email_thread",
  // The link from a message part to its File Manager document — declared filename, media type, and
  // extraction outcome. The document's matter-corpus retention is expressed by the file entry, exactly
  // as for file_version above.
  "email_attachment",
  // A firm-owned inbound routing token: server-minted and opaque, addressed to the firm rather than to
  // any person, so it is not a mailbox belonging to a data subject. created_by is administrative
  // provenance on a configuration row — current state, not an activity record about the member (the
  // same line integration_connection and scoped_setting sit on).
  "email_capture_address",
  // The auto-file evaluation ledger. It is built to hold nothing about a person: identifiers, a
  // closed outcome enum, a closed reason enum, and an evidence structure of identifiers and enums —
  // never a subject line, an address, or a display name. The rule it names is registered above, and
  // the message it names carries its own personal data on email_message.
  "email_auto_file_decision",
  // Document-automation template catalogue — firm-authored assembly inputs and their stored bytes. A
  // template can itself embed sample or boilerplate personal data in its fixed text, which is content-
  // level residue for the residue report exactly as a matter document's contents are; the ROWS carry
  // only the template's name, its narrowing bindings, its scan verdict, and its field manifest, which
  // names merge fields rather than holding any value of one. created_by is administrative provenance on
  // a firm configuration row (the same line email_capture_address sits on).
  "document_template",
  "document_template_version",
  // The merge-field binding index. Two columns, both derived from the version row above: the version's
  // identifier and the merge KEY its manifest names. A key is the platform's own token or a firm's own
  // field handle — it names a fact, never holds one — so there is nothing here about a person even in
  // the residual sense the manifest itself sits on. It is erased with the version it derives from.
  "document_template_field_binding",
  // Custodian structure and catalogs. The three tables that reference a person are registered in
  // PII_TABLES above; these carry none of their own.
  // The container tree is the firm's own safes, shelves, and offsite sites — the firm's premises,
  // not a person's address (the same line `location` sits on).
  "custody_location",
  // The item-type catalog is a classification vocabulary (original will, deed, keys), like
  // matter_type and document_type.
  "custody_item_type",
  // An item describes an OBJECT: its type, a free-text description, the instrument's own date, and a
  // declared value. A description can name the person the instrument concerns ("original will of
  // Jane Smith"), but that is free-text content with no structured subject column to resolve — the
  // same residual class as matter.description and the shipment address JSON, handled by the residue
  // report rather than by a key here. The subject's own erasure anchor is the owner link above.
  "custody_item",
  // A hold, a scan link, and a destruction request each carry only firm-member provenance
  // (placed_by / captured_by / requested_by / approved_by) on a control row about an OBJECT — current
  // operational state and administrative provenance, the line integration_connection and
  // email_capture_address.created_by already sit on. The scanned document's own retention is
  // expressed by its `file` entry, exactly as for file_version and email_attachment.
  "custody_hold",
  "custody_scan",
  "custody_destruction_request",
  // Custody-numbering bookkeeping: a scope key, the integer drawn, the packet it went to, and when.
  // No column about a person (the matter_number_counter / matter_number_allocation precedent).
  "custody_number_counter",
  "custody_number_allocation",
  // A stocktake is a control row about counting OBJECTS: the firm's own label, a location scope, and
  // firm-member provenance (opened_by / closed_by) — the custody_hold / custody_scan line. A sighting
  // adds observed_by (the same provenance class) and, for an unregistered object only, a free-text
  // description of the thing on the shelf. That description can name the person an instrument
  // concerns, but it is content with no structured subject column to resolve — the residual class
  // custody_item.description established, handled by the residue report rather than by a key here.
  // Both rows are append-only by trigger, so were a key ever added it would take pseudonymize-keep.
  "custody_stocktake",
  "custody_stocktake_sighting",
  // Trust accounting. The one table with a structured subject reference (trust_ledger_node) is
  // registered in PII_TABLES above; these three carry none of their own.
  // A trust account is the FIRM's bank account, bound to the firm's own office — the same line
  // `location` sits on. Its display fragment is four digits of the firm's account number, which is
  // not a fact about any data subject.
  "trust_account",
  // A hold and a transfer are records about MONEY: an amount, a reason, the entries that moved it,
  // and firm-member provenance (placed_by / authorized_by) on an append-only row. The authorizing
  // member on a disbursement is the electronic-transfer authorization memo the rules require the
  // firm to keep, which is the same administrative-provenance class custody_movement's recorder sits
  // on; the client the money belongs to resolves through the node, not through these.
  "trust_hold",
  "trust_transfer",
  // The decision that settles a disbursement request carries firm-member provenance (decided_by),
  // the footing the approval was given on, and the decider's reason for a refusal — administrative
  // provenance about a firm control, the line custody_destruction_request sits on. The payee the
  // request named is registered above; nothing about a data subject is repeated here.
  "trust_disbursement_decision",
  // A bank statement is the institution's report about the FIRM's own bank account — a period, two
  // balances, and the firm's reference for it. It is the same line `trust_account` sits on; the one
  // column about anybody else is the line's counterparty, registered above.
  "trust_bank_statement",
  // A reconciliation is a control row about MONEY and its proof: the account, the statement, the
  // frozen totals, and firm-member provenance (opened_by / closed_by) — the custody_stocktake line.
  // A match is one member's assertion tying a statement line to a ledger entry, carrying two handles
  // and the member who asserted it. Neither carries a column about a data subject; whose money the
  // ledger holds resolves through trust_ledger_node, registered above.
  "trust_reconciliation",
  "trust_reconciliation_match",
  // Billing. The two tables with a subject reference (invoice, invoice_line) are registered in
  // PII_TABLES above; these five carry none of their own.
  // A claim says which work-in-progress row an invoice took. It is two handles, an amount, and two
  // timestamps — a record about the firm's own bookkeeping, whose client resolves through the
  // invoice, not through this row.
  "invoice_wip_claim",
  // A derived balance: an invoice, a matter, and two integers. It is the line account_balance sits
  // on, and whose money it concerns resolves through the invoice.
  "invoice_matter_balance",
  // The numbering pair is a sequence: a scope key, a counter, and which invoice consumed which
  // value. Nothing about any person.
  "invoice_number_counter",
  "invoice_number_allocation",
  // Which of the firm's own ledger accounts plays each posting role — the firm's chart of accounts
  // by another name, and configuration rather than personal data (the line `rate_card` sits on).
  "firm_account_role",
  // The case calendar. The one table that references a person (matter_event_participant) is
  // registered in PII_TABLES above; these three carry no structured personal-data column.
  // The event-type catalog is a classification vocabulary (hearing, deposition, filing), the line
  // matter_type, document_type, and custody_item_type sit on.
  "matter_event_type",
  // An event describes a PROCEEDING: its type, when and where it is, the court's own case number,
  // and firm-member provenance (recorded_by). Its title and description are free text and can name
  // the people a hearing concerns ("Smith custody hearing"), but that is content with no structured
  // subject column to resolve — the residue class matter.description and custody_item.description
  // established, handled by the residue report rather than by a key here. Who attended IS keyed, on
  // matter_event_participant above.
  "matter_event",
  // A deadline is a DATE the firm must act by, plus the firm's own note of the authority it comes
  // from and, where one was recorded, why it is no longer in force. Its title, authority note, state
  // reason, and satisfaction note are the same free-text residue class the event's title sits in;
  // recorded_by / satisfied_by are firm-member provenance on a control row about a date.
  "matter_deadline",
];
