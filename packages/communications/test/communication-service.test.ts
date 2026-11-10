import { describe, expect, it } from "vitest";
import {
  logCommunication,
  routeCommunication,
  setCommunicationDisposition,
  unrouteCommunication,
  updateCommunication,
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
  // Both channels, because the service takes both and half these cases log a text. Inferring the
  // parameter from `callInput` alone typed this helper voice-only.
  input: ReturnType<typeof callInput> | ReturnType<typeof textInput>,
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

describe("setting a call aside as something that is not a matter", () => {
  // The reason this exists: a wrong number can never be filed, because there is no matter to file
  // it onto. Before it could be set aside it sat in the queue forever, and a queue nobody can empty
  // is a queue nobody works.
  it("takes a row out of the queue without filing it and without deleting it", async () => {
    const database = fresh();
    const id = await log(database, callInput({ summary: "Somebody selling copier toner." }));

    const { effect } = await setCommunicationDisposition(database.database, id, "spam", options);
    await commit(database.database, effect);

    const row = await readCommunication(database.database, id, visibility, true);
    expect(row?.disposition).toBe("spam");
    // Nothing was destroyed: the words, the number and the instant are all still there.
    expect(row?.summary).toBe("Somebody selling copier toner.");
    expect(row?.counterparty_number).toBe("(702) 555-0143");
    expect(await listAll(database, { scope: "unrouted" })).toHaveLength(0);
    expect(await listAll(database, { scope: "setAside" })).toHaveLength(1);
    // And it is still part of the record, so browsing everything still finds it.
    expect(await listAll(database)).toHaveLength(1);
  });

  it("keeps a set-aside row out of the queue count", async () => {
    const database = fresh();
    const waiting = await log(database, callInput());
    const aside = await log(database, callInput({ counterpartyNumber: "(702) 555-0199" }));
    const { effect } = await setCommunicationDisposition(
      database.database,
      aside,
      "firmBusiness",
      options,
    );
    await commit(database.database, effect);

    const { results } = await countUnroutedCommunicationsStatement(database.database).all<{
      count: number;
    }>();
    expect(results[0]?.count).toBe(1);
    expect(waiting).not.toBe(aside);
  });

  it("puts one back in the queue", async () => {
    const database = fresh();
    const id = await log(database, callInput());
    const set = await setCommunicationDisposition(database.database, id, "noAction", options);
    await commit(database.database, set.effect);

    const cleared = await setCommunicationDisposition(database.database, id, null, options);
    await commit(database.database, cleared.effect);

    const row = await readCommunication(database.database, id, visibility, true);
    expect(row?.disposition).toBeNull();
    expect(await listAll(database, { scope: "unrouted" })).toHaveLength(1);
  });

  it("refuses a row that is already on a matter", async () => {
    const database = fresh();
    const id = await log(database, callInput({ matterId: MATTER }));
    await expect(
      setCommunicationDisposition(database.database, id, "spam", options),
    ).rejects.toMatchObject({ code: "communication-already-routed" });
  });

  it("refuses a reason that is not in the vocabulary", async () => {
    const database = fresh();
    const id = await log(database, callInput());
    await expect(
      setCommunicationDisposition(database.database, id, "whatever", options),
    ).rejects.toMatchObject({ code: "communication-invalid-disposition" });
  });

  it("refuses a record that claims both a matter and a reason", async () => {
    const database = fresh();
    await expect(
      logCommunication(
        database.database,
        callInput({ matterId: MATTER, disposition: "spam" }),
        options,
      ),
    ).rejects.toMatchObject({ code: "communication-anchor-conflict" });
  });

  it("clears the reason when the row is later filed onto a matter", async () => {
    const database = fresh();
    const id = await log(database, callInput());
    const set = await setCommunicationDisposition(database.database, id, "noAction", options);
    await commit(database.database, set.effect);

    const filed = await routeCommunication(database.database, id, INTAKE_MATTER, options);
    await commit(database.database, filed.effect);

    const row = await readCommunication(database.database, id, visibility, true);
    expect(row?.matter_id).toBe(INTAKE_MATTER);
    // A row on a matter is not also set aside. A firm that decides a written-off call was real work
    // after all gets one answer about it, not two.
    expect(row?.disposition).toBeNull();
  });
});

describe("correcting a record somebody typed", () => {
  it("changes only what it names and keeps the rest", async () => {
    const database = fresh();
    const id = await log(database, callInput({ matterId: MATTER }));

    const { effect } = await updateCommunication(
      database.database,
      id,
      { counterpartyNumber: "+17025559999", direction: "inbound" },
      options,
    );
    await commit(database.database, effect);

    const row = await readCommunication(database.database, id, visibility, true);
    expect(row?.counterparty_number).toBe("+17025559999");
    expect(row?.direction).toBe("inbound");
    expect(row?.summary).toBe("Talked the offer through. She wants to sleep on it.");
    expect(row?.duration_seconds).toBe(720);
    // The anchor is not this operation's to move.
    expect(row?.matter_id).toBe(MATTER);
  });

  it("re-validates the whole record against the channel it ends up with", async () => {
    const database = fresh();
    const id = await log(database, callInput());
    // A call's length cannot survive its becoming a text: the database refuses the pair outright, so
    // the refusal has to happen before the write rather than as a constraint violation.
    await expect(
      updateCommunication(
        database.database,
        id,
        { channel: "sms", body: "changed my mind" },
        options,
      ),
    ).rejects.toMatchObject({ code: "communication-duration-on-message" });
  });

  it("refuses a record the carrier wrote", async () => {
    const database = fresh();
    const id = await log(database, callInput({ matterId: MATTER }));
    database.raw.exec(
      `UPDATE communication SET producer = 'carrier', logged_by_user_id = NULL, ` +
        `carrier_reference = 'telnyx-1' WHERE id = '${id}'`,
    );

    await expect(
      updateCommunication(database.database, id, { direction: "inbound" }, options),
    ).rejects.toMatchObject({ code: "communication-not-editable" });
  });

  it("cannot reach a record the reader could not list", async () => {
    const database = fresh();
    const id = await log(database, callInput());
    // An unrouted row is invisible without the queue capability, and an id-addressed write must not
    // be a way around that.
    await expect(
      updateCommunication(database.database, id, { direction: "inbound" }, optionsWithoutQueue),
    ).rejects.toMatchObject({ code: "communication-unknown" });
  });
});

describe("finding a conversation by its matter", () => {
  it("matches the matter's title and its number as well as the words", async () => {
    const database = fresh();
    await log(database, callInput({ matterId: MATTER, summary: "nothing memorable" }));
    await log(database, callInput({ matterId: CONSULTATION_MATTER, summary: "nothing memorable" }));

    // "What did we say on the Herrera file" is a question about a case, not about a phrase, and it
    // is the half people reach for first.
    expect(await listAll(database, { search: "Herrera" })).toHaveLength(1);
    expect(await listAll(database, { search: "2026-0041" })).toHaveLength(1);
    // An unnumbered anchor is findable by its consultation number, which is the only one it has.
    expect(await listAll(database, { search: "C-2026-0009" })).toHaveLength(1);
  });
});

describe("the number a firm says out loud", () => {
  /*
   * The owner's ruling of 2026-09-08: "all calls and logs should have a number, which we can identify
   * in the log, before it has been created. should incorporate date." A handle is not something
   * anybody can read back down a telephone; this is.
   */
  it("draws the day of the call and that day's own sequence", async () => {
    const database = fresh();
    await log(database, callInput());
    const [row] = await listAll(database);
    // The call happened on the seventh, whatever day it was typed on.
    expect(row?.reference_number).toBe("2026-09-07-0001");
  });

  it("counts within the day the call happened, not the day it was recorded", async () => {
    const database = fresh();
    await log(database, callInput({ occurredAt: "2026-09-06T09:00:00.000Z" }));
    await log(database, callInput({ occurredAt: "2026-09-07T09:00:00.000Z" }));
    await log(database, callInput({ occurredAt: "2026-09-06T11:00:00.000Z" }));
    const numbers = (await listAll(database)).map((row) => row.reference_number).sort();
    expect(numbers).toEqual(["2026-09-06-0001", "2026-09-06-0002", "2026-09-07-0001"]);
  });

  it("gives one number to one row, and a text carries one too", async () => {
    const database = fresh();
    await log(database, textInput());
    const [row] = await listAll(database);
    expect(row?.reference_number).toBe("2026-09-07-0001");
  });

  it("finds a row by the number somebody quoted back", async () => {
    // The one thing a caller is ever asked to read out, so it is the first thing the search matches.
    const database = fresh();
    await log(database, callInput());
    const found = await listAll(database, { search: "2026-09-07-0001" });
    expect(found).toHaveLength(1);
  });
});

describe("how long the line was open, and how long the call took", () => {
  /*
   * The owner's ruling of 2026-09-08: "you should be able to type in the length of time for the call,
   * and this doesn't need to match calculation, considering people can be put on hold." So the end
   * and the length are two stored facts, and nothing here checks that they agree — a check that they
   * agree is the rule the ruling removes.
   */
  it("keeps a length that is shorter than the span, because that is the hold", async () => {
    const database = fresh();
    await log(
      database,
      callInput({
        occurredAt: "2026-09-07T10:00:00.000Z",
        endedAt: "2026-09-07T11:00:00.000Z",
        durationSeconds: 20 * 60,
      }),
    );
    const [row] = await listAll(database);
    expect(row?.ended_at).toBe("2026-09-07T11:00:00.000Z");
    expect(row?.duration_seconds).toBe(20 * 60);
  });

  it("refuses an end before the start, which is a typo rather than a call", async () => {
    const database = fresh();
    await expect(
      log(database, callInput({ endedAt: "2026-09-07T09:00:00.000Z" })),
    ).rejects.toBeInstanceOf(CommunicationValidationError);
  });

  it("refuses an end on a text, which happens at one moment", async () => {
    const database = fresh();
    await expect(
      log(database, textInput({ endedAt: "2026-09-07T10:25:00.000Z" })),
    ).rejects.toBeInstanceOf(CommunicationValidationError);
  });

  it("carries a corrected end and leaves an omitted one where it was", async () => {
    const database = fresh();
    const id = await log(
      database,
      callInput({ occurredAt: "2026-09-07T10:00:00.000Z", endedAt: "2026-09-07T10:30:00.000Z" }),
    );
    const { effect } = await updateCommunication(
      database.database,
      id,
      { summary: "Corrected the note and nothing else." },
      options,
    );
    await commit(database.database, effect);
    const held = await readCommunication(database.database, id, visibility, true);
    expect(held?.ended_at).toBe("2026-09-07T10:30:00.000Z");
  });
});

describe("what happened on the line", () => {
  it("records the caller's name and an outcome beside the call", async () => {
    const database = fresh();
    const id = await log(
      database,
      callInput({ direction: "inbound", outcome: "answered", callerIdName: "  Maria Lopez " }),
    );
    const row = await readCommunication(database.database, id, visibility, true);
    expect(row?.outcome).toBe("answered");
    expect(row?.caller_id_name).toBe("Maria Lopez");
    expect(row?.spam_kind).toBeNull();
  });

  it("sets a spam call aside as spam without being asked twice, and needs no notes", async () => {
    const database = fresh();
    const id = await log(
      database,
      callInput({
        direction: "inbound",
        outcome: "spam",
        spamKind: "scam",
        summary: null,
        durationSeconds: null,
      }),
    );
    const row = await readCommunication(database.database, id, visibility, true);
    expect(row?.disposition).toBe("spam");
    expect(row?.spam_kind).toBe("scam");
  });

  it("refuses a spam call on a matter", async () => {
    const database = fresh();
    await expect(
      logCommunication(
        database.database,
        callInput({ direction: "inbound", outcome: "spam", matterId: MATTER }),
        options,
      ),
    ).rejects.toMatchObject({ code: "communication-spam-on-matter" });
  });

  it("refuses an outcome from the other direction", async () => {
    const database = fresh();
    await expect(
      logCommunication(
        database.database,
        callInput({ direction: "outbound", outcome: "transferred" }),
        options,
      ),
    ).rejects.toMatchObject({ code: "communication-outcome-direction" });
  });

  it("refuses a transfer that names nobody", async () => {
    const database = fresh();
    await expect(
      logCommunication(
        database.database,
        callInput({ direction: "inbound", outcome: "transferred", memberUserId: null }),
        options,
      ),
    ).rejects.toMatchObject({ code: "communication-transfer-without-member" });
  });

  it("refuses a kind of spam on a call that was not spam", async () => {
    const database = fresh();
    await expect(
      logCommunication(
        database.database,
        callInput({ direction: "inbound", outcome: "answered", spamKind: "sales" }),
        options,
      ),
    ).rejects.toMatchObject({ code: "communication-spam-kind-without-spam" });
  });

  it("lets a text be spam and nothing else", async () => {
    const database = fresh();
    const id = await log(database, textInput({ outcome: "spam" }));
    const row = await readCommunication(database.database, id, visibility, true);
    expect(row?.outcome).toBe("spam");
    await expect(
      logCommunication(database.database, textInput({ outcome: "answered" }), options),
    ).rejects.toMatchObject({ code: "communication-outcome-on-message" });
  });

  it("writes a message's task in the same batch, and keeps its id", async () => {
    const database = fresh();
    const { communicationId, effect } = await logCommunication(
      database.database,
      callInput({ direction: "inbound", outcome: "messageTaken" }),
      options,
      async (call) => {
        expect(call.communicationId).toBeDefined();
        expect(call.referenceNumber).toMatch(/^2026-09-07-/u);
        return {
          taskId: "matterTask_messageTask000000000",
          effect: {
            statements: [],
            outboxMessages: [{ topic: "tasks.firmTask.assigned", payload: {} }],
          },
        };
      },
    );
    expect(effect.outboxMessages).toHaveLength(1);
    await commit(database.database, effect);
    const row = await readCommunication(database.database, communicationId, visibility, true);
    expect(row?.message_task_id).toBe("matterTask_messageTask000000000");
  });

  it("refuses a message on a call whose outcome was not a message", async () => {
    const database = fresh();
    await expect(
      logCommunication(
        database.database,
        callInput({ direction: "inbound", outcome: "answered" }),
        options,
        async () => ({ taskId: "matterTask_x", effect: { statements: [], outboxMessages: [] } }),
      ),
    ).rejects.toMatchObject({ code: "communication-message-without-outcome" });
  });
});
