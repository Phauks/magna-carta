import type {
  EmailAttachmentId,
  EmailAutoFileRuleId,
  EmailCaptureAddressId,
  EmailMatterLinkId,
  EmailMessageId,
  EmailParticipantId,
  EmailThreadId,
  MatterId,
  UserId,
} from "@magna-carta/identifiers/types";
import { assemblePage, decodeCursor, DEFAULT_PAGE_SIZE, type Page } from "./cursor-pagination.ts";
import {
  selectIdempotencyRecordStatement,
  type SqlDatabase,
  type SqlStatement,
} from "./idempotency-statements.ts";

// Table names tracked against @magna-carta/database's per-firm schema by the schema-name-sync fitness
// test. These tables exist only in the per-firm database — the caller supplies that handle.
export const EMAIL_THREAD_TABLE = "email_thread";
export const EMAIL_MESSAGE_TABLE = "email_message";
export const EMAIL_MATTER_LINK_TABLE = "email_matter_link";
export const EMAIL_PARTICIPANT_TABLE = "email_participant";
export const EMAIL_ATTACHMENT_TABLE = "email_attachment";
export const EMAIL_CAPTURE_ADDRESS_TABLE = "email_capture_address";

// ── Insert inputs. Defined here (not imported from the domain package) so data-access stays a
// foundational layer; @magna-carta/email-filing produces structurally-identical rows the capture
// consumer passes straight through.

export interface EmailThreadInsert {
  readonly id: EmailThreadId;
  readonly subjectNormalized: string | null;
  readonly firstSeenAt: string;
}

export interface EmailMessageInsert {
  readonly id: EmailMessageId;
  readonly messageIdValue: string | null;
  readonly messageIdProvenance: "header" | "mapi" | "absent";
  readonly subject: string | null;
  readonly sentAt: string | null;
  readonly receivedAt: string;
  readonly fromDisplay: string | null;
  readonly fromAddress: string | null;
  readonly threadId: EmailThreadId;
  readonly inReplyTo: string | null;
  readonly contentSha256: string;
  readonly dedupKey: string;
  readonly originalR2Key: string;
  readonly referencesRemoteContent: boolean;
  readonly integrity: string;
  readonly dkimVerdict: "unverified" | "pass" | "fail";
  readonly dkimVerdictReason: string | null;
  readonly dkimVerifiedDomain: string | null;
  readonly sourceFormat: "eml" | "msg" | "mboxMember";
  readonly capturedVia: "forward" | "api" | "addin" | "sync";
}

export interface EmailParticipantInsert {
  readonly id: EmailParticipantId;
  readonly emailMessageId: EmailMessageId;
  readonly kind: "from" | "to" | "cc" | "bcc";
  readonly displayName: string | null;
  readonly address: string | null;
  readonly directoryEntityId: string | null;
}

export interface EmailAttachmentInsert {
  readonly id: EmailAttachmentId;
  readonly emailMessageId: EmailMessageId;
  readonly fileId: string | null;
  readonly filename: string | null;
  readonly mediaType: string | null;
  readonly disposition: "attachment" | "inline";
  readonly promotedFromInline: boolean;
  readonly outcome: "extracted" | "filtered_inline" | "oversize";
}

export interface EmailMatterLinkInsert {
  readonly id: EmailMatterLinkId;
  readonly emailMessageId: EmailMessageId;
  readonly matterId: MatterId;
  readonly state: "staged" | "filed" | "unlinked";
  readonly linkedBy: UserId | null;
  readonly linkedAt: string | null;
  readonly capturedVia: "forward" | "api" | "addin" | "sync";
  // The rule that made this link, where a rule did. Optional because the overwhelming majority of
  // links are a person's, and an omitted value reads as exactly that — the conservative answer, and
  // the one every link written before rules existed already carries.
  readonly autoFileRuleId?: EmailAutoFileRuleId | null;
}

export interface EmailCaptureAddressInsert {
  readonly id: EmailCaptureAddressId;
  readonly token: string;
  readonly kind: "matter" | "catchAll";
  readonly matterId: MatterId | null;
  readonly createdBy: UserId | null;
}

// ── Write statement builders (return an unexecuted statement; the caller composes the batch).

export function insertEmailThreadStatement(
  database: SqlDatabase,
  input: EmailThreadInsert,
  now: string,
): SqlStatement {
  return database
    .prepare(
      `INSERT INTO ${EMAIL_THREAD_TABLE} (id, subject_normalized, first_seen_at, created_at, updated_at)
       VALUES (?1, ?2, ?3, ?4, ?4)`,
    )
    .bind(input.id, input.subjectNormalized, input.firstSeenAt, now);
}

