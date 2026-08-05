import type { BatchDatabase } from "@magna-carta/data-access/effect-batch";
import type { CustodyLocationId } from "@magna-carta/identifiers/types";
import { describe, expect, it } from "vitest";
import { createCustodyLocation } from "../src/location-service.ts";
import { recordCustodyMovement } from "../src/movement-service.ts";
import { createCustodyPacket } from "../src/packet-service.ts";
import { reconcileCustodyStocktake } from "../src/stocktake-reconciliation.ts";
import {
  closeCustodyStocktake,
  openCustodyStocktake,
  recordCustodyStocktakeSightings,
} from "../src/stocktake-service.ts";
import {
  ACTOR,
  AUTHORIZED_RELEASE,
  commit,
  migratedDatabase,
  options,
  seedMember,
} from "./support.ts";

const SMITH = "directoryPerson_smith0000000000000";

// The reconciliation is the report a firm actually acts on, so each of its four disagreements is
// asserted against a register arranged to produce exactly that one — and the proposals are asserted
// as proposals, with the ledger checked afterwards to prove nothing was written.

async function scaffold() {
  const { database, raw } = migratedDatabase();
  seedMember(raw);
  const office = await createCustodyLocation(
    database,
    { name: "Reno office", kind: "office" },
    options,
  );
  await commit(database, office.effect);
  const safe = await createCustodyLocation(
    database,
    { name: "Main safe", kind: "safe", parentLocationId: office.locationId },
    options,
  );
  await commit(database, safe.effect);
  const shelf = await createCustodyLocation(
    database,
    { name: "Shelf 1", kind: "shelf", parentLocationId: safe.locationId },
    options,
  );
  await commit(database, shelf.effect);
  const vault = await createCustodyLocation(
    database,
    { name: "Bank vault", kind: "bank" },
    options,
  );
  await commit(database, vault.effect);
  return {
    database,
    raw,
    office: office.locationId,
    safe: safe.locationId,
    shelf: shelf.locationId,
    vault: vault.locationId,
  };
}

async function logPacket(database: BatchDatabase, locationId: CustodyLocationId, name: string) {
  return createCustodyPacket(
    database,
    { name, owners: [{ entityId: SMITH }], currentLocationId: locationId },
    { ...options, responsibleMemberId: ACTOR },
  );
}

async function openCount(database: BatchDatabase, scopeLocationId?: CustodyLocationId) {
  const opened = await openCustodyStocktake(
    database,
    { name: "March count", scopeLocationId },
    options,
  );
  await commit(database, opened.effect);
  return opened.stocktakeId;
}

// Every movement kind in the ledger, counted. What matters to these tests is that the stocktake
// appended NOTHING, so the tally is compared rather than an order the ids decide at random.
async function ledgerKindCounts(database: BatchDatabase): Promise<Record<string, number>> {
  const { results } = await database
    .prepare(`SELECT kind, COUNT(*) AS total FROM custody_movement GROUP BY kind`)
    .all<{ kind: string; total: number }>();
  return Object.fromEntries(results.map((row) => [row.kind, row.total]));
}

