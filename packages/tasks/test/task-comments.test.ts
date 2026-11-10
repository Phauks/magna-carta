/*
 * A task's comment thread. Each case pins one rule: who is told of a comment and who is not, that a
 * named colleague is told once and must be able to see the task, that only the author may reword or
 * remove a comment, what the audit log keeps, and that deleting a task takes its thread with it.
 */
import type { BatchDatabase } from "@magna-carta/data-access/effect-batch";
import type { MatterTaskId, UserId } from "@magna-carta/identifiers/types";
import { describe, expect, it } from "vitest";
import {
  addTaskComment,
  deleteTaskComment,
  editTaskComment,
  readTaskCommentThread,
} from "../src/comment-service.ts";
import { readTaskComments } from "../src/comment-statements.ts";
import {
  FIRM_TASK_COMMENTED_TOPIC,
  TASK_COMMENTED_TOPIC,
  TASK_COMMENT_MENTIONED_TOPIC,
} from "../src/notifications.ts";
import { setTaskWatchers } from "../src/organisation-service.ts";
import { createMatterTask, deleteMatterTask } from "../src/task-service.ts";
import { TaskValidationError } from "../src/validation.ts";
import {
  ACTOR,
  COLLEAGUE,
  DEPARTED,
  MATTER,
  colleagueOptions,
  commit,
  migratedDatabase,
  options,
  seedFirm,
  visibility,
} from "./support.ts";

const WATCHER = "user_taskWatcher0000" as UserId;

function setup(): { database: BatchDatabase; raw: ReturnType<typeof migratedDatabase>["raw"] } {
  const database = migratedDatabase();
  seedFirm(database.raw);
  database.raw.exec(
    `INSERT INTO member (user_id, display_name, status, created_at) VALUES ('${WATCHER}', 'A Watcher', 'active', '2026-08-01T00:00:00.000Z')`,
  );
  return { database: database.database, raw: database.raw };
}

async function task(
  database: BatchDatabase,
  matterId: typeof MATTER | null = MATTER,
): Promise<MatterTaskId> {
  const created = await createMatterTask(
    database,
    { matterId, title: "Draft the reply brief", assigneeUserId: COLLEAGUE },
    options,
  );
  await commit(database, created.effect);
  await commit(
    database,
    (await setTaskWatchers(database, created.taskId, [WATCHER], options)).effect,
  );
  return created.taskId;
}

function payloadOf(message: { payload: unknown } | undefined): Record<string, unknown> {
  return (message?.payload ?? {}) as Record<string, unknown>;
}

async function refusal(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (caught) {
    if (caught instanceof TaskValidationError) return caught.code;
    throw caught;
  }
  return "no refusal";
}