export function insertEmailMessageStatement(
  database: SqlDatabase,
  input: EmailMessageInsert,
  now: string,
): SqlStatement {
  return database
    .prepare(
      `INSERT INTO ${EMAIL_MESSAGE_TABLE}
         (id, message_id_value, message_id_provenance, subject, sent_at, received_at, from_display,
          from_address, thread_id, in_reply_to, content_sha256, dedup_key, original_r2_key,
          references_remote_content, integrity, dkim_verdict, dkim_verdict_reason,
          dkim_verified_domain, source_format, captured_via, created_at, updated_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19, ?20, ?21, ?21)`,
    )
    .bind(
      input.id,
      input.messageIdValue,
      input.messageIdProvenance,
      input.subject,
      input.sentAt,
      input.receivedAt,
      input.fromDisplay,
      input.fromAddress,
      input.threadId,
      input.inReplyTo,
      input.contentSha256,
      input.dedupKey,
      input.originalR2Key,
      input.referencesRemoteContent ? 1 : 0,
      input.integrity,
      input.dkimVerdict,
      input.dkimVerdictReason,
      input.dkimVerifiedDomain,
      input.sourceFormat,
      input.capturedVia,
      now,
    );
}

export function insertEmailParticipantStatement(
  database: SqlDatabase,
  input: EmailParticipantInsert,
  now: string,
): SqlStatement {
  return database
    .prepare(
      `INSERT INTO ${EMAIL_PARTICIPANT_TABLE}
         (id, email_message_id, kind, display_name, address, directory_entity_id, created_at, updated_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?7)`,
    )
    .bind(
      input.id,
      input.emailMessageId,
      input.kind,
      input.displayName,
      input.address,
      input.directoryEntityId,
      now,
    );
}

export function insertEmailAttachmentStatement(
  database: SqlDatabase,
  input: EmailAttachmentInsert,
  now: string,
): SqlStatement {
  return database
    .prepare(
      `INSERT INTO ${EMAIL_ATTACHMENT_TABLE}
         (id, email_message_id, file_id, filename, media_type, disposition, promoted_from_inline,
          outcome, created_at, updated_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?9)`,
    )
    .bind(
      input.id,
      input.emailMessageId,
      input.fileId,
      input.filename,
      input.mediaType,
      input.disposition,
      input.promotedFromInline ? 1 : 0,
      input.outcome,
      now,
    );
}

// Insert the multi-matter junction. Idempotent on the (message, matter) pair: a re-capture staging the
// same message to the same matter is a no-op (the unique index backs the ON CONFLICT), never a second
// link and never a state regression of an already-accepted link.
export function insertEmailMatterLinkStatement(
  database: SqlDatabase,
  input: EmailMatterLinkInsert,
  now: string,
): SqlStatement {
  return database
    .prepare(
      `INSERT INTO ${EMAIL_MATTER_LINK_TABLE}
         (id, email_message_id, matter_id, state, linked_by, linked_at, captured_via, auto_file_rule_id, created_at, updated_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?9)
       ON CONFLICT (email_message_id, matter_id) DO NOTHING`,
    )
    .bind(
      input.id,
      input.emailMessageId,
      input.matterId,
      input.state,
      input.linkedBy,
      input.linkedAt,
      input.capturedVia,
      input.autoFileRuleId ?? null,
      now,
    );
}

// Promote a staged link to filed. Guarded on state = 'staged' so accepting is idempotent and never
// resurrects an unlinked pair; the filing-time conflict/ethical-wall hook is called by the caller
// before this runs.
export function acceptStagedLinkStatement(
  database: SqlDatabase,
  input: { emailMessageId: EmailMessageId; matterId: MatterId; linkedBy: UserId | null },
  now: string,
): SqlStatement {
  return database
    .prepare(
      `UPDATE ${EMAIL_MATTER_LINK_TABLE}
       SET state = 'filed', linked_by = ?1, linked_at = ?2, updated_at = ?2
       WHERE email_message_id = ?3 AND matter_id = ?4 AND state = 'staged'`,
    )
    .bind(input.linkedBy, now, input.emailMessageId, input.matterId);
}

// Unlink a message from a matter (state → unlinked). Never deletes the message: the last link removed
// orphans it, retained per policy and legal hold.
export function unlinkEmailFromMatterStatement(
  database: SqlDatabase,
  input: { emailMessageId: EmailMessageId; matterId: MatterId },
  now: string,
): SqlStatement {
  return database
    .prepare(
      `UPDATE ${EMAIL_MATTER_LINK_TABLE}
       SET state = 'unlinked', updated_at = ?1
       WHERE email_message_id = ?2 AND matter_id = ?3 AND state != 'unlinked'`,
    )
    .bind(now, input.emailMessageId, input.matterId);
}

