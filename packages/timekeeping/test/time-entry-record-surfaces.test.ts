import { createMigratedNodeDatabase } from "@magna-carta/database/node-sqlite";
import type { BatchDatabase } from "@magna-carta/data-access/effect-batch";
import { commitEffectBatch } from "@magna-carta/data-access/effect-batch";
import type { MatterId, TimeEntryId, UserId } from "@magna-carta/identifiers/types";
import { describe, expect, it } from "vitest";
import {
  entryNumberAllocationStatement,
  entryNumberBlockOpenStatements,
  isEntryNumberConflict,
  planEntryNumberBlock,
  type EntryNumberBlockPlan,
} from "../src/entry-numbering.ts";
import { renderNumber } from "@magna-carta/sequence-numbering/render";
import { DEFAULT_TIME_ENTRY_SCHEME } from "@magna-carta/sequence-numbering/purposes";
import {
  attachFileToTimeEntry,
  detachFileFromTimeEntry,
  listTimeEntryAttachments,
} from "../src/time-entry-attachments.ts";
import { captureTimeEntry, updateDraftTimeEntry } from "../src/time-entry-service.ts";
import { TimeEntryValidationError } from "../src/time-entry-validation.ts";
import {
  listTimeEntriesByMatter,
  listTimeEntriesForTimekeeperDay,
  listTimeEntryEvents,
  readTimeEntryRecord,
} from "../src/queries.ts";

const clock = { now: () => "2026-06-22T12:00:00.000Z" };
const TIMEKEEPER = "user_attorney" as UserId;
const ENTERER = "user_assistant" as UserId;
const MATTER = "matter_a" as MatterId;
const options = { clock, actorUserId: TIMEKEEPER };

function freshDatabase(): BatchDatabase {
  return createMigratedNodeDatabase("per-firm").database;
}

async function seedBase(database: BatchDatabase): Promise<void> {
  await database
    .prepare(
      "INSERT INTO member (user_id, display_name, status, created_at) VALUES (?1, 'Alexandra Attorney', 'active', ?3), (?2, 'Sam Assistant', 'active', ?3)",
    )
    .bind(TIMEKEEPER, ENTERER, clock.now())
    .run();
  await database
    .prepare(
      "INSERT INTO matter (id, title, status, responsible_member_id, matter_number, created_at, updated_at) VALUES (?1, 'Smith v. Jones', 'open', ?2, '2026-0147', ?3, ?3)",
    )
    .bind(MATTER, TIMEKEEPER, clock.now())
    .run();
  await database
    .prepare(
      "INSERT INTO utbms_code (id, code_set, code, label, active) VALUES ('utbmsCode_task', 'task', 'L120', 'Analysis/Strategy', 1), ('utbmsCode_act', 'activity', 'A101', 'Plan and prepare for', 1)",
    )
    .run();
}

async function seedFile(database: BatchDatabase, id: string, matterId: string): Promise<void> {
  await database
    .prepare(
      "INSERT INTO file (id, matter_id, name, created_at, updated_at) VALUES (?1, ?2, 'research-memo.pdf', ?3, ?3)",
    )
    .bind(id, matterId, clock.now())
    .run();
}

