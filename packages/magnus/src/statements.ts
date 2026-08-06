import {
  appendCursorPredicate,
  DEFAULT_PAGE_SIZE,
  type SortCursor,
} from "@magna-carta/data-access/cursor-pagination";
import type { SqlDatabase, SqlStatement } from "@magna-carta/data-access/idempotency-statements";
import type {
  MagnusConversationId,
  MagnusTurnId,
  MatterId,
  UserId,
} from "@magna-carta/identifiers/types";
import type {
  ConversationRow,
  ConversationState,
  MemberAcknowledgementRow,
  TurnFailureLabel,
  TurnRow,
  TurnSpeaker,
  TurnStatus,
} from "./types.ts";

// SQL statement builders for the three Magnus tables. Table names are tracked against
// @magna-carta/database's per-firm schema by the schema-name-sync fitness test. This module composes
// statements and runs bounded reads; it holds no binding and crosses no firm — the caller supplies
// the firm-scoped database handle.
//
// Every read is LIMITed. There is no statement here that can return a whole conversation.
export const MAGNUS_CONVERSATION_TABLE = "magnus_conversation";
export const MAGNUS_TURN_TABLE = "magnus_turn";
export const MAGNUS_MEMBER_ACKNOWLEDGEMENT_TABLE = "magnus_member_acknowledgement";

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

export interface ListConversationsOptions {
  // Absent = every member's conversations (the administrative read); present = one member's own.
  readonly createdBy?: UserId;
  readonly cursor?: SortCursor;
  readonly limit?: number;
}

export async function listConversations(
  database: SqlDatabase,
  options: ListConversationsOptions,
): Promise<readonly ConversationRow[]> {
  const conditions: string[] = ["state <> 'deleted'"];
  const bindings: unknown[] = [];
  if (options.createdBy !== undefined) {
    conditions.push("created_by = ?");
    bindings.push(options.createdBy);
  }
  appendCursorPredicate(conditions, bindings, options.cursor);
  const limit = options.limit ?? DEFAULT_PAGE_SIZE;
  bindings.push(limit);
  const { results } = await database
    .prepare(
      `SELECT id, title, created_by, matter_id, state, created_at, updated_at, deleted_at FROM ${MAGNUS_CONVERSATION_TABLE} WHERE ${conditions.join(" AND ")} ORDER BY created_at DESC, id DESC LIMIT ?`,
    )
    .bind(...bindings)
    .all<ConversationDatabaseRow>();
  return results.map(toConversationRow);
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
}

export function insertTurnStatement(database: SqlDatabase, row: InsertTurnRow): SqlStatement {
  return database
    .prepare(
      `INSERT INTO ${MAGNUS_TURN_TABLE} (id, conversation_id, sequence, speaker, content, status, failure_label, model_id, snapshot_id, input_tokens, output_tokens, created_at, completed_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, NULL, NULL, NULL, NULL, NULL, ?7, ?8)`,
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
    );
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
  readonly now: string;
}

// Settling a Magnus turn is guarded on `status = 'pending'` at the database. That guard IS the
// re-bill stop's second half: a queue redelivery that raced past the pre-call check writes nothing,
// and because the metering row and the dedup record ride the same batch, the whole redelivery rolls
// back rather than double-counting.
export function completeTurnStatement(
  database: SqlDatabase,
  options: CompleteTurnOptions,
): SqlStatement {
  return database
    .prepare(
      `UPDATE ${MAGNUS_TURN_TABLE} SET status = 'complete', content = ?2, model_id = ?3, snapshot_id = ?4, input_tokens = ?5, output_tokens = ?6, context_truncated = ?7, completed_at = ?8 WHERE id = ?1 AND status = 'pending'`,
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
    );
}

export interface SettleTurnFailureOptions {
  readonly id: MagnusTurnId;
  readonly status: Extract<TurnStatus, "failed" | "refused">;
  readonly failureLabel: TurnFailureLabel;
  readonly modelId: string | null;
  readonly now: string;
}

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
      `SELECT id, conversation_id, sequence, speaker, content, status, failure_label, model_id, snapshot_id, input_tokens, output_tokens, context_truncated, created_at, completed_at FROM ${MAGNUS_TURN_TABLE} WHERE id = ?1 LIMIT 1`,
    )
    .bind(id)
    .all<TurnDatabaseRow>();
  const row = results[0];
  return row === undefined ? undefined : toTurnRow(row);
}

// The newest turn in a conversation, whatever its speaker — what a socket subscriber is told about
// when it connects, because it is the turn the conversation is waiting on.
export async function readNewestTurn(
  database: SqlDatabase,
  conversationId: MagnusConversationId,
): Promise<TurnRow | undefined> {
  const { results } = await database
    .prepare(
      `SELECT id, conversation_id, sequence, speaker, content, status, failure_label, model_id, snapshot_id, input_tokens, output_tokens, context_truncated, created_at, completed_at FROM ${MAGNUS_TURN_TABLE} WHERE conversation_id = ?1 ORDER BY sequence DESC LIMIT 1`,
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
      `SELECT id, conversation_id, sequence, speaker, content, status, failure_label, model_id, snapshot_id, input_tokens, output_tokens, context_truncated, created_at, completed_at FROM (SELECT * FROM ${MAGNUS_TURN_TABLE} WHERE conversation_id = ?1 ORDER BY sequence DESC LIMIT ?2) ORDER BY sequence ASC`,
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
      `SELECT id, conversation_id, sequence, speaker, content, status, failure_label, model_id, snapshot_id, input_tokens, output_tokens, context_truncated, created_at, completed_at FROM ${MAGNUS_TURN_TABLE} WHERE ${conditions.join(" AND ")} ORDER BY created_at DESC, id DESC LIMIT ?`,
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
