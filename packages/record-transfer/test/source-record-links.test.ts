import type { BatchDatabase } from "@magna-carta/data-access/effect-batch";
import { createMigratedNodeDatabase } from "@magna-carta/database/node-sqlite";
import { newIdentifier } from "@magna-carta/identifiers/generate";
import type { TransferRunId, UserId } from "@magna-carta/identifiers/types";
import { describe, expect, it } from "vitest";
import {
  InvalidSourceRecordKeyError,
  InvalidSourceSystemError,
  UnlinkableLocalTableError,
  type SourceRecordKey,
} from "../src/source-record.ts";
import {
  countLinksBySourceSystemStatement,
  countLinksByTransferRunStatement,
  insertSourceRecordLinkStatement,
  selectLinkedLocalRecordStatement,
  selectLinksForSourceRecordStatement,
  selectSourcesOfLocalRecordStatement,
  type SourceRecordLinkRow,
} from "../src/source-record-link-statements.ts";
import {
  abandonTransferRunStatement,
  completeTransferRunStatement,
  insertTransferRunStatement,
  selectTransferRunStatement,
  selectTransferRunsStatement,
  type TransferRunRow,
} from "../src/transfer-run-statements.ts";

const STARTED = "2026-11-10T09:00:00.000Z";
const LATER = "2026-11-10T10:00:00.000Z";

// The node:sqlite adapter surfaces a constraint failure as a synchronous throw from run(), so a
// rejects-matcher would never see it.
async function captureError(act: () => Promise<unknown>): Promise<unknown> {
  try {
    await act();
  } catch (caught) {
    return caught;
  }
  throw new Error("expected the statement to fail on a constraint");
}

async function freshFirm(): Promise<{ database: BatchDatabase; operator: UserId }> {
  const { database } = createMigratedNodeDatabase("per-firm");
  const operator = newIdentifier("user") as UserId;
  await database
    .prepare(
      "INSERT INTO member (user_id, display_name, status, created_at) VALUES (?1, 'Operator', 'active', ?2)",
    )
    .bind(operator, STARTED)
    .run();
  return { database, operator };
}

async function startRun(
  database: BatchDatabase,
  operator: UserId,
  label = "First rehearsal",
  now = STARTED,
): Promise<TransferRunId> {
  const id = newIdentifier("transferRun") as TransferRunId;
  await insertTransferRunStatement(
    database,
    { id, sourceSystem: "leap", label, startedBy: operator },
    now,
  ).run();
  return id;
}

const leapMatter = (sourceId: string): SourceRecordKey => ({
  sourceSystem: "leap",
  sourceKind: "matter",
  sourceId,
});

const leapCard = (sourceId: string): SourceRecordKey => ({
  sourceSystem: "leap",
  sourceKind: "card",
  sourceId,
});

describe("transfer runs", () => {
  it("a run starts open and is read back as written", async () => {
    const { database, operator } = await freshFirm();
    const id = await startRun(database, operator);

    const { results } = await selectTransferRunStatement(database, id).all<TransferRunRow>();
    expect(results).toEqual([
      {
        id,
        source_system: "leap",
        label: "First rehearsal",
        started_by: operator,
        started_at: STARTED,
        completed_at: null,
        abandoned_at: null,
      },
    ]);
  });

  it("lists a source system's runs newest first", async () => {
    const { database, operator } = await freshFirm();
    const first = await startRun(database, operator, "First rehearsal", STARTED);
    const second = await startRun(database, operator, "Second rehearsal", LATER);

    const { results } = await selectTransferRunsStatement(database, "leap").all<TransferRunRow>();
    expect(results.map((run) => run.id)).toEqual([second, first]);
  });

  it("a run ends once: completing an ended run changes nothing", async () => {
    const { database, operator } = await freshFirm();
    const id = await startRun(database, operator);

    const completed = await completeTransferRunStatement(database, id, LATER).run();
    expect(completed.meta.changes).toBe(1);

    const again = await completeTransferRunStatement(database, id, LATER).run();
    const abandoned = await abandonTransferRunStatement(database, id, LATER).run();
    expect(again.meta.changes).toBe(0);
    expect(abandoned.meta.changes).toBe(0);

    const { results } = await selectTransferRunStatement(database, id).all<TransferRunRow>();
    expect(results[0]?.completed_at).toBe(LATER);
    expect(results[0]?.abandoned_at).toBeNull();
  });

  it("the database refuses a run that is both completed and abandoned", async () => {
    const { database, operator } = await freshFirm();
    const id = await startRun(database, operator);

    const error = await captureError(() =>
      database
        .prepare("UPDATE transfer_run SET completed_at = ?2, abandoned_at = ?2 WHERE id = ?1")
        .bind(id, LATER)
        .run(),
    );
    expect(String(error)).toMatch(/transfer_run_single_ending_check/);
  });

  it("refuses a source system that is not a lower-case slug, before the database is asked", async () => {
    const { database, operator } = await freshFirm();
    const id = newIdentifier("transferRun") as TransferRunId;
    for (const sourceSystem of ["LEAP", "leap ", "", "2leap", "le ap"]) {
      expect(() =>
        insertTransferRunStatement(
          database,
          { id, sourceSystem, label: "x", startedBy: operator },
          STARTED,
        ),
      ).toThrow(InvalidSourceSystemError);
    }
  });
});

