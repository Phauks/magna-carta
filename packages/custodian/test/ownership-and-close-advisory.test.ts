import type { MatterId } from "@magna-carta/identifiers/types";
import { describe, expect, it } from "vitest";
import { matterCustodyCloseAdvisory, readLinkedCustodyPacketCount } from "../src/close-advisory.ts";
import { createCustodyLocation } from "../src/location-service.ts";
import { recordCustodyMovement } from "../src/movement-service.ts";
import { addCustodyOwner, createCustodyPacket } from "../src/packet-service.ts";
import { readCustodyOwnershipRoleCatalog } from "../src/settings.ts";
import {
  ACTOR,
  AUTHORIZED_RELEASE,
  commit,
  migratedDatabase,
  options,
  seedMember,
} from "./support.ts";

const SMITH = "directoryPerson_smith0000000000000";
const JONES = "directoryPerson_jones0000000000000";

async function scaffold() {
  const { database, raw } = migratedDatabase();
  seedMember(raw);
  const { locationId: safe, effect } = await createCustodyLocation(
    database,
    { name: "Main safe", kind: "safe" },
    options,
  );
  await commit(database, effect);
  return { database, raw, safe };
}

function configureOwnershipRoles(
  raw: ReturnType<typeof migratedDatabase>["raw"],
  roles: readonly string[],
): void {
  raw.exec(
    `INSERT INTO setting (key, value, updated_at) VALUES ('custody.ownershipRoleCatalog', '${JSON.stringify(roles)}', '2026-08-05T00:00:00.000Z')`,
  );
}

describe("the ownership role is a per-firm catalog, never a platform enum", () => {
  // A firm that has written no list down constrains nothing. The failure this register exists to
  // prevent is a firm keeping its safe on a sticky note, and a validation gate on day one is how
  // that happens.
  it("accepts any label when the firm has configured no catalog", async () => {
    const { database, safe } = await scaffold();
    expect(await readCustodyOwnershipRoleCatalog(database)).toEqual([]);
    const created = await createCustodyPacket(
      database,
      {
        name: "Smith family deeds",
        owners: [{ entityId: SMITH, ownershipRole: "beneficial owner under a bare trust" }],
        currentLocationId: safe,
      },
      { ...options, responsibleMemberId: ACTOR },
    );
    expect(created.packetId).toBeDefined();
  });

  it("refuses a label outside the catalog once the firm has written one down", async () => {
    const { database, raw, safe } = await scaffold();
    configureOwnershipRoles(raw, ["owner", "joint owner", "life tenant", "executor"]);
    expect(await readCustodyOwnershipRoleCatalog(database)).toContain("life tenant");

    await expect(
      createCustodyPacket(
        database,
        {
          name: "Smith family deeds",
          owners: [{ entityId: SMITH, ownershipRole: "usufructuary" }],
          currentLocationId: safe,
        },
        { ...options, responsibleMemberId: ACTOR },
      ),
    ).rejects.toMatchObject({ code: "custody-ownership-role-not-in-catalog" });

    // Case and surrounding space are not mistakes, and refusing them would teach people to stop
    // using the field.
    const created = await createCustodyPacket(
      database,
      {
        name: "Smith family deeds",
        owners: [{ entityId: SMITH, ownershipRole: " Life Tenant " }],
        currentLocationId: safe,
      },
      { ...options, responsibleMemberId: ACTOR },
    );
    // The same catalog binds the owner ADDED later, not only the ones supplied at creation.
    await expect(
      addCustodyOwner(
        database,
        created.packetId,
        { entityId: JONES, ownershipRole: "remainderman" },
        options,
      ),
    ).rejects.toMatchObject({ code: "custody-ownership-role-not-in-catalog" });
    const added = await addCustodyOwner(
      database,
      created.packetId,
      { entityId: JONES, ownershipRole: "executor" },
      options,
    );
    await commit(database, added.effect);
  });

  it("constrains nothing when the configured catalog is corrupt", async () => {
    const { database, raw, safe } = await scaffold();
    raw.exec(
      `INSERT INTO setting (key, value, updated_at) VALUES ('custody.ownershipRoleCatalog', 'not json at all', '2026-08-05T00:00:00.000Z')`,
    );
    expect(await readCustodyOwnershipRoleCatalog(database)).toEqual([]);
    const created = await createCustodyPacket(
      database,
      {
        name: "Smith family deeds",
        owners: [{ entityId: SMITH, ownershipRole: "anything at all" }],
        currentLocationId: safe,
      },
      { ...options, responsibleMemberId: ACTOR },
    );
    expect(created.packetId).toBeDefined();
  });
});

describe("closing a matter surfaces the property the firm still holds, and never blocks", () => {
  async function packetOnMatter() {
    const { database, raw, safe } = await scaffold();
    const matterId = "matter_custodyAdvisory000000" as MatterId;
    raw.exec(
      `INSERT INTO matter (id, matter_number, title, status, responsible_member_id, created_at, updated_at) VALUES ('${matterId}', 'M-0001', 'Smith estate', 'open', '${ACTOR}', '2026-08-04T00:00:00.000Z', '2026-08-04T00:00:00.000Z')`,
    );
    const created = await createCustodyPacket(
      database,
      {
        name: "Smith family deeds",
        owners: [{ entityId: SMITH }],
        currentLocationId: safe,
        matterId,
      },
      { ...options, responsibleMemberId: ACTOR },
    );
    return { database, raw, matterId, packetId: created.packetId };
  }

  it("says nothing about a matter with no custody packets", async () => {
    const { database } = await scaffold();
    const matterId = "matter_nothingHeld000000000" as MatterId;
    expect(await readLinkedCustodyPacketCount(database, matterId)).toBe(0);
    expect(await matterCustodyCloseAdvisory.notice({ matterId, database })).toEqual([]);
  });

  it("reports the count and nothing identifying", async () => {
    const { database, matterId } = await packetOnMatter();
    const notices = await matterCustodyCloseAdvisory.notice({ matterId, database });
    expect(notices).toHaveLength(1);
    expect(notices[0]?.code).toBe("custody-packets-linked");
    expect(notices[0]?.message).toContain("1 packet");
    // Closing a matter needs no custody permission, and that a firm holds an original for a named
    // person is a disclosure with no document attached — so the notice carries a count and nothing
    // that names the property, its owner, or its number.
    expect(notices[0]?.message).not.toContain("Smith");
    expect(notices[0]?.message).not.toContain("CUS");
  });

  it("stops reporting a packet once it has left the firm's custody", async () => {
    const { database, matterId, packetId } = await packetOnMatter();
    await recordCustodyMovement(database, packetId, AUTHORIZED_RELEASE, options);
    expect(await readLinkedCustodyPacketCount(database, matterId)).toBe(0);
    expect(await matterCustodyCloseAdvisory.notice({ matterId, database })).toEqual([]);
  });

  // The advisory has no refusal shape at all: it returns notices, and there is no arm of it that
  // could stop a close. That is the difference between it and the close-precondition hook, and it is
  // a decision rather than an omission.
  it("exposes no way to refuse a close", () => {
    expect(Object.keys(matterCustodyCloseAdvisory)).toEqual(["notice"]);
    expect("check" in matterCustodyCloseAdvisory).toBe(false);
    expect("commitGuard" in matterCustodyCloseAdvisory).toBe(false);
  });
});
