import { seededRandomSource } from "@magna-carta/identifiers/random";
import { expect, test } from "vitest";
import { readCallerIdentity, recordCallerIdentity } from "../src/caller-identity.ts";
import { ACTOR, COLLEAGUE, clock, commit, migratedDatabase, tickingClock } from "./support.ts";

const NUMBER = { countryCallingCode: "1", nationalNumber: "7025550142" };

test("nothing is known about a number until somebody pays to ask", async () => {
  const { database } = migratedDatabase();
  expect(await readCallerIdentity(database, NUMBER)).toBeNull();
});

test("a lookup is kept and read back, with who asked and when", async () => {
  const { database } = migratedDatabase();
  const { stored, effect } = recordCallerIdentity(
    database,
    NUMBER,
    { callerName: "SMITH JOHN", lineType: "mobile", carrierName: "T-MOBILE USA" },
    "telnyx",
    { clock, actorUserId: ACTOR, randomSource: seededRandomSource("caller-identity") },
  );
  await commit(database, effect);

  expect(await readCallerIdentity(database, NUMBER)).toEqual(stored);
  expect(stored).toEqual({
    callerName: "SMITH JOHN",
    lineType: "mobile",
    carrierName: "T-MOBILE USA",
    source: "telnyx",
    lookedUpByUserId: ACTOR,
    lookedUpAt: clock.now(),
  });
});

test("an answer with no name is kept too, because it was paid for", async () => {
  const { database } = migratedDatabase();
  const { effect } = recordCallerIdentity(
    database,
    NUMBER,
    { callerName: null, lineType: null, carrierName: null },
    "telnyx",
    { clock, actorUserId: ACTOR, randomSource: seededRandomSource("empty") },
  );
  await commit(database, effect);
  expect((await readCallerIdentity(database, NUMBER))?.callerName).toBeNull();
});

test("a second lookup of the same number replaces the first rather than adding a row", async () => {
  const { database, raw } = migratedDatabase();
  const ticking = tickingClock();
  for (const [name, actor, seed] of [
    ["OLD NAME", ACTOR, "first"],
    ["NEW NAME", COLLEAGUE, "second"],
  ] as const) {
    const { effect } = recordCallerIdentity(
      database,
      NUMBER,
      { callerName: name, lineType: "fixed", carrierName: null },
      "telnyx",
      { clock: ticking, actorUserId: actor, randomSource: seededRandomSource(seed) },
    );
    await commit(database, effect);
  }
  const kept = await readCallerIdentity(database, NUMBER);
  expect(kept?.callerName).toBe("NEW NAME");
  expect(kept?.lookedUpByUserId).toBe(COLLEAGUE);
  const count = raw.prepare("SELECT count(*) AS n FROM caller_identity").get() as { n: number };
  expect(count.n).toBe(1);
});

test("the audit row records that a lookup was paid for, and never the number or the name", async () => {
  const { database, raw } = migratedDatabase();
  const { effect } = recordCallerIdentity(
    database,
    NUMBER,
    { callerName: "SMITH JOHN", lineType: "mobile", carrierName: null },
    "telnyx",
    { clock, actorUserId: ACTOR, randomSource: seededRandomSource("audit") },
  );
  await commit(database, effect);
  const audit = raw
    .prepare("SELECT event, actor_user_id, subject_id, metadata FROM audit_log")
    .all() as {
    event: string;
    actor_user_id: string;
    subject_id: string | null;
    metadata: string;
  }[];
  expect(audit).toHaveLength(1);
  expect(audit[0]?.event).toBe("communications.callerIdentity.lookedUp");
  expect(audit[0]?.actor_user_id).toBe(ACTOR);
  expect(audit[0]?.subject_id).toBeNull();
  expect(audit[0]?.metadata).not.toContain("7025550142");
  expect(audit[0]?.metadata).not.toContain("SMITH");
});
