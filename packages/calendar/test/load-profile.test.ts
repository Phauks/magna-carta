import { civilDateOf } from "@magna-carta/civil-time/civil-date";
import { beforeAll, describe, expect, it } from "vitest";
import type { SqlDatabase, SqlStatement } from "@magna-carta/data-access/idempotency-statements";
import type { FirmResourceId, MatterEventId } from "@magna-carta/identifiers/types";
import { findBookingConflicts, readResourceAvailability } from "../src/booking-service.ts";
import { continueMatterEvent, readContinuanceChain } from "../src/continuance-service.ts";
import { readTimelinePage } from "../src/timeline.ts";
import { timelineSourceRegistry } from "../src/sources/all.ts";
import type { TimelineCursor } from "../src/sources/registry.ts";
import { visibleMatterPredicate } from "../src/visibility.ts";
import {
  ACTOR,
  MATTER,
  commit,
  migratedDatabase,
  options,
  seedMatters,
  seedOffices,
} from "./support.ts";

// The load-profile assertions for the calendar's second slice, over the corpus the design names: a
// year of weekly firm meetings entered as individual rows plus firm-wide entries, eight resources
// across two offices, bookings with a deliberate overlap fraction, and one hearing continued four
// times with deadlines hanging off intermediate settings.
//
// Assertions, not reports — and BOUNDS, not wall-clock numbers: statement counts and rows read, per
// the shipped measurement idiom. The read cost must scale with the REGISTRY and the requested
// window, never with the firm's data.

// A counting wrapper over the SqlDatabase seam, so a measurement asserts what a read DID rather
// than inferring it. Counts executions (all/run/first), not preparations.
function countingDatabase(inner: SqlDatabase): { database: SqlDatabase; executed: () => number } {
  let executed = 0;
  function wrap(statement: SqlStatement): SqlStatement {
    return {
      get sql() {
        return statement.sql;
      },
      bind: (...values: unknown[]) => wrap(statement.bind(...values)),
      run: async () => {
        executed += 1;
        return statement.run();
      },
      all: async <T>() => {
        executed += 1;
        return statement.all<T>();
      },
      first: async <T>() => {
        executed += 1;
        return statement.first<T>();
      },
    };
  }
  return {
    database: { prepare: (sql: string) => wrap(inner.prepare(sql)) },
    executed: () => executed,
  };
}

const context = migratedDatabase();
const { database, raw } = context;
const at = "2026-01-05T10:00:00.000Z";
const ROOM_A = "firmResource_roomA000000000000000" as FirmResourceId;
let chainIds: MatterEventId[] = [];

