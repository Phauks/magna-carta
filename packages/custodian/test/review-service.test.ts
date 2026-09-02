import type { BatchDatabase } from "@magna-carta/data-access/effect-batch";
import type { CustodyLocationId } from "@magna-carta/identifiers/types";
import { describe, expect, it } from "vitest";
import { addCustodyItem, updateCustodyItem } from "../src/item-service.ts";
import { createCustodyLocation } from "../src/location-service.ts";
import { readCustodyMovements } from "../src/movement-statements.ts";
import { createCustodyPacket, updateCustodyPacket } from "../src/packet-service.ts";
import { readCustodyItem, readCustodyPacket } from "../src/packet-statements.ts";
import { addCalendarMonths, completeCustodyReview, nextReviewDate } from "../src/review-service.ts";
import { readCustodyReviewsDue } from "../src/review-statements.ts";
import {
  ACTOR,
  MATTER,
  commit,
  migratedDatabase,
  options,
  seedMatter,
  seedMember,
} from "./support.ts";

const SMITH = "directoryPerson_smith0000000000000";

async function scaffold() {
  const { database, raw } = migratedDatabase();
  seedMember(raw);
  seedMatter(raw);
  const { locationId, effect } = await createCustodyLocation(
    database,
    { name: "Main safe", kind: "safe" },
    options,
  );
  await commit(database, effect);
  return { database, raw, safe: locationId };
}

async function logPacket(database: BatchDatabase, safe: CustodyLocationId) {
  return createCustodyPacket(
    database,
    {
      name: "Smith family deeds",
      owners: [{ entityId: SMITH }],
      currentLocationId: safe,
      matterId: MATTER,
    },
    { ...options, responsibleMemberId: ACTOR },
  );
}

describe("calendar-month arithmetic", () => {
  it("clamps at the end of the month rather than rolling into the next one", () => {
    // 31 January plus one month is 28 February, not 3 March. A Date round-trip would overflow and
    // move an annual review off its anniversary for every date after the 28th.
    expect(addCalendarMonths("2026-01-31", 1)).toBe("2026-02-28");
    expect(addCalendarMonths("2024-01-31", 1)).toBe("2024-02-29");
    expect(addCalendarMonths("2026-08-04", 12)).toBe("2027-08-04");
    expect(addCalendarMonths("2026-11-30", 14)).toBe("2028-01-30");
  });
});

describe("the next review date", () => {
  it("anchors on the schedule, so a late review does not drift the cycle", () => {
    // Reviewed eight months late on a five-year cycle: the next one is still on the anniversary.
    expect(nextReviewDate("2026-01-01", "2026-09-01", 60)).toBe("2031-01-01");
  });

  it("takes whole intervals until it lands past the review, so the answer is never already overdue", () => {
    expect(nextReviewDate("2000-03-15", "2026-08-04", 12)).toBe("2027-03-15");
  });

  it("is null with no interval — a one-off review is done, not rescheduled", () => {
    expect(nextReviewDate("2026-01-01", "2026-01-02", null)).toBeNull();
  });
});

describe("completing a review", () => {
  it("appends a reviewed movement and rolls the packet's date forward", async () => {
    const { database, safe } = await scaffold();
    const packet = await logPacket(database, safe);
    const { effect } = await updateCustodyPacket(
      database,
      packet.packetId,
      { reviewOn: "2026-08-01", reviewIntervalMonths: 60 },
      options,
    );
    await commit(database, effect);

    const completed = await completeCustodyReview(database, packet.packetId, {}, options);
    expect(completed.nextReviewOn).toBe("2031-08-01");

    const row = await readCustodyPacket(database, packet.packetId);
    expect(row?.review_on).toBe("2031-08-01");
    // The ledger is the only record this subsystem keeps that anything happened, so a review that
    // left no row would be a review nobody can prove.
    const movements = await readCustodyMovements(database, packet.packetId, 10);
    expect(movements.map((movement) => movement.kind)).toContain("reviewed");
  });

  it("clears the schedule when the firm names no next date and there is no interval", async () => {
    const { database, safe } = await scaffold();
    const packet = await logPacket(database, safe);
    const { effect } = await updateCustodyPacket(
      database,
      packet.packetId,
      { reviewOn: "2026-08-01" },
      options,
    );
    await commit(database, effect);

    const completed = await completeCustodyReview(database, packet.packetId, {}, options);
    expect(completed.nextReviewOn).toBeNull();
    expect((await readCustodyPacket(database, packet.packetId))?.review_on).toBeNull();
  });

  it("reviews one item inside a packet without touching the packet's own schedule", async () => {
    const { database, safe } = await scaffold();
    const packet = await logPacket(database, safe);
    const added = await addCustodyItem(
      database,
      packet.packetId,
      { description: "Passport, J Smith" },
      options,
    );
    await commit(database, added.effect);
    const patched = await updateCustodyItem(
      database,
      added.itemId,
      { reviewOn: "2026-08-01", reviewIntervalMonths: 12 },
      options,
    );
    await commit(database, patched.effect);
    const packetPatch = await updateCustodyPacket(
      database,
      packet.packetId,
      { reviewOn: "2027-01-01" },
      options,
    );
    await commit(database, packetPatch.effect);

    const completed = await completeCustodyReview(
      database,
      packet.packetId,
      { itemId: added.itemId },
      options,
    );
    expect(completed.nextReviewOn).toBe("2027-08-01");
    expect((await readCustodyItem(database, added.itemId))?.review_on).toBe("2027-08-01");
    expect((await readCustodyPacket(database, packet.packetId))?.review_on).toBe("2027-01-01");
  });

  it("refuses a completed review against something with no review date", async () => {
    const { database, safe } = await scaffold();
    const packet = await logPacket(database, safe);
    await expect(completeCustodyReview(database, packet.packetId, {}, options)).rejects.toThrow(
      /nothing is scheduled for review/i,
    );
  });

  it("refuses a review interval the schema would refuse", async () => {
    const { database, safe } = await scaffold();
    const packet = await logPacket(database, safe);
    // Zero is refused rather than read as "no interval": reading it as null would let a typo
    // silently disable a recurring review.
    await expect(
      updateCustodyPacket(database, packet.packetId, { reviewIntervalMonths: 0 }, options),
    ).rejects.toThrow(/whole number of months/i);
  });
});

describe("the reviews-due read", () => {
  it("returns packets and items together, oldest first, and never one the firm no longer holds", async () => {
    const { database, safe } = await scaffold();
    const first = await logPacket(database, safe);
    const second = await logPacket(database, safe);
    for (const [packetId, reviewOn] of [
      [first.packetId, "2026-01-01"],
      [second.packetId, "2025-06-01"],
    ] as const) {
      const { effect } = await updateCustodyPacket(database, packetId, { reviewOn }, options);
      await commit(database, effect);
    }
    const added = await addCustodyItem(
      database,
      first.packetId,
      { description: "Original will" },
      options,
    );
    await commit(database, added.effect);
    const itemPatch = await updateCustodyItem(
      database,
      added.itemId,
      { reviewOn: "2025-12-01" },
      options,
    );
    await commit(database, itemPatch.effect);

    const due = await readCustodyReviewsDue(database, "2026-08-04", 50);
    expect(due.map((row) => row.review_on)).toEqual(["2025-06-01", "2025-12-01", "2026-01-01"]);
    expect(due[1]?.item_id).toBe(added.itemId);

    // A date in the future is not due.
    expect(await readCustodyReviewsDue(database, "2025-01-01", 50)).toEqual([]);
  });
});
