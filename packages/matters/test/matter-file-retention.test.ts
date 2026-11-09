import { createMigratedNodeDatabase } from "@magna-carta/database/node-sqlite";
import type { MatterId, UserId } from "@magna-carta/identifiers/types";
import { civilDateOf } from "@magna-carta/civil-time/civil-date";
import { describe, expect, it } from "vitest";
import { writeFirmSettingStatement } from "@magna-carta/data-access/setting-statements";
import { closeMatter, reopenMatter } from "../src/matter-service.ts";
import { fileRetentionMinimumYearsDefinition } from "../src/settings.ts";
import {
  MATTER_FILE_DESTRUCTION_DATE_CLEARED_EVENT,
  earliestFileDestructionDate,
  MATTER_FILE_DESTRUCTION_DATE_SET_EVENT,
  composeSetMatterFileDestructionDate,
  readMatterFileDestructionDate,
} from "../src/matter-file-retention.ts";
import { selectMatterDetailStatement } from "../src/matter-statements.ts";
import { MatterValidationError } from "../src/validation.ts";

// The date a matter's paper file may be destroyed on or after. A date a person states: the write
// path refuses a day that does not exist, keeps one date per matter, clears by deleting, and leaves
// every date it replaced in the audit log — the row only ever holds the current one.

const MEMBER_ID = "user_retentiontest00000" as UserId;
const OTHER_MEMBER_ID = "user_retentiontest00001" as UserId;
const MATTER_ID = "matter_retentiontest000" as MatterId;
const HOLDING_MATTER_ID = "matter_retentionhold000" as MatterId;

function freshDatabase() {
  return createMigratedNodeDatabase("per-firm").database;
}

type Database = ReturnType<typeof freshDatabase>;

async function seed(database: Database): Promise<void> {
  const t = "2026-01-01T00:00:00.000Z";
  for (const member of [MEMBER_ID, OTHER_MEMBER_ID]) {
    await database
      .prepare(
        "INSERT INTO member (user_id, display_name, status, created_at) VALUES (?1, 'M', 'active', ?2)",
      )
      .bind(member, t)
      .run();
  }
  await database
    .prepare(
      "INSERT INTO matter (id, title, status, responsible_member_id, opened_at, closed_at, created_at, updated_at) VALUES (?1, 'T', 'closed', ?2, ?3, '2026-11-09T10:00:00.000Z', ?3, ?3)",
    )
    .bind(MATTER_ID, MEMBER_ID, t)
    .run();
  await database
    .prepare(
      "INSERT INTO matter (id, title, status, responsible_member_id, system_key, created_at, updated_at) VALUES (?1, 'Holding', 'open', ?2, 'custody-holding', ?3, ?3)",
    )
    .bind(HOLDING_MATTER_ID, MEMBER_ID, t)
    .run();
}

function contextAt(now: string, actorUserId: UserId = MEMBER_ID) {
  return { clock: { now: () => now }, actorUserId };
}

async function write(
  database: Database,
  destroyOn: string | null,
  context = contextAt("2026-11-09T12:00:00.000Z"),
  matterId: MatterId = MATTER_ID,
) {
  const built = await composeSetMatterFileDestructionDate(database, matterId, destroyOn, context);
  for (const statement of built.statements) await statement.run();
  return built.value;
}

async function refusalOf(promise: Promise<unknown>): Promise<MatterValidationError> {
  try {
    await promise;
  } catch (caught) {
    expect(caught).toBeInstanceOf(MatterValidationError);
    return caught as MatterValidationError;
  }
  throw new Error("expected a MatterValidationError refusal");
}

async function auditRows(database: Database) {
  const { results } = await database
    .prepare(
      "SELECT event, subject_id, actor_user_id, metadata FROM audit_log WHERE event LIKE 'matter.file_destruction_date.%' ORDER BY created_at, id",
    )
    .all<{ event: string; subject_id: string; actor_user_id: string; metadata: string }>();
  return results.map((row) => ({ ...row, metadata: JSON.parse(row.metadata) as unknown }));
}

