// The outbox topics this package publishes, as one frozen set.
//
// They were literals at their write sites until something subscribed to them. A subscriber that
// spells a topic itself is a subscriber that can spell it differently — and the failure mode is
// silent, because an unrecognized topic on the per-firm bus is acked and ignored by design, so a
// typo does not throw, it just quietly stops delivering. Naming them once here makes the producer
// and every consumer share one spelling, and makes "does this topic exist" a compile-time question.
export const MATTER_CREATED_TOPIC = "matter.created";
export const MATTER_OPENED_TOPIC = "matter.opened";
export const MATTER_CLOSED_TOPIC = "matter.closed";
export const MATTER_REOPENED_TOPIC = "matter.reopened";
export const MATTER_UPDATED_TOPIC = "matter.updated";
export const MATTER_RENUMBERED_TOPIC = "matter.renumbered";

export const MATTER_OUTBOX_TOPICS = Object.freeze([
  MATTER_CREATED_TOPIC,
  MATTER_OPENED_TOPIC,
  MATTER_CLOSED_TOPIC,
  MATTER_REOPENED_TOPIC,
  MATTER_UPDATED_TOPIC,
  MATTER_RENUMBERED_TOPIC,
] as const);

export type MatterOutboxTopic = (typeof MATTER_OUTBOX_TOPICS)[number];
