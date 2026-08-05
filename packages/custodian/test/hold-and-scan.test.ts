import type { FileId, MatterId } from "@magna-carta/identifiers/types";
import { describe, expect, it } from "vitest";
import { placeCustodyHold, releaseCustodyHold } from "../src/hold-service.ts";
import { readActiveCustodyHoldsForFile, readCustodyHolds } from "../src/hold-statements.ts";
import { addCustodyItem } from "../src/item-service.ts";
import { createCustodyLocation } from "../src/location-service.ts";
import { recordCustodyMovement } from "../src/movement-service.ts";
import { readCustodyMovements } from "../src/movement-statements.ts";
import { createCustodyPacket } from "../src/packet-service.ts";
import { readCustodyItems } from "../src/packet-statements.ts";
import { linkCustodyScan, resolveCustodyFilingMatter } from "../src/scan-service.ts";
import { readCustodyScans } from "../src/scan-statements.ts";
import {
  ACTOR,
  AUTHORIZED_RELEASE,
  commit,
  migratedDatabase,
  options,
  seedMember,
} from "./support.ts";

const SMITH = "directoryPerson_smith0000000000000";

async function scaffold() {
  const { database, raw } = migratedDatabase();
  seedMember(raw);
  const { locationId: safe, effect } = await createCustodyLocation(
    database,
    { name: "Main safe", kind: "safe" },
    options,
  );
  await commit(database, effect);
  const created = await createCustodyPacket(
    database,
    { name: "Smith family deeds", owners: [{ entityId: SMITH }], currentLocationId: safe },
    { ...options, responsibleMemberId: ACTOR },
  );
  return {
    database,
    raw,
    safe,
    packetId: created.packetId,
    filingMatterId: created.filingMatterId,
  };
}

// A file as the File Manager would have left it: ingested through the ordinary presigned-upload and
// quarantine path and filed on a matter. Custodian never writes one — it only links an existing one.
function seedFile(
  raw: ReturnType<typeof migratedDatabase>["raw"],
  fileId: string,
  matterId: MatterId,
): FileId {
  raw.exec(
    `INSERT INTO file (id, matter_id, name, created_at, updated_at) VALUES ('${fileId}', '${matterId}', 'will-scan.pdf', '2026-08-04T00:00:00.000Z', '2026-08-04T00:00:00.000Z')`,
  );
  return fileId as FileId;
}