// Captures one entry through the service + the entry-number draw statements, the way the routes
// compose them: block open first, then the insert + audit, then the allocation.
async function captureNumbered(
  database: BatchDatabase,
  overrides: { memo?: string; timekeeperUserId?: string } = {},
): Promise<{ timeEntryId: TimeEntryId; entryNumber: string }> {
  const plan = await planEntryNumberBlock(database, MATTER, 1, "2026-06-13");
  const entryNumber = plan.numbers[0];
  if (entryNumber === undefined) throw new Error("plan rendered no number");
  const captured = await captureTimeEntry(
    database,
    {
      matterId: MATTER,
      timekeeperUserId: overrides.timekeeperUserId ?? TIMEKEEPER,
      workDate: "2026-06-22",
      rawDurationMinutes: 25,
      durationMinutes: 30,
      narrative: "Draft motion",
      billable: true,
      source: "manual",
      utbmsTaskCodeId: "utbmsCode_task",
      utbmsActivityCodeId: "utbmsCode_act",
      memo: overrides.memo,
      entryNumber,
      currency: "USD",
      rate: {
        rateE4: 3_000_000,
        rateCardId: "rateCard_a",
        rateSource: "matter",
        currency: "USD",
        amountMinor: 15_000,
      },
    },
    options,
  );
  await commitEffectBatch(
    database,
    {
      statements: [
        ...entryNumberBlockOpenStatements(database, plan),
        ...captured.effect.statements,
        entryNumberAllocationStatement(database, plan, 0, captured.timeEntryId, clock.now()),
      ],
      outboxMessages: [],
    },
    { now: clock.now },
  );
  return { timeEntryId: captured.timeEntryId, entryNumber };
}

async function seedRateCard(database: BatchDatabase): Promise<void> {
  await database
    .prepare(
      "INSERT INTO rate_card (id, name, created_at, updated_at) VALUES ('rateCard_a', 'Standard', ?1, ?1)",
    )
    .bind(clock.now())
    .run();
}