describe("the reconciliation names each way the shelf and the register disagree", () => {
  it("reports a packet expected and not seen as missing, and proposes nothing for it", async () => {
    const { database, safe } = await scaffold();
    await logPacket(database, safe, "Smith family deeds");
    const stocktakeId = await openCount(database);

    const report = await reconcileCustodyStocktake(database, stocktakeId);
    expect(report.missing).toHaveLength(1);
    expect(report.missing[0]).toMatchObject({
      outcome: "missing",
      expectedLocationId: safe,
      sightedLocationId: null,
      // Deliberately no proposal. The honest answer to an empty shelf is an investigation, not a
      // ledger entry closing the record on the exact failure that most needs one open.
      proposedMovementKind: null,
      proposedToLocationId: null,
    });
    expect(report.matchedCount).toBe(0);
  });

  it("distinguishes a packet nobody reached from one somebody looked for and did not find", async () => {
    const { database, safe } = await scaffold();
    const searched = await logPacket(database, safe, "Smith family deeds");
    await logPacket(database, safe, "Smith will envelope");
    const stocktakeId = await openCount(database);
    await recordCustodyStocktakeSightings(
      database,
      stocktakeId,
      [{ kind: "not_found", packetId: searched.packetId, locationId: safe }],
      options,
    );

    const report = await reconcileCustodyStocktake(database, stocktakeId);
    // Both are missing, but only one carries a person's assertion that they went and looked — which
    // is why `not_found` is recorded rather than inferred from an absent row.
    expect(report.missing).toHaveLength(2);
    const searchedLine = report.missing.find((line) => line.packetId === searched.packetId);
    expect(searchedLine?.observedByUserId).toBe(ACTOR);
    expect(
      report.missing.find((line) => line.packetId !== searched.packetId)?.observedByUserId,
    ).toBeNull();
  });

  it("reports a packet seen on the wrong shelf as misplaced, and proposes a move to where it was seen", async () => {
    const { database, safe, shelf } = await scaffold();
    const packet = await logPacket(database, shelf, "Smith will envelope");
    const stocktakeId = await openCount(database);
    await recordCustodyStocktakeSightings(
      database,
      stocktakeId,
      [{ kind: "sighted", packetId: packet.packetId, locationId: safe }],
      options,
    );

    const report = await reconcileCustodyStocktake(database, stocktakeId);
    expect(report.misplaced).toHaveLength(1);
    expect(report.misplaced[0]).toMatchObject({
      outcome: "misplaced",
      packetId: packet.packetId,
      expectedLocationId: shelf,
      sightedLocationId: safe,
      // A proposal only ever moves property to where somebody says they actually saw it: the
      // register's own answer is the one the count just contradicted.
      proposedMovementKind: "moved",
      proposedToLocationId: safe,
    });
    // And the register has not moved. The proposal is a line on a report.
    const { results } = await database
      .prepare(`SELECT current_location_id FROM custody_packet WHERE id = ?1`)
      .bind(packet.packetId)
      .all<{ current_location_id: string }>();
    expect(results[0]?.current_location_id).toBe(shelf);
    expect(await ledgerKindCounts(database)).toEqual({ logged: 1 });
  });

  it("reports a checked-out packet found on the shelf as unexpected", async () => {
    const { database, safe } = await scaffold();
    const packet = await logPacket(database, safe, "Smith family deeds");
    await recordCustodyMovement(
      database,
      packet.packetId,
      { kind: "checked_out", borrower: { kind: "member", userId: ACTOR } },
      options,
    );
    const stocktakeId = await openCount(database);
    await recordCustodyStocktakeSightings(
      database,
      stocktakeId,
      [{ kind: "sighted", packetId: packet.packetId, locationId: safe }],
      options,
    );

    const report = await reconcileCustodyStocktake(database, stocktakeId);
    // The register says it is out, so the shelf should have been empty. A checked-out packet is not
    // "expected" anywhere, which is why it is unexpected rather than missing.
    expect(report.missing).toEqual([]);
    expect(report.unexpected).toHaveLength(1);
    expect(report.unexpected[0]).toMatchObject({
      outcome: "unexpected",
      packetStatus: "out",
      sightedLocationId: safe,
      proposedMovementKind: "found",
      proposedToLocationId: safe,
    });
    // Still out. Seeing it does not check it back in.
    const { results } = await database
      .prepare(`SELECT status FROM custody_packet WHERE id = ?1`)
      .bind(packet.packetId)
      .all<{ status: string }>();
    expect(results[0]?.status).toBe("out");
    expect(await ledgerKindCounts(database)).toEqual({ logged: 1, checked_out: 1 });
  });

  it("reports an object with no register row as unregistered, carrying the observer's description", async () => {
    const { database, shelf } = await scaffold();
    const stocktakeId = await openCount(database);
    await recordCustodyStocktakeSightings(
      database,
      stocktakeId,
      [{ kind: "unregistered", locationId: shelf, description: "Sealed envelope, no label" }],
      options,
    );

    const report = await reconcileCustodyStocktake(database, stocktakeId);
    expect(report.unregistered).toHaveLength(1);
    expect(report.unregistered[0]).toMatchObject({
      outcome: "unregistered",
      packetId: null,
      custodyNumber: null,
      description: "Sealed envelope, no label",
      // Nothing is proposed. What to do with an unidentified object in a safe is a decision about a
      // client's property, and the register has no business suggesting one.
      proposedMovementKind: null,
    });
  });

  it("counts a packet seen exactly where the register says it is as matched", async () => {
    const { database, safe } = await scaffold();
    const packet = await logPacket(database, safe, "Smith family deeds");
    const stocktakeId = await openCount(database);
    await recordCustodyStocktakeSightings(
      database,
      stocktakeId,
      [{ kind: "sighted", packetId: packet.packetId, locationId: safe }],
      options,
    );

    const report = await reconcileCustodyStocktake(database, stocktakeId);
    expect(report).toMatchObject({ matchedCount: 1 });
    expect([report.missing, report.misplaced, report.unexpected, report.unregistered]).toEqual([
      [],
      [],
      [],
      [],
    ]);
  });
});