// Record a re-confirmation of an already-captured message (a second filer). Touches updated_at without
// duplicating the record — one message, many filers.
export function touchEmailMessageStatement(
  database: SqlDatabase,
  emailMessageId: EmailMessageId,
  now: string,
): SqlStatement {
  return database
    .prepare(`UPDATE ${EMAIL_MESSAGE_TABLE} SET updated_at = ?1 WHERE id = ?2`)
    .bind(now, emailMessageId);
}

export function insertEmailCaptureAddressStatement(
  database: SqlDatabase,
  input: EmailCaptureAddressInsert,
  now: string,
): SqlStatement {
  return database
    .prepare(
      `INSERT INTO ${EMAIL_CAPTURE_ADDRESS_TABLE}
         (id, token, kind, matter_id, active, created_by, created_at, updated_at)
       VALUES (?1, ?2, ?3, ?4, 1, ?5, ?6, ?6)`,
    )
    .bind(input.id, input.token, input.kind, input.matterId, input.createdBy, now);
}

// Retire a capture address. Guarded on active = 1 so a repeat revoke (a retry, a rotate replayed) is
// a zero-change no-op rather than a rewrite of the original retirement instant. `rotated_at` records
// WHEN this address stopped being the live one — it is set by both a plain revoke and the revoke half
// of a rotate, because from the address's own point of view those are the same event.
export function revokeEmailCaptureAddressStatement(
  database: SqlDatabase,
  emailCaptureAddressId: EmailCaptureAddressId,
  now: string,
): SqlStatement {
  return database
    .prepare(
      `UPDATE ${EMAIL_CAPTURE_ADDRESS_TABLE}
       SET active = 0, rotated_at = ?1, updated_at = ?1
       WHERE id = ?2 AND active = 1`,
    )
    .bind(now, emailCaptureAddressId);
}

export interface CaptureAddressRow {
  readonly id: EmailCaptureAddressId;
  readonly token: string;
  readonly kind: "matter" | "catchAll";
  readonly matterId: MatterId | null;
  readonly active: boolean;
  readonly createdBy: UserId | null;
  readonly rotatedAt: string | null;
  readonly createdAt: string;
}

const CAPTURE_ADDRESS_COLUMNS =
  "id, token, kind, matter_id, active, created_by, rotated_at, created_at";

interface CaptureAddressResultRow {
  id: string;
  token: string;
  kind: string;
  matter_id: string | null;
  active: number;
  created_by: string | null;
  rotated_at: string | null;
  created_at: string;
}

function toCaptureAddressRow(row: CaptureAddressResultRow): CaptureAddressRow {
  return {
    id: row.id as EmailCaptureAddressId,
    token: row.token,
    kind: row.kind as "matter" | "catchAll",
    matterId: row.matter_id === null ? null : (row.matter_id as MatterId),
    active: row.active === 1,
    createdBy: row.created_by === null ? null : (row.created_by as UserId),
    rotatedAt: row.rotated_at,
    createdAt: row.created_at,
  };
}

// One capture address by handle, whatever its state. The revoke and rotate paths read it to learn the
// token they must retire in the control plane — the caller supplies a handle, never a raw token, so a
// token value never has to travel in from the client to operate on the address it names.
export async function readCaptureAddressById(
  database: SqlDatabase,
  emailCaptureAddressId: EmailCaptureAddressId,
): Promise<CaptureAddressRow | null> {
  const { results } = await database
    .prepare(
      `SELECT ${CAPTURE_ADDRESS_COLUMNS} FROM ${EMAIL_CAPTURE_ADDRESS_TABLE} WHERE id = ?1 LIMIT 1`,
    )
    .bind(emailCaptureAddressId)
    .all<CaptureAddressResultRow>();
  const row = results[0];
  return row === undefined ? null : toCaptureAddressRow(row);
}

// Every capture address minted for one matter, live and retired, newest first. A matter holds a
// handful of these (one live address, plus whatever rotation left behind), so this is deliberately
// unpaginated — a keyset cursor would cost more than it saves at this cardinality.
export interface CaptureAddressPage {
  readonly rows: CaptureAddressRow[];
  readonly capped: boolean;
}

/**
 * How many of a matter's capture addresses one read carries.
 *
 * The list is the LIVE address plus everything it replaced — a rotation retires the old row rather
 * than deleting it, so the history is what tells a member that mail sent to last year's address
 * stopped arriving on the day it was rotated. That means the row count grows with rotations and
 * nothing in the schema bounds it: `email_capture_address` is unique on the token, not on
 * (matter, live).
 */
