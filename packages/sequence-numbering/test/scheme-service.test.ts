import { commitEffectBatch, type BatchDatabase } from "@magna-carta/data-access/effect-batch";
import { createMigratedNodeDatabase } from "@magna-carta/database/node-sqlite";
import type { UserId } from "@magna-carta/identifiers/types";
import { describe, expect, it } from "vitest";
import { readActiveScheme, setActiveNumberingScheme } from "../src/scheme-service.ts";
import type { NumberSegment } from "../src/segments.ts";

const clock = { now: () => "2026-06-13T12:00:00.000Z" };
const options = { clock, actorUserId: "user_admin" as UserId };

const YEAR_COUNTER: NumberSegment[] = [
  { kind: "year", digits: 4 },
  { kind: "literal", text: "-" },
  { kind: "counter", padWidth: 4 },
];

const LOCATION_SCOPED: NumberSegment[] = [
  { kind: "location_code", scoping: true },
  { kind: "literal", text: "-" },
  { kind: "counter", padWidth: 5 },
];

function freshDatabase(): BatchDatabase {
  return createMigratedNodeDatabase("per-firm").database;
}

async function activeRows(database: BatchDatabase): Promise<{ segments: string }[]> {
  const { results } = await database
    .prepare("SELECT segments FROM numbering_scheme WHERE active = 1")
    .all<{ segments: string }>();
  return results;
}

describe("setActiveNumberingScheme", () => {
  it("writes the active scheme and reads it back", async () => {
    const database = freshDatabase();
    const { effect } = setActiveNumberingScheme(database, YEAR_COUNTER, options);
    await commitEffectBatch(database, effect, { now: clock.now });

    expect(await readActiveScheme(database)).toEqual(YEAR_COUNTER);
    expect(await activeRows(database)).toHaveLength(1);
  });

  it("deactivates the prior active scheme — exactly one active row", async () => {
    const database = freshDatabase();
    await commitEffectBatch(
      database,
      setActiveNumberingScheme(database, YEAR_COUNTER, options).effect,
      { now: clock.now },
    );
    await commitEffectBatch(
      database,
      setActiveNumberingScheme(database, LOCATION_SCOPED, options).effect,
      { now: clock.now },
    );

    expect(await activeRows(database)).toHaveLength(1);
    expect(await readActiveScheme(database)).toEqual(LOCATION_SCOPED);
  });

  it("writes an audit row in the same batch", async () => {
    const database = freshDatabase();
    await commitEffectBatch(
      database,
      setActiveNumberingScheme(database, YEAR_COUNTER, options).effect,
      { now: clock.now },
    );
    const { results } = await database
      .prepare("SELECT event, actor_user_id FROM audit_log WHERE event = 'numberingScheme.updated'")
      .all<{ event: string; actor_user_id: string }>();
    expect(results).toEqual([{ event: "numberingScheme.updated", actor_user_id: "user_admin" }]);
  });

  it("rejects a scheme with no counter segment", () => {
    const database = freshDatabase();
    expect(() =>
      setActiveNumberingScheme(database, [{ kind: "literal", text: "MC" }], options),
    ).toThrow();
  });

  it("rejects a scheme with two counter segments", () => {
    const database = freshDatabase();
    expect(() =>
      setActiveNumberingScheme(
        database,
        [
          { kind: "counter", padWidth: 4 },
          { kind: "counter", padWidth: 2 },
        ],
        options,
      ),
    ).toThrow();
  });
});

describe("readActiveScheme", () => {
  it("returns undefined when no scheme is active", async () => {
    expect(await readActiveScheme(freshDatabase())).toBeUndefined();
  });
});
