import {
  appendCursorPredicate,
  DEFAULT_PAGE_SIZE,
  type CompositeSortCursor,
  type SortCursor,
} from "@magna-carta/data-access/cursor-pagination";
// (appendCursorPredicate still serves the turn listing below; the conversation listing spells its
// own predicate because its columns are qualified by the join alias.)
import type { SqlDatabase, SqlStatement } from "@magna-carta/data-access/idempotency-statements";
import { askableTerm, likePattern, LIKE_ESCAPE_CLAUSE } from "@magna-carta/data-access/like-search";
import type {
  FileId,
  MagnusConversationId,
  MagnusFolderId,
  MagnusTurnId,
  MatterId,
  UserId,
} from "@magna-carta/identifiers/types";
import { CONVERSATION_ATTACHMENTS_MAX } from "./limits.ts";
import type {
  AttachmentTextStatus,
  ConversationAttachmentRow,
  ConversationRow,
  ConversationSort,
  ConversationState,
  MemberAcknowledgementRow,
  TurnFailureLabel,
  TurnRow,
  TurnSpeaker,
  TurnStatus,
} from "./types.ts";

// SQL statement builders for the four Magnus tables. Table names are tracked against
// @magna-carta/database's per-firm schema by the schema-name-sync fitness test. This module composes
// statements and runs bounded reads; it holds no binding and crosses no firm — the caller supplies
// the firm-scoped database handle.
//
// Every read is LIMITed. There is no statement here that can return a whole conversation.
export const MAGNUS_CONVERSATION_TABLE = "magnus_conversation";
export const MAGNUS_TURN_TABLE = "magnus_turn";
export const MAGNUS_MEMBER_ACKNOWLEDGEMENT_TABLE = "magnus_member_acknowledgement";
export const MAGNUS_CONVERSATION_ATTACHMENT_TABLE = "magnus_conversation_attachment";

// Two tables this module READS and never writes, by their names in the per-firm schema: the matter a
// conversation is kept on (for the matter-ordered listing, which orders by the matter's title) and
// the file an attachment points at (for its name and its current version). Reading them here rather
// than importing their owning packages keeps this package on its pure seam; the columns named are the
// ones those tables have carried since their baseline.
const MATTER_TABLE = "matter";
const FILE_TABLE = "file";
const FILE_VERSION_TABLE = "file_version";
// Where a member keeps each conversation (./shelf.ts owns it). Spelled here rather than imported
// because shelf.ts composes conversation writes and this module must stay below it.
const SHELF_TABLE = "magnus_conversation_shelf";

