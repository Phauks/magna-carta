import { describe, expect, it } from "vitest";
import type { MatterTaskDocumentId, MatterTaskId, UserId } from "@magna-carta/identifiers/types";
import {
  attachFileToMatterTask,
  cancelMatterTask,
  completeMatterTask,
  createMatterTask,
  deleteMatterTask,
  detachFileFromMatterTask,
  editMatterTask,
  reassignMatterTask,
  reopenMatterTask,
} from "../src/task-service.ts";
import {
  countMatterTaskDocuments,
  countOpenMatterTasks,
  readMatterTask,
  readMatterTaskDocuments,
} from "../src/task-statements.ts";
import { TaskValidationError } from "../src/validation.ts";
import { MAX_TASK_TITLE_LENGTH } from "../src/types.ts";
import {
  ACTOR,
  COLLEAGUE,
  DEPARTED,
  MATTER,
  OTHER_MATTER,
  colleagueOptions,
  commit,
  migratedDatabase,
  options,
  seedFile,
  seedFirm,
  visibility,
} from "./support.ts";

const TITLE = "Call Mrs Herrera about the settlement offer";

async function writeTask(input: Partial<Parameters<typeof createMatterTask>[1]> = {}) {
  const { database, raw } = migratedDatabase();
  seedFirm(raw);
  const created = await createMatterTask(
    database,
    { matterId: MATTER, title: TITLE, ...input },
    options,
  );
  await commit(database, created.effect);
  return { database, raw, taskId: created.taskId };
}

describe("creating a task", () => {
  it("records the matter, the title, who put it there and the state", async () => {
    const { database, taskId } = await writeTask();
    const task = await readMatterTask(database, taskId, visibility, ACTOR);
    expect(task?.matter_id).toBe(MATTER);
    expect(task?.title).toBe(TITLE);
    expect(task?.created_by).toBe(ACTOR);
    expect(task?.state).toBe("open");
    // Normal is the default and there is no separate "none": the absence of a signal IS normal.
    expect(task?.priority).toBe("normal");
  });

  it("refuses a title that is only whitespace, and one over the ceiling", async () => {
    const { database, raw } = migratedDatabase();
    seedFirm(raw);
    await expect(
      createMatterTask(database, { matterId: MATTER, title: "   " }, options),
    ).rejects.toThrow(TaskValidationError);
    await expect(
      createMatterTask(
        database,
        { matterId: MATTER, title: "x".repeat(MAX_TASK_TITLE_LENGTH + 1) },
        options,
      ),
    ).rejects.toThrow(TaskValidationError);
  });

  it("stores an empty body as absent, because an empty section is not a body", async () => {
    const { database, taskId } = await writeTask({ body: "   " });
    const task = await readMatterTask(database, taskId, visibility, ACTOR);
    expect(task?.body).toBeNull();
  });

  it("raises no assignment topic when a member assigns themselves", async () => {
    const { database, raw } = migratedDatabase();
    seedFirm(raw);
    const created = await createMatterTask(
      database,
      { matterId: MATTER, title: TITLE, assigneeUserId: ACTOR },
      options,
    );
    // Telling somebody they gave themselves a task is noise that teaches people to ignore the bell.
    expect(created.effect.outboxMessages).toHaveLength(0);
  });

  it("raises a matter-anchored topic for a task on a matter, and a firm one for a task on none", async () => {
    const { database, raw } = migratedDatabase();
    seedFirm(raw);
    const onMatter = await createMatterTask(
      database,
      { matterId: MATTER, title: TITLE, assigneeUserId: COLLEAGUE },
      options,
    );
    expect(onMatter.effect.outboxMessages[0]?.topic).toBe("tasks.task.assigned");
    const offMatter = await createMatterTask(
      database,
      { matterId: null, title: "Renew the malpractice policy", assigneeUserId: COLLEAGUE },
      options,
    );
    // Two topics rather than one with a null field: a notification's visibility is a join on its
    // matter, so "behind the wall" and "not behind it" are two different kinds of row.
    expect(offMatter.effect.outboxMessages[0]?.topic).toBe("tasks.firmTask.assigned");
  });

  it("carries no title in the topic payload", async () => {
    const { database, raw } = migratedDatabase();
    seedFirm(raw);
    const created = await createMatterTask(
      database,
      { matterId: MATTER, title: TITLE, assigneeUserId: COLLEAGUE },
      options,
    );
    const payload = JSON.stringify(created.effect.outboxMessages[0]?.payload ?? {});
    expect(payload).not.toContain("Herrera");
    expect(payload).not.toContain(TITLE);
  });

  it("carries no title in the audit metadata either", async () => {
    const { raw, taskId } = await writeTask();
    const { results } = raw
      .prepare(`SELECT metadata FROM audit_log WHERE subject_id = ?`)
      .all(taskId) as unknown as { results?: unknown };
    const rows = (results ?? []) as { metadata: string | null }[];
    for (const row of rows) expect(row.metadata ?? "").not.toContain("Herrera");
  });
});

