// The call and text log's vocabularies and ceilings. Every closed vocabulary here is also a SQLite
// CHECK on the per-firm schema, so a value that reaches a write without appearing here fails at the
// database and not only at the type checker.

// The channels a conversation arrives on. Email is deliberately absent and its absence is the
// subsystem's defining decision, not an omission: mail lives in the firm's own mailbox and is FILED
// onto a matter from there, so its verb is route-what-exists. A call leaves no trace at all unless
// the platform makes one, so the verb here is cause-a-record-to-exist.
export const COMMUNICATION_CHANNELS = Object.freeze(["voice", "sms", "mms"] as const);
export type CommunicationChannel = (typeof COMMUNICATION_CHANNELS)[number];

export function isCommunicationChannel(value: string): value is CommunicationChannel {
  return (COMMUNICATION_CHANNELS as readonly string[]).includes(value);
}

export const COMMUNICATION_DIRECTIONS = Object.freeze(["inbound", "outbound"] as const);
export type CommunicationDirection = (typeof COMMUNICATION_DIRECTIONS)[number];

export function isCommunicationDirection(value: string): value is CommunicationDirection {
  return (COMMUNICATION_DIRECTIONS as readonly string[]).includes(value);
}

// How the row came to exist. A member's recollection of a call and a carrier's report of the same
// call carry different weight, and a reader who cannot tell them apart will trust the wrong one —
// which is why this is a stored column rather than something inferred from which fields are filled.
//
// Only `member` is written today. `carrier` is in the set from the start because the whole point of
// the log's shape is that the adapter writes the SAME row later; a vocabulary that had to be widened
// for it would mean the seam was never really there.
export const COMMUNICATION_PRODUCERS = Object.freeze(["member", "carrier"] as const);
export type CommunicationProducer = (typeof COMMUNICATION_PRODUCERS)[number];

export function isCommunicationProducer(value: string): value is CommunicationProducer {
  return (COMMUNICATION_PRODUCERS as readonly string[]).includes(value);
}

// The channels that carry text. Kept as its own set rather than spelled out at each call site,
// because the body/channel CHECK, the validator and the search source all have to agree about it.
export const TEXT_CHANNELS: ReadonlySet<CommunicationChannel> = new Set(["sms", "mms"] as const);

export function isTextChannel(channel: CommunicationChannel): boolean {
  return TEXT_CHANNELS.has(channel);
}

// Ceilings. A message body is bounded well above the carrier's own segment limits, because an MMS
// carries more than an SMS and a thread's worth of text may arrive as one part; a summary is what a
// member writes about a call and is the longer of the two on purpose, since it is the whole content
// of a hand-logged call.
export const MAX_COMMUNICATION_BODY_LENGTH = 5_000;
export const MAX_COMMUNICATION_SUMMARY_LENGTH = 10_000;
export const MAX_COUNTERPARTY_NUMBER_LENGTH = 32;

// A day of seconds. A call longer than this is a mistyped duration rather than a call — the longest
// recorded telephone call in the world is shorter — and the refusal costs nothing to a real caller.
export const MAX_CALL_DURATION_SECONDS = 86_400;

// The default and maximum page a list read returns. The firm-wide screen is a queue people work
// through rather than a corpus they scroll, so the default is the smaller of the two.
export const DEFAULT_COMMUNICATION_PAGE_SIZE = 50;
export const MAX_COMMUNICATION_PAGE_SIZE = 200;

// What a list read is asked to cover. `all` is every row the reader may see; `unrouted` is the
// queue of rows with no matter at all, which is the firm-wide screen's real work and is gated by its
// own permission; `routed` is everything already filed, which is what a member reviewing the week's
// traffic wants. The matter's own section does not use this axis at all — it names a matter, and a
// matter narrows harder than any scope here.
export const COMMUNICATION_SCOPES = Object.freeze(["all", "routed", "unrouted"] as const);
export type CommunicationScope = (typeof COMMUNICATION_SCOPES)[number];

export function isCommunicationScope(value: string): value is CommunicationScope {
  return (COMMUNICATION_SCOPES as readonly string[]).includes(value);
}
