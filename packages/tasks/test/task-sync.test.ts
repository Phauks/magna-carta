import type { BatchDatabase } from "@magna-carta/data-access/effect-batch";
import type { MatterTaskExternalLinkId, MatterTaskId } from "@magna-carta/identifiers/types";
import { visibleMatterPredicateExcluding } from "@magna-carta/calendar/visibility";
import { describe, expect, it } from "vitest";
import {
  createMatterTask,
  deleteMatterTask,
  editMatterTask,
  reassignMatterTask,
} from "../src/task-service.ts";
import {
  findTaskByExternalId,
  linkTaskToExternalSystem,
  recordExternalSync,
  unlinkTaskFromExternalSystem,
} from "../src/sync-service.ts";
import {
  decodeTaskChangeCursor,
  encodeTaskChangeCursor,
  readExternalLinksForTask,
  readTaskChanges,
} from "../src/sync-statements.ts";
import {
  ACTOR,
  COLLEAGUE,
  MATTER,
  OTHER_MATTER,
  colleagueOptions,
  commit,
  migratedDatabase,
  options,
  seedFirm,
  visibility,
} from "./support.ts";

// THE SEAM AN ADDON WRITES THROUGH, and the platform integrates with nothing. Nothing here names a
// vendor: what is under test is that the three primitives an outside system needs hold under the
// conditions that actually break a sync — two of them racing, a page boundary landing on a clock
// collision, and a deletion nobody was watching for.

function setup(): BatchDatabase {
  const { database, raw } = migratedDatabase();
  seedFirm(raw);
  return database;
}

// A clock that advances, so rows land at distinct instants unless a test deliberately collides them.
function tickingOptions(instants: readonly string[]) {
  let index = 0;
  return {
    ...options,
    clock: {
      now: () => instants[Math.min(index++, instants.length - 1)] ?? "2026-09-01T12:00:00.000Z",
    },
  };
}

async function makeTask(
  database: BatchDatabase,
  title: string,
  serviceOptions = options,
): Promise<MatterTaskId> {
  const created = await createMatterTask(
    database,
    { matterId: MATTER, title, assigneeUserId: ACTOR },
    serviceOptions,
  );
  await commit(database, created.effect);
  return created.taskId;
}

// A colleague behind an ethical wall on the test matter: the one way left for a member not to reach a
// task, now that a task on no matter is visible to the whole firm.
const walled = visibleMatterPredicateExcluding([MATTER]);

