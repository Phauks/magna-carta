import type { BatchDatabase } from "@magna-carta/data-access/effect-batch";
import type { CustodyLocationId } from "@magna-carta/identifiers/types";
import { describe, expect, it } from "vitest";
import { addCustodyItem } from "../src/item-service.ts";
import { createCustodyLocation } from "../src/location-service.ts";
import { recordCustodyMovement } from "../src/movement-service.ts";
import { readCustodyMovements } from "../src/movement-statements.ts";
import { createCustodyPacket } from "../src/packet-service.ts";
import { readCustodyItem, readCustodyPacket } from "../src/packet-statements.ts";
import { readOverdueCustodyCheckouts, readOverdueCustodyCheckoutsPage } from "../src/queries.ts";
import type { CustodyMovementKind, CustodyPacketStatus } from "../src/types.ts";
import {
  ACTOR,
  AUTHORIZED_RELEASE,
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
  const safe = await node(database, "Main safe", "safe");
  const offsite = await node(database, "Offsite vault", "offsite");
  const created = await createCustodyPacket(
    database,
    {
      name: "Smith family deeds",
      owners: [{ entityId: SMITH }],
      currentLocationId: safe,
      matterId: MATTER,
    },
    { ...options, responsibleMemberId: ACTOR },
  );
  return { database, raw, safe, offsite, packetId: created.packetId };
}

async function node(
  database: BatchDatabase,
  name: string,
  kind: Parameters<typeof createCustodyLocation>[1]["kind"],
): Promise<CustodyLocationId> {
  const { locationId, effect } = await createCustodyLocation(database, { name, kind }, options);
  await commit(database, effect);
  return locationId;
}