beforeAll(async () => {
  seedMatters(raw);
  seedOffices(raw);

  // A year of weekly firm meetings, entered as individual rows (recurrence is a named seam), plus
  // a handful of all-members entries.
  const weekOne = Date.parse("2026-01-05T00:00:00.000Z");
  for (let week = 0; week < 52; week += 1) {
    const startsOn = civilDateOf(new Date(weekOne + week * 7 * 86_400_000));
    raw.exec(
      `INSERT INTO firm_event (id, title, status, starts_on, starts_at_time, time_zone, audience, recorded_at, created_at, updated_at)
         VALUES ('firmEvent_weekly${String(week).padStart(17, "0")}', 'Weekly staff meeting', 'scheduled', '${startsOn}', '09:00', 'America/Los_Angeles', 'participants', '${at}', '${at}', '${at}')`,
    );
  }
  for (let holiday = 0; holiday < 6; holiday += 1) {
    raw.exec(
      `INSERT INTO firm_event (id, title, status, starts_on, time_zone, audience, recorded_at, created_at, updated_at)
         VALUES ('firmEvent_holiday${String(holiday).padStart(16, "0")}', 'Firm holiday', 'scheduled', '2026-0${holiday + 3}-01', 'America/Los_Angeles', 'all_members', '${at}', '${at}', '${at}')`,
    );
  }

  // Eight resources across the two offices.
  for (let index = 0; index < 8; index += 1) {
    const office = index < 4 ? "location_calendarReno0" : "location_calendarAustin";
    const id = index === 0 ? ROOM_A : `firmResource_generated${String(index).padStart(11, "0")}`;
    raw.exec(
      `INSERT INTO firm_resource (id, name, kind, location_id, capacity, active, created_at, updated_at)
         VALUES ('${id}', 'Resource ${index}', '${index % 2 === 0 ? "room" : "vehicle"}', '${office}', 8, 1, '${at}', '${at}')`,
    );
  }

  // Bookings on Room A across the spring, every third one deliberately overlapping the one before.
  for (let index = 0; index < 30; index += 1) {
    const day = new Date(Date.parse("2026-03-02T00:00:00.000Z") + index * 3 * 86_400_000)
      .toISOString()
      .slice(0, 10);
    const eventId = `matterEvent_booked${String(index).padStart(15, "0")}`;
    raw.exec(
      `INSERT INTO matter_event (id, matter_id, title, status, starts_on, starts_at_time, ends_at_time, time_zone, recorded_at, created_at, updated_at)
         VALUES ('${eventId}', '${MATTER}', 'Deposition ${index}', 'scheduled', '${day}', '09:00', '12:00', 'America/Los_Angeles', '${at}', '${at}', '${at}')`,
    );
    const overlapping = index % 3 === 2;
    raw.exec(
      `INSERT INTO firm_resource_booking (id, resource_id, matter_event_id, starts_on, starts_at_time, ends_at_time, time_zone, recorded_at, created_at, updated_at)
         VALUES ('firmResourceBooking_${String(index).padStart(13, "0")}', '${ROOM_A}', '${eventId}', '${overlapping ? civilDateOf(new Date(Date.parse(`${day}T00:00:00.000Z`) - 3 * 86_400_000)) : day}', '${overlapping ? "10:00" : "08:30"}', '${overlapping ? "11:00" : "12:00"}', 'America/Los_Angeles', '${at}', '${at}', '${at}')`,
    );
  }

  // One hearing continued four times: a five-node chain, with open deadlines hanging off
  // intermediate settings.
  const first = raw;
  first.exec(
    `INSERT INTO matter_event (id, matter_id, title, status, starts_on, starts_at_time, time_zone, recorded_at, created_at, updated_at)
       VALUES ('matterEvent_chainRoot000000000000', '${MATTER}', 'Hearing on the merits', 'scheduled', '2026-04-06', '09:00', 'America/Los_Angeles', '${at}', '${at}', '${at}')`,
  );
  chainIds = ["matterEvent_chainRoot000000000000" as MatterEventId];
  for (let hop = 1; hop <= 4; hop += 1) {
    const continued = await continueMatterEvent(
      database,
      chainIds[hop - 1] as MatterEventId,
      { startsOn: `2026-0${4 + hop}-06`, statusReason: `Continued (${hop})` },
      options,
    );
    await commit(database, continued.effect);
    chainIds.push(continued.newEventId);
    raw.exec(
      `INSERT INTO matter_deadline (id, matter_id, title, due_on, time_zone, source, state, trigger_event_id, recorded_at, created_at, updated_at)
         VALUES ('matterDeadline_chain${String(hop).padStart(13, "0")}', '${MATTER}', 'Brief due', '2026-0${4 + hop}-01', 'America/Los_Angeles', 'member', 'open', '${chainIds[hop - 1]}', '${at}', '${at}', '${at}')`,
    );
  }
});

function pageOptions(counting: SqlDatabase, cursor?: TimelineCursor, memberUserId?: string) {
  return {
    database: counting,
    registry: timelineSourceRegistry(),
    visibility: visibleMatterPredicate(),
    scope: { fromDate: "2026-01-01", toDate: "2026-12-31", memberUserId },
    cursor,
    pageSize: 50,
  };
}

