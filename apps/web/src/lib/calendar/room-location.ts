/*
 * When the place a setting is held IS one of the firm's bookable rooms.
 *
 * The Location field and the Rooms tab's Book a Room were two ways to say one thing, and the owner
 * named it (2026-09-14: "location and booking a room seem duplicative of what should be the same
 * functionality"). Worse than duplicative: only one of them reached the room's calendar. Location
 * stores TEXT — a courthouse, a department number, opposing counsel's office are none of them
 * records this product holds — so choosing "Conference Room B" from the picker wrote the string
 * "Conference Room B", while the room's own calendar reads BOOKINGS. Nothing joined the two, which
 * is why an event held in a room never appeared on that room's calendar.
 *
 * SO THE TEXT IS MATCHED BACK TO THE ROOM, and a setting held in one of the firm's rooms books it.
 * Matching by name rather than by a foreign key is deliberate and keeps the field's own reasoning
 * intact: the column stays free text, nothing dangles when a room is renamed, and a place the firm
 * has no record of is still just typed. What changes is that where the text DOES name a room the
 * firm has, the booking is made, so "held here" and "this room is taken" stop being separate
 * claims a person has to remember to make twice.
 *
 * THE MATCH IS EXACT, ON A TRIMMED CASE-FOLDED NAME. Anything looser would book a room off a
 * guess: "Boardroom 2" is not "Boardroom", and a firm that types a courthouse whose name happens
 * to contain a room's name has not booked that room. The picker writes the room's name verbatim,
 * so the exact match is what a chosen room actually produces.
 *
 * A ROOM IS NAMED BY ITS OFFICE WHERE THE FIRM HAS MORE THAN ONE. The owner's shape (2026-09-14):
 * "A location may be Office 1, Room 1; Office 2, Room 2. Where offices are distinct addresses, but
 * rooms are not." A firm with one office says "Boardroom" and means it; a firm with three has three
 * of everything, and a bare room name names none of them. So the picker writes "Main Office —
 * Boardroom" once there is more than one office to tell apart, and BOTH spellings match here — a
 * location recorded before this, or typed by hand, still finds its room.
 */
import type { LocationSummary } from "$lib/matters/matters-api.ts";
import type { OfficeAddress } from "$lib/offices/offices-api.ts";
import type { FirmResource } from "./calendar-api.ts";

/**
 * An office as the Location field offers it: the summary every consumer of the firm's offices
 * reads, with its addresses where the read carried them — a hearing "at the North Office" should
 * say where that is to whoever reads the record.
 */
export type OfficePlace = LocationSummary & { readonly addresses?: readonly OfficeAddress[] };

/** What separates an office from its room in a written location. */
const QUALIFIER = " — ";

/** How a name is compared: trimmed and case-folded, and nothing else. */
function comparable(name: string): string {
  return name.trim().toLowerCase();
}

/** The rooms a firm could hold a setting in: active, and places rather than things. */
export function bookableRooms(resources: readonly FirmResource[]): FirmResource[] {
  // Only ACTIVE rooms: a retired room is not a place the firm is still holding settings in, and
  // booking one would put a record on a calendar nobody reads. Only the `room` kind, because the
  // other bookable things — a car, a projector — are not places a setting is HELD.
  return resources.filter((resource) => resource.active && resource.kind === "room");
}

/**
 * How a room is written into a location, given the offices the firm has.
 *
 * One office, or a room belonging to none: the room's own name, because there is nothing to tell it
 * apart from. More than one: the office's name, the qualifier, then the room's — so two firms'
 * worth of "Conference Room 1" read as two different rooms, which is what they are.
 */
export function writtenRoomName(room: FirmResource, offices: readonly LocationSummary[]): string {
  if (offices.length < 2) return room.name;
  const office = offices.find((candidate) => candidate.id === room.locationId);
  return office === undefined ? room.name : `${office.name}${QUALIFIER}${room.name}`;
}

/**
 * The firm room this location text names, or null.
 *
 * Either spelling matches: the written name the picker produces today, and the bare room name —
 * which is what a location recorded before rooms were qualified holds, and what somebody typing
 * from memory writes. A bare name that two offices both answer to matches NEITHER, because booking
 * one of two rooms a person did not choose between is worse than booking none.
 */
export function roomForLocation(
  locationText: string,
  resources: readonly FirmResource[],
  offices: readonly LocationSummary[] = [],
): FirmResource | null {
  const wanted = comparable(locationText);
  if (wanted === "") return null;
  const rooms = bookableRooms(resources);
  const written = rooms.filter((room) => comparable(writtenRoomName(room, offices)) === wanted);
  if (written.length === 1) return written[0] ?? null;
  if (written.length > 1) return null;
  const bare = rooms.filter((room) => comparable(room.name) === wanted);
  return bare.length === 1 ? (bare[0] ?? null) : null;
}