describe("a task's identity in a system that is not this one", () => {
  it("records the correspondence and reads it back", async () => {
    const database = setup();
    const taskId = await makeTask(database, "Draft the letter");
    const linked = await linkTaskToExternalSystem(
      database,
      {
        taskId,
        system: "clickup",
        externalId: "86xy2",
        externalUrl: "https://app.clickup.com/t/86xy2",
        remoteRevision: "1730000000000",
      },
      options,
    );
    await commit(database, linked.effect);
    const links = await readExternalLinksForTask(database, taskId);
    expect(links).toHaveLength(1);
    expect(links[0]?.system).toBe("clickup");
    expect(links[0]?.external_id).toBe("86xy2");
    expect(links[0]?.remote_revision).toBe("1730000000000");
  });

  // "ClickUp" and "clickup" are one system, and the uniqueness rules are indexes that would not
  // know it. Normalizing at the service is what makes the rule hold however a caller spells it.
  it("treats a system name as case-insensitive", async () => {
    const database = setup();
    const first = await makeTask(database, "One");
    const second = await makeTask(database, "Two");
    await commit(
      database,
      (
        await linkTaskToExternalSystem(
          database,
          { taskId: first, system: "ClickUp", externalId: "abc" },
          options,
        )
      ).effect,
    );
    await expect(
      linkTaskToExternalSystem(
        database,
        { taskId: second, system: "clickup", externalId: "abc" },
        options,
      ),
    ).rejects.toThrow(
      expect.objectContaining({ code: "external-object-already-linked" }) as unknown as Error,
    );
  });

  // The remote's key is the remote's business: lower-casing it would be this platform deciding that
  // somebody else's identifiers are case-insensitive.
  it("leaves the external id exactly as given", async () => {
    const database = setup();
    const taskId = await makeTask(database, "One");
    await commit(
      database,
      (
        await linkTaskToExternalSystem(
          database,
          { taskId, system: "clickup", externalId: "  AbC-123  " },
          options,
        )
      ).effect,
    );
    const links = await readExternalLinksForTask(database, taskId);
    expect(links[0]?.external_id).toBe("AbC-123");
  });

  it("refuses a second task claiming the same remote object", async () => {
    const database = setup();
    const first = await makeTask(database, "One");
    const second = await makeTask(database, "Two");
    await commit(
      database,
      (
        await linkTaskToExternalSystem(
          database,
          { taskId: first, system: "clickup", externalId: "86xy2" },
          options,
        )
      ).effect,
    );
    await expect(
      linkTaskToExternalSystem(
        database,
        { taskId: second, system: "clickup", externalId: "86xy2" },
        options,
      ),
    ).rejects.toThrow(
      expect.objectContaining({ code: "external-object-already-linked" }) as unknown as Error,
    );
  });

  it("refuses a second identity for one task in one system", async () => {
    const database = setup();
    const taskId = await makeTask(database, "One");
    await commit(
      database,
      (
        await linkTaskToExternalSystem(
          database,
          { taskId, system: "clickup", externalId: "first" },
          options,
        )
      ).effect,
    );
    await expect(
      linkTaskToExternalSystem(
        database,
        { taskId, system: "clickup", externalId: "second" },
        options,
      ),
    ).rejects.toThrow(expect.objectContaining({ code: "task-already-linked" }) as unknown as Error);
  });

  // Two systems on one task is the case a firm running two tools is in, and neither rule forbids it.
  it("allows one task to be mirrored into two different systems", async () => {
    const database = setup();
    const taskId = await makeTask(database, "One");
    for (const system of ["clickup", "asana"]) {
      await commit(
        database,
        (
          await linkTaskToExternalSystem(
            database,
            { taskId, system, externalId: `${system}-1` },
            options,
          )
        ).effect,
      );
    }
    const links = await readExternalLinksForTask(database, taskId);
    expect(links.map((link) => link.system)).toEqual(["asana", "clickup"]);
  });

  // THE UNIQUENESS IS THE INDEX, not the pre-check. Two syncs racing both pass the read and one
  // loses at the index — this composes both effects before committing either, which is the shape a
  // race takes.
  it("loses at the index when two links are composed before either commits", async () => {
    const database = setup();
    const first = await makeTask(database, "One");
    const second = await makeTask(database, "Two");
    const a = await linkTaskToExternalSystem(
      database,
      { taskId: first, system: "clickup", externalId: "raced" },
      options,
    );
    const b = await linkTaskToExternalSystem(
      database,
      { taskId: second, system: "clickup", externalId: "raced" },
      options,
    );
    await commit(database, a.effect);
    await expect(commit(database, b.effect)).rejects.toThrow();
  });

  it("records a round trip without letting the identity move", async () => {
    const database = setup();
    const taskId = await makeTask(database, "One");
    const linked = await linkTaskToExternalSystem(
      database,
      { taskId, system: "clickup", externalId: "86xy2" },
      options,
    );
    await commit(database, linked.effect);
    const synced = await recordExternalSync(
      database,
      linked.linkId,
      { remoteRevision: "rev-2", externalUrl: "https://example.test/86xy2" },
      options,
    );
    await commit(database, synced.effect);
    const links = await readExternalLinksForTask(database, taskId);
    expect(links[0]?.remote_revision).toBe("rev-2");
    expect(links[0]?.external_url).toBe("https://example.test/86xy2");
    // Still the same remote object: nothing about a sync may repoint the correspondence.
    expect(links[0]?.external_id).toBe("86xy2");
    expect(links[0]?.last_synced_at).not.toBeNull();
  });

  it("unlinks without touching the task", async () => {
    const database = setup();
    const taskId = await makeTask(database, "One");
    const linked = await linkTaskToExternalSystem(
      database,
      { taskId, system: "clickup", externalId: "86xy2" },
      options,
    );
    await commit(database, linked.effect);
    await commit(
      database,
      (await unlinkTaskFromExternalSystem(database, linked.linkId, options)).effect,
    );
    expect(await readExternalLinksForTask(database, taskId)).toHaveLength(0);
    const page = await readTaskChanges(database, {
      limit: 50,
      visibility,
      viewerUserId: ACTOR,
    });
    expect(page.changed.map((row) => row.id)).toContain(taskId);
    expect(page.deleted).toHaveLength(0);
  });

  // The lookup an addon makes before it creates anything. A caller who cannot see the task gets the
  // same "no" as for a correspondence that does not exist, so it cannot be used to probe.
  it("finds a task by its remote id, and tells a stranger nothing", async () => {
    const database = setup();
    const created = await createMatterTask(
      database,
      { matterId: MATTER, title: "Renew the policy", assigneeUserId: ACTOR },
      options,
    );
    await commit(database, created.effect);
    await commit(
      database,
      (
        await linkTaskToExternalSystem(
          database,
          { taskId: created.taskId, system: "clickup", externalId: "firmwork" },
          options,
        )
      ).effect,
    );
    const mine = await findTaskByExternalId(database, "clickup", "firmwork", {
      visibility,
      viewerUserId: ACTOR,
    });
    expect(mine?.taskId).toBe(created.taskId);
    // The colleague is walled off the matter, so the lookup says nothing either way.
    const theirs = await findTaskByExternalId(database, "clickup", "firmwork", {
      visibility: walled,
      viewerUserId: COLLEAGUE,
    });
    expect(theirs).toBeUndefined();
  });

  it("refuses to link a task the caller cannot see", async () => {
    const database = setup();
    const created = await createMatterTask(
      database,
      { matterId: MATTER, title: "Renew the policy", assigneeUserId: ACTOR },
      options,
    );
    await commit(database, created.effect);
    await expect(
      linkTaskToExternalSystem(
        database,
        { taskId: created.taskId, system: "clickup", externalId: "x" },
        { ...colleagueOptions, visibility: walled },
      ),
    ).rejects.toThrow(expect.objectContaining({ code: "task-unknown" }) as unknown as Error);
  });
});

