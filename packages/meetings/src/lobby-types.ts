import type { MeetingAttendanceId, UserId } from "@magna-carta/identifiers/types";

// THE DOOR: whether arrivals wait, who is at it, and what a host's decision about one of them can
// come to.
//
// One lobby per MEETING and never one per firm. A firm holds several meetings at once, so a
// firm-level door would put the people arriving at a partner's deposition in the same queue as the
// people arriving at a staff briefing, in front of a host who is in neither.

// WHETHER ARRIVALS WAIT. Also a SQLite CHECK on the meeting row, so a value that reaches a write
// without appearing here fails at the database and not only at the type checker.
//
// Off by default, because every participant today is a firm member arriving at an event they are on
// and a lobby on by default would queue a colleague for every ordinary hearing. Guests, when they
// land, always wait regardless of this column — the door is what a guest link opens onto, which is a
// property of the grant they arrive with rather than of this setting.
export const MEETING_LOBBY_MODES = Object.freeze(["off", "on"] as const);
export type MeetingLobbyMode = (typeof MEETING_LOBBY_MODES)[number];

export function isMeetingLobbyMode(value: string): value is MeetingLobbyMode {
  return (MEETING_LOBBY_MODES as readonly string[]).includes(value);
}

// THE DOOR'S OWN CEILING, and it is much smaller than the room's.
//
// `MAX_MEETING_PARTICIPANTS` is three hundred because that is how many people a browser and the
// signaling room can carry. A hundred is a different number answering a different question: a
// queue is not somewhere a firm should be able to accumulate ten thousand rows, and every row at the
// door is a stay in the record whether or not anybody is ever let in. The guest door lands on this
// path next, which is when an unbounded queue would stop being hypothetical.
//
// It is NOT on the wire. A browser draws whatever the `waiting` frame carries and never divides by
// this, so the protocol package — which takes nothing only one end reads — does not declare it.
export const MAX_MEETING_LOBBY = 100;

/** One person at the door, as the host's panel and the room's own frame paint them. */
export interface MeetingLobbyEntry {
  /** The STAY, which is what every frame on the signaling wire is addressed by. */
  readonly participantId: MeetingAttendanceId;
  readonly userId: UserId;
  readonly displayName: string;
  readonly waitingFrom: string;
}

// WHAT BECAME OF ONE NAMED ARRIVAL, reported per identifier rather than as one answer for the batch.
//
// There is deliberately no server-side "admit everyone" — Admit all sends the identifiers the host's
// panel was showing, because a server-side "all" would admit whoever arrived in the millisecond
// after the host looked at the list, which is precisely the person the host did not decide about. In
// a lobby that exists because somebody might arrive who should not, that is the whole failure. So a
// batch that half-lands has to be legible, and one outcome per identifier is what makes it so.
export const MEETING_ADMISSION_OUTCOMES = Object.freeze([
  // Let in. Their stay carries the instant and they are in the room.
  "admitted",
  // Nobody is at the door under that handle: they gave up, they were denied, or the handle names a
  // stay that is already in the room. One label for all of them, because the host's remedy is the
  // same — read the lobby again.
  "not-waiting",
  // The room filled up before this one got a seat. Named per person, so a host admitting five into
  // two free seats learns which three did not get in rather than meeting one refusal for five.
  "room-full",
] as const);
export type MeetingAdmissionOutcome = (typeof MEETING_ADMISSION_OUTCOMES)[number];

/** The same for a denial, which has no ceiling to meet. */
export const MEETING_DENIAL_OUTCOMES = Object.freeze(["denied", "not-waiting"] as const);
export type MeetingDenialOutcome = (typeof MEETING_DENIAL_OUTCOMES)[number];

/** One decision, paired with the arrival it was about. */
export interface MeetingLobbyDecision<Outcome extends string> {
  readonly participantId: MeetingAttendanceId;
  readonly outcome: Outcome;
}
