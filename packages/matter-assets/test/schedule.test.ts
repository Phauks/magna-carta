import { createMatterAsset } from "@magna-carta/matter-assets/asset-service";
import { recordMatterAssetEncumbrance } from "@magna-carta/matter-assets/encumbrance-service";
import { readMatterAssetSchedule } from "@magna-carta/matter-assets/schedule";
import { appendMatterAssetValuation } from "@magna-carta/matter-assets/valuation-service";
import type { MatterAssetId } from "@magna-carta/identifiers/types";
import { beforeEach, describe, expect, it } from "vitest";
import { MATTER, commit, migratedDatabase, options, seedMatters } from "./support.ts";

// The estate schedule. The end-to-end shape the subsystem exists to produce: the same corpus read as
// of two dates, with only the numbers moving.

let database: ReturnType<typeof migratedDatabase>["database"];

beforeEach(() => {
  const migrated = migratedDatabase();
  database = migrated.database;
  seedMatters(migrated.raw);
});

async function asset(
  assetClass: string,
  description: string,
  extra: Record<string, unknown> = {},
): Promise<MatterAssetId> {
  const created = await createMatterAsset(
    database,
    { matterId: MATTER, assetClass, description, ...extra },
    options,
  );
  await commit(database, created.effect);
  return created.assetId;
}

async function value(
  assetId: MatterAssetId,
  asOfDate: string,
  amountMinor: number,
  currency = "USD",
): Promise<void> {
  const appended = await appendMatterAssetValuation(
    database,
    { assetId, asOfDate, amountMinor, currency, basis: "appraisal" },
    options,
  );
  await commit(database, appended.effect);
}

