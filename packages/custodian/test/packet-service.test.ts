import type { BatchDatabase } from "@magna-carta/data-access/effect-batch";
import type { CustodyLocationId, CustodyPacketId } from "@magna-carta/identifiers/types";
import {
  readSystemMatterId,
  SYSTEM_MATTER_KEYS,
} from "@magna-carta/matters/system-matter-statements";
import { listMatters } from "@magna-carta/matters/queries";
import { describe, expect, it } from "vitest";
import { createCustodyLocation } from "../src/location-service.ts";
import {
  addCustodyOwner,
  createCustodyPacket,
  endCustodyOwner,
  updateCustodyPacket,
} from "../src/packet-service.ts";
import { readCustodyOwners, readCustodyPacket } from "../src/packet-statements.ts";
import { readCustodyMovements } from "../src/movement-statements.ts";
import { ACTOR, commit, migratedDatabase, options, seedMember } from "./support.ts";

const SMITH = "directoryPerson_smith0000000000000";
const JONES = "directoryOrganization_jones000000";

async function scaffold() {
  const { database, raw } = migratedDatabase();
  seedMember(raw);
  const { locationId, effect } = await createCustodyLocation(
    database,
    { name: "Main safe", kind: "safe" },
    options,
  );
  await commit(database, effect);
  return { database, raw, safe: locationId };
}

function packetOptions() {
  return { ...options, responsibleMemberId: ACTOR };
}

async function logPacket(
  database: BatchDatabase,
  safe: CustodyLocationId,
  overrides: Partial<Parameters<typeof createCustodyPacket>[1]> = {},
) {
  return createCustodyPacket(
    database,
    {
      name: "Smith family deeds",
      owners: [{ entityId: SMITH, ownershipRole: "owner" }],
      currentLocationId: safe,
      ...overrides,
    },
    packetOptions(),
  );
}

describe("logging a custody packet", () => {
  it("draws a number, lands the owner link, and opens the ledger in one commit", async () => {
    const { database, safe } = await scaffold();
    const created = await logPacket(database, safe);

    expect(created.custodyNumber).toBe("CUS-00001");
    const packet = await readCustodyPacket(database, created.packetId);
    expect(packet).toMatchObject({
      status: "held",
      number_source: "drawn",
      current_location_id: safe,
    });

    const owners = await readCustodyOwners(database, created.packetId);
    expect(owners).toHaveLength(1);
    expect(owners[0]).toMatchObject({
      entity_id: SMITH,
      ownership_role: "owner",
      effective_to: null,
    });

    // A numbered packet with no history could not say when the firm took the property in.
    const movements = await readCustodyMovements(database, created.packetId, 10);
    expect(movements.map((movement) => movement.kind)).toEqual(["logged"]);
  });

  it("hands consecutive numbers to consecutive draws", async () => {
    const { database, safe } = await scaffold();
    const first = await logPacket(database, safe);
    const second = await logPacket(database, safe, { name: "Jones deed box" });
    expect([first.custodyNumber, second.custodyNumber]).toEqual(["CUS-00001", "CUS-00002"]);
  });

  // The orphan-prevention invariant. There is deliberately no "log it now, attribute it later"
  // escape hatch, because an escape hatch used constantly is not an invariant.
  it("refuses a packet with no owner", async () => {
    const { database, safe } = await scaffold();
    await expect(logPacket(database, safe, { owners: [] })).rejects.toMatchObject({
      code: "custody-owner-required",
    });
  });

  it("accepts a packet with no matter and files its scans on the firm's holding matter", async () => {
    const { database, safe } = await scaffold();
    const created = await logPacket(database, safe);
    const holding = await readSystemMatterId(database, SYSTEM_MATTER_KEYS.custodyHolding);
    expect(holding).toBeDefined();
    expect(created.filingMatterId).toBe(holding);

    // One system row per firm: a second matterless packet reuses it rather than minting another.
    const second = await logPacket(database, safe, { name: "Alvarez will" });
    expect(second.filingMatterId).toBe(holding);
  });

  // A system matter is plumbing, not a client engagement: it must never surface in a caseload list.
  it("keeps the holding matter out of the matter list", async () => {
    const { database, safe } = await scaffold();
    await logPacket(database, safe);
    const page = await listMatters(database, {});
    expect(page.data).toEqual([]);
  });

  // A firm migrating thirty years of physical labels must not be made to re-label a safe.
  it("accepts a manual number, which touches no counter", async () => {
    const { database, safe } = await scaffold();
    const manual = await logPacket(database, safe, {
      name: "Legacy deed packet",
      manualCustodyNumber: "DEEDS/1994/117",
    });
    expect(manual.custodyNumber).toBe("DEEDS/1994/117");
    const packet = await readCustodyPacket(database, manual.packetId);
    expect(packet?.number_source).toBe("manual");

    // The counter is untouched, so the next drawn packet still gets the first value.
    const drawn = await logPacket(database, safe, { name: "Next real packet" });
    expect(drawn.custodyNumber).toBe("CUS-00001");
  });

  it("records the depositor separately from the owner", async () => {
    const { database, safe } = await scaffold();
    const created = await logPacket(database, safe, {
      depositorEntityId: JONES,
      depositedAt: "2026-07-01T10:00:00.000Z",
    });
    const packet = await readCustodyPacket(database, created.packetId);
    expect(packet).toMatchObject({
      depositor_entity_id: JONES,
      deposited_at: "2026-07-01T10:00:00.000Z",
    });
    // The deposit instant is what the ledger displays, not the moment it was typed in.
    const movements = await readCustodyMovements(database, created.packetId, 10);
    expect(movements[0]).toMatchObject({
      occurred_at: "2026-07-01T10:00:00.000Z",
      recorded_at: "2026-08-04T12:00:00.000Z",
    });
  });
});

