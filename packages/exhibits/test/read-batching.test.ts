import { describe, expect, it } from "vitest";
import type { SqlDatabase } from "@magna-carta/data-access/idempotency-statements";
import type { MatterExhibitId } from "@magna-carta/identifiers/types";
import { createExhibit } from "../src/exhibit-service.ts";
import { addMembers } from "../src/member-service.ts";
import { listExhibitSets, listMatterExhibits, readExhibitSet } from "../src/queries.ts";
import { createExhibitSet } from "../src/set-service.ts";
import { MATTER, commit, migratedDatabase, options, seedFile } from "./support.ts";

// A list read's natural implementation is a lookup per row, which is an N+1 pointed at a set of two
// hundred members. Each read here is asserted to be a fixed number of statements.

function counting(database: SqlDatabase): { database: SqlDatabase; count: () => number } {
  let prepared = 0;
  return {
    database: {
      prepare(query: string) {
        prepared += 1;
        return database.prepare(query);
      },
    } as SqlDatabase,
    count: () => prepared,
  };
}

describe("read batching", () => {
  it("reads a set of forty members, the set list and the register in one statement each", async () => {
    const { database, raw } = migratedDatabase();
    const exhibitIds: MatterExhibitId[] = [];
    for (let index = 0; index < 40; index += 1) {
      const { fileId } = seedFile(raw, MATTER, `doc${index}.pdf`);
      const created = await createExhibit(database, { matterId: MATTER, fileId, title: `Document ${index}` }, options);
      await commit(database, created.effect);
      exhibitIds.push(created.exhibitId);
    }
    const set = await createExhibitSet(database, { matterId: MATTER, name: "Trial" }, options);
    await commit(database, set.effect);
    await commit(database, (await addMembers(database, MATTER, set.setId, exhibitIds, options)).effect);

    const probe = counting(database);
    const view = await readExhibitSet(probe.database, MATTER, set.setId);
    expect(view?.members).toHaveLength(40);
    expect(view?.members[27]?.label).toBe("BB");
    expect(probe.count()).toBe(1);

    const listProbe = counting(database);
    await listExhibitSets(listProbe.database, MATTER);
    expect(listProbe.count()).toBe(1);

    const registerProbe = counting(database);
    expect(await listMatterExhibits(registerProbe.database, MATTER)).toHaveLength(40);
    expect(registerProbe.count()).toBe(1);
  });
});