describe("recording a matter's file destruction date", () => {
  it("records the date, who stated it and when, and the matter detail reads it back", async () => {
    const database = freshDatabase();
    await seed(database);
    const value = await write(database, "2033-11-09");
    expect(value).toEqual({
      matterId: MATTER_ID,
      destroyOn: "2033-11-09",
      recordedByUserId: MEMBER_ID,
      recordedAt: "2026-11-09T12:00:00.000Z",
    });
    expect(await readMatterFileDestructionDate(database, MATTER_ID)).toEqual(value);
    const { results } = await selectMatterDetailStatement(database, MATTER_ID).all<{
      file_destroy_on: string | null;
    }>();
    expect(results[0]?.file_destroy_on).toBe("2033-11-09");
  });

  it("keeps one date per matter: a change replaces it and the audit names the date it replaced", async () => {
    const database = freshDatabase();
    await seed(database);
    await write(database, "2033-11-09");
    await write(database, "2034-01-31", contextAt("2026-11-10T09:00:00.000Z", OTHER_MEMBER_ID));
    const now = await readMatterFileDestructionDate(database, MATTER_ID);
    expect(now.destroyOn).toBe("2034-01-31");
    expect(now.recordedByUserId).toBe(OTHER_MEMBER_ID);
    const { results } = await database
      .prepare("SELECT COUNT(*) AS rows FROM matter_file_retention")
      .all<{ rows: number }>();
    expect(results[0]?.rows).toBe(1);
    expect(await auditRows(database)).toEqual([
      {
        event: MATTER_FILE_DESTRUCTION_DATE_SET_EVENT,
        subject_id: MATTER_ID,
        actor_user_id: MEMBER_ID,
        metadata: { previousDestroyOn: null, destroyOn: "2033-11-09" },
      },
      {
        event: MATTER_FILE_DESTRUCTION_DATE_SET_EVENT,
        subject_id: MATTER_ID,
        actor_user_id: OTHER_MEMBER_ID,
        metadata: { previousDestroyOn: "2033-11-09", destroyOn: "2034-01-31" },
      },
    ]);
  });

  it("clears by deleting the row, and the audit keeps the date that was cleared", async () => {
    const database = freshDatabase();
    await seed(database);
    await write(database, "2033-11-09");
    const cleared = await write(database, null, contextAt("2026-11-11T00:00:00.000Z"));
    expect(cleared.destroyOn).toBeNull();
    expect((await readMatterFileDestructionDate(database, MATTER_ID)).destroyOn).toBeNull();
    const audit = await auditRows(database);
    expect(audit.at(-1)).toEqual({
      event: MATTER_FILE_DESTRUCTION_DATE_CLEARED_EVENT,
      subject_id: MATTER_ID,
      actor_user_id: MEMBER_ID,
      metadata: { previousDestroyOn: "2033-11-09", destroyOn: null },
    });
  });

  it("deletes nothing else: the matter and its other records are untouched", async () => {
    const database = freshDatabase();
    await seed(database);
    await write(database, "2020-01-01");
    const { results } = await database
      .prepare("SELECT id, status FROM matter WHERE id = ?1")
      .bind(MATTER_ID)
      .all<{ id: string; status: string }>();
    expect(results).toEqual([{ id: MATTER_ID, status: "closed" }]);
  });

  it("refuses a date that is not a real calendar day, before any statement is built", async () => {
    const database = freshDatabase();
    await seed(database);
    for (const garbage of [
      "2026-02-30",
      "2033-13-01",
      "next year",
      "2033-11-09T00:00:00.000Z",
      "",
    ]) {
      const refusal = await refusalOf(
        composeSetMatterFileDestructionDate(database, MATTER_ID, garbage, contextAt("x")),
      );
      expect(refusal.code).toBe("invalid-file-destruction-date");
    }
  });

  it("refuses a matter that does not exist, and the platform's own holding matter", async () => {
    const database = freshDatabase();
    await seed(database);
    for (const matterId of ["matter_nosuchmatter0000" as MatterId, HOLDING_MATTER_ID]) {
      const refusal = await refusalOf(
        composeSetMatterFileDestructionDate(database, matterId, "2033-11-09", contextAt("x")),
      );
      expect(refusal.code).toBe("matter-not-found");
    }
  });

  it("the table itself refuses a value that is not date-shaped", async () => {
    const database = freshDatabase();
    await seed(database);
    const insert = database
      .prepare(
        "INSERT INTO matter_file_retention (matter_id, destroy_on, recorded_by_user_id, recorded_at) VALUES (?1, 'soon', ?2, '2026-11-09T00:00:00.000Z')",
      )
      .bind(MATTER_ID, MEMBER_ID);
    // node:sqlite throws as the statement runs rather than rejecting the promise it would return.
    await expect(async () => insert.run()).rejects.toThrow(/destroy_on_shape_check/);
  });
});

const OPEN_MATTER_ID = "matter_retentionopen000" as MatterId;

async function seedOpenMatter(database: Database): Promise<void> {
  await database
    .prepare(
      "INSERT INTO matter (id, title, status, responsible_member_id, opened_at, created_at, updated_at) VALUES (?1, 'Open', 'open', ?2, ?3, ?3, ?3)",
    )
    .bind(OPEN_MATTER_ID, MEMBER_ID, "2026-01-01T00:00:00.000Z")
    .run();
}