describe("ownership is temporal", () => {
  it("ends a link by date rather than deleting it", async () => {
    const { database, safe } = await scaffold();
    const created = await logPacket(database, safe);
    const added = await addCustodyOwner(database, created.packetId, { entityId: JONES }, options);
    await commit(database, added.effect);

    const owners = await readCustodyOwners(database, created.packetId);
    const original = owners.find((owner) => owner.entity_id === SMITH);
    const { effect } = await endCustodyOwner(
      database,
      created.packetId,
      original?.id ?? ("" as never),
      options,
    );
    await commit(database, effect);

    const after = await readCustodyOwners(database, created.packetId);
    // Two rows still: who owned what, and when, is exactly what the register is kept to answer.
    expect(after).toHaveLength(2);
    expect(after.find((owner) => owner.entity_id === SMITH)?.effective_to).not.toBeNull();
    expect(after.find((owner) => owner.entity_id === JONES)?.effective_to).toBeNull();
  });

  it("refuses to end the last current owner", async () => {
    const { database, safe } = await scaffold();
    const created = await logPacket(database, safe);
    const owners = await readCustodyOwners(database, created.packetId);
    await expect(
      endCustodyOwner(database, created.packetId, owners[0]?.id ?? ("" as never), options),
    ).rejects.toMatchObject({ code: "custody-owner-required" });
  });
});

describe("packet edits reach descriptive fields only", () => {
  it("updates the name and matter link without touching status or location", async () => {
    const { database, safe } = await scaffold();
    const created = await logPacket(database, safe);
    const { effect } = await updateCustodyPacket(
      database,
      created.packetId,
      { name: "Smith family deeds and will" },
      options,
    );
    await commit(database, effect);
    const packet = await readCustodyPacket(database, created.packetId);
    expect(packet).toMatchObject({
      name: "Smith family deeds and will",
      status: "held",
      current_location_id: safe,
    });
  });

  it("refuses an empty name", async () => {
    const { database, safe } = await scaffold();
    const created: { packetId: CustodyPacketId } = await logPacket(database, safe);
    await expect(
      updateCustodyPacket(database, created.packetId, { name: "   " }, options),
    ).rejects.toMatchObject({ code: "custody-empty-name" });
  });
});
