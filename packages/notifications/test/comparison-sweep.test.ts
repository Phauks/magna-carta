import { beforeEach, describe, expect, it } from "vitest";
import { createMigratedNodeDatabase } from "@magna-carta/database/node-sqlite";
import { sweepFirmComparisonNotifications } from "../src/sweep.ts";

// The comparison-driven path, against the committed per-firm migrations rather than a fake: real
// deadline rows in, real notification rows out, read back with plain SQL so the assertions are about
// what is stored and not about what the code returned.

type Database = ReturnType<typeof createMigratedNodeDatabase>["database"];

// A fixed zone with no daylight saving, so a test that runs in March asserts the same thing as a
// test that runs in July. The deadline arithmetic under test is zone-sensitive by design and the
// fixture must not be.
const COURT_ZONE = "America/Phoenix"; // UTC-07:00 all year

// 09:00 in Phoenix on the 20th.
const DAY_ONE = "2026-08-20T16:00:00.000Z";
// 09:00 in Phoenix on the 21st — a different civil day in the deadline's own zone.
const DAY_TWO = "2026-08-21T16:00:00.000Z";
// 20:00 in Phoenix on the 20th: later in the day, SAME civil day.
const DAY_ONE_LATER = "2026-08-21T03:00:00.000Z";

const RESPONSIBLE = "user_responsible00000";
const ASSIGNED = "user_assigned0000000";
const DEPARTED = "user_departed0000000";
const UNRELATED = "user_unrelated000000";

const MATTER = "matter_visible000000";
const OVERDUE_DEADLINE = "matterDeadline_over00";
const DUE_TODAY_DEADLINE = "matterDeadline_today0";

async function seedFirm(database: Database): Promise<void> {
  for (const [userId, status] of [
    [RESPONSIBLE, "active"],
    [ASSIGNED, "active"],
    [DEPARTED, "deactivated"],
    [UNRELATED, "active"],
  ] as const) {
    await database
      .prepare(
        "INSERT INTO member (user_id, display_name, status, opted_out_of_usage_analytics, created_at) VALUES (?1, ?2, ?3, 0, ?4)",
      )
      .bind(userId, `Member ${userId}`, status, DAY_ONE)
      .run();
  }
  await database
    .prepare(
      "INSERT INTO matter (id, title, status, responsible_member_id, e_billing, created_at, updated_at) VALUES (?1, ?2, 'open', ?3, 0, ?4, ?4)",
    )
    .bind(MATTER, "Visible Matter", RESPONSIBLE, DAY_ONE)
    .run();
  // A currently-valid assignment and a member who has left. The pair is the whole point of asserting
  // WHO a deadline reaches: an audience that resolved to the responsible member alone would pass a
  // count-of-one assertion forever, and three notification kinds shipped that way once.
  await database
    .prepare(
      "INSERT INTO matter_assignment (id, matter_id, member_user_id, assignment_role, valid_from, valid_to, created_at, updated_at) VALUES (?1, ?2, ?3, 'assigned_paralegal', '2026-01-01', NULL, ?4, ?4)",
    )
    .bind("matterAssignment_a000", MATTER, ASSIGNED, DAY_ONE)
    .run();
  await database
    .prepare(
      "INSERT INTO matter_assignment (id, matter_id, member_user_id, assignment_role, valid_from, valid_to, created_at, updated_at) VALUES (?1, ?2, ?3, 'associate', '2026-01-01', NULL, ?4, ?4)",
    )
    .bind("matterAssignment_b000", MATTER, DEPARTED, DAY_ONE)
    .run();
}

async function insertDeadline(
  database: Database,
  options: { readonly id: string; readonly dueOn: string; readonly dueAtTime: string | null },
): Promise<void> {
  await database
    .prepare(
      "INSERT INTO matter_deadline (id, matter_id, title, due_on, due_at_time, time_zone, source, state, recorded_at, created_at, updated_at) " +
        "VALUES (?1, ?2, ?3, ?4, ?5, ?6, 'member', 'open', ?7, ?7, ?7)",
    )
    .bind(
      options.id,
      MATTER,
      "Response to motion",
      options.dueOn,
      options.dueAtTime,
      COURT_ZONE,
      DAY_ONE,
    )
    .run();
}

async function eventRows(
  database: Database,
): Promise<{ id: string; kind: string; subject_id: string; dedupe_key: string }[]> {
  // Ordered explicitly. An unordered read with a LIMIT is how a passing test becomes an
  // intermittently-failing one; there is no LIMIT here, but the assertions compare sequences.
  const { results } = await database
    .prepare(
      "SELECT id, kind, subject_id, dedupe_key FROM notification_event ORDER BY dedupe_key, id",
    )
    .all<{ id: string; kind: string; subject_id: string; dedupe_key: string }>();
  return results;
}

async function recipientsOf(database: Database, eventId: string): Promise<string[]> {
  const { results } = await database
    .prepare(
      "SELECT recipient_user_id FROM notification_recipient WHERE notification_event_id = ?1 ORDER BY recipient_user_id",
    )
    .bind(eventId)
    .all<{ recipient_user_id: string }>();
  return results.map((row) => row.recipient_user_id);
}

