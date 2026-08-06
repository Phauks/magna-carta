// The emission points a reminder subscribes to, DECLARED and not wired.
//
// Nothing here schedules, queues, or delivers anything: there is no cron, no Workflow, no outbox
// topic, and no recipient resolution in this package. Notifications owns that decision and resolves
// recipients where it lives.
//
// They are named now rather than later for the reason any seam is named early: the write paths they
// raise from are being built in this slice, and adding a raise to an existing write is one line,
// where finding every write path afterwards is archaeology. Two definitions of "what is due" would
// eventually disagree, and the one people act on would be whichever they saw last — so when delivery
// is built it subscribes to these names rather than growing its own.
export const CALENDAR_NOTIFICATION_EMISSION_POINTS = Object.freeze([
  // An open deadline enters the firm's configured lead window.
  "calendar.deadline.horizon",
  // An open deadline is due today.
  "calendar.deadline.due",
  // An open deadline is past due. Raised from the same read-time comparison the calendar shows —
  // never from a stored flag, because there is none.
  "calendar.deadline.overdue",
  "calendar.event.scheduled",
  "calendar.event.rescheduled",
  "calendar.event.cancelled",
] as const);

export type CalendarNotificationEmissionPoint =
  (typeof CALENDAR_NOTIFICATION_EMISSION_POINTS)[number];
