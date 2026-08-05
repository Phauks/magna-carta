import type { BatchDatabase } from "@magna-carta/data-access/effect-batch";
import type { CustodyLocationId } from "@magna-carta/identifiers/types";
import { describe, expect, it } from "vitest";
import { placeCustodyHold } from "../src/hold-service.ts";
import { addCustodyItem } from "../src/item-service.ts";
import { createCustodyLocation } from "../src/location-service.ts";
import { recordCustodyMovement } from "../src/movement-service.ts";
import { createCustodyPacket, updateCustodyPacket } from "../src/packet-service.ts";
import { collectCustodyReminders } from "../src/reminders.ts";
import {
  readCustodyHoldingsByOwner,
  readCustodyLocationOccupancyReport,
  readCustodyPacketsUnderHold,
} from "../src/reports.ts";
import {
  ACTOR,
  AUTHORIZED_RELEASE,
  commit,
  migratedDatabase,
  options,
  seedMember,
} from "./support.ts";

const SMITH = "directoryPerson_smith0000000000000";
const JONES = "directoryOrganization_jones000000";

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
  return {
    database,
    raw,
    office: office.locationId,
    safe: safe.locationId,
    shelf: shelf.locationId,
  };
}

async function logPacket(
  database: BatchDatabase,
  locationId: CustodyLocationId,
  entityId: string,
  name = "Smith family deeds",
) {
  return createCustodyPacket(
    database,
    { name, owners: [{ entityId }], currentLocationId: locationId },
    { ...options, responsibleMemberId: ACTOR },
  );
}

describe("holdings per owner", () => {
  it("counts what the firm currently holds for each entity, and nothing it no longer holds", async () => {
    const { database, safe, shelf } = await scaffold();
    const first = await logPacket(database, safe, SMITH);
    const second = await logPacket(database, shelf, SMITH, "Smith will envelope");
    const third = await logPacket(database, safe, JONES, "Acme share certificates");
    const item = await addCustodyItem(
      database,
      first.packetId,
      { description: "Original will" },
      options,
    );
    await commit(database, item.effect);

    // Checked out is still held BY the firm's reckoning — it is out, not gone.
    await recordCustodyMovement(
      database,
      second.packetId,
      { kind: "checked_out", borrower: { kind: "member", userId: ACTOR }, dueBackOn: "2026-07-01" },
      options,
    );
    // Released is gone: the report answers "what do we hold", not "what did we ever hold".
    await recordCustodyMovement(database, third.packetId, AUTHORIZED_RELEASE, options);

    const report = await readCustodyHoldingsByOwner(database);
    const smith = report.find((row) => row.entityId === SMITH);
    expect(smith).toMatchObject({ packetsHeld: 1, packetsOut: 1, itemsDescribed: 1 });
    expect(report.find((row) => row.entityId === JONES)).toBeUndefined();
  });

  it("counts a packet under hold once, however many holds are on it", async () => {
    const { database, safe } = await scaffold();
    const packet = await logPacket(database, safe, SMITH);
    for (const kind of ["legal", "dispute"] as const) {
      const placed = await placeCustodyHold(database, packet.packetId, { kind }, options);
      await commit(database, placed.effect);
    }
    // And the packet itself is counted once too: the hold join is one-to-many, so a plain SUM would
    // report the firm holding twice as much for this person as it does.
    const report = await readCustodyHoldingsByOwner(database);
    expect(report.find((row) => row.entityId === SMITH)).toMatchObject({
      packetsHeld: 1,
      packetsUnderHold: 1,
    });
  });
});

describe("holdings per location", () => {
  it("reports direct and subtree occupancy, parents before children", async () => {
    const { database, office, safe, shelf } = await scaffold();
    await logPacket(database, safe, SMITH);
    await logPacket(database, shelf, SMITH, "Shelf packet one");
    await logPacket(database, shelf, JONES, "Shelf packet two");

    const report = await readCustodyLocationOccupancyReport(database);
    const byId = new Map(report.map((row) => [row.locationId, row]));
    expect(byId.get(office)).toMatchObject({ depth: 0, directOccupancy: 0, subtreeOccupancy: 3 });
    expect(byId.get(safe)).toMatchObject({ depth: 1, directOccupancy: 1, subtreeOccupancy: 3 });
    expect(byId.get(shelf)).toMatchObject({ depth: 2, directOccupancy: 2, subtreeOccupancy: 2 });
    // Parents before children — the order the tree renders in.
    expect(report.map((row) => row.locationId)).toEqual([office, safe, shelf]);
  });

  it("stops counting a packet that has left the tree", async () => {
    const { database, safe } = await scaffold();
    const packet = await logPacket(database, safe, SMITH);
    await recordCustodyMovement(
      database,
      packet.packetId,
      { kind: "checked_out", borrower: { kind: "external", name: "A courier" } },
      options,
    );
    // The shelf really is empty while the deed is at a completion meeting.
    const report = await readCustodyLocationOccupancyReport(database);
    expect(report.find((row) => row.locationId === safe)?.directOccupancy).toBe(0);
  });
});

describe("packets under hold", () => {
  it("lists every hold in force, oldest first, and drops a released one", async () => {
    const { database, safe } = await scaffold();
    const packet = await logPacket(database, safe, SMITH);
    const placed = await placeCustodyHold(
      database,
      packet.packetId,
      { kind: "legal", reason: "Estate dispute" },
      options,
    );
    await commit(database, placed.effect);

    const report = await readCustodyPacketsUnderHold(database);
    expect(report).toHaveLength(1);
    expect(report[0]).toMatchObject({ packetId: packet.packetId, kind: "legal" });
  });
});

describe("the reminder emission point", () => {
  it("returns review dates and overdue check-outs in one list, oldest first", async () => {
    const { database, safe } = await scaffold();
    const reviewable = await logPacket(database, safe, SMITH);
    const borrowed = await logPacket(database, safe, JONES, "Acme deeds");
    const patch = await updateCustodyPacket(
      database,
      reviewable.packetId,
      { reviewOn: "2026-05-01" },
      options,
    );
    await commit(database, patch.effect);
    await recordCustodyMovement(
      database,
      borrowed.packetId,
      { kind: "checked_out", borrower: { kind: "member", userId: ACTOR }, dueBackOn: "2026-07-20" },
      options,
    );

    const reminders = await collectCustodyReminders(database, "2026-08-04");
    expect(reminders.map((reminder) => reminder.reason)).toEqual([
      "review-due",
      "checkout-overdue",
    ]);
    expect(reminders[0]).toMatchObject({ dueOn: "2026-05-01", bucket: "over-90d" });
    expect(reminders[1]).toMatchObject({ dueOn: "2026-07-20", bucket: "8-30d" });
  });

  it("carries no owner, borrower, or description — only the object and why it surfaced", async () => {
    const { database, safe } = await scaffold();
    const packet = await logPacket(database, safe, SMITH);
    const patch = await updateCustodyPacket(
      database,
      packet.packetId,
      { reviewOn: "2026-05-01" },
      options,
    );
    await commit(database, patch.effect);

    const [reminder] = await collectCustodyReminders(database, "2026-08-04");
    expect(Object.keys(reminder ?? {}).toSorted()).toEqual([
      "bucket",
      "custodyNumber",
      "daysOverdue",
      "dueOn",
      "itemId",
      "packetId",
      "reason",
    ]);
  });
});