describe("assignment", () => {
  it("refuses a member who is not active in this firm", async () => {
    const { database, raw } = migratedDatabase();
    seedFirm(raw);
    await expect(
      createMatterTask(
        database,
        { matterId: MATTER, title: TITLE, assigneeUserId: DEPARTED },
        options,
      ),
    ).rejects.toMatchObject({ code: "task-unknown-assignee" });
  });

  it("refuses a member who cannot see the matter", async () => {
    // The platform-owned holding matter is invisible to every member under the predicate, so
    // assigning work on it is the reachable form of "the assignee cannot open this".
    const { database, raw } = migratedDatabase();
    seedFirm(raw);
    await expect(
      createMatterTask(
        database,
        {
          matterId: "matter_taskHolding00000000000000000" as typeof MATTER,
          title: TITLE,
          assigneeUserId: COLLEAGUE,
        },
        options,
      ),
    ).rejects.toMatchObject({ code: "task-assignee-cannot-see-matter" });
  });

  it("moves a task out of everybody's name without raising a topic", async () => {
    const { database, taskId } = await writeTask({ assigneeUserId: COLLEAGUE });
    const { effect } = await reassignMatterTask(database, taskId, null, options);
    await commit(database, effect);
    const task = await readMatterTask(database, taskId, visibility, ACTOR);
    expect(task?.assignee_user_id).toBeNull();
    // There is nobody to tell.
    expect(effect.outboxMessages).toHaveLength(0);
  });

  it("raises nothing when the assignee does not change", async () => {
    const { database, taskId } = await writeTask({ assigneeUserId: COLLEAGUE });
    const { effect } = await reassignMatterTask(database, taskId, COLLEAGUE, options);
    expect(effect.outboxMessages).toHaveLength(0);
  });
});

describe("the visibility branch", () => {
  it("keeps a task on no matter private to its assignee and whoever created it", async () => {
    const { database, taskId } = await writeTask({
      matterId: null,
      title: "Review the associate's performance",
    });
    // The creator reaches it.
    expect(await readMatterTask(database, taskId, visibility, ACTOR)).toBeDefined();
    // Nobody else does, even holding every task permission there is.
    expect(await readMatterTask(database, taskId, visibility, COLLEAGUE)).toBeUndefined();
  });

  it("lets the assignee of a matterless task reach it", async () => {
    const { database, taskId } = await writeTask({
      matterId: null,
      title: "Renew the malpractice policy",
      assigneeUserId: COLLEAGUE,
    });
    expect(await readMatterTask(database, taskId, visibility, COLLEAGUE)).toBeDefined();
  });

  it("makes a task on a matter reachable by a colleague who is not the assignee", async () => {
    // An assignee is not an access grant and not a screen: a colleague covering the file needs to
    // see what is outstanding on it.
    const { database, taskId } = await writeTask({ assigneeUserId: ACTOR });
    expect(await readMatterTask(database, taskId, visibility, COLLEAGUE)).toBeDefined();
  });
});