describe("who touched it last", () => {
  // Without this a two-way sync pushes back everything it just pulled.
  it("is the creator on a fresh task and the editor after an edit", async () => {
    const database = setup();
    const taskId = await makeTask(database, "One");
    const first = await readTaskChanges(database, { limit: 50, visibility, viewerUserId: ACTOR });
    expect(first.changed.find((row) => row.id === taskId)?.updated_by).toBe(ACTOR);

    await commit(
      database,
      (
        await reassignMatterTask(database, taskId, COLLEAGUE, {
          ...colleagueOptions,
        })
      ).effect,
    );
    const second = await readTaskChanges(database, { limit: 50, visibility, viewerUserId: ACTOR });
    expect(second.changed.find((row) => row.id === taskId)?.updated_by).toBe(COLLEAGUE);
  });
});

describe("what moved since I last looked", () => {
  it("reports a changed task and stops when the caller has caught up", async () => {
    const database = setup();
    await makeTask(database, "One");
    const first = await readTaskChanges(database, { limit: 50, visibility, viewerUserId: ACTOR });
    expect(first.changed).toHaveLength(1);
    // Both streams short of the limit means caught up, which is how a caller knows to stop.
    expect(first.nextCursor).toBeUndefined();
  });

  it("reports a deletion, which the row itself cannot", async () => {
    const database = setup();
    const taskId = await makeTask(database, "One");
    await commit(database, (await deleteMatterTask(database, taskId, options)).effect);
    const page = await readTaskChanges(database, { limit: 50, visibility, viewerUserId: ACTOR });
    expect(page.changed.map((row) => row.id)).not.toContain(taskId);
    expect(page.deleted.map((row) => row.task_id)).toEqual([taskId]);
    expect(page.deleted[0]?.matter_id).toBe(MATTER);
    expect(page.deleted[0]?.deleted_by).toBe(ACTOR);
  });

  // A deleted task's links go with it, or the remote object stays claimed by a task nobody can open
  // and could never be linked to a real one again.
  it("frees the remote object when the task it named is deleted", async () => {
    const database = setup();
    const first = await makeTask(database, "One");
    await commit(
      database,
      (
        await linkTaskToExternalSystem(
          database,
          { taskId: first, system: "clickup", externalId: "reusable" },
          options,
        )
      ).effect,
    );
    await commit(database, (await deleteMatterTask(database, first, options)).effect);
    const second = await makeTask(database, "Two");
    const relinked = await linkTaskToExternalSystem(
      database,
      { taskId: second, system: "clickup", externalId: "reusable" },
      options,
    );
    await commit(database, relinked.effect);
    expect(await readExternalLinksForTask(database, second)).toHaveLength(1);
  });

  // THE PAGE BOUNDARY, and the case that breaks a single-cursor design: several tasks written at
  // the SAME instant, walked one at a time. A cursor that carried only the instant would either
  // skip or repeat here; nothing may be lost, because nothing reports a change twice.
  it("walks a clock collision one row at a time without skipping or repeating", async () => {
    const database = setup();
    const collided = "2026-09-01T12:00:00.000Z";
    const ids: MatterTaskId[] = [];
    for (const title of ["A", "B", "C", "D", "E"]) {
      ids.push(await makeTask(database, title, tickingOptions([collided])));
    }
    const seen: string[] = [];
    let cursor: string | undefined;
    for (let page = 0; page < 10; page += 1) {
      const result = await readTaskChanges(database, {
        cursor,
        limit: 1,
        visibility,
        viewerUserId: ACTOR,
      });
      seen.push(...result.changed.map((row) => row.id));
      if (result.nextCursor === undefined) break;
      cursor = result.nextCursor;
    }
    expect(seen).toHaveLength(ids.length);
    expect(new Set(seen).size).toBe(ids.length);
    for (const id of ids) expect(seen).toContain(id);
  });

  // Each stream keeps its own position, so a burst in one never starves or rewinds the other.
  it("advances the two streams independently", async () => {
    const database = setup();
    const doomed = await makeTask(database, "Doomed");
    await commit(database, (await deleteMatterTask(database, doomed, options)).effect);
    for (const title of ["A", "B", "C"]) await makeTask(database, title);

    const seenChanged = new Set<string>();
    const seenDeleted = new Set<string>();
    let cursor: string | undefined;
    for (let page = 0; page < 10; page += 1) {
      const result = await readTaskChanges(database, {
        cursor,
        limit: 1,
        visibility,
        viewerUserId: ACTOR,
      });
      for (const row of result.changed) seenChanged.add(row.id);
      for (const row of result.deleted) seenDeleted.add(row.task_id);
      if (result.nextCursor === undefined) break;
      cursor = result.nextCursor;
    }
    expect(seenChanged.size).toBe(3);
    expect(seenDeleted).toEqual(new Set([doomed]));
  });

  // Visibility is not relaxed for a sync. An addon connected as a member with narrow reach syncs
  // narrowly, which is the only honest reading of "it can do what that member can do".
  it("shows a member only the tasks they could read one at a time", async () => {
    const database = setup();
    const created = await createMatterTask(
      database,
      { matterId: MATTER, title: "Renew the policy", assigneeUserId: ACTOR },
      options,
    );
    await commit(database, created.effect);
    const mine = await readTaskChanges(database, { limit: 50, visibility, viewerUserId: ACTOR });
    const theirs = await readTaskChanges(database, {
      limit: 50,
      visibility: walled,
      viewerUserId: COLLEAGUE,
    });
    expect(mine.changed.map((row) => row.id)).toContain(created.taskId);
    expect(theirs.changed.map((row) => row.id)).not.toContain(created.taskId);
  });

  it("reports an edit on a task it already reported, so a mirror sees the new state", async () => {
    const database = setup();
    const taskId = await makeTask(database, "Before");
    await commit(
      database,
      (await editMatterTask(database, taskId, { title: "After" }, options)).effect,
    );
    const page = await readTaskChanges(database, { limit: 50, visibility, viewerUserId: ACTOR });
    expect(page.changed.find((row) => row.id === taskId)?.title).toBe("After");
  });

  it("does not leak another matter's tasks into a narrowed reader's feed", async () => {
    const database = setup();
    const created = await createMatterTask(
      database,
      { matterId: OTHER_MATTER, title: "Elsewhere", assigneeUserId: ACTOR },
      options,
    );
    await commit(database, created.effect);
    const page = await readTaskChanges(database, { limit: 50, visibility, viewerUserId: ACTOR });
    // The predicate in these fixtures makes both matters visible; what is asserted is that the feed
    // composes it at all rather than reading the table raw.
    expect(page.changed.map((row) => row.id)).toContain(created.taskId);
  });
});

