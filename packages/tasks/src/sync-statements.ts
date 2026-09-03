import type { SqlDatabase, SqlStatement } from "@magna-carta/data-access/idempotency-statements";
import type {
  MatterId,
  MatterTaskDeletionId,
  MatterTaskExternalLinkId,
  MatterTaskId,
  UserId,
} from "@magna-carta/identifiers/types";
import type { VisibleMatterPredicate } from "@magna-carta/calendar/visibility";
import {
  MATTER_TASK_TABLE,
  TASK_COLUMNS,
  taskVisibilityFragment,
  type MatterTaskRow,
} from "./task-statements.ts";

// The SQL an outside system needs, and none of it names one.
//
// This platform integrates with nothing and ships no adapter. What it ships is the seam: a place to
// record that a task IS some object elsewhere, a tombstone so a deletion can be observed after the
// fact, and a feed that answers "what moved since I last looked". An addon composes those three
// into a sync; nothing here knows what a sync is.

export const MATTER_TASK_EXTERNAL_LINK_TABLE = "matter_task_external_link";
export const MATTER_TASK_DELETION_TABLE = "matter_task_deletion";

// A page of the change feed. Deliberately not the task page size: a sync reads in bulk and a person
// does not, and the two have no reason to move together.
export const MAX_TASK_CHANGE_PAGE_SIZE = 200;

export interface MatterTaskExternalLinkRow {
  readonly id: MatterTaskExternalLinkId;
  readonly task_id: MatterTaskId;
  readonly system: string;
  readonly external_id: string;
  readonly external_url: string | null;
  readonly remote_revision: string | null;
  readonly last_synced_at: string | null;
  readonly created_at: string;
  readonly updated_at: string;
  readonly created_by: UserId | null;
}

export interface MatterTaskDeletionRow {
  readonly id: MatterTaskDeletionId;
  readonly task_id: MatterTaskId;
  readonly matter_id: MatterId | null;
  readonly deleted_at: string;
  readonly deleted_by: UserId | null;
}

const EXTERNAL_LINK_COLUMNS =
  "id, task_id, system, external_id, external_url, remote_revision, last_synced_at, created_at, updated_at, created_by";

// ---- the external link ----

export function insertExternalLinkStatement(
  database: SqlDatabase,
  input: {
    readonly id: MatterTaskExternalLinkId;
    readonly taskId: MatterTaskId;
    readonly system: string;
    readonly externalId: string;
    readonly externalUrl: string | null;
    readonly remoteRevision: string | null;
    readonly lastSyncedAt: string | null;
    readonly createdBy: UserId | null;
    readonly now: string;
  },
): SqlStatement {
  // A second link for the same remote object, or a second identity for the same task in the same
  // system, collides on a unique index and aborts the batch. That is the right outcome and the
  // reason the rules are indexes: a race between two syncs is exactly the case a service pre-check
  // loses, and losing it means two tasks fighting over one mirror.
  return database
    .prepare(
      `INSERT INTO ${MATTER_TASK_EXTERNAL_LINK_TABLE} (${EXTERNAL_LINK_COLUMNS}) ` +
        `VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?8, ?9)`,
    )
    .bind(
      input.id,
      input.taskId,
      input.system,
      input.externalId,
      input.externalUrl,
      input.remoteRevision,
      input.lastSyncedAt,
      input.now,
      input.createdBy,
    );
}

// What an addon writes after a successful round trip: where it lives over there, what the remote
// looked like when the two sides agreed, and when. The identity itself is immutable — a link that
// could be repointed at a different remote object would let one task's history become another's.
export function updateExternalLinkStatement(
  database: SqlDatabase,
  input: {
    readonly id: MatterTaskExternalLinkId;
    readonly externalUrl: string | null;
    readonly remoteRevision: string | null;
    readonly lastSyncedAt: string | null;
    readonly now: string;
  },
): SqlStatement {
  return database
    .prepare(
      `UPDATE ${MATTER_TASK_EXTERNAL_LINK_TABLE} ` +
        `SET external_url = ?2, remote_revision = ?3, last_synced_at = ?4, updated_at = ?5 WHERE id = ?1`,
    )
    .bind(input.id, input.externalUrl, input.remoteRevision, input.lastSyncedAt, input.now);
}

