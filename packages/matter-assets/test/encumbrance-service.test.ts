import { createMatterAsset } from "@magna-carta/matter-assets/asset-service";
import {
  recordMatterAssetEncumbrance,
  releaseMatterAssetEncumbrance,
} from "@magna-carta/matter-assets/encumbrance-service";
import {
  readMatterAssetEncumbrance,
  readMatterAssetEncumbrances,
  readEncumbranceBalancesAsOf,
} from "@magna-carta/matter-assets/encumbrance-statements";
import { encumbrancesInForceAsOf, matterAssetEquity } from "@magna-carta/matter-assets/equity";
import { resolveMatterAssetValueAsOf } from "@magna-carta/matter-assets/as-of";
import { appendMatterAssetValuation } from "@magna-carta/matter-assets/valuation-service";
import type { MatterAssetEncumbranceId, MatterAssetId } from "@magna-carta/identifiers/types";
import { beforeEach, describe, expect, it } from "vitest";
import { MATTER, commit, migratedDatabase, options, seedMatters } from "./support.ts";

// Encumbrances and net equity. The invariant under test throughout: A BALANCE IS A VALUATION ROW, so
// a charge's history has exactly the append-only discipline, the correction shape, and the as-of
// resolution the asset's own value has — with no second implementation of any of it.

let database: ReturnType<typeof migratedDatabase>["database"];

beforeEach(() => {
  const migrated = migratedDatabase();
  database = migrated.database;
  seedMatters(migrated.raw);
});

async function house(): Promise<MatterAssetId> {
  const created = await createMatterAsset(
    database,
    { matterId: MATTER, assetClass: "realProperty", description: "14 Cavendish Row" },
    options,
  );
  await commit(database, created.effect);
  return created.assetId;
}

async function charge(
  assetId: MatterAssetId,
  kind: string,
  holderName: string,
): Promise<MatterAssetEncumbranceId> {
  const recorded = await recordMatterAssetEncumbrance(
    database,
    { assetId, kind, holderName },
    options,
  );
  await commit(database, recorded.effect);
  return recorded.encumbranceId;
}

async function balance(
  assetId: MatterAssetId,
  encumbranceId: MatterAssetEncumbranceId,
  asOfDate: string,
  amountMinor: number,
): Promise<void> {
  const appended = await appendMatterAssetValuation(
    database,
    { assetId, encumbranceId, asOfDate, amountMinor, currency: "USD", basis: "statement" },
    options,
  );
  await commit(database, appended.effect);
}

async function value(assetId: MatterAssetId, asOfDate: string, amountMinor: number): Promise<void> {
  const appended = await appendMatterAssetValuation(
    database,
    { assetId, asOfDate, amountMinor, currency: "USD", basis: "appraisal" },
    options,
  );
  await commit(database, appended.effect);
}

describe("recording a charge against an asset", () => {
  it("records one and lists it as in force", async () => {
    const assetId = await house();
    const encumbranceId = await charge(assetId, "mortgage", "First National");
    const rows = await readMatterAssetEncumbrances(database, assetId);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.kind).toBe("mortgage");
    expect(rows[0]?.released_on).toBeNull();
  });

  it("refuses a kind the vocabulary does not have", async () => {
    const assetId = await house();
    await expect(
      recordMatterAssetEncumbrance(database, { assetId, kind: "vibes" }, options),
    ).rejects.toMatchObject({ code: "matter-asset-unknown-encumbrance-kind" });
  });

  it("releases by writing a date, and the row survives", async () => {
    const assetId = await house();
    const encumbranceId = await charge(assetId, "lien", "Contractor");
    const released = await releaseMatterAssetEncumbrance(
      database,
      encumbranceId,
      "2026-04-01",
      options,
    );
    await commit(database, released.effect);
    const row = await readMatterAssetEncumbrance(database, encumbranceId);
    expect(row?.released_on).toBe("2026-04-01");
    // The row is still there, which is the only way "was this property clear at the date of death"
    // can be answered after the lien has been discharged.
    expect(await readMatterAssetEncumbrances(database, assetId)).toHaveLength(1);
    expect(
      await readMatterAssetEncumbrances(database, assetId, { unreleasedOnly: true }),
    ).toHaveLength(0);
  });
});