describe("state moves", () => {
  it("completes, and refuses a second completion", async () => {
    const { database, taskId } = await writeTask();
    const { effect } = await completeMatterTask(database, taskId, options);
    await commit(database, effect);
    const task = await readMatterTask(database, taskId, visibility, ACTOR);
    expect(task?.state).toBe("done");
    expect(task?.completed_by).toBe(ACTOR);
    expect(task?.completed_at).not.toBeNull();
    await expect(completeMatterTask(database, taskId, options)).rejects.toMatchObject({
      code: "task-not-open",
    });
  });

  it("reopens a completed task and clears the completion columns", async () => {
    const { database, taskId } = await writeTask();
    await commit(database, (await completeMatterTask(database, taskId, options)).effect);
    await commit(database, (await reopenMatterTask(database, taskId, options)).effect);
    const task = await readMatterTask(database, taskId, visibility, ACTOR);
    expect(task?.state).toBe("open");
    expect(task?.completed_at).toBeNull();
    expect(task?.completed_by).toBeNull();
  });

  it("cancels with a reason, and refuses a cancellation with none", async () => {
    const { database, taskId } = await writeTask();
    await expect(cancelMatterTask(database, taskId, "   ", options)).rejects.toMatchObject({
      code: "task-cancellation-reason-required",
    });
    const { effect } = await cancelMatterTask(
      database,
      taskId,
      "Client withdrew the claim",
      options,
    );
    await commit(database, effect);
    const task = await readMatterTask(database, taskId, visibility, ACTOR);
    expect(task?.state).toBe("cancelled");
    expect(task?.cancellation_reason).toBe("Client withdrew the claim");
    expect(task?.cancelled_by).toBe(ACTOR);
  });

  it("keeps the cancellation reason off the audit metadata", async () => {
    const { database, raw, taskId } = await writeTask();
    await commit(
      database,
      (await cancelMatterTask(database, taskId, "Client withdrew the claim", options)).effect,
    );
    const rows = raw
      .prepare(`SELECT metadata FROM audit_log WHERE subject_id = ?`)
      .all(taskId) as unknown as { metadata: string | null }[];
    for (const row of rows) expect(row.metadata ?? "").not.toContain("withdrew");
  });
});

describe("sequencing", () => {
  it("refuses a predecessor on another matter", async () => {
    const { database, taskId } = await writeTask();
    await expect(
      createMatterTask(
        database,
        { matterId: OTHER_MATTER, title: "Second", blockedByTaskId: taskId },
        options,
      ),
    ).rejects.toMatchObject({ code: "task-predecessor-matter-mismatch" });
  });

  it("refuses a cycle, and lets a blocked task be completed anyway", async () => {
    const { database, taskId: first } = await writeTask();
    const second = await createMatterTask(
      database,
      { matterId: MATTER, title: "Second", blockedByTaskId: first },
      options,
    );
    await commit(database, second.effect);
    // Pointing the first at the second closes the loop.
    await expect(
      editMatterTask(database, first, { title: TITLE, blockedByTaskId: second.taskId }, options),
    ).rejects.toMatchObject({ code: "task-blocking-cycle" });
    // A blocked task still completes: the sequence is guidance, not a gate.
    await commit(database, (await completeMatterTask(database, second.taskId, options)).effect);
    const task = await readMatterTask(database, second.taskId, visibility, ACTOR);
    expect(task?.state).toBe("done");
  });

  it("stops anything waiting on a task that is deleted", async () => {
    const { database, taskId: first } = await writeTask();
    const second = await createMatterTask(
      database,
      { matterId: MATTER, title: "Second", blockedByTaskId: first },
      options,
    );
    await commit(database, second.effect);
    await commit(database, (await deleteMatterTask(database, first, options)).effect);
    const successor = await readMatterTask(database, second.taskId, visibility, ACTOR);
    // A pointer left behind would dangle: nothing in SQLite enforces the self-reference.
    expect(successor?.blocked_by_task_id).toBeNull();
  });
});

