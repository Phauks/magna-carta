import { createMigratedNodeDatabase } from "@magna-carta/database/node-sqlite";
import type { BatchDatabase } from "@magna-carta/data-access/effect-batch";
import { runInterleaved } from "@magna-carta/data-access/interleave";
import type { MatterId, UserId } from "@magna-carta/identifiers/types";
import { describe, expect, it } from "vitest";
import { ClosePreconditionError, type ClosePrecondition } from "../src/close-preconditions.ts";
import { OpenPreconditionError, type OpenPrecondition } from "../src/open-preconditions.ts";
import {
  closeMatter,
  createMatter,
  graduateMatter,
  holdMatter,
  openMatter,
  releaseMatter,
  renumberMatter,
  reopenMatter,
  updateMatter,
} from "../src/matter-service.ts";
import type { NumberSegment } from "@magna-carta/sequence-numbering/segments";
import type { MatterNumberingPurpose } from "../src/matter-statements.ts";
import { MatterValidationError } from "../src/validation.ts";

const clock = {
  now: () => "2026-06-13T12:00:00.000Z",
  today: () => "2026-06-13",
};
// A visibly later instant, so a test can tell whose write landed on a timestamp column.
const laterClock = {
  now: () => "2026-12-25T09:00:00.000Z",
  today: () => "2026-12-25",
};
const RESPONSIBLE = "user_attorney" as UserId;
const options = { clock, actorUserId: RESPONSIBLE };

const YEAR_COUNTER_SCHEME: NumberSegment[] = [
  { kind: "year", digits: 4 },
  { kind: "literal", text: "-" },
  { kind: "counter", padWidth: 4 },
];

// A client code renders INTO the number but is not marked scoping, so every matter draws from the
// one firm-wide counter while rendering a different string. Two draws that share a counter value
// therefore produce two numbers no uniqueness check on matter_number can tell apart.
const CLIENT_CODE_SCHEME: NumberSegment[] = [
  { kind: "client_code" },
  { kind: "literal", text: "-" },
  { kind: "counter", padWidth: 4 },
];

async function readAllocations(database: BatchDatabase) {
  const { results } = await database
    .prepare(
      "SELECT scope_key, drawn_value FROM matter_number_allocation ORDER BY scope_key, drawn_value",
    )
    .all<{ scope_key: string; drawn_value: number }>();
  return results;
}

function freshDatabase(): BatchDatabase {
  return createMigratedNodeDatabase("per-firm").database;
}

async function seedMember(database: BatchDatabase, userId: string): Promise<void> {
  await database
    .prepare(
      "INSERT INTO member (user_id, display_name, status, created_at) VALUES (?1, 'Attorney', 'active', ?2)",
    )
    .bind(userId, clock.now())
    .run();
}

async function seedScheme(
  database: BatchDatabase,
  segments: NumberSegment[],
  purpose: MatterNumberingPurpose = "matter",
): Promise<void> {
  // One active scheme per purpose: deactivate any existing of that purpose, then insert the new one.
  await database
    .prepare("UPDATE numbering_scheme SET active = 0 WHERE purpose = ?1")
    .bind(purpose)
    .run();
  await database
    .prepare(
      "INSERT INTO numbering_scheme (id, segments, purpose, active, created_at, updated_at) VALUES (?1, ?2, ?3, 1, ?4, ?4)",
    )
    .bind(
      `numberingScheme_${Math.floor(performance.now())}_${segments.length}_${purpose}`,
      JSON.stringify(segments),
      purpose,
      clock.now(),
    )
    .run();
}

async function readMatter(database: BatchDatabase, matterId: MatterId) {
  const { results } = await database
    .prepare(
      "SELECT status, matter_number, consultation_number, intake_number, opened_at, held_at, hold_reason, closed_at FROM matter WHERE id = ?1",
    )
    .bind(matterId)
    .all<{
      status: string;
      matter_number: string | null;
      consultation_number: string | null;
      intake_number: string | null;
      opened_at: string | null;
      held_at: string | null;
      hold_reason: string | null;
      closed_at: string | null;
    }>();
  return results[0];
}

async function countCloseAudits(database: BatchDatabase, matterId: MatterId): Promise<number> {
  const { results } = await database
    .prepare(
      "SELECT COUNT(*) AS closes FROM audit_log WHERE event = 'matter.closed' AND subject_id = ?1",
    )
    .bind(matterId)
    .all<{ closes: number }>();
  return results[0]?.closes ?? 0;
}

async function setup(segments: NumberSegment[] = YEAR_COUNTER_SCHEME): Promise<BatchDatabase> {
  const database = freshDatabase();
  await seedMember(database, RESPONSIBLE);
  await seedScheme(database, segments);
  return database;
}

const baseInput = { title: "Smith v. Jones", responsibleMemberId: RESPONSIBLE } as const;

