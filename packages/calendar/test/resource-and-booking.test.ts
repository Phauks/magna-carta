import { describe, expect, it } from "vitest";
import type { FirmResourceId } from "@magna-carta/identifiers/types";
import {
  bookingInterval,
  createFirmResourceBooking,
  deleteFirmResourceBooking,
  readResourceAvailability,
  updateFirmResourceBooking,
} from "../src/booking-service.ts";
import { createMatterEvent, cancelMatterEvent } from "../src/event-service.ts";
import { createFirmEvent } from "../src/firm-event-service.ts";
import { createFirmResource, updateFirmResource } from "../src/resource-service.ts";
import { continueMatterEvent } from "../src/continuance-service.ts";
import { CalendarValidationError } from "../src/validation.ts";
import {
  AUSTIN_OFFICE,
  MATTER,
  RENO_OFFICE,
  commit,
  migratedDatabase,
  options,
  seedMatters,
  seedOffices,
} from "./support.ts";

// Rooms and resources: the catalog, the derived-liveness rule, and the warn-and-allow posture. A
// booking blocks the room if and only if its event is live — no released flag, no second write —
// and a double-booking succeeds with the conflict visible on the write, on the grid, and on the
// booking, because the platform reports what it can see and does not referee rooms.

function seeded() {
  const context = migratedDatabase();
  seedMatters(context.raw);
  seedOffices(context.raw);
  return context;
}

async function seedRoom(
  database: ReturnType<typeof seeded>["database"],
  name = "Conference Room A",
  locationId: unknown = RENO_OFFICE,
): Promise<FirmResourceId> {
  const created = await createFirmResource(
    database,
    { name, kind: "room", locationId: locationId as never, capacity: 10 },
    options,
  );
  await commit(database, created.effect);
  return created.firmResourceId;
}

async function seedHearing(
  database: ReturnType<typeof seeded>["database"],
  overrides: Partial<Parameters<typeof createMatterEvent>[1]> = {},
) {
  const created = createMatterEvent(
    database,
    {
      matterId: MATTER,
      title: "Deposition of R. Malloy",
      startsOn: "2026-09-14",
      startsAtTime: "09:00",
      endsAtTime: "12:00",
      timeZone: "America/Los_Angeles",
      ...overrides,
    },
    options,
  );
  await commit(database, created.effect);
  return created.eventId;
}

describe("the resource catalog", () => {
  it("refuses a duplicate name with a named refusal, before the unique index aborts", async () => {
    const { database } = seeded();
    await seedRoom(database);
    await expect(
      createFirmResource(database, { name: "Conference Room A", kind: "room" }, options),
    ).rejects.toThrow(/already has a resource named/);
  });

  it("soft-deactivates: existing bookings keep resolving, new ones are refused", async () => {
    const { database } = seeded();
    const roomId = await seedRoom(database);
    const eventId = await seedHearing(database);
    const booked = await createFirmResourceBooking(
      database,
      { resourceId: roomId, matterEventId: eventId },
      options,
    );
    await commit(database, booked.effect);

    const retired = await updateFirmResource(database, roomId, { active: false }, options);
    await commit(database, retired.effect);

    // The old booking still reads back and still occupies the grid.
    const availability = await readResourceAvailability(database, {
      resourceId: roomId,
      fromDate: "2026-09-01",
      toDate: "2026-09-30",
    });
    expect(availability).toHaveLength(1);

    // A new booking is refused by name.
    await expect(
      createFirmResourceBooking(database, { resourceId: roomId, matterEventId: eventId }, options),
    ).rejects.toThrow(/deactivated and takes no new bookings/);
  });
});