/** Whether this location text names a room the firm could book. */
export function locationIsBookableRoom(
  locationText: string,
  resources: readonly FirmResource[],
  offices: readonly LocationSummary[] = [],
): boolean {
  return roomForLocation(locationText, resources, offices) !== null;
}

/** One office's heading in the picker, and the rooms under it. */
export interface RoomGroup {
  /** What the heading reads: an office's name, or the fallback for rooms belonging to none. */
  readonly heading: string;
  /** The rooms, each with the name the picker will write for it. */
  readonly rooms: readonly { readonly room: FirmResource; readonly written: string }[];
}

/**
 * The firm's rooms, grouped under the office each is in, in the order the offices were given, with
 * rooms belonging to no office last.
 *
 * A group with no rooms is left out rather than drawn empty: an office with no bookable rooms is
 * not a place a reader is choosing between, and a heading over nothing is a heading that misleads.
 */
export function roomsByOffice(
  resources: readonly FirmResource[],
  offices: readonly LocationSummary[],
  unassignedHeading: string,
): RoomGroup[] {
  const rooms = bookableRooms(resources);
  const groups: RoomGroup[] = [];
  for (const office of offices) {
    const inOffice = rooms
      .filter((room) => room.locationId === office.id)
      .map((room) => ({ room, written: writtenRoomName(room, offices) }));
    if (inOffice.length > 0) groups.push({ heading: office.name, rooms: inOffice });
  }
  const unassigned = rooms
    .filter((room) => offices.every((office) => office.id !== room.locationId))
    .map((room) => ({ room, written: writtenRoomName(room, offices) }));
  if (unassigned.length > 0) groups.push({ heading: unassignedHeading, rooms: unassigned });
  return groups;
}

/**
 * What to tell somebody whose event was recorded but whose room was not held.
 *
 * The two writes cannot be one — the booking needs the event's id — so the second can fail after
 * the first succeeded, and a form that closed silently would leave a person believing a room was
 * held that is not. The sentence states both halves in the order they happened.
 */
export function roomNotHeldSentence(roomName: string): string {
  return `The event was saved, but ${roomName} wasn't booked. Book it from the event's Rooms tab.`;
}

/**
 * What a correction has to do to the event's bookings so they say what the location says.
 *
 * ONE GESTURE, NOT TWO. Choosing a firm room as the location books it — that has been true at the
 * RECORD since 2026-09-14, and it was never true at the CORRECTION, which is the half that made
 * Location and Book a Room still read as two features (owner, 2026-09-16: "booking a room and
 * location should be consolidated"). An event moved from the Boardroom to Conference Room B kept
 * the Boardroom held and never held Conference Room B, so after one edit the two room calendars
 * disagreed with the record and with each other.
 *
 * SO THE CORRECTION RECONCILES, AND RECONCILES ONLY THE ROOM THE LOCATION NAMES. A booking for a
 * room the location no longer names is released; the room it now names is booked. Every OTHER
 * booking is left exactly as it is, which is what keeps the second room a firm held by hand from
 * being swept away by an edit to a field that never mentioned it — the Rooms tab is still where a
 * second room is held, and this never touches one.
 *
 * NOTHING HAPPENS WHERE NOTHING CHANGED. A location edited from one courthouse to another names no
 * room at either end and moves no booking; a location left alone re-books nothing. That is what
 * makes this safe to run on every save rather than only when somebody remembered to.
 */
export interface BookingReconciliation {
  /** The booking ids to release: held for a room the location no longer names. */
  readonly release: readonly string[];
  /** The room to book, or null where the location names none or the right one is already held. */
  readonly book: FirmResource | null;
}

export function reconcileRoomBooking(
  locationText: string,
  bookings: readonly { id: string; resourceId: string }[],
  resources: readonly FirmResource[],
  offices: readonly LocationSummary[],
): BookingReconciliation {
  const wanted = roomForLocation(locationText, resources, offices);
  // Only bookings for a ROOM are this field's business. A pool car held against the same event was
  // never named by the location and is not released by a change to it.
  const roomIds = new Set(bookableRooms(resources).map((room) => room.id));
  const held = bookings.filter((booking) => roomIds.has(booking.resourceId));
  const release = held
    .filter((booking) => wanted === null || booking.resourceId !== wanted.id)
    .map((booking) => booking.id);
  const alreadyHeld = wanted !== null && held.some((booking) => booking.resourceId === wanted.id);
  return { release, book: wanted !== null && !alreadyHeld ? wanted : null };
}