describe("createMatter", () => {
  it("creates a consultation with a consultation number and no matter number", async () => {
    const database = await setup();
    const { matterId, matterNumber, consultationNumber } = await createMatter(
      database,
      { ...baseInput, status: "consultation" },
      options,
    );
    expect(matterNumber).toBeNull();
    // No consultation scheme is configured here, so the built-in default renders: a consultation is
    // never left unnumbered while somebody gets round to the settings screen.
    expect(consultationNumber).toBe("C2026-0001");
    const row = await readMatter(database, matterId);
    expect(row).toMatchObject({
      status: "consultation",
      matter_number: null,
      consultation_number: "C2026-0001",
      opened_at: null,
    });
  });

  it("counts consultations on their own run, leaving the matter counter untouched", async () => {
    const database = await setup();
    const first = await createMatter(database, { ...baseInput, status: "consultation" }, options);
    const second = await createMatter(database, { ...baseInput, status: "consultation" }, options);
    expect([first.consultationNumber, second.consultationNumber]).toEqual([
      "C2026-0001",
      "C2026-0002",
    ]);
    // The first MATTER opened after two consultations still draws 0001: a consultation that never
    // becomes a matter must consume no matter number, or the firm's own run reads as a lost file.
    const opened = await createMatter(database, { ...baseInput, status: "open" }, options);
    expect(opened.matterNumber).toBe("2026-0001");
    expect(opened.consultationNumber).toBeNull();
    // Both runs allocate in the same tables, kept apart by the scope-key prefix. The default
    // consultation scheme scopes on the year, so its run restarts each January; the matter scheme
    // here is firm-wide and its scope key is empty.
    expect(await readAllocations(database)).toEqual([
      { scope_key: "", drawn_value: 1 },
      { scope_key: "consultation/2026", drawn_value: 1 },
      { scope_key: "consultation/2026", drawn_value: 2 },
    ]);
  });

  it("renders a consultation number from the firm's own consultation scheme when it has one", async () => {
    const database = await setup();
    await seedScheme(
      database,
      [
        { kind: "literal", text: "INTAKE-" },
        { kind: "counter", padWidth: 3, start: 40 },
      ],
      "consultation",
    );
    const { consultationNumber } = await createMatter(
      database,
      { ...baseInput, status: "consultation" },
      options,
    );
    expect(consultationNumber).toBe("INTAKE-040");
    // The matter scheme is a different row and is not disturbed by the consultation one.
    const opened = await createMatter(database, { ...baseInput, status: "open" }, options);
    expect(opened.matterNumber).toBe("2026-0001");
  });

  it("draws a number when created directly as open", async () => {
    const database = await setup();
    const { matterId, matterNumber } = await createMatter(
      database,
      { ...baseInput, status: "open" },
      options,
    );
    expect(matterNumber).toBe("2026-0001");
    expect(await readMatter(database, matterId)).toMatchObject({
      status: "open",
      matter_number: "2026-0001",
    });
  });

  it("refuses an empty title", async () => {
    const database = await setup();
    await expect(
      createMatter(database, { ...baseInput, title: "  ", status: "open" }, options),
    ).rejects.toMatchObject({ code: "empty-matter-title" });
  });
});

describe("openMatter", () => {
  it("draws the number at open, not at creation, for a consultation", async () => {
    const database = await setup();
    const { matterId } = await createMatter(
      database,
      { ...baseInput, status: "consultation" },
      options,
    );
    expect((await readMatter(database, matterId))?.matter_number).toBeNull();
    const { matterNumber } = await openMatter(database, matterId, {}, options);
    expect(matterNumber).toBe("2026-0001");
    expect(await readMatter(database, matterId)).toMatchObject({
      status: "open",
      matter_number: "2026-0001",
      // Opening ADDS the permanent number; the tentative one stays, so a document filed under it
      // still resolves.
      consultation_number: "C2026-0001",
    });
  });

  it("refuses to open a matter that is not a consultation", async () => {
    const database = await setup();
    const { matterId } = await createMatter(database, { ...baseInput, status: "open" }, options);
    await expect(openMatter(database, matterId, {}, options)).rejects.toMatchObject({
      code: "matter-not-consultation",
    });
  });

  it("refuses an unknown matter", async () => {
    const database = await setup();
    await expect(
      openMatter(database, "matter_missing" as MatterId, {}, options),
    ).rejects.toMatchObject({ code: "matter-not-found" });
  });

  it("refuses when the matter was opened between the precondition read and the commit", async () => {
    const database = await setup();
    const { matterId } = await createMatter(
      database,
      { ...baseInput, status: "consultation" },
      options,
    );
    // The winner opens the same matter while the racing call is mid-flight, after it has already
    // read the matter as consultation and drawn its own number.
    let winner = "";
    await expect(
      runInterleaved({
        database,
        concurrentWriter: async () => {
          winner = (await openMatter(database, matterId, {}, options)).matterNumber;
        },
        operation: (racing) => openMatter(racing, matterId, {}, options),
      }),
    ).rejects.toMatchObject({ code: "matter-not-consultation" });
    // The winner's number and open instant stand — the loser rewrote nothing.
    expect(await readMatter(database, matterId)).toMatchObject({
      status: "open",
      matter_number: winner,
      opened_at: clock.now(),
    });
  });

  it("refuses when the matter was closed between the precondition read and the commit", async () => {
    const database = await setup();
    const { matterId } = await createMatter(
      database,
      { ...baseInput, status: "consultation" },
      options,
    );
    await expect(
      runInterleaved({
        database,
        concurrentWriter: () => closeMatter(database, matterId, options),
        operation: (racing) => openMatter(racing, matterId, {}, options),
      }),
    ).rejects.toMatchObject({ code: "matter-not-consultation" });
    // A declined consultation stays closed and unnumbered: the late open neither revived it nor
    // stamped a number on it.
    expect(await readMatter(database, matterId)).toMatchObject({
      status: "closed",
      matter_number: null,
      opened_at: null,
    });
  });

  it("refuses to draw a number with no active scheme", async () => {
    const database = freshDatabase();
    await seedMember(database, RESPONSIBLE);
    await expect(
      createMatter(database, { ...baseInput, status: "open" }, options),
    ).rejects.toMatchObject({ code: "scheme-missing" });
  });
});

