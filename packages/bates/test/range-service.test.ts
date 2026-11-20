import { describe, expect, it } from "vitest";
import { GuardedWriteRefusedError } from "@magna-carta/data-access/effect-batch";
import { batesLabel, batesRangeLabel } from "../src/label.ts";
import type { BatesLogId, MatterId } from "@magna-carta/identifiers/types";
import { createBatesLog, renameBatesLog } from "../src/log-service.ts";
import { listBatesLogs, listBatesRanges } from "../src/queries.ts";
import { recordStampedFile, takeBatesRange } from "../src/range-service.ts";
import { BatesValidationError } from "../src/validation.ts";
import { MATTER, OTHER_MATTER, commit, migratedDatabase, options, seedFile } from "./support.ts";

type Database = ReturnType<typeof migratedDatabase>["database"];

async function newLog(
  database: Database,
  name: string,
  prefix = "SMITH",
  digits = 6,
  matterId: MatterId = MATTER,
): Promise<BatesLogId> {
  const created = await createBatesLog(database, { matterId, name, prefix, digits }, options);
  await commit(database, created.effect);
  return created.log.id;
}

function take(
  database: Database,
  logId: BatesLogId,
  pageCount: number,
  extra: Partial<Parameters<typeof takeBatesRange>[1]> = {},
) {
  return takeBatesRange(
    database,
    { matterId: MATTER, logId, pageCount, purpose: "pdfEditor", ...extra },
    options,
  );
}

async function refusalCode(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (caught) {
    if (caught instanceof BatesValidationError) return caught.code;
    throw caught;
  }
  return "none";
}

describe("Bates labels", () => {
  it("pads to the digits and grows past them rather than wrapping", () => {
    expect(batesLabel("SMITH", 12, 6)).toBe("SMITH000012");
    expect(batesLabel("", 1234567, 6)).toBe("1234567");
    expect(batesRangeLabel("D-", 1, 3, 4)).toBe("D-0001 to D-0003");
    expect(batesRangeLabel("D-", 7, 7, 4)).toBe("D-0007");
  });
});