export const MAX_MATTER_CAPTURE_ADDRESSES = 200;

/**
 * A matter's capture addresses, newest first, capped with a signal rather than paged: this is the
 * screen where a member checks which address is in service and what became of the others, and a page
 * of it cannot answer either question.
 */
export async function readMatterCaptureAddresses(
  database: SqlDatabase,
  matterId: MatterId,
  limit: number = MAX_MATTER_CAPTURE_ADDRESSES,
): Promise<CaptureAddressPage> {
  const { results } = await database
    .prepare(
      `SELECT ${CAPTURE_ADDRESS_COLUMNS} FROM ${EMAIL_CAPTURE_ADDRESS_TABLE}
       WHERE matter_id = ?1 AND kind = 'matter'
       ORDER BY created_at DESC, id DESC
       LIMIT ?2`,
    )
    .bind(matterId, limit + 1)
    .all<CaptureAddressResultRow>();
  const capped = results.length > limit;
  return { capped, rows: (capped ? results.slice(0, limit) : results).map(toCaptureAddressRow) };
}

// The firm's live catch-all, if it has one. The catch-all has no matter, so it is found by kind — and
// only one may be live at a time, which is what makes minting a second one a conflict rather than a
// second address.
export async function readActiveCatchAllCaptureAddress(
  database: SqlDatabase,
): Promise<CaptureAddressRow | null> {
  const { results } = await database
    .prepare(
      `SELECT ${CAPTURE_ADDRESS_COLUMNS} FROM ${EMAIL_CAPTURE_ADDRESS_TABLE}
       WHERE kind = 'catchAll' AND active = 1
       ORDER BY created_at DESC, id DESC LIMIT 1`,
    )
    .all<CaptureAddressResultRow>();
  const row = results[0];
  return row === undefined ? null : toCaptureAddressRow(row);
}

// ── Reads.

export interface DedupHit {
  readonly id: EmailMessageId;
  readonly threadId: EmailThreadId;
}

// The dedup probe: does this firm already hold a message under this dedup key?
export async function findByDedupKey(
  database: SqlDatabase,
  dedupKey: string,
): Promise<DedupHit | null> {
  const { results } = await database
    .prepare(`SELECT id, thread_id FROM ${EMAIL_MESSAGE_TABLE} WHERE dedup_key = ?1`)
    .bind(dedupKey)
    .all<{ id: string; thread_id: string }>();
  const row = results[0];
  return row === undefined
    ? null
    : { id: row.id as EmailMessageId, threadId: row.thread_id as EmailThreadId };
}

// Resolve claimed ancestor Message-IDs to the threads they belong to, for thread-DAG linking. Returns
// only the ids that are known; an empty input yields an empty map (a read never throws on that).
export async function findThreadIdsByMessageIds(
  database: SqlDatabase,
  messageIdValues: readonly string[],
): Promise<Map<string, EmailThreadId>> {
  const map = new Map<string, EmailThreadId>();
  if (messageIdValues.length === 0) return map;
  const placeholders = messageIdValues.map(() => "?").join(", ");
  const { results } = await database
    .prepare(
      `SELECT message_id_value, thread_id FROM ${EMAIL_MESSAGE_TABLE}
       WHERE message_id_value IN (${placeholders})`,
    )
    .bind(...messageIdValues)
    .all<{ message_id_value: string | null; thread_id: string }>();
  for (const row of results) {
    if (row.message_id_value !== null) {
      map.set(row.message_id_value, row.thread_id as EmailThreadId);
    }
  }
  return map;
}

export interface MatterEmailListItem {
  readonly emailMessageId: EmailMessageId;
  readonly threadId: EmailThreadId;
  readonly subject: string | null;
  readonly fromDisplay: string | null;
  readonly fromAddress: string | null;
  readonly sentAt: string | null;
  readonly receivedAt: string;
  readonly linkState: "staged" | "filed" | "unlinked";
  readonly createdAt: string;
  readonly id: string; // the link id — the keyset cursor key
}