describe("closeMatter / reopenMatter", () => {
  it("closes an open matter and reopens it back to open (number frozen)", async () => {
    const database = await setup();
    const { matterId } = await createMatter(database, { ...baseInput, status: "open" }, options);
    await closeMatter(database, matterId, options);
    expect(await readMatter(database, matterId)).toMatchObject({
      status: "closed",
      matter_number: "2026-0001",
    });
    await reopenMatter(database, matterId, options);
    expect(await readMatter(database, matterId)).toMatchObject({
      status: "open",
      matter_number: "2026-0001",
      closed_at: null,
    });
  });

  it("puts an open matter on hold with its reason, keeps the number, and releases it back to open", async () => {
    const database = await setup();
    const { matterId } = await createMatter(database, { ...baseInput, status: "open" }, options);
    await holdMatter(database, matterId, { reason: "  The client has stopped paying.  " }, options);
    expect(await readMatter(database, matterId)).toMatchObject({
      status: "hold",
      matter_number: "2026-0001",
      hold_reason: "The client has stopped paying.",
    });
    expect((await readMatter(database, matterId))?.held_at).not.toBeNull();
    await releaseMatter(database, matterId, options);
    expect(await readMatter(database, matterId)).toMatchObject({
      status: "open",
      matter_number: "2026-0001",
      held_at: null,
      hold_reason: null,
    });
    // One audit row each way, and nothing drawn: the counter is where the open left it.
    const { results } = await database
      .prepare(
        "SELECT event, COUNT(*) AS c FROM audit_log WHERE subject_id = ?1 AND event IN ('matter.held', 'matter.released') GROUP BY event ORDER BY event",
      )
      .bind(matterId)
      .all<{ event: string; c: number }>();
    expect(results).toEqual([
      { event: "matter.held", c: 1 },
      { event: "matter.released", c: 1 },
    ]);
  });

  it("refuses a hold with no reason, and a hold on anything but an active matter or a consultation", async () => {
    const database = await setup();
    const { matterId } = await createMatter(database, { ...baseInput, status: "open" }, options);
    await expect(holdMatter(database, matterId, { reason: "   " }, options)).rejects.toMatchObject({
      code: "empty-hold-reason",
    });
    // An intake has nothing to pause: it is the walk toward a consultation.
    const intake = await createMatter(database, { ...baseInput, status: "intake" }, options);
    await expect(
      holdMatter(database, intake.matterId, { reason: "Waiting" }, options),
    ).rejects.toMatchObject({ code: "matter-not-open" });
    await holdMatter(database, matterId, { reason: "Waiting on the client" }, options);
    await expect(
      holdMatter(database, matterId, { reason: "Again" }, options),
    ).rejects.toMatchObject({ code: "matter-not-open" });
    // A closed matter is not paused either; it is finished.
    const consultation = await createMatter(
      database,
      { ...baseInput, status: "consultation" },
      options,
    );
    await closeMatter(database, consultation.matterId, options);
    await expect(
      holdMatter(database, consultation.matterId, { reason: "Waiting" }, options),
    ).rejects.toMatchObject({ code: "matter-not-open" });
    // And a release of a matter that is not held.
    await expect(releaseMatter(database, intake.matterId, options)).rejects.toMatchObject({
      code: "matter-not-held",
    });
  });

  it("puts a consultation on hold, keeps its tentative number, and releases it back to consultation", async () => {
    const database = await setup();
    const created = await createMatter(database, { ...baseInput, status: "consultation" }, options);
    await holdMatter(
      database,
      created.matterId,
      { reason: "The prospect is thinking it over." },
      options,
    );
    expect(await readMatter(database, created.matterId)).toMatchObject({
      status: "hold",
      matter_number: null,
      consultation_number: created.consultationNumber,
      hold_reason: "The prospect is thinking it over.",
    });
    // The release returns the consultation to a consultation, never to active: nothing opened it,
    // so no matter number is drawn and opened_at stays empty.
    await releaseMatter(database, created.matterId, options);
    expect(await readMatter(database, created.matterId)).toMatchObject({
      status: "consultation",
      matter_number: null,
      consultation_number: created.consultationNumber,
      opened_at: null,
      held_at: null,
      hold_reason: null,
    });
  });

  it("closes a held consultation and reopens it to the hold, which releases to consultation", async () => {
    const database = await setup();
    const created = await createMatter(database, { ...baseInput, status: "consultation" }, options);
    await holdMatter(database, created.matterId, { reason: "Parked" }, options);
    await closeMatter(database, created.matterId, options);
    expect(await readMatter(database, created.matterId)).toMatchObject({
      status: "closed",
      matter_number: null,
    });
    await reopenMatter(database, created.matterId, options);
    expect(await readMatter(database, created.matterId)).toMatchObject({
      status: "hold",
      hold_reason: "Parked",
      closed_at: null,
    });
    await releaseMatter(database, created.matterId, options);
    expect(await readMatter(database, created.matterId)).toMatchObject({
      status: "consultation",
      matter_number: null,
      consultation_number: created.consultationNumber,
    });
  });

  it("closes a held matter and reopens it to the hold it was in, reason intact", async () => {
    const database = await setup();
    const { matterId } = await createMatter(database, { ...baseInput, status: "open" }, options);
    await holdMatter(database, matterId, { reason: "Unpaid invoices" }, options);
    await closeMatter(database, matterId, options);
    expect(await readMatter(database, matterId)).toMatchObject({ status: "closed" });
    await reopenMatter(database, matterId, options);
    expect(await readMatter(database, matterId)).toMatchObject({
      status: "hold",
      hold_reason: "Unpaid invoices",
      closed_at: null,
    });
  });

  it("creates an intake with its own number, leaving the other two runs untouched", async () => {
    const database = await setup();
    const created = await createMatter(database, { ...baseInput, status: "intake" }, options);
    expect(created.matterNumber).toBeNull();
    expect(created.consultationNumber).toBeNull();
    // No intake scheme is configured here, so the built-in default renders: an enquiry is never left
    // unnumbered while somebody gets round to the settings screen.
    expect(created.intakeNumber).toBe("I2026-0001");
    expect(await readMatter(database, created.matterId)).toMatchObject({
      status: "intake",
      matter_number: null,
      consultation_number: null,
      intake_number: "I2026-0001",
      opened_at: null,
    });
    // The other two runs are untouched: the next consultation recorded outright is still the first,
    // which is the whole reason an intake counts on a run of its own.
    const outright = await createMatter(
      database,
      { ...baseInput, status: "consultation" },
      options,
    );
    expect(outright.consultationNumber).toBe("C2026-0001");
    expect(outright.intakeNumber).toBeNull();
  });

  it("counts intakes on their own run, in their own scope", async () => {
    const database = await setup();
    const first = await createMatter(database, { ...baseInput, status: "intake" }, options);
    const second = await createMatter(database, { ...baseInput, status: "intake" }, options);
    expect([first.intakeNumber, second.intakeNumber]).toEqual(["I2026-0001", "I2026-0002"]);
    // Three runs allocating in the same tables, kept apart by the scope-key prefix.
    expect(await readAllocations(database)).toEqual([
      { scope_key: "intake/2026", drawn_value: 1 },
      { scope_key: "intake/2026", drawn_value: 2 },
    ]);
  });

  it("renders an intake number from the firm's own intake scheme when it has one", async () => {
    const database = await setup();
    await seedScheme(
      database,
      [
        { kind: "literal", text: "ENQ-" },
        { kind: "counter", padWidth: 3, start: 7 },
      ],
      "intake",
    );
    const { intakeNumber } = await createMatter(
      database,
      { ...baseInput, status: "intake" },
      options,
    );
    expect(intakeNumber).toBe("ENQ-007");
  });

  it("graduates an intake to a consultation, drawing its consultation number, and only once", async () => {
    const database = await setup();
    const { matterId } = await createMatter(database, { ...baseInput, status: "intake" }, options);
    const graduated = await graduateMatter(database, matterId, {}, options);
    expect(graduated.consultationNumber).toBe("C2026-0001");
    expect(await readMatter(database, matterId)).toMatchObject({
      status: "consultation",
      consultation_number: "C2026-0001",
      // The intake number STANDS. Graduation adds a number beside it rather than over it, so a note
      // filed under the enquiry's own number still resolves a year later.
      intake_number: "I2026-0001",
      matter_number: null,
      opened_at: null,
    });
    await expect(graduateMatter(database, matterId, {}, options)).rejects.toMatchObject({
      code: "matter-not-intake",
    });
    // Graduated, it opens like any consultation and keeps the tentative number beside the real one.
    const opened = await openMatter(database, matterId, {}, options);
    expect(await readMatter(database, matterId)).toMatchObject({
      status: "open",
      matter_number: opened.matterNumber,
      consultation_number: "C2026-0001",
    });
  });

  it("refuses to open an intake: it has to become a consultation first", async () => {
    const database = await setup();
    const { matterId } = await createMatter(database, { ...baseInput, status: "intake" }, options);
    await expect(openMatter(database, matterId, {}, options)).rejects.toMatchObject({
      code: "matter-not-consultation",
    });
  });

  it("graduation runs the supplied preconditions and leaves a refused intake untouched", async () => {
    const database = await setup();
    const { matterId } = await createMatter(database, { ...baseInput, status: "intake" }, options);
    const refusing = {
      check: async () => [{ code: "intake-step-outstanding", message: "the identity step" }],
    };
    await expect(
      graduateMatter(database, matterId, {}, { ...options, graduatePreconditions: [refusing] }),
    ).rejects.toMatchObject({ failures: [{ code: "intake-step-outstanding" }] });
    expect(await readMatter(database, matterId)).toMatchObject({
      status: "intake",
      consultation_number: null,
    });
  });

  it("closes an intake that went nowhere and reopens it to intake, never to consultation", async () => {
    const database = await setup();
    const { matterId } = await createMatter(database, { ...baseInput, status: "intake" }, options);
    await closeMatter(database, matterId, options);
    expect((await readMatter(database, matterId))?.status).toBe("closed");
    await reopenMatter(database, matterId, options);
    expect(await readMatter(database, matterId)).toMatchObject({
      status: "intake",
      consultation_number: null,
      matter_number: null,
    });
  });

  it("closes a consultation (declined consultation) and reopens it to consultation", async () => {
    const database = await setup();
    const { matterId } = await createMatter(
      database,
      { ...baseInput, status: "consultation" },
      options,
    );
    await closeMatter(database, matterId, options);
    expect((await readMatter(database, matterId))?.status).toBe("closed");
    await reopenMatter(database, matterId, options);
    expect(await readMatter(database, matterId)).toMatchObject({
      status: "consultation",
      matter_number: null,
    });
  });

  it("refuses to close an already-closed matter, so its recorded close date never moves", async () => {
    const database = await setup();
    const { matterId } = await createMatter(database, { ...baseInput, status: "open" }, options);
    await closeMatter(database, matterId, options);
    const firstClosedAt = (await readMatter(database, matterId))?.closed_at;
    await expect(
      closeMatter(database, matterId, { ...options, clock: laterClock }),
    ).rejects.toMatchObject({ code: "matter-already-closed" });
    expect((await readMatter(database, matterId))?.closed_at).toBe(firstClosedAt);
  });

  it("a close landing after a concurrent close leaves the first close date standing", async () => {
    const database = await setup();
    const { matterId } = await createMatter(database, { ...baseInput, status: "open" }, options);
    // The racing close read the matter as open; the winner closes before its commit lands.
    await runInterleaved({
      database,
      concurrentWriter: () => closeMatter(database, matterId, options),
      operation: (racing) => closeMatter(racing, matterId, { ...options, clock: laterClock }),
    });
    expect((await readMatter(database, matterId))?.closed_at).toBe(clock.now());
  });

  it("close runs the (empty) precondition registry and succeeds", async () => {
    const database = await setup();
    const { matterId } = await createMatter(database, { ...baseInput, status: "open" }, options);
    await expect(closeMatter(database, matterId, options)).resolves.toMatchObject({
      matterId,
      idempotentReplay: false,
    });
  });

  it("surfaces a supplied precondition's refusal and leaves the matter untouched", async () => {
    const database = await setup();
    const { matterId } = await createMatter(database, { ...baseInput, status: "open" }, options);
    const refusing: ClosePrecondition = {
      check: () =>
        Promise.resolve([{ code: "held-elsewhere", message: "something still holds this matter" }]),
    };

    const caught = await closeMatter(database, matterId, {
      ...options,
      closePreconditions: [refusing],
    }).catch((error: unknown) => error);

    expect(caught).toBeInstanceOf(ClosePreconditionError);
    expect((caught as ClosePreconditionError).failures[0]?.code).toBe("held-elsewhere");
    expect((await readMatter(database, matterId))?.status).toBe("open");
    expect(await countCloseAudits(database, matterId)).toBe(0);
  });

  it("carries a precondition's guard statements in the close batch", async () => {
    const database = await setup();
    const { matterId } = await createMatter(database, { ...baseInput, status: "open" }, options);
    // A guard that leaves a visible mark rather than aborting: if it did not ride the batch, the
    // mark would not be there after a successful close.
    const marking: ClosePrecondition = {
      check: () => Promise.resolve([]),
      commitGuard: (context) => [
        context.database
          .prepare("UPDATE matter SET client_code = 'guard-ran' WHERE id = ?1")
          .bind(context.matterId),
      ],
    };

    await closeMatter(database, matterId, { ...options, closePreconditions: [marking] });

    const { results } = await database
      .prepare("SELECT status, client_code FROM matter WHERE id = ?1")
      .bind(matterId)
      .all<{ status: string; client_code: string | null }>();
    expect(results[0]).toMatchObject({ status: "closed", client_code: "guard-ran" });
  });

  it("reports a guard that aborts the batch as the refusal its check now finds", async () => {
    const database = await setup();
    const { matterId } = await createMatter(database, { ...baseInput, status: "open" }, options);
    // The shape of a real race: the check reads a clear state, and by commit time the guard's
    // condition holds. The guard aborts the batch on a constraint the schema owns.
    let readsClear = true;
    const racing: ClosePrecondition = {
      check: () => {
        if (readsClear) {
          readsClear = false;
          return Promise.resolve([]);
        }
        return Promise.resolve([{ code: "arrived-late", message: "it holds something now" }]);
      },
      commitGuard: (context) => [
        context.database
          .prepare("UPDATE matter SET status = 'not-a-status' WHERE id = ?1")
          .bind(context.matterId),
      ],
    };

    const caught = await closeMatter(database, matterId, {
      ...options,
      closePreconditions: [racing],
    }).catch((error: unknown) => error);

    expect(caught).toBeInstanceOf(ClosePreconditionError);
    expect((caught as ClosePreconditionError).failures[0]?.code).toBe("arrived-late");
    // The whole batch rolled back: the close, its audit row, and the guard's own write with it.
    expect((await readMatter(database, matterId))?.status).toBe("open");
    expect(await countCloseAudits(database, matterId)).toBe(0);
  });

  it("re-raises a batch failure that no precondition explains", async () => {
    const database = await setup();
    const { matterId } = await createMatter(database, { ...baseInput, status: "open" }, options);
    const brokenGuard: ClosePrecondition = {
      check: () => Promise.resolve([]),
      commitGuard: (context) => [
        context.database
          .prepare("UPDATE matter SET status = 'not-a-status' WHERE id = ?1")
          .bind(context.matterId),
      ],
    };

    await expect(
      closeMatter(database, matterId, { ...options, closePreconditions: [brokenGuard] }),
    ).rejects.not.toBeInstanceOf(ClosePreconditionError);
    expect((await readMatter(database, matterId))?.status).toBe("open");
  });
});

