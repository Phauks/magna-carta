import type { SqlDatabase, SqlStatement } from "@magna-carta/data-access/idempotency-statements";
import type { MatterTaskCommentId, MatterTaskId, UserId } from "@magna-carta/identifiers/types";

// A task's comment thread: the comments and the colleagues each one names. Plain statements and
// reads; who may write which comment lives in comment-service.ts.
//
// Table names tracked against @magna-carta/database's per-firm schema by the schema-name-sync test.
export const MATTER_TASK_COMMENT_TABLE = "matter_task_comment";
export const MATTER_TASK_COMMENT_MENTION_TABLE = "matter_task_comment_mention";

export interface MatterTaskCommentRow {
  readonly id: MatterTaskCommentId;
  readonly task_id: MatterTaskId;
  readonly author_user_id: UserId;
  readonly body: string;
  readonly created_at: string;
  readonly edited_at: string | null;
}

export interface MatterTaskCommentMentionRow {
  readonly comment_id: MatterTaskCommentId;
  readonly user_id: UserId;
}

// The whole thread, oldest first, which is the order it was said in. Bounded by the cap on how many
// comments one task holds, so the read never grows past it.
export async function readTaskComments(
  database: SqlDatabase,
  taskId: MatterTaskId,
): Promise<readonly MatterTaskCommentRow[]> {
  const { results } = await database
    .prepare(
      `SELECT id, task_id, author_user_id, body, created_at, edited_at ` +
        `FROM ${MATTER_TASK_COMMENT_TABLE} WHERE task_id = ?1 ORDER BY created_at ASC, id ASC`,
    )
    .bind(taskId)
    .all<MatterTaskCommentRow>();
  return results;
}

// Who the thread's comments name, in one read rather than one per comment.
export async function readTaskCommentMentions(
  database: SqlDatabase,
  taskId: MatterTaskId,
): Promise<readonly MatterTaskCommentMentionRow[]> {
  const { results } = await database
    .prepare(
      `SELECT mention.comment_id, mention.user_id ` +
        `FROM ${MATTER_TASK_COMMENT_MENTION_TABLE} AS mention ` +
        `JOIN ${MATTER_TASK_COMMENT_TABLE} AS comment ON comment.id = mention.comment_id ` +
        `WHERE comment.task_id = ?1 ORDER BY mention.comment_id ASC, mention.user_id ASC`,
    )
    .bind(taskId)
    .all<MatterTaskCommentMentionRow>();
  return results;
}

export async function readTaskComment(
  database: SqlDatabase,
  commentId: MatterTaskCommentId,
): Promise<MatterTaskCommentRow | undefined> {
  const { results } = await database
    .prepare(
      `SELECT id, task_id, author_user_id, body, created_at, edited_at ` +
        `FROM ${MATTER_TASK_COMMENT_TABLE} WHERE id = ?1`,
    )
    .bind(commentId)
    .all<MatterTaskCommentRow>();
  return results[0];
}

export async function readCommentMentions(
  database: SqlDatabase,
  commentId: MatterTaskCommentId,
): Promise<readonly UserId[]> {
  const { results } = await database
    .prepare(
      `SELECT user_id FROM ${MATTER_TASK_COMMENT_MENTION_TABLE} WHERE comment_id = ?1 ` +
        `ORDER BY user_id ASC`,
    )
    .bind(commentId)
    .all<{ user_id: UserId }>();
  return results.map((row) => row.user_id);
}

export async function countTaskComments(
  database: SqlDatabase,
  taskId: MatterTaskId,
): Promise<number> {
  const { results } = await database
    .prepare(`SELECT COUNT(*) AS count FROM ${MATTER_TASK_COMMENT_TABLE} WHERE task_id = ?1`)
    .bind(taskId)
    .all<{ count: number }>();
  return results[0]?.count ?? 0;
}

export function insertTaskCommentStatement(
  database: SqlDatabase,
  input: {
    readonly id: MatterTaskCommentId;
    readonly taskId: MatterTaskId;
    readonly authorUserId: UserId;
    readonly body: string;
    readonly now: string;
  },
): SqlStatement {
  return database
    .prepare(
      `INSERT INTO ${MATTER_TASK_COMMENT_TABLE} ` +
        `(id, task_id, author_user_id, body, created_at, edited_at) VALUES (?1, ?2, ?3, ?4, ?5, NULL)`,
    )
    .bind(input.id, input.taskId, input.authorUserId, input.body, input.now);
}

// Rewording is the author's alone, and the WHERE says so as well as the service: a statement that
// matches no row changes nothing, so a comment that changed hands could never be rewritten here.
export function updateTaskCommentStatement(
  database: SqlDatabase,
  input: {
    readonly id: MatterTaskCommentId;
    readonly authorUserId: UserId;
    readonly body: string;
    readonly now: string;
  },
): SqlStatement {
  return database
    .prepare(
      `UPDATE ${MATTER_TASK_COMMENT_TABLE} SET body = ?1, edited_at = ?2 ` +
        `WHERE id = ?3 AND author_user_id = ?4`,
    )
    .bind(input.body, input.now, input.id, input.authorUserId);
}

export function replaceCommentMentionsStatements(
  database: SqlDatabase,
  commentId: MatterTaskCommentId,
  userIds: readonly UserId[],
): readonly SqlStatement[] {
  return [
    database
      .prepare(`DELETE FROM ${MATTER_TASK_COMMENT_MENTION_TABLE} WHERE comment_id = ?1`)
      .bind(commentId),
    ...userIds.map((userId) =>
      database
        .prepare(
          `INSERT INTO ${MATTER_TASK_COMMENT_MENTION_TABLE} (comment_id, user_id) VALUES (?1, ?2)`,
        )
        .bind(commentId, userId),
    ),
  ];
}

export function deleteTaskCommentStatements(
  database: SqlDatabase,
  commentId: MatterTaskCommentId,
): readonly SqlStatement[] {
  return [
    database
      .prepare(`DELETE FROM ${MATTER_TASK_COMMENT_MENTION_TABLE} WHERE comment_id = ?1`)
      .bind(commentId),
    database.prepare(`DELETE FROM ${MATTER_TASK_COMMENT_TABLE} WHERE id = ?1`).bind(commentId),
  ];
}

// Everything a deleted task's thread leaves behind, removed in the same batch as the task. The
// mentions go first: they point at the comments, and the comments point at the task.
export function deleteTaskCommentsForTaskStatements(
  database: SqlDatabase,
  taskId: MatterTaskId,
): readonly SqlStatement[] {
  return [
    database
      .prepare(
        `DELETE FROM ${MATTER_TASK_COMMENT_MENTION_TABLE} WHERE comment_id IN ` +
          `(SELECT id FROM ${MATTER_TASK_COMMENT_TABLE} WHERE task_id = ?1)`,
      )
      .bind(taskId),
    database.prepare(`DELETE FROM ${MATTER_TASK_COMMENT_TABLE} WHERE task_id = ?1`).bind(taskId),
  ];
}