describe("a balance is a valuation naming the encumbrance", () => {
  it("refuses a balance naming an encumbrance on a different asset", async () => {
    const houseId = await house();
    const otherCreated = await createMatterAsset(
      database,
      { matterId: MATTER, assetClass: "vehicle", description: "Truck" },
      options,
    );
    await commit(database, otherCreated.effect);
    const mortgage = await charge(houseId, "mortgage", "First National");
    await expect(
      appendMatterAssetValuation(
        database,
        {
          assetId: otherCreated.assetId,
          encumbranceId: mortgage,
          asOfDate: "2026-03-01",
          amountMinor: 100_00,
          currency: "USD",
          basis: "statement",
        },
        options,
      ),
    ).rejects.toMatchObject({ code: "matter-asset-encumbrance-not-on-asset" });
  });

  it("keeps a balance out of the ASSET's own as-of read", async () => {
    // The two numbers live on one table and mean different things; the asset's read filters
    // encumbrance_id IS NULL so a mortgage balance can never be mistaken for the house's value.
    const assetId = await house();
    const mortgage = await charge(assetId, "mortgage", "First National");
    await balance(assetId, mortgage, "2026-03-01", 400_000_00);
    expect(await resolveMatterAssetValueAsOf(database, assetId, "2026-06-01")).toBeUndefined();
    await value(assetId, "2026-03-01", 700_000_00);
    const resolved = await resolveMatterAssetValueAsOf(database, assetId, "2026-06-01");
    expect(resolved?.amountMinor).toBe(700_000_00);
  });

  it("resolves each charge's balance as of a date, in one read", async () => {
    const assetId = await house();
    const mortgage = await charge(assetId, "mortgage", "First National");
    await balance(assetId, mortgage, "2026-01-01", 410_000_00);
    await balance(assetId, mortgage, "2026-06-01", 402_000_00);
    const atMarch = await readEncumbranceBalancesAsOf(database, [mortgage], "2026-03-01");
    expect(atMarch.get(mortgage)?.amountMinor).toBe(410_000_00);
    expect(atMarch.get(mortgage)?.asOfDate).toBe("2026-01-01");
    const atJuly = await readEncumbranceBalancesAsOf(database, [mortgage], "2026-07-01");
    expect(atJuly.get(mortgage)?.amountMinor).toBe(402_000_00);
  });

  it("resolves to nothing before the first balance, never to the earliest", async () => {
    const assetId = await house();
    const mortgage = await charge(assetId, "mortgage", "First National");
    await balance(assetId, mortgage, "2026-06-01", 402_000_00);
    const balances = await readEncumbranceBalancesAsOf(database, [mortgage], "2026-01-01");
    expect(balances.get(mortgage)).toBeUndefined();
  });
});