describe("updateMatter", () => {
  it("merges a field patch", async () => {
    const database = await setup();
    const { matterId } = await createMatter(database, { ...baseInput, status: "open" }, options);
    await updateMatter(database, matterId, { title: "Smith v. Jones (amended)" }, options);
    const { results } = await database
      .prepare("SELECT title FROM matter WHERE id = ?1")
      .bind(matterId)
      .all<{ title: string }>();
    expect(results[0]?.title).toBe("Smith v. Jones (amended)");
  });

  it("refuses an empty title", async () => {
    const database = await setup();
    const { matterId } = await createMatter(database, { ...baseInput, status: "open" }, options);
    await expect(updateMatter(database, matterId, { title: "" }, options)).rejects.toMatchObject({
      code: "empty-matter-title",
    });
  });
});

describe("renumberMatter", () => {
  it("assigns a manual number to an open matter without drawing a counter", async () => {
    const database = await setup();
    const { matterId } = await createMatter(database, { ...baseInput, status: "open" }, options);
    await renumberMatter(database, matterId, "LEGACY-7", options);
    expect((await readMatter(database, matterId))?.matter_number).toBe("LEGACY-7");
    // The counter was never touched — the next drawn matter continues the run at 0002.
    const next = await createMatter(database, { ...baseInput, status: "open" }, options);
    expect(next.matterNumber).toBe("2026-0002");
  });

  it("refuses a manual number on an intake or a consultation: no matter number before active", async () => {
    const database = await setup();
    const consultation = await createMatter(
      database,
      { ...baseInput, status: "consultation" },
      options,
    );
    await expect(
      renumberMatter(database, consultation.matterId, "LEGACY-7", options),
    ).rejects.toMatchObject({ code: "matter-not-open" });
    const intake = await createMatter(database, { ...baseInput, status: "intake" }, options);
    await expect(
      renumberMatter(database, intake.matterId, "LEGACY-8", options),
    ).rejects.toMatchObject({ code: "matter-not-open" });
    expect((await readMatter(database, consultation.matterId))?.matter_number).toBeNull();
  });

  it("accepts a manual number on a held matter and on a closed matter that had opened", async () => {
    const database = await setup();
    const held = await createMatter(database, { ...baseInput, status: "open" }, options);
    await holdMatter(database, held.matterId, { reason: "Waiting" }, options);
    await renumberMatter(database, held.matterId, "CV-2019-044", options);
    expect((await readMatter(database, held.matterId))?.matter_number).toBe("CV-2019-044");
    const closed = await createMatter(database, { ...baseInput, status: "open" }, options);
    await closeMatter(database, closed.matterId, options);
    await renumberMatter(database, closed.matterId, "CV-2018-101", options);
    expect((await readMatter(database, closed.matterId))?.matter_number).toBe("CV-2018-101");
  });

  it("records the displaced number, so a filing quoting it can still be resolved", async () => {
    const database = await setup();
    const { matterId } = await createMatter(database, { ...baseInput, status: "open" }, options);
    await renumberMatter(database, matterId, "CV-2026-00441", options);
    const { results } = await database
      .prepare("SELECT metadata FROM audit_log WHERE event = 'matter.renumbered'")
      .all<{ metadata: string | null }>();
    expect(JSON.parse(results[0]?.metadata ?? "null")).toEqual({
      matterNumber: "CV-2026-00441",
      previousMatterNumber: "2026-0001",
    });
  });

  it("refuses a non-URL-safe number", async () => {
    const database = await setup();
    const { matterId } = await createMatter(database, { ...baseInput, status: "open" }, options);
    await expect(renumberMatter(database, matterId, "a/b c", options)).rejects.toMatchObject({
      code: "matter-number-not-url-safe",
    });
  });

  it("refuses a number already in use", async () => {
    const database = await setup();
    const first = await createMatter(database, { ...baseInput, status: "open" }, options);
    const { matterId } = await createMatter(database, { ...baseInput, status: "open" }, options);
    await expect(
      renumberMatter(database, matterId, first.matterNumber as string, options),
    ).rejects.toMatchObject({ code: "matter-number-taken" });
  });
});

