/*
 * When the place a setting is held is one of the firm's bookable rooms — the join that makes
 * "held here" and "this room is taken" one act rather than two a person has to remember.
 */
import { describe, expect, it } from "vitest";
import type { FirmResource } from "$lib/calendar/calendar-api.ts";
import type { LocationSummary } from "$lib/matters/matters-api.ts";
import {
  locationIsBookableRoom,
  reconcileRoomBooking,
  roomForLocation,
  roomNotHeldSentence,
  roomsByOffice,
  writtenRoomName,
} from "$lib/calendar/room-location.ts";

function office(id: string, name: string): LocationSummary {
  return { id, name, status: "active", jurisdiction: null, numberCode: null };
}

const MAIN = office("loc_main", "Main Office");
const NORTH = office("loc_north", "North Office");
const TWO_OFFICES = [MAIN, NORTH];

function resource(overrides: Partial<FirmResource> & { id: string; name: string }): FirmResource {
  return {
    kind: "room",
    active: true,
    locationId: null,
    capacity: null,
    notes: null,
    ...overrides,
  } as FirmResource;
}

const RESOURCES: readonly FirmResource[] = [
  resource({ id: "res_board", name: "Boardroom" }),
  resource({ id: "res_two", name: "Boardroom 2" }),
  resource({ id: "res_car", name: "The firm car", kind: "vehicle" }),
  resource({ id: "res_old", name: "Old Library", active: false }),
];

/* Two offices, each with a room of the same name — the shape a bare name cannot tell apart. */
const TWO_OFFICE_ROOMS: readonly FirmResource[] = [
  resource({ id: "res_main_one", name: "Conference Room 1", locationId: "loc_main" }),
  resource({ id: "res_north_one", name: "Conference Room 1", locationId: "loc_north" }),
  resource({ id: "res_loose", name: "The Annexe" }),
];

describe("the room a location names", () => {
  it("is the room whose name the text is", () => {
    expect(roomForLocation("Boardroom", RESOURCES)?.id).toBe("res_board");
  });

  it("ignores case and surrounding space, which is all the looseness there is", () => {
    expect(roomForLocation("  boardroom ", RESOURCES)?.id).toBe("res_board");
  });

  it("never matches on a partial name", () => {
    // "Boardroom 2" is not "Boardroom", and a courthouse whose name contains a room's name has not
    // booked that room. A loose match here books a room off a guess.
    expect(roomForLocation("Boardroom 2", RESOURCES)?.id).toBe("res_two");
    expect(roomForLocation("Boardroom Annexe", RESOURCES)).toBeNull();
  });

  it("is null for a place the firm has no record of", () => {
    expect(roomForLocation("Dept. 14, Superior Court", RESOURCES)).toBeNull();
  });

  it("is null for nothing typed at all", () => {
    expect(roomForLocation("", RESOURCES)).toBeNull();
    expect(roomForLocation("   ", RESOURCES)).toBeNull();
  });

  it("leaves a retired room alone", () => {
    // A room the firm stopped using is not a place it is still holding settings in, and a booking
    // on it would put a record on a calendar nobody reads.
    expect(roomForLocation("Old Library", RESOURCES)).toBeNull();
  });

  it("leaves a bookable thing that is not a PLACE alone", () => {
    expect(roomForLocation("The firm car", RESOURCES)).toBeNull();
  });

  it("answers the same question as a yes or no", () => {
    expect(locationIsBookableRoom("Boardroom", RESOURCES)).toBe(true);
    expect(locationIsBookableRoom("Dept. 14", RESOURCES)).toBe(false);
  });
});

describe("what a person is told when the room was not held", () => {
  it("states both halves, in the order they happened", () => {
    const sentence = roomNotHeldSentence("Boardroom");
    expect(sentence).toContain("was saved");
    expect(sentence).toContain("Boardroom wasn't booked");
  });
});

describe("how a room is written into a location", () => {
  it("is the room's own name when the firm has one office to tell apart from", () => {
    expect(writtenRoomName(TWO_OFFICE_ROOMS[0]!, [MAIN])).toBe("Conference Room 1");
  });

  it("names the office once there is more than one", () => {
    expect(writtenRoomName(TWO_OFFICE_ROOMS[0]!, TWO_OFFICES)).toBe(
      "Main Office — Conference Room 1",
    );
    expect(writtenRoomName(TWO_OFFICE_ROOMS[1]!, TWO_OFFICES)).toBe(
      "North Office — Conference Room 1",
    );
  });

  it("leaves a room belonging to no office bare, because there is no office to name", () => {
    expect(writtenRoomName(TWO_OFFICE_ROOMS[2]!, TWO_OFFICES)).toBe("The Annexe");
  });
});

