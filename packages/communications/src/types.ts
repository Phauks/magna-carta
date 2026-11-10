// The call and text log's vocabularies and ceilings. Every closed vocabulary here is also a SQLite
// CHECK on the per-firm schema, so a value that reaches a write without appearing here fails at the
// database and not only at the type checker.

// The channels a conversation arrives on. Email is deliberately absent and its absence is the
// subsystem's defining decision, not an omission: mail lives in the firm's own mailbox and is FILED
// onto a matter from there, so its verb is route-what-exists. A call leaves no trace at all unless
// the platform makes one, so the verb here is cause-a-record-to-exist.
export const COMMUNICATION_CHANNELS = Object.freeze(["voice", "sms", "mms"] as const);
export type CommunicationChannel = (typeof COMMUNICATION_CHANNELS)[number];

// The channels a PERSON may choose between when recording one by hand, which is a shorter list than
// the one above and deliberately so (owner ruling, 2026-09-08): a firm records a call or a text, and
// a picture is a text that happens to carry a picture rather than a third kind of thing to decide
// between. `mms` stays in the vocabulary because a carrier will hand us one and the log has to hold
// it; what it is not is a choice a form asks anybody to make.
export const LOGGABLE_COMMUNICATION_CHANNELS = Object.freeze(["voice", "sms"] as const);
export type LoggableCommunicationChannel = (typeof LOGGABLE_COMMUNICATION_CHANNELS)[number];

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
// queue of rows with no matter at all AND no disposition, which is the firm-wide screen's real work
// and is gated by its own permission; `routed` is everything already filed, which is what a member
// reviewing the week's traffic wants; `setAside` is what somebody decided belongs to no matter at
// all. The matter's own section does not use this axis at all — it names a matter, and a matter
// narrows harder than any scope here.
//
// WHY `unrouted` EXCLUDES THE SET-ASIDE ROWS. The queue is a list somebody is meant to empty. A
// wrong number that will never belong to a matter would sit in it forever, and a queue that cannot
// be emptied is a queue nobody works — which is the whole reason a disposition exists.
export const COMMUNICATION_SCOPES = Object.freeze([
  "all",
  "routed",
  "unrouted",
  "setAside",
] as const);
export type CommunicationScope = (typeof COMMUNICATION_SCOPES)[number];

export function isCommunicationScope(value: string): value is CommunicationScope {
  return (COMMUNICATION_SCOPES as readonly string[]).includes(value);
}

// ---------------------------------------------------------------------------------------------
// What a call or a text was, when it was not a matter's business.
// ---------------------------------------------------------------------------------------------

// The alternative to a matter, and the reason it exists (owner ruling, 2026-09-08): not every call a
// firm takes is about a case. Some are spam or a wrong number, some are the firm's own business —
// the landlord, the bar association, a vendor — and some are a real prospect who never came back.
// None of those can be filed onto a matter, because there is no matter; before this vocabulary
// existed they had nowhere to go but the queue, where they stayed forever.
//
// SO A ROW HAS EXACTLY ONE ANCHOR: a matter, a disposition, or neither while nobody has decided.
// Never both — "this is spam AND it is on the Whitfield matter" is not a fact anybody can act on,
// and the pair would make every read ask which of the two to believe.
export const COMMUNICATION_DISPOSITIONS = Object.freeze([
  "spam",
  "firmBusiness",
  "noAction",
] as const);
export type CommunicationDisposition = (typeof COMMUNICATION_DISPOSITIONS)[number];

export function isCommunicationDisposition(value: string): value is CommunicationDisposition {
  return (COMMUNICATION_DISPOSITIONS as readonly string[]).includes(value);
}

// ---------------------------------------------------------------------------------------------
// What happened on the line.
// ---------------------------------------------------------------------------------------------

// THE OUTCOME OF A CALL, which is a different fact from where its record is filed (owner ruling,
// 2026-11-09: the Activity a call records, in formal words, with spam among them). Each direction has
// its own set, because what can happen to a call the firm took and to one it placed are different
// things: an incoming call is answered, passed to somebody else, left as a message, or was never a
// real call at all; an outgoing one reached somebody, reached their voicemail, or rang out.
export const INBOUND_CALL_OUTCOMES = Object.freeze([
  "answered",
  "transferred",
  "messageTaken",
  "spam",
] as const);
export const OUTBOUND_CALL_OUTCOMES = Object.freeze([
  "connected",
  "voicemailLeft",
  "noAnswer",
] as const);
export const CALL_OUTCOMES = Object.freeze([
  ...INBOUND_CALL_OUTCOMES,
  ...OUTBOUND_CALL_OUTCOMES,
] as const);
export type CallOutcome = (typeof CALL_OUTCOMES)[number];

export function isCallOutcome(value: string): value is CallOutcome {
  return (CALL_OUTCOMES as readonly string[]).includes(value);
}

// The outcomes that need no notes and no length to be worth recording. A call that rang out, or one
// that was a robocall, is fully described by saying so, and refusing it until somebody types a
// summary would teach people to type "spam" into the summary instead.
export const SELF_DESCRIBING_OUTCOMES: ReadonlySet<CallOutcome> = new Set([
  "spam",
  "noAnswer",
  "voicemailLeft",
] as const);

// Which kind of unwanted call it was. Counted apart when the same number rings again, because a
// wrong number is an honest mistake and a scam is a warning.
export const SPAM_KINDS = Object.freeze(["sales", "wrongNumber", "scam"] as const);
export type SpamKind = (typeof SPAM_KINDS)[number];

export function isSpamKind(value: string): value is SpamKind {
  return (SPAM_KINDS as readonly string[]).includes(value);
}

// The name a caller gave, as somebody typed it. A name, not a paragraph.
export const MAX_CALLER_ID_NAME_LENGTH = 200;