describe("a booking's window and zone", () => {
  it("defaults the window from the event and freezes the zone from the resource's office", async () => {
    const { database } = seeded();
    // The hearing is in a California court; the room is in the Austin office. The room's schedule
    // is kept in the ROOM's zone, frozen at the write.
    const roomId = await seedRoom(database, "Austin war room", AUSTIN_OFFICE);
    const eventId = await seedHearing(database);
    const booked = await createFirmResourceBooking(
      database,
      { resourceId: roomId, matterEventId: eventId },
      options,
    );
    await commit(database, booked.effect);
    const availability = await readResourceAvailability(database, {
      resourceId: roomId,
      fromDate: "2026-09-01",
      toDate: "2026-09-30",
    });
    expect(availability[0]?.startsOn).toBe("2026-09-14");
    expect(availability[0]?.startsAtTime).toBe("09:00");
    expect(availability[0]?.endsAtTime).toBe("12:00");
    expect(availability[0]?.timeZone).toBe("America/Chicago");
  });

  it("honors the setup-time case: an explicit window overrides the event's, and is never re-derived", async () => {
    const { database } = seeded();
    const roomId = await seedRoom(database);
    const eventId = await seedHearing(database);
    const booked = await createFirmResourceBooking(
      database,
      {
        resourceId: roomId,
        matterEventId: eventId,
        // The room from half past eight for a nine o'clock deposition: somebody has to set up.
        startsAtTime: "08:30",
      },
      options,
    );
    await commit(database, booked.effect);
    const availability = await readResourceAvailability(database, {
      resourceId: roomId,
      fromDate: "2026-09-01",
      toDate: "2026-09-30",
    });
    expect(availability[0]?.startsAtTime).toBe("08:30");
    expect(availability[0]?.endsAtTime).toBe("12:00");
  });

  it("attaches to exactly one event: both or neither is a named refusal", async () => {
    const { database } = seeded();
    const roomId = await seedRoom(database);
    const matterEventId = await seedHearing(database);
    const firmEvent = await createFirmEvent(
      database,
      { title: "Reservation", startsOn: "2026-09-14", timeZone: "America/Los_Angeles" },
      options,
    );
    await commit(database, firmEvent.effect);
    await expect(
      createFirmResourceBooking(database, { resourceId: roomId }, options),
    ).rejects.toThrow(/exactly one event/);
    await expect(
      createFirmResourceBooking(
        database,
        { resourceId: roomId, matterEventId, firmEventId: firmEvent.firmEventId },
        options,
      ),
    ).rejects.toThrow(/exactly one event/);
  });
});

