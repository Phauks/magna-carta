import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { createMatterAsset, updateMatterAsset } from "@magna-carta/matter-assets/asset-service";
import { readMatterAsset } from "@magna-carta/matter-assets/asset-statements";
import {
  custodyItemExists,
  readCustodyPlacementForAsset,
} from "@magna-carta/matter-assets/custody-link-statements";
import { resolveMatterAssetValueAsOf } from "@magna-carta/matter-assets/as-of";
import { appendMatterAssetValuation } from "@magna-carta/matter-assets/valuation-service";
import type { CustodyItemId, MatterAssetId } from "@magna-carta/identifiers/types";
import { beforeEach, describe, expect, it } from "vitest";
import { MATTER, commit, migratedDatabase, options, seedMatters } from "./support.ts";

// THE CUSTODY LINK, and the boundary it must not cross — tested in both directions, because the
// failure it prevents is symmetric: an asset row that copied a location goes stale the moment the
// packet moves, and a valuation written from a declared value silently answers the wrong question.

const SOURCE = join(import.meta.dirname, "..", "src");

let database: ReturnType<typeof migratedDatabase>["database"];
let raw: ReturnType<typeof migratedDatabase>["raw"];

const PACKET = "custodyPacket_ringTest00000000000";
const ITEM = "custodyItem_ringTest00000000000000" as CustodyItemId;
const LOCATION = "custodyLocation_safeTest0000000000";

beforeEach(() => {
  const migrated = migratedDatabase();
  database = migrated.database;
  raw = migrated.raw;
  seedMatters(raw);
  seedCustody();
});

// Written with raw SQL because this package holds no Custodian service and must not start: the
// register points AT Custodian and never writes to it.
function seedCustody(): void {
  raw.exec(
    `INSERT INTO custody_location (id, name, kind, status, created_at, updated_at) ` +
      `VALUES ('${LOCATION}', 'Main safe', 'safe', 'active', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')`,
  );
  raw.exec(
    `INSERT INTO custody_packet (id, custody_number, number_source, name, current_location_id, status, created_at, updated_at) ` +
      `VALUES ('${PACKET}', 'CUS-00042', 'drawn', 'Alvarez deposit', '${LOCATION}', 'held', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')`,
  );
  raw.exec(
    `INSERT INTO custody_item (id, packet_id, ordinal, description, intrinsic_value, declared_value_amount_minor, declared_value_currency, status, created_at, updated_at) ` +
      `VALUES ('${ITEM}', '${PACKET}', 1, 'Gold signet ring', 1, 2500_00, 'USD', 'held', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')`,
  );
}

async function ring(): Promise<MatterAssetId> {
  const created = await createMatterAsset(
    database,
    { matterId: MATTER, assetClass: "personalProperty", description: "Gold signet ring" },
    options,
  );
  await commit(database, created.effect);
  return created.assetId;
}

describe("linking a scheduled asset to the custody item that holds it", () => {
  it("sets and clears the link through the patch path", async () => {
    const assetId = await ring();
    const linked = await updateMatterAsset(database, assetId, { custodyItemId: ITEM }, options);
    await commit(database, linked.effect);
    expect((await readMatterAsset(database, assetId))?.custody_item_id).toBe(ITEM);

    const cleared = await updateMatterAsset(database, assetId, { custodyItemId: null }, options);
    await commit(database, cleared.effect);
    expect((await readMatterAsset(database, assetId))?.custody_item_id).toBeNull();
  });

  it("refuses a custody item that does not exist in this firm", async () => {
    const assetId = await ring();
    await expect(
      updateMatterAsset(
        database,
        assetId,
        { custodyItemId: "custodyItem_nothingHere000000000000" as CustodyItemId },
        options,
      ),
    ).rejects.toMatchObject({ code: "matter-asset-unknown-custody-item" });
    expect(await custodyItemExists(database, ITEM)).toBe(true);
  });

  it("lets the same held object be scheduled in two matters", async () => {
    // No unique index, deliberately: the decedent's estate and the related trust may both schedule
    // the ring, and forbidding that would force a firm to unlink to get past a constraint.
    const first = await ring();
    const second = await ring();
    for (const assetId of [first, second]) {
      const linked = await updateMatterAsset(database, assetId, { custodyItemId: ITEM }, options);
      await commit(database, linked.effect);
    }
    expect((await readMatterAsset(database, first))?.custody_item_id).toBe(ITEM);
    expect((await readMatterAsset(database, second))?.custody_item_id).toBe(ITEM);
  });
});

