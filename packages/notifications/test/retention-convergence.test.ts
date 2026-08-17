import { describe, expect, it } from "vitest";
import {
  createMigratedNodeDatabase,
  type NodeSqlStatement,
} from "@magna-carta/database/node-sqlite";
import type { SqlStatement } from "@magna-carta/data-access/idempotency-statements";
import {
  CALENDAR_DEADLINE_DUE_EMISSION_POINT,
  CALENDAR_DEADLINE_OVERDUE_EMISSION_POINT,
} from "@magna-carta/calendar/notifications";
import { CONVERGENCE_HORIZON_BY_RAISER } from "../src/materialize.ts";
import { NOTIFICATION_TYPES } from "../src/registry.ts";
import { retentionCutoff, retentionSweepDeleteStatements } from "../src/retention.ts";
import { sweepFirmComparisonNotifications } from "../src/sweep.ts";
import { MIN_RETENTION_DAYS } from "../src/types.ts";

// WHAT THE DEDUPE KEY GUARANTEES ONCE THE RETENTION SWEEP HAS RUN.
//
// The UNIQUE index that makes a duplicate raise a no-op lives on `notification_event.dedupe_key` — a
// column on a row the nightly retention sweep deletes. So "raise once" is bounded by the firm's
// retention window and is not a permanent record that a subject was ever notified about. That reading
// is easy to get backwards, and getting it backwards is a real defect shape: a condition that must
// fire once per subject forever, resting only on this key, silently fires again once the row ages out.
//
// These tests do three things, in order of what they protect:
//
//   1. They state the actual semantics OUT LOUD, by re-inserting a key the sweep took and watching it
//      succeed. A test that pretended otherwise would be the documentation defect in test form.
//   2. They prove the property that makes the boundary SAFE on the comparison path — the only path
//      whose condition is continuously true, and therefore the only one that could plausibly
//      re-present a swept key. Its bucket is a pure function of the pass's own instant, so a bucket
//      cannot regress, so a swept key is unreachable rather than merely unlikely.
//   3. They hold every production path to having DECLARED how long its key must hold.

describe("the dedupe key's guarantee and the retention window", () => {
  it("declares a convergence horizon for every production path a registered type uses", () => {
    // Exhaustiveness over the union is already a compile-time property of the table's
    // `Record<NotificationRaisedBy, ...>` type. What this adds is the runtime half: every path a type
    // ACTUALLY declares resolves to a horizon, so a raiser introduced without confronting how long
    // its key has to hold cannot reach the registry through a widened union.
    const pathsInUse = new Set(NOTIFICATION_TYPES.map((type) => type.raisedBy));
    expect(pathsInUse.size).toBeGreaterThan(0);
    for (const path of pathsInUse) {
      expect(CONVERGENCE_HORIZON_BY_RAISER[path]).toBeTruthy();
    }
  });

  it("keeps every declared horizon shorter than the shortest retention window a firm may set", () => {
    // Not an arithmetic check — the horizons are qualitative — but a check that the set of horizons is
    // exactly the three that were reasoned about against the thirty-day floor. A fourth horizon added
    // here has to be argued against that floor, which is the review this assertion exists to force.
    expect(MIN_RETENTION_DAYS).toBe(30);
    expect(new Set(Object.values(CONVERGENCE_HORIZON_BY_RAISER))).toEqual(
      new Set(["outbox-row-dispatch", "civil-day", "job-terminal-outcome"]),
    );
  });
});

// A fixed zone with no daylight saving, so the civil dates below are the same in March and in July.
const COURT_ZONE = "America/Phoenix"; // UTC-07:00 all year
// 09:00 in Phoenix on the 20th and on the 21st: two different civil days in the deadline's own zone.
const DAY_ONE = "2026-08-20T16:00:00.000Z";
const DAY_TWO = "2026-08-21T16:00:00.000Z";
const DAY_ONE_CIVIL = "2026-08-20";
const DAY_TWO_CIVIL = "2026-08-21";

const RESPONSIBLE = "user_responsible00000";
const MATTER = "matter_visible000000";
const OVERDUE_DEADLINE = "matterDeadline_over00";

type Database = ReturnType<typeof createMigratedNodeDatabase>["database"];

// The statement builders type their return as the narrower D1-shaped SqlStatement; this database's
// batch() takes the node-sqlite shape the same objects actually have at runtime. Same narrowing as
// test/delivery-end-to-end.test.ts.
function capturedStatement(statement: SqlStatement): NodeSqlStatement {
  return statement as NodeSqlStatement;
}

