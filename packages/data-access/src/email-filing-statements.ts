import type {
  EmailAttachmentId,
  EmailCaptureAddressId,
  EmailMatterLinkId,
  EmailMessageId,
  EmailParticipantId,
  EmailThreadId,
  MatterId,
  UserId,
} from "@magna-carta/identifiers/types";
import {
  appendCursorPredicate,
  assemblePage,
  decodeCursor,
  DEFAULT_PAGE_SIZE,
  type Page,
} from "./cursor-pagination.ts";
import type { SqlDatabase, SqlStatement } from "./idempotency-statements.ts";

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
          references_remote_content, integrity, dkim_verdict, source_format, captured_via,
          created_at, updated_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19, ?19)`,
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
         (id, email_message_id, matter_id, state, linked_by, linked_at, captured_via, created_at, updated_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?8)
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
  const conditions = [`${EMAIL_MATTER_LINK_TABLE}.matter_id = ?`, `${EMAIL_MATTER_LINK_TABLE}.state = 'filed'`];
  const bindings: unknown[] = [matterId];
  appendCursorPredicate(conditions, bindings, decodeCursor(cursor));
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

// The wall-safe multi-matter visibility read. For one captured message it returns the matters it is
// filed to that the caller can access, plus the TOTAL number of filed matters — so a caller can be told
// "also on 2 you can see (and 1 more)" without ever learning the identity of a matter they are walled
// from. `accessibleMatterIds` is the set the caller may see; the query returns no matter outside it.
export interface MessageVisibility {
  readonly accessibleMatterIds: MatterId[];
  readonly totalFiledCount: number;
}

export async function mattersForMessageVisibleTo(
  database: SqlDatabase,
  emailMessageId: EmailMessageId,
  accessibleMatterIds: readonly MatterId[],
): Promise<MessageVisibility> {
  const totalRow = await database
    .prepare(
      `SELECT COUNT(*) AS n FROM ${EMAIL_MATTER_LINK_TABLE}
       WHERE email_message_id = ?1 AND state = 'filed'`,
    )
    .bind(emailMessageId)
    .all<{ n: number }>();
  const totalFiledCount = totalRow.results[0]?.n ?? 0;
  if (accessibleMatterIds.length === 0) {
    return { accessibleMatterIds: [], totalFiledCount };
  }
  const placeholders = accessibleMatterIds.map(() => "?").join(", ");
  const { results } = await database
    .prepare(
      `SELECT matter_id FROM ${EMAIL_MATTER_LINK_TABLE}
       WHERE email_message_id = ? AND state = 'filed' AND matter_id IN (${placeholders})`,
    )
    .bind(emailMessageId, ...accessibleMatterIds)
    .all<{ matter_id: string }>();
  return {
    accessibleMatterIds: results.map((row) => row.matter_id as MatterId),
    totalFiledCount,
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
