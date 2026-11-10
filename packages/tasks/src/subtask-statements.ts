import type { SqlDatabase, SqlStatement } from "@magna-carta/data-access/idempotency-statements";
import type { MatterTaskId, UserId } from "@magna-carta/identifiers/types";

// A deleted task's sub-tasks move up to where it stood, in the same batch as the delete: deleting a
// parent never quietly takes work somebody else is doing, and no sub-task is left pointing at a row
// that is gone.
export function promoteSubtasksStatement(
  database: SqlDatabase,
  input: {
    readonly taskId: MatterTaskId;
    readonly newParentId: MatterTaskId | null;
    readonly now: string;
    readonly actor: UserId;
  },
): SqlStatement {
  return database
    .prepare(
      `UPDATE matter_task SET parent_task_id = ?1, updated_at = ?2, updated_by = ?3 ` +
        `WHERE parent_task_id = ?4`,
    )
    .bind(input.newParentId, input.now, input.actor, input.taskId);
}