describe("the estate schedule", () => {
  it("groups by class, subtotals per currency, and states the unvalued count rather than hiding it", async () => {
    const houseId = await asset("realProperty", "14 Cavendish Row", {
      estateTreatment: "probateEstate",
    });
    const accountId = await asset("financialAccount", "Checking at First National", {
      estateTreatment: "nonProbateTransfer",
    });
    const truckId = await asset("vehicle", "2019 pickup");
    await asset("personalProperty", "contents of the garage, not yet itemized");

    await value(houseId, "2026-02-14", 700_000_00);
    await value(accountId, "2026-02-14", 42_000_00);
    await value(truckId, "2026-02-14", 18_000_00);

    const schedule = await readMatterAssetSchedule(database, MATTER, "2026-02-14");
    expect(schedule.totalAssets).toBe(4);
    // The garage. Counted and visible, which is a true statement and an actionable one.
    expect(schedule.unvaluedCount).toBe(1);
    expect(schedule.groups.map((group) => group.assetClass)).toEqual([
      "realProperty",
      "financialAccount",
      "vehicle",
      "personalProperty",
    ]);
    const realProperty = schedule.groups[0];
    expect(realProperty?.subtotals).toEqual([
      {
        currency: "USD",
        valueAmountMinor: 700_000_00,
        equityAmountMinor: 700_000_00,
        countedAssets: 1,
      },
    ]);
    const personal = schedule.groups.at(-1);
    expect(personal?.unvaluedCount).toBe(1);
    expect(personal?.subtotals).toEqual([]);
    // `undetermined` is its OWN group and never merged away — the register asserts nothing about
    // which of these passes through probate.
    expect(schedule.estateTreatmentCounts).toEqual({
      probateEstate: 1,
      nonProbateTransfer: 1,
      undetermined: 2,
    });
  });

  it("reads the same corpus as of two dates with only the numbers moving", async () => {
    const houseId = await asset("realProperty", "14 Cavendish Row");
    await value(houseId, "2026-02-14", 700_000_00);
    await value(houseId, "2026-07-01", 745_000_00);

    const atDeath = await readMatterAssetSchedule(database, MATTER, "2026-02-14");
    const today = await readMatterAssetSchedule(database, MATTER, "2026-08-01");
    expect(atDeath.groups[0]?.rows[0]?.value?.amountMinor).toBe(700_000_00);
    expect(atDeath.groups[0]?.rows[0]?.value?.asOfDate).toBe("2026-02-14");
    expect(today.groups[0]?.rows[0]?.value?.amountMinor).toBe(745_000_00);
    expect(today.groups[0]?.rows[0]?.value?.asOfDate).toBe("2026-07-01");
    // Everything that is not a number is identical.
    expect(today.totalAssets).toBe(atDeath.totalAssets);
    expect(today.groups.map((group) => group.assetClass)).toEqual(
      atDeath.groups.map((group) => group.assetClass),
    );
  });

  it("resolves an asset with no valuation at the date HONESTLY, as unvalued and not as zero", async () => {
    // The asset was appraised in July. As of the date of death in February there is no figure at or
    // before the date, so the schedule says so rather than extrapolating backwards — an asset
    // acquired after the date of death is not in the estate at the date of death.
    const houseId = await asset("realProperty", "14 Cavendish Row");
    await value(houseId, "2026-07-01", 745_000_00);

    const atDeath = await readMatterAssetSchedule(database, MATTER, "2026-02-14");
    const row = atDeath.groups[0]?.rows[0];
    expect(row?.value).toBeUndefined();
    expect(atDeath.unvaluedCount).toBe(1);
    // No zero anywhere: the subtotal list is EMPTY rather than carrying a zero in some currency the
    // schedule would have had to invent.
    expect(atDeath.groups[0]?.subtotals).toEqual([]);
    expect(row?.equity.equityAmountMinor).toBeUndefined();
    expect(row?.equity.equityUnavailableReason).toBe("no-value-as-of-date");
  });

  it("nets equity per row and withholds a group's equity subtotal when one balance is unstated", async () => {
    const houseId = await asset("realProperty", "14 Cavendish Row");
    const cabinId = await asset("realProperty", "Lakeside cabin");
    await value(houseId, "2026-02-14", 700_000_00);
    await value(cabinId, "2026-02-14", 200_000_00);

    const mortgage = await recordMatterAssetEncumbrance(
      database,
      { assetId: houseId, kind: "mortgage", holderName: "First National" },
      options,
    );
    await commit(database, mortgage.effect);
    const balance = await appendMatterAssetValuation(
      database,
      {
        assetId: houseId,
        encumbranceId: mortgage.encumbranceId,
        asOfDate: "2026-02-14",
        amountMinor: 400_000_00,
        currency: "USD",
        basis: "statement",
      },
      options,
    );
    await commit(database, balance.effect);

    const withBalance = await readMatterAssetSchedule(database, MATTER, "2026-02-14");
    expect(withBalance.groups[0]?.subtotals[0]).toEqual({
      currency: "USD",
      valueAmountMinor: 900_000_00,
      equityAmountMinor: 500_000_00,
      countedAssets: 2,
    });

    // A second charge with no balance recorded. The value subtotal still stands; the EQUITY subtotal
    // does not, because a number computed over the rows that happened to work looks complete and is
    // not.
    const lien = await recordMatterAssetEncumbrance(
      database,
      { assetId: cabinId, kind: "lien", holderName: "Contractor" },
      options,
    );
    await commit(database, lien.effect);
    const withoutBalance = await readMatterAssetSchedule(database, MATTER, "2026-02-14");
    expect(withoutBalance.groups[0]?.subtotals[0]?.valueAmountMinor).toBe(900_000_00);
    expect(withoutBalance.groups[0]?.subtotals[0]?.equityAmountMinor).toBeUndefined();
  });

  it("refuses a date that is not a date, and never assumes today", async () => {
    await expect(readMatterAssetSchedule(database, MATTER, "2026-02-30")).rejects.toMatchObject({
      code: "matter-asset-invalid-date",
    });
    await expect(readMatterAssetSchedule(database, MATTER, "sometime")).rejects.toMatchObject({
      code: "matter-asset-invalid-date",
    });
  });
});