describe("number allocation under contention", () => {
  it("two concurrent open draws yield distinct, sequential numbers", async () => {
    const database = await setup();
    const [a, b] = await Promise.all([
      createMatter(database, { ...baseInput, status: "open" }, options),
      createMatter(database, { ...baseInput, status: "open" }, options),
    ]);
    expect(new Set([a.matterNumber, b.matterNumber])).toEqual(new Set(["2026-0001", "2026-0002"]));
  });

  it("a counter draw retries past a manual number that collides with it", async () => {
    const database = await setup();
    // The first draw takes 0001; park a manual number on it equal to the counter's SECOND draw.
    const parked = await createMatter(database, { ...baseInput, status: "open" }, options);
    expect(parked.matterNumber).toBe("2026-0001");
    await renumberMatter(database, parked.matterId, "2026-0002", options);
    // The next draw renders 0002, collides with the parked number, and retries to 0003.
    const next = await createMatter(database, { ...baseInput, status: "open" }, options);
    expect(next.matterNumber).toBe("2026-0003");
  });

  it("records the counter value each draw consumed", async () => {
    const database = await setup();
    await createMatter(database, { ...baseInput, status: "open" }, options);
    await createMatter(database, { ...baseInput, status: "open" }, options);
    expect(await readAllocations(database)).toEqual([
      { scope_key: "", drawn_value: 1 },
      { scope_key: "", drawn_value: 2 },
    ]);
  });

  it("two concurrent draws never share a counter value, even when they render different numbers", async () => {
    const database = await setup(CLIENT_CODE_SCHEME);
    const [a, b] = await Promise.all([
      createMatter(
        database,
        { ...baseInput, status: "open", numberContext: { clientCode: "ACME" } },
        options,
      ),
      createMatter(
        database,
        { ...baseInput, status: "open", numberContext: { clientCode: "BRIGHTON" } },
        options,
      ),
    ]);
    // Both draws read the same counter value from the same (firm-wide) scope and render it into
    // DIFFERENT strings — "ACME-0001" and "BRIGHTON-0001" — so nothing about matter_number can see
    // the collision. The allocation row is what forces the loser to retry onto the next value.
    const drawnValues = [a.matterNumber, b.matterNumber].map((number) =>
      Number(String(number).split("-")[1]),
    );
    expect(new Set(drawnValues)).toEqual(new Set([1, 2]));
    expect(await readAllocations(database)).toEqual([
      { scope_key: "", drawn_value: 1 },
      { scope_key: "", drawn_value: 2 },
    ]);
  });

  it("scoped schemes keep their own sequences (the same value in two scopes is no collision)", async () => {
    const database = await setup([
      { kind: "location_code", scoping: true },
      { kind: "literal", text: "-" },
      { kind: "counter", padWidth: 3 },
    ]);
    const reno = await createMatter(
      database,
      { ...baseInput, status: "open", numberContext: { locationCode: "RENO" } },
      options,
    );
    const vegas = await createMatter(
      database,
      { ...baseInput, status: "open", numberContext: { locationCode: "VEGAS" } },
      options,
    );
    expect(reno.matterNumber).toBe("RENO-001");
    expect(vegas.matterNumber).toBe("VEGAS-001");
    expect(await readAllocations(database)).toEqual([
      { scope_key: "RENO", drawn_value: 1 },
      { scope_key: "VEGAS", drawn_value: 1 },
    ]);
  });

  it("a scheme edit only affects later matters (existing numbers are frozen)", async () => {
    const database = await setup();
    const first = await createMatter(database, { ...baseInput, status: "open" }, options);
    expect(first.matterNumber).toBe("2026-0001");
    // Switch to a literal-prefixed scheme (still firm-wide, so the counter continues at 2).
    await seedScheme(database, [
      { kind: "literal", text: "M" },
      { kind: "counter", padWidth: 4 },
    ]);
    const second = await createMatter(database, { ...baseInput, status: "open" }, options);
    expect(second.matterNumber).toBe("M0002");
    // The first matter's number is untouched by the scheme change.
    expect((await readMatter(database, first.matterId))?.matter_number).toBe("2026-0001");
  });
});