describe("a matter's Bates logs", () => {
  it("starts each log at 1 and continues it from one past its last range", async () => {
    const { database } = migratedDatabase();
    const motion = await newLog(database, "Motion for Summary Judgment");
    const first = await take(database, motion, 12);
    await commit(database, first.effect);
    expect(first.range).toMatchObject({ prefix: "SMITH", firstNumber: 1, lastNumber: 12 });
    const second = await take(database, motion, 3);
    await commit(database, second.effect);
    expect(second.range).toMatchObject({ firstNumber: 13, lastNumber: 15 });
    // A second filing on the same matter, even under the same prefix, counts on its own.
    const trial = await newLog(database, "Trial Exhibits");
    const other = await take(database, trial, 2);
    await commit(database, other.effect);
    expect(other.range).toMatchObject({ prefix: "SMITH", firstNumber: 1, lastNumber: 2 });
  });

  it("refuses a second log with a name the matter already uses, and renames", async () => {
    const { database, raw } = migratedDatabase();
    const motion = await newLog(database, "Motion");
    expect(
      await refusalCode(
        createBatesLog(
          database,
          { matterId: MATTER, name: " Motion ", prefix: "", digits: 6 },
          options,
        ),
      ),
    ).toBe("bates-log-name-taken");
    await newLog(database, "Motion", "", 6, OTHER_MATTER);
    const trial = await newLog(database, "Trial");
    expect(await refusalCode(renameBatesLog(database, MATTER, trial, "Motion", options))).toBe(
      "bates-log-name-taken",
    );
    await commit(
      database,
      (await renameBatesLog(database, MATTER, motion, "Opening Motion", options)).effect,
    );
    expect(() => raw.exec("UPDATE bates_log SET prefix = 'X'")).toThrow(/fixed/);
    expect(() => raw.exec("DELETE FROM bates_log")).toThrow(/never deleted/);
  });

  it("refuses a log from another matter", async () => {
    const { database } = migratedDatabase();
    const elsewhere = await newLog(database, "Elsewhere", "B", 6, OTHER_MATTER);
    expect(await refusalCode(take(database, elsewhere, 1))).toBe("bates-unknown-log");
  });

  it("refuses the loser of two stamps that read the same next number", async () => {
    const { database } = migratedDatabase();
    const log = await newLog(database, "Production");
    const one = await take(database, log, 5);
    const two = await take(database, log, 5);
    await commit(database, one.effect);
    await expect(commit(database, two.effect)).rejects.toBeInstanceOf(GuardedWriteRefusedError);
    const retried = await take(database, log, 5);
    expect(retried.range.firstNumber).toBe(6);
  });

  it("refuses a typed start that reaches into a stamped range, and accepts one past it", async () => {
    const { database } = migratedDatabase();
    const log = await newLog(database, "Production");
    await commit(database, (await take(database, log, 10, { firstNumber: 100 })).effect);
    expect(await refusalCode(take(database, log, 5, { firstNumber: 96 }))).toBe(
      "bates-range-taken",
    );
    expect(await refusalCode(take(database, log, 1, { firstNumber: 109 }))).toBe(
      "bates-range-taken",
    );
    const before = await take(database, log, 5, { firstNumber: 95 });
    await commit(database, before.effect);
    expect(before.range.lastNumber).toBe(99);
    const next = await take(database, log, 1);
    expect(next.range.firstNumber).toBe(110);
  });

  it("refuses a file from another matter, and bad shapes", async () => {
    const { database, raw } = migratedDatabase();
    const log = await newLog(database, "Production");
    const foreign = seedFile(raw, OTHER_MATTER, "Other.pdf");
    expect(await refusalCode(take(database, log, 1, { sourceFileId: foreign }))).toBe(
      "bates-unknown-file",
    );
    expect(await refusalCode(take(database, log, 0))).toBe("bates-invalid-input");
    expect(await refusalCode(take(database, log, 1, { purpose: "other" }))).toBe(
      "bates-invalid-input",
    );
    for (const bad of [
      { name: "", prefix: "", digits: 6 },
      { name: "A", prefix: "A\nB", digits: 6 },
      { name: "A", prefix: "", digits: 13 },
    ]) {
      expect(
        await refusalCode(createBatesLog(database, { matterId: MATTER, ...bad }, options)),
      ).toBe("bates-invalid-input");
    }
  });

  it("records the saved copy once, and never deletes or renumbers a range", async () => {
    const { database, raw } = migratedDatabase();
    const log = await newLog(database, "Production");
    const source = seedFile(raw, MATTER, "Lease.pdf");
    const stamped = seedFile(raw, MATTER, "Lease (SMITH000001).pdf");
    const taken = await take(database, log, 4, { sourceFileId: source });
    await commit(database, taken.effect);
    const saved = await recordStampedFile(database, MATTER, taken.range.rangeId, stamped, options);
    await commit(database, saved.effect);
    expect(
      await refusalCode(recordStampedFile(database, MATTER, taken.range.rangeId, stamped, options)),
    ).toBe("bates-range-already-saved");
    expect(() => raw.exec("DELETE FROM bates_range")).toThrow(/append-only/);
    expect(() => raw.exec("UPDATE bates_range SET last_number = 2")).toThrow(/fixed/);
    expect(() => raw.exec("UPDATE bates_range SET log_id = NULL")).toThrow(/fixed/);
    expect(() => raw.exec(`UPDATE bates_range SET stamped_file_id = '${source}'`)).toThrow(
      /already recorded/,
    );

    const page = await listBatesRanges(database, MATTER, { logId: log });
    expect(page.data).toEqual([
      expect.objectContaining({
        logName: "Production",
        prefix: "SMITH",
        firstNumber: 1,
        lastNumber: 4,
        pageCount: 4,
        sourceFileName: "Lease.pdf",
        stampedFileName: "Lease (SMITH000001).pdf",
      }),
    ]);
  });

  it("lists each log with its next number, an unused one at 1", async () => {
    const { database } = migratedDatabase();
    const production = await newLog(database, "Production", "SMITH", 8);
    await commit(database, (await take(database, production, 10)).effect);
    await commit(database, (await take(database, production, 5)).effect);
    await newLog(database, "Trial", "", 4);
    const logs = await listBatesLogs(database, MATTER);
    expect(logs.capped).toBe(false);
    expect(logs.data.find((row) => row.name === "Production")).toMatchObject({
      prefix: "SMITH",
      digits: 8,
      nextNumber: 16,
      rangeCount: 2,
      pagesStamped: 15,
    });
    expect(logs.data.find((row) => row.name === "Trial")).toMatchObject({
      nextNumber: 1,
      rangeCount: 0,
      pagesStamped: 0,
      lastStampedAt: null,
    });
  });

  it("pages the range list by cursor without repeating a range", async () => {
    const { database } = migratedDatabase();
    const log = await newLog(database, "Production", "P", 4);
    let tick = 0;
    const ticking = {
      ...options,
      clock: { now: () => `2026-11-19T12:00:0${String(tick++)}.000Z` },
    };
    for (let index = 0; index < 5; index += 1) {
      const taken = await takeBatesRange(
        database,
        { matterId: MATTER, logId: log, pageCount: 1, purpose: "pdfEditor" },
        ticking,
      );
      await commit(database, taken.effect);
    }
    const first = await listBatesRanges(database, MATTER, { pageSize: 3 });
    const second = await listBatesRanges(database, MATTER, {
      pageSize: 3,
      cursor: first.nextCursor ?? undefined,
    });
    expect(first.data.map((range) => range.firstNumber)).toEqual([5, 4, 3]);
    expect(second.data.map((range) => range.firstNumber)).toEqual([2, 1]);
    expect(second.nextCursor).toBeNull();
  });
});
