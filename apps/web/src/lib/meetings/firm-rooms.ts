/*
 * What a row of the Firm Rooms list says about a room: whether a session is open in it and how
 * many people are there. Pure, so the wording is a unit test.
 */
import type { FirmRoom, SharedRoom } from "@magna-carta/api-client";

export interface FirmRoomStatus {
  readonly text: string;
  /** Whether somebody is in the room now, which is when Join is offered. */
  readonly open: boolean;
}

export function firmRoomStatus(room: FirmRoom): FirmRoomStatus {
  if (room.linkCode === null) return { text: "No room set up", open: false };
  if (room.openMeetingId === null || room.inTheRoom === 0) {
    return { text: "Not in a meeting", open: false };
  }
  const people = room.inTheRoom === 1 ? "1 person" : `${String(room.inTheRoom)} people`;
  return { text: `In a meeting, ${people}`, open: true };
}

/** What a row of the Shared Rooms list says: the same words as a member's room, from the same facts. */
export function sharedRoomStatus(room: SharedRoom): FirmRoomStatus {
  if (room.openMeetingId === null || room.inTheRoom === 0) {
    return { text: "Not in a meeting", open: false };
  }
  const people = room.inTheRoom === 1 ? "1 person" : `${String(room.inTheRoom)} people`;
  return { text: `In a meeting, ${people}`, open: true };
}
