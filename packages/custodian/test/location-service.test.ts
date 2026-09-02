import type { CustodyLocationId } from "@magna-carta/identifiers/types";
import { describe, expect, it } from "vitest";
import {
  closeCustodyLocation,
  createCustodyLocation,
  readCustodyLocationPath,
  updateCustodyLocation,
} from "../src/location-service.ts";
import { readCustodyLocationSubtreeIds } from "../src/location-statements.ts";
import { createCustodyPacket } from "../src/packet-service.ts";
import { MAX_CUSTODY_LOCATION_DEPTH } from "../src/types.ts";
import { CustodyValidationError } from "../src/validation.ts";
import {
  ACTOR,
  MATTER,
  commit,
  migratedDatabase,
  options,
  seedMatter,
  seedMember,
} from "./support.ts";

async function makeNode(
  database: ReturnType<typeof migratedDatabase>["database"],
  name: string,
  kind: Parameters<typeof createCustodyLocation>[1]["kind"],
  parentLocationId?: CustodyLocationId,
): Promise<CustodyLocationId> {
  const { locationId, effect } = await createCustodyLocation(
    database,
    { name, kind, parentLocationId },
    options,
  );
  await commit(database, effect);
  return locationId;
}

describe("the custody location tree", () => {
  it("nests a node under its parent and reads the breadcrumb root-first", async () => {
    const { database } = migratedDatabase();
    const office = await makeNode(database, "Reno office", "office");
    const safe = await makeNode(database, "Main safe", "safe", office);
    const box = await makeNode(database, "Deed box 4", "box", safe);

    const path = await readCustodyLocationPath(database, box);
    expect(path.map((node) => node.name)).toEqual(["Reno office", "Main safe", "Deed box 4"]);
  });

  it("returns the transitive subtree, parents before children", async () => {
    const { database } = migratedDatabase();
    const office = await makeNode(database, "Reno office", "office");
    const safe = await makeNode(database, "Main safe", "safe", office);
    const box = await makeNode(database, "Deed box 4", "box", safe);
    const elsewhere = await makeNode(database, "First National Bank", "bank");

    const subtree = await readCustodyLocationSubtreeIds(database, office);
    expect(subtree).toEqual([office, safe, box]);
    expect(subtree).not.toContain(elsewhere);
  });

  // A node moved into its own subtree would detach that whole branch from every root, and the
  // breadcrumb walk would never terminate.
  it("refuses a re-parent into the node's own subtree", async () => {
    const { database } = migratedDatabase();
    const office = await makeNode(database, "Reno office", "office");
    const safe = await makeNode(database, "Main safe", "safe", office);
    const box = await makeNode(database, "Deed box 4", "box", safe);

    await expect(
      updateCustodyLocation(database, safe, { parentLocationId: box }, options),
    ).rejects.toMatchObject({ code: "custody-location-cycle" });
    // The node itself is also its own subtree's root.
    await expect(
      updateCustodyLocation(database, office, { parentLocationId: office }, options),
    ).rejects.toBeInstanceOf(CustodyValidationError);
  });

  it("refuses a node deeper than the cap", async () => {
    const { database } = migratedDatabase();
    let parent = await makeNode(database, "Reno office", "office");
    for (let depth = 1; depth < MAX_CUSTODY_LOCATION_DEPTH; depth++) {
      parent = await makeNode(database, `Level ${depth}`, "box", parent);
    }
    await expect(
      createCustodyLocation(
        database,
        { name: "One too deep", kind: "position", parentLocationId: parent },
        options,
      ),
    ).rejects.toMatchObject({ code: "custody-location-too-deep" });
  });

  // The cap is eight, and the boundary is asserted at both sides of it rather than "somewhere past
  // seven": eight levels is office > room > safe > cabinet > shelf > box > position plus one more,
  // which is deeper than any real storage arrangement, and the ninth is where a tree stops being an
  // arrangement and starts being a mistake.
  it("permits a tree exactly eight levels deep and refuses the ninth, on creation and on re-parenting", async () => {
    const { database } = migratedDatabase();
    const nodes: CustodyLocationId[] = [await makeNode(database, "Level 1", "office")];
    for (let level = 2; level <= 8; level++) {
      nodes.push(await makeNode(database, `Level ${level}`, "box", nodes[level - 2]));
    }
    expect(nodes).toHaveLength(8);
    expect(await readCustodyLocationPath(database, nodes[7] as CustodyLocationId)).toHaveLength(8);

    await expect(
      createCustodyLocation(
        database,
        { name: "Level 9", kind: "position", parentLocationId: nodes[7] },
        options,
      ),
    ).rejects.toMatchObject({ code: "custody-location-too-deep" });

    // The same cap on the other write path. A node moved under the deepest one would land at nine
    // just as surely as one created there, and a cap enforced on creation alone is a cap with a
    // second door in it.
    const sibling = await makeNode(database, "Elsewhere", "safe");
    await expect(
      updateCustodyLocation(database, sibling, { parentLocationId: nodes[7] }, options),
    ).rejects.toMatchObject({ code: "custody-location-too-deep" });
    // Seven levels above it is still legal — the refusal is about the ninth, not about depth in
    // general.
    const reparented = await updateCustodyLocation(
      database,
      sibling,
      { parentLocationId: nodes[6] },
      options,
    );
    await commit(database, reparented.effect);
    expect(await readCustodyLocationPath(database, sibling)).toHaveLength(8);
  });

  // A closed node with originals still in it is exactly the silent orphaning the register prevents.
  it("refuses to close a node whose subtree still holds a packet", async () => {
    const { database, raw } = migratedDatabase();
    seedMember(raw);
    seedMatter(raw);
    const office = await makeNode(database, "Reno office", "office");
    const safe = await makeNode(database, "Main safe", "safe", office);
    await createCustodyPacket(
      database,
      {
        name: "Smith family deeds",
        owners: [{ entityId: "directoryPerson_smith0000000000000" }],
        currentLocationId: safe,
        matterId: MATTER,
      },
      { ...options, responsibleMemberId: ACTOR },
    );

    await expect(closeCustodyLocation(database, office, options)).rejects.toMatchObject({
      code: "custody-location-occupied",
    });
    await expect(closeCustodyLocation(database, safe, options)).rejects.toMatchObject({
      code: "custody-location-occupied",
    });
  });

  it("closes an empty node", async () => {
    const { database } = migratedDatabase();
    const office = await makeNode(database, "Reno office", "office");
    const safe = await makeNode(database, "Retired safe", "safe", office);
    const { effect } = await closeCustodyLocation(database, safe, options);
    await commit(database, effect);
    const path = await readCustodyLocationPath(database, safe);
    expect(path.at(-1)?.status).toBe("closed");
  });

  // A bank vault is not one of the firm's offices, so it never becomes a `location` row — it is a
  // root of this tree with no firm binding at all.
  it("accepts an external site as a root with no firm office binding", async () => {
    const { database } = migratedDatabase();
    const { locationId, effect } = await createCustodyLocation(
      database,
      { name: "First National Bank, Box 2214", kind: "bank", address: "1 Virginia St, Reno NV" },
      options,
    );
    await commit(database, effect);
    const path = await readCustodyLocationPath(database, locationId);
    expect(path).toHaveLength(1);
    expect(path[0]).toMatchObject({ kind: "bank", firm_location_id: null });
  });

  it("refuses a child that claims a firm office of its own", async () => {
    const { database } = migratedDatabase();
    const office = await makeNode(database, "Reno office", "office");
    await expect(
      createCustodyLocation(
        database,
        {
          name: "Top shelf",
          kind: "shelf",
          parentLocationId: office,
          firmLocationId: "location_otherOffice00000000" as never,
        },
        options,
      ),
    ).rejects.toBeInstanceOf(CustodyValidationError);
  });
});