describe("the movement ledger is the one write path for every state change", () => {
  // The status effect of every kind, asserted as a table rather than one test per kind, so a kind
  // added to the enum without a status rule is visible as a missing row here.
  const packetTransitions: ReadonlyArray<
    readonly [CustodyMovementKind, CustodyPacketStatus, boolean]
  > = [
    ["moved", "held", true],
    ["checked_out", "out", false],
    ["released", "released", false],
    ["destroyed", "destroyed", false],
    ["lost", "lost", false],
  ];

  for (const [kind, expectedStatus, needsDestination] of packetTransitions) {
    it(`a ${kind} movement leaves the packet ${expectedStatus}`, async () => {
      const { database, offsite, packetId } = await scaffold();
      await recordCustodyMovement(
        database,
        packetId,
        {
          kind,
          ...(needsDestination ? { toLocationId: offsite } : {}),
          ...(kind === "checked_out"
            ? { borrower: { kind: "member" as const, userId: ACTOR }, dueBackOn: "2026-08-11" }
            : {}),
          // A release carries the gate's capture; every other kind in the table carries none. The
          // status effect is the subject here, so the capture is supplied rather than asserted.
          ...(kind === "released"
            ? {
                borrower: AUTHORIZED_RELEASE.borrower,
                releaseAuthorization: AUTHORIZED_RELEASE.releaseAuthorization,
              }
            : {}),
        },
        options,
      );
      const packet = await readCustodyPacket(database, packetId);
      expect(packet?.status).toBe(expectedStatus);
    });
  }

  // A check-out, release, destruction, or loss takes the packet out of the tree: recording a shelf
  // it is not on would falsify the occupancy count the register reports.
  it("clears the location on a check-out and restores it on the return", async () => {
    const { database, safe, packetId } = await scaffold();
    await recordCustodyMovement(
      database,
      packetId,
      {
        kind: "checked_out",
        borrower: { kind: "external", name: "M. Alvarez (courier)" },
        dueBackOn: "2026-08-11",
      },
      options,
    );
    expect(await readCustodyPacket(database, packetId)).toMatchObject({
      status: "out",
      current_location_id: null,
    });

    await recordCustodyMovement(
      database,
      packetId,
      { kind: "returned", toLocationId: safe },
      options,
    );
    expect(await readCustodyPacket(database, packetId)).toMatchObject({
      status: "held",
      current_location_id: safe,
    });
  });

  it("refuses a second check-out while the packet is already out", async () => {
    const { database, packetId } = await scaffold();
    await recordCustodyMovement(
      database,
      packetId,
      { kind: "checked_out", borrower: { kind: "member", userId: ACTOR } },
      options,
    );
    await expect(
      recordCustodyMovement(
        database,
        packetId,
        { kind: "checked_out", borrower: { kind: "member", userId: ACTOR } },
        options,
      ),
    ).rejects.toMatchObject({ code: "custody-invalid-movement" });
  });

  it("refuses an ordinary movement on a released packet but accepts a correction", async () => {
    const { database, offsite, packetId } = await scaffold();
    const released = await recordCustodyMovement(database, packetId, AUTHORIZED_RELEASE, options);
    await expect(
      recordCustodyMovement(database, packetId, { kind: "moved", toLocationId: offsite }, options),
    ).rejects.toMatchObject({ code: "custody-packet-closed" });

    const correction = await recordCustodyMovement(
      database,
      packetId,
      {
        kind: "correction",
        correctsMovementId: released.movementId,
        reason: "released to the wrong family member; the original is back in the safe",
      },
      options,
    );
    expect(correction.movementId).toBeDefined();
  });

  it("refuses a correction that names no corrected movement", async () => {
    const { database, packetId } = await scaffold();
    await expect(
      recordCustodyMovement(database, packetId, { kind: "correction" }, options),
    ).rejects.toMatchObject({ code: "custody-invalid-movement" });
  });

  it("refuses a borrower kind with no borrower named", async () => {
    const { database, packetId } = await scaffold();
    await expect(
      recordCustodyMovement(
        database,
        packetId,
        { kind: "checked_out", borrower: { kind: "external", name: "  " } },
        options,
      ),
    ).rejects.toMatchObject({ code: "custody-invalid-movement" });
  });

  // A found packet reopens a loss without falsifying the earlier entry — property does turn up.
  it("accepts a found movement on a lost packet", async () => {
    const { database, safe, packetId } = await scaffold();
    await recordCustodyMovement(
      database,
      packetId,
      { kind: "lost", reason: "not in box 4" },
      options,
    );
    await recordCustodyMovement(database, packetId, { kind: "found", toLocationId: safe }, options);
    expect(await readCustodyPacket(database, packetId)).toMatchObject({
      status: "held",
      current_location_id: safe,
    });
  });

  // A single item can be withdrawn and released to its owner while the envelope stays in the safe.
  it("moves an item's status without touching the packet's", async () => {
    const { database, packetId } = await scaffold();
    const { itemId, effect } = await addCustodyItem(
      database,
      packetId,
      { description: "Original will of Jane Smith dated 14 March 2019" },
      options,
    );
    await commit(database, effect);

    await recordCustodyMovement(database, packetId, { kind: "withdrawn", itemId }, options);
    expect(await readCustodyItem(database, itemId)).toMatchObject({ status: "out" });
    expect(await readCustodyPacket(database, packetId)).toMatchObject({ status: "held" });
  });

  // A Friday collection typed in on Monday is the ordinary case. The register reports on
  // occurred_at; recorded_at proves when the assertion was made, and the gap stays visible.
  /*
   * ONE ITEM'S CHAIN OF CUSTODY.
   *
   * The scope is the item's own rows PLUS the packet-wide ones, because an item inside a packet
   * goes wherever the packet goes. Two failures are pinned here rather than left to the route: a
   * filter narrowed to `item_id = ?` would answer a decade of moves with "itemized" and present
   * that as a chain of custody, and a filter that merely dropped nothing would show a sibling
   * item's entries against this one.
   *
   * ORDER IS NOT ASSERTED AGAINST INSERTION, and that is the fixture rather than a shrug: this
   * suite's clock is fixed, so every row here shares an `occurred_at` and the whole ordering falls
   * to the `id DESC` tiebreak. Asserting a chronology the fixture does not have would pin the
   * identifier generator instead of the query. What IS asserted is the set of rows, and — in the
   * paged walk — that paging reproduces the unpaged answer exactly, which is the property paging
   * has to have and the one a mis-numbered binding breaks.
   */
  it("reads one item's history as its own rows plus the packet's, and never a sibling's", async () => {
    const { database, offsite, packetId } = await scaffold();
    const will = await addCustodyItem(
      database,
      packetId,
      { description: "Original will" },
      options,
    );
    await commit(database, will.effect);
    const certificate = await addCustodyItem(
      database,
      packetId,
      { description: "Share certificate" },
      options,
    );
    await commit(database, certificate.effect);
    await recordCustodyMovement(
      database,
      packetId,
      { kind: "moved", toLocationId: offsite },
      options,
    );

    const whole = await readCustodyMovements(database, packetId, 10);
    expect(whole).toHaveLength(4);

    const forWill = await readCustodyMovements(database, packetId, 10, undefined, will.itemId);
    // The move and the logging are the packet's, and are the will's history too; the will's own
    // itemized row joins them. The certificate's is the row a filter that dropped nothing keeps.
    expect(forWill.map((movement) => movement.kind).toSorted()).toEqual([
      "itemized",
      "logged",
      "moved",
    ]);
    expect(forWill.map((movement) => movement.item_id).filter((id) => id !== null)).toEqual([
      will.itemId,
    ]);
    expect(forWill.some((movement) => movement.item_id === certificate.itemId)).toBe(false);
  });

  it("pages an item's history without the cursor and the item filter treading on each other", async () => {
    const { database, offsite, safe, packetId } = await scaffold();
    const will = await addCustodyItem(
      database,
      packetId,
      { description: "Original will" },
      options,
    );
    await commit(database, will.effect);
    await recordCustodyMovement(
      database,
      packetId,
      { kind: "moved", toLocationId: offsite },
      options,
    );
    await recordCustodyMovement(database, packetId, { kind: "moved", toLocationId: safe }, options);

    const unpaged = await readCustodyMovements(database, packetId, 10, undefined, will.itemId);
    expect(unpaged).toHaveLength(4);

    const walked: string[] = [];
    let cursor: { occurredAt: string; id: string } | undefined;
    // A page size of one, so every step of the walk exercises the cursor rather than only the last.
    // Every row shares an occurred_at here, so the walk is carried entirely by the id half of the
    // keyset — the part a wrongly numbered binding would silently feed the limit into.
    for (let step = 0; step < 8; step += 1) {
      const page = await readCustodyMovements(database, packetId, 1, cursor, will.itemId);
      const row = page[0];
      if (row === undefined) break;
      walked.push(row.id);
      cursor = { occurredAt: row.occurred_at, id: row.id };
    }
    // Paging reproduces the unpaged answer exactly: the same rows, in the same order, none twice.
    expect(walked).toEqual(unpaged.map((movement) => movement.id));
    expect(new Set(walked).size).toBe(walked.length);
  });

  it("keeps occurred_at and recorded_at apart so back-dating stays visible", async () => {
    const { database, offsite, packetId } = await scaffold();
    const moved = await recordCustodyMovement(
      database,
      packetId,
      { kind: "moved", toLocationId: offsite, occurredAt: "2026-08-01T09:00:00.000Z" },
      options,
    );
    const history = await readCustodyMovements(database, packetId, 10);
    expect(history.find((movement) => movement.id === moved.movementId)).toMatchObject({
      occurred_at: "2026-08-01T09:00:00.000Z",
      recorded_at: "2026-08-04T12:00:00.000Z",
    });
    // The history sorts on occurred_at, so a back-dated row lands where the event happened rather
    // than where it was typed — which is the whole point of keeping the two columns apart.
    expect(history.map((movement) => movement.id).at(-1)).toBe(moved.movementId);
  });

  // A retried request must not produce two ledger rows — the whole reason the movement route
  // requires an Idempotency-Key.
  it("produces exactly one row for a retried movement", async () => {
    const { database, offsite, packetId } = await scaffold();
    const idempotency = { key: "movement-retry-key", fingerprint: "fingerprint-1" };
    const first = await recordCustodyMovement(
      database,
      packetId,
      { kind: "moved", toLocationId: offsite },
      { ...options, idempotency },
    );
    const second = await recordCustodyMovement(
      database,
      packetId,
      { kind: "moved", toLocationId: offsite },
      { ...options, idempotency },
    );
    expect(second.movementId).toBe(first.movementId);
    expect(second.replayed).toBe(true);
    const movements = await readCustodyMovements(database, packetId, 20);
    expect(movements.filter((movement) => movement.kind === "moved")).toHaveLength(1);
  });

  it("reads a packet's history newest first, keyset-paginated", async () => {
    const { database, safe, offsite, packetId } = await scaffold();
    await recordCustodyMovement(
      database,
      packetId,
      { kind: "moved", toLocationId: offsite, occurredAt: "2026-08-05T00:00:00.000Z" },
      options,
    );
    await recordCustodyMovement(
      database,
      packetId,
      { kind: "moved", toLocationId: safe, occurredAt: "2026-08-06T00:00:00.000Z" },
      options,
    );
    const firstPage = await readCustodyMovements(database, packetId, 2);
    expect(firstPage.map((movement) => movement.occurred_at)).toEqual([
      "2026-08-06T00:00:00.000Z",
      "2026-08-05T00:00:00.000Z",
    ]);
    const last = firstPage.at(-1);
    const secondPage = await readCustodyMovements(database, packetId, 2, {
      occurredAt: last?.occurred_at ?? "",
      id: last?.id ?? "",
    });
    expect(secondPage.map((movement) => movement.kind)).toEqual(["logged"]);
  });
});

