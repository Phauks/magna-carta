import { describe, expect, it } from "vitest";
import { firmRoomStatus } from "../src/lib/meetings/firm-rooms.ts";
import type { FirmRoom } from "@magna-carta/api-client";

function room(overrides: Partial<FirmRoom> = {}): FirmRoom {
  return {
    userId: "user_1",
    name: "Ada Park",
    linkCode: "abcde12345",
    medium: "video",
    openMeetingId: null,
    inTheRoom: 0,
    isCaller: false,
    ...overrides,
  };
}

describe("a row of the Firm Rooms list", () => {
  it("lists a member with no room, saying so", () => {
    expect(firmRoomStatus(room({ linkCode: null, medium: null }))).toEqual({
      text: "No room set up",
      open: false,
    });
  });

  it("says a room is free while nobody is in it, even with a session left open", () => {
    expect(firmRoomStatus(room()).text).toBe("Not in a meeting");
    expect(firmRoomStatus(room({ openMeetingId: "meeting_1", inTheRoom: 0 })).open).toBe(false);
  });

  it("counts the people in an open room", () => {
    expect(firmRoomStatus(room({ openMeetingId: "meeting_1", inTheRoom: 1 }))).toEqual({
      text: "In a meeting, 1 person",
      open: true,
    });
    expect(firmRoomStatus(room({ openMeetingId: "meeting_1", inTheRoom: 4 })).text).toBe(
      "In a meeting, 4 people",
    );
  });
});
