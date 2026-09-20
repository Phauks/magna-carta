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
  // The node itself: anonymize to a tombstone, keep the id for matter-link / audit integrity. The
  // scrub set is every personal column on the row, which now includes the six pronoun columns. They
  // are ORDINARY personal data on purpose and deliberately NOT protected(): a pronoun is printed in
  // the body of documents the firm assembles all day, so routing it through the decrypt chokepoint
  // would put a permission gate and an audit row on every ordinary letter, and the practical effect
  // of a field too expensive to read is a firm that goes back to guessing — which is the harm the
  // field exists to prevent. What the classification does buy is that erasure reaches them and that
  // they are covered by the standing redaction default: a pronoun set is never a log field.
  {
    table: "directory_person",
    subjectKey: "self",
    action: "anonymize",
    note: "name parts, display name, the stated pronoun set, and the life dates (date of birth and date of death) are all scrubbed at the node",
  },
  { table: "directory_organization", subjectKey: "self", action: "anonymize" },
  // Matter-corpus references — retained under GDPR Art. 17(3); PII is scrubbed at the entity.
  {
    table: "matter_party",
    subjectKey: "entity_id",
    action: "retain-under-matter",
    note: "a party's role on a matter is itself a matter record",
  },
  { table: "custom_field_value", subjectKey: "value_reference_id", action: "anonymize" },
  {
    table: "custom_field_value",
    subjectKey: "target_row_id",
    action: "anonymize",
    note: "the target row is a data subject only where the field's target is the directory axis; a matter or matter-asset handle in this column matches no subject id and is reached, correctly, by the matter corpus instead",
  },
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
  {
    table: "fee_entry",
    subjectKey: "timekeeper_user_id",
    action: "retain-under-matter",
    note: "billing record, on the same terms as time_entry: whose professional services were charged is part of what a bill is defended with, and the description and memo free-text are handled by the residue report",
  },
  { table: "incident", subjectKey: "reported_by", action: "pseudonymize-keep" },
  { table: "ai_detection_usage", subjectKey: "requested_by", action: "pseudonymize-keep" },
  // The download shelf — a member's own transient list of what the platform produced for them.
  // HARD-DELETE, and it is the rare table where that is unambiguously right: every row belongs to
  // exactly one member, is theirs alone by construction (no read is firm-wide), holds nothing the
  // firm is ever asked to account for, and expires within a week anyway. Pseudonymizing would leave
  // a stranger's shelf pointing at a stored export document nobody can reach and nothing will
  // delete; the audit rows that record the member's downloads live in audit_log, which is
  // pseudonymize-keep above and is where that accountability belongs.
  { table: "download_item", subjectKey: "member_id", action: "hard-delete" },
  // Append-only tables: pseudonymize the subject reference, never delete the row.
  { table: "audit_log", subjectKey: "actor_user_id", action: "pseudonymize-keep" },
  // A version records WHO committed it, and that reference outlives the member row by design —
  // file_version.uploaded_by is deliberately not a foreign key, so nothing cascades when a member
  // is erased. The column sat inside NO_PII_TABLES until 2026-08-22, under a note enumerating the
  // r2_key, the hashes and the status and simply not mentioning it, so an erasure passed over every
  // version that member had ever uploaded. Pseudonymize rather than delete, for the reason
  // audit_log and entity_merge do: the fact that SOMEBODY committed this version at this time is
  // chain-of-custody a firm can be asked to account for, and removing the row would break the
  // version lineage the current-version pointer walks.
  { table: "file_version", subjectKey: "uploaded_by", action: "pseudonymize-keep" },
  // Who was in the editing session when a version was cut, on the same terms as uploaded_by: the
  // reference outlives the member row by design (no foreign key to member), and the row is
  // chain-of-custody — that SOMEBODY was in the document at this time — so it is pseudonymized,
  // never deleted.
  { table: "file_version_participant", subjectKey: "member_user_id", action: "pseudonymize-keep" },
  { table: "entity_merge", subjectKey: "subordinate_id", action: "pseudonymize-keep" },
  // The conflicts log — append-only compliance records whose RAISE(ABORT) triggers forbid deletion, so
  // the subject reference is pseudonymized in place and the row is never removed (the same discipline as
  // audit_log / entity_merge). Each table resolves to its own structured subject: the check to the firm
  // user who ran it, the hit to the surfaced Directory entity, the disposition to the reviewing member.
  // The entity/identifier references carried inside inputs_json and the free-text rationale are
  // content-level residue, out of this registry's structured scope (mirrors audit_log's metadata JSON).
  { table: "conflicts_check", subjectKey: "actor_user_id", action: "pseudonymize-keep" },
  // The numbered check and its runs name the member who opened or asked for them, on the same
  // terms as the check record: the row stays, the person becomes a pseudonym.
  {
    table: "conflicts_numbered_check",
    subjectKey: "created_by_user_id",
    action: "pseudonymize-keep",
  },
  {
    table: "conflicts_check_run",
    subjectKey: "requested_by_user_id",
    action: "pseudonymize-keep",
  },
  { table: "conflicts_hit", subjectKey: "entity_id", action: "pseudonymize-keep" },
  { table: "conflicts_disposition", subjectKey: "reviewer_user_id", action: "pseudonymize-keep" },
  // The re-check ledger resolves to the Directory entity its cause is about — a merged subordinate, a
  // renamed entity, the party that was linked. The row is never deleted (a trigger refuses it) and
  // its cause columns are immutable, so the subject reference is pseudonymized in place exactly as
  // the three log tables above are. cause_reference is a HANDLE by construction, never a value.
  {
    table: "conflicts_recheck_request",
    subjectKey: "cause_reference",
    action: "pseudonymize-keep",
  },
  // Magnus conversations — the firm's own work product, protected and deletable. The fact that a
  // member held a conversation is firm activity worth keeping — the ai_detection_usage.requested_by
  // precedent — so the person becomes a pseudonym and the row survives. The turns go with the
  // conversation: a turn has no independent existence, and neither does a record of consent by
  // somebody who has been erased.
  //
  // WHAT A MEMBER TYPED IS FREE TEXT AND IS OUT OF THIS REGISTRY'S STRUCTURED SCOPE. A member may
  // name a client in a question; no column knows that. This is exactly the posture the registry
  // already takes for audit_log's metadata JSON and for email bodies, and the instrument is the same
  // one: CONVERSATION-LEVEL DELETION, which removes the content wholesale rather than column by
  // column. The erasure report names Magnus conversations as a surface the operator reviews, rather
  // than claiming a column-level guarantee no schema here can honour.
  { table: "magnus_conversation", subjectKey: "created_by", action: "pseudonymize-keep" },
  {
    table: "magnus_turn",
    subjectKey: "conversation_id",
    action: "hard-delete",
    note: "deleted with its parent conversation; the free text inside a turn is the residue class the conversation-level delete is the instrument for",
  },
  { table: "magnus_member_acknowledgement", subjectKey: "user_id", action: "hard-delete" },
  // A file attached to a conversation is a reference to the matter's file, holding nothing of
  // it; it goes with the conversation it is attached to.
  {
    table: "magnus_conversation_attachment",
    subjectKey: "conversation_id",
    action: "hard-delete",
    note: "deleted with its parent conversation; a reference to a file, holding nothing of it",
  },
  // A record custodian is whose ELECTRONIC RECORDS were loaded into a review set — a person or an
  // organization named by the firm or by a production. It is the one discovery table with a
  // structured subject column: the optional Directory link, which resolves the custodian to an
  // entity when the firm has a record of them (a production may name somebody the firm has never
  // met, and that row carries no id at all).
  //
  // Retained under the matter, on the matter_party line: whose records a corpus was drawn from is
  // itself a matter record, and a review set whose attribution had been scrubbed could not answer
  // "which custodians held this document" — which is asked under oath. The subject-side scrub
  // happens at the Directory entity, as it does for matter_party; the display_name frozen here is
  // the same as-at-collection record email_message.from_address is, for the same reason.
  {
    table: "record_custodian",
    subjectKey: "directory_entity_id",
    action: "retain-under-matter",
    note: "whose records a corpus was drawn from is a matter record; the frozen display name is the as-at-collection attribution, which is content-level residue",
  },
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
  // Calls and texts. A logged call or message is correspondence on the matter file, so the retention
  // basis and the subject-side scrub are the email group's, one line above, for the same reasons. It
  // keys on the frozen NUMBER as well as the resolved entity id, and that second key is the load-
  // bearing one: an inbound text is logged the moment it arrives, from a number that has resolved to
  // nobody yet and may never resolve, so keying only on the entity id would leave exactly the
  // unrecognised people — the ones with no Directory record to scrub — invisible to erasure. The two
  // member columns are the firm's own side of the conversation: who was on the call, and who typed it
  // in afterwards. Both are provenance on a matter record rather than free-standing member data,
  // which is the line email_matter_link.linked_by already sits on.
  {
    table: "communication",
    subjectKey: "counterparty_entity_id",
    action: "retain-under-matter",
    note: "who the firm spoke to is part of the matter's correspondence record",
  },
  {
    table: "communication",
    subjectKey: "counterparty_number",
    action: "retain-under-matter",
    note: "the number as dialled is itself the record, and the only handle on a counterparty the Directory never matched; a message body and a call summary are content-level residue for the residue report",
  },
  {
    table: "communication",
    subjectKey: "member_user_id",
    action: "retain-under-matter",
    note: "which member was on the call is part of what the matter record says happened",
  },
  {
    table: "communication",
    subjectKey: "logged_by_user_id",
    action: "retain-under-matter",
    note: "who entered a hand-logged call, and when, is that entry's provenance — the reason a member-produced row can be weighed differently from a carrier-produced one",
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
  // The unclaimed-funds diligence file records how a firm tried to reach a client it has lost
  // contact with, and the contact it used is the whole evidentiary point: "we wrote to the client"
  // is not evidence, and "we wrote to 14 Elm Street on 3 March, returned undelivered" is. It is the
  // free-text residue class the movement's counterparty sits in — an address, a telephone number, or
  // a mailbox, with no structured subject to resolve — with a retention basis stronger than most of
  // that class: the rules require the firm to certify these efforts with supporting documentary
  // evidence, and the row is append-only by trigger. Whose money the search concerns resolves
  // through the review's node to trust_ledger_node, registered above, never through a column here.
  {
    table: "trust_unclaimed_funds_contact_attempt",
    subjectKey: "contact_used",
    action: "report-manual",
    note: "the address, number, or mailbox a firm used trying to reach a client it holds money for, held as free text with no structured subject, on an append-only row the firm must be able to certify",
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
  // Corrections after finalization sit on exactly the same footing as the bill they correct, and for
  // the same reason: a credit note is a document the firm has already given a client, and the firm
  // has to be able to produce it for its own accounts and for a fee dispute. Erasing one would leave
  // a posting in the ledger nobody could attribute, which is the argument the invoice row makes.
  {
    table: "credit_note",
    subjectKey: "reason",
    action: "report-manual",
    note: "the firm's own account of why a bill was wrong, held as free text with no structured subject and frozen at issue",
  },
  {
    table: "credit_note_line",
    subjectKey: "description",
    action: "report-manual",
    note: "what the client was told was being credited, held as free text with no structured subject and frozen at issue",
  },
  // Money the firm has conceded is not its own and has not yet given back. Retained on the matter's
  // footing: an open obligation to a client cannot be erased out from under the client it is owed
  // to, and the subject-side scrub happens at the Directory entity.
  {
    table: "client_credit",
    subjectKey: "client_entity_id",
    action: "retain-under-matter",
    note: "who the firm owes money back to, on a record it must be able to produce until the obligation is discharged",
  },
  // WHERE THE FIRM SENT A BILL: the address, mailbox, portal account, or the person it was handed to.
  // Free text with no structured subject — whose bill it was resolves through the invoice, registered
  // above — and the residue class the contact a firm records using to reach a client it holds
  // unclaimed money for sits in, on the same reasoning. It is also the same kind of record: an
  // append-only attempt on an obligation the firm has to be able to certify it discharged, read years
  // later in a fee dispute or a bar audit, and rewriting the address a letter actually went to would
  // make the record stop being evidence of what the firm did.
  {
    table: "invoice_delivery",
    subjectKey: "recipient_reference",
    action: "report-manual",
    note: "where the firm sent a bill and who received it, held as free text with no structured subject, on an append-only row the firm must be able to produce as evidence it gave the client its bill",
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
  // The matter note. Two entries on one table now that a note is one row: the words, and who wrote
  // them.
  //
  // The BODY is report-manual, which this registry defines as "free-text / document content —
  // surfaced in the residue report, not auto-erased", and a note is precisely what that action was
  // written for. A note body may name anybody — the client, the opposing party, a witness, a doctor,
  // a person mentioned once in passing — and no automated pass can safely rewrite prose without
  // either destroying the record's meaning or missing the reference it was asked to remove. So the
  // platform neither silently erases a note nor silently refuses to: it reports it, and a person
  // decides.
  //
  // Note what CHANGED here, because it is the erasure story and not a detail: a note is now deleted
  // outright rather than withdrawn, so a firm acting on a residue report can remove one itself
  // through the ordinary surface. The registry entry is what makes it appear on that report at all.
  //
  // The two AUTHOR columns are pseudonymize-keep on the user axis: the subject reference is replaced
  // and never dropped. Erasing a member anonymizes the member row into a tombstone and the note's
  // author column then points at that tombstone, which is the correct outcome — a note's attribution
  // is most of what makes a record worth having, and the federated timeline reads that column as the
  // entry's actor.
  {
    table: "matter_note",
    subjectKey: "body",
    action: "report-manual",
    note: "the words themselves: attorney work product that may name anybody, with no structured subject column and no safe automated rewrite",
  },
  {
    table: "matter_note",
    subjectKey: "author_user_id",
    action: "pseudonymize-keep",
    note: "who wrote the note; the reference is replaced at the member tombstone, never dropped",
  },
  {
    table: "matter_note",
    subjectKey: "last_edited_by",
    action: "pseudonymize-keep",
    note: "who last changed the words, where anybody has",
  },
  // The task. Four member references and one free-text pair, and the free text is the reason this is
  // report-manual rather than a scrub: a title is written to be read in a list and routinely names
  // the person it is about ("Call Mrs. Herrera re the settlement offer"), with no structured subject
  // column to rewrite from.
  //
  // Every member reference is pseudonymize-keep, on the note's own reasoning: an unattributed
  // obligation is worth a fraction of an attributed one, so the reference is replaced at the member
  // tombstone and never dropped. `created_by` matters more here than it looks — it is half of what
  // makes a task on no matter reachable at all, so dropping it would strand the row.
  {
    table: "matter_task",
    subjectKey: "title",
    action: "report-manual",
    note: "what to do, written to be read in a list and routinely naming the person it concerns; no structured subject column and no safe automated rewrite",
  },
  {
    table: "matter_task",
    subjectKey: "body",
    action: "report-manual",
    note: "the instruction behind the title, the same free text with more room",
  },
  {
    table: "matter_task",
    subjectKey: "cancellation_reason",
    action: "report-manual",
    note: "why the firm decided not to do the work; free text a member typed about a matter",
  },
  {
    table: "matter_task",
    subjectKey: "assignee_user_id",
    action: "pseudonymize-keep",
    note: "whose work it is; the reference is replaced at the member tombstone, never dropped",
  },
  {
    table: "matter_task",
    subjectKey: "updated_by",
    action: "pseudonymize-keep",
    note: "who touched it last; a reference the mirror reads to tell its own writes from a person's, replaced at the member tombstone rather than dropped",
  },
  {
    // The tombstone a deleted task leaves behind, so a mirror learns the work is gone. It carries
    // identifiers and nothing else -- no title, no body, no assignee -- so `deleted_by` is the only
    // subject reference on it, and it is pseudonymized on the same terms as every other actor
    // reference rather than dropping the row, which would take the deletion back out of the feed.
    table: "matter_task_deletion",
    subjectKey: "deleted_by",
    action: "pseudonymize-keep",
    note: "who deleted the task; the deletion itself is the fact the row exists to carry",
  },
  {
    table: "matter_task",
    subjectKey: "created_by",
    action: "pseudonymize-keep",
    note: "who put the task there, and half of what makes a task on no matter reachable",
  },
  {
    table: "matter_task",
    subjectKey: "completed_by",
    action: "pseudonymize-keep",
    note: "who did the work",
  },
  {
    table: "matter_task",
    subjectKey: "cancelled_by",
    action: "pseudonymize-keep",
    note: "who decided the work would not be done",
  },
  // The plan itself names one person: whoever authored it. Everything else on the row is firm
  // procedure — a plan's name and description describe how the firm runs a kind of matter, not
  // anybody it runs one for.
  {
    table: "matter_plan_template",
    subjectKey: "created_by",
    action: "pseudonymize-keep",
    note: "who authored the plan; the reference is replaced at the member tombstone, never dropped",
  },
  // The intake procedure, on the matter plan's line: a procedure's name and description describe
  // what the firm requires before it acts on a kind of matter, not anybody it acts for. A member's
  // record on a consultation is attributed activity on the matter_task line — who recorded the
  // step, who set the record aside — and its two free-text columns are a member's own words about
  // a client's intake, written to be read on the file and with no safe automated rewrite.
  {
    table: "intake_procedure",
    subjectKey: "created_by",
    action: "pseudonymize-keep",
    note: "who authored the procedure; the reference is replaced at the member tombstone, never dropped",
  },
  {
    table: "matter_intake_step_record",
    subjectKey: "recorded_by",
    action: "pseudonymize-keep",
    note: "who answered the step; the answer itself is the fact the row exists to carry",
  },
  {
    table: "matter_intake_step_record",
    subjectKey: "superseded_by",
    action: "pseudonymize-keep",
    note: "who set the answer aside",
  },
  {
    table: "matter_intake_step_record",
    subjectKey: "note",
    action: "report-manual",
    note: "a word on what was done, free text a member typed about a consultation and routinely naming the client",
  },
  {
    table: "matter_intake_step_record",
    subjectKey: "rationale",
    action: "report-manual",
    note: "why the firm opened without the step; free text a member typed about a consultation",
  },
  // The firm's own calendar scope. A firm event's participant table takes the same three keys as a
  // matter event's, for the same three shapes — but the retention basis differs: attendance at the
  // all-hands or a training session is the firm's operational record, not a matter's litigation
  // record, so there is no Art. 17(3) ground to retain a name against its subject's request.
  // Anonymize scrubs the reference and keeps the row: the meeting happened and the headcount
  // stands, but nothing ties the erased person to it.
  {
    table: "firm_event_participant",
    subjectKey: "entity_id",
    action: "anonymize",
    note: "a Directory contact at a firm meeting; the subject-side scrub happens at the entity, and the attendance row itself carries no retention obligation",
  },
  {
    table: "firm_event_participant",
    subjectKey: "participant_name",
    action: "anonymize",
    note: "an external attendee (a visiting CLE speaker) with no Directory record — the only handle erasure has on them",
  },
  {
    table: "firm_event_participant",
    subjectKey: "member_user_id",
    action: "anonymize",
    note: "a firm member's attendance at the firm's own event — activity, with no matter retention basis behind it",
  },
  // The matter asset register. Its METADATA alone is a disclosure: "this person owns these eleven
  // things" needs no document attached to be sensitive. Four of its tables carry a structured
  // reference to a person or that person's home; the rest of the group is catalog, structure, and
  // bookkeeping and is declared non-personal below.
  //
  // The interest link takes retain-under-matter on the same reasoning matter_party and the custody
  // owner link do: whose property this is IS the matter's record, and the subject-side scrub happens
  // at the Directory entity.
  {
    table: "matter_asset_interest",
    subjectKey: "entity_id",
    action: "retain-under-matter",
    note: "whose stake in the property the firm recorded is itself that matter's record",
  },
  // A property row is frequently a person's HOME ADDRESS, which is personal data with no entity
  // handle on the row at all — the subject resolves through the asset's matter and its interests. It
  // is keyed on its own primary key so erasure can reach the address columns as matter residue rather
  // than leaving them unattributed.
  {
    table: "matter_asset_real_property",
    subjectKey: "asset_id",
    action: "retain-under-matter",
    note: "a scheduled property is frequently a person's home address; the schedule is a matter record",
  },
  {
    table: "matter_asset_financial_account",
    subjectKey: "institution_organization_id",
    action: "retain-under-matter",
    note: "the institution holding the account, where the firm linked a Directory organization",
  },
  // A sealed value plus a four-character suffix. Retained as matter record; crypto-shred reaches the
  // sealed value through the firm key, which is what makes retaining the row safe.
  {
    table: "matter_asset_identifier",
    subjectKey: "asset_id",
    action: "retain-under-matter",
    note: "a sealed account or tax number on a scheduled asset; crypto-shred reaches the sealed value",
  },
  // A business interest optionally points at the Directory organization the company already is.
  {
    table: "matter_asset_business_interest",
    subjectKey: "entity_organization_id",
    action: "retain-under-matter",
    note: "the company a scheduled interest is held in, where the firm linked a Directory organization",
  },
  // Whose life the policy covers — a named person, on the same reasoning the interest link takes:
  // whose property this is IS the matter's record, and the subject-side scrub happens at the Directory
  // entity. The carrier organization is keyed at the same grain rather than as a second row, because
  // one table takes one subject key and the insured is the personal half of it.
  {
    table: "matter_asset_insurance_policy",
    subjectKey: "insured_entity_id",
    action: "retain-under-matter",
    note: "whose life or property a scheduled policy covers is itself that matter's record",
  },
  {
    table: "matter_asset_receivable",
    subjectKey: "debtor_entity_id",
    action: "retain-under-matter",
    note: "who owes money to the estate is a fact of the schedule, not a fact about the firm",
  },
  // Who holds the charge. `holder_name` is free text where no Directory record exists — the custody
  // borrower precedent — so the row is keyed on the handle and the free-text name travels with it as
  // matter residue rather than being left unattributed.
  {
    table: "matter_asset_encumbrance",
    subjectKey: "holder_entity_id",
    action: "retain-under-matter",
    note: "the lender or lienholder secured against a scheduled asset, named on the matter's record",
  },
  // The valuation history is append-only by trigger, so its one subject reference — the firm member
  // who asserted the figure — is pseudonymized in place and the row is never removed, the discipline
  // audit_log, entity_merge, and the custody movement ledger already take.
  { table: "matter_asset_valuation", subjectKey: "recorded_by", action: "pseudonymize-keep" },
  // Matter staffing: which firm member carried a matter, in which role, over which dates. Retained
  // as the matter's record on the same line time_entry.timekeeper_user_id sits on — who worked a
  // file is that file's history, not current operational state.
  {
    table: "matter_assignment",
    subjectKey: "member_user_id",
    action: "retain-under-matter",
    note: "who was staffed on a matter, and in what role, is that matter's record",
  },
  // A member's professional identity as documents state it — title, admissions, direct dial,
  // professional email, signature block. The member's own current-state data with no matter
  // retention basis, so it is deletable outright at the subject.
  { table: "member_professional_profile", subjectKey: "member_user_id", action: "hard-delete" },
  // A member's own photograph. The most plainly personal row the firm database holds and the one
  // with the least to retain it against: nothing is filed under it, no matter's record depends on
  // it, and it exists only so colleagues recognise a face. So it goes outright at the subject, the
  // same line the professional profile sits on.
  //
  // ONE NOTE FOR WHOEVER BUILDS THE ORCHESTRATOR: this row is the only thing that names the object
  // holding the bytes, so deleting it and stopping leaves a photograph of a person in the firm's
  // bucket that nothing can ever find again to delete. The object key has to be read off the row
  // before the row goes. The route that removes a picture does exactly that
  // (apps/api-worker/src/routes/me-photo.ts).
  {
    table: "member_photo",
    subjectKey: "member_user_id",
    action: "hard-delete",
    note: "the row names an R2 object; read object_key before deleting the row",
  },
  // The court-case record names two people-adjacent Directory references: the court organisation
  // and the assigned judge. Both are the matter's own identity facts — which court a case is before
  // is the caption — and the subject-side scrub happens at the Directory entity, as matter_party.
  {
    table: "matter_court_case",
    subjectKey: "judge_entity_id",
    action: "retain-under-matter",
    note: "which judge a matter's case is assigned to is the case's own identity",
  },
  {
    table: "matter_court_case",
    subjectKey: "court_entity_id",
    action: "retain-under-matter",
    note: "which court a matter's case is before is the caption's own fact",
  },
  // The estate record names the decedent (a Directory person) and, where the firm keeps one, the
  // estate's own Directory organisation. A probate matter IS about the decedent; the record of whom
  // it administered is the matter's record, and the subject-side scrub happens at the Directory
  // entity. The stored styles repeat the decedent's name as free text fixed by a court — surfaced
  // by the residue report on the same basis as other frozen legal designations.
  {
    table: "matter_estate",
    subjectKey: "decedent_entity_id",
    action: "retain-under-matter",
    note: "whose estate a probate matter administers is that matter's own identity",
  },
  {
    table: "matter_estate",
    subjectKey: "estate_entity_id",
    action: "retain-under-matter",
    note: "the estate's own Directory record, where the firm keeps one",
  },
  // Notifications. Four of the five tables key to a member — not as provenance on somebody else's
  // record, but as the member's OWN feed: what they were told, whether they dealt with it, whether
  // a copy was mailed to them, and how much aged out unread while they were away. That is activity
  // about the subject, the line time_entry.timekeeper_user_id sits on.
  //
  // The action is HARD-DELETE, and it is the one place in this registry where that is the easy call
  // rather than the aggressive one. A notification is a POINTER and never a record: the thing it
  // points at — the ledger entry, the invoice, the deadline, the audit_log row — is the record, is
  // registered here in its own right, and stays exactly where it is. Erasing a member's feed
  // therefore removes no evidence and breaks no reconciliation; it removes stale pointers to
  // evidence that is still there. These rows are already deleted wholesale by the retention sweep
  // on the firm's configured window, so erasure is doing early and by subject what the platform
  // already does on a clock.
  // Who was cleared to see one review set's corpus. The matter_assignment shape and the same
  // reasoning: who was permitted to look at what, and when, is that matter's record — and in
  // discovery it is more than that, because "who had access to the production" is a question asked
  // under a protective order. Erasing it would destroy the answer.
  {
    table: "review_set_access",
    subjectKey: "member_user_id",
    action: "retain-under-matter",
    note: "who was cleared for a corpus is that matter's record, and the answer a protective-order question needs",
  },
  {
    table: "review_set_access",
    subjectKey: "granted_by",
    action: "retain-under-matter",
    note: "who widened the wall is the other half of that record, and is asked about as often as who was let in",
  },
  // One human act of coding, and the actor who performed it. This is the defensibility record the
  // whole subsystem exists to produce — "who coded this document, as what, when" is what a court
  // asks when a production is challenged — so it is retained rather than erasable, on the same
  // basis as the matter file it belongs to. The per-document rows carry no person column of their
  // own and resolve here (NO_PII_TABLES below).
  {
    table: "review_tag_event",
    subjectKey: "actor_user_id",
    action: "retain-under-matter",
    note: "who coded what, when, and under what criteria — the record a challenged production is defended with",
  },
  {
    table: "notification_recipient",
    subjectKey: "recipient_user_id",
    action: "hard-delete",
    note: "the member's own feed — pointers to records that are retained and registered separately",
  },
  // The outbound-channel row resolves to its subject through the recipient row it belongs to
  // (notification_recipient_id -> notification_recipient.recipient_user_id), a two-hop rather than a
  // direct column, exactly as directory_name_phonetic_code resolves through directory_name.
  {
    table: "notification_delivery",
    subjectKey: "notification_recipient_id",
    action: "hard-delete",
  },
  { table: "notification_digest_run", subjectKey: "recipient_user_id", action: "hard-delete" },
  {
    table: "notification_swept_unread",
    subjectKey: "recipient_user_id",
    action: "hard-delete",
    note: "a per-member tally of how many pointers aged out unread; carries a count and two instants and nothing about what they pointed at",
  },
  {
    table: "notification_in_app_suppression",
    subjectKey: "recipient_user_id",
    action: "hard-delete",
    note: "the swept-unread shape exactly, one question over: a per-member per-category day tally of how many notifications a preference silenced, carrying a count, a civil date, whose choice did it, and an instant — and nothing about what was silenced. Hard-delete for the same reason its sibling is: it points at records that are registered and retained in their own right",
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
  "firm_brand_image",
  // Matters, Locations & File Manager structure — classification catalogs, matter/folder shells, and
  // file-lifecycle bookkeeping.
  "matter_type",
  "document_type",
  "numbering_scheme",
  "matter_number_counter",
  // The drawn-number allocation ledger behind that counter: a scope key, the integer drawn, the matter
  // it went to, and when. Numbering bookkeeping about a matter, carrying no column about a person.
  "matter_number_allocation",
  // The conflicts check sequence's counter and allocation ledger: the same bookkeeping about a
  // numbered check, carrying no column about a person (the check itself is classified above).
  "conflicts_check_number_counter",
  "conflicts_check_number_allocation",
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
  // The nickname equivalence catalogue is a dictionary of NAME FORMS — `bob` implies `robert` — and
  // names no person. A row is about the language, not about anybody in the firm's Directory, so
  // erasing a data subject leaves it untouched; erasing from it would delete a curated linguistic
  // fact because somebody happened to be called Robert.
  "nickname_equivalence",
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
  // The entry-numbering pair is a sequence: a scope key (the matter id), a counter, and which
  // entry consumed which value. Nothing about any person (the matter_number_counter precedent).
  "time_entry_number_counter",
  "time_entry_number_allocation",
  // Which of the matter's files a time entry points at, with firm-member provenance (created_by) —
  // the custody_hold / custody_scan line. The person the underlying document concerns resolves
  // through the `file` entry, never through a column here.
  "time_entry_attachment",
  // Discovery search-index catalog — index metadata only (split object key, document/byte counts,
  // schema generation, timestamps, and the matter id). The searchable text and any personal data it
  // contains live in the split object in R2 and are erased by re-indexing the source, not by a row
  // here; this catalog carries no data-subject personal data.
  "index_split",
  // What is inside a merged split — a split id, the file ids and version numbers it covers, and whether
  // each is still current. Identifiers and integers only: it says which documents a split holds, never
  // anything about the people in them. The passages themselves are in the split object in R2 and leave
  // it when compaction repacks the split, not when a row here is deleted.
  "index_split_member",
  // The natural-language search feed catalog — one row per object of extracted text copied out to the
  // managed index: file id, version number, matter id, object key, byte count, and two timestamps.
  // Identifiers and integers only. The extracted text itself, and any personal data in it, lives in the
  // feed object in R2 and in the managed index; it is erased by the deletion job that removes the
  // object and marks the row removed, not by deleting the row — which is exactly why the row is marked
  // rather than deleted, since it is the record that the erasure happened.
  "ai_search_feed_object",
  // Per-firm usage of the managed search index — a civil-day bucket with four counters and one recorded
  // ratio. It carries no member, no matter, and no query: a query's audit row names the member and the
  // matter, and this table deliberately cannot, because a per-member usage series would be a record of
  // who searched what and when built out of a billing meter.
  "ai_search_usage_meter",
  // The firm's acknowledgement of the search disclosure: one row, a version number, an instant, and the
  // administrator who accepted it. The member reference is administrative provenance on a configuration
  // act — who signed the firm up to an arrangement — and is current state rather than an activity
  // record about that person, the same line integration_connection and scoped_setting sit on.
  "ai_search_disclosure_acknowledgement",
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
  // The firm's disbursement-authorization posture, one immutable row per version: a policy kind, a
  // threshold, a flag, and firm-member provenance (set_by) — configuration about a firm control,
  // the line firm_account_role sits on.
  "trust_authorization_policy",
  // One invoice-and-amount a pending earned-fee application proposes to settle: two handles and an
  // amount. Whose bill it is resolves through the invoice, never through a column here.
  "invoice_trust_application_line",
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
  // A firm-funds movement is a record about the FIRM'S OWN money in its own bank account — the
  // deposit that funds the bank-charge cushion, and the institution taking a charge out of it. There
  // is deliberately no column in it for a client, a matter, a node, or a payee, which is what makes
  // the carve-out narrow; the only person it names is the firm member who recorded it, which is the
  // administrative-provenance line trust_transfer.authorized_by sits on.
  "trust_firm_funds_movement",
  // The diligence file's other two rows. A review is an observation about a BALANCE — what it was,
  // when the money arrived, when the ledger last moved — plus firm-member provenance; whose money it
  // is resolves through trust_ledger_node, registered above. A closure is an outcome, the
  // disbursement that settled it, and the member who closed it. The one column about a data subject
  // in the whole group is the contact an attempt used, registered above.
  "trust_unclaimed_funds_review",
  "trust_unclaimed_funds_review_closure",
  // Billing. The two tables with a subject reference (invoice, invoice_line) are registered in
  // PII_TABLES above; these five carry none of their own.
  // A claim says which work-in-progress row an invoice took. It is two handles, an amount, and two
  // timestamps — a record about the firm's own bookkeeping, whose client resolves through the
  // invoice, not through this row.
  "invoice_wip_claim",
  // A derived balance: an invoice, a matter, and two integers. It is the line account_balance sits
  // on, and whose money it concerns resolves through the invoice.
  "invoice_matter_balance",
  // One unit of value reaching an invoice: two handles, a kind, an amount, the trust transfer or the
  // earlier application it came from, an effective date, and firm-member provenance (applied_by).
  // The member who applied client money to a bill is administrative provenance on a money record —
  // the line trust_transfer.authorized_by sits on — and whose money it was resolves through the
  // invoice and the trust transfer, never through a column here.
  "invoice_application",
  // The numbering pair is a sequence: a scope key, a counter, and which invoice consumed which
  // value. Nothing about any person.
  "invoice_number_counter",
  "invoice_number_allocation",
  // The call log's own sequence: a day, and how many calls that day has numbered. A count of the
  // firm's traffic and nothing about anybody in it — the invoice_number_counter precedent, with no
  // allocation table beside it because the number a draw renders carries its whole scope.
  "communication_number_counter",
  // Which of the firm's own ledger accounts plays each posting role — the firm's chart of accounts
  // by another name, and configuration rather than personal data (the line `rate_card` sits on).
  "firm_account_role",
  // The fee agreement: how a matter is billed — a kind, its amounts, and a validity window, in the
  // effective-dated shape `rate` sits on. Business configuration about a MATTER; whose matter it is
  // resolves through matter_party, never through a column here.
  "matter_billing_arrangement",
  // A recorded recovery: a matter handle, an amount, a date, and firm-member provenance. Its
  // description is the firm's own narrative of a settlement or judgment — free text with no
  // structured subject, the residue class matter.description established.
  "matter_recovery",
  // A replenishment ask: a matter, an arrangement version, two observed integers, and firm-member
  // provenance on who raised and who resolved it. Nothing about a person of its own.
  "retainer_replenishment_request",
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
  // The firm's own calendar scope. The one table that references a person (firm_event_participant)
  // is registered in PII_TABLES above; these four carry no structured personal-data column.
  // A firm event describes something the FIRM scheduled: its type, when and where, its audience,
  // and firm-member provenance (recorded_by). Its title and description are free text that can name
  // a person ("Retirement lunch for J. Alvarez") — the residue class matter.description
  // established, handled by the residue report. Who attended IS keyed, on firm_event_participant.
  "firm_event",
  // A resource is a THING the firm owns — a room's name, kind, office, and capacity. Nothing about
  // any person; the notes column is the ordinary free-text residue class.
  "firm_resource",
  // A booking is a claim on a room for an event's sake: two handles, a window, a zone, and
  // firm-member provenance (recorded_by). Whose proceeding occupies the room resolves through the
  // event, never through a column here.
  "firm_resource_booking",
  // A link is two event handles, a closed kind, a note, and firm-member provenance (recorded_by).
  // The note is free text in the ordinary residue class; the events on its ends carry their own
  // entries.
  "calendar_event_link",
  // The matter asset register. The five tables that reference a person or a person's home are
  // registered in PII_TABLES above; these two carry no structured personal-data column.
  // The asset-type catalog is a classification vocabulary under a platform class (single-family
  // residence, brokerage account), the line matter_type, document_type, custody_item_type, and
  // matter_event_type sit on.
  "matter_asset_type",
  // An asset describes a THING OWNED: its class, its type, when it was acquired, how it was disposed
  // of, and firm-member provenance (created_by). Its description and notes are free text and can name
  // the person the thing belongs to ("Jane Smith's wedding ring"), but that is content with no
  // structured subject column to resolve — the residue class matter.description and
  // custody_item.description established, handled by the residue report rather than by a key here.
  // Whose property it is IS keyed, on matter_asset_interest above.
  "matter_asset",
  // A document link is two handles, a kind, a note, and firm-member provenance (linked_by) — a
  // control row about which FILE evidences which asset. The linked document's own retention is
  // expressed by its `file` entry, exactly as for file_version, email_attachment, and custody_scan.
  "matter_asset_document",
  // A note's link to one of the matter's files: two handles, an instant, and firm-member provenance
  // (linked_by). Whose document it is resolves through the file and the matter, never through a
  // column here — the same shape matter_asset_document sits in directly above.
  "matter_note_document",
  // A task's link to one of the matter's files, the same two-handle shape as matter_note_document
  // directly above and for the same reason: whose document it is resolves through the file and the
  // matter, never through a column here.
  "matter_task_document",
  // A task's identity in an outside system: the system's name, its opaque handle for the object, a
  // URL and a revision token. `created_by` is firm-member provenance on the custody_hold line. The
  // person the TASK concerns resolves through matter_task, never through a column here -- an
  // external id is the remote's own key and this platform never parses it.
  "matter_task_external_link",
  // A plan's steps. Free text, and deliberately NOT personal data: a step is written once and used
  // on every matter of its kind, so a step that named a client would be a step that is wrong on
  // every matter but one. `default_assignee_role` is a role string ("assigned_paralegal") matched
  // against the matter's team at proposal time, never a member handle — which is the whole reason a
  // template names a role: one that named Sarah would be wrong the moment Sarah's matters moved.
  "matter_plan_task_template",
  // A procedure's steps, on the plan step's line: a step is written once and asked on every
  // consultation of its kind, so one that named a client would be wrong on every matter but one.
  // `reference_id` names a document template or a custom field definition, never a person.
  "intake_procedure_step",
  // The three structured attribute tables that describe an OBJECT and reference no person: a vehicle's
  // make, model, identification number, and plate; a firearm's make, model, calibre, and serial; a
  // digital asset's platform, its public handle, and who holds it. Every identifier on them is public
  // record — a title, a registration, a bill of sale — and none of them names an owner, because who
  // owns the thing is matter_asset_interest's fact and is keyed there. The digital-asset row carries no
  // credential column at all, by design and by the schema.
  "matter_asset_vehicle",
  "matter_asset_firearm",
  "matter_asset_digital_asset",
  // Discovery — the corpus under review. The one table that names a data subject
  // (record_custodian) is registered in PII_TABLES above; these five carry no structured
  // personal-data column of their own.
  //
  // A review set is a matter's named corpus: its name, its lifecycle, its ceiling, and firm-member
  // provenance (created_by). Its name is free text and can name a person ("Smith mailbox
  // collection"), which is the residue class matter.description and custody_item.description
  // established — content with no structured subject column to resolve.
  "review_set",
  // A load is one recorded act: its lane, its counts, where the loader said it came from, and
  // firm-member provenance (initiated_by). The source description is the same free-text residue
  // class. Whose records the load carried IS keyed, on record_custodian above.
  "discovery_load",
  // A REVIEW DOCUMENT IS A POINTER, and this is the entry that says so. It holds no content and
  // copies none: what it points at is a `file_version` or an `email_message`, and the retention of
  // the thing pointed at is expressed by THAT row's entry (file, email_message), exactly as for
  // custody_scan and matter_asset_document. The columns of its own are digests, an R2 key, a page
  // count, a format name, and a date — facts about bytes, resolving to no data subject. Whose
  // records the document was resolves through record_custodian, which is keyed.
  //
  // The consequence worth stating: erasing a data subject does not reach into a review set, and
  // must not. The corpus under review is a matter record retained under the same basis as the
  // matter file, and a discovery corpus that quietly lost documents when somebody exercised an
  // erasure right would be a corpus a firm could not certify.
  "review_document",
  // A named reason a document did not process: a stage, a closed code, and a detail that is
  // explicitly never file content. Nothing about any person.
  "review_document_exception",
  // One further copy of a deduplicated document — five handles and a timestamp. It exists precisely
  // to PRESERVE attribution, and whose attribution resolves through record_custodian.
  "review_document_occurrence",
  // The coding panel: a question (a name, a cardinality, a sort position) and an answer (a name, a
  // recorded meaning from a closed vocabulary, a design-token name). Neither references a person.
  // The names are free text and a firm's issue codes can name one ("Smith emails"), which is the
  // same residue class review_set.name and matter.description established — content with no
  // structured subject column to resolve.
  "review_tag_group",
  "review_tag",
  // One application of one tag to one document: five handles, two instants, and a denormalized
  // flag. It holds no person column at all. WHO applied it resolves through the event that wrote it
  // (applied_by_event_id -> review_tag_event.actor_user_id), a two-hop rather than a direct column,
  // exactly as notification_delivery resolves through notification_recipient — and that event is
  // registered in PII_TABLES above, retained under the matter.
  "review_document_tag",
  // Notifications. The five tables keyed to a member are registered in PII_TABLES above; the event
  // row itself carries no column about anybody. It is a kind, a category, a severity, the handle of
  // the record it points at, the matter that anchors its visibility, two instants, and a `facts`
  // blob whose values are restricted BY A VALIDATED GRAMMAR to identifiers, integers, booleans,
  // declared enum labels, and dates. There is deliberately no free-text residue class here at all —
  // unlike matter.description or custody_item.description, this row cannot hold a string a person
  // typed, which is the property the whole subsystem is built around. Who was told about it is
  // notification_recipient's fact and is keyed there.
  "notification_event",
];