async function seedOverdueDeadline(database: Database, timeZone = COURT_ZONE): Promise<void> {
  await database
    .prepare(
      "INSERT INTO member (user_id, display_name, status, opted_out_of_usage_analytics, created_at) VALUES (?1, 'Responsible', 'active', 0, ?2)",
    )
    .bind(RESPONSIBLE, DAY_ONE)
    .run();
  await database
    .prepare(
      "INSERT INTO matter (id, title, status, responsible_member_id, e_billing, created_at, updated_at) VALUES (?1, 'Visible Matter', 'open', ?2, 0, ?3, ?3)",
    )
    .bind(MATTER, RESPONSIBLE, DAY_ONE)
    .run();
  await database
    .prepare(
      "INSERT INTO matter_deadline (id, matter_id, title, due_on, due_at_time, time_zone, source, state, recorded_at, created_at, updated_at) " +
        "VALUES (?1, ?2, 'Response to motion', '2026-08-18', NULL, ?3, 'member', 'open', ?4, ?4, ?4)",
    )
    .bind(OVERDUE_DEADLINE, MATTER, timeZone, DAY_ONE)
    .run();
}

async function dedupeKeys(database: Database): Promise<string[]> {
  const { results } = await database
    .prepare("SELECT dedupe_key FROM notification_event ORDER BY dedupe_key")
    .all<{ dedupe_key: string }>();
  return results.map((row) => row.dedupe_key);
}

// Delete everything the sweep would take at `now` for the given window, exactly as the nightly pass
// composes it.
async function runRetentionSweep(
  database: Database,
  now: string,
  retentionDays: number,
): Promise<void> {
  const cutoff = retentionCutoff(now, retentionDays);
  await database.batch(retentionSweepDeleteStatements(database, cutoff).map(capturedStatement));
}

describe("a swept dedupe key", () => {
  it("stops constraining anything, which is the semantics and not a defect", async () => {
    const database = createMigratedNodeDatabase("per-firm").database;
    await seedOverdueDeadline(database);

    await sweepFirmComparisonNotifications({ database, now: DAY_ONE });
    const raised = await dedupeKeys(database);
    expect(raised).toEqual([`deadlines.deadline.overdue:${OVERDUE_DEADLINE}:${DAY_ONE_CIVIL}`]);

    // A pass on the SAME civil day writes nothing: the key is still there and the UNIQUE index
    // refuses the duplicate. This is the guarantee, and it holds only while the row does.
    await sweepFirmComparisonNotifications({ database, now: DAY_ONE });
    expect(await dedupeKeys(database)).toEqual(raised);

    // Now age the row out. A window well past the event's own instant takes it.
    await runRetentionSweep(database, "2026-12-01T00:00:00.000Z", MIN_RETENTION_DAYS);
    expect(await dedupeKeys(database)).toEqual([]);

    // And the same key inserts cleanly, because the index that refused it is gone with the row. Said
    // plainly here so nobody reads the UNIQUE index as a permanent record of having notified: a
    // condition needing once-per-subject-FOREVER convergence must carry it in the owning subsystem's
    // own tables, the way billing's reminder rows do, and point a notification at that record.
    await database
      .prepare(
        "INSERT INTO notification_event (id, kind, category, severity, subject_kind, subject_id, matter_id, occurred_at, facts, dedupe_key, created_at) " +
          "VALUES ('notificationEvent_r0', 'deadlines.deadline.overdue', 'deadlines', 'attention', 'matterDeadline', ?1, ?2, ?3, NULL, ?4, ?3)",
      )
      .bind(OVERDUE_DEADLINE, MATTER, DAY_TWO, raised[0])
      .run();
    expect(await dedupeKeys(database)).toEqual(raised);
  });

  it("is unreachable on the comparison path, because the bucket follows the pass's own clock", async () => {
    const database = createMigratedNodeDatabase("per-firm").database;
    await seedOverdueDeadline(database);

    // Day one raises, then ages out entirely — the state a firm is in after a long enough window.
    await sweepFirmComparisonNotifications({ database, now: DAY_ONE });
    await runRetentionSweep(database, "2026-12-01T00:00:00.000Z", MIN_RETENTION_DAYS);
    expect(await dedupeKeys(database)).toEqual([]);

    // A later pass finds the same still-overdue deadline and raises it under the LATER civil date. It
    // does not resurrect day one's key, and it could not: the bucket is derived from the instant the
    // pass was handed, never from anything stored, so the date a pass can produce moves only as the
    // clock does. That is what makes deleting a past bucket's row safe rather than lucky — and it is
    // also why the guarantee here is once per subject per civil day and never once per subject.
    await sweepFirmComparisonNotifications({ database, now: DAY_TWO });
    expect(await dedupeKeys(database)).toEqual([
      `deadlines.deadline.overdue:${OVERDUE_DEADLINE}:${DAY_TWO_CIVIL}`,
    ]);
  });
});

