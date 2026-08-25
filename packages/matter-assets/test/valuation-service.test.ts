import { resolveMatterAssetValueAsOf } from "@magna-carta/matter-assets/as-of";
import { createMatterAsset } from "@magna-carta/matter-assets/asset-service";
import { appendMatterAssetValuation } from "@magna-carta/matter-assets/valuation-service";
import { pageMatterAssetValuations } from "@magna-carta/matter-assets/valuation-statements";
import { MatterAssetValidationError } from "@magna-carta/matter-assets/validation";
import type { MatterAssetId } from "@magna-carta/identifiers/types";
import { beforeEach, describe, expect, it } from "vitest";
import { MATTER, clock, commit, migratedDatabase, options, seedMatters } from "./support.ts";

// The as-of resolution, as a table. Every row here is a question a firm actually asks of an estate:
// what was the house worth at the date of death, what is it worth now, and what happens to a figure
// somebody corrected.

let database: ReturnType<typeof migratedDatabase>["database"];
let assetId: MatterAssetId;

beforeEach(async () => {
  const migrated = migratedDatabase();
  database = migrated.database;
  seedMatters(migrated.raw);
  const created = await createMatterAsset(
    database,
    { matterId: MATTER, assetClass: "realProperty", description: "The house on Elm Street" },
    options,
  );
  await commit(database, created.effect);
  assetId = created.assetId;
});

async function append(
  asOfDate: string,
  amountMinor: number,
  basis: string,
  correctsValuationId?: string,
): Promise<string> {
  const appended = await appendMatterAssetValuation(
    database,
    {
      assetId,
      asOfDate,
      amountMinor,
      currency: "USD",
      basis,
      ...(correctsValuationId === undefined
        ? {}
        : { correctsValuationId: correctsValuationId as never }),
    },
    options,
  );
  await commit(database, appended.effect);
  return appended.valuationId;
}

describe("the as-of read", () => {
  // The rule this subsystem most wants to get right: an asset acquired after the date of death is
  // not in the estate at the date of death, and extrapolating backwards would put a number on a
  // schedule that no one asserted.
  it("resolves to NOTHING before the first valuation, never to the earliest figure", async () => {
    await append("2026-03-14", 40000000, "appraisal");
    expect(await resolveMatterAssetValueAsOf(database, assetId, "2026-01-01")).toBeUndefined();
    expect(await resolveMatterAssetValueAsOf(database, assetId, "2026-03-13")).toBeUndefined();
  });

  it("resolves exactly on a valuation's own date", async () => {
    await append("2026-03-14", 40000000, "appraisal");
    const resolved = await resolveMatterAssetValueAsOf(database, assetId, "2026-03-14");
    expect(resolved?.amountMinor).toBe(40000000);
    expect(resolved?.asOfDate).toBe("2026-03-14");
    expect(resolved?.basis).toBe("appraisal");
  });

  // The answer always travels with the date it came from, which is frequently earlier than the date
  // asked for. A reader can see how stale it is; nothing interpolates.
  it("resolves a date between two figures to the earlier one, carrying its own date", async () => {
    await append("2026-03-14", 40000000, "appraisal");
    await append("2026-07-01", 42500000, "broker");
    const resolved = await resolveMatterAssetValueAsOf(database, assetId, "2026-05-01");
    expect(resolved?.amountMinor).toBe(40000000);
    expect(resolved?.asOfDate).toBe("2026-03-14");
    const later = await resolveMatterAssetValueAsOf(database, assetId, "2026-12-31");
    expect(later?.amountMinor).toBe(42500000);
    expect(later?.basis).toBe("broker");
  });

  it("never resolves a corrected row, and resolves its correction in its place", async () => {
    const original = await append("2026-03-14", 4000000000, "appraisal");
    await append("2026-03-14", 40000000, "appraisal", original);
    const resolved = await resolveMatterAssetValueAsOf(database, assetId, "2026-06-01");
    expect(resolved?.amountMinor).toBe(40000000);
    // Both rows are still on the record: a correction hides a figure from the READ, never from the
    // history a firm can be asked to account for.
    const history = await pageMatterAssetValuations(database, assetId);
    expect(history.data).toHaveLength(2);
    expect(history.nextCursor).toBeNull();
  });

  it("walks the whole history across pages without repeating or losing an assertion", async () => {
    // Two share an as-of date, so the page boundary falls where the RECORDED instant decides. A
    // cursor carrying only (as_of_date, id) would order those two by identifier and could hand the
    // same one back on the next page.
    await append("2026-01-01", 100001, "appraisal");
    await append("2026-02-01", 100002, "appraisal");
    await append("2026-02-01", 100003, "appraisal");
    await append("2026-03-01", 100004, "appraisal");
    await append("2026-04-01", 100005, "appraisal");

    const seen: (number | null)[] = [];
    let cursor: string | undefined;
    for (let page = 0; page < 10; page += 1) {
      const built = await pageMatterAssetValuations(database, assetId, { cursor, pageSize: 2 });
      seen.push(...built.data.map((row) => row.amount_minor));
      if (built.nextCursor === null) break;
      cursor = built.nextCursor;
    }
    expect(seen).toHaveLength(5);
    expect(new Set(seen).size).toBe(5);
    expect(seen[0]).toBe(100005);
  });

  it("reports an unvalued asset as unvalued rather than as zero", async () => {
    expect(await resolveMatterAssetValueAsOf(database, assetId, "2026-08-06")).toBeUndefined();
  });
});

describe("appending a valuation", () => {
  it("refuses an amount with no currency", async () => {
    await expect(
      appendMatterAssetValuation(
        database,
        { assetId, asOfDate: "2026-03-14", amountMinor: 1000, basis: "appraisal" },
        options,
      ),
    ).rejects.toMatchObject({ code: "matter-asset-currency-mismatch" });
  });

  it("refuses a basis outside the platform vocabulary", async () => {
    await expect(
      appendMatterAssetValuation(
        database,
        { assetId, asOfDate: "2026-03-14", basis: "guesstimate" },
        options,
      ),
    ).rejects.toBeInstanceOf(MatterAssetValidationError);
  });

  it("refuses a date that does not exist", async () => {
    await expect(
      appendMatterAssetValuation(
        database,
        { assetId, asOfDate: "2026-02-30", basis: "appraisal" },
        options,
      ),
    ).rejects.toMatchObject({ code: "matter-asset-invalid-date" });
  });

  it("records the assertion date separately from the date the figure speaks to", async () => {
    await append("2026-03-14", 40000000, "appraisal");
    const [row] = (await pageMatterAssetValuations(database, assetId)).data;
    expect(row?.as_of_date).toBe("2026-03-14");
    expect(row?.recorded_at).toBe(clock.now());
  });
});