describe("entry numbering", () => {
  // The built-in shape, which is what the firm gets until it writes its own on the numbering
  // settings screen: the matter's number, a dot, and a zero-padded per-matter count.
  const builtIn = (matterNumber: string, value: number): string =>
    renderNumber(DEFAULT_TIME_ENTRY_SCHEME, { openedDate: "2026-06-13", matterNumber }, value);

  it("renders matter number + dot + zero-padded sequence, and grows past its width", () => {
    expect(builtIn("2026-0147", 42)).toBe("2026-0147.0042");
    // A matter that has drawn no number yet falls back to its handle, which the draw supplies.
    expect(builtIn("matter_a", 1)).toBe("matter_a.0001");
    // Past four digits the number grows rather than wrapping.
    expect(builtIn("2026-0147", 12345)).toBe("2026-0147.12345");
  });

  it("draws consecutive numbers per matter and advances the counter by the block size", async () => {
    const database = freshDatabase();
    await seedBase(database);
    await seedRateCard(database);

    const first = await captureNumbered(database);
    expect(first.entryNumber).toBe("2026-0147.0001");
    const second = await captureNumbered(database);
    expect(second.entryNumber).toBe("2026-0147.0002");

    const plan = await planEntryNumberBlock(database, MATTER, 3, "2026-06-13");
    expect(plan.numbers).toEqual(["2026-0147.0003", "2026-0147.0004", "2026-0147.0005"]);

    const record = await readTimeEntryRecord(database, first.timeEntryId);
    expect(record?.entryNumber).toBe("2026-0147.0001");
  });

  it("aborts a losing draw on the allocation primary key, and the predicate recognizes it", async () => {
    const database = freshDatabase();
    await seedBase(database);
    await seedRateCard(database);
    const winner = await captureNumbered(database);

    // A racer that observed the pre-advance counter value: its allocation collides on the drawn
    // VALUE itself, which is what makes the loser's whole batch abort.
    const stalePlan: EntryNumberBlockPlan = {
      segments: DEFAULT_TIME_ENTRY_SCHEME,
      scopeKey: MATTER as string,
      observedValue: 1,
      startValue: 1,
      count: 1,
      numbers: ["2026-0147.9999"],
      number: "2026-0147.9999",
    };
    let caught: unknown;
    try {
      await commitEffectBatch(
        database,
        {
          statements: [
            entryNumberAllocationStatement(database, stalePlan, 0, winner.timeEntryId, clock.now()),
          ],
          outboxMessages: [],
        },
        { now: clock.now },
      );
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(Error);
    expect(String((caught as Error).message)).toContain("UNIQUE constraint failed");
  });

  it("recognizes a rendered entry-number collision as retryable", () => {
    expect(
      isEntryNumberConflict(new Error("UNIQUE constraint failed: time_entry.entry_number")),
    ).toBe(true);
    expect(isEntryNumberConflict(new Error("UNIQUE constraint failed: matter.matter_number"))).toBe(
      false,
    );
  });
});

describe("the record read", () => {
  it("serves the widened entry on the per-matter listing, the day listing, and the detail", async () => {
    const database = freshDatabase();
    await seedBase(database);
    await seedRateCard(database);
    const { timeEntryId, entryNumber } = await captureNumbered(database, {
      memo: "Client asked for weekly summaries",
    });

    const detail = await readTimeEntryRecord(database, timeEntryId);
    expect(detail).toMatchObject({
      id: timeEntryId,
      entryNumber,
      memo: "Client asked for weekly summaries",
      rateE4: 3_000_000,
      rateSource: "matter",
      rateCardId: "rateCard_a",
      utbmsTaskCodeId: "utbmsCode_task",
      utbmsTaskCode: "L120",
      utbmsTaskLabel: "Analysis/Strategy",
      utbmsActivityCodeId: "utbmsCode_act",
      utbmsActivityCode: "A101",
      utbmsActivityLabel: "Plan and prepare for",
      invoiceId: null,
      createdByUserId: TIMEKEEPER,
      createdByName: "Alexandra Attorney",
      timekeeperName: "Alexandra Attorney",
      attachmentCount: 0,
      createdAt: clock.now(),
    });

    const byMatter = await listTimeEntriesByMatter(database, { matterId: MATTER });
    expect(byMatter.data[0]).toMatchObject({ entryNumber, createdByName: "Alexandra Attorney" });

    const byDay = await listTimeEntriesForTimekeeperDay(database, {
      timekeeperUserId: TIMEKEEPER,
      workDate: "2026-06-22",
    });
    expect(byDay.data[0]).toMatchObject({ entryNumber, timekeeperName: "Alexandra Attorney" });
  });
});

describe("attachments", () => {
  it("attaches one of the matter's files, counts it, lists it, and detaches without deleting", async () => {
    const database = freshDatabase();
    await seedBase(database);
    await seedRateCard(database);
    const { timeEntryId } = await captureNumbered(database);
    await seedFile(database, "file_memo", MATTER);

    const attach = await attachFileToTimeEntry(database, timeEntryId, "file_memo", options);
    await commitEffectBatch(database, attach.effect, { now: clock.now });

    const listed = await listTimeEntryAttachments(database, timeEntryId);
    expect(listed).toEqual([
      {
        fileId: "file_memo",
        fileName: "research-memo.pdf",
        createdAt: clock.now(),
        createdByUserId: TIMEKEEPER,
        createdByName: "Alexandra Attorney",
      },
    ]);
    expect((await readTimeEntryRecord(database, timeEntryId))?.attachmentCount).toBe(1);

    // A second attach of the same file is a named refusal.
    await expect(
      attachFileToTimeEntry(database, timeEntryId, "file_memo", options),
    ).rejects.toMatchObject({ code: "already-attached" });

    const detach = await detachFileFromTimeEntry(database, timeEntryId, "file_memo", options);
    await commitEffectBatch(database, detach.effect, { now: clock.now });
    expect(await listTimeEntryAttachments(database, timeEntryId)).toEqual([]);
    // Detaching removed the LINK, never the file.
    const { results: fileRows } = await database
      .prepare("SELECT id FROM file WHERE id = 'file_memo'")
      .all<{ id: string }>();
    expect(fileRows).toHaveLength(1);
  });

  it("refuses a file on another matter, and a detach of a link that does not exist", async () => {
    const database = freshDatabase();
    await seedBase(database);
    await seedRateCard(database);
    await database
      .prepare(
        "INSERT INTO matter (id, title, status, responsible_member_id, created_at, updated_at) VALUES ('matter_other', 'Other', 'open', ?1, ?2, ?2)",
      )
      .bind(TIMEKEEPER, clock.now())
      .run();
    const { timeEntryId } = await captureNumbered(database);
    await seedFile(database, "file_foreign", "matter_other");

    await expect(
      attachFileToTimeEntry(database, timeEntryId, "file_foreign", options),
    ).rejects.toMatchObject({ code: "file-not-on-matter" });
    await expect(
      detachFileFromTimeEntry(database, timeEntryId, "file_foreign", options),
    ).rejects.toMatchObject({ code: "not-attached" });
  });

  it("refuses both acts on a frozen entry", async () => {
    const database = freshDatabase();
    await seedBase(database);
    await seedRateCard(database);
    const { timeEntryId } = await captureNumbered(database);
    await seedFile(database, "file_memo", MATTER);
    await database
      .prepare("UPDATE time_entry SET status = 'void' WHERE id = ?1")
      .bind(timeEntryId)
      .run();

    await expect(
      attachFileToTimeEntry(database, timeEntryId, "file_memo", options),
    ).rejects.toMatchObject({ code: "frozen-entry" });
    await expect(
      detachFileFromTimeEntry(database, timeEntryId, "file_memo", options),
    ).rejects.toMatchObject({ code: "frozen-entry" });
  });
});

describe("the event history", () => {
  it("serves the entry's audit events oldest first, with actor names and redacted detail", async () => {
    const database = freshDatabase();
    await seedBase(database);
    await seedRateCard(database);
    const { timeEntryId } = await captureNumbered(database);

    const laterClock = { now: () => "2026-06-22T13:00:00.000Z" };
    const updated = await updateDraftTimeEntry(
      database,
      timeEntryId,
      { narrative: "Draft and file motion", memo: "check with partner" },
      { clock: laterClock, actorUserId: ENTERER },
    );
    await commitEffectBatch(database, updated.effect, { now: clock.now });

    const page = await listTimeEntryEvents(database, timeEntryId);
    expect(page.nextCursor).toBeNull();
    const events = page.data;
    expect(events.map((event) => event.event)).toEqual([
      "time_entry.captured",
      "time_entry.updated",
    ]);
    expect(events[0]).toMatchObject({
      actorUserId: TIMEKEEPER,
      actorName: "Alexandra Attorney",
    });
    expect(JSON.parse(events[0]?.metadataJson ?? "null")).toEqual({ source: "manual" });
    // The update names WHICH fields changed — names only, never the memo's or narrative's text.
    expect(events[1]).toMatchObject({ actorUserId: ENTERER, actorName: "Sam Assistant" });
    const updateDetail = JSON.parse(events[1]?.metadataJson ?? "null") as { fields: string[] };
    expect(updateDetail.fields.sort()).toEqual(["memo", "narrative"]);
    expect(events[1]?.metadataJson).not.toContain("check with partner");
    expect(events[1]?.metadataJson).not.toContain("Draft and file motion");
  });
});

describe("capture guards still hold", () => {
  it("stores an honest null entry number when the caller draws no sequence", async () => {
    const database = freshDatabase();
    await seedBase(database);
    await seedRateCard(database);
    const captured = await captureTimeEntry(
      database,
      {
        matterId: MATTER,
        timekeeperUserId: TIMEKEEPER,
        workDate: "2026-06-22",
        rawDurationMinutes: 10,
        durationMinutes: 12,
        narrative: "call",
        billable: false,
        source: "manual",
        currency: "USD",
        rate: { noRate: true },
      },
      options,
    );
    await commitEffectBatch(database, captured.effect, { now: clock.now });
    const record = await readTimeEntryRecord(database, captured.timeEntryId);
    expect(record?.entryNumber).toBeNull();
    expect(record?.memo).toBeNull();
  });

  it("still refuses the shapes it refused before", async () => {
    const database = freshDatabase();
    await seedBase(database);
    await seedRateCard(database);
    const { timeEntryId } = await captureNumbered(database);
    await database
      .prepare("UPDATE time_entry SET status = 'billed' WHERE id = ?1")
      .bind(timeEntryId)
      .run();
    await expect(
      updateDraftTimeEntry(database, timeEntryId, { memo: "late note" }, options),
    ).rejects.toBeInstanceOf(TimeEntryValidationError);
  });
});
