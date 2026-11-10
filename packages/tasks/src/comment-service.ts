/*
 * A TASK'S COMMENT THREAD: colleagues talking about one piece of work.
 *
 * Flat, oldest first, with no replies to replies and no reactions. A comment may name colleagues with
 * @, and each one named is told. A new comment also tells the people the task is assigned to and the
 * people watching it, never its author, and a person named is told once rather than twice.
 *
 * Only the author may reword or remove a comment. Rewording keeps the comment's place in the thread
 * and marks it edited; a colleague newly named by the rewording is told, and nobody else is told
 * again. Removing it takes it out of the thread; the audit log keeps that it was said and removed,
 * never what it said.
 *
 * A comment is discussion and not the matter's record: what the file must keep is a note on the
 * matter. A repeating task's next copy starts with an empty thread for the same reason.
 */
import { domainAuditStatement } from "@magna-carta/data-access/audit-statements";
import { guarded, type EffectWrite } from "@magna-carta/data-access/effect-batch";
import type { SqlDatabase, SqlStatement } from "@magna-carta/data-access/idempotency-statements";
import type { OutboxMessage } from "@magna-carta/data-access/outbox-statements";
import { newIdentifier } from "@magna-carta/identifiers/generate";
import type { MatterTaskCommentId, MatterTaskId, UserId } from "@magna-carta/identifiers/types";
import {
  countTaskComments,
  deleteTaskCommentStatements,
  insertTaskCommentStatement,
  readCommentMentions,
  readTaskComment,
  readTaskCommentMentions,
  readTaskComments,
  replaceCommentMentionsStatements,
  updateTaskCommentStatement,
  type MatterTaskCommentRow,
} from "./comment-statements.ts";
import { commentTopicFor, type TaskCommentPayload } from "./notifications.ts";
import { readTaskAssignees, readTaskWatchers } from "./organisation-statements.ts";
import { requireVisibleTask, type TaskServiceOptions } from "./task-service.ts";
import { memberCanBeAssigned, readMatterTask, type MatterTaskRow } from "./task-statements.ts";
import { MAX_TASK_COMMENTS, MAX_TASK_COMMENT_MENTIONS } from "./types.ts";
import { TaskValidationError, normalizeTaskCommentBody } from "./validation.ts";
import { membersOfTeams } from "./watcher-notices.ts";

export interface TaskComment extends MatterTaskCommentRow {
  readonly mentioned_user_ids: readonly UserId[];
}

export interface TaskCommentInput {
  readonly body: string;
  readonly mentionedUserIds?: readonly UserId[];
}

/** The task's whole thread, oldest first, each comment with the colleagues it names. */
export async function readTaskCommentThread(
  database: SqlDatabase,
  taskId: MatterTaskId,
  options: Pick<TaskServiceOptions, "visibility" | "actorUserId">,
): Promise<readonly TaskComment[]> {
  if (
    (await readMatterTask(database, taskId, options.visibility, options.actorUserId)) === undefined
  ) {
    throw new TaskValidationError("task-unknown", "that task is not a task in this firm");
  }
  const [comments, mentions] = await Promise.all([
    readTaskComments(database, taskId),
    readTaskCommentMentions(database, taskId),
  ]);
  return comments.map((comment) => ({
    ...comment,
    mentioned_user_ids: mentions
      .filter((mention) => mention.comment_id === comment.id)
      .map((mention) => mention.user_id),
  }));
}

export async function addTaskComment(
  database: SqlDatabase,
  taskId: MatterTaskId,
  input: TaskCommentInput,
  options: TaskServiceOptions,
): Promise<{ commentId: MatterTaskCommentId; effect: EffectWrite }> {
  const body = normalizeTaskCommentBody(input.body);
  const task = await requireVisibleTask(database, taskId, options);
  if ((await countTaskComments(database, taskId)) >= MAX_TASK_COMMENTS) {
    throw new TaskValidationError(
      "task-comment-too-many",
      `a task holds at most ${String(MAX_TASK_COMMENTS)} comments; a conversation that long belongs in a meeting or a note`,
    );
  }
  const mentioned = await settleMentions(database, task, input.mentionedUserIds ?? [], options);
  const commentId = newIdentifier("matterTaskComment", options.randomSource);
  const now = options.clock.now();
  const toldOfComment = (await peopleOnTask(database, task)).filter(
    (userId) => userId !== options.actorUserId && !mentioned.includes(userId),
  );
  return {
    commentId,
    effect: {
      statements: [
        insertTaskCommentStatement(database, {
          id: commentId,
          taskId,
          authorUserId: options.actorUserId,
          body,
          now,
        }),
        ...replaceCommentMentionsStatements(database, commentId, mentioned).slice(1),
        commentAudit(database, options, "tasks.task.commented", task, {
          commentId,
          mentionCount: mentioned.length,
        }),
      ],
      outboxMessages: [
        ...commentNotice(task, commentId, mentioned, true, options.actorUserId),
        ...commentNotice(task, commentId, toldOfComment, false, options.actorUserId),
      ],
    },
  };
}