interface ConversationDatabaseRow {
  id: string;
  title: string | null;
  created_by: string;
  matter_id: string | null;
  state: string;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

interface TurnDatabaseRow {
  id: string;
  conversation_id: string;
  sequence: number;
  speaker: string;
  content: string | null;
  status: string;
  failure_label: string | null;
  model_id: string | null;
  snapshot_id: string | null;
  input_tokens: number | null;
  output_tokens: number | null;
  context_truncated: number;
  effort: string | null;
  removed_at: string | null;
  superseded_at: string | null;
  replaces_turn_id: string | null;
  created_at: string;
  completed_at: string | null;
}

function toConversationRow(row: ConversationDatabaseRow): ConversationRow {
  return {
    id: row.id as MagnusConversationId,
    title: row.title,
    createdBy: row.created_by as UserId,
    matterId: row.matter_id as MatterId | null,
    state: row.state as ConversationState,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at,
  };
}

function toTurnRow(row: TurnDatabaseRow): TurnRow {
  return {
    id: row.id as MagnusTurnId,
    conversationId: row.conversation_id as MagnusConversationId,
    sequence: row.sequence,
    speaker: row.speaker as TurnSpeaker,
    content: row.content,
    status: row.status as TurnStatus,
    failureLabel: row.failure_label as TurnFailureLabel | null,
    modelId: row.model_id,
    snapshotId: row.snapshot_id,
    inputTokens: row.input_tokens,
    outputTokens: row.output_tokens,
    contextTruncated: row.context_truncated === 1,
    effort: row.effort,
    removedAt: row.removed_at,
    supersededAt: row.superseded_at,
    replacesTurnId: row.replaces_turn_id as MagnusTurnId | null,
    createdAt: row.created_at,
    completedAt: row.completed_at,
  };
}

export interface InsertConversationRow {
  readonly id: MagnusConversationId;
  readonly title: string | null;
  readonly createdBy: UserId;
  readonly matterId: MatterId | null;
  readonly createdAt: string;
}

export function insertConversationStatement(
  database: SqlDatabase,
  row: InsertConversationRow,
): SqlStatement {
  return database
    .prepare(
      `INSERT INTO ${MAGNUS_CONVERSATION_TABLE} (id, title, created_by, matter_id, state, created_at, updated_at, deleted_at) VALUES (?1, ?2, ?3, ?4, 'active', ?5, ?5, NULL)`,
    )
    .bind(row.id, row.title, row.createdBy, row.matterId, row.createdAt);
}

// Rename. Guarded on `state = 'active'` so a deleted or archived conversation cannot be edited back
// into the firm's view by a caller holding a stale identifier.
export function renameConversationStatement(
  database: SqlDatabase,
  options: {
    readonly id: MagnusConversationId;
    readonly title: string | null;
    readonly now: string;
  },
): SqlStatement {
  return database
    .prepare(
      `UPDATE ${MAGNUS_CONVERSATION_TABLE} SET title = ?2, updated_at = ?3 WHERE id = ?1 AND state = 'active'`,
    )
    .bind(options.id, options.title, options.now);
}

export function archiveConversationStatement(
  database: SqlDatabase,
  options: { readonly id: MagnusConversationId; readonly now: string },
): SqlStatement {
  return database
    .prepare(
      `UPDATE ${MAGNUS_CONVERSATION_TABLE} SET state = 'archived', updated_at = ?2 WHERE id = ?1 AND state = 'active'`,
    )
    .bind(options.id, options.now);
}

// Deletion is the erasure instrument for everything a member typed: the turn rows go, and the
// conversation becomes a tombstone recording that a conversation existed and was deleted — never what
// was in it. The two statements ride one batch, so a half-deleted conversation is unrepresentable.
export function deleteConversationTurnsStatement(
  database: SqlDatabase,
  conversationId: MagnusConversationId,
): SqlStatement {
  return database
    .prepare(`DELETE FROM ${MAGNUS_TURN_TABLE} WHERE conversation_id = ?1`)
    .bind(conversationId);
}

// fitness:unguarded-write — deleting a conversation already deleted is the state the caller asked for
export function markConversationDeletedStatement(
  database: SqlDatabase,
  options: { readonly id: MagnusConversationId; readonly now: string },
): SqlStatement {
  return database
    .prepare(
      `UPDATE ${MAGNUS_CONVERSATION_TABLE} SET state = 'deleted', title = NULL, updated_at = ?2, deleted_at = ?2 WHERE id = ?1 AND state <> 'deleted'`,
    )
    .bind(options.id, options.now);
}

export async function readConversation(
  database: SqlDatabase,
  id: MagnusConversationId,
): Promise<ConversationRow | undefined> {
  const { results } = await database
    .prepare(
      `SELECT id, title, created_by, matter_id, state, created_at, updated_at, deleted_at FROM ${MAGNUS_CONVERSATION_TABLE} WHERE id = ?1 LIMIT 1`,
    )
    .bind(id)
    .all<ConversationDatabaseRow>();
  const row = results[0];
  return row === undefined ? undefined : toConversationRow(row);
}

// Re-pointing a conversation at another matter, or at none. Guarded on `state = 'active'` like a
// rename: a deleted or archived conversation is not moved back into anybody's view.
export function moveConversationStatement(
  database: SqlDatabase,
  options: {
    readonly id: MagnusConversationId;
    readonly matterId: MatterId | null;
    readonly now: string;
  },
): SqlStatement {
  return database
    .prepare(
      `UPDATE ${MAGNUS_CONVERSATION_TABLE} SET matter_id = ?2, updated_at = ?3 WHERE id = ?1 AND state = 'active'`,
    )
    .bind(options.id, options.matterId, options.now);
}

export interface ListConversationsOptions {
  // Absent = every member's conversations (the administrative read); present = one member's own.
  readonly createdBy?: UserId;
  // Present = only the conversations kept on one matter's file. Absent = every conversation the
  // other conditions allow, whether it names a matter or not — never "the ones on no matter", which
  // is a third question nothing asks.
  readonly matterId?: MatterId;
  /**
   * Narrows to the conversations a query reaches. It matches the TITLE always, and what was SAID —
   * the turn content — only when `createdBy` names a member, which is what keeps this from becoming
   * the cross-record transcript sweep this package's CLAUDE.md prohibits until the discovery
   * surface owns an include-or-exclude control for it. The administrative read (`createdBy` absent)
   * therefore searches titles alone, and `searchesContent` below reports which of the two ran so a
   * caller never has to re-derive it.
   *
   * Searching titles alone would be close to useless here: nothing generates a title, so most
   * conversations have none and a member looking for "the one about the Henderson lease" is looking
   * for words they typed, not words they named.
   */
  readonly search?: string;
  // The order the page is read in. `date` (the default) pages on the ordinary (created_at, id)
  // cursor; `name` and `matter` page on a composite cursor whose primary is the sort key below.
  readonly sort?: ConversationSort;
  readonly cursor?: SortCursor | CompositeSortCursor;
  readonly limit?: number;
  /**
   * Whose shelf each row is read against: the folder it sits in and whether it is pinned are that
   * member's, never the author's (./shelf.ts). Absent = no shelf is read and every row reads as
   * General and unpinned, which is the administrative read across members.
   */
  readonly shelfMember?: UserId;
  // Narrows to one of the shelf member's folders, or to General (no folder). Needs `shelfMember`.
  readonly folder?: MagnusFolderId | "general";
  // Narrows to the conversations the shelf member has pinned. Needs `shelfMember`.
  readonly pinnedOnly?: boolean;
}

/**
 * Whether a search over these options reaches turn content, or titles alone. One place, because the
 * rule is a confidentiality boundary rather than a detail: a surface that told a member it had
 * searched what they said, having searched only titles, would be lying about a null result.
 */
export function searchesContent(options: ListConversationsOptions): boolean {
  return options.search !== undefined && options.search !== "" && options.createdBy !== undefined;
}

// A listed conversation carries the key it was ordered by, so the caller can mint the next cursor
// without knowing how the key is composed. For the date order it is simply `createdAt`.
export interface ListedConversationRow extends ConversationRow {
  readonly sortKey: string;
  // Where the shelf member keeps it: null folder is General, null pin is not pinned.
  readonly folderId: MagnusFolderId | null;
  readonly pinnedAt: string | null;
}

// THE SORT KEYS, as SQL expressions over the joined row. Each is ONE string so the keyset can compare
// it in a single column, and each is arranged so the rows a reader wants together come together:
//
//   name   — a named conversation orders by its lower-cased title; an unnamed one READS as the
//            instant it started (nothing generates a title), so it orders by that instant, after
//            every named one. The leading digit is what puts the two groups in that order.
//   matter — a conversation on a matter orders by that matter's title, with the matter's own
//            identifier appended so two matters with one title still group apart; a conversation on
//            no matter comes after every one that has one.
//
// Within one key the order is newest first, the same as the date order, which is what the mixed
// keyset below compares.
const NAME_SORT_KEY = `CASE WHEN c.title IS NULL OR trim(c.title) = '' THEN '1' || c.created_at ELSE '0' || lower(c.title) END`;
const MATTER_SORT_KEY = `CASE WHEN c.matter_id IS NULL THEN '1' ELSE '0' || lower(COALESCE(m.title, '')) || ' ' || c.matter_id END`;

function sortKeyExpression(sort: ConversationSort): string | null {
  if (sort === "name") return NAME_SORT_KEY;
  if (sort === "matter") return MATTER_SORT_KEY;
  return null;
}

// True when a cursor carries the composite shape the name and matter orders page on.
function isCompositeCursor(
  cursor: SortCursor | CompositeSortCursor | undefined,
): cursor is CompositeSortCursor {
  return cursor !== undefined && "primary" in cursor;
}

export async function listConversations(
  database: SqlDatabase,
  options: ListConversationsOptions,
): Promise<readonly ListedConversationRow[]> {
  const conditions: string[] = ["c.state <> 'deleted'"];
  const bindings: unknown[] = [];
  const shelfMember = options.shelfMember;
  if (shelfMember !== undefined) {
    if (options.folder === "general") conditions.push("s.folder_id IS NULL");
    else if (options.folder !== undefined) {
      conditions.push("s.folder_id = ?");
      bindings.push(options.folder);
    }
    if (options.pinnedOnly === true) conditions.push("s.pinned_at IS NOT NULL");
  }
  if (options.createdBy !== undefined) {
    conditions.push("c.created_by = ?");
    bindings.push(options.createdBy);
  }
  if (options.matterId !== undefined) {
    conditions.push("c.matter_id = ?");
    bindings.push(options.matterId);
  }
  const term = askableTerm(options.search);
  if (term !== undefined) {
    const pattern = likePattern(term);
    if (searchesContent(options)) {
      // The member's own conversations, so what they SAID is in scope. The EXISTS is correlated
      // rather than a join: a conversation matches once however many of its turns match, and a join
      // would have to de-duplicate the conversation row before the limit could be applied — which
      // the sort orders below could not then page over.
      conditions.push(
        `(c.title LIKE ? ${LIKE_ESCAPE_CLAUSE} OR EXISTS (SELECT 1 FROM ${MAGNUS_TURN_TABLE} ` +
          `WHERE ${MAGNUS_TURN_TABLE}.conversation_id = c.id ` +
          `AND ${MAGNUS_TURN_TABLE}.content LIKE ? ${LIKE_ESCAPE_CLAUSE}))`,
      );
      bindings.push(pattern, pattern);
    } else {
      // The administrative read. Titles only — see `search` on the options above.
      conditions.push(`c.title LIKE ? ${LIKE_ESCAPE_CLAUSE}`);
      bindings.push(pattern);
    }
  }
  const sort = options.sort ?? "date";
  const keyExpression = sortKeyExpression(sort);
  const cursor = options.cursor;
  let orderBy: string;
  if (keyExpression === null) {
    // The date order: the ordinary keyset over (created_at, id). A composite cursor minted under a
    // different order is not honoured here; it reads as the first page rather than a wrong one.
    if (cursor !== undefined && !isCompositeCursor(cursor)) {
      conditions.push("(c.created_at < ? OR (c.created_at = ? AND c.id < ?))");
      bindings.push(cursor.createdAt, cursor.createdAt, cursor.id);
    }
    orderBy = "c.created_at DESC, c.id DESC";
  } else {
    // The MIXED keyset: the sort key ascends while the instant and the identifier beneath it descend,
    // so a page boundary falls exactly where the ORDER BY would put it. The data-access composite
    // predicate runs every part one way, which would put the oldest conversation first within a
    // name; this spells the three parts out so the direction can differ per part.
    if (isCompositeCursor(cursor)) {
      conditions.push(
        `((${keyExpression}) > ? OR ((${keyExpression}) = ? AND c.created_at < ?) OR ((${keyExpression}) = ? AND c.created_at = ? AND c.id < ?))`,
      );
      bindings.push(
        cursor.primary,
        cursor.primary,
        cursor.secondary,
        cursor.primary,
        cursor.secondary,
        cursor.id,
      );
    }
    orderBy = `sort_key ASC, c.created_at DESC, c.id DESC`;
  }
  const limit = options.limit ?? DEFAULT_PAGE_SIZE;
  bindings.push(limit);
  const matterJoin = sort === "matter" ? `LEFT JOIN ${MATTER_TABLE} m ON m.id = c.matter_id` : "";
  // The shelf is an OUTER join on the reader: a conversation nobody has moved or pinned has no row
  // and must still list, in General. Without a shelf member the join matches nothing, so every row
  // reads as General and unpinned. Its one binding comes first because the join precedes the WHERE.
  const shelfJoin = `LEFT JOIN ${SHELF_TABLE} s ON s.conversation_id = c.id AND s.member_id = ?`;
  const { results } = await database
    .prepare(
      `SELECT c.id, c.title, c.created_by, c.matter_id, c.state, c.created_at, c.updated_at, c.deleted_at, s.folder_id, s.pinned_at, ${keyExpression ?? "c.created_at"} AS sort_key FROM ${MAGNUS_CONVERSATION_TABLE} c ${matterJoin} ${shelfJoin} WHERE ${conditions.join(" AND ")} ORDER BY ${orderBy} LIMIT ?`,
    )
    .bind(shelfMember ?? null, ...bindings)
    .all<
      ConversationDatabaseRow & {
        sort_key: string;
        folder_id: string | null;
        pinned_at: string | null;
      }
    >();
  return results.map((row) => ({
    ...toConversationRow(row),
    sortKey: row.sort_key,
    folderId: row.folder_id as MagnusFolderId | null,
    pinnedAt: row.pinned_at,
  }));
}

// ---------------------------------------------------------------------------------------------
// Attachments: a matter's files, attached to a conversation by reference.

interface AttachmentDatabaseRow {
  conversation_id: string;
  file_id: string;
  attached_at: string;
  text_status: string;
  text_bytes: number | null;
}

function toAttachmentRow(row: AttachmentDatabaseRow): ConversationAttachmentRow {
  return {
    conversationId: row.conversation_id as MagnusConversationId,
    fileId: row.file_id as FileId,
    attachedAt: row.attached_at,
    textStatus: row.text_status as AttachmentTextStatus,
    textBytes: row.text_bytes,
  };
}

// Attaching is idempotent on the pair: a retried attach of the same file to the same conversation is
// the same attachment, not a second row.
export function insertAttachmentStatement(
  database: SqlDatabase,
  row: {
    readonly conversationId: MagnusConversationId;
    readonly fileId: FileId;
    readonly attachedAt: string;
  },
): SqlStatement {
  return database
    .prepare(
      `INSERT INTO ${MAGNUS_CONVERSATION_ATTACHMENT_TABLE} (conversation_id, file_id, attached_at, text_status, text_bytes) VALUES (?1, ?2, ?3, 'pending', NULL) ON CONFLICT(conversation_id, file_id) DO NOTHING`,
    )
    .bind(row.conversationId, row.fileId, row.attachedAt);
}

// fitness:unguarded-write — matches a set rather than one row, so zero is an empty set rather than a refusal
export function deleteAttachmentStatement(
  database: SqlDatabase,
  options: { readonly conversationId: MagnusConversationId; readonly fileId: FileId },
): SqlStatement {
  return database
    .prepare(
      `DELETE FROM ${MAGNUS_CONVERSATION_ATTACHMENT_TABLE} WHERE conversation_id = ?1 AND file_id = ?2`,
    )
    .bind(options.conversationId, options.fileId);
}

// Every attachment goes with its conversation: on a delete, and on a move, because an attachment is
// one of the OLD matter's files and a conversation kept elsewhere has no claim on it.
export function deleteConversationAttachmentsStatement(
  database: SqlDatabase,
  conversationId: MagnusConversationId,
): SqlStatement {
  return database
    .prepare(`DELETE FROM ${MAGNUS_CONVERSATION_ATTACHMENT_TABLE} WHERE conversation_id = ?1`)
    .bind(conversationId);
}

// What the consumer records after a question: how much of each attachment's text reached the model.
// fitness:unguarded-write — matches a set rather than one row, so zero is an empty set rather than a refusal
export function markAttachmentTextStatement(
  database: SqlDatabase,
  options: {
    readonly conversationId: MagnusConversationId;
    readonly fileId: FileId;
    readonly textStatus: AttachmentTextStatus;
    readonly textBytes: number | null;
  },
): SqlStatement {
  return database
    .prepare(
      `UPDATE ${MAGNUS_CONVERSATION_ATTACHMENT_TABLE} SET text_status = ?3, text_bytes = ?4 WHERE conversation_id = ?1 AND file_id = ?2`,
    )
    .bind(options.conversationId, options.fileId, options.textStatus, options.textBytes);
}

// A conversation's attachments, oldest first. Bounded by the attachment cap itself: a conversation
// can never carry more rows than this read returns.
export async function listAttachments(
  database: SqlDatabase,
  conversationId: MagnusConversationId,
): Promise<readonly ConversationAttachmentRow[]> {
  const { results } = await database
    .prepare(
      `SELECT conversation_id, file_id, attached_at, text_status, text_bytes FROM ${MAGNUS_CONVERSATION_ATTACHMENT_TABLE} WHERE conversation_id = ?1 ORDER BY attached_at ASC, file_id ASC LIMIT ?2`,
    )
    .bind(conversationId, CONVERSATION_ATTACHMENTS_MAX)
    .all<AttachmentDatabaseRow>();
  return results.map(toAttachmentRow);
}

// An attachment as a surface names it, and as the consumer reads it: the file's own name and the
// matter it belongs to, and the current clean version's storage key and content type. A file that
// has been deleted since, or has no committed version, comes back with those facts null, which is
// what a reader is told rather than a name that no longer resolves.
export interface AttachmentWithFile extends ConversationAttachmentRow {
  readonly fileName: string | null;
  readonly fileMatterId: MatterId | null;
  readonly versionNumber: number | null;
  readonly objectKey: string | null;
  readonly contentType: string | null;
  readonly sizeBytes: number | null;
}

export async function listAttachmentsWithFiles(
  database: SqlDatabase,
  conversationId: MagnusConversationId,
): Promise<readonly AttachmentWithFile[]> {
  const { results } = await database
    .prepare(
      `SELECT a.conversation_id, a.file_id, a.attached_at, a.text_status, a.text_bytes, ` +
        `CASE WHEN f.deleted_at IS NULL THEN f.name ELSE NULL END AS file_name, f.matter_id AS file_matter_id, ` +
        `v.version_number, v.r2_key AS object_key, v.sniffed_content_type AS content_type, v.size_bytes ` +
        `FROM ${MAGNUS_CONVERSATION_ATTACHMENT_TABLE} a ` +
        `LEFT JOIN ${FILE_TABLE} f ON f.id = a.file_id ` +
        `LEFT JOIN ${FILE_VERSION_TABLE} v ON v.id = f.current_version_id AND v.status = 'clean' AND f.deleted_at IS NULL ` +
        `WHERE a.conversation_id = ?1 ORDER BY a.attached_at ASC, a.file_id ASC LIMIT ?2`,
    )
    .bind(conversationId, CONVERSATION_ATTACHMENTS_MAX)
    .all<
      AttachmentDatabaseRow & {
        file_name: string | null;
        file_matter_id: string | null;
        version_number: number | null;
        object_key: string | null;
        content_type: string | null;
        size_bytes: number | null;
      }
    >();
  return results.map((row) => ({
    ...toAttachmentRow(row),
    fileName: row.file_name,
    fileMatterId: row.file_matter_id as MatterId | null,
    versionNumber: row.version_number,
    objectKey: row.object_key,
    contentType: row.content_type,
    sizeBytes: row.size_bytes,
  }));
}

// The one fact an attach has to check before it writes: that the file exists, is not deleted, and is
// one of the given matter's files. Files are matter-rooted, so a conversation on no matter can attach
// nothing, and a conversation on one matter cannot reach another's.
export async function readAttachableFile(
  database: SqlDatabase,
  fileId: FileId,
): Promise<
  { readonly id: FileId; readonly matterId: MatterId; readonly name: string } | undefined
> {
  const { results } = await database
    .prepare(
      `SELECT id, matter_id, name FROM ${FILE_TABLE} WHERE id = ?1 AND deleted_at IS NULL LIMIT 1`,
    )
    .bind(fileId)
    .all<{ id: string; matter_id: string; name: string }>();
  const row = results[0];
  return row === undefined
    ? undefined
    : { id: row.id as FileId, matterId: row.matter_id as MatterId, name: row.name };
}

// The matter a conversation may be moved onto: its title and lifecycle status, so the route can
// refuse a closed one with the reason. `system_key` marks the platform's own matters, which are not a
// place a member keeps work.
export async function readMoveTarget(
  database: SqlDatabase,
  matterId: MatterId,
): Promise<
  | {
      readonly id: MatterId;
      readonly title: string;
      readonly status: string;
      readonly systemOwned: boolean;
    }
  | undefined
> {
  const { results } = await database
    .prepare(`SELECT id, title, status, system_key FROM ${MATTER_TABLE} WHERE id = ?1 LIMIT 1`)
    .bind(matterId)
    .all<{ id: string; title: string; status: string; system_key: string | null }>();
  const row = results[0];
  return row === undefined
    ? undefined
    : {
        id: row.id as MatterId,
        title: row.title,
        status: row.status,
        systemOwned: row.system_key !== null,
      };
}

export interface InsertTurnRow {
  readonly id: MagnusTurnId;
  readonly conversationId: MagnusConversationId;
  readonly sequence: number;
  readonly speaker: TurnSpeaker;
  readonly content: string | null;
  readonly status: TurnStatus;
  readonly createdAt: string;
  readonly completedAt: string | null;
  // On a member turn made by an edit, the turn it replaces.
  readonly replacesTurnId?: MagnusTurnId;
}

export function insertTurnStatement(database: SqlDatabase, row: InsertTurnRow): SqlStatement {
  return database
    .prepare(
      `INSERT INTO ${MAGNUS_TURN_TABLE} (id, conversation_id, sequence, speaker, content, status, failure_label, model_id, snapshot_id, input_tokens, output_tokens, created_at, completed_at, replaces_turn_id) VALUES (?1, ?2, ?3, ?4, ?5, ?6, NULL, NULL, NULL, NULL, NULL, ?7, ?8, ?9)`,
    )
    .bind(
      row.id,
      row.conversationId,
      row.sequence,
      row.speaker,
      row.content,
      row.status,
      row.createdAt,
      row.completedAt,
      row.replacesTurnId ?? null,
    );
}

// Hides a member turn and its answer behind the removal marker. The text stays in the row: a
// transcript is erased only with its whole conversation. Guarded so a turn already set aside by an
// edit, or already removed, is left as it is.
export function removeTurnPairStatement(
  database: SqlDatabase,
  options: {
    readonly conversationId: MagnusConversationId;
    readonly turnIds: readonly MagnusTurnId[];
    readonly now: string;
  },
): SqlStatement {
  const placeholders = options.turnIds.map((_, index) => `?${String(index + 3)}`).join(", ");
  return database
    .prepare(
      `UPDATE ${MAGNUS_TURN_TABLE} SET removed_at = ?2 WHERE conversation_id = ?1 AND id IN (${placeholders}) AND removed_at IS NULL AND superseded_at IS NULL`,
    )
    .bind(options.conversationId, options.now, ...options.turnIds);
}

// Sets aside every turn from `fromSequence` on, which is what an edit does to the turns after the
// message it rewrites. Kept on the record; no longer read by the model or shown by default.
// fitness:unguarded-write — the row count cannot tell a refused edit from a done one: the rewritten message is matched whenever the route's read held, and when two edits race, the first one's new turns sit past the same sequence and are matched instead.
export function supersedeTurnsFromStatement(
  database: SqlDatabase,
  options: {
    readonly conversationId: MagnusConversationId;
    readonly fromSequence: number;
    readonly now: string;
  },
): SqlStatement {
  return database
    .prepare(
      `UPDATE ${MAGNUS_TURN_TABLE} SET superseded_at = ?3 WHERE conversation_id = ?1 AND sequence >= ?2 AND superseded_at IS NULL`,
    )
    .bind(options.conversationId, options.fromSequence, options.now);
}

export interface CompleteTurnOptions {
  readonly id: MagnusTurnId;
  readonly content: string;
  readonly modelId: string;
  readonly snapshotId: string;
  readonly inputTokens: number;
  readonly outputTokens: number;
  // True when earlier turns did not fit the request window. Recorded on the turn so the member is
  // told, on every later read of the transcript and not only in the moment.
  readonly contextTruncated: boolean;
  readonly effort: string | null;
  readonly now: string;
}

// Settling a Magnus turn is guarded on `status = 'pending'` at the database. That guard IS the
// re-bill stop's second half: a queue redelivery that raced past the pre-call check writes nothing,
// and because the metering row and the dedup record ride the same batch, the whole redelivery rolls
// back rather than double-counting.
// fitness:unguarded-write — a redelivery that raced past the pre-call check writing nothing IS the re-bill stop
export function completeTurnStatement(
  database: SqlDatabase,
  options: CompleteTurnOptions,
): SqlStatement {
  return database
    .prepare(
      `UPDATE ${MAGNUS_TURN_TABLE} SET status = 'complete', content = ?2, model_id = ?3, snapshot_id = ?4, input_tokens = ?5, output_tokens = ?6, context_truncated = ?7, completed_at = ?8, effort = ?9 WHERE id = ?1 AND status = 'pending'`,
    )
    .bind(
      options.id,
      options.content,
      options.modelId,
      options.snapshotId,
      options.inputTokens,
      options.outputTokens,
      options.contextTruncated ? 1 : 0,
      options.now,
      options.effort,
    );
}

export interface SettleTurnFailureOptions {
  readonly id: MagnusTurnId;
  readonly status: Extract<TurnStatus, "failed" | "refused">;
  readonly failureLabel: TurnFailureLabel;
  readonly modelId: string | null;
  readonly now: string;
}

// fitness:unguarded-write — a redelivery that raced past the pre-call check writing nothing IS the re-bill stop
export function failTurnStatement(
  database: SqlDatabase,
  options: SettleTurnFailureOptions,
): SqlStatement {
  return database
    .prepare(
      `UPDATE ${MAGNUS_TURN_TABLE} SET status = ?2, failure_label = ?3, model_id = ?4, completed_at = ?5 WHERE id = ?1 AND status = 'pending'`,
    )
    .bind(options.id, options.status, options.failureLabel, options.modelId, options.now);
}

export async function readTurn(
  database: SqlDatabase,
  id: MagnusTurnId,
): Promise<TurnRow | undefined> {
  const { results } = await database
    .prepare(
      `SELECT id, conversation_id, sequence, speaker, content, status, failure_label, model_id, snapshot_id, input_tokens, output_tokens, context_truncated, effort, removed_at, superseded_at, replaces_turn_id, created_at, completed_at FROM ${MAGNUS_TURN_TABLE} WHERE id = ?1 LIMIT 1`,
    )
    .bind(id)
    .all<TurnDatabaseRow>();
  const row = results[0];
  return row === undefined ? undefined : toTurnRow(row);
}

// The turn at one place in a conversation: the answer that follows a member turn, when an edit or a
// removal needs it.
export async function readTurnAtSequence(
  database: SqlDatabase,
  conversationId: MagnusConversationId,
  sequence: number,
): Promise<TurnRow | undefined> {
  const { results } = await database
    .prepare(
      `SELECT id, conversation_id, sequence, speaker, content, status, failure_label, model_id, snapshot_id, input_tokens, output_tokens, context_truncated, effort, removed_at, superseded_at, replaces_turn_id, created_at, completed_at FROM ${MAGNUS_TURN_TABLE} WHERE conversation_id = ?1 AND sequence = ?2 LIMIT 1`,
    )
    .bind(conversationId, sequence)
    .all<TurnDatabaseRow>();
  const row = results[0];
  return row === undefined ? undefined : toTurnRow(row);
}

// Whether an answer is still being written anywhere in the conversation.
export async function hasPendingTurn(
  database: SqlDatabase,
  conversationId: MagnusConversationId,
): Promise<boolean> {
  const { results } = await database
    .prepare(
      `SELECT 1 AS found FROM ${MAGNUS_TURN_TABLE} WHERE conversation_id = ?1 AND status = 'pending' AND superseded_at IS NULL AND removed_at IS NULL LIMIT 1`,
    )
    .bind(conversationId)
    .all<{ found: number }>();
  return results.length > 0;
}

// The newest turn in a conversation, whatever its speaker — what a socket subscriber is told about
// when it connects, because it is the turn the conversation is waiting on.
export async function readNewestTurn(
  database: SqlDatabase,
  conversationId: MagnusConversationId,
): Promise<TurnRow | undefined> {
  const { results } = await database
    .prepare(
      `SELECT id, conversation_id, sequence, speaker, content, status, failure_label, model_id, snapshot_id, input_tokens, output_tokens, context_truncated, effort, removed_at, superseded_at, replaces_turn_id, created_at, completed_at FROM ${MAGNUS_TURN_TABLE} WHERE conversation_id = ?1 ORDER BY sequence DESC LIMIT 1`,
    )
    .bind(conversationId)
    .all<TurnDatabaseRow>();
  const row = results[0];
  return row === undefined ? undefined : toTurnRow(row);
}

// The prior turns the window is built from: the newest `limit` turns, returned oldest-first. Bounded
// by construction — there is no read of a whole conversation anywhere in this package.
export async function readRecentTurns(
  database: SqlDatabase,
  conversationId: MagnusConversationId,
  limit: number,
): Promise<readonly TurnRow[]> {
  // The newest `limit` turns, handed back OLDEST-first. Both orderings happen in SQL — the inner
  // query takes the newest rows, the outer one puts them back in conversation order — rather than
  // reading them one way and flipping the array afterwards, which is a second place the two orders
  // could disagree.
  const { results } = await database
    .prepare(
      `SELECT id, conversation_id, sequence, speaker, content, status, failure_label, model_id, snapshot_id, input_tokens, output_tokens, context_truncated, effort, removed_at, superseded_at, replaces_turn_id, created_at, completed_at FROM (SELECT * FROM ${MAGNUS_TURN_TABLE} WHERE conversation_id = ?1 ORDER BY sequence DESC LIMIT ?2) ORDER BY sequence ASC`,
    )
    .bind(conversationId, limit)
    .all<TurnDatabaseRow>();
  return results.map(toTurnRow);
}

// A conversation's turns, newest-first, cursor-paginated over (created_at, id) like every other list
// read on the platform.
export async function listTurns(
  database: SqlDatabase,
  conversationId: MagnusConversationId,
  options: { readonly cursor?: SortCursor; readonly limit?: number },
): Promise<readonly TurnRow[]> {
  const conditions: string[] = ["conversation_id = ?"];
  const bindings: unknown[] = [conversationId];
  appendCursorPredicate(conditions, bindings, options.cursor);
  bindings.push(options.limit ?? DEFAULT_PAGE_SIZE);
  const { results } = await database
    .prepare(
      `SELECT id, conversation_id, sequence, speaker, content, status, failure_label, model_id, snapshot_id, input_tokens, output_tokens, context_truncated, effort, removed_at, superseded_at, replaces_turn_id, created_at, completed_at FROM ${MAGNUS_TURN_TABLE} WHERE ${conditions.join(" AND ")} ORDER BY created_at DESC, id DESC LIMIT ?`,
    )
    .bind(...bindings)
    .all<TurnDatabaseRow>();
  return results.map(toTurnRow);
}

// The next sequence number for a conversation. Read immediately before composing the turn pair; the
// UNIQUE (conversation_id, sequence) index is what actually arbitrates a race, so a lost race fails
// the batch rather than silently reordering the record.
export async function readNextSequence(
  database: SqlDatabase,
  conversationId: MagnusConversationId,
): Promise<number> {
  const { results } = await database
    .prepare(
      `SELECT COALESCE(MAX(sequence), -1) + 1 AS next FROM ${MAGNUS_TURN_TABLE} WHERE conversation_id = ?1`,
    )
    .bind(conversationId)
    .all<{ next: number }>();
  return results[0]?.next ?? 0;
}

// Member turns the firm has spent today, counted for the daily ceiling. Member turns only: a Magnus
// answer is a consequence of a member turn, not a second unit of allowance.
export async function countMemberTurnsSince(database: SqlDatabase, since: string): Promise<number> {
  const { results } = await database
    .prepare(
      `SELECT COUNT(*) AS total FROM ${MAGNUS_TURN_TABLE} WHERE speaker = 'member' AND created_at >= ?1`,
    )
    .bind(since)
    .all<{ total: number }>();
  return results[0]?.total ?? 0;
}

export function recordAcknowledgementStatement(
  database: SqlDatabase,
  options: { readonly userId: UserId; readonly disclosureVersion: number; readonly now: string },
): SqlStatement {
  return database
    .prepare(
      `INSERT INTO ${MAGNUS_MEMBER_ACKNOWLEDGEMENT_TABLE} (user_id, disclosure_version, acknowledged_at) VALUES (?1, ?2, ?3) ON CONFLICT(user_id) DO UPDATE SET disclosure_version = excluded.disclosure_version, acknowledged_at = excluded.acknowledged_at`,
    )
    .bind(options.userId, options.disclosureVersion, options.now);
}

export async function readAcknowledgement(
  database: SqlDatabase,
  userId: UserId,
): Promise<MemberAcknowledgementRow | undefined> {
  const { results } = await database
    .prepare(
      `SELECT user_id, disclosure_version, acknowledged_at FROM ${MAGNUS_MEMBER_ACKNOWLEDGEMENT_TABLE} WHERE user_id = ?1 LIMIT 1`,
    )
    .bind(userId)
    .all<{ user_id: string; disclosure_version: number; acknowledged_at: string }>();
  const row = results[0];
  if (row === undefined) return undefined;
  return {
    userId: row.user_id as UserId,
    disclosureVersion: row.disclosure_version,
    acknowledgedAt: row.acknowledged_at,
  };
}
