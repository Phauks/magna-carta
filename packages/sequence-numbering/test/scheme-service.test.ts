import { commitEffectBatch, type BatchDatabase } from "@magna-carta/data-access/effect-batch";
import { createMigratedNodeDatabase } from "@magna-carta/database/node-sqlite";
import type { UserId } from "@magna-carta/identifiers/types";
import { describe, expect, it } from "vitest";
import {
  readActiveScheme,
  schemeSchemaFor,
  setActiveNumberingScheme,
} from "../src/scheme-service.ts";
import { deriveScopeKey, renderNumber } from "../src/render.ts";
import {
  DEFAULT_COMMUNICATION_SCHEME,
  DEFAULT_INVOICE_SCHEME,
  DEFAULT_TIME_ENTRY_SCHEME,
} from "../src/purposes.ts";
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

/*
 * WHAT A PURPOSE WILL AND WILL NOT ACCEPT.
 *
 * Every refusal here belongs at the SAVE rather than at the first draw under the scheme, because a
 * draw is a record somebody was trying to create — a bill being finalized, an entry being captured.
 */
describe("a scheme is validated against its purpose", () => {
  it("refuses a part the purpose cannot render", () => {
    // A conflicts check carries no client at the moment it is numbered.
    const result = schemeSchemaFor("conflicts_check").safeParse([
      { kind: "client_code" },
      { kind: "counter", padWidth: 4 },
    ]);
    expect(result.success).toBe(false);
  });

  it("refuses a matter number inside a matter number", () => {
    const result = schemeSchemaFor("matter").safeParse([
      { kind: "matter_number" },
      { kind: "counter", padWidth: 4 },
    ]);
    expect(result.success).toBe(false);
  });

  it("requires the part that tells one owner-scoped run from another", () => {
    // Two matters both count 0001, so an entry number without its matter's number would be issued
    // twice over.
    expect(
      schemeSchemaFor("time_entry").safeParse([{ kind: "counter", padWidth: 4 }]).success,
    ).toBe(false);
    expect(
      schemeSchemaFor("time_entry").safeParse([
        { kind: "matter_number" },
        { kind: "literal", text: "." },
        { kind: "counter", padWidth: 4 },
      ]).success,
    ).toBe(true);
  });

  it("refuses a part marked as restarting the count on a run whose scope is not the template's", () => {
    const result = schemeSchemaFor("invoice").safeParse([
      { kind: "year", digits: 4, scoping: true },
      { kind: "counter", padWidth: 5 },
    ]);
    expect(result.success).toBe(false);
  });

  it("renders each built-in default as the run rendered it before the firm could shape it", () => {
    const sample = { openedDate: "2026-09-08", matterNumber: "2026-0147" };
    expect(renderNumber(DEFAULT_INVOICE_SCHEME, sample, 1)).toBe("00001");
    expect(renderNumber(DEFAULT_TIME_ENTRY_SCHEME, sample, 42)).toBe("2026-0147.0042");
    expect(renderNumber(DEFAULT_COMMUNICATION_SCHEME, sample, 42)).toBe("2026-09-08-0042");
    // And the day the call's count runs within is the three date parts, joined as a scope key.
    expect(deriveScopeKey(DEFAULT_COMMUNICATION_SCHEME, sample)).toBe("2026:09:08");
  });
});
