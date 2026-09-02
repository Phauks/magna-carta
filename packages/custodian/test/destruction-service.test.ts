import type { CustodyDestructionRequestId, UserId } from "@magna-carta/identifiers/types";
import { describe, expect, it } from "vitest";
import {
  approveCustodyDestruction,
  executeCustodyDestruction,
  refuseCustodyDestruction,
  requestCustodyDestruction,
  withdrawCustodyDestruction,
} from "../src/destruction-service.ts";
import {
  listCustodyDestructionRequests,
  readCustodyDestructionRequest,
} from "../src/destruction-statements.ts";
import { placeCustodyHold, releaseCustodyHold } from "../src/hold-service.ts";
import { addCustodyItem } from "../src/item-service.ts";
import { createCustodyLocation } from "../src/location-service.ts";
import { recordCustodyMovement } from "../src/movement-service.ts";
import { readCustodyMovements } from "../src/movement-statements.ts";
import { createCustodyPacket } from "../src/packet-service.ts";
import { readCustodyItem, readCustodyPacket } from "../src/packet-statements.ts";
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
const APPROVER = "user_secondPerson" as UserId;
const approverOptions = { clock: options.clock, actorUserId: APPROVER };

async function scaffold() {
  const { database, raw } = migratedDatabase();
  seedMember(raw);
  seedMatter(raw);
  raw.exec(
    `INSERT INTO member (user_id, display_name, status, created_at) VALUES ('${APPROVER}', 'Second Person', 'active', '2026-08-04T00:00:00.000Z')`,
  );
  const { locationId: safe, effect } = await createCustodyLocation(
    database,
    { name: "Main safe", kind: "safe" },
    options,
  );
  await commit(database, effect);
  const created = await createCustodyPacket(
    database,
    {
      name: "Duplicate correspondence file",
      owners: [{ entityId: SMITH }],
      currentLocationId: safe,
      matterId: MATTER,
    },
    { ...options, responsibleMemberId: ACTOR },
  );
  return { database, raw, safe, packetId: created.packetId };
}

async function raise(
  database: Awaited<ReturnType<typeof scaffold>>["database"],
  packetId: Awaited<ReturnType<typeof scaffold>>["packetId"],
): Promise<CustodyDestructionRequestId> {
  const { destructionRequestId, effect } = await requestCustodyDestruction(
    database,
    packetId,
    { basis: "superseded copies, client instructed in writing on 2026-07-30" },
    options,
  );
  await commit(database, effect);
  return destructionRequestId;
}

