import {
  createMatterAsset,
  createMatterAssetBatch,
  deleteMatterAsset,
  updateMatterAsset,
} from "@magna-carta/matter-assets/asset-service";
import {
  createMatterAssetType,
  deactivateMatterAssetType,
} from "@magna-carta/matter-assets/asset-type-service";
import {
  readMatterAsset,
  readMatterAssetRealProperty,
} from "@magna-carta/matter-assets/asset-statements";
import { readMatterAssetTypes } from "@magna-carta/matter-assets/asset-type-statements";
import { readMatterAssetPage } from "@magna-carta/matter-assets/queries";
import { MAX_MATTER_ASSET_BATCH } from "@magna-carta/matter-assets/types";
import { beforeEach, describe, expect, it } from "vitest";
import { MATTER, commit, migratedDatabase, options, seedMatters } from "./support.ts";

let database: ReturnType<typeof migratedDatabase>["database"];

beforeEach(() => {
  const migrated = migratedDatabase();
  database = migrated.database;
  seedMatters(migrated.raw);
});

describe("recording an asset", () => {
  // Two fields make a row. Every required attribute beyond these two is a reason for a firm to keep
  // its inventory in a spreadsheet instead.
  it("takes a class and a description and nothing else", async () => {
    const created = await createMatterAsset(
      database,
      {
        matterId: MATTER,
        assetClass: "personalProperty",
        description: "contents of the garage, not yet itemized",
      },
      options,
    );
    await commit(database, created.effect);
    const row = await readMatterAsset(database, created.assetId);
    expect(row?.description).toBe("contents of the garage, not yet itemized");
    expect(row?.estate_treatment).toBe("undetermined");
    expect(row?.disposition).toBe("retained");
  });

  it("writes the class attribute row and the inline valuation in the same commit", async () => {
    const created = await createMatterAsset(
      database,
      {
        matterId: MATTER,
        assetClass: "realProperty",
        description: "The house on Elm Street",
        realProperty: {
          street: "114 Elm Street",
          city: "Reno",
          region: "NV",
          parcelNumber: "012-345-67",
        },
        valuation: {
          asOfDate: "2026-03-14",
          amountMinor: 40000000,
          currency: "USD",
          basis: "clientEstimate",
        },
      },
      options,
    );
    await commit(database, created.effect);
    const attributes = await readMatterAssetRealProperty(database, created.assetId);
    // Plaintext and searchable, because a parcel number is on the assessor's public roll.
    expect(attributes?.parcel_number).toBe("012-345-67");
    const page = await readMatterAssetPage(database, MATTER, { limit: 10, valued: true });
    expect(page.map((row) => row.id)).toContain(created.assetId);
  });

  it("refuses attributes belonging to another class rather than dropping them", async () => {
    await expect(
      createMatterAsset(
        database,
        {
          matterId: MATTER,
          assetClass: "financialAccount",
          description: "Checking at First National",
          realProperty: { parcelNumber: "012-345-67" },
        },
        options,
      ),
    ).rejects.toMatchObject({ code: "matter-asset-type-class-mismatch" });
  });

  it("refuses a class whose structured attributes have not shipped yet, by name", async () => {
    await expect(
      createMatterAsset(
        database,
        { matterId: MATTER, assetClass: "firearm", description: "Shotgun in the safe" },
        options,
      ),
    ).rejects.toMatchObject({ code: "matter-asset-class-unavailable" });
  });

  it("refuses an empty description", async () => {
    await expect(
      createMatterAsset(
        database,
        { matterId: MATTER, assetClass: "other", description: "   " },
        options,
      ),
    ).rejects.toMatchObject({ code: "matter-asset-empty-description" });
  });
});