export async function editTaskComment(
  database: SqlDatabase,
  commentId: MatterTaskCommentId,
  input: TaskCommentInput,
  options: TaskServiceOptions,
): Promise<{ effect: EffectWrite }> {
  const body = normalizeTaskCommentBody(input.body);
  const { comment, task } = await requireOwnComment(database, commentId, options);
  const mentioned = await settleMentions(database, task, input.mentionedUserIds ?? [], options);
  const before = new Set(await readCommentMentions(database, commentId));
  const newlyNamed = mentioned.filter((userId) => !before.has(userId));
  return {
    effect: {
      statements: [
        // Matching no row means the comment was removed, or is not the actor's, between the read
        // and this write: the rewording is refused rather than quietly dropped.
        guarded(
          updateTaskCommentStatement(database, {
            id: comment.id,
            authorUserId: options.actorUserId,
            body,
            now: options.clock.now(),
          }),
          "the comment was removed or is not the author's",
        ),
        ...replaceCommentMentionsStatements(database, commentId, mentioned),
        commentAudit(database, options, "tasks.task.commentEdited", task, {
          commentId,
          mentionCount: mentioned.length,
        }),
      ],
      outboxMessages: commentNotice(task, commentId, newlyNamed, true, options.actorUserId),
    },
  };
}

export async function deleteTaskComment(
  database: SqlDatabase,
  commentId: MatterTaskCommentId,
  options: TaskServiceOptions,
): Promise<{ effect: EffectWrite }> {
  const { task } = await requireOwnComment(database, commentId, options);
  return {
    effect: {
      statements: [
        ...deleteTaskCommentStatements(database, commentId),
        commentAudit(database, options, "tasks.task.commentDeleted", task, { commentId }),
      ],
      outboxMessages: [],
    },
  };
}

// ---- the parts ----

// The comment, through a task the reader can reach, and only when it is the reader's own. A comment
// on a task the reader cannot reach is unknown rather than refused, so the answer says nothing about
// a matter they are not on.
async function requireOwnComment(
  database: SqlDatabase,
  commentId: MatterTaskCommentId,
  options: TaskServiceOptions,
): Promise<{ comment: MatterTaskCommentRow; task: MatterTaskRow }> {
  const comment = await readTaskComment(database, commentId);
  if (comment === undefined) {
    throw new TaskValidationError("task-comment-unknown", "that comment is gone");
  }
  let task: MatterTaskRow;
  try {
    task = await requireVisibleTask(database, comment.task_id, options);
  } catch {
    throw new TaskValidationError("task-comment-unknown", "that comment is gone");
  }
  if (comment.author_user_id !== options.actorUserId) {
    throw new TaskValidationError(
      "task-comment-not-yours",
      "only the person who wrote a comment can change or remove it",
    );
  }
  return { comment, task };
}

// The colleagues a comment names, each once, and each an active member who can see the task. Naming
// yourself is allowed and tells nobody.
async function settleMentions(
  database: SqlDatabase,
  task: MatterTaskRow,
  requested: readonly UserId[],
  options: TaskServiceOptions,
): Promise<UserId[]> {
  const mentioned = [...new Set(requested)];
  if (mentioned.length > MAX_TASK_COMMENT_MENTIONS) {
    throw new TaskValidationError(
      "task-comment-mention-invalid",
      `a comment names at most ${String(MAX_TASK_COMMENT_MENTIONS)} colleagues`,
    );
  }
  for (const userId of mentioned) {
    const { memberExists, canSeeMatter } = await memberCanBeAssigned(
      database,
      userId,
      task.matter_id,
      options.visibility,
    );
    if (!memberExists || !canSeeMatter) {
      throw new TaskValidationError(
        "task-comment-mention-invalid",
        "a comment can name only a colleague who can see this task",
      );
    }
  }
  return mentioned;
}

// Everyone the task is assigned to (people, and the members of teams) and everyone watching it.
async function peopleOnTask(database: SqlDatabase, task: MatterTaskRow): Promise<UserId[]> {
  const [assignees, watchers] = await Promise.all([
    readTaskAssignees(database, [task.id]),
    readTaskWatchers(database, [task.id]),
  ]);
  const people = assignees.flatMap((row) => (row.user_id === null ? [] : [row.user_id]));
  const teams = assignees.flatMap((row) => (row.team_id === null ? [] : [row.team_id]));
  const teamMembers = await membersOfTeams(database, teams);
  return [
    ...new Set([
      ...(task.assignee_user_id === null ? [] : [task.assignee_user_id]),
      ...people,
      ...teamMembers,
      ...watchers.map((row) => row.user_id),
    ]),
  ];
}

function commentNotice(
  task: MatterTaskRow,
  commentId: MatterTaskCommentId,
  recipients: readonly UserId[],
  mentioned: boolean,
  actorUserId: UserId,
): OutboxMessage[] {
  const told = [...new Set(recipients)].filter((userId) => userId !== actorUserId);
  if (told.length === 0) return [];
  const payload: TaskCommentPayload = {
    taskId: task.id,
    matterId: task.matter_id,
    commentId,
    recipientUserIds: told,
    commentedByUserId: actorUserId,
    priority: task.priority,
  };
  return [{ topic: commentTopicFor(task.matter_id, mentioned), payload: { ...payload } }];
}

// The audit row says a comment was written, changed or removed, and by whom. Never its words: the
// audit log outlives the comment, and a removed comment must not survive in it.
function commentAudit(
  database: SqlDatabase,
  options: TaskServiceOptions,
  event: string,
  task: MatterTaskRow,
  metadata: Record<string, unknown>,
): SqlStatement {
  return domainAuditStatement(database, {
    event,
    subjectId: task.id,
    actorUserId: options.actorUserId,
    clock: options.clock,
    randomSource: options.randomSource,
    metadata: { matterId: task.matter_id, ...metadata },
  });
}
