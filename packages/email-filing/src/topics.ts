// The outbox topics this package's write paths publish, as one frozen set — the same shape
// packages/matters/src/topics.ts and packages/conflicts/src/topics.ts hold, for the same reason: an
// unrecognized topic on the per-firm bus is acked and ignored by design, so a misspelt subscription
// does not throw, it silently stops delivering. Naming a topic once makes that a compile-time
// question instead of a production one.

// An email reached a matter — a link entered `filed`, by a member accepting a staged link or by the
// capture path filing on arrival. Written in the SAME atomic batch as the link change it describes,
// so the row is proof the filing committed rather than a best-effort announcement beside it. That is
// what makes this a topic and not an in-process raise: a raise fires for a batch that rolled back,
// and it fires only for whichever call site remembered to make it.
//
// The payload is the two identifiers and nothing else. A subject line is the single most disclosive
// string an email carries — it is frequently the client's name, the opposing party, or the substance
// of the advice — and a message that crosses a queue and lands in a notification row outlives the
// access check that justified writing it. Whatever needs the subject resolves it behind a deep link
// through this subsystem's own access-checked read.
export const EMAIL_FILED_TOPIC = "email.filed";

export interface EmailFiledPayload {
  readonly emailMessageId: string;
  readonly matterId: string;
}

export const EMAIL_FILING_OUTBOX_TOPICS = Object.freeze([EMAIL_FILED_TOPIC] as const);

export type EmailFilingOutboxTopic = (typeof EMAIL_FILING_OUTBOX_TOPICS)[number];