describe("source record links", () => {
  it("a transfer reads no link, writes one, and then reads the record it named", async () => {
    const { database, operator } = await freshFirm();
    const run = await startRun(database, operator);
    const source = leapMatter("3f1c8a52-9d47-4f0e-b8a1-6c2e7d5b09fa");
    const matterId = newIdentifier("matter");

    const before = await selectLinkedLocalRecordStatement(database, source, "matter").all();
    expect(before.results).toEqual([]);

    await insertSourceRecordLinkStatement(
      database,
      { source, localTable: "matter", localId: matterId, transferRunId: run },
      STARTED,
    ).run();

    const after = await selectLinkedLocalRecordStatement(database, source, "matter").all();
    expect(after.results).toEqual([
      { local_id: matterId, transfer_run_id: run, created_at: STARTED },
    ]);
  });

  it("refuses a second link from one source record to the same kind of record", async () => {
    const { database, operator } = await freshFirm();
    const run = await startRun(database, operator);
    const source = leapMatter("b7e2d049-1a63-4c8f-9e05-2d7a4f1b83cc");
    const link = (localId: string) =>
      insertSourceRecordLinkStatement(
        database,
        { source, localTable: "matter", localId, transferRunId: run },
        STARTED,
      );

    await link(newIdentifier("matter")).run();
    const error = await captureError(() => link(newIdentifier("matter")).run());
    expect(String(error)).toMatch(/UNIQUE constraint failed/);

    const { results } = await selectLinksForSourceRecordStatement(database, source).all();
    expect(results).toHaveLength(1);
  });

  it("one source record may become records of several kinds", async () => {
    const { database, operator } = await freshFirm();
    const run = await startRun(database, operator);
    const source = leapCard("0a4d1f6e-52b8-4c17-9a3e-7f1d2c9b6e40");
    const personId = newIdentifier("directoryPerson");
    const organizationId = newIdentifier("directoryOrganization");

    for (const [localTable, localId] of [
      ["directory_person", personId],
      ["directory_organization", organizationId],
    ] as const) {
      await insertSourceRecordLinkStatement(
        database,
        { source, localTable, localId, transferRunId: run },
        STARTED,
      ).run();
    }

    const { results } = await selectLinksForSourceRecordStatement(
      database,
      source,
    ).all<SourceRecordLinkRow>();
    expect(results.map((row) => [row.local_table, row.local_id])).toEqual([
      ["directory_organization", organizationId],
      ["directory_person", personId],
    ]);
  });

  it("several source records may become one record, and the record names them all", async () => {
    const { database, operator } = await freshFirm();
    const run = await startRun(database, operator);
    const personId = newIdentifier("directoryPerson");
    const cards = ["11111111-1111-4111-8111-111111111111", "22222222-2222-4222-8222-222222222222"];

    for (const sourceId of cards) {
      await insertSourceRecordLinkStatement(
        database,
        {
          source: leapCard(sourceId),
          localTable: "directory_person",
          localId: personId,
          transferRunId: run,
        },
        STARTED,
      ).run();
    }

    const { results } = await selectSourcesOfLocalRecordStatement(
      database,
      "directory_person",
      personId,
    ).all<SourceRecordLinkRow>();
    expect(results.map((row) => row.source_id)).toEqual(cards);
  });

  it("the same key in a different source system is a different record", async () => {
    const { database, operator } = await freshFirm();
    const run = await startRun(database, operator);
    const sharedId = "42";

    await insertSourceRecordLinkStatement(
      database,
      {
        source: { sourceSystem: "leap", sourceKind: "matter", sourceId: sharedId },
        localTable: "matter",
        localId: newIdentifier("matter"),
        transferRunId: run,
      },
      STARTED,
    ).run();
    await insertSourceRecordLinkStatement(
      database,
      {
        source: { sourceSystem: "other-system", sourceKind: "matter", sourceId: sharedId },
        localTable: "matter",
        localId: newIdentifier("matter"),
        transferRunId: run,
      },
      STARTED,
    ).run();

    const { results } = await countLinksBySourceSystemStatement(database, "leap").all();
    expect(results).toEqual([{ source_kind: "matter", source_record_count: 1 }]);
  });

  it("counts what a run linked, and counts a source record once however many records it became", async () => {
    const { database, operator } = await freshFirm();
    const first = await startRun(database, operator, "First rehearsal", STARTED);
    const second = await startRun(database, operator, "Second rehearsal", LATER);
    const card = leapCard("33333333-3333-4333-8333-333333333333");

    await insertSourceRecordLinkStatement(
      database,
      {
        source: card,
        localTable: "directory_person",
        localId: newIdentifier("directoryPerson"),
        transferRunId: first,
      },
      STARTED,
    ).run();
    await insertSourceRecordLinkStatement(
      database,
      {
        source: card,
        localTable: "directory_organization",
        localId: newIdentifier("directoryOrganization"),
        transferRunId: second,
      },
      LATER,
    ).run();
    await insertSourceRecordLinkStatement(
      database,
      {
        source: leapMatter("44444444-4444-4444-8444-444444444444"),
        localTable: "matter",
        localId: newIdentifier("matter"),
        transferRunId: second,
      },
      LATER,
    ).run();

    const byRun = await countLinksByTransferRunStatement(database, second).all();
    expect(byRun.results).toEqual([
      { source_kind: "card", local_table: "directory_organization", link_count: 1 },
      { source_kind: "matter", local_table: "matter", link_count: 1 },
    ]);

    const bySystem = await countLinksBySourceSystemStatement(database, "leap").all();
    expect(bySystem.results).toEqual([
      { source_kind: "card", source_record_count: 1 },
      { source_kind: "matter", source_record_count: 1 },
    ]);
  });

  it("refuses a table that is not on the linkable list, before the database is asked", async () => {
    const { database, operator } = await freshFirm();
    const run = await startRun(database, operator);
    const source = leapMatter("55555555-5555-4555-8555-555555555555");

    expect(() =>
      insertSourceRecordLinkStatement(
        database,
        { source, localTable: "matters", localId: "x", transferRunId: run },
        STARTED,
      ),
    ).toThrow(UnlinkableLocalTableError);
    expect(() => selectLinkedLocalRecordStatement(database, source, "toString")).toThrow(
      UnlinkableLocalTableError,
    );
    expect(() => selectSourcesOfLocalRecordStatement(database, "audit_log", "x")).toThrow(
      UnlinkableLocalTableError,
    );
  });

  it("refuses an empty source kind or source key", async () => {
    const { database } = await freshFirm();
    expect(() =>
      selectLinksForSourceRecordStatement(database, {
        sourceSystem: "leap",
        sourceKind: "",
        sourceId: "x",
      }),
    ).toThrow(InvalidSourceRecordKeyError);
    expect(() =>
      selectLinksForSourceRecordStatement(database, {
        sourceSystem: "leap",
        sourceKind: "matter",
        sourceId: "",
      }),
    ).toThrow(InvalidSourceRecordKeyError);
  });

  it("a link cannot name a run that does not exist", async () => {
    const { database } = await freshFirm();
    const error = await captureError(() =>
      insertSourceRecordLinkStatement(
        database,
        {
          source: leapMatter("66666666-6666-4666-8666-666666666666"),
          localTable: "matter",
          localId: newIdentifier("matter"),
          transferRunId: newIdentifier("transferRun") as TransferRunId,
        },
        STARTED,
      ).run(),
    );
    expect(String(error)).toMatch(/FOREIGN KEY constraint failed/);
  });
});