describe("the five load-profile assertions", () => {
  it("1 — the firm calendar page issues exactly the selected sources' statements, within the rows-read bound, and page 20 costs what page 1 costs", async () => {
    const counted = countingDatabase(database);
    const pageOne = await readTimelinePage(pageOptions(counted.database));
    // Exactly the statements the selected registry builds — fifteen sources, one statement each,
    // except the review-due source's declared two. No hidden read rides along.
    const registry = timelineSourceRegistry();
    const expectedStatements = registry.all().length + 1;
    expect(pageOne.statementCount).toBe(expectedStatements);
    expect(counted.executed()).toBe(pageOne.statementCount);
    expect(pageOne.sourcesRead).toContain("firmEvent");
    expect(pageOne.rowsRead).toBeLessThanOrEqual(registry.all().length * 51 + 51);

    // Page 20 under the keyset cursor: the same statement count and the same per-page bound — a
    // deep page reads no more than the first one, which is what makes the walk affordable.
    let cursor = pageOne.nextCursor;
    let page = pageOne;
    for (let index = 1; index < 20 && cursor !== null; index += 1) {
      const decoded = JSON.parse(atob(cursor)) as { c: string; i: string };
      page = await readTimelinePage(pageOptions(database, { sortKey: decoded.c, id: decoded.i }));
      cursor = page.nextCursor;
    }
    expect(page.statementCount).toBe(expectedStatements);
    expect(page.rowsRead).toBeLessThanOrEqual(registry.all().length * 51 + 51);
  });

  it("2 — an availability read is one statement, rows bounded by one resource's window", async () => {
    const counted = countingDatabase(database);
    const availability = await readResourceAvailability(counted.database, {
      resourceId: ROOM_A,
      fromDate: "2026-03-01",
      toDate: "2026-05-31",
    });
    expect(counted.executed()).toBe(1);
    // The deliberate overlap fraction is visible, pre-paired, in the one response.
    expect(availability.length).toBeGreaterThan(0);
    expect(availability.some((entry) => entry.overlappingBookingIds.length > 0)).toBe(true);
    // Bounded by the window's bookings of ONE resource, not by the firm's data.
    const windowBookings = raw
      .prepare(
        "SELECT COUNT(*) AS n FROM firm_resource_booking WHERE resource_id = ? AND starts_on <= '2026-05-31' AND COALESCE(ends_on, starts_on) >= '2026-03-01'",
      )
      .get(ROOM_A) as { n: number };
    expect(availability.length).toBeLessThanOrEqual(windowBookings.n);
  });

  it("3 — an overlap check is one coarse statement plus in-memory comparison", async () => {
    const counted = countingDatabase(database);
    const conflicts = await findBookingConflicts(counted.database, {
      resourceId: ROOM_A,
      candidate: {
        starts_on: "2026-03-02",
        starts_at_time: "09:30",
        ends_on: null,
        ends_at_time: "10:30",
        time_zone: "America/Los_Angeles",
      },
    });
    expect(counted.executed()).toBe(1);
    expect(conflicts.length).toBeGreaterThan(0);
  });

  it("4 — the continuance operation is one effect batch, and the chain read is depth-bounded, not data-bounded", async () => {
    // One effect batch: the operation returns exactly one EffectWrite, committed atomically —
    // asserted by shape here and by the honest-history and concurrency suites for its content.
    const counted = countingDatabase(database);
    const middle = chainIds[2] as MatterEventId;
    const chain = await readContinuanceChain(counted.database, middle, options);
    const statementsForChain = counted.executed();
    expect(chain).toHaveLength(5);
    // The walk costs the chain's own length: one anchor read, one link lookup per hop plus the two
    // terminating misses, and one bulk node resolve.
    expect(statementsForChain).toBeLessThanOrEqual(2 * chain.length + 4);

    // And it does NOT scale with the firm's event count: five hundred more events change nothing.
    for (let index = 0; index < 500; index += 1) {
      raw.exec(
        `INSERT INTO matter_event (id, matter_id, title, status, starts_on, time_zone, recorded_at, created_at, updated_at)
           VALUES ('matterEvent_noise${String(index).padStart(16, "0")}', '${MATTER}', 'Noise ${index}', 'scheduled', '2026-06-01', 'America/Los_Angeles', '${at}', '${at}', '${at}')`,
      );
    }
    const recounted = countingDatabase(database);
    const again = await readContinuanceChain(recounted.database, middle, options);
    expect(again).toHaveLength(5);
    expect(recounted.executed()).toBe(statementsForChain);
  });

  it("5 — the member-filtered firm calendar composes its predicates in SQL, never as a post-filter", async () => {
    const counted = countingDatabase(database);
    const page = await readTimelinePage(pageOptions(counted.database, undefined, ACTOR));
    // The no-post-filter shape: every statement issued was a source statement (no hidden second
    // pass), and the rows the page returns were narrowed by the SQL itself — the firm-wide
    // all_members entries answer for every member without a participant row existing anywhere.
    expect(counted.executed()).toBe(page.statementCount);
    expect(page.rowsRead).toBeLessThanOrEqual(page.statementCount * 51);
    const firmEntries = page.entries.filter((entry) => entry.sourceKey === "firmEvent");
    expect(firmEntries.length).toBeGreaterThan(0);
    for (const entry of firmEntries) {
      const row = raw.prepare("SELECT audience FROM firm_event WHERE id = ?").get(entry.rowId) as {
        audience: string;
      };
      expect(row.audience).toBe("all_members");
    }
  });
});