describe("the type catalog under a class", () => {
  it("seeds a starting catalog for the two classes this slice ships", async () => {
    const realProperty = await readMatterAssetTypes(database, { assetClass: "realProperty" });
    const accounts = await readMatterAssetTypes(database, { assetClass: "financialAccount" });
    expect(realProperty.map((row) => row.name)).toContain("Single-family residence");
    expect(accounts.map((row) => row.name)).toContain("Brokerage account");
  });

  it("refuses a type whose class differs from the asset's", async () => {
    const accountTypes = await readMatterAssetTypes(database, { assetClass: "financialAccount" });
    const brokerage = accountTypes.find((row) => row.name === "Brokerage account");
    expect(brokerage).toBeDefined();
    await expect(
      createMatterAsset(
        database,
        {
          matterId: MATTER,
          assetClass: "realProperty",
          description: "The house on Elm Street",
          assetTypeId: brokerage?.id,
        },
        options,
      ),
    ).rejects.toMatchObject({ code: "matter-asset-type-class-mismatch" });
  });

  it("refuses a duplicate name and deactivates rather than deleting", async () => {
    await expect(
      createMatterAssetType(database, { name: "Condominium", assetClass: "realProperty" }, options),
    ).rejects.toMatchObject({ code: "matter-asset-type-name-taken" });

    const created = await createMatterAssetType(
      database,
      { name: "Mobile home", assetClass: "realProperty", position: 9 },
      options,
    );
    await commit(database, created.effect);
    const deactivated = await deactivateMatterAssetType(database, created.assetTypeId, options);
    await commit(database, deactivated.effect);
    const active = await readMatterAssetTypes(database, { assetClass: "realProperty" });
    expect(active.map((row) => row.id)).not.toContain(created.assetTypeId);
    const all = await readMatterAssetTypes(database, {
      assetClass: "realProperty",
      includeInactive: true,
    });
    // Deactivated, never deleted: every asset already filed under it keeps its meaning.
    expect(all.map((row) => row.id)).toContain(created.assetTypeId);
  });
});

describe("editing and removing an asset", () => {
  it("refuses a patch that names the class", async () => {
    const created = await createMatterAsset(
      database,
      { matterId: MATTER, assetClass: "other", description: "A thing" },
      options,
    );
    await commit(database, created.effect);
    await expect(
      updateMatterAsset(database, created.assetId, { assetClass: "realProperty" }, options),
    ).rejects.toMatchObject({ code: "matter-asset-class-frozen" });
  });

  it("takes a soft delete off the register and leaves the row", async () => {
    const created = await createMatterAsset(
      database,
      { matterId: MATTER, assetClass: "other", description: "A thing" },
      options,
    );
    await commit(database, created.effect);
    const deleted = await deleteMatterAsset(database, created.assetId, options);
    await commit(database, deleted.effect);
    expect(await readMatterAsset(database, created.assetId)).toBeUndefined();
    const page = await readMatterAssetPage(database, MATTER, { limit: 10 });
    expect(page).toHaveLength(0);
  });
});

describe("bulk quick entry", () => {
  it("writes every row in one effect", async () => {
    const batch = await createMatterAssetBatch(
      database,
      MATTER,
      [
        { assetClass: "realProperty", description: "The house on Elm Street" },
        { assetClass: "financialAccount", description: "Checking at First National" },
        { assetClass: "financialAccount", description: "Brokerage at Northgate" },
      ],
      options,
    );
    await commit(database, batch.effect);
    expect(batch.assetIds).toHaveLength(3);
    const page = await readMatterAssetPage(database, MATTER, { limit: 10 });
    expect(page).toHaveLength(3);
    const accountsOnly = await readMatterAssetPage(database, MATTER, {
      limit: 10,
      assetClass: "financialAccount",
    });
    expect(accountsOnly).toHaveLength(2);
  });

  // Refused, never truncated: a caller that sent sixty rows and silently had fifty written cannot
  // tell that from fifty rows it never sent.
  it("refuses a batch over the bound rather than truncating it", async () => {
    const rows = Array.from({ length: MAX_MATTER_ASSET_BATCH + 1 }, (_unused, index) => ({
      assetClass: "other",
      description: `Item ${index + 1}`,
    }));
    await expect(createMatterAssetBatch(database, MATTER, rows, options)).rejects.toMatchObject({
      code: "matter-asset-batch-too-large",
    });
  });
});