describe("a task's comment thread", () => {
  it("tells the assignee and the watchers of a new comment, never its author", async () => {
    const { database } = setup();
    const taskId = await task(database);
    const { effect } = await addTaskComment(database, taskId, { body: "Filed today." }, options);
    expect(effect.outboxMessages).toHaveLength(1);
    const [message] = effect.outboxMessages;
    expect(message?.topic).toBe(TASK_COMMENTED_TOPIC);
    expect(payloadOf(message)["recipientUserIds"]).toEqual([COLLEAGUE, WATCHER]);
    expect(JSON.stringify(message === undefined ? null : payloadOf(message))).not.toContain(
      "Filed today",
    );
  });

  it("tells a named colleague once, by the mention, and not again as a watcher", async () => {
    const { database } = setup();
    const taskId = await task(database);
    const { effect } = await addTaskComment(
      database,
      taskId,
      { body: "@A Watcher can you check the exhibits?", mentionedUserIds: [WATCHER] },
      options,
    );
    const topics = effect.outboxMessages.map((message) => [
      message.topic,
      payloadOf(message)["recipientUserIds"],
    ]);
    expect(topics).toEqual([
      [TASK_COMMENT_MENTIONED_TOPIC, [WATCHER]],
      [TASK_COMMENTED_TOPIC, [COLLEAGUE]],
    ]);
  });

  it("uses the firm topics for a task on no matter", async () => {
    const { database } = setup();
    const taskId = await task(database, null);
    const { effect } = await addTaskComment(database, taskId, { body: "Renewed." }, options);
    expect(effect.outboxMessages[0]?.topic).toBe(FIRM_TASK_COMMENTED_TOPIC);
  });

  it("refuses to name somebody who is not an active member", async () => {
    const { database } = setup();
    const taskId = await task(database);
    expect(
      await refusal(
        addTaskComment(
          database,
          taskId,
          { body: "Ask Sarah", mentionedUserIds: [DEPARTED] },
          options,
        ),
      ),
    ).toBe("task-comment-mention-invalid");
  });

  it("reads the thread oldest first, with who each comment names", async () => {
    const { database } = setup();
    const taskId = await task(database);
    await commit(
      database,
      (await addTaskComment(database, taskId, { body: "First" }, options)).effect,
    );
    const later = { ...colleagueOptions, clock: { now: () => "2026-09-01T13:00:00.000Z" } };
    await commit(
      database,
      (
        await addTaskComment(
          database,
          taskId,
          { body: "Second, @Task Tester", mentionedUserIds: [ACTOR] },
          later,
        )
      ).effect,
    );
    const thread = await readTaskCommentThread(database, taskId, {
      visibility,
      actorUserId: ACTOR,
    });
    expect(thread.map((comment) => [comment.body, comment.mentioned_user_ids])).toEqual([
      ["First", []],
      ["Second, @Task Tester", [ACTOR]],
    ]);
  });

  it("lets only the author reword a comment, marks it edited, and tells only the newly named", async () => {
    const { database } = setup();
    const taskId = await task(database);
    const added = await addTaskComment(
      database,
      taskId,
      { body: "@A Watcher see this", mentionedUserIds: [WATCHER] },
      options,
    );
    await commit(database, added.effect);
    expect(
      await refusal(
        editTaskComment(database, added.commentId, { body: "Mine now" }, colleagueOptions),
      ),
    ).toBe("task-comment-not-yours");
    const later = { ...options, clock: { now: () => "2026-09-01T14:00:00.000Z" } };
    const edited = await editTaskComment(
      database,
      added.commentId,
      { body: "@A Watcher and @A Colleague see this", mentionedUserIds: [WATCHER, COLLEAGUE] },
      later,
    );
    expect(
      edited.effect.outboxMessages.map((message) => payloadOf(message)["recipientUserIds"]),
    ).toEqual([[COLLEAGUE]]);
    await commit(database, edited.effect);
    const [comment] = await readTaskComments(database, taskId);
    expect(comment?.body).toBe("@A Watcher and @A Colleague see this");
    expect(comment?.edited_at).toBe("2026-09-01T14:00:00.000Z");
  });

  it("lets only the author remove a comment, and the audit log keeps no words", async () => {
    const { database, raw } = setup();
    const taskId = await task(database);
    const added = await addTaskComment(database, taskId, { body: "Privileged thought" }, options);
    await commit(database, added.effect);
    expect(await refusal(deleteTaskComment(database, added.commentId, colleagueOptions))).toBe(
      "task-comment-not-yours",
    );
    await commit(database, (await deleteTaskComment(database, added.commentId, options)).effect);
    expect(await readTaskComments(database, taskId)).toEqual([]);
    const audit = raw
      .prepare(`SELECT event, metadata FROM audit_log WHERE subject_id = ?`)
      .all(taskId) as { event: string; metadata: string }[];
    expect(audit.map((row) => row.event)).toEqual(
      expect.arrayContaining(["tasks.task.commented", "tasks.task.commentDeleted"]),
    );
    expect(JSON.stringify(audit)).not.toContain("Privileged thought");
  });

  it("takes the thread with a deleted task", async () => {
    const { database } = setup();
    const taskId = await task(database);
    await commit(
      database,
      (
        await addTaskComment(
          database,
          taskId,
          { body: "@A Watcher", mentionedUserIds: [WATCHER] },
          options,
        )
      ).effect,
    );
    await commit(database, (await deleteMatterTask(database, taskId, options)).effect);
    expect(await readTaskComments(database, taskId)).toEqual([]);
  });

  it("refuses an empty comment", async () => {
    const { database } = setup();
    const taskId = await task(database);
    expect(await refusal(addTaskComment(database, taskId, { body: "   " }, options))).toBe(
      "task-comment-invalid",
    );
  });
});