describe("double-booking warns and allows", () => {
  it("lands the deliberate double-booking and reports the conflict on both sides", async () => {
    const { database } = seeded();
    const roomId = await seedRoom(database);
    const first = await seedHearing(database);
    const second = await seedHearing(database, {
      title: "Status conference",
      startsAtTime: "10:00",
      endsAtTime: "11:00",
    });

    const firstBooking = await createFirmResourceBooking(
      database,
      { resourceId: roomId, matterEventId: first },
      options,
    );
    await commit(database, firstBooking.effect);
    expect(firstBooking.conflicts).toHaveLength(0);

    // The second write SUCCEEDS — the record of the proceeding outranks the tidiness of the room
    // grid — and carries the overlap it created.
    const secondBooking = await createFirmResourceBooking(
      database,
      { resourceId: roomId, matterEventId: second },
      options,
    );
    await commit(database, secondBooking.effect);
    expect(secondBooking.conflicts).toHaveLength(1);
    expect(secondBooking.conflicts[0]?.bookingId).toBe(firstBooking.firmResourceBookingId);
    // A conflict is a reference: a window and a deep link, never a title.
    expect(JSON.stringify(secondBooking.conflicts)).not.toContain("Deposition");

    // Both sides see it on the grid, pre-paired in one response.
    const availability = await readResourceAvailability(database, {
      resourceId: roomId,
      fromDate: "2026-09-01",
      toDate: "2026-09-30",
    });
    expect(availability).toHaveLength(2);
    const overlapsByBooking = new Map(
      availability.map((entry) => [entry.bookingId, entry.overlappingBookingIds]),
    );
    expect(overlapsByBooking.get(firstBooking.firmResourceBookingId)).toEqual([
      secondBooking.firmResourceBookingId,
    ]);
    expect(overlapsByBooking.get(secondBooking.firmResourceBookingId)).toEqual([
      firstBooking.firmResourceBookingId,
    ]);
  });

  // The grid's pairing is a sweep over intervals sorted by start instant rather than a comparison of
  // every pair. This pins the two to the same answer on a day that mixes a three-way pile-up, a
  // touching-but-not-overlapping pair, and bookings on their own.
  it("pairs conflicts exactly as an all-pairs comparison would", async () => {
    const { database } = seeded();
    const roomId = await seedRoom(database);
    const windows = [
      { startsAtTime: "09:00", endsAtTime: "10:00" },
      { startsAtTime: "09:30", endsAtTime: "11:00" },
      { startsAtTime: "09:45", endsAtTime: "10:15" },
      { startsAtTime: "10:00", endsAtTime: "11:00" },
      { startsAtTime: "13:00", endsAtTime: "14:00" },
      { startsAtTime: "14:00", endsAtTime: "15:00" },
      { startsAtTime: "16:00", endsAtTime: "17:00" },
      { startsAtTime: "16:30", endsAtTime: "16:45" },
    ];
    for (const window of windows) {
      const event = await createFirmEvent(
        database,
        {
          title: "Reservation",
          startsOn: "2026-09-14",
          ...window,
          timeZone: "America/Los_Angeles",
        },
        options,
      );
      await commit(database, event.effect);
      const booking = await createFirmResourceBooking(
        database,
        { resourceId: roomId, firmEventId: event.firmEventId },
        options,
      );
      await commit(database, booking.effect);
    }

    const availability = await readResourceAvailability(database, {
      resourceId: roomId,
      fromDate: "2026-09-01",
      toDate: "2026-09-30",
    });
    expect(availability).toHaveLength(windows.length);

    const intervals = availability.map((entry) =>
      bookingInterval({
        starts_on: entry.startsOn,
        starts_at_time: entry.startsAtTime,
        ends_on: entry.endsOn,
        ends_at_time: entry.endsAtTime,
        time_zone: entry.timeZone,
      }),
    );
    const allPairs = availability.map((_entry, index) =>
      availability
        .filter((_other, otherIndex) => {
          const a = intervals[index];
          const b = intervals[otherIndex];
          if (otherIndex === index || a === undefined || b === undefined) return false;
          return a.start < b.endExclusive && b.start < a.endExclusive;
        })
        .map((other) => other.bookingId),
    );
    expect(availability.map((entry) => entry.overlappingBookingIds)).toEqual(allPairs);
    // Not a vacuous agreement: the pile-up is paired and the day's loners are not.
    expect(allPairs.filter((pairs) => pairs.length > 0)).toHaveLength(6);
    expect(allPairs.some((pairs) => pairs.length === 3)).toBe(true);
  });

  it("detects an overlap across zones through each row's own stored zone", async () => {
    const { database } = seeded();
    const roomId = await seedRoom(database);
    const first = await seedHearing(database);
    const firstBooking = await createFirmResourceBooking(
      database,
      { resourceId: roomId, matterEventId: first },
      options,
    );
    await commit(database, firstBooking.effect);

    // A second booking recorded in Eastern time: 13:00-14:00 Eastern IS 10:00-11:00 Pacific, inside
    // the first booking's window. Same-zone text comparison would not see it; the instant
    // comparison does.
    const second = await seedHearing(database, {
      title: "Remote appearance",
      startsAtTime: "13:00",
      endsAtTime: "14:00",
      timeZone: "America/New_York",
    });
    const secondBooking = await createFirmResourceBooking(
      database,
      { resourceId: roomId, matterEventId: second, timeZone: "America/New_York" },
      options,
    );
    expect(secondBooking.conflicts.map((conflict) => conflict.bookingId)).toEqual([
      firstBooking.firmResourceBookingId,
    ]);
  });

  it("stays correct across a daylight-saving boundary", async () => {
    const { database } = seeded();
    const roomId = await seedRoom(database);
    // The United States falls back on 2026-11-01. Two timed bookings straddling the repeated hour:
    // 00:30-01:30 and 01:00-02:00 Pacific. The first occurrence rule resolves both consistently and
    // the intervals intersect.
    const first = await seedHearing(database, {
      title: "Late-night filing window",
      startsOn: "2026-11-01",
      startsAtTime: "00:30",
      endsAtTime: "01:30",
    });
    const firstBooking = await createFirmResourceBooking(
      database,
      { resourceId: roomId, matterEventId: first },
      options,
    );
    await commit(database, firstBooking.effect);
    const second = await seedHearing(database, {
      title: "Second window",
      startsOn: "2026-11-01",
      startsAtTime: "01:00",
      endsAtTime: "02:00",
    });
    const secondBooking = await createFirmResourceBooking(
      database,
      { resourceId: roomId, matterEventId: second },
      options,
    );
    expect(secondBooking.conflicts).toHaveLength(1);
  });

  it("treats an all-day booking as occupying its whole civil day against a timed one", async () => {
    const { database } = seeded();
    const roomId = await seedRoom(database, "Pool car — silver");
    const allDay = await seedHearing(database, {
      title: "Site visit",
      startsAtTime: null,
      endsAtTime: null,
    });
    const allDayBooking = await createFirmResourceBooking(
      database,
      { resourceId: roomId, matterEventId: allDay },
      options,
    );
    await commit(database, allDayBooking.effect);
    const timed = await seedHearing(database, {
      title: "Afternoon errand",
      startsAtTime: "15:00",
      endsAtTime: "16:00",
    });
    const timedBooking = await createFirmResourceBooking(
      database,
      { resourceId: roomId, matterEventId: timed },
      options,
    );
    expect(timedBooking.conflicts).toHaveLength(1);
  });

  it("reports fresh conflicts when an update moves a booking into overlap", async () => {
    const { database } = seeded();
    const roomId = await seedRoom(database);
    const first = await seedHearing(database);
    const firstBooking = await createFirmResourceBooking(
      database,
      { resourceId: roomId, matterEventId: first },
      options,
    );
    await commit(database, firstBooking.effect);
    const second = await seedHearing(database, {
      title: "Afternoon",
      startsAtTime: "14:00",
      endsAtTime: "15:00",
    });
    const secondBooking = await createFirmResourceBooking(
      database,
      { resourceId: roomId, matterEventId: second },
      options,
    );
    await commit(database, secondBooking.effect);
    expect(secondBooking.conflicts).toHaveLength(0);

    const moved = await updateFirmResourceBooking(
      database,
      secondBooking.firmResourceBookingId,
      { startsAtTime: "10:00", endsAtTime: "11:00" },
      options,
    );
    expect(moved.conflicts).toHaveLength(1);
  });
});