describe("who owns which fact — direction one: Custodian's facts are READ, never copied", () => {
  it("composes location, status, and hold state out of Custodian at read time", async () => {
    const assetId = await ring();
    const linked = await updateMatterAsset(database, assetId, { custodyItemId: ITEM }, options);
    await commit(database, linked.effect);

    const placement = await readCustodyPlacementForAsset(database, ITEM);
    expect(placement?.locationName).toBe("Main safe");
    expect(placement?.status).toBe("held");
    expect(placement?.custodyNumber).toBe("CUS-00042");
    expect(placement?.held).toBe(false);

    // The packet moves in Custodian. The asset row is untouched and the NEXT read says so — which is
    // only possible because nothing was copied.
    raw.exec(`UPDATE custody_packet SET current_location_id = NULL WHERE id = '${PACKET}'`);
    raw.exec(
      `INSERT INTO custody_hold (id, packet_id, kind, placed_at, created_at, updated_at) ` +
        `VALUES ('custodyHold_disputeTest0000000000', '${PACKET}', 'dispute', '2026-03-01T00:00:00.000Z', '2026-03-01T00:00:00.000Z', '2026-03-01T00:00:00.000Z')`,
    );
    const afterMove = await readCustodyPlacementForAsset(database, ITEM);
    expect(afterMove?.locationName).toBeNull();
    expect(afterMove?.held).toBe(true);
  });

  it("stores no location, status, or movement column on the asset row", async () => {
    const columns = raw.prepare(`SELECT name FROM pragma_table_info('matter_asset')`).all() as {
      name: string;
    }[];
    const names = columns.map((column) => column.name);
    expect(names).toContain("custody_item_id");
    for (const forbidden of [
      "custody_location_id",
      "custody_status",
      "custody_location",
      "location_id",
      "held",
    ]) {
      expect(names, forbidden).not.toContain(forbidden);
    }
  });
});

describe("who owns which fact — direction two: the two numbers never cross", () => {
  it("never writes a valuation from a custody declared value", async () => {
    // custody_item.declared_value_amount_minor is what the object is worth as a thing in a safe — an
    // insurance and risk number for the FIRM's exposure. A valuation is what the property is worth to
    // the estate as of a date on a stated basis. A signed first edition has both and they are not the
    // same number, so linking the ring puts no figure on the register at all.
    const assetId = await ring();
    const linked = await updateMatterAsset(database, assetId, { custodyItemId: ITEM }, options);
    await commit(database, linked.effect);
    expect(await resolveMatterAssetValueAsOf(database, assetId, "2026-12-31")).toBeUndefined();

    // And a valuation appended here writes nothing back to Custodian.
    const appended = await appendMatterAssetValuation(
      database,
      {
        assetId,
        asOfDate: "2026-02-14",
        amountMinor: 900_00,
        currency: "USD",
        basis: "appraisal",
      },
      options,
    );
    await commit(database, appended.effect);
    const item = raw
      .prepare(`SELECT declared_value_amount_minor AS declared FROM custody_item WHERE id = ?`)
      .get(ITEM) as { declared: number };
    expect(item.declared).toBe(2500_00);
    expect((await resolveMatterAssetValueAsOf(database, assetId, "2026-12-31"))?.amountMinor).toBe(
      900_00,
    );
  });

  // The source scan, so a path somebody writes later is caught at review rather than in an estate's
  // schedule. Nothing in this package may name Custodian's declared-value columns AT ALL: reading one
  // is the first half of copying it.
  it("names no custody declared-value column anywhere in the package source", () => {
    const offenders = sourceFiles(SOURCE).filter((path) =>
      /declared_value_amount_minor|declared_value_currency|declaredValue/.test(
        codeWithoutComments(path),
      ),
    );
    expect(offenders).toEqual([]);
  });

  // And nothing writes INTO Custodian. The register points at the older, broader subsystem and never
  // reaches into it: Custodian never grows a matter-scoped column and never learns what an estate is.
  it("issues no INSERT, UPDATE, or DELETE against any custody table", () => {
    const offenders = sourceFiles(SOURCE).filter((path) =>
      /(INSERT\s+INTO|UPDATE|DELETE\s+FROM)\s+(\$\{?CUSTODY_[A-Z_]*\}?|custody_[a-z_]+)/i.test(
        codeWithoutComments(path),
      ),
    );
    expect(offenders).toEqual([]);
  });
});

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return entry.name.endsWith(".ts") ? [path] : [];
  });
}

function codeWithoutComments(path: string): string {
  return readFileSync(path, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}
