// The emission points a reminder subscribes to.
//
// Nothing here schedules, resolves a recipient, or delivers anything: there is no cron, no Workflow,
// and no recipient resolution in this package. Notifications owns that decision and resolves
// recipients where it lives. What DID change is that three of these names are now real outbox
// topics, written by the matter-event write paths below in the same atomic batch as the change they
// describe — which is a producer's job and stops short of every line above.
//
// The rest are named but wired to nothing, for the reason any seam is named early: adding a raise to
// a write being built is one line, where finding every write path afterwards is archaeology. Two
// definitions of "what is due" would eventually disagree, and the one people act on would be
// whichever they saw last — so a subscriber subscribes to these names rather than growing its own.

// A matter event was recorded. The subject is the event; the payload is identifiers only.
export const CALENDAR_EVENT_SCHEDULED_TOPIC = "calendar.event.scheduled";

// A matter event MOVED. Raised on an edit that changes when the setting happens — its dates, its
// times, or its zone — and NOT on an edit that fixes a title or a room. "Rescheduled" is a claim
// about the real world, and raising it for a typo correction would tell a team a hearing moved when
// it did not; the notification is the one thing a reader acts on without opening the record.
//
// A continuance raises THIS topic, not a new one: the vacate-and-reset IS the reschedule the name
// was chosen for, however the record expresses it. Its subject is the NEW setting, because that is
// the one that is going to happen.
export const CALENDAR_EVENT_RESCHEDULED_TOPIC = "calendar.event.rescheduled";

// A matter event was cancelled outright. A continuance does not raise this even though it cancels a
// row: the hearing is still happening, on another date, and telling a team it was cancelled would be
// false.
export const CALENDAR_EVENT_CANCELLED_TOPIC = "calendar.event.cancelled";

// What the three topics above carry. Identifiers only — never the title, the description, the court
// reference, the location, or a participant's name. A message that crosses a queue and lands in a
// notification row outlives the access check that justified writing it, and a hearing's title on a
// case is routinely the parties and the dispute.
export interface CalendarEventTopicPayload {
  readonly matterEventId: string;
  readonly matterId: string;
}

// A meeting or a call was scheduled on a matter event — the event was recorded with a medium on it,
// and the people named on it are being invited to something they now have to be at.
//
// The meeting ROW belongs to @magna-carta/meetings; the announcement belongs to the act of recording
// an event with a medium, which is this module's subject, and putting the name here is what lets the
// producer and the subscriber import one spelling of it. Two spellings would not throw — an
// unrecognized topic on the per-firm bus is acked and ignored by design — they would just stop
// delivering.
export const CALENDAR_EVENT_MEETING_SCHEDULED_TOPIC = "calendar.event.meetingScheduled";

// What the invitation carries: identifiers, one closed label, and the member handles invited.
//
// `invitedMemberUserIds` is the MEMBER participants named on the event at the write, and nothing
// else. The people to tell are the people who were on it when it was recorded — re-reading the
// participant rows when the queue drains would invite whoever happens to be on the event by then.
// Directory entities are deliberately absent: an external guest has no way in yet, so there is
// nobody to name.
//
// No title, no description, no location and no participant NAME, on the same reasoning the three
// topics above carry none: a message that crosses a queue and lands in a notification row outlives
// the access check that justified writing it.
export interface CalendarEventMeetingScheduledPayload {
  readonly matterEventId: string;
  readonly matterId: string;
  readonly meetingId: string;
  // `video` or `audio`, from the meeting vocabulary. Carried as the closed label it is rather than
  // as a boolean, because "a call" and "a meeting" are the two things a member reads differently.
  readonly medium: string;
  readonly invitedMemberUserIds: readonly string[];
}

// An open deadline is due today, in its OWN zone. Not a topic and never will be: no write in this
// package or anywhere else makes a deadline become due, so there is no batch to ride. It is a
// comparison a sweep performs, and the name exists so the sweep and this package agree on one
// spelling.
export const CALENDAR_DEADLINE_DUE_EMISSION_POINT = "calendar.deadline.due";

// An open deadline is past due — the same read-time comparison the calendar shows, never a stored
// flag, because there is none.
export const CALENDAR_DEADLINE_OVERDUE_EMISSION_POINT = "calendar.deadline.overdue";

export const CALENDAR_NOTIFICATION_EMISSION_POINTS = Object.freeze([
  // An open deadline enters the firm's configured lead window. Unwired: no firm setting names that
  // window yet, and a lead the platform picked for a firm is a lead the firm did not choose.
  "calendar.deadline.horizon",
  CALENDAR_DEADLINE_DUE_EMISSION_POINT,
  CALENDAR_DEADLINE_OVERDUE_EMISSION_POINT,
  CALENDAR_EVENT_SCHEDULED_TOPIC,
  CALENDAR_EVENT_RESCHEDULED_TOPIC,
  CALENDAR_EVENT_CANCELLED_TOPIC,
  CALENDAR_EVENT_MEETING_SCHEDULED_TOPIC,
  // The firm-event write paths, same discipline: declared here, wired to nothing. A firm event has
  // no matter to anchor a notification's visibility to, so it needs the firm-scoped audience
  // question answered before it can be raised.
  "calendar.firmEvent.scheduled",
  "calendar.firmEvent.rescheduled",
  "calendar.firmEvent.cancelled",
  // A booking created or moved into overlap — the warn posture's delivery-shaped half, so the
  // person who holds the colliding booking can hear about it without polling the grid.
  "calendar.booking.conflict",
] as const);

// The subset that is a real outbox topic today. Held separately from the declaration above so
// "which of these actually produces a row" is a compile-time answer rather than a grep.
export const CALENDAR_OUTBOX_TOPICS = Object.freeze([
  CALENDAR_EVENT_SCHEDULED_TOPIC,
  CALENDAR_EVENT_RESCHEDULED_TOPIC,
  CALENDAR_EVENT_CANCELLED_TOPIC,
  // Raised by the route that records an event with a medium on it, rather than by a service in this
  // package: the row it announces is a meeting, which this package does not know about and must not
  // start depending on. The name lives here so the producer and the subscriber cannot spell it two
  // ways, which is the only failure this indirection exists to refuse.
  CALENDAR_EVENT_MEETING_SCHEDULED_TOPIC,
] as const);

export type CalendarOutboxTopic = (typeof CALENDAR_OUTBOX_TOPICS)[number];

export type CalendarNotificationEmissionPoint =
  (typeof CALENDAR_NOTIFICATION_EMISSION_POINTS)[number];
