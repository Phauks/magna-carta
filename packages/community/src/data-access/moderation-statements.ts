import type { CommunityModerationActionId, UserId } from "@magna-carta/identifiers/types";
import type { SqlDatabase, SqlStatement } from "../sql.ts";
import type { ModerationAction, SubjectKind } from "../types.ts";
import { COMMUNITY_MODERATION_ACTION_TABLE } from "./tables.ts";

// The append-only record of what was done to a post or a comment.
//
// A null actor is not missing data: it is how the record says the platform acted on its own — the
// format detector's automatic hide, or the scheduled archive sweep. That distinction is the whole
// answer to "what happens at three in the morning", and it has to be legible after the fact or the
// answer is unverifiable.
//
// Nothing here carries the subject's text. A moderation record that quotes the post it hid has
// copied the disclosure into a second place, which is the one thing the hide was for.

export function insertModerationActionStatement(
  database: SqlDatabase,
  input: {
    readonly id: CommunityModerationActionId;
    readonly subjectKind: SubjectKind;
    readonly subjectId: string;
    readonly action: ModerationAction;
    readonly actorUserId: UserId | null;
    readonly reason: string | null;
    readonly note: string | null;
    readonly now: string;
  },
): SqlStatement {
  return database
    .prepare(
      `INSERT INTO ${COMMUNITY_MODERATION_ACTION_TABLE}
         (id, subject_kind, subject_id, action, actor_user_id, reason, note, created_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)`,
    )
    .bind(
      input.id,
      input.subjectKind,
      input.subjectId,
      input.action,
      input.actorUserId,
      input.reason,
      input.note,
      input.now,
    );
}

export function listModerationActionsStatement(
  database: SqlDatabase,
  subjectId: string,
  limit: number,
): SqlStatement {
  return database
    .prepare(
      `SELECT id, subject_kind, subject_id, action, actor_user_id, reason, note, created_at
       FROM ${COMMUNITY_MODERATION_ACTION_TABLE}
       WHERE subject_id = ?1
       ORDER BY created_at DESC
       LIMIT ?2`,
    )
    .bind(subjectId, limit);
}
