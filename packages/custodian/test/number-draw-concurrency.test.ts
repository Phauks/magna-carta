import { describe, expect, it } from "vitest";
import { createCustodyLocation } from "../src/location-service.ts";
import {
  CUSTODY_NUMBER_ALLOCATION_TABLE,
  isNumberAllocationConflict,
  readCounterValue,
} from "../src/numbering/counter-statements.ts";
import {
  DEFAULT_CUSTODY_NUMBER_SCHEME,
  deriveScopeKey,
  renderCustodyItemNumber,
  renderCustodyNumber,
} from "../src/numbering/render.ts";
import { createCustodyPacket } from "../src/packet-service.ts";
import { ACTOR, commit, migratedDatabase, options, seedMember } from "./support.ts";

const SMITH = "directoryPerson_smith0000000000000";

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

describe("the custody number shape", () => {
  it("renders a firm prefix and a zero-padded sequence", () => {
    expect(renderCustodyNumber(DEFAULT_CUSTODY_NUMBER_SCHEME, {}, 42)).toBe("CUS-00042");
  });

  // A firm running two offices may want RNO-00042 and LVS-00042 to coexist, which is what the scope
  // key mechanism does. Firm-wide is the default: a globally unique number is easier to say over the
  // phone and impossible to confuse.
  it("scopes per custody root only when the firm asks for it", () => {
    const scoped = { ...DEFAULT_CUSTODY_NUMBER_SCHEME, prefix: undefined, scopeByRoot: true };
    expect(deriveScopeKey(DEFAULT_CUSTODY_NUMBER_SCHEME, { rootCode: "RNO" })).toBe("");
    expect(deriveScopeKey(scoped, { rootCode: "RNO" })).toBe("RNO");
    expect(renderCustodyNumber(scoped, { rootCode: "RNO" }, 42)).toBe("RNO-00042");
    expect(renderCustodyNumber(scoped, { rootCode: "LVS" }, 42)).toBe("LVS-00042");
  });

  // An item's identity is only meaningful inside its packet, so its number is a packet-relative
  // ordinal and not a second global counter to keep correct.
  it("numbers an item relative to its packet", () => {
    expect(renderCustodyItemNumber("CUS-00042", 3)).toBe("CUS-00042-3");
  });
});

describe("the number draw under concurrency", () => {
  // The whole point of the allocation ledger: two draws that observe the same counter value must not
  // both commit. The loser aborts on the allocation primary key and its retry re-reads the advanced
  // counter, which is what makes concurrent draws yield distinct, sequential numbers with no
  // interactive transaction available.
  it("yields distinct numbers to concurrent draws", async () => {
    const { database, safe } = await scaffold();
    const draw = (name: string) =>
      createCustodyPacket(
        database,
        { name, owners: [{ entityId: SMITH }], currentLocationId: safe },
        { ...options, responsibleMemberId: ACTOR },
      );
    const drawn = await Promise.all([draw("First"), draw("Second"), draw("Third")]);
    const numbers = drawn.map((packet) => packet.custodyNumber).toSorted();
    expect(new Set(numbers).size).toBe(3);
    expect(numbers).toEqual(["CUS-00001", "CUS-00002", "CUS-00003"]);
  });

  it("claims one allocation row per drawn value and none for a manual number", async () => {
    const { database, raw, safe } = await scaffold();
    await createCustodyPacket(
      database,
      { name: "Drawn", owners: [{ entityId: SMITH }], currentLocationId: safe },
      { ...options, responsibleMemberId: ACTOR },
    );
    await createCustodyPacket(
      database,
      {
        name: "Carried in from the paper register",
        owners: [{ entityId: SMITH }],
        currentLocationId: safe,
        manualCustodyNumber: "DEEDS/1994/117",
      },
      { ...options, responsibleMemberId: ACTOR },
    );
    const rows = raw
      .prepare(`SELECT scope_key, drawn_value FROM ${CUSTODY_NUMBER_ALLOCATION_TABLE}`)
      .all() as { scope_key: string; drawn_value: number }[];
    expect(rows).toEqual([{ scope_key: "", drawn_value: 1 }]);
    // The manual number touched no counter, so the next drawn packet still gets value 2.
    expect(await readCounterValue(database, "")).toBe(2);
  });

  it("recognizes the allocation primary-key collision as the losing draw", () => {
    const collision = new Error(
      `UNIQUE constraint failed: ${CUSTODY_NUMBER_ALLOCATION_TABLE}.scope_key, ${CUSTODY_NUMBER_ALLOCATION_TABLE}.drawn_value`,
    );
    expect(isNumberAllocationConflict(collision)).toBe(true);
    expect(isNumberAllocationConflict(new Error("disk I/O error"))).toBe(false);
  });

  // A rendered number that collides with a manually assigned one draws no allocation row, so only
  // the custody_number unique index can see it. The retry advances past the taken value.
  it("skips past a manual number the counter would have rendered", async () => {
    const { database, safe } = await scaffold();
    await createCustodyPacket(
      database,
      {
        name: "Parked on the number the counter would render first",
        owners: [{ entityId: SMITH }],
        currentLocationId: safe,
        manualCustodyNumber: "CUS-00001",
      },
      { ...options, responsibleMemberId: ACTOR },
    );
    const drawn = await createCustodyPacket(
      database,
      {
        name: "Drawn after the parked number",
        owners: [{ entityId: SMITH }],
        currentLocationId: safe,
      },
      { ...options, responsibleMemberId: ACTOR },
    );
    expect(drawn.custodyNumber).toBe("CUS-00002");
  });
});