describe("the destruction workflow takes two people, by construction", () => {
  it("raises, approves, and executes — appending the destruction to the one movement ledger", async () => {
    const { database, packetId } = await scaffold();
    const requestId = await raise(database, packetId);

    const raised = await readCustodyDestructionRequest(database, requestId);
    expect(raised?.outcome).toBeNull();
    expect(raised?.requested_by).toBe(ACTOR);
    // Raising destroys nothing.
    expect((await readCustodyPacket(database, packetId))?.status).toBe("held");

    const approved = await approveCustodyDestruction(database, requestId, approverOptions);
    await commit(database, approved.effect);
    expect((await readCustodyDestructionRequest(database, requestId))?.outcome).toBe("approved");
    // Approval authorizes; it still destroys nothing.
    expect((await readCustodyPacket(database, packetId))?.status).toBe("held");

    const executed = await executeCustodyDestruction(database, requestId, {
      ...approverOptions,
      method: "cross-cut shredded, witnessed",
    });
    const row = await readCustodyDestructionRequest(database, requestId);
    expect(row?.outcome).toBe("executed");
    expect(row?.executed_movement_id).toBe(executed.movementId);
    expect((await readCustodyPacket(database, packetId))?.status).toBe("destroyed");

    // The destruction is on the same append-only ledger as every other event, carrying the name of
    // the person who recorded it — not a second, quieter way to change a packet's state.
    const movements = await readCustodyMovements(database, packetId, 20);
    const destruction = movements.find((movement) => movement.kind === "destroyed");
    expect(destruction?.id).toBe(executed.movementId);
    expect(destruction?.recorded_by_user_id).toBe(APPROVER);
    expect(destruction?.reason).toBe("cross-cut shredded, witnessed");
  });

  it("refuses an approval by the person who raised the request", async () => {
    const { database, packetId } = await scaffold();
    const requestId = await raise(database, packetId);
    await expect(approveCustodyDestruction(database, requestId, options)).rejects.toMatchObject({
      code: "custody-approver-must-differ",
    });
  });

  // The service refusal above is the message a person reads. THIS is the guarantee: the same row,
  // written straight at the database with the service stepped around entirely, is still refused.
  it("refuses a requester-equals-approver row AT THE DATABASE, with no service in the way", async () => {
    const { database, raw, packetId } = await scaffold();
    const requestId = await raise(database, packetId);

    expect(() =>
      raw.exec(
        `UPDATE custody_destruction_request SET approved_by = '${ACTOR}', approved_at = '2026-08-05T00:00:00.000Z', outcome = 'approved' WHERE id = '${requestId}'`,
      ),
    ).toThrow(/approved by a different person/);

    // And the case the column CHECK cannot see: a request naming no requester at all, which would
    // otherwise let any approver satisfy "approved_by <> requested_by".
    raw.exec(
      `INSERT INTO custody_destruction_request (id, packet_id, requested_at, basis, created_at, updated_at) VALUES ('custodyDestructionRequest_anonymous00', '${packetId}', '2026-08-05T00:00:00.000Z', 'no named requester', '2026-08-05T00:00:00.000Z', '2026-08-05T00:00:00.000Z')`,
    );
    expect(() =>
      raw.exec(
        `UPDATE custody_destruction_request SET approved_by = '${APPROVER}', approved_at = '2026-08-05T00:00:00.000Z', outcome = 'approved' WHERE id = 'custodyDestructionRequest_anonymous00'`,
      ),
    ).toThrow(/approved by a different person/);

    // An INSERT arriving already approved is refused on the same terms — a rule enforced on one path
    // is a rule with a door in it.
    expect(() =>
      raw.exec(
        `INSERT INTO custody_destruction_request (id, packet_id, requested_by, requested_at, basis, approved_by, approved_at, outcome, created_at, updated_at) VALUES ('custodyDestructionRequest_selfappr00', '${packetId}', '${ACTOR}', '2026-08-05T00:00:00.000Z', 'self approved', '${ACTOR}', '2026-08-05T00:00:00.000Z', 'approved', '2026-08-05T00:00:00.000Z', '2026-08-05T00:00:00.000Z')`,
      ),
    ).toThrow(/approved by a different person/);
  });

  it("refuses execution before a second person has approved", async () => {
    const { database, packetId } = await scaffold();
    const requestId = await raise(database, packetId);
    await expect(
      executeCustodyDestruction(database, requestId, approverOptions),
    ).rejects.toMatchObject({ code: "custody-destruction-not-approved" });
    expect((await readCustodyPacket(database, packetId))?.status).toBe("held");
  });

  it("refuses to re-decide a request that has already been decided", async () => {
    const { database, packetId } = await scaffold();
    const requestId = await raise(database, packetId);
    const refused = await refuseCustodyDestruction(
      database,
      requestId,
      { reason: "the client asked us to keep them" },
      approverOptions,
    );
    await commit(database, refused.effect);

    const row = await readCustodyDestructionRequest(database, requestId);
    expect(row?.outcome).toBe("refused");
    expect(row?.refused_by).toBe(APPROVER);
    expect(row?.refusal_reason).toBe("the client asked us to keep them");

    await expect(
      approveCustodyDestruction(database, requestId, approverOptions),
    ).rejects.toMatchObject({ code: "custody-destruction-request-decided" });
    await expect(withdrawCustodyDestruction(database, requestId, options)).rejects.toMatchObject({
      code: "custody-destruction-request-decided",
    });
  });

  it("lists the pending queue separately from the decided history", async () => {
    const { database, packetId } = await scaffold();
    const first = await raise(database, packetId);
    const refused = await refuseCustodyDestruction(database, first, {}, approverOptions);
    await commit(database, refused.effect);
    const second = await raise(database, packetId);

    const pending = await listCustodyDestructionRequests(database, { outcome: "pending" });
    expect(pending.data.map((row) => row.id)).toEqual([second]);
    const all = await listCustodyDestructionRequests(database, { packetId });
    expect(all.data).toHaveLength(2);
  });
});

