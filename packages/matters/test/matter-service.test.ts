import { createMigratedNodeDatabase } from "@magna-carta/database/node-sqlite";
import type { BatchDatabase } from "@magna-carta/data-access/effect-batch";
import type { MatterId, UserId } from "@magna-carta/identifiers/types";
import { describe, expect, it } from "vitest";
import { ClosePreconditionError, type ClosePrecondition } from "../src/close-preconditions.ts";
import {
  closeMatter,
  createMatter,
  openMatter,
  reopenMatter,
  renumberMatter,
  updateMatter,
} from "../src/matter-service.ts";
import type { NumberSegment } from "../src/numbering/segments.ts";
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

// Stands in for a concurrent writer landing between a service's precondition read and its commit.
// D1 has no interactive transaction, so that window is real; running `before` at the first batch
// makes it deterministic instead of dependent on how two promises happen to interleave.
function interleaveBeforeFirstCommit(
  database: BatchDatabase,
  before: () => Promise<unknown>,
): BatchDatabase {
  let fired = false;
  return {
    prepare: (sql: string) => database.prepare(sql),
    batch: async (statements) => {
      if (!fired) {
        fired = true;
        await before();
      }
      return database.batch(statements);
    },
  };
}

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

async function seedScheme(database: BatchDatabase, segments: NumberSegment[]): Promise<void> {
  // One active scheme: deactivate any existing, then insert the new active one.
  await database.prepare("UPDATE numbering_scheme SET active = 0").run();
  await database
    .prepare(
      "INSERT INTO numbering_scheme (id, segments, active, created_at, updated_at) VALUES (?1, ?2, 1, ?3, ?3)",
    )
    .bind(
      `numberingScheme_${Math.floor(performance.now())}_${segments.length}`,
      JSON.stringify(segments),
      clock.now(),
    )
    .run();
}