describe("the overdue check-out read", () => {
  it("surfaces a packet past its due-back date and drops it once returned", async () => {
    const { database, safe, packetId } = await scaffold();
    await recordCustodyMovement(
      database,
      packetId,
      {
        kind: "checked_out",
        borrower: { kind: "member", userId: ACTOR },
        dueBackOn: "2026-08-01",
        occurredAt: "2026-07-28T09:00:00.000Z",
      },
      options,
    );
    const overdue = await readOverdueCustodyCheckouts(database, "2026-08-11");
    expect(overdue).toHaveLength(1);
    expect(overdue[0]).toMatchObject({ packetId, dueBackOn: "2026-08-01", daysOverdue: 10 });

    await recordCustodyMovement(
      database,
      packetId,
      { kind: "returned", toLocationId: safe, occurredAt: "2026-08-09T09:00:00.000Z" },
      options,
    );
    expect(await readOverdueCustodyCheckouts(database, "2026-08-11")).toEqual([]);
  });

  it("pages the sweep most-overdue first, and the walk reaches every one of them", async () => {
    const { database, safe } = await scaffold();
    const due = ["2026-08-01", "2026-08-02", "2026-08-03", "2026-08-04", "2026-08-05"];
    for (const dueBackOn of due) {
      const created = await createCustodyPacket(
        database,
        {
          name: `Out since ${dueBackOn}`,
          owners: [{ entityId: SMITH }],
          currentLocationId: safe,
          matterId: MATTER,
        },
        { ...options, responsibleMemberId: ACTOR },
      );
      await recordCustodyMovement(
        database,
        created.packetId,
        {
          kind: "checked_out",
          borrower: { kind: "member", userId: ACTOR },
          dueBackOn,
          occurredAt: "2026-07-28T09:00:00.000Z",
        },
        options,
      );
    }

    const seen: string[] = [];
    let cursor: string | undefined;
    // Bounded, so a cursor that fails to advance fails the test instead of spinning in it.
    for (let page = 0; page < 5; page += 1) {
      const result = await readOverdueCustodyCheckoutsPage(database, "2026-08-11", {
        cursor,
        pageSize: 2,
      });
      seen.push(...result.data.map((row) => row.dueBackOn));
      if (result.nextCursor === null) break;
      cursor = result.nextCursor;
    }
    // Ascending: the page of the MOST overdue is the answer, and paging walks toward the merely late.
    expect(seen).toEqual(due);
  });
});