// Idempotency rides the shared runIdempotentEffect primitive (design X). An Idempotency-Key replays
// the first response without re-executing; a key reused with a different payload / still in progress
// surfaces the two conflict kinds; a number draw never double-allocates on retry.
describe("matter idempotency (design X)", () => {
  const withKey = (
    key: string,
    fingerprint = "fp",
  ): typeof options & {
    idempotency: { key: string; fingerprint: string };
  } => ({ ...options, idempotency: { key, fingerprint } });

  it("replays the stored create response — no second matter, no second number drawn", async () => {
    const database = await setup();
    const first = await createMatter(database, { ...baseInput, status: "open" }, withKey("k1"));
    expect(first.idempotentReplay).toBe(false);
    expect(first.matterNumber).toBe("2026-0001");

    const replay = await createMatter(database, { ...baseInput, status: "open" }, withKey("k1"));
    expect(replay.idempotentReplay).toBe(true);
    expect(replay.matterId).toBe(first.matterId);
    expect(replay.matterNumber).toBe("2026-0001");

    // Exactly one matter exists, and the counter advanced only once (the next draw is 0002).
    const { results } = await database
      .prepare("SELECT COUNT(*) AS c FROM matter")
      .all<{ c: number }>();
    expect(results[0]?.c).toBe(1);
    const next = await createMatter(database, { ...baseInput, status: "open" }, withKey("k2"));
    expect(next.matterNumber).toBe("2026-0002");
  });

  it("a key reused with a different payload surfaces a fingerprint-mismatch conflict", async () => {
    const database = await setup();
    await createMatter(database, { ...baseInput, status: "open" }, withKey("k1", "fp-a"));
    await expect(
      createMatter(database, { ...baseInput, status: "open" }, withKey("k1", "fp-b")),
    ).rejects.toMatchObject({ kind: "fingerprint-mismatch" });
  });

  it("replays a non-drawing mutation (close) under the same key", async () => {
    const database = await setup();
    const { matterId } = await createMatter(database, { ...baseInput, status: "open" }, options);
    const first = await closeMatter(database, matterId, withKey("close-1"));
    expect(first.idempotentReplay).toBe(false);
    const replay = await closeMatter(database, matterId, withKey("close-1"));
    expect(replay.idempotentReplay).toBe(true);
  });

  // A retried request must never be refused by a precondition its own first attempt satisfied. The
  // matter is no longer consultation precisely BECAUSE this key's open succeeded, so the retry replays
  // the number it drew rather than reporting that the matter cannot be opened.
  it("replays a retried open — the number it drew, not a refusal", async () => {
    const database = await setup();
    const { matterId } = await createMatter(
      database,
      { ...baseInput, status: "consultation" },
      options,
    );
    const first = await openMatter(database, matterId, {}, withKey("open-1"));
    expect(first.idempotentReplay).toBe(false);
    expect(first.matterNumber).toBe("2026-0001");

    const replay = await openMatter(database, matterId, {}, withKey("open-1"));
    expect(replay.idempotentReplay).toBe(true);
    expect(replay.matterNumber).toBe("2026-0001");

    // The replay drew nothing: the next genuinely new open takes the following number.
    const other = await createMatter(database, { ...baseInput, status: "consultation" }, options);
    const next = await openMatter(database, other.matterId, {}, withKey("open-2"));
    expect(next.matterNumber).toBe("2026-0002");
  });

  // A genuinely new open of an already-open matter still carries its own key, so it is still refused.
  it("still refuses a second open under a different key", async () => {
    const database = await setup();
    const { matterId } = await createMatter(
      database,
      { ...baseInput, status: "consultation" },
      options,
    );
    await openMatter(database, matterId, {}, withKey("open-1"));
    await expect(openMatter(database, matterId, {}, withKey("open-2"))).rejects.toMatchObject({
      code: "matter-not-consultation",
    });
  });

  it("replays a retried reopen instead of refusing the matter it just reopened", async () => {
    const database = await setup();
    const { matterId } = await createMatter(database, { ...baseInput, status: "open" }, options);
    await closeMatter(database, matterId, options);

    const first = await reopenMatter(database, matterId, withKey("reopen-1"));
    expect(first.idempotentReplay).toBe(false);
    const replay = await reopenMatter(database, matterId, withKey("reopen-1"));
    expect(replay.idempotentReplay).toBe(true);
    expect(replay.matterId).toBe(matterId);

    // The replay wrote nothing twice: one reopen audit row, one reopen event.
    const { results } = await database
      .prepare("SELECT COUNT(*) AS c FROM audit_log WHERE event = 'matter.reopened'")
      .all<{ c: number }>();
    expect(results[0]?.c).toBe(1);
  });

  it("still refuses a reopen of an open matter under a different key", async () => {
    const database = await setup();
    const { matterId } = await createMatter(database, { ...baseInput, status: "open" }, options);
    await closeMatter(database, matterId, options);
    await reopenMatter(database, matterId, withKey("reopen-1"));
    await expect(reopenMatter(database, matterId, withKey("reopen-2"))).rejects.toMatchObject({
      code: "matter-not-closed",
    });
  });
});

