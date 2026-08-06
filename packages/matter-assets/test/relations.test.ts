import { createMatterAsset } from "@magna-carta/matter-assets/asset-service";
import {
  linkMatterAssetDocument,
  unlinkMatterAssetDocument,
} from "@magna-carta/matter-assets/document-link-service";
import {
  readMatterAssetDocuments,
  readMatterAssetsForFile,
} from "@magna-carta/matter-assets/document-link-statements";
import {
  addMatterAssetInterest,
  endMatterAssetInterest,
} from "@magna-carta/matter-assets/interest-service";
import { readMatterAssetInterests } from "@magna-carta/matter-assets/interest-statements";
import { readMatterAssetIdsForEntity } from "@magna-carta/matter-assets/queries";
import type { FileId, MatterAssetId } from "@magna-carta/identifiers/types";
import { beforeEach, describe, expect, it } from "vitest";
import {
  MATTER,
  OTHER_MATTER,
  commit,
  migratedDatabase,
  options,
  seedFile,
  seedMatters,
} from "./support.ts";

const HOUSE_FILE = "file_deedElmStreet00000000000000000" as FileId;
const STATEMENT_FILE = "file_brokerageStatement000000000000" as FileId;
const OTHER_MATTER_FILE = "file_otherMatterDeed000000000000000" as FileId;
const HEIR = "directoryPerson_alvarezDaughter0000";

let database: ReturnType<typeof migratedDatabase>["database"];
let houseId: MatterAssetId;
let accountId: MatterAssetId;

beforeEach(async () => {
  const migrated = migratedDatabase();
  database = migrated.database;
  seedMatters(migrated.raw);
  seedFile(migrated.raw, HOUSE_FILE, MATTER, "Deed - Elm Street.pdf");
  seedFile(migrated.raw, STATEMENT_FILE, MATTER, "Northgate statement - March.pdf");
  seedFile(migrated.raw, OTHER_MATTER_FILE, OTHER_MATTER, "Deed - Brown.pdf");

  const house = await createMatterAsset(
    database,
    { matterId: MATTER, assetClass: "realProperty", description: "The house on Elm Street" },
    options,
  );
  await commit(database, house.effect);
  houseId = house.assetId;

  const account = await createMatterAsset(
    database,
    { matterId: MATTER, assetClass: "financialAccount", description: "Brokerage at Northgate" },
    options,
  );
  await commit(database, account.effect);
  accountId = account.assetId;
});

describe("document links", () => {
  it("links a matter file to an asset and reads it back from both directions", async () => {
    const linked = await linkMatterAssetDocument(
      database,
      { assetId: houseId, fileId: HOUSE_FILE, kind: "deed" },
      options,
    );
    await commit(database, linked.effect);

    const fromAsset = await readMatterAssetDocuments(database, houseId);
    expect(fromAsset.map((row) => row.file_id)).toEqual([HOUSE_FILE]);

    const fromFile = await readMatterAssetsForFile(database, HOUSE_FILE);
    expect(fromFile.map((row) => row.asset_id)).toEqual([houseId]);
  });

  // Many-to-many, deliberately diverging from the custody scan link: one statement lists several
  // accounts, and requiring a file to belong to one asset would force a firm to upload it twice.
  it("lets one file evidence more than one asset", async () => {
    for (const assetId of [houseId, accountId]) {
      const linked = await linkMatterAssetDocument(
        database,
        { assetId, fileId: STATEMENT_FILE, kind: "statement" },
        options,
      );
      await commit(database, linked.effect);
    }
    const fromFile = await readMatterAssetsForFile(database, STATEMENT_FILE);
    expect(fromFile.map((row) => row.asset_id).sort()).toEqual([houseId, accountId].sort());
  });

  it("refuses a file filed under another matter", async () => {
    await expect(
      linkMatterAssetDocument(
        database,
        { assetId: houseId, fileId: OTHER_MATTER_FILE, kind: "deed" },
        options,
      ),
    ).rejects.toMatchObject({ code: "matter-asset-document-matter-mismatch" });
  });

  // Unlinking is a filing decision reversed, not a deletion: the file stays exactly where it was in
  // the matter's own file list.
  it("unlinks without touching the file", async () => {
    const linked = await linkMatterAssetDocument(
      database,
      { assetId: houseId, fileId: HOUSE_FILE, kind: "deed" },
      options,
    );
    await commit(database, linked.effect);
    const unlinked = await unlinkMatterAssetDocument(database, linked.documentLinkId, options);
    await commit(database, unlinked.effect);

    expect(await readMatterAssetDocuments(database, houseId)).toHaveLength(0);
    const { results } = await database
      .prepare(`SELECT id FROM file WHERE id = ?1`)
      .bind(HOUSE_FILE)
      .all<{ id: string }>();
    expect(results).toHaveLength(1);
  });
});

describe("interests", () => {
  it("records a fractional share as a rational number", async () => {
    const added = await addMatterAssetInterest(
      database,
      {
        assetId: houseId,
        entityId: HEIR,
        interestRole: "Joint owner",
        shareNumerator: 1,
        shareDenominator: 3,
        effectiveFrom: "2026-03-14",
      },
      options,
    );
    await commit(database, added.effect);
    const [interest] = await readMatterAssetInterests(database, houseId);
    expect(interest?.share_numerator).toBe(1);
    expect(interest?.share_denominator).toBe(3);
  });

  it("refuses a share of one over zero", async () => {
    await expect(
      addMatterAssetInterest(
        database,
        {
          assetId: houseId,
          entityId: HEIR,
          shareNumerator: 1,
          shareDenominator: 0,
          effectiveFrom: "2026-03-14",
        },
        options,
      ),
    ).rejects.toMatchObject({ code: "matter-asset-invalid-share" });
  });

  it("refuses a label outside the list the firm has configured", async () => {
    await expect(
      addMatterAssetInterest(
        database,
        {
          assetId: houseId,
          entityId: HEIR,
          interestRole: "Grand Poobah",
          effectiveFrom: "2026-03-14",
        },
        options,
      ),
    ).rejects.toMatchObject({ code: "matter-asset-interest-role-not-in-catalog" });
  });

  it("ends an interest by writing a date, and no row disappears", async () => {
    const added = await addMatterAssetInterest(
      database,
      { assetId: houseId, entityId: HEIR, effectiveFrom: "2026-03-14" },
      options,
    );
    await commit(database, added.effect);
    expect(await readMatterAssetIdsForEntity(database, HEIR, { limit: 10 })).toEqual([houseId]);

    const ended = await endMatterAssetInterest(database, added.interestId, "2026-08-01", options);
    await commit(database, ended.effect);

    const interests = await readMatterAssetInterests(database, houseId);
    expect(interests).toHaveLength(1);
    expect(interests[0]?.effective_to).toBe("2026-08-01");
    expect(await readMatterAssetIdsForEntity(database, HEIR, { limit: 10 })).toEqual([]);
    expect(
      await readMatterAssetIdsForEntity(database, HEIR, { limit: 10, currentOnly: false }),
    ).toEqual([houseId]);
  });
});