// Enough distinct zones to overrun the per-kind cap the zone read is bounded by. Taken from the
// runtime's own list so every one of them is a zone `overdueCutoffFor` can actually resolve.
function distinctZones(count: number): string[] {
  const supported = Intl.supportedValuesOf("timeZone");
  expect(supported.length).toBeGreaterThanOrEqual(count);
  return supported.slice(0, count);
}

describe("the comparison sweep's zone discovery", () => {
  // The deadline comparison needs one cutoff per zone, because no D1 query can resolve a zone. So it
  // first reads the distinct zones in play — and that read is bounded like every other. A zone the
  // read never returns contributes no cutoff, and every deadline in it then matches neither the
  // overdue bound nor the due-today window: the pass reports nothing about a whole jurisdiction. That
  // is the one way this pass can stop finding things without the findings clamp moving, so it is
  // detected and reported on its own counter.
  async function seedManyZones(database: Database, zones: readonly string[]): Promise<void> {
    await database
      .prepare(
        "INSERT INTO member (user_id, display_name, status, opted_out_of_usage_analytics, created_at) VALUES (?1, 'Responsible', 'active', 0, ?2)",
      )
      .bind(RESPONSIBLE, DAY_ONE)
      .run();
    await database
      .prepare(
        "INSERT INTO matter (id, title, status, responsible_member_id, e_billing, created_at, updated_at) VALUES (?1, 'Visible Matter', 'open', ?2, 0, ?3, ?3)",
      )
      .bind(MATTER, RESPONSIBLE, DAY_ONE)
      .run();
    for (const [index, zone] of zones.entries()) {
      await database
        .prepare(
          "INSERT INTO matter_deadline (id, matter_id, title, due_on, due_at_time, time_zone, source, state, recorded_at, created_at, updated_at) " +
            "VALUES (?1, ?2, 'Response to motion', '2026-08-18', NULL, ?3, 'member', 'open', ?4, ?4, ?4)",
        )
        .bind(`matterDeadline_${String(index).padStart(6, "0")}`, MATTER, zone, DAY_ONE)
        .run();
    }
  }

  it("reports the truncation on both deadline kinds, apart from the findings clamp", async () => {
    const database = createMigratedNodeDatabase("per-firm").database;
    // One more zone than the read can carry.
    await seedManyZones(database, distinctZones(201));

    const result = await sweepFirmComparisonNotifications({ database, now: DAY_ONE });

    for (const point of [
      CALENDAR_DEADLINE_OVERDUE_EMISSION_POINT,
      CALENDAR_DEADLINE_DUE_EMISSION_POINT,
    ]) {
      // One truncated PASS, counted once per kind whose coverage it puts in question. Not a count of
      // zones missed: a read that over-reads by one to catch its own truncation learns that it
      // truncated and cannot learn by how much, and a magnitude invented here would be exactly the
      // dishonesty the counter exists to prevent.
      expect(result.byEmissionPoint.get(point)?.truncatedZoneDiscovery).toBe(1);
    }
  });

  it("says so even when no zone resolved and the pass found nothing at all", async () => {
    const database = createMigratedNodeDatabase("per-firm").database;
    // Zones the runtime cannot resolve: every cutoff is dropped, so the pass returns early with zero
    // findings. "I found nothing" and "I could not finish looking" are different statements and only
    // the second is true here — this is the exact shape of a check that would otherwise read as
    // coverage.
    await seedManyZones(
      database,
      Array.from({ length: 201 }, (_unused, index) => `Nowhere/Zone_${String(index)}`),
    );

    const result = await sweepFirmComparisonNotifications({ database, now: DAY_ONE });

    expect(result.findings).toBe(0);
    for (const point of [
      CALENDAR_DEADLINE_OVERDUE_EMISSION_POINT,
      CALENDAR_DEADLINE_DUE_EMISSION_POINT,
    ]) {
      expect(result.byEmissionPoint.get(point)?.truncatedZoneDiscovery).toBe(1);
    }
  });

  it("stays silent when the zone list fits, so the counter means something when it fires", async () => {
    const database = createMigratedNodeDatabase("per-firm").database;
    await seedOverdueDeadline(database);

    const result = await sweepFirmComparisonNotifications({ database, now: DAY_ONE });

    expect(result.findings).toBe(1);
    expect(
      result.byEmissionPoint.get(CALENDAR_DEADLINE_OVERDUE_EMISSION_POINT)?.truncatedZoneDiscovery,
    ).toBe(0);
  });
});