it("ClosePreconditionError carries its failures", () => {
  const error = new ClosePreconditionError([{ code: "x", message: "y" }]);
  expect(error.failures).toEqual([{ code: "x", message: "y" }]);
});

it("MatterValidationError carries a stable code", () => {
  expect(new MatterValidationError("scheme-missing", "x").code).toBe("scheme-missing");
});

describe("openMatter — the open-precondition hook", () => {
  // The registry the matter shell ships is empty; a rule arrives from the composition root. This
  // stands in for one: it refuses until a flag flips, and counts how often it was asked.
  function rule(state: { refuse: boolean; asked: number }): OpenPrecondition {
    return {
      check: async () => {
        state.asked += 1;
        return state.refuse
          ? [{ code: "test-rule-refused", message: "the test rule is not satisfied" }]
          : [];
      },
    };
  }

  it("refuses the open with every failure named, and draws no number", async () => {
    const database = await setup();
    const { matterId } = await createMatter(
      database,
      { ...baseInput, status: "consultation" },
      options,
    );
    const state = { refuse: true, asked: 0 };
    await expect(
      openMatter(database, matterId, {}, { ...options, openPreconditions: [rule(state)] }),
    ).rejects.toSatisfy(
      (caught: unknown) =>
        caught instanceof OpenPreconditionError &&
        caught.failures.length === 1 &&
        caught.failures[0]?.code === "test-rule-refused",
    );
    expect(state.asked).toBe(1);
    expect(await readMatter(database, matterId)).toMatchObject({
      status: "consultation",
      matter_number: null,
    });
    // Only the consultation draw at creation; the matter counter was never touched.
    const allocations = await readAllocations(database);
    expect(allocations.length).toBe(1);
    expect(allocations.every((row) => row.scope_key.startsWith("consultation/"))).toBe(true);
  });

  it("opens once the rule is satisfied, and never consults the rule on a matter already open", async () => {
    const database = await setup();
    const { matterId } = await createMatter(
      database,
      { ...baseInput, status: "consultation" },
      options,
    );
    const state = { refuse: false, asked: 0 };
    const { matterNumber } = await openMatter(
      database,
      matterId,
      {},
      { ...options, openPreconditions: [rule(state)] },
    );
    expect(matterNumber).toBe("2026-0001");
    expect(state.asked).toBe(1);
    // An open matter is refused for its own lifecycle reason before any rule is asked: a rule that
    // ran here would be answering a question about a matter that has already left the funnel.
    state.refuse = true;
    await expect(
      openMatter(database, matterId, {}, { ...options, openPreconditions: [rule(state)] }),
    ).rejects.toMatchObject({ code: "matter-not-consultation" });
    expect(state.asked).toBe(1);
  });

  it("carries a rule's commit guard at the head of the open batch", async () => {
    const database = await setup();
    const { matterId } = await createMatter(
      database,
      { ...baseInput, status: "consultation" },
      options,
    );
    // A guard that always aborts: a statement violating a constraint, never one storing a row.
    const guarded: OpenPrecondition = {
      check: async () => [],
      commitGuard: () => [
        database
          .prepare("INSERT INTO matter_number_allocation (scope_key, drawn_value) VALUES (?1, ?2)")
          .bind("consultation/", 1),
      ],
    };
    await expect(
      openMatter(database, matterId, {}, { ...options, openPreconditions: [guarded] }),
    ).rejects.toBeDefined();
    expect(await readMatter(database, matterId)).toMatchObject({
      status: "consultation",
      matter_number: null,
    });
  });
});