export function deleteExternalLinkStatement(
  database: SqlDatabase,
  id: MatterTaskExternalLinkId,
): SqlStatement {
  return database.prepare(`DELETE FROM ${MATTER_TASK_EXTERNAL_LINK_TABLE} WHERE id = ?1`).bind(id);
}

// Every link a task carries, so a task mirrored into two systems reads back as one row per system.
export async function readExternalLinksForTask(
  database: SqlDatabase,
  taskId: MatterTaskId,
): Promise<MatterTaskExternalLinkRow[]> {
  const { results } = await database
    .prepare(
      `SELECT ${EXTERNAL_LINK_COLUMNS} FROM ${MATTER_TASK_EXTERNAL_LINK_TABLE} ` +
        `WHERE task_id = ?1 ORDER BY system, id`,
    )
    .bind(taskId)
    .all<MatterTaskExternalLinkRow>();
  return results;
}

// The page's links in ONE read keyed by the tasks on it, never one read per task — the same rule the
// page's attachments and its time already follow.
export async function readExternalLinksForTasks(
  database: SqlDatabase,
  taskIds: readonly MatterTaskId[],
): Promise<MatterTaskExternalLinkRow[]> {
  if (taskIds.length === 0) return [];
  const placeholders = taskIds.map((_, index) => `?${index + 1}`).join(", ");
  const { results } = await database
    .prepare(
      `SELECT ${EXTERNAL_LINK_COLUMNS} FROM ${MATTER_TASK_EXTERNAL_LINK_TABLE} ` +
        `WHERE task_id IN (${placeholders}) ORDER BY task_id, system, id`,
    )
    .bind(...taskIds)
    .all<MatterTaskExternalLinkRow>();
  return results;
}

// The lookup that makes a sync idempotent: an addon that has a remote id and wants to know whether
// it already corresponds to a task here asks this before creating anything.
export async function readTaskIdForExternalId(
  database: SqlDatabase,
  system: string,
  externalId: string,
): Promise<MatterTaskExternalLinkRow | undefined> {
  const { results } = await database
    .prepare(
      `SELECT ${EXTERNAL_LINK_COLUMNS} FROM ${MATTER_TASK_EXTERNAL_LINK_TABLE} ` +
        `WHERE system = ?1 AND external_id = ?2`,
    )
    .bind(system, externalId)
    .all<MatterTaskExternalLinkRow>();
  return results[0];
}

export async function readExternalLink(
  database: SqlDatabase,
  id: MatterTaskExternalLinkId,
): Promise<MatterTaskExternalLinkRow | undefined> {
  const { results } = await database
    .prepare(
      `SELECT ${EXTERNAL_LINK_COLUMNS} FROM ${MATTER_TASK_EXTERNAL_LINK_TABLE} WHERE id = ?1`,
    )
    .bind(id)
    .all<MatterTaskExternalLinkRow>();
  return results[0];
}

// Every link a deleted task carried. Composed in the delete's own batch: a link outliving its task
// would point at nothing while still holding that remote object's uniqueness slot, which would stop
// the firm ever linking it to a real task again.
export function deleteExternalLinksForTaskStatement(
  database: SqlDatabase,
  taskId: MatterTaskId,
): SqlStatement {
  return database
    .prepare(`DELETE FROM ${MATTER_TASK_EXTERNAL_LINK_TABLE} WHERE task_id = ?1`)
    .bind(taskId);
}

// ---- the tombstone ----

