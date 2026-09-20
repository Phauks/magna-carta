import type {
  FirmEventId,
  MatterEventId,
  MatterId,
  MeetingAttendanceId,
  MeetingId,
  UserId,
} from "@magna-carta/identifiers/types";

// The meeting's vocabularies and its one ceiling. Both vocabularies are also SQLite CHECKs on the
// per-firm schema, so a value that reaches a write without appearing here fails at the database and
// not only at the type checker.

// Which calendar table a meeting hangs from. Two kinds rather than one "event" abstraction, because
// matter events and firm events are separate tables with separate visibility: a matter event is
// reachable when the member may see the matter, a firm event is firm-visible, and a single event
// identity would have to lose one of those two answers.
export const MEETING_EVENT_KINDS = Object.freeze(["matter", "firm"] as const);
export type MeetingEventKind = (typeof MEETING_EVENT_KINDS)[number];

export function isMeetingEventKind(value: string): value is MeetingEventKind {
  return (MEETING_EVENT_KINDS as readonly string[]).includes(value);
}

// Where a room is in its life. `scheduled` is a room nobody has walked into — the row exists because
// somebody pressed Start, which is not the same as somebody being in it; `live` is set by the FIRST
// join rather than by the creation, so a host who starts a meeting and is then called away leaves a
// record saying exactly that; `ended` is terminal, because the attendance rows under a meeting
// describe one gathering and a second gathering is a second room.
export const MEETING_STATUSES = Object.freeze(["scheduled", "live", "ended"] as const);
export type MeetingStatus = (typeof MEETING_STATUSES)[number];

export function isMeetingStatus(value: string): value is MeetingStatus {
  return (MEETING_STATUSES as readonly string[]).includes(value);
}

// SOUND ALONE, OR SOUND AND PICTURES — and an audio call is a kind of meeting rather than a second
// subsystem. Same record, same room, same screen; what differs is what may be published into it and
// what a tile shows. Chosen at Start and NEVER CHANGED, which is the part worth stating: the people
// already in the room agreed to one thing, and a medium that could be widened mid-gathering would be
// a camera switched on for everybody by somebody else's click. Also a SQLite CHECK on the meeting
// row, so a value that reaches a write without appearing here fails at the database too.
export const MEETING_MEDIA = Object.freeze(["video", "audio"] as const);
export type MeetingMedium = (typeof MEETING_MEDIA)[number];

export function isMeetingMedium(value: string): value is MeetingMedium {
  return (MEETING_MEDIA as readonly string[]).includes(value);
}

// THE THREE QUESTIONS A MEETINGS SCREEN ASKS, as a closed vocabulary. Not filters over one list:
// each wants its own ordering — longest-running first, soonest first, most-recently-finished first —
// so a single ordering would make two of the three answers wrong. A fourth scope is a fourth
// ordering and belongs here rather than as a flag on one of these.
export const MEETING_LIST_SCOPES = Object.freeze(["live", "upcoming", "recent"] as const);
export type MeetingListScope = (typeof MEETING_LIST_SCOPES)[number];

// HOW A STAY ENDED, as a closed vocabulary on the departure audit row. Two ways and only two: the
// member said so, or their connection went and did not come back inside the grace the room allows.
// One event name with a labelled reason rather than two event names, because the question a record is
// read for is "when did they stop being in the room" and the label is the footnote to it — a second
// event would split every such read in half. It is a label and never a diagnosis: which network
// failed is not the firm's record of who was in a meeting.
export const MEETING_DEPARTURE_REASONS = Object.freeze(["left", "socket-lost"] as const);
export type MeetingDepartureReason = (typeof MEETING_DEPARTURE_REASONS)[number];

