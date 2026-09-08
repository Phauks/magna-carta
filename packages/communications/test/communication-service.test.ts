import { describe, expect, it } from "vitest";
import {
  logCommunication,
  routeCommunication,
  unrouteCommunication,
  type LogCommunicationInput,
} from "../src/communication-service.ts";
import {
  countUnroutedCommunicationsStatement,
  readCommunication,
  selectCommunicationsStatement,
  type CommunicationWithMatterRow,
} from "../src/communication-statements.ts";
import { CommunicationValidationError } from "../src/validation.ts";
import {
  ACTOR,
  CLOSED_MATTER,
  CONSULTATION_MATTER,
  HOLDING_MATTER,
  INTAKE_MATTER,
  MATTER,
  callInput,
  commit,
  migratedDatabase,
  options,
  optionsWithoutQueue,
  seedFirm,
  textInput,
  visibility,
} from "./support.ts";
import type { CommunicationId, MatterId } from "@magna-carta/identifiers/types";

function fresh() {
  const database = migratedDatabase();
  seedFirm(database.raw);
  return database;
}

async function listAll(
  database: ReturnType<typeof fresh>,
  overrides: Record<string, unknown> = {},
): Promise<readonly CommunicationWithMatterRow[]> {
  const { results } = await selectCommunicationsStatement(database.database, {
    limit: 50,
    visibility,
    includeUnrouted: true,
    ...overrides,
  }).all<CommunicationWithMatterRow>();
  return results;
}

async function log(
  database: ReturnType<typeof fresh>,
  // The service's own input type, not one helper's return: this file logs calls AND texts through
  // the same helper, and pinning it to the call shape made every text argument a type error.
  input: LogCommunicationInput,
  serviceOptions = options,
): Promise<CommunicationId> {
  const { communicationId, effect } = await logCommunication(
    database.database,
    input,
    serviceOptions,
  );
  await commit(database.database, effect);
  return communicationId;
}

describe("logging a call or a text", () => {
  it("records a call against a matter", async () => {
    const database = fresh();
    const id = await log(database, callInput({ matterId: MATTER }));

    const row = await readCommunication(database.database, id, visibility, true);
    expect(row?.matter_id).toBe(MATTER);
    expect(row?.channel).toBe("voice");
    expect(row?.duration_seconds).toBe(720);
    // The row records who typed it in AND who was on the call. They default to the same member and
    // are different columns, because a receptionist logging a transferred call is the other case.
    expect(row?.producer).toBe("member");
    expect(row?.logged_by_user_id).toBe(ACTOR);
    expect(row?.member_user_id).toBe(ACTOR);
  });

  it("records a call against no matter at all, which is the queue", async () => {
    const database = fresh();
    await log(database, callInput());

    const { results } = await countUnroutedCommunicationsStatement(database.database).all<{
      count: number;
    }>();
    expect(results[0]?.count).toBe(1);
  });

  // THE OWNER'S RULING OF 2026-09-07, and the reason it gets three cases rather than one: a text may
  // be on an intake or a consultation, it does not need a NUMBER, but it needs a status.
  it("accepts an unnumbered consultation as an anchor", async () => {
    const database = fresh();
    const id = await log(database, textInput({ matterId: CONSULTATION_MATTER }));

    const row = await readCommunication(database.database, id, visibility, true);
    expect(row?.matter_id).toBe(CONSULTATION_MATTER);
    // The read resolves what the anchor actually has: no matter number, a tentative one instead.
    expect(row?.matter_number).toBeNull();
    expect(row?.consultation_number).toBe("C-2026-0009");
    expect(row?.matter_status).toBe("consultation");
  });

  it("accepts an intake as an anchor, which carries no number of any kind", async () => {
    const database = fresh();
    const id = await log(database, textInput({ matterId: INTAKE_MATTER }));

    const row = await readCommunication(database.database, id, visibility, true);
    expect(row?.matter_id).toBe(INTAKE_MATTER);
    expect(row?.matter_number).toBeNull();
    expect(row?.consultation_number).toBeNull();
    expect(row?.matter_status).toBe("intake");
  });

  it("refuses a closed matter, and says which problem it is", async () => {
    const database = fresh();
    await expect(
      logCommunication(database.database, callInput({ matterId: CLOSED_MATTER }), options),
    ).rejects.toMatchObject({ code: "communication-matter-closed" });
  });

  // A matter that does not exist and a matter the reader may not see raise the SAME refusal, so the
  // route cannot be used as an existence oracle for walled matters.
  it("refuses an invisible matter the way it refuses an unknown one", async () => {
    const database = fresh();
    const unknown = "matter_neverExisted000000000" as MatterId;

    await expect(
      logCommunication(database.database, callInput({ matterId: unknown }), options),
    ).rejects.toMatchObject({ code: "communication-unknown-matter" });
    await expect(
      logCommunication(database.database, callInput({ matterId: HOLDING_MATTER }), options),
    ).rejects.toMatchObject({ code: "communication-unknown-matter" });
  });

  it("refuses a message body on a call and a duration on a message", async () => {
    const database = fresh();
    await expect(
      logCommunication(database.database, callInput({ body: "this belongs to a text" }), options),
    ).rejects.toMatchObject({ code: "communication-body-on-call" });
    await expect(
      logCommunication(database.database, textInput({ durationSeconds: 60 }), options),
    ).rejects.toMatchObject({ code: "communication-duration-on-message" });
  });

  it("refuses a call logged in the future", async () => {
    const database = fresh();
    await expect(
      logCommunication(
        database.database,
        callInput({ occurredAt: "2027-01-01T00:00:00.000Z" }),
        options,
      ),
    ).rejects.toMatchObject({ code: "communication-future-instant" });
  });

  it("refuses a row that records nothing at all", async () => {
    const database = fresh();
    await expect(
      logCommunication(
        database.database,
        callInput({ summary: null, durationSeconds: null }),
        options,
      ),
    ).rejects.toMatchObject({ code: "communication-empty-content" });
  });
});