export function insertTaskDeletionStatement(
  database: SqlDatabase,
  input: {
    readonly id: MatterTaskDeletionId;
    readonly taskId: MatterTaskId;
    readonly matterId: MatterId | null;
    readonly deletedBy: UserId | null;
    readonly now: string;
  },
): SqlStatement {
  return database
    .prepare(
      `INSERT INTO ${MATTER_TASK_DELETION_TABLE} (id, task_id, matter_id, deleted_at, deleted_by) ` +
        `VALUES (?1, ?2, ?3, ?4, ?5)`,
    )
    .bind(input.id, input.taskId, input.matterId, input.now, input.deletedBy);
}

// ---- the change feed ----

// TWO POSITIONS, NOT ONE, and the reason is a bug that would never show up in testing.
//
// The feed merges two streams: tasks that moved, and tasks that were deleted. Both are ordered on
// the same time axis, so ONE cursor looks sufficient — take the merged prefix and remember the last
// key. It is not. The cursor's id half would come from whichever stream produced the last row, and
// applying a `matterTaskDeletion_` handle as the tie-break against `matter_task.id` excludes every
// live task whose handle happens to sort lower at that same instant. Those tasks are then never
// reported again, because the next page starts after them: a change lost permanently, at a page
// boundary, under a clock collision nobody can reproduce on demand.
//
// So each stream carries its own `(instant, id)` position and neither can move the other past
// anything. The pair is packed into one opaque token because a caller has one place to keep it.
export interface StreamPosition {
  readonly at: string;
  readonly id: string;
}

export interface TaskChangeCursor {
  readonly changed?: StreamPosition;
  readonly deleted?: StreamPosition;
}

// Opaque on the wire, on the same terms as `@magna-carta/data-access/cursor-pagination`: the
// btoa(JSON) encoding is a contract, so a token minted by one deploy still decodes on the next, and
// nothing outside this module parses its shape.
export function encodeTaskChangeCursor(cursor: TaskChangeCursor): string {
  return btoa(
    JSON.stringify({
      c: cursor.changed === undefined ? undefined : [cursor.changed.at, cursor.changed.id],
      d: cursor.deleted === undefined ? undefined : [cursor.deleted.at, cursor.deleted.id],
    }),
  );
}

function positionFrom(raw: unknown): StreamPosition | undefined {
  if (!Array.isArray(raw) || raw.length !== 2) return undefined;
  const [at, id] = raw as unknown[];
  if (typeof at !== "string" || typeof id !== "string") return undefined;
  return { at, id };
}

// A malformed or tampered token is the FIRST page, never a throw — the shared primitive's own
// posture. For a sync that means replaying from the beginning, which is safe because every write it
// makes is keyed on an external id it already holds.
export function decodeTaskChangeCursor(cursor: string | undefined): TaskChangeCursor {
  if (cursor === undefined) return {};
  try {
    const parsed = JSON.parse(atob(cursor)) as { c?: unknown; d?: unknown };
    return { changed: positionFrom(parsed.c), deleted: positionFrom(parsed.d) };
  } catch {
    return {};
  }
}

function afterPosition(
  column: string,
  idColumn: string,
  position: StreamPosition | undefined,
): { condition: string; bindings: string[] } {
  if (position === undefined) return { condition: "1 = 1", bindings: [] };
  return {
    condition: `(${column} > ? OR (${column} = ? AND ${idColumn} > ?))`,
    bindings: [position.at, position.at, position.id],
  };
}

// Tasks that moved since the cursor, oldest first.
//
// VISIBILITY STILL DECIDES. The feed composes the same fragment every other task read does, so a
// principal reads exactly the tasks it could read one at a time — a sync is not a back door, and an
// addon connected as a member with narrow reach syncs narrowly.
export function selectChangedTasksStatement(
  database: SqlDatabase,
  options: {
    readonly cursor?: StreamPosition;
    readonly limit: number;
    readonly visibility: VisibleMatterPredicate;
    readonly viewerUserId: UserId;
  },
): SqlStatement {
  const after = afterPosition(
    `${MATTER_TASK_TABLE}.updated_at`,
    `${MATTER_TASK_TABLE}.id`,
    options.cursor,
  );
  const reach = taskVisibilityFragment(options.visibility, options.viewerUserId);
  return database
    .prepare(
      `SELECT ${TASK_COLUMNS} FROM ${MATTER_TASK_TABLE} ` +
        `WHERE ${after.condition} AND ${reach.condition} ` +
        `ORDER BY ${MATTER_TASK_TABLE}.updated_at, ${MATTER_TASK_TABLE}.id LIMIT ?`,
    )
    .bind(...after.bindings, ...reach.bindings, options.limit);
}