describe("holds block release and destruction, and nothing else", () => {
  it("refuses a release and a destruction while a hold is in force", async () => {
    const { database, packetId } = await scaffold();
    const { effect } = await placeCustodyHold(
      database,
      packetId,
      { kind: "legal", reason: "estate dispute" },
      options,
    );
    await commit(database, effect);

    await expect(
      recordCustodyMovement(database, packetId, AUTHORIZED_RELEASE, options),
    ).rejects.toMatchObject({ code: "custody-hold-blocks-action" });
    await expect(
      recordCustodyMovement(database, packetId, { kind: "destroyed" }, options),
    ).rejects.toMatchObject({ code: "custody-hold-blocks-action" });
  });

  // A held original still has to be movable to a fireproof safe: a hold that stopped that would make
  // firms route around the register.
  it("permits a location move under hold", async () => {
    const { database, packetId } = await scaffold();
    const { effect } = await placeCustodyHold(database, packetId, { kind: "discovery" }, options);
    await commit(database, effect);
    const { locationId: vault, effect: locationEffect } = await createCustodyLocation(
      database,
      { name: "Fireproof vault", kind: "safe" },
      options,
    );
    await commit(database, locationEffect);
    const moved = await recordCustodyMovement(
      database,
      packetId,
      { kind: "moved", toLocationId: vault },
      options,
    );
    expect(moved.movementId).toBeDefined();
  });

  it("re-enables the blocked actions once the hold is released", async () => {
    const { database, packetId } = await scaffold();
    const placed = await placeCustodyHold(database, packetId, { kind: "unclaimed" }, options);
    await commit(database, placed.effect);
    const released = await releaseCustodyHold(database, placed.holdId, options);
    await commit(database, released.effect);

    const movement = await recordCustodyMovement(database, packetId, AUTHORIZED_RELEASE, options);
    expect(movement.packetStatus).toBe("released");
  });

  // The ledger has to be the complete story, so a hold's placement and release are movements too.
  it("appends a movement for the placement and the release", async () => {
    const { database, packetId } = await scaffold();
    const placed = await placeCustodyHold(database, packetId, { kind: "legal" }, options);
    await commit(database, placed.effect);
    const released = await releaseCustodyHold(database, placed.holdId, options);
    await commit(database, released.effect);

    const kinds = (await readCustodyMovements(database, packetId, 20)).map(
      (movement) => movement.kind,
    );
    expect(kinds).toContain("hold_placed");
    expect(kinds).toContain("hold_released");
    // The hold row itself is kept, released rather than deleted.
    const holds = await readCustodyHolds(database, packetId);
    expect(holds).toHaveLength(1);
    expect(holds[0]?.released_at).not.toBeNull();
  });

  it("refuses to release a hold twice", async () => {
    const { database, packetId } = await scaffold();
    const placed = await placeCustodyHold(database, packetId, { kind: "dispute" }, options);
    await commit(database, placed.effect);
    const released = await releaseCustodyHold(database, placed.holdId, options);
    await commit(database, released.effect);
    await expect(releaseCustodyHold(database, placed.holdId, options)).rejects.toMatchObject({
      code: "custody-hold-already-released",
    });
  });
});

describe("scanned copies bind over ordinary File Manager files", () => {
  it("links a scan on a matterless packet through the firm's holding matter", async () => {
    const { database, raw, packetId, filingMatterId } = await scaffold();
    const fileId = seedFile(raw, "file_custodyScan00000000000000", filingMatterId);
    const { scanId, effect } = await linkCustodyScan(
      database,
      packetId,
      { fileId, kind: "scan" },
      options,
    );
    await commit(database, effect);

    const scans = await readCustodyScans(database, packetId);
    expect(scans).toHaveLength(1);
    expect(scans[0]).toMatchObject({ id: scanId, file_id: fileId, kind: "scan" });
    expect(await resolveCustodyFilingMatter(database, packetId)).toBe(filingMatterId);
  });

  // A file handle alone must not be enough to attach a document to a packet: a file filed on another
  // matter is somebody else's record.
  it("refuses a file filed somewhere other than the packet's filing target", async () => {
    const { database, raw, packetId } = await scaffold();
    raw.exec(
      `INSERT INTO matter (id, title, status, responsible_member_id, created_at, updated_at) VALUES ('matter_unrelated0000000000000', 'Unrelated matter', 'open', '${ACTOR}', '2026-08-04T00:00:00.000Z', '2026-08-04T00:00:00.000Z')`,
    );
    const fileId = seedFile(
      raw,
      "file_elsewhere00000000000000000",
      "matter_unrelated0000000000000" as MatterId,
    );
    await expect(
      linkCustodyScan(database, packetId, { fileId, kind: "scan" }, options),
    ).rejects.toMatchObject({ code: "custody-scan-file-not-filed-here" });
  });

  it("refuses an unknown file", async () => {
    const { database, packetId } = await scaffold();
    await expect(
      linkCustodyScan(
        database,
        packetId,
        { fileId: "file_neverIngested000000000000" as FileId, kind: "scan" },
        options,
      ),
    ).rejects.toMatchObject({ code: "custody-scan-file-not-filed-here" });
  });

  // "We have a scan" is precisely the reasoning that destroys an original will, so a scan satisfies
  // no gate: an intrinsic-value item is no more destructible with a scan attached than without one.
  it("does not make a held packet releasable", async () => {
    const { database, raw, packetId, filingMatterId } = await scaffold();
    const item = await addCustodyItem(
      database,
      packetId,
      { description: "Original will of Jane Smith", intrinsicValue: true },
      options,
    );
    await commit(database, item.effect);
    const fileId = seedFile(raw, "file_scanOfTheWill000000000000", filingMatterId);
    const linked = await linkCustodyScan(
      database,
      packetId,
      { fileId, kind: "scan", itemId: item.itemId },
      options,
    );
    await commit(database, linked.effect);

    const hold = await placeCustodyHold(database, packetId, { kind: "legal" }, options);
    await commit(database, hold.effect);
    await expect(
      recordCustodyMovement(database, packetId, { kind: "destroyed" }, options),
    ).rejects.toMatchObject({ code: "custody-hold-blocks-action" });
  });

  // The blocker read a hold-aware destruction sweep calls: a scan inherits its packet's holds, so
  // the scan of a will under a legal hold is not destroyable by a retention pass.
  it("reports a file as held when its packet is under a hold", async () => {
    const { database, raw, packetId, filingMatterId } = await scaffold();
    const fileId = seedFile(raw, "file_underHold0000000000000000", filingMatterId);
    const linked = await linkCustodyScan(database, packetId, { fileId, kind: "scan" }, options);
    await commit(database, linked.effect);

    expect(await readActiveCustodyHoldsForFile(database, fileId)).toEqual([]);
    const placed = await placeCustodyHold(database, packetId, { kind: "legal" }, options);
    await commit(database, placed.effect);
    expect(await readActiveCustodyHoldsForFile(database, fileId)).toHaveLength(1);

    const released = await releaseCustodyHold(database, placed.holdId, options);
    await commit(database, released.effect);
    expect(await readActiveCustodyHoldsForFile(database, fileId)).toEqual([]);
  });
});

