import { describe, expect, it } from "vitest";
import { GuardedWriteRefusedError } from "@magna-carta/data-access/effect-batch";
import { batesLabel, batesRangeLabel } from "../src/label.ts";
import { listBatesPrefixes, listBatesRanges } from "../src/queries.ts";
import { recordStampedFile, takeBatesRange } from "../src/range-service.ts";
import { BatesValidationError } from "../src/validation.ts";
import { MATTER, OTHER_MATTER, commit, migratedDatabase, options, seedFile } from "./support.ts";

function take(
  database: Parameters<typeof takeBatesRange>[0],
  pageCount: number,
  extra: Partial<Parameters<typeof takeBatesRange>[1]> = {},
) {
  return takeBatesRange(
    database,
    { matterId: MATTER, prefix: "SMITH", digits: 6, pageCount, purpose: "pdfEditor", ...extra },
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

describe("the matter's Bates register", () => {
  it("starts a new prefix at 1 and continues each prefix from one past its last range", async () => {
    const { database } = migratedDatabase();
    const first = await take(database, 12);
    await commit(database, first.effect);
    expect(first.range).toMatchObject({ firstNumber: 1, lastNumber: 12 });
    const second = await take(database, 3);
    await commit(database, second.effect);
    expect(second.range).toMatchObject({ firstNumber: 13, lastNumber: 15 });
    const other = await take(database, 2, { prefix: "JONES" });
    await commit(database, other.effect);
    expect(other.range).toMatchObject({ firstNumber: 1, lastNumber: 2 });
    const elsewhere = await take(database, 2, { matterId: OTHER_MATTER });
    expect(elsewhere.range.firstNumber).toBe(1);
  });

  it("refuses the loser of two stamps that read the same next number", async () => {
    const { database } = migratedDatabase();
    const one = await take(database, 5);
    const two = await take(database, 5);
    await commit(database, one.effect);
    await expect(commit(database, two.effect)).rejects.toBeInstanceOf(GuardedWriteRefusedError);
    const retried = await take(database, 5);
    expect(retried.range.firstNumber).toBe(6);
  });

  it("refuses a typed start that reaches into a stamped range, and accepts one past it", async () => {
    const { database } = migratedDatabase();
    await commit(database, (await take(database, 10, { firstNumber: 100 })).effect);
    expect(await refusalCode(take(database, 5, { firstNumber: 96 }))).toBe("bates-range-taken");
    expect(await refusalCode(take(database, 1, { firstNumber: 109 }))).toBe("bates-range-taken");
    const before = await take(database, 5, { firstNumber: 95 });
    await commit(database, before.effect);
    expect(before.range.lastNumber).toBe(99);
    const next = await take(database, 1);
    expect(next.range.firstNumber).toBe(110);
  });

  it("refuses a file or a set from another matter, and bad shapes", async () => {
    const { database, raw } = migratedDatabase();
    const foreign = seedFile(raw, OTHER_MATTER, "Other.pdf");
    expect(await refusalCode(take(database, 1, { sourceFileId: foreign }))).toBe(
      "bates-unknown-file",
    );
    expect(await refusalCode(take(database, 0))).toBe("bates-invalid-input");
    expect(await refusalCode(take(database, 1, { digits: 13 }))).toBe("bates-invalid-input");
    expect(await refusalCode(take(database, 1, { prefix: "A\nB" }))).toBe("bates-invalid-input");
    expect(await refusalCode(take(database, 1, { purpose: "other" }))).toBe("bates-invalid-input");
  });

  it("records the saved copy once, and never deletes or renumbers a range", async () => {
    const { database, raw } = migratedDatabase();
    const source = seedFile(raw, MATTER, "Lease.pdf");
    const stamped = seedFile(raw, MATTER, "Lease (SMITH000001).pdf");
    const taken = await take(database, 4, { sourceFileId: source });
    await commit(database, taken.effect);
    const saved = await recordStampedFile(database, MATTER, taken.range.rangeId, stamped, options);
    await commit(database, saved.effect);
    expect(
      await refusalCode(recordStampedFile(database, MATTER, taken.range.rangeId, stamped, options)),
    ).toBe("bates-range-already-saved");
    expect(() => raw.exec("DELETE FROM bates_range")).toThrow(/append-only/);
    expect(() => raw.exec("UPDATE bates_range SET last_number = 2")).toThrow(/fixed/);
    expect(() => raw.exec(`UPDATE bates_range SET stamped_file_id = '${source}'`)).toThrow(
      /already recorded/,
    );

    const page = await listBatesRanges(database, MATTER);
    expect(page.data).toEqual([
      expect.objectContaining({
        prefix: "SMITH",
        firstNumber: 1,
        lastNumber: 4,
        pageCount: 4,
        sourceFileName: "Lease.pdf",
        stampedFileName: "Lease (SMITH000001).pdf",
      }),
    ]);
  });

  it("summarises each prefix with its next number and the padding last used", async () => {
    const { database } = migratedDatabase();
    await commit(database, (await take(database, 10)).effect);
    await commit(database, (await take(database, 5, { digits: 8 })).effect);
    await commit(
      database,
      (await take(database, 3, { prefix: "", purpose: "exhibitPackage" })).effect,
    );
    const summary = await listBatesPrefixes(database, MATTER);
    expect(summary.capped).toBe(false);
    const smith = summary.data.find((row) => row.prefix === "SMITH");
    expect(smith).toMatchObject({ nextNumber: 16, digits: 8, rangeCount: 2, pagesStamped: 15 });
    expect(summary.data.find((row) => row.prefix === "")).toMatchObject({ nextNumber: 4 });
  });

  it("pages the range list by cursor without repeating a range", async () => {
    const { database } = migratedDatabase();
    let tick = 0;
    const ticking = {
      ...options,
      clock: { now: () => `2026-11-19T12:00:0${String(tick++)}.000Z` },
    };
    for (let index = 0; index < 5; index += 1) {
      const taken = await takeBatesRange(
        database,
        { matterId: MATTER, prefix: "P", digits: 4, pageCount: 1, purpose: "pdfEditor" },
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