describe("the gate over the unrouted queue", () => {
  it("hides unrouted rows from a reader without the review capability", async () => {
    const database = fresh();
    await log(database, callInput({ matterId: MATTER }));
    await log(database, callInput());

    expect(await listAll(database)).toHaveLength(2);
    // The same read, one flag different: the row with no matter falls out entirely rather than
    // arriving stripped, because a row nobody may see is not a row with fields missing.
    expect(await listAll(database, { includeUnrouted: false })).toHaveLength(1);
  });

  it("never returns a row on a matter the predicate excludes", async () => {
    const database = fresh();
    // The platform's own custody holding matter is a real row in every firm's database and must
    // never appear on a read composing the predicate.
    const { communicationId, effect } = await logCommunication(
      database.database,
      callInput({ matterId: MATTER }),
      options,
    );
    await commit(database.database, effect);
    database.raw.exec(
      `UPDATE communication SET matter_id = '${HOLDING_MATTER}' WHERE id = '${communicationId}'`,
    );

    expect(await listAll(database)).toHaveLength(0);
    expect(
      await readCommunication(database.database, communicationId, visibility, true),
    ).toBeUndefined();
  });

  it("refuses to reach an unrouted row by id without the capability", async () => {
    const database = fresh();
    const id = await log(database, callInput());

    // Filing necessarily READS the row on its way, so the act is gated by the same key as looking
    // at the queue — otherwise the queue could be worked by id from outside the permission that
    // reveals it.
    await expect(
      routeCommunication(database.database, id, MATTER, optionsWithoutQueue),
    ).rejects.toMatchObject({ code: "communication-unknown" });
  });
});