describe("matching a written room back", () => {
  it("finds the room a qualified name names", () => {
    expect(
      roomForLocation("North Office — Conference Room 1", TWO_OFFICE_ROOMS, TWO_OFFICES)?.id,
    ).toBe("res_north_one");
  });

  it("still finds a room recorded before rooms were qualified", () => {
    // A location written when the firm had one office, or typed from memory, is a bare name.
    expect(roomForLocation("The Annexe", TWO_OFFICE_ROOMS, TWO_OFFICES)?.id).toBe("res_loose");
  });

  it("books NEITHER when a bare name two offices answer to is ambiguous", () => {
    // Booking one of two rooms a person did not choose between is worse than booking none.
    expect(roomForLocation("Conference Room 1", TWO_OFFICE_ROOMS, TWO_OFFICES)).toBeNull();
  });

  it("is unambiguous again when the firm has only the one office", () => {
    expect(roomForLocation("Conference Room 1", [TWO_OFFICE_ROOMS[0]!], [MAIN])?.id).toBe(
      "res_main_one",
    );
  });
});

describe("the rooms grouped under their offices", () => {
  const groups = roomsByOffice(TWO_OFFICE_ROOMS, TWO_OFFICES, "Rooms");

  it("puts each office's rooms under its own heading, in the order the offices came", () => {
    expect(groups.map((group) => group.heading)).toEqual(["Main Office", "North Office", "Rooms"]);
  });

  it("carries the name the picker will write for each room", () => {
    expect(groups[0]?.rooms[0]?.written).toBe("Main Office — Conference Room 1");
    expect(groups[2]?.rooms[0]?.written).toBe("The Annexe");
  });

  it("leaves out an office with no bookable rooms rather than drawing an empty heading", () => {
    const empty = roomsByOffice([TWO_OFFICE_ROOMS[0]!], TWO_OFFICES, "Rooms");
    expect(empty.map((group) => group.heading)).toEqual(["Main Office"]);
  });

  it("leaves out a retired room and a thing that is not a place", () => {
    const mixed = roomsByOffice(RESOURCES, [MAIN], "Rooms");
    const names = mixed.flatMap((group) => group.rooms.map((held) => held.room.name));
    expect(names).toEqual(["Boardroom", "Boardroom 2"]);
  });
});

describe("locationIsBookableRoom over offices", () => {
  it("agrees with roomForLocation", () => {
    expect(
      locationIsBookableRoom("North Office — Conference Room 1", TWO_OFFICE_ROOMS, TWO_OFFICES),
    ).toBe(true);
    expect(locationIsBookableRoom("Conference Room 1", TWO_OFFICE_ROOMS, TWO_OFFICES)).toBe(false);
  });
});

describe("what a correction does to the bookings", () => {
  const OFFICES: readonly LocationSummary[] = [MAIN];
  const RESOURCES: readonly FirmResource[] = [
    resource({ id: "resource_board", name: "Boardroom", locationId: MAIN.id }),
    resource({ id: "resource_b", name: "Conference Room B", locationId: MAIN.id }),
    resource({ id: "resource_car", name: "Pool car", locationId: MAIN.id, kind: "vehicle" }),
  ];

  it("releases the room the location no longer names, and books the one it does", () => {
    const { release, book } = reconcileRoomBooking(
      "Conference Room B",
      [{ id: "booking_1", resourceId: "resource_board" }],
      RESOURCES,
      OFFICES,
    );
    expect(release).toEqual(["booking_1"]);
    expect(book?.id).toBe("resource_b");
  });

  it("does nothing at all where the right room is already held", () => {
    const { release, book } = reconcileRoomBooking(
      "Boardroom",
      [{ id: "booking_1", resourceId: "resource_board" }],
      RESOURCES,
      OFFICES,
    );
    expect(release).toEqual([]);
    expect(book).toBeNull();
  });

  it("releases the room when the location becomes a place the firm has no record of", () => {
    const { release, book } = reconcileRoomBooking(
      "Department 12, Regional Justice Center",
      [{ id: "booking_1", resourceId: "resource_board" }],
      RESOURCES,
      OFFICES,
    );
    expect(release).toEqual(["booking_1"]);
    expect(book).toBeNull();
  });

  it("moves nothing where neither the old nor the new location names a room", () => {
    const { release, book } = reconcileRoomBooking("Another courthouse", [], RESOURCES, OFFICES);
    expect(release).toEqual([]);
    expect(book).toBeNull();
  });

  it("NEVER releases a booking that is not a room", () => {
    // The pool car was held by hand from the Rooms tab and the location never named it. An edit to
    // a field that does not mention it must not sweep it away.
    const { release, book } = reconcileRoomBooking(
      "Boardroom",
      [{ id: "booking_car", resourceId: "resource_car" }],
      RESOURCES,
      OFFICES,
    );
    expect(release).toEqual([]);
    expect(book?.id).toBe("resource_board");
  });

  it("releases every OTHER room, so one location never leaves two rooms held", () => {
    const { release, book } = reconcileRoomBooking(
      "Boardroom",
      [
        { id: "booking_1", resourceId: "resource_board" },
        { id: "booking_2", resourceId: "resource_b" },
      ],
      RESOURCES,
      OFFICES,
    );
    expect(release).toEqual(["booking_2"]);
    expect(book).toBeNull();
  });
});