// Deletions since the cursor, on the same keyset shape.
//
// NO VISIBILITY PREDICATE, and that is deliberate rather than an oversight. The row carries a task
// id, a matter id and two timestamps — nothing about anybody, and nothing about what the work was.
// Filtering it through the matter predicate would mean resolving a matter for a task that no longer
// exists, and the failure mode of getting that wrong is a mirror that never hears about a deletion,
// which is the exact thing this table exists to prevent. A caller that must not act on another
// matter's deletion has the matter id right there to check.
export function selectTaskDeletionsStatement(
  database: SqlDatabase,
  options: { readonly cursor?: StreamPosition; readonly limit: number },
): SqlStatement {
  const after = afterPosition("deleted_at", "id", options.cursor);
  return database
    .prepare(
      `SELECT id, task_id, matter_id, deleted_at, deleted_by FROM ${MATTER_TASK_DELETION_TABLE} ` +
        `WHERE ${after.condition} ORDER BY deleted_at, id LIMIT ?`,
    )
    .bind(...after.bindings, options.limit);
}

export interface TaskChangePage {
  readonly changed: readonly MatterTaskRow[];
  readonly deleted: readonly MatterTaskDeletionRow[];
  // Absent when both streams are exhausted, which is how a caller knows it has caught up. A caller
  // that keeps the token and comes back later resumes from exactly here.
  readonly nextCursor: string | undefined;
}

// One page of "what moved since I last looked".
//
// Each stream is read to its own limit and advanced independently, so a quiet week of deletions
// never holds back the edits and a burst of either never starves the other.
export async function readTaskChanges(
  database: SqlDatabase,
  options: {
    readonly cursor?: string;
    readonly limit: number;
    readonly visibility: VisibleMatterPredicate;
    readonly viewerUserId: UserId;
  },
): Promise<TaskChangePage> {
  const cursor = decodeTaskChangeCursor(options.cursor);
  const [changedRows, deletedRows] = await Promise.all([
    selectChangedTasksStatement(database, {
      cursor: cursor.changed,
      limit: options.limit,
      visibility: options.visibility,
      viewerUserId: options.viewerUserId,
    }).all<MatterTaskRow>(),
    selectTaskDeletionsStatement(database, {
      cursor: cursor.deleted,
      limit: options.limit,
    }).all<MatterTaskDeletionRow>(),
  ]);
  const changed = changedRows.results;
  const deleted = deletedRows.results;

  const lastChanged = changed.at(-1);
  const lastDeleted = deleted.at(-1);
  const next: TaskChangeCursor = {
    // A stream that returned nothing keeps the position it had, so it resumes from where it stopped
    // rather than from the beginning the next time something lands in it.
    changed:
      lastChanged === undefined
        ? cursor.changed
        : { at: lastChanged.updated_at, id: lastChanged.id },
    deleted:
      lastDeleted === undefined
        ? cursor.deleted
        : { at: lastDeleted.deleted_at, id: lastDeleted.id },
  };
  // Both streams short of their limit means the caller has caught up. Handing back no token then is
  // what lets a caller distinguish "keep reading" from "up to date" without counting rows itself —
  // and a caller that wants to resume later keeps the token it already has.
  const caughtUp = changed.length < options.limit && deleted.length < options.limit;
  return {
    changed,
    deleted,
    nextCursor: caughtUp ? undefined : encodeTaskChangeCursor(next),
  };
}
