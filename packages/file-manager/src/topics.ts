// The outbox topics this package publishes, as one frozen set.
//
// They were literals at their write sites until something subscribed to them. A subscriber that
// spells a topic itself is a subscriber that can spell it differently — and the failure mode is
// silent, because an unrecognized topic on the per-firm bus is acked and ignored by design, so a
// typo does not throw, it just quietly stops delivering. Naming them once here makes the producer
// and every consumer share one spelling, and makes "does this topic exist" a compile-time question.
export const FILE_VERSION_COMMITTED_TOPIC = "file.version_committed";
export const FILE_QUARANTINED_TOPIC = "file.quarantined";
export const FILE_RESCAN_INFECTED_TOPIC = "file.rescan_infected";
export const DOCUMENT_CHECKED_IN_TOPIC = "document.checked_in";
export const DOCUMENT_CHECKIN_CONFLICT_TOPIC = "document.checkin_conflict";

export const FILE_MANAGER_OUTBOX_TOPICS = Object.freeze([
  FILE_VERSION_COMMITTED_TOPIC,
  FILE_QUARANTINED_TOPIC,
  FILE_RESCAN_INFECTED_TOPIC,
  DOCUMENT_CHECKED_IN_TOPIC,
  DOCUMENT_CHECKIN_CONFLICT_TOPIC,
] as const);

export type FileManagerOutboxTopic = (typeof FILE_MANAGER_OUTBOX_TOPICS)[number];