// A matter's filed emails, newest first, keyset-paginated on the link's (created_at, id). Only `filed`
// links are returned — staged captures await staff-accept and unlinked ones are gone from the matter.
export async function readMatterEmails(
  database: SqlDatabase,
  matterId: MatterId,
  cursor: string | undefined,
  pageSize: number = DEFAULT_PAGE_SIZE,
): Promise<Page<MatterEmailListItem>> {
  const conditions = [
    `${EMAIL_MATTER_LINK_TABLE}.matter_id = ?`,
    `${EMAIL_MATTER_LINK_TABLE}.state = 'filed'`,
  ];
  const bindings: unknown[] = [matterId];
  // Qualify the keyset predicate to email_matter_link — the JOIN'd email_message table also has
  // created_at/id, so the shared appendCursorPredicate's unqualified columns would be ambiguous here.
  const decoded = decodeCursor(cursor);
  if (decoded !== undefined) {
    conditions.push(
      `(${EMAIL_MATTER_LINK_TABLE}.created_at < ? OR (${EMAIL_MATTER_LINK_TABLE}.created_at = ? AND ${EMAIL_MATTER_LINK_TABLE}.id < ?))`,
    );
    bindings.push(decoded.createdAt, decoded.createdAt, decoded.id);
  }
  bindings.push(pageSize + 1);
  const { results } = await database
    .prepare(
      `SELECT ${EMAIL_MATTER_LINK_TABLE}.id AS id,
              ${EMAIL_MATTER_LINK_TABLE}.created_at AS created_at,
              ${EMAIL_MATTER_LINK_TABLE}.state AS link_state,
              ${EMAIL_MESSAGE_TABLE}.id AS email_message_id,
              ${EMAIL_MESSAGE_TABLE}.thread_id AS thread_id,
              ${EMAIL_MESSAGE_TABLE}.subject AS subject,
              ${EMAIL_MESSAGE_TABLE}.from_display AS from_display,
              ${EMAIL_MESSAGE_TABLE}.from_address AS from_address,
              ${EMAIL_MESSAGE_TABLE}.sent_at AS sent_at,
              ${EMAIL_MESSAGE_TABLE}.received_at AS received_at
       FROM ${EMAIL_MATTER_LINK_TABLE}
       JOIN ${EMAIL_MESSAGE_TABLE} ON ${EMAIL_MESSAGE_TABLE}.id = ${EMAIL_MATTER_LINK_TABLE}.email_message_id
       WHERE ${conditions.join(" AND ")}
       ORDER BY ${EMAIL_MATTER_LINK_TABLE}.created_at DESC, ${EMAIL_MATTER_LINK_TABLE}.id DESC
       LIMIT ?`,
    )
    .bind(...bindings)
    .all<{
      id: string;
      created_at: string;
      link_state: string;
      email_message_id: string;
      thread_id: string;
      subject: string | null;
      from_display: string | null;
      from_address: string | null;
      sent_at: string | null;
      received_at: string;
    }>();
  return assemblePage(results, pageSize, (row) => ({
    id: row.id,
    createdAt: row.created_at,
    linkState: row.link_state as MatterEmailListItem["linkState"],
    emailMessageId: row.email_message_id as EmailMessageId,
    threadId: row.thread_id as EmailThreadId,
    subject: row.subject,
    fromDisplay: row.from_display,
    fromAddress: row.from_address,
    sentAt: row.sent_at,
    receivedAt: row.received_at,
  }));
}

export interface ThreadMessage {
  readonly emailMessageId: EmailMessageId;
  readonly subject: string | null;
  readonly fromDisplay: string | null;
  readonly fromAddress: string | null;
  readonly inReplyTo: string | null;
  readonly sentAt: string | null;
  readonly receivedAt: string;
}

// Every message in one thread, oldest first — the DAG a thread view walks.
export async function readThreadMessages(
  database: SqlDatabase,
  threadId: EmailThreadId,
): Promise<ThreadMessage[]> {
  const { results } = await database
    .prepare(
      `SELECT id, subject, from_display, from_address, in_reply_to, sent_at, received_at
       FROM ${EMAIL_MESSAGE_TABLE} WHERE thread_id = ?1 ORDER BY received_at ASC, id ASC`,
    )
    .bind(threadId)
    .all<{
      id: string;
      subject: string | null;
      from_display: string | null;
      from_address: string | null;
      in_reply_to: string | null;
      sent_at: string | null;
      received_at: string;
    }>();
  return results.map((row) => ({
    emailMessageId: row.id as EmailMessageId,
    subject: row.subject,
    fromDisplay: row.from_display,
    fromAddress: row.from_address,
    inReplyTo: row.in_reply_to,
    sentAt: row.sent_at,
    receivedAt: row.received_at,
  }));
}

