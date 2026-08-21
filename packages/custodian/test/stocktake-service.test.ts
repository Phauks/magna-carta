import type { BatchDatabase } from "@magna-carta/data-access/effect-batch";
import type { CustodyLocationId } from "@magna-carta/identifiers/types";
import { describe, expect, it } from "vitest";
import { createCustodyLocation } from "../src/location-service.ts";
import { createCustodyPacket } from "../src/packet-service.ts";
import {
  closeCustodyStocktake,
  MAX_CUSTODY_SIGHTINGS_PER_BATCH,
  openCustodyStocktake,
  recordCustodyStocktakeSightings,
} from "../src/stocktake-service.ts";
import { reconcileCustodyStocktake } from "../src/stocktake-reconciliation.ts";
import {
  readCustodyStocktake,
  readCustodyStocktakes,
  readCustodyStocktakeSightings,
} from "../src/stocktake-statements.ts";
import { CustodyValidationError } from "../src/validation.ts";
import { ACTOR, commit, migratedDatabase, options, seedMember } from "./support.ts";

const SMITH = "directoryPerson_smith0000000000000";

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
  name = "Smith family deeds",
) {
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

describe("opening a stocktake", () => {
  it("opens a count over the whole register, and over one branch of the tree", async () => {
    const { database, safe } = await scaffold();
    const whole = await openCount(database);
    const scoped = await openCount(database, safe);

    const wholeRow = await readCustodyStocktake(database, whole);
    expect(wholeRow).toMatchObject({ status: "open", scope_location_id: null, closed_at: null });
    expect((await readCustodyStocktake(database, scoped))?.scope_location_id).toBe(safe);
    // Both open at once: a two-office firm counting two safes on the same Saturday is the ordinary
    // case, and every observation names the count it belongs to.
    const page = await readCustodyStocktakes(database, "open", 10);
    expect(page.rows).toHaveLength(2);
    expect(page.capped).toBe(false);
  });

  it("says so when the firm has counted more than the list returns", async () => {
    const { database, safe } = await scaffold();
    await openCount(database);
    await openCount(database, safe);

    const cut = await readCustodyStocktakes(database, "open", 1);
    expect(cut.rows).toHaveLength(1);
    // The list is capped rather than paged, so the flag is the only thing separating a short answer
    // from a complete one.
    expect(cut.capped).toBe(true);
  });

  it("refuses a count scoped to a location the register does not have", async () => {
    const { database } = await scaffold();
    await expect(
      openCustodyStocktake(
        database,
        { name: "March count", scopeLocationId: "custodyLocation_absent0000000000" as never },
        options,
      ),
    ).rejects.toThrow(CustodyValidationError);
  });
});

describe("recording what the counters saw", () => {
  it("records a batch atomically and freezes where the register expected each packet", async () => {
    const { database, safe, shelf } = await scaffold();
    const inSafe = await logPacket(database, safe);
    const onShelf = await logPacket(database, shelf, "Smith will envelope");
    const stocktakeId = await openCount(database);

    const recorded = await recordCustodyStocktakeSightings(
      database,
      stocktakeId,
      [
        { kind: "sighted", packetId: inSafe.packetId, locationId: safe },
        // Seen on the wrong shelf. The expected location is frozen from the register as it stood
        // when the observation was made, not joined at read time.
        { kind: "sighted", packetId: onShelf.packetId, locationId: safe },
      ],
      options,
    );
    expect(recorded.sightingIds).toHaveLength(2);

    const rows = (await readCustodyStocktakeSightings(database, stocktakeId, 100)).rows;
    expect(rows).toHaveLength(2);
    expect(rows.find((row) => row.packet_id === inSafe.packetId)?.expected_location_id).toBe(safe);
    expect(rows.find((row) => row.packet_id === onShelf.packetId)?.expected_location_id).toBe(
      shelf,
    );
    expect(rows.every((row) => row.observed_by_user_id === ACTOR)).toBe(true);
  });

  it("records an unregistered object with no packet handle at all", async () => {
    const { database, shelf } = await scaffold();
    const stocktakeId = await openCount(database);
    await recordCustodyStocktakeSightings(
      database,
      stocktakeId,
      [
        {
          kind: "unregistered",
          locationId: shelf,
          description: "Unlabelled brown envelope, sealed",
        },
      ],
      options,
    );
    const [row] = (await readCustodyStocktakeSightings(database, stocktakeId, 10)).rows;
    expect(row).toMatchObject({
      kind: "unregistered",
      packet_id: null,
      description: "Unlabelled brown envelope, sealed",
    });
  });

  it("refuses an unregistered observation that describes nothing", async () => {
    const { database, shelf } = await scaffold();
    const stocktakeId = await openCount(database);
    await expect(
      recordCustodyStocktakeSightings(
        database,
        stocktakeId,
        [{ kind: "unregistered", locationId: shelf }],
        options,
      ),
    ).rejects.toThrow(/describes what was found/);
  });

  it("refuses a sighting that names no location, and one naming a packet the register lacks", async () => {
    const { database, safe } = await scaffold();
    const packet = await logPacket(database, safe);
    const stocktakeId = await openCount(database);
    await expect(
      recordCustodyStocktakeSightings(
        database,
        stocktakeId,
        [{ kind: "sighted", packetId: packet.packetId }],
        options,
      ),
    ).rejects.toThrow(/names the packet that was seen and the location/);
    await expect(
      recordCustodyStocktakeSightings(
        database,
        stocktakeId,
        [
          {
            kind: "sighted",
            packetId: "custodyPacket_absent00000000000000" as never,
            locationId: safe,
          },
        ],
        options,
      ),
    ).rejects.toThrow(/no such custody packet/);
    // A refused batch writes nothing at all — every handle is resolved before the batch is composed.
    expect((await readCustodyStocktakeSightings(database, stocktakeId, 10)).rows).toEqual([]);
  });

  it("refuses a batch larger than one request should compose", async () => {
    const { database, safe } = await scaffold();
    const packet = await logPacket(database, safe);
    const stocktakeId = await openCount(database);
    const oversized = Array.from({ length: MAX_CUSTODY_SIGHTINGS_PER_BATCH + 1 }, () => ({
      kind: "sighted" as const,
      packetId: packet.packetId,
      locationId: safe,
    }));
    await expect(
      recordCustodyStocktakeSightings(database, stocktakeId, oversized, options),
    ).rejects.toThrow(/at most/);
  });

  it("refuses an observation against a count that has already closed", async () => {
    const { database, safe } = await scaffold();
    const packet = await logPacket(database, safe);
    const stocktakeId = await openCount(database);
    const closed = await closeCustodyStocktake(database, stocktakeId, {}, options);
    await commit(database, closed.effect);

    await expect(
      recordCustodyStocktakeSightings(
        database,
        stocktakeId,
        [{ kind: "sighted", packetId: packet.packetId, locationId: safe }],
        options,
      ),
    ).rejects.toThrow(/open a new count/);
  });
});

describe("closing a stocktake", () => {
  it("freezes what the count found and leaves the register untouched", async () => {
    const { database, safe, shelf } = await scaffold();
    const seen = await logPacket(database, safe);
    const notSeen = await logPacket(database, safe, "Smith will envelope");
    const stocktakeId = await openCount(database);
    await recordCustodyStocktakeSightings(
      database,
      stocktakeId,
      [
        { kind: "sighted", packetId: seen.packetId, locationId: safe },
        { kind: "unregistered", locationId: shelf, description: "Unlabelled envelope" },
      ],
      options,
    );

    const closed = await closeCustodyStocktake(database, stocktakeId, {}, options);
    await commit(database, closed.effect);
    expect(closed.counts).toEqual({
      matched: 1,
      missing: 1,
      misplaced: 0,
      unexpected: 0,
      unregistered: 1,
    });

    const row = await readCustodyStocktake(database, stocktakeId);
    expect(row).toMatchObject({ status: "closed", matched_count: 1, missing_count: 1 });
    expect(row?.closed_by_user_id).toBe(ACTOR);

    // The whole point: a count reports, it does not correct. Neither packet moved, neither changed
    // status, and no ledger row was appended by the count.
    const packets = await database
      .prepare(`SELECT id, status, current_location_id FROM custody_packet ORDER BY id`)
      .all<{ id: string; status: string; current_location_id: string | null }>();
    expect(packets.results.every((packet) => packet.status === "held")).toBe(true);
    expect(packets.results.every((packet) => packet.current_location_id === safe)).toBe(true);
    expect(notSeen.packetId).toBeDefined();

    const movements = await database
      .prepare(`SELECT kind FROM custody_movement ORDER BY id`)
      .all<{ kind: string }>();
    // Two `logged` rows from logging the packets, and nothing the stocktake wrote.
    expect(movements.results.map((movement) => movement.kind)).toEqual(["logged", "logged"]);
  });

  it("abandons a count without freezing findings", async () => {
    const { database, safe } = await scaffold();
    await logPacket(database, safe);
    const stocktakeId = await openCount(database);

    const closed = await closeCustodyStocktake(database, stocktakeId, { abandoned: true }, options);
    await commit(database, closed.effect);
    // A half-finished walk must not close as though it had counted everything: reporting the safe as
    // full of missing originals would be alarming and wrong.
    expect(closed.counts).toBeNull();
    expect(await readCustodyStocktake(database, stocktakeId)).toMatchObject({
      status: "abandoned",
      matched_count: null,
      missing_count: null,
    });
  });

  it("refuses a second close, and the first close's findings survive it", async () => {
    const { database, safe } = await scaffold();
    await logPacket(database, safe);
    const stocktakeId = await openCount(database);
    const first = await closeCustodyStocktake(database, stocktakeId, {}, options);
    await commit(database, first.effect);

    await expect(closeCustodyStocktake(database, stocktakeId, {}, options)).rejects.toThrow(
      /open a new count/,
    );
    expect(await readCustodyStocktake(database, stocktakeId)).toMatchObject({
      status: "closed",
      missing_count: 1,
    });
  });

  it("refuses to close a count the register does not have", async () => {
    const { database } = await scaffold();
    await expect(
      closeCustodyStocktake(database, "custodyStocktake_absent0000000000" as never, {}, options),
    ).rejects.toThrow(/no such custody stocktake/);
  });
});

// The reconciliation is bounded, so a register larger than the bound produces a PARTIAL answer. The
// only thing that makes a partial answer safe is that it says so: unmarked, it under-reports missing
// originals (a packet past the cut is never expected, so it is never reported missing) and a firm
// files the number believing it whole.
describe("a truncated reconciliation says so, and cannot be frozen as a finding", () => {
  it("reports truncation and the cap that produced it", async () => {
    const { database, safe } = await scaffold();
    await logPacket(database, safe, "Smith family deeds");
    await logPacket(database, safe, "Smith will envelope");
    const stocktakeId = await openCount(database);

    const whole = await reconcileCustodyStocktake(database, stocktakeId);
    expect(whole.truncated).toBe(false);
    expect(whole.missing).toHaveLength(2);

    const partial = await reconcileCustodyStocktake(database, stocktakeId, { rowLimit: 1 });
    expect(partial.truncated).toBe(true);
    expect(partial.rowLimit).toBe(1);
    // And the partial answer really is short — the second packet is past the cut and so is invisible
    // to the count rather than reported missing by it.
    expect(partial.missing).toHaveLength(1);
  });

  it("refuses to freeze counts drawn from a truncated reconciliation", async () => {
    const { database, safe } = await scaffold();
    await logPacket(database, safe, "Smith family deeds");
    await logPacket(database, safe, "Smith will envelope");
    const stocktakeId = await openCount(database);

    await expect(
      closeCustodyStocktake(database, stocktakeId, { rowLimit: 1 }, options),
    ).rejects.toMatchObject({ code: "custody-stocktake-truncated" });
    // Refused before anything is written: the count is still open and still closable properly.
    expect(await readCustodyStocktake(database, stocktakeId)).toMatchObject({ status: "open" });
  });

  // Abandoning remains the honest way out, and the close RECORDS the truncation rather than closing
  // silently — that fact is what explains why a count ended with no reportable number.
  it("records the truncation on an abandoned close", async () => {
    const { database, safe } = await scaffold();
    await logPacket(database, safe, "Smith family deeds");
    await logPacket(database, safe, "Smith will envelope");
    const stocktakeId = await openCount(database);

    const closed = await closeCustodyStocktake(
      database,
      stocktakeId,
      { abandoned: true, rowLimit: 1 },
      options,
    );
    await commit(database, closed.effect);
    expect(closed).toMatchObject({ status: "abandoned", counts: null, truncated: true });
    const audit = await database
      .prepare(`SELECT metadata FROM audit_log WHERE event = 'custodyStocktake.closed'`)
      .all<{ metadata: string }>();
    expect(JSON.parse(audit.results[0]?.metadata ?? "{}")).toMatchObject({
      abandoned: true,
      truncated: true,
    });
  });

  // The cap now truncates in the direction the last-observation rule needs: the read is newest-first
  // and the reconciliation keeps the first row it sees for each packet, so a correction recorded as
  // the later, truer sighting is the row that SURVIVES rather than the row that gets dropped.
  it("keeps the latest observation of a packet when the sighting read truncates", async () => {
    const { database, safe, shelf } = await scaffold();
    const packet = await logPacket(database, safe);
    const stocktakeId = await openCount(database);
    // First the mistake, then the correction — the later, truer look.
    await recordCustodyStocktakeSightings(
      database,
      stocktakeId,
      [{ kind: "not_found", packetId: packet.packetId, observedAt: "2026-08-04T09:00:00.000Z" }],
      options,
    );
    await recordCustodyStocktakeSightings(
      database,
      stocktakeId,
      [
        {
          kind: "sighted",
          packetId: packet.packetId,
          locationId: shelf,
          observedAt: "2026-08-04T11:00:00.000Z",
        },
      ],
      options,
    );

    const partial = await reconcileCustodyStocktake(database, stocktakeId, { rowLimit: 1 });
    expect(partial.truncated).toBe(true);
    // The correction won: the packet reads as misplaced (seen on the shelf, expected in the safe),
    // not as missing.
    expect(partial.missing).toHaveLength(0);
    expect(partial.misplaced).toHaveLength(1);
  });
});