describe("documents", () => {
  it("links a file on the task's own matter and refuses one on another", async () => {
    const { database, raw, taskId } = await writeTask();
    const ours = seedFile(raw, MATTER, "offer letter.pdf");
    const theirs = seedFile(raw, OTHER_MATTER, "brown will.pdf");
    const attached = await attachFileToMatterTask(database, taskId, ours, options);
    await commit(database, attached.effect);
    expect(await countMatterTaskDocuments(database, taskId)).toBe(1);
    await expect(attachFileToMatterTask(database, taskId, theirs, options)).rejects.toMatchObject({
      code: "task-file-matter-mismatch",
    });
  });

  it("refuses a document on a task that is on no matter", async () => {
    const { database, raw, taskId } = await writeTask({ matterId: null, title: "Firm work" });
    const file = seedFile(raw, MATTER, "offer letter.pdf");
    await expect(attachFileToMatterTask(database, taskId, file, options)).rejects.toMatchObject({
      code: "task-without-matter-has-no-files",
    });
  });

  it("leaves the file alone when the link goes, and when the task goes", async () => {
    const { database, raw, taskId } = await writeTask();
    const file = seedFile(raw, MATTER, "offer letter.pdf");
    const attached = await attachFileToMatterTask(database, taskId, file, options);
    await commit(database, attached.effect);
    await commit(
      database,
      (await detachFileFromMatterTask(database, attached.linkId, options)).effect,
    );
    const stillThere = raw
      .prepare(`SELECT id FROM file WHERE id = ?`)
      .all(file) as unknown as unknown[];
    expect(stillThere).toHaveLength(1);
    // And again through the task's own deletion.
    const second = await attachFileToMatterTask(database, taskId, file, options);
    await commit(database, second.effect);
    await commit(database, (await deleteMatterTask(database, taskId, options)).effect);
    const afterDelete = raw
      .prepare(`SELECT id FROM file WHERE id = ?`)
      .all(file) as unknown as unknown[];
    expect(afterDelete).toHaveLength(1);
    expect(await readMatterTaskDocuments(database, [taskId], visibility, ACTOR)).toHaveLength(0);
  });
});

describe("the matter close advisory's count", () => {
  it("counts open tasks only", async () => {
    const { database, taskId } = await writeTask();
    const second = await createMatterTask(database, { matterId: MATTER, title: "Second" }, options);
    await commit(database, second.effect);
    expect(await countOpenMatterTasks(database, MATTER)).toBe(2);
    await commit(database, (await completeMatterTask(database, taskId, options)).effect);
    expect(await countOpenMatterTasks(database, MATTER)).toBe(1);
  });
});

describe("refusals that never say which", () => {
  it("reports an unreachable task the same way as one that does not exist", async () => {
    const { database, taskId } = await writeTask({ matterId: null, title: "Private" });
    // A colleague cannot reach the creator's matterless task, and the refusal names neither reason.
    await expect(completeMatterTask(database, taskId, colleagueOptions)).rejects.toMatchObject({
      code: "task-unknown",
    });
    await expect(
      completeMatterTask(database, "matterTask_neverExisted00000000" as MatterTaskId, options),
    ).rejects.toMatchObject({ code: "task-unknown" });
  });

  it("reports an unreachable attachment the same way", async () => {
    const { database } = await writeTask();
    await expect(
      detachFileFromMatterTask(
        database,
        "matterTaskDocument_never000000" as MatterTaskDocumentId,
        options,
      ),
    ).rejects.toMatchObject({ code: "task-unknown-file" });
  });
});

describe("who the actor is", () => {
  it("records the acting member on a completion, not the assignee", async () => {
    const { database, taskId } = await writeTask({ assigneeUserId: COLLEAGUE });
    await commit(database, (await completeMatterTask(database, taskId, colleagueOptions)).effect);
    const task = await readMatterTask(database, taskId, visibility, ACTOR);
    expect(task?.completed_by).toBe(COLLEAGUE as UserId);
  });
});