// Every matter a message is filed to. The caller (the route) applies the ethical-wall filter to this
// set and reports only the matters the requester can access alongside a bare count of the rest — so the
// multi-matter "also on ..." list and the "already filed" signal never name a walled matter. Keeping
// the wall filter in the auth layer (not here) is what makes this read reusable by both the visible and
// the walled caller.
export async function filedMatterIdsForMessage(
  database: SqlDatabase,
  emailMessageId: EmailMessageId,
): Promise<MatterId[]> {
  const { results } = await database
    .prepare(
      `SELECT matter_id FROM ${EMAIL_MATTER_LINK_TABLE}
       WHERE email_message_id = ?1 AND state = 'filed' ORDER BY created_at ASC, id ASC`,
    )
    .bind(emailMessageId)
    .all<{ matter_id: string }>();
  return results.map((row) => row.matter_id as MatterId);
}

export interface EmailMatterLinkState {
  readonly matterId: MatterId;
  readonly state: "staged" | "filed" | "unlinked";
  // Whether a rule made this link. The distinction between a person's decision and a machine's is the
  // whole input to the guardrail that forbids a rule contradicting a person, so it is read here rather
  // than inferred from anything else.
  readonly automatic: boolean;
}

// EVERY link the message carries, in every state — not just the filed ones. The unlinked rows are the
// load-bearing ones: a message somebody deliberately removed from a matter must never be put back by a
// rule, and a row in `unlinked` is the only record that they did. One index walk on
// (email_message_id), bounded by how many matters one message is on.
export async function readEmailMatterLinksForMessage(
  database: SqlDatabase,
  emailMessageId: EmailMessageId,
): Promise<EmailMatterLinkState[]> {
  const { results } = await database
    .prepare(
      `SELECT matter_id, state, auto_file_rule_id FROM ${EMAIL_MATTER_LINK_TABLE}
       WHERE email_message_id = ?1 ORDER BY created_at ASC, id ASC`,
    )
    .bind(emailMessageId)
    .all<{ matter_id: string; state: string; auto_file_rule_id: string | null }>();
  return results.map((row) => ({
    matterId: row.matter_id as MatterId,
    state: row.state as "staged" | "filed" | "unlinked",
    automatic: row.auto_file_rule_id !== null,
  }));
}

// Does this firm hold a message under this dedup key, and if so which message? The "already filed"
// probe resolves the message, then filedMatterIdsForMessage + the wall filter produce the wall-safe
// answer. A miss means the firm has not captured it.
export async function findMessageIdByDedupKey(
  database: SqlDatabase,
  dedupKey: string,
): Promise<EmailMessageId | null> {
  const hit = await findByDedupKey(database, dedupKey);
  return hit === null ? null : hit.id;
}

// The "already filed" probe by the Message-ID the caller already holds (the add-in reads it off the
// open message). Matches any provenance — a header-sourced and a MAPI-sourced copy of the same logical
// mail both answer "yes, captured". Returns the message id, or null when the firm has not captured it.
export async function findByMessageIdValue(
  database: SqlDatabase,
  messageIdValue: string,
): Promise<EmailMessageId | null> {
  const { results } = await database
    .prepare(`SELECT id FROM ${EMAIL_MESSAGE_TABLE} WHERE message_id_value = ?1 LIMIT 1`)
    .bind(messageIdValue)
    .all<{ id: string }>();
  return results[0] === undefined ? null : (results[0].id as EmailMessageId);
}

// The "already filed" probe by content hash (the raw-bytes SHA-256), for a caller who has the bytes but
// no usable Message-ID.
export async function findByContentSha256(
  database: SqlDatabase,
  contentSha256: string,
): Promise<EmailMessageId | null> {
  const { results } = await database
    .prepare(`SELECT id FROM ${EMAIL_MESSAGE_TABLE} WHERE content_sha256 = ?1 LIMIT 1`)
    .bind(contentSha256)
    .all<{ id: string }>();
  return results[0] === undefined ? null : (results[0].id as EmailMessageId);
}

export interface MessageDetail {
  readonly emailMessageId: EmailMessageId;
  readonly threadId: EmailThreadId;
  readonly subject: string | null;
  readonly fromDisplay: string | null;
  readonly fromAddress: string | null;
  readonly sentAt: string | null;
  readonly receivedAt: string;
  readonly dkimVerdict: string;
  readonly dkimVerdictReason: string | null;
  readonly dkimVerifiedDomain: string | null;
  readonly participants: {
    readonly kind: string;
    readonly displayName: string | null;
    readonly address: string | null;
    readonly directoryEntityId: string | null;
  }[];
}