describe("filing onto a matter and taking it back off", () => {
  it("moves a row out of the queue and back into it", async () => {
    const database = fresh();
    const id = await log(database, callInput());

    const filed = await routeCommunication(database.database, id, MATTER, options);
    await commit(database.database, filed.effect);
    expect((await readCommunication(database.database, id, visibility, true))?.matter_id).toBe(
      MATTER,
    );

    const taken = await unrouteCommunication(database.database, id, options);
    await commit(database.database, taken.effect);
    const row = await readCommunication(database.database, id, visibility, true);
    // Back in the queue, not gone: what was said still happened, and the words are still there.
    expect(row?.matter_id).toBeNull();
    expect(row?.summary).toBe("Talked the offer through. She wants to sleep on it.");
  });

  it("files onto an intake, which is the anchor a first contact actually lands on", async () => {
    const database = fresh();
    const id = await log(database, textInput());

    const filed = await routeCommunication(database.database, id, INTAKE_MATTER, options);
    await commit(database.database, filed.effect);
    expect((await readCommunication(database.database, id, visibility, true))?.matter_id).toBe(
      INTAKE_MATTER,
    );
  });

  it("refuses to file a row that is already on a matter", async () => {
    const database = fresh();
    const id = await log(database, callInput({ matterId: MATTER }));

    await expect(
      routeCommunication(database.database, id, CONSULTATION_MATTER, options),
    ).rejects.toMatchObject({ code: "communication-already-routed" });
  });

  it("refuses to take a row off nothing", async () => {
    const database = fresh();
    const id = await log(database, callInput());

    await expect(unrouteCommunication(database.database, id, options)).rejects.toMatchObject({
      code: "communication-not-routed",
    });
  });

  it("refuses to file onto a closed matter", async () => {
    const database = fresh();
    const id = await log(database, callInput());

    await expect(
      routeCommunication(database.database, id, CLOSED_MATTER, options),
    ).rejects.toMatchObject({ code: "communication-matter-closed" });
  });
});

describe("what the audit log is allowed to carry", () => {
  // The one rule this subsystem must not break: the words and the number are the content the record
  // exists to hold, and the audit log is a compliance record with its own retention and its own
  // readers. Asserted rather than trusted, because a metadata field is one careless edit away.
  it("records identifiers, enums and instants, never the words or the number", async () => {
    const database = fresh();
    await log(database, textInput({ matterId: MATTER, body: "The settlement figure is 240000" }));

    const { results } = await database.database
      .prepare("SELECT event, metadata FROM audit_log")
      .all<{ event: string; metadata: string | null }>();
    const logged = results.find((row) => row.event === "communications.communication.logged");
    expect(logged).toBeDefined();
    const metadata = logged?.metadata ?? "";
    expect(metadata).not.toContain("240000");
    expect(metadata).not.toContain("settlement");
    expect(metadata).not.toContain("7025550143");
    expect(metadata).toContain(MATTER);
    expect(metadata).toContain("sms");
  });
});

describe("searching and narrowing the log", () => {
  it("finds a conversation by its words and by the number", async () => {
    const database = fresh();
    await log(database, textInput({ matterId: MATTER, body: "Can we push tomorrow to 3?" }));
    await log(database, callInput({ matterId: MATTER, counterpartyNumber: "(702) 555-9999" }));

    expect(await listAll(database, { search: "push tomorrow" })).toHaveLength(1);
    // The number is in the match on purpose: it is how people actually look for a text.
    expect(await listAll(database, { search: "555-9999" })).toHaveLength(1);
    expect(await listAll(database, { search: "nothing here" })).toHaveLength(0);
  });

  it("treats a wildcard in the search term as text, not as an instruction", async () => {
    const database = fresh();
    await log(database, textInput({ matterId: MATTER, body: "a 50% share of the costs" }));
    await log(database, textInput({ matterId: MATTER, body: "nothing in common" }));

    expect(await listAll(database, { search: "50%" })).toHaveLength(1);
    // An unescaped underscore would match any single character and return both rows.
    expect(await listAll(database, { search: "50_" })).toHaveLength(0);
  });

  it("narrows to one matter and to one channel", async () => {
    const database = fresh();
    await log(database, callInput({ matterId: MATTER }));
    await log(database, textInput({ matterId: CONSULTATION_MATTER }));

    expect(await listAll(database, { matterId: MATTER })).toHaveLength(1);
    expect(await listAll(database, { channel: "sms" })).toHaveLength(1);
    expect(await listAll(database, { scope: "unrouted" })).toHaveLength(0);
    expect(await listAll(database, { scope: "routed" })).toHaveLength(2);
  });
});
