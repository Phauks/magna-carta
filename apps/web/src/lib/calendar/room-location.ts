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
 */
import type { FirmResource } from "./calendar-api.ts";

/** How a name is compared: trimmed and case-folded, and nothing else. */
function comparable(name: string): string {
  return name.trim().toLowerCase();
}

/**
 * The firm room this location text names, or null.
 *
 * Only ACTIVE rooms: a retired room is not a place the firm is still holding settings in, and
 * booking one would put a record on a calendar nobody reads. Only the `room` kind, because the
 * other bookable things — a car, a projector — are not places a setting is HELD.
 */
export function roomForLocation(
  locationText: string,
  resources: readonly FirmResource[],
): FirmResource | null {
  const wanted = comparable(locationText);
  if (wanted === "") return null;
  return (
    resources.find(
      (resource) =>
        resource.active && resource.kind === "room" && comparable(resource.name) === wanted,
    ) ?? null
  );
}

/** Whether this location text names a room the firm could book. */
export function locationIsBookableRoom(
  locationText: string,
  resources: readonly FirmResource[],
): boolean {
  return roomForLocation(locationText, resources) !== null;
}

/**
 * What to tell somebody whose event was recorded but whose room was not held.
 *
 * The two writes cannot be one — the booking needs the event's id — so the second can fail after
 * the first succeeded, and a form that closed silently would leave a person believing a room was
 * held that is not. The sentence states both halves in the order they happened.
 */
export function roomNotHeldSentence(roomName: string): string {
  return `The event was recorded, but ${roomName} was not held. Book it from the event's Rooms tab.`;
}