async function readMatter(database: BatchDatabase, matterId: MatterId) {
  const { results } = await database
    .prepare("SELECT status, matter_number, opened_at, closed_at FROM matter WHERE id = ?1")
    .bind(matterId)
    .all<{
      status: string;
      matter_number: string | null;
      opened_at: string | null;
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
  it("creates a prospective consultation with no number", async () => {
    const database = await setup();
    const { matterId, matterNumber } = await createMatter(
      database,
      { ...baseInput, status: "prospective" },
      options,
    );
    expect(matterNumber).toBeNull();
    const row = await readMatter(database, matterId);
    expect(row).toMatchObject({ status: "prospective", matter_number: null, opened_at: null });
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
  it("draws the number at open, not at creation, for a prospective", async () => {
    const database = await setup();
    const { matterId } = await createMatter(
      database,
      { ...baseInput, status: "prospective" },
      options,
    );
    expect((await readMatter(database, matterId))?.matter_number).toBeNull();
    const { matterNumber } = await openMatter(database, matterId, {}, options);
    expect(matterNumber).toBe("2026-0001");
    expect(await readMatter(database, matterId)).toMatchObject({
      status: "open",
      matter_number: "2026-0001",
    });
  });

  it("refuses to open a matter that is not prospective", async () => {
    const database = await setup();
    const { matterId } = await createMatter(database, { ...baseInput, status: "open" }, options);
    await expect(openMatter(database, matterId, {}, options)).rejects.toMatchObject({
      code: "matter-not-prospective",
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
      { ...baseInput, status: "prospective" },
      options,
    );
    // The winner opens the same matter while the racing call is mid-flight, after it has already
    // read the matter as prospective and drawn its own number.
    let winner = "";
    const racing = interleaveBeforeFirstCommit(database, async () => {
      winner = (await openMatter(database, matterId, {}, options)).matterNumber;
    });
    await expect(openMatter(racing, matterId, {}, options)).rejects.toMatchObject({
      code: "matter-not-prospective",
    });
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
      { ...baseInput, status: "prospective" },
      options,
    );
    const racing = interleaveBeforeFirstCommit(database, () =>
      closeMatter(database, matterId, options),
    );
    await expect(openMatter(racing, matterId, {}, options)).rejects.toMatchObject({
      code: "matter-not-prospective",
    });
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

  it("closes a prospective (declined consultation) and reopens it to prospective", async () => {
    const database = await setup();
    const { matterId } = await createMatter(
      database,
      { ...baseInput, status: "prospective" },
      options,
    );
    await closeMatter(database, matterId, options);
    expect((await readMatter(database, matterId))?.status).toBe("closed");
    await reopenMatter(database, matterId, options);
    expect(await readMatter(database, matterId)).toMatchObject({
      status: "prospective",
      matter_number: null,
    });
  });

  it("reopens a manually-numbered consultation to prospective, not open", async () => {
    const database = await setup();
    // A consultation given a manual number never sets opened_at, so it was never opened.
    const { matterId } = await createMatter(
      database,
      { ...baseInput, status: "prospective" },
      options,
    );
    await renumberMatter(database, matterId, "LEGACY-7", options);
    expect(await readMatter(database, matterId)).toMatchObject({
      status: "prospective",
      matter_number: "LEGACY-7",
      opened_at: null,
    });
    await closeMatter(database, matterId, options);
    await reopenMatter(database, matterId, options);
    // Restored from opened_at (null), not inferred from the present number — stays prospective.
    expect(await readMatter(database, matterId)).toMatchObject({
      status: "prospective",
      matter_number: "LEGACY-7",
      closed_at: null,
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
    const racing = interleaveBeforeFirstCommit(database, () =>
      closeMatter(database, matterId, options),
    );
    await closeMatter(racing, matterId, { ...options, clock: laterClock });
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
  it("assigns a manual number to a prospective without drawing a counter", async () => {
    const database = await setup();
    const { matterId } = await createMatter(
      database,
      { ...baseInput, status: "prospective" },
      options,
    );
    await renumberMatter(database, matterId, "LEGACY-7", options);
    expect((await readMatter(database, matterId))?.matter_number).toBe("LEGACY-7");
    // The counter was never touched — the next drawn matter still starts at 0001.
    const next = await createMatter(database, { ...baseInput, status: "open" }, options);
    expect(next.matterNumber).toBe("2026-0001");
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
    const { matterId } = await createMatter(
      database,
      { ...baseInput, status: "prospective" },
      options,
    );
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
    // Park a manual number equal to the counter's SECOND draw.
    const parked = await createMatter(database, { ...baseInput, status: "prospective" }, options);
    await renumberMatter(database, parked.matterId, "2026-0002", options);
    // First draw takes 0001; the second draw renders 0002, collides, and retries to 0003.
    const first = await createMatter(database, { ...baseInput, status: "open" }, options);
    const second = await createMatter(database, { ...baseInput, status: "open" }, options);
    expect(first.matterNumber).toBe("2026-0001");
    expect(second.matterNumber).toBe("2026-0003");
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
  // matter is no longer prospective precisely BECAUSE this key's open succeeded, so the retry replays
  // the number it drew rather than reporting that the matter cannot be opened.
  it("replays a retried open — the number it drew, not a refusal", async () => {
    const database = await setup();
    const { matterId } = await createMatter(
      database,
      { ...baseInput, status: "prospective" },
      options,
    );
    const first = await openMatter(database, matterId, {}, withKey("open-1"));
    expect(first.idempotentReplay).toBe(false);
    expect(first.matterNumber).toBe("2026-0001");

    const replay = await openMatter(database, matterId, {}, withKey("open-1"));
    expect(replay.idempotentReplay).toBe(true);
    expect(replay.matterNumber).toBe("2026-0001");

    // The replay drew nothing: the next genuinely new open takes the following number.
    const other = await createMatter(database, { ...baseInput, status: "prospective" }, options);
    const next = await openMatter(database, other.matterId, {}, withKey("open-2"));
    expect(next.matterNumber).toBe("2026-0002");
  });

  // A genuinely new open of an already-open matter still carries its own key, so it is still refused.
  it("still refuses a second open under a different key", async () => {
    const database = await setup();
    const { matterId } = await createMatter(
      database,
      { ...baseInput, status: "prospective" },
      options,
    );
    await openMatter(database, matterId, {}, withKey("open-1"));
    await expect(openMatter(database, matterId, {}, withKey("open-2"))).rejects.toMatchObject({
      code: "matter-not-prospective",
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