// THE ROOM'S CEILING, counted over the open attendance rows rather than over the sockets.
//
// Twelve is a product decision and not a limit of the routing layer: the selective forwarding unit
// scales far past it, but the tile layout, the bandwidth adaptation and the active-speaker detection
// that make a large room usable are their own work. A cap that refuses the thirteenth person with a
// clear reason is honest; a room that admits fifty and degrades for all of them is not.
//
// Counted over ATTENDANCE, which is what makes the number mean anything: a participant is somebody
// with an open stay, so a browser that reconnects occupies one seat rather than two, and a member
// who closed their laptop without leaving frees theirs when the meeting ends.
export const MAX_MEETING_PARTICIPANTS = 12;

// ---------------------------------------------------------------------------------------------
// The stored rows, in the database's own column names.
// ---------------------------------------------------------------------------------------------

// A meeting carries nothing the event already carries: no title, no time, no participant list. What
// it adds is the three facts the event cannot supply — that somebody started it, when the first
// person actually arrived, and when it ended.
export interface MeetingRow {
  readonly id: MeetingId;
  readonly event_kind: MeetingEventKind;
  // Sound alone, or sound and pictures. Set at creation and never updated.
  readonly medium: MeetingMedium;
  // Exactly one of these is set, and `event_kind` says which. The database holds the pairing; a
  // reader never has to test both columns to learn what it is looking at.
  readonly matter_event_id: MatterEventId | null;
  readonly firm_event_id: FirmEventId | null;
  readonly status: MeetingStatus;
  readonly created_by_user_id: UserId;
  // When the first person arrived, which is neither when the row was created nor when the event was
  // scheduled for. Null until somebody joins.
  readonly started_at: string | null;
  readonly ended_at: string | null;
  readonly ended_by_user_id: UserId | null;
  readonly created_at: string;
  readonly updated_at: string;
}

// One person's stay in one room. A ROW PER STAY, never a flag per person: somebody whose connection
// drops and who dials back in was in the room twice, and a record that collapsed the two would say
// they were present through a gap they were absent for.
export interface MeetingAttendanceRow {
  readonly id: MeetingAttendanceId;
  readonly meeting_id: MeetingId;
  readonly user_id: UserId;
  readonly joined_at: string;
  // Null while the person is still in the room. Ending the meeting closes every open row at one
  // instant, so a member who never pressed Leave still has an end rather than a stay running forever.
  readonly left_at: string | null;
  readonly created_at: string;
  readonly updated_at: string;
}

// The event's own facts, resolved by the read rather than copied onto the meeting row. A firm event
// has no matter, which is why `matter_id` is nullable here and why the permission keys bind the firm.
export interface MeetingEventRow {
  readonly event_id: string;
  readonly matter_id: MatterId | null;
  readonly title: string;
  readonly starts_on: string; // civil date, YYYY-MM-DD
  readonly starts_at_time: string | null; // HH:MM wall clock; null on an all-day entry
  readonly ends_at_time: string | null;
  readonly time_zone: string; // IANA zone the wall-clock time is read in
}

// ---------------------------------------------------------------------------------------------
// What a surface is given.
// ---------------------------------------------------------------------------------------------

// The meeting plus the event facts a screen has to paint beside it, and the count of who is in the
// room right now. The count is derived from the open attendance rows on every read rather than kept
// as a column, because a stored count is a second answer to a question the rows already answer, and
// the two disagree the first time a socket closes without a leave.
//
// WHETHER MEETINGS ARE CONFIGURED AT ALL is deliberately not here. That is a fact about the Worker's
// bindings — whether the routing credentials exist — and this package holds no binding and reads no
// environment, so the route that knows the answer carries it beside this summary rather than inside
// it.
export interface MeetingSummary {
  readonly id: MeetingId;
  readonly eventKind: MeetingEventKind;
  readonly medium: MeetingMedium;
  readonly eventId: string;
  readonly matterId: MatterId | null;
  readonly title: string;
  readonly startsOn: string;
  readonly startsAtTime: string | null;
  readonly endsAtTime: string | null;
  readonly timeZone: string;
  readonly status: MeetingStatus;
  readonly startedAt: string | null;
  readonly endedAt: string | null;
  readonly liveCount: number;
}
