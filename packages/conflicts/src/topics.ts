// The outbox topics this package publishes, as one frozen set — the same shape
// packages/directory/src/topics.ts and packages/matters/src/topics.ts hold, for the same reason: an
// unrecognized topic on the per-firm bus is acked and ignored by design, so a misspelt subscription
// does not throw, it silently stops delivering. Naming a topic once makes that a compile-time
// question instead of a production one.

// A matter has accumulated at least one unsatisfied re-check request. Written in the same atomic
// batch as the ledger rows themselves, so the message is proof those rows committed.
//
// This is deliberately a SIGNAL, not a work item: it carries the matter and nothing about the causes.
// The run consumer re-reads the matter's open ledger rows when it gets there and covers every one of
// them, so a message that arrives late, twice, or after the cron backstop already drained the matter
// resolves to the truth in the table rather than to whatever was true when it was written.
export const CONFLICTS_RECHECK_REQUESTED_TOPIC = "conflicts.recheck.requested";

// An automated check surfaced something a person has not seen. Emitted by the check writer and only
// when there is something to say (a tier 1-2 hit, or a matter's first hit ever) — a check a person
// asked for never emits it, because the person who asked is looking at the result.
//
// The notification registry SUBSCRIBES to this; it does not produce it. Everything the notification
// may carry is already on this payload as counts, so nothing downstream has to query for it and no
// entity name, matched field, or identifier ever leaves this package.
export const CONFLICTS_HIT_SURFACED_TOPIC = "conflicts.hit.surfaced";

export const CONFLICTS_OUTBOX_TOPICS = Object.freeze([
  CONFLICTS_RECHECK_REQUESTED_TOPIC,
  CONFLICTS_HIT_SURFACED_TOPIC,
] as const);

export type ConflictsOutboxTopic = (typeof CONFLICTS_OUTBOX_TOPICS)[number];