// One message with its participants — the payload for a single-message read (the "also on ..." list is
// assembled separately from filedMatterIdsForMessage + the wall filter). Null when unknown.
export async function readMessageById(
  database: SqlDatabase,
  emailMessageId: EmailMessageId,
): Promise<MessageDetail | null> {
  const messageResult = await database
    .prepare(
      `SELECT id, thread_id, subject, from_display, from_address, sent_at, received_at, dkim_verdict,
              dkim_verdict_reason, dkim_verified_domain
       FROM ${EMAIL_MESSAGE_TABLE} WHERE id = ?1`,
    )
    .bind(emailMessageId)
    .all<{
      id: string;
      thread_id: string;
      subject: string | null;
      from_display: string | null;
      from_address: string | null;
      sent_at: string | null;
      received_at: string;
      dkim_verdict: string;
      dkim_verdict_reason: string | null;
      dkim_verified_domain: string | null;
    }>();
  const message = messageResult.results[0];
  if (message === undefined) return null;
  const participantResult = await database
    .prepare(
      `SELECT kind, display_name, address, directory_entity_id FROM ${EMAIL_PARTICIPANT_TABLE}
       WHERE email_message_id = ?1 ORDER BY id ASC`,
    )
    .bind(emailMessageId)
    .all<{
      kind: string;
      display_name: string | null;
      address: string | null;
      directory_entity_id: string | null;
    }>();
  return {
    emailMessageId: message.id as EmailMessageId,
    threadId: message.thread_id as EmailThreadId,
    subject: message.subject,
    fromDisplay: message.from_display,
    fromAddress: message.from_address,
    sentAt: message.sent_at,
    receivedAt: message.received_at,
    dkimVerdict: message.dkim_verdict,
    dkimVerdictReason: message.dkim_verdict_reason,
    dkimVerifiedDomain: message.dkim_verified_domain,
    participants: participantResult.results.map((row) => ({
      kind: row.kind,
      displayName: row.display_name,
      address: row.address,
      directoryEntityId: row.directory_entity_id,
    })),
  };
}

export interface CaptureAddressResolution {
  readonly kind: "matter" | "catchAll";
  readonly matterId: MatterId | null;
}

// Resolve an active forward/CC capture token to its kind + candidate matter. Inactive/unknown → null.
export async function findCaptureAddressByToken(
  database: SqlDatabase,
  token: string,
): Promise<CaptureAddressResolution | null> {
  const { results } = await database
    .prepare(
      `SELECT kind, matter_id FROM ${EMAIL_CAPTURE_ADDRESS_TABLE} WHERE token = ?1 AND active = 1`,
    )
    .bind(token)
    .all<{ kind: string; matter_id: string | null }>();
  const row = results[0];
  return row === undefined
    ? null
    : {
        kind: row.kind as "matter" | "catchAll",
        matterId: row.matter_id === null ? null : (row.matter_id as MatterId),
      };
}

// ── The mail-client reads: where to file, what happened to a filing, what to show the member.

export interface ThreadMatterHit {
  readonly matterId: MatterId;
  readonly threadId: EmailThreadId;
  readonly lastFiledAt: string;
}

// The matters an already-captured conversation is filed to. The strongest "where does this belong"
// signal a message carries: it answers a thread the firm has already placed. Two index walks in one
// statement — email_message_thread_id_index selects the thread's messages,
// email_matter_link_email_message_id_index joins each to its links — and the whole thread collapses to
// one row per matter here rather than one round trip per message in the caller.
export async function readFiledMattersForThreads(
  database: SqlDatabase,
  threadIds: readonly EmailThreadId[],
): Promise<ThreadMatterHit[]> {
  if (threadIds.length === 0) return [];
  const placeholders = threadIds.map(() => "?").join(", ");
  const { results } = await database
    .prepare(
      `SELECT ${EMAIL_MATTER_LINK_TABLE}.matter_id AS matter_id,
              ${EMAIL_MESSAGE_TABLE}.thread_id AS thread_id,
              MAX(${EMAIL_MATTER_LINK_TABLE}.created_at) AS last_filed_at
       FROM ${EMAIL_MESSAGE_TABLE}
       JOIN ${EMAIL_MATTER_LINK_TABLE}
         ON ${EMAIL_MATTER_LINK_TABLE}.email_message_id = ${EMAIL_MESSAGE_TABLE}.id
       WHERE ${EMAIL_MESSAGE_TABLE}.thread_id IN (${placeholders})
         AND ${EMAIL_MATTER_LINK_TABLE}.state = 'filed'
       GROUP BY ${EMAIL_MATTER_LINK_TABLE}.matter_id, ${EMAIL_MESSAGE_TABLE}.thread_id
       ORDER BY last_filed_at DESC`,
    )
    .bind(...threadIds)
    .all<{ matter_id: string; thread_id: string; last_filed_at: string }>();
  return results.map((row) => ({
    matterId: row.matter_id as MatterId,
    threadId: row.thread_id as EmailThreadId,
    lastFiledAt: row.last_filed_at,
  }));
}