describe("liveness is derived, never stored", () => {
  it("cancelling an event frees its rooms with no second write", async () => {
    const { database, raw } = seeded();
    const roomId = await seedRoom(database);
    const eventId = await seedHearing(database);
    const booking = await createFirmResourceBooking(
      database,
      { resourceId: roomId, matterEventId: eventId },
      options,
    );
    await commit(database, booking.effect);

    const before = await readResourceAvailability(database, {
      resourceId: roomId,
      fromDate: "2026-09-01",
      toDate: "2026-09-30",
    });
    expect(before).toHaveLength(1);
    const rowBefore = raw
      .prepare("SELECT * FROM firm_resource_booking WHERE id = ?")
      .get(booking.firmResourceBookingId);

    const cancelled = await cancelMatterEvent(database, eventId, options);
    await commit(database, cancelled.effect);

    // The room is free — and the booking ROW is byte-untouched, because releasing is not an
    // action: no released flag exists to write, asserted at the schema.
    const after = await readResourceAvailability(database, {
      resourceId: roomId,
      fromDate: "2026-09-01",
      toDate: "2026-09-30",
    });
    expect(after).toHaveLength(0);
    const columns = raw.prepare("PRAGMA table_info(firm_resource_booking)").all() as {
      name: string;
    }[];
    expect(columns.map((column) => column.name)).not.toContain("released");
    const rowAfter = raw
      .prepare("SELECT * FROM firm_resource_booking WHERE id = ?")
      .get(booking.firmResourceBookingId);
    expect(rowAfter).toEqual(rowBefore);
  });

  it("continuing an event releases its rooms the same way, and the new setting books afresh", async () => {
    const { database } = seeded();
    const roomId = await seedRoom(database);
    const eventId = await seedHearing(database);
    const booking = await createFirmResourceBooking(
      database,
      { resourceId: roomId, matterEventId: eventId },
      options,
    );
    await commit(database, booking.effect);

    const continued = await continueMatterEvent(
      database,
      eventId,
      { startsOn: "2026-10-05", statusReason: "Continued on stipulation" },
      options,
    );
    await commit(database, continued.effect);
    // The response lists what the derivation just released.
    expect(continued.releasedBookings.map((released) => released.id)).toEqual([
      booking.firmResourceBookingId,
    ]);
    const after = await readResourceAvailability(database, {
      resourceId: roomId,
      fromDate: "2026-09-01",
      toDate: "2026-10-31",
    });
    expect(after).toHaveLength(0);
  });

  it("deletes a booking outright: a claim on a room is not history", async () => {
    const { database } = seeded();
    const roomId = await seedRoom(database);
    const eventId = await seedHearing(database);
    const booking = await createFirmResourceBooking(
      database,
      { resourceId: roomId, matterEventId: eventId },
      options,
    );
    await commit(database, booking.effect);
    const deleted = await deleteFirmResourceBooking(
      database,
      booking.firmResourceBookingId,
      options,
    );
    await commit(database, deleted.effect);
    const after = await readResourceAvailability(database, {
      resourceId: roomId,
      fromDate: "2026-09-01",
      toDate: "2026-09-30",
    });
    expect(after).toHaveLength(0);
    await expect(
      deleteFirmResourceBooking(database, booking.firmResourceBookingId, options),
    ).rejects.toThrow(CalendarValidationError);
  });
});