describe("the comparison sweep", () => {
  let database: Database;
  beforeEach(async () => {
    database = createMigratedNodeDatabase("per-firm").database;
    await seedFirm(database);
  });

  it("raises one overdue notification however many times it runs in one civil day", async () => {
    // Two days past, no recorded time: overdue by the calendar's own comparison, and continuously so.
    await insertDeadline(database, {
      id: OVERDUE_DEADLINE,
      dueOn: "2026-08-18",
      dueAtTime: null,
    });

    const first = await sweepFirmComparisonNotifications({ database, now: DAY_ONE });
    const second = await sweepFirmComparisonNotifications({ database, now: DAY_ONE_LATER });

    expect(first.findings).toBe(1);
    // The second pass finds the same thing — the comparison has not stopped being true — and writes
    // nothing, because the dedupe key is the same. That is the property, not "the sweep skips work".
    expect(second.findings).toBe(1);

    const events = await eventRows(database);
    expect(events).toHaveLength(1);
    expect(events[0]?.kind).toBe("deadlines.deadline.overdue");
    expect(events[0]?.subject_id).toBe(OVERDUE_DEADLINE);
    expect(events[0]?.dedupe_key).toBe(`deadlines.deadline.overdue:${OVERDUE_DEADLINE}:2026-08-20`);
  });

  it("raises it again on the next civil day, in the deadline's own zone", async () => {
    await insertDeadline(database, {
      id: OVERDUE_DEADLINE,
      dueOn: "2026-08-18",
      dueAtTime: null,
    });

    await sweepFirmComparisonNotifications({ database, now: DAY_ONE });
    await sweepFirmComparisonNotifications({ database, now: DAY_TWO });

    const events = await eventRows(database);
    expect(events.map((row) => row.dedupe_key)).toEqual([
      `deadlines.deadline.overdue:${OVERDUE_DEADLINE}:2026-08-20`,
      `deadlines.deadline.overdue:${OVERDUE_DEADLINE}:2026-08-21`,
    ]);
  });

  it("reaches the whole team, not only the responsible member", async () => {
    await insertDeadline(database, {
      id: OVERDUE_DEADLINE,
      dueOn: "2026-08-18",
      dueAtTime: null,
    });
    await sweepFirmComparisonNotifications({ database, now: DAY_ONE });

    const events = await eventRows(database);
    const eventId = events[0]?.id ?? "";
    // The assertion that would have caught the audience narrowing three kinds shipped with: the
    // count, not merely "somebody was notified".
    const recipients = await recipientsOf(database, eventId);
    expect(recipients).toEqual([ASSIGNED, RESPONSIBLE].sort());
    expect(recipients).not.toContain(DEPARTED);
    expect(recipients).not.toContain(UNRELATED);
  });

  it("tells due-today from overdue, and reports each deadline once", async () => {
    // Due later today in Phoenix: at 09:00 local, a 17:00 deadline has not passed.
    await insertDeadline(database, {
      id: DUE_TODAY_DEADLINE,
      dueOn: "2026-08-20",
      dueAtTime: "17:00",
    });
    await insertDeadline(database, {
      id: OVERDUE_DEADLINE,
      dueOn: "2026-08-18",
      dueAtTime: null,
    });

    await sweepFirmComparisonNotifications({ database, now: DAY_ONE });

    const events = await eventRows(database);
    expect(
      events
        .map((row) => `${row.kind}|${row.subject_id}`)
        .sort((left, right) => left.localeCompare(right)),
    ).toEqual([
      `deadlines.deadline.due|${DUE_TODAY_DEADLINE}`,
      `deadlines.deadline.overdue|${OVERDUE_DEADLINE}`,
    ]);
  });

  it("reports a deadline whose hour has passed as overdue only, never as both", async () => {
    // Due at 08:00 Phoenix, swept at 09:00 Phoenix: today's date, and already past.
    await insertDeadline(database, {
      id: DUE_TODAY_DEADLINE,
      dueOn: "2026-08-20",
      dueAtTime: "08:00",
    });

    await sweepFirmComparisonNotifications({ database, now: DAY_ONE });

    const events = await eventRows(database);
    expect(events).toHaveLength(1);
    expect(events[0]?.kind).toBe("deadlines.deadline.overdue");
  });

  it("leaves a satisfied deadline alone", async () => {
    await insertDeadline(database, {
      id: OVERDUE_DEADLINE,
      dueOn: "2026-08-18",
      dueAtTime: null,
    });
    await database
      .prepare(
        "UPDATE matter_deadline SET state = 'satisfied', satisfied_at = ?2, satisfied_by = ?3 WHERE id = ?1",
      )
      .bind(OVERDUE_DEADLINE, DAY_ONE, RESPONSIBLE)
      .run();

    const result = await sweepFirmComparisonNotifications({ database, now: DAY_ONE });

    expect(result.findings).toBe(0);
    expect(await eventRows(database)).toHaveLength(0);
  });

  it("never touches the deadline it reported on", async () => {
    await insertDeadline(database, {
      id: OVERDUE_DEADLINE,
      dueOn: "2026-08-18",
      dueAtTime: null,
    });
    const { results: before } = await database
      .prepare("SELECT * FROM matter_deadline WHERE id = ?1")
      .bind(OVERDUE_DEADLINE)
      .all();

    await sweepFirmComparisonNotifications({ database, now: DAY_ONE });

    const { results: after } = await database
      .prepare("SELECT * FROM matter_deadline WHERE id = ?1")
      .bind(OVERDUE_DEADLINE)
      .all();
    // Nothing writes "missed". The source row is byte-identical after the pass that reported on it.
    expect(after).toEqual(before);
  });

  it("reports what it did per emission point, so a kind that stops producing is visible", async () => {
    await insertDeadline(database, {
      id: OVERDUE_DEADLINE,
      dueOn: "2026-08-18",
      dueAtTime: null,
    });

    const result = await sweepFirmComparisonNotifications({ database, now: DAY_ONE });

    const overdue = result.byEmissionPoint.get("calendar.deadline.overdue");
    expect(overdue?.materializedEvents).toBe(1);
    expect(overdue?.recipientRows).toBe(2);
    expect(overdue?.clampedFindings).toBe(0);
  });
});