export interface RecentFilingTarget {
  readonly matterId: MatterId;
  readonly lastFiledAt: string;
  readonly filedCount: number;
}

// The matters this member has most recently filed email to — the add-in's quick-pick list, and the
// honest answer to "where do I usually put this". Served by the (linked_by, created_at, id) index, so
// it is a bounded index walk over one member's own filings rather than a scan of the firm's.
//
// Deliberately per-member rather than firm-wide: a shortcut list is a personal working set, and a
// firm-wide one would quietly surface which matters other people are active on.
export async function readRecentFilingTargets(
  database: SqlDatabase,
  linkedBy: UserId,
  limit: number,
): Promise<RecentFilingTarget[]> {
  const { results } = await database
    .prepare(
      `SELECT matter_id, MAX(created_at) AS last_filed_at, COUNT(*) AS filed_count
       FROM ${EMAIL_MATTER_LINK_TABLE}
       WHERE linked_by = ?1 AND state = 'filed'
       GROUP BY matter_id
       ORDER BY last_filed_at DESC
       LIMIT ?2`,
    )
    .bind(linkedBy, limit)
    .all<{ matter_id: string; last_filed_at: string; filed_count: number }>();
  return results.map((row) => ({
    matterId: row.matter_id as MatterId,
    lastFiledAt: row.last_filed_at,
    filedCount: row.filed_count,
  }));
}

// The live per-matter capture addresses for a bounded set of matters, in one walk of
// email_capture_address_matter_id_index. The caller passes the matters it is about to report on, so
// this never grows with the firm's matter count.
export async function readLiveCaptureAddressesForMatters(
  database: SqlDatabase,
  matterIds: readonly MatterId[],
): Promise<CaptureAddressRow[]> {
  if (matterIds.length === 0) return [];
  const placeholders = matterIds.map(() => "?").join(", ");
  const { results } = await database
    .prepare(
      `SELECT ${CAPTURE_ADDRESS_COLUMNS} FROM ${EMAIL_CAPTURE_ADDRESS_TABLE}
       WHERE matter_id IN (${placeholders}) AND kind = 'matter' AND active = 1
       ORDER BY created_at DESC, id DESC`,
    )
    .bind(...matterIds)
    .all<CaptureAddressResultRow>();
  return results.map(toCaptureAddressRow);
}

// The idempotency key the capture consumer commits its record under, and the key a status read looks
// the outcome up by. One home for the prefix: the writer and the reader cannot drift onto different
// keys, which would silently turn every status read into "still working".
export function captureIdempotencyKey(jobId: string): string {
  return `capture:${jobId}`;
}

// What a capture job produced, as the consumer recorded it. Every field is an identifier or an
// enum — no subject, no addresses, no body — because this rides an idempotency record, which is
// ephemeral dedup state read by more paths than the message row itself.
export interface CaptureOutcome {
  readonly emailMessageId: EmailMessageId;
  readonly threadId: EmailThreadId;
  readonly matterId: MatterId | null;
  readonly linkState: "staged" | "filed" | "none";
  // True when the firm already held this message and the capture converged on the existing record
  // instead of writing a second one.
  readonly deduplicated: boolean;
}

// Read a capture job's outcome, or null when the consumer has not finished it (or the record has aged
// out of the idempotency table's retention). A null is deliberately indistinguishable between "still
// running" and "long finished and swept": both mean the same thing to a caller — this read cannot
// tell you, ask the message instead.
export async function readCaptureOutcome(
  database: SqlDatabase,
  jobId: string,
): Promise<CaptureOutcome | null> {
  const { results } = await selectIdempotencyRecordStatement(
    database,
    captureIdempotencyKey(jobId),
  ).all<{ status: string; response_body: string | null }>();
  const row = results[0];
  if (row === undefined || row.status !== "completed" || row.response_body === null) return null;
  const parsed: unknown = JSON.parse(row.response_body);
  if (typeof parsed !== "object" || parsed === null) return null;
  const record = parsed as Record<string, unknown>;
  if (typeof record.emailMessageId !== "string" || typeof record.threadId !== "string") return null;
  return {
    emailMessageId: record.emailMessageId as EmailMessageId,
    threadId: record.threadId as EmailThreadId,
    matterId: typeof record.matterId === "string" ? (record.matterId as MatterId) : null,
    linkState:
      record.linkState === "filed" || record.linkState === "staged" ? record.linkState : "none",
    deduplicated: record.deduplicated === true,
  };
}
