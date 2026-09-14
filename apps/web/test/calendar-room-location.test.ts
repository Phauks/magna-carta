/*
 * When the place a setting is held is one of the firm's bookable rooms — the join that makes
 * "held here" and "this room is taken" one act rather than two a person has to remember.
 */
import { describe, expect, it } from "vitest";
import type { FirmResource } from "$lib/calendar/calendar-api.ts";
import {
  locationIsBookableRoom,
  roomForLocation,
  roomNotHeldSentence,
} from "$lib/calendar/room-location.ts";

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
    expect(sentence).toContain("was recorded");
    expect(sentence).toContain("Boardroom was not held");
  });
});