describe("a hold in force forbids destroying the property", () => {
  it("refuses the request while a hold is in force, and again at execution when one lands after approval", async () => {
    const { database, packetId } = await scaffold();
    const held = await placeCustodyHold(
      database,
      packetId,
      { kind: "legal", reason: "estate dispute" },
      options,
    );
    await commit(database, held.effect);

    await expect(
      requestCustodyDestruction(database, packetId, { basis: "routine" }, options),
    ).rejects.toMatchObject({ code: "custody-hold-blocks-action" });

    // Released, the request goes through — the refusal is the hold, not the packet.
    const released = await releaseCustodyHold(database, held.holdId, options);
    await commit(database, released.effect);
    const requestId = await raise(database, packetId);
    const approved = await approveCustodyDestruction(database, requestId, approverOptions);
    await commit(database, approved.effect);

    // A hold placed in the window between approval and execution is exactly the event a hold exists
    // for, so the question is asked again on the way out.
    const second = await placeCustodyHold(database, packetId, { kind: "discovery" }, options);
    await commit(database, second.effect);
    await expect(
      executeCustodyDestruction(database, requestId, approverOptions),
    ).rejects.toMatchObject({ code: "custody-hold-blocks-action" });
    expect((await readCustodyPacket(database, packetId))?.status).toBe("held");
  });
});

describe("an item of intrinsic value is never destructible, and there is no way round it", () => {
  async function withIrreplaceableOriginal() {
    const scaffolded = await scaffold();
    const item = await addCustodyItem(
      scaffolded.database,
      scaffolded.packetId,
      { description: "Original will of Jane Smith", intrinsicValue: true },
      options,
    );
    await commit(scaffolded.database, item.effect);
    return { ...scaffolded, itemId: item.itemId };
  }

  it("refuses a request against the item, and against the packet holding it", async () => {
    const { database, packetId, itemId } = await withIrreplaceableOriginal();
    await expect(
      requestCustodyDestruction(database, packetId, { basis: "space", itemId }, options),
    ).rejects.toMatchObject({ code: "custody-intrinsic-value-not-destructible" });
    // Destroying the envelope destroys the will inside it, so a packet-scoped request is refused on
    // the strength of any item in it.
    await expect(
      requestCustodyDestruction(database, packetId, { basis: "space" }, options),
    ).rejects.toMatchObject({ code: "custody-intrinsic-value-not-destructible" });
  });

  // The refusal has NO override anywhere: not a parameter, not a second endpoint, and not the
  // ordinary movement path standing open beside the workflow. Every route to a destroyed original is
  // closed, and the last of them is closed at the database.
  it("leaves no reachable override — not the movement path, not a raw database write", async () => {
    const { database, raw, packetId, itemId } = await withIrreplaceableOriginal();

    // The ordinary movement write path, which is not part of the destruction workflow at all.
    await expect(
      recordCustodyMovement(database, packetId, { kind: "destroyed" }, options),
    ).rejects.toMatchObject({ code: "custody-intrinsic-value-not-destructible" });
    await expect(
      recordCustodyMovement(database, packetId, { kind: "destroyed", itemId }, options),
    ).rejects.toMatchObject({ code: "custody-intrinsic-value-not-destructible" });

    // And straight at the database, with every service stepped around.
    expect(() =>
      raw.exec(
        `INSERT INTO custody_destruction_request (id, packet_id, item_id, requested_by, requested_at, basis, created_at, updated_at) VALUES ('custodyDestructionRequest_forced0000', '${packetId}', '${itemId}', '${ACTOR}', '2026-08-05T00:00:00.000Z', 'forced', '2026-08-05T00:00:00.000Z', '2026-08-05T00:00:00.000Z')`,
      ),
    ).toThrow(/intrinsic value/);
    expect(() =>
      raw.exec(
        `INSERT INTO custody_movement (id, packet_id, item_id, kind, occurred_at, recorded_at) VALUES ('custodyMovement_forcedDestroy000000', '${packetId}', '${itemId}', 'destroyed', '2026-08-05T00:00:00.000Z', '2026-08-05T00:00:00.000Z')`,
      ),
    ).toThrow(/intrinsic value/);

    expect((await readCustodyItem(database, itemId))?.status).toBe("held");
    expect((await readCustodyPacket(database, packetId))?.status).toBe("held");
  });

  // The flag can be set after a request is raised — somebody opens the envelope and finds the will.
  // The execution reads the fact as it stands at execution, not as it stood when the request was
  // typed.
  it("refuses at execution when the flag is set after approval", async () => {
    const { database, packetId } = await scaffold();
    const requestId = await raise(database, packetId);
    const approved = await approveCustodyDestruction(database, requestId, approverOptions);
    await commit(database, approved.effect);

    const item = await addCustodyItem(
      database,
      packetId,
      { description: "Original will found inside", intrinsicValue: true },
      options,
    );
    await commit(database, item.effect);

    await expect(
      executeCustodyDestruction(database, requestId, approverOptions),
    ).rejects.toMatchObject({ code: "custody-intrinsic-value-not-destructible" });
    expect((await readCustodyPacket(database, packetId))?.status).toBe("held");
  });
});