async function setMinimum(database: Database, years: number): Promise<void> {
  await writeFirmSettingStatement(
    database,
    fileRetentionMinimumYearsDefinition,
    years,
    "2026-01-01T00:00:00.000Z",
  ).run();
}

const serviceOptions = (now: string) => ({
  clock: { now: () => now, today: () => civilDateOf(Date.parse(now)) },
  actorUserId: MEMBER_ID,
});

describe("the firm's minimum retention", () => {
  it("measures whole years from the day of the close, and a leap day rolls forward", () => {
    expect(earliestFileDestructionDate("2026-11-09T10:00:00.000Z", 7)).toBe("2033-11-09");
    expect(earliestFileDestructionDate("2028-02-29T23:00:00.000Z", 1)).toBe("2029-03-01");
    // No minimum is no floor at all, never a period the platform chose.
    expect(earliestFileDestructionDate("2026-11-09T10:00:00.000Z", 0)).toBeNull();
  });

  it("refuses a later write earlier than the floor, and allows the floor, a later date and none", async () => {
    const database = freshDatabase();
    await seed(database);
    await setMinimum(database, 7);
    const refusal = await refusalOf(
      composeSetMatterFileDestructionDate(database, MATTER_ID, "2033-11-08", contextAt("x")),
    );
    expect(refusal.code).toBe("file-destruction-date-before-minimum");
    expect(refusal.message).toContain("2033-11-09");
    expect((await write(database, "2033-11-09")).destroyOn).toBe("2033-11-09");
    expect((await write(database, "2040-01-01")).destroyOn).toBe("2040-01-01");
    expect((await write(database, null)).destroyOn).toBeNull();
  });

  it("refuses a date on a matter that is not closed, because the close is where it is set", async () => {
    const database = freshDatabase();
    await seed(database);
    await seedOpenMatter(database);
    const refusal = await refusalOf(
      composeSetMatterFileDestructionDate(database, OPEN_MATTER_ID, "2040-01-01", contextAt("x")),
    );
    expect(refusal.code).toBe("matter-not-closed");
  });
});

describe("the close and the reopen", () => {
  it("records the date the close states, in the close's own batch", async () => {
    const database = freshDatabase();
    await seed(database);
    await seedOpenMatter(database);
    await setMinimum(database, 5);
    await closeMatter(database, OPEN_MATTER_ID, serviceOptions("2026-11-09T15:00:00.000Z"), {
      fileDestroyOn: "2031-11-09",
    });
    expect((await readMatterFileDestructionDate(database, OPEN_MATTER_ID)).destroyOn).toBe(
      "2031-11-09",
    );
  });

  it("refuses the close itself when the date is under the minimum, so nothing closes", async () => {
    const database = freshDatabase();
    await seed(database);
    await seedOpenMatter(database);
    await setMinimum(database, 5);
    const refusal = await refusalOf(
      closeMatter(database, OPEN_MATTER_ID, serviceOptions("2026-11-09T15:00:00.000Z"), {
        fileDestroyOn: "2030-01-01",
      }),
    );
    expect(refusal.code).toBe("file-destruction-date-before-minimum");
    const { results } = await database
      .prepare("SELECT status FROM matter WHERE id = ?1")
      .bind(OPEN_MATTER_ID)
      .all<{ status: string }>();
    expect(results[0]?.status).toBe("open");
  });

  it("closes with no date when the close says none", async () => {
    const database = freshDatabase();
    await seed(database);
    await seedOpenMatter(database);
    await setMinimum(database, 5);
    await closeMatter(database, OPEN_MATTER_ID, serviceOptions("2026-11-09T15:00:00.000Z"), {
      fileDestroyOn: null,
    });
    expect((await readMatterFileDestructionDate(database, OPEN_MATTER_ID)).destroyOn).toBeNull();
  });

  it("clears the date when the matter reopens, and the audit keeps it", async () => {
    const database = freshDatabase();
    await seed(database);
    await seedOpenMatter(database);
    await closeMatter(database, OPEN_MATTER_ID, serviceOptions("2026-11-09T15:00:00.000Z"), {
      fileDestroyOn: "2031-11-09",
    });
    await reopenMatter(database, OPEN_MATTER_ID, serviceOptions("2026-12-01T09:00:00.000Z"));
    expect((await readMatterFileDestructionDate(database, OPEN_MATTER_ID)).destroyOn).toBeNull();
    const audit = await auditRows(database);
    expect(audit.at(-1)).toMatchObject({
      event: MATTER_FILE_DESTRUCTION_DATE_CLEARED_EVENT,
      subject_id: OPEN_MATTER_ID,
      metadata: { previousDestroyOn: "2031-11-09", destroyOn: null },
    });
  });
});