describe("items", () => {
  it("takes its intrinsic-value default from its type and lets a human override it", async () => {
    const { database, packetId } = await scaffold();
    const willType = "custodyItemType_originalWill000000000";
    const fromType = await addCustodyItem(
      database,
      packetId,
      { description: "Original will of Jane Smith", itemTypeId: willType as never },
      options,
    );
    await commit(database, fromType.effect);

    const overridden = await addCustodyItem(
      database,
      packetId,
      {
        description: "Photocopy kept with the originals",
        itemTypeId: willType as never,
        intrinsicValue: false,
      },
      options,
    );
    await commit(database, overridden.effect);

    const items = await readCustodyItems(database, packetId);
    expect(items.map((item) => item.intrinsic_value)).toEqual([1, 0]);
    // Ordinals are packet-relative, so an item's number means something only inside its packet.
    expect(items.map((item) => item.ordinal)).toEqual([1, 2]);
  });

  it("appends an itemized movement for every item added", async () => {
    const { database, packetId } = await scaffold();
    const added = await addCustodyItem(
      database,
      packetId,
      { description: "Share certificate, 200 ordinary, Acme Holdings" },
      options,
    );
    await commit(database, added.effect);
    const kinds = (await readCustodyMovements(database, packetId, 10)).map(
      (movement) => movement.kind,
    );
    expect(kinds).toContain("itemized");
  });

  // A packet with no items yet is a real state every firm passes through; refusing it would mean
  // the register loses to a sticky note.
  it("accepts a packet that holds no items", async () => {
    const { database, packetId } = await scaffold();
    const items = await readCustodyItems(database, packetId);
    expect(items).toEqual([]);
  });

  it("stores a declared value as minor units plus a currency", async () => {
    const { database, packetId } = await scaffold();
    const added = await addCustodyItem(
      database,
      packetId,
      {
        description: "Ring, gold with sapphire",
        declaredValue: { amountMinor: 400_000, currency: "USD" },
      },
      options,
    );
    await commit(database, added.effect);
    const items = await readCustodyItems(database, packetId);
    expect(items[0]).toMatchObject({
      declared_value_amount_minor: 400_000,
      declared_value_currency: "USD",
    });
  });
});