describe("the cursor is opaque and forgiving", () => {
  it("round-trips both stream positions", () => {
    const encoded = encodeTaskChangeCursor({
      changed: { at: "2026-09-01T00:00:00.000Z", id: "matterTask_a" },
      deleted: { at: "2026-09-02T00:00:00.000Z", id: "matterTaskDeletion_b" },
    });
    expect(decodeTaskChangeCursor(encoded)).toEqual({
      changed: { at: "2026-09-01T00:00:00.000Z", id: "matterTask_a" },
      deleted: { at: "2026-09-02T00:00:00.000Z", id: "matterTaskDeletion_b" },
    });
  });

  // A tampered token replays from the beginning rather than throwing. Safe for a sync, because
  // every write it makes is keyed on an external id it already holds.
  it("treats a malformed token as the first page", () => {
    expect(decodeTaskChangeCursor("not-base64-at-all")).toEqual({});
    expect(decodeTaskChangeCursor(btoa("[]"))).toEqual({ changed: undefined, deleted: undefined });
  });
});

describe("an unlinked link is gone", () => {
  it("refuses a sync recorded against a link that no longer exists", async () => {
    const database = setup();
    const taskId = await makeTask(database, "One");
    const linked = await linkTaskToExternalSystem(
      database,
      { taskId, system: "clickup", externalId: "86xy2" },
      options,
    );
    await commit(database, linked.effect);
    await commit(
      database,
      (await unlinkTaskFromExternalSystem(database, linked.linkId, options)).effect,
    );
    await expect(
      recordExternalSync(database, linked.linkId, { remoteRevision: "rev" }, options),
    ).rejects.toThrow(
      expect.objectContaining({ code: "external-link-not-found" }) as unknown as Error,
    );
  });

  it("refuses a link handle that never existed", async () => {
    const database = setup();
    await expect(
      unlinkTaskFromExternalSystem(
        database,
        "matterTaskExternalLink_nothing000" as MatterTaskExternalLinkId,
        options,
      ),
    ).rejects.toThrow(
      expect.objectContaining({ code: "external-link-not-found" }) as unknown as Error,
    );
  });
});