describe("scope and later observations", () => {
  it("expects only what is inside the counted branch, and the branch includes everything beneath it", async () => {
    const { database, safe, shelf, vault } = await scaffold();
    const inShelf = await logPacket(database, shelf, "Smith will envelope");
    await logPacket(database, vault, "Vault deeds");
    const stocktakeId = await openCount(database, safe);

    const report = await reconcileCustodyStocktake(database, stocktakeId);
    // The shelf hangs off the safe, so it is in scope; the bank vault is a separate root and is not.
    expect(report.missing).toHaveLength(1);
    expect(report.missing[0]?.packetId).toBe(inShelf.packetId);
  });

  it("does not call a packet unexpected when a counter walked past the scope and found it where it belongs", async () => {
    const { database, safe, vault } = await scaffold();
    const outsideScope = await logPacket(database, vault, "Vault deeds");
    const stocktakeId = await openCount(database, safe);
    await recordCustodyStocktakeSightings(
      database,
      stocktakeId,
      [{ kind: "sighted", packetId: outsideScope.packetId, locationId: vault }],
      options,
    );

    const report = await reconcileCustodyStocktake(database, stocktakeId);
    // The register and the shelf agree; the only thing unusual is that somebody counted one cabinet
    // further than the scope named. Reporting that as a discrepancy would train firms to ignore the
    // report.
    expect(report.unexpected).toEqual([]);
    expect(report.matchedCount).toBe(1);
  });

  it("takes the last observation of a packet, so a self-correction supersedes without an edit", async () => {
    const { database, safe, shelf } = await scaffold();
    const packet = await logPacket(database, safe, "Smith family deeds");
    const stocktakeId = await openCount(database);
    await recordCustodyStocktakeSightings(
      database,
      stocktakeId,
      [
        {
          kind: "sighted",
          packetId: packet.packetId,
          locationId: shelf,
          observedAt: "2026-08-04T09:00:00.000Z",
        },
        {
          kind: "sighted",
          packetId: packet.packetId,
          locationId: safe,
          observedAt: "2026-08-04T11:00:00.000Z",
        },
      ],
      options,
    );

    const report = await reconcileCustodyStocktake(database, stocktakeId);
    // The sighting rows are append-only, so the earlier, wrong observation cannot be edited out —
    // both stay on the record, and the later look is the better evidence of where the packet is.
    expect(report.matchedCount).toBe(1);
    expect(report.misplaced).toEqual([]);
  });

  it("keeps a released packet out of the expected set entirely", async () => {
    const { database, safe } = await scaffold();
    const packet = await logPacket(database, safe, "Smith family deeds");
    await recordCustodyMovement(database, packet.packetId, AUTHORIZED_RELEASE, options);
    const stocktakeId = await openCount(database);

    const report = await reconcileCustodyStocktake(database, stocktakeId);
    // The firm no longer holds it. Reporting it as missing would mean a count of an empty safe
    // producing a page of alarms about property that left honestly and on the record.
    expect(report.missing).toEqual([]);
    expect(report.matchedCount).toBe(0);
  });
});

describe("frozen findings", () => {
  it("keeps the closed count's numbers even after the register is put right", async () => {
    const { database, safe, shelf } = await scaffold();
    const packet = await logPacket(database, shelf, "Smith will envelope");
    const stocktakeId = await openCount(database);
    await recordCustodyStocktakeSightings(
      database,
      stocktakeId,
      [{ kind: "sighted", packetId: packet.packetId, locationId: safe }],
      options,
    );
    const closed = await closeCustodyStocktake(database, stocktakeId, {}, options);
    await commit(database, closed.effect);

    // A person acts on the proposal: they record the move themselves, through the one movement write
    // path, which is the only way this register ever changes.
    await recordCustodyMovement(
      database,
      packet.packetId,
      { kind: "moved", toLocationId: safe },
      options,
    );

    const report = await reconcileCustodyStocktake(database, stocktakeId);
    // The lines now say the register agrees with the shelf, because it does. The frozen counts still
    // say what the count found, which is the number the firm reported.
    expect(report.misplaced).toEqual([]);
    expect(report.matchedCount).toBe(1);
    expect(report.frozenCounts).toMatchObject({ misplaced: 1, matched: 0 });
  });

  it("reports no frozen findings while a count is still running", async () => {
    const { database, safe } = await scaffold();
    await logPacket(database, safe, "Smith family deeds");
    const stocktakeId = await openCount(database);
    expect((await reconcileCustodyStocktake(database, stocktakeId)).frozenCounts).toBeNull();
  });
});