describe("net equity", () => {
  it("nets two mortgages and ignores one released before the date", async () => {
    const assetId = await house();
    await value(assetId, "2026-02-14", 700_000_00);
    const first = await charge(assetId, "mortgage", "First National");
    const second = await charge(assetId, "deedOfTrust", "Riverside Credit Union");
    const releasedLien = await charge(assetId, "lien", "Contractor");
    await balance(assetId, first, "2026-02-14", 400_000_00);
    await balance(assetId, second, "2026-02-14", 50_000_00);
    await balance(assetId, releasedLien, "2026-01-01", 12_000_00);
    const release = await releaseMatterAssetEncumbrance(
      database,
      releasedLien,
      "2026-02-01",
      options,
    );
    await commit(database, release.effect);

    const all = await readMatterAssetEncumbrances(database, assetId);
    const inForce = encumbrancesInForceAsOf(all, "2026-02-14");
    expect(inForce).toHaveLength(2);
    const balances = await readEncumbranceBalancesAsOf(
      database,
      inForce.map((row) => row.id),
      "2026-02-14",
    );
    const resolved = await resolveMatterAssetValueAsOf(database, assetId, "2026-02-14");
    const equity = matterAssetEquity(resolved, inForce, balances);
    expect(equity.equityAmountMinor).toBe(250_000_00);
    expect(equity.equityCurrency).toBe("USD");
    expect(equity.equityUnavailableReason).toBeUndefined();
  });

  it("still counts a lien that was released AFTER the date asked about", async () => {
    const assetId = await house();
    await value(assetId, "2026-02-14", 700_000_00);
    const lien = await charge(assetId, "lien", "Contractor");
    await balance(assetId, lien, "2026-01-01", 12_000_00);
    const release = await releaseMatterAssetEncumbrance(database, lien, "2026-05-01", options);
    await commit(database, release.effect);
    const all = await readMatterAssetEncumbrances(database, assetId);
    expect(encumbrancesInForceAsOf(all, "2026-02-14")).toHaveLength(1);
    expect(encumbrancesInForceAsOf(all, "2026-06-01")).toHaveLength(0);
  });

  it("refuses to state equity where a charge in force carries no balance", async () => {
    // Not zero. A charge whose size nobody has written down would overstate the equity of exactly the
    // assets a firm most needs to be careful about.
    const assetId = await house();
    await value(assetId, "2026-02-14", 700_000_00);
    const mortgage = await charge(assetId, "mortgage", "First National");
    const all = await readMatterAssetEncumbrances(database, assetId);
    const equity = matterAssetEquity(resolvedNothing(), all, new Map());
    expect(equity.equityUnavailableReason).toBe("no-value-as-of-date");
    const withValue = matterAssetEquity(
      await resolveMatterAssetValueAsOf(database, assetId, "2026-02-14"),
      all,
      new Map(),
    );
    expect(withValue.equityUnavailableReason).toBe("encumbrance-balance-unstated");
    expect(withValue.equityAmountMinor).toBeUndefined();
    expect(mortgage).toBeTruthy();
  });

  it("refuses to net across currencies rather than approximating", async () => {
    const assetId = await house();
    await value(assetId, "2026-02-14", 700_000_00);
    const mortgage = await charge(assetId, "mortgage", "Overseas Bank");
    const appended = await appendMatterAssetValuation(
      database,
      {
        assetId,
        encumbranceId: mortgage,
        asOfDate: "2026-02-14",
        amountMinor: 300_000_00,
        currency: "GBP",
        basis: "statement",
      },
      options,
    );
    await commit(database, appended.effect);
    const all = await readMatterAssetEncumbrances(database, assetId);
    const balances = await readEncumbranceBalancesAsOf(database, [mortgage], "2026-02-14");
    const equity = matterAssetEquity(
      await resolveMatterAssetValueAsOf(database, assetId, "2026-02-14"),
      all,
      balances,
    );
    expect(equity.equityUnavailableReason).toBe("mixed-currency");
    expect(equity.equityAmountMinor).toBeUndefined();
  });

  it("reports negative equity rather than clamping it at zero", async () => {
    // A house worth less than the mortgage on it is the ordinary condition of a great many estates,
    // and clamping would hide the fact the schedule exists to surface.
    const assetId = await house();
    await value(assetId, "2026-02-14", 300_000_00);
    const mortgage = await charge(assetId, "mortgage", "First National");
    await balance(assetId, mortgage, "2026-02-14", 400_000_00);
    const all = await readMatterAssetEncumbrances(database, assetId);
    const balances = await readEncumbranceBalancesAsOf(database, [mortgage], "2026-02-14");
    const equity = matterAssetEquity(
      await resolveMatterAssetValueAsOf(database, assetId, "2026-02-14"),
      all,
      balances,
    );
    expect(equity.equityAmountMinor).toBe(-100_000_00);
  });
});

function resolvedNothing(): undefined {
  return undefined;
}
