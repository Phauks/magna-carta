import { createMatterAsset } from "@magna-carta/matter-assets/asset-service";
import { recordMatterAssetIdentifier } from "@magna-carta/matter-assets/identifier-service";
import { readMatterAssetIdentifiers } from "@magna-carta/matter-assets/identifier-statements";
import type { ProtectedContext } from "@magna-carta/data-access/protected-fields";
import type { MatterAssetId } from "@magna-carta/identifiers/types";
import { beforeEach, describe, expect, it } from "vitest";
import { MATTER, commit, migratedDatabase, options, seedMatters } from "./support.ts";

// The credential refusal and the suffix rule, proved where they are decided: in the service, before
// anything is sealed and before anything is written. The full round trip through encryption — seal,
// permission gate, audit row, decrypt — is proved in the worker suite, which is where a real firm
// key provider exists.

// Never reached by any test in this file: every case here is refused before a seal is attempted, and
// a case that did reach it would fail loudly rather than silently store a plaintext.
const unreachableProtectedContext = {
  firmId: "firm_matterAssetsUnitTest000000000",
  firmKeyVersion: 1,
  firmKeyProvider: {
    getFirmHkdfKey() {
      throw new Error("no protected write should be attempted in this file");
    },
  },
} as unknown as ProtectedContext;

let database: ReturnType<typeof migratedDatabase>["database"];
let accountId: MatterAssetId;

beforeEach(async () => {
  const migrated = migratedDatabase();
  database = migrated.database;
  seedMatters(migrated.raw);
  const account = await createMatterAsset(
    database,
    { matterId: MATTER, assetClass: "financialAccount", description: "Brokerage at Northgate" },
    options,
  );
  await commit(database, account.effect);
  accountId = account.assetId;
});

describe("credentials are refused outright", () => {
  // A protected column is decryptable by any member holding the decrypt permission, and for a
  // self-custodied digital asset the seed phrase IS the asset: storing one would convert a records
  // system into a bearer instrument.
  it.each([
    ["seedPhrase"],
    ["seed phrase"],
    ["recovery-phrase"],
    ["password"],
    ["safe combination"],
    ["privateKey"],
    ["personalIdentificationNumber"],
  ])("refuses a %s by name, with its own code and nothing written", async (kind) => {
    await expect(
      recordMatterAssetIdentifier(
        database,
        unreachableProtectedContext,
        { assetId: accountId, kind, value: "correct horse battery staple" },
        options,
      ),
    ).rejects.toMatchObject({ code: "matter-asset-credential-storage-refused" });
    expect(await readMatterAssetIdentifiers(database, accountId)).toHaveLength(0);
  });

  it("refuses a value that names a credential even under an allowed kind", async () => {
    await expect(
      recordMatterAssetIdentifier(
        database,
        unreachableProtectedContext,
        {
          assetId: accountId,
          kind: "other",
          value: "online banking password: hunter2",
        },
        options,
      ),
    ).rejects.toMatchObject({ code: "matter-asset-credential-storage-refused" });
  });

  it("refuses an identifier kind it does not carry, distinctly from a credential", async () => {
    await expect(
      recordMatterAssetIdentifier(
        database,
        unreachableProtectedContext,
        { assetId: accountId, kind: "routingNumber", value: "123456789" },
        options,
      ),
    ).rejects.toMatchObject({ code: "matter-asset-unknown-identifier-kind" });
  });
});

describe("a suffix alone is a complete record", () => {
  it("stores a suffix with no sealed value at all", async () => {
    const recorded = await recordMatterAssetIdentifier(
      database,
      unreachableProtectedContext,
      { assetId: accountId, kind: "accountNumber", displaySuffix: "4417" },
      options,
    );
    await commit(database, recorded.effect);
    const [identifier] = await readMatterAssetIdentifiers(database, accountId);
    expect(identifier?.display_suffix).toBe("4417");
    expect(identifier?.kind).toBe("accountNumber");
  });

  it("refuses a row carrying neither a suffix nor a value", async () => {
    await expect(
      recordMatterAssetIdentifier(
        database,
        unreachableProtectedContext,
        { assetId: accountId, kind: "accountNumber" },
        options,
      ),
    ).rejects.toMatchObject({ code: "matter-asset-identifier-empty" });
  });

  it("refuses a readable suffix longer than four characters", async () => {
    await expect(
      recordMatterAssetIdentifier(
        database,
        unreachableProtectedContext,
        { assetId: accountId, kind: "accountNumber", displaySuffix: "44172" },
        options,
      ),
    ).rejects.toMatchObject({ code: "matter-asset-identifier-empty" });
  });
});
