// The closed vocabularies this subsystem is built out of, and the caps its reads and fan-outs obey.
// Every one of them is also a SQLite CHECK on the per-firm schema, so a value that reaches a write
// without appearing here fails at the database and not only at the type checker.

// The grain a member actually thinks in, and the grain preferences are set at. NOT per kind: the
// registry will carry thirty-plus kinds, and a member asked to toggle thirty switches toggles none.
// The registry type model still carries a per-kind slot so the finer grain is reachable later
// without a schema change.
export const NOTIFICATION_CATEGORIES = Object.freeze([
  "deadlines",
  "calendar",
  "trust",
  "billing",
  "documents",
  "custody",
  "email",
  "conflicts",
  "jobs",
  "security",
  "system",
] as const);
export type NotificationCategory = (typeof NOTIFICATION_CATEGORIES)[number];

// The two categories a member may not silence IN APP. They mirror the non-optional stance of the
// audit log: a firm cannot be in a position where nobody was told about a trust movement because
// everybody switched it off. Mandatory binds the in-app channel only — a member may still set
// either category's email cadence to off, because forcing a copy into a mailbox is a different act
// from putting a row in a feed the platform controls.
export const MANDATORY_CATEGORIES: readonly NotificationCategory[] = Object.freeze([
  "security",
  "trust",
] as const);

export const NOTIFICATION_SEVERITIES = Object.freeze([
  "informational",
  "attention",
  "critical",
] as const);
export type NotificationSeverity = (typeof NOTIFICATION_SEVERITIES)[number];

// The kind of record a notification points at. Seeded with every subject the inventoried emission
// points name rather than only the wired ones, because the column carrying it is a SQLite CHECK and
// widening one rebuilds a growing table.
export const NOTIFICATION_SUBJECT_KINDS = Object.freeze([
  "matter",
  "matterEvent",
  "matterDeadline",
  "matterAsset",
  "invoice",
  "ledgerEntry",
  "trustMovement",
  "file",
  "fileVersion",
  "documentCheckout",
  "directoryEntity",
  "location",
  "shipment",
  "emailMessage",
  "emailCaptureAddress",
  "custodyPacket",
  "custodyItem",
  "custodyMovement",
  "conflictsCheck",
  "incident",
  "magnusConversation",
  "reviewSet",
  "discoveryLoad",
  "conversionJob",
  "documentAssembly",
  "bundleBuild",
  "searchIndexJob",
  "recoveryJob",
  "member",
] as const);
export type NotificationSubjectKind = (typeof NOTIFICATION_SUBJECT_KINDS)[number];

export const NOTIFICATION_RECIPIENT_STATES = Object.freeze([
  "unread",
  "read",
  "dismissed",
] as const);
export type NotificationRecipientState = (typeof NOTIFICATION_RECIPIENT_STATES)[number];

// Channels a copy can leave the platform on. `in_app` is present because the value is seeded into
// the schema CHECK, and is deliberately never written: the feed is not delivered, it is read.
export const NOTIFICATION_CHANNELS = Object.freeze([
  "in_app",
  "email",
  "push",
  "sms",
  "desktop",
] as const);
export type NotificationChannel = (typeof NOTIFICATION_CHANNELS)[number];

export const NOTIFICATION_DELIVERY_STATES = Object.freeze([
  "pending",
  "sent",
  "failed",
  "suppressed",
] as const);
export type NotificationDeliveryState = (typeof NOTIFICATION_DELIVERY_STATES)[number];

// Why a copy was not sent. A CLOSED LABEL and never a sentence: `not-visible` records that
// something was withheld without recording what, which is the difference between a support record
// and an existence oracle.
export const NOTIFICATION_SUPPRESSED_REASONS = Object.freeze([
  "preference",
  "not-visible",
  "no-address",
  "policy",
] as const);
export type NotificationSuppressedReason = (typeof NOTIFICATION_SUPPRESSED_REASONS)[number];

// Who a type reaches. A closed set, because "whoever the code decides" is how a fan-out ends up
// mailing a firm's whole staff about one paralegal's checkout conflict.
export const NOTIFICATION_AUDIENCES = Object.freeze([
  // matter.responsible_member_id — one read.
  "responsible-member",
  // Whoever performed the act, for the confirmations where that is genuinely the point.
  "actor",
  // Members whose effective permissions include a capability the type declares. This is how the
  // trust category reaches whoever can act on trust rather than whoever happens to be nearby.
  "capability-holders",
  // A firm-tier designation. Resolves to nobody until the designation setting is built.
  "designated",
  // The matter's responsible member plus everyone holding a currently-valid `matter_assignment` row
  // on it — the people carrying the file right now, ended assignments excluded.
  "matter-team",
] as const);
export type NotificationAudience = (typeof NOTIFICATION_AUDIENCES)[number];

// Whether a kind may bypass the digest. Digest is the default and very nearly the rule: an email
// per event is a mail-bomb on any active matter, and it inverts the content argument by disclosing
// the timing and volume of activity per matter even when each line says nothing. `immediate` is
// reserved for the kinds where a day's delay is a compliance failure rather than an inconvenience.
export const NOTIFICATION_ESCALATIONS = Object.freeze(["digest", "immediate"] as const);
export type NotificationEscalation = (typeof NOTIFICATION_ESCALATIONS)[number];

// The categories allowed to declare `escalation: "immediate"`. Trust-compliance and security only —
// a fitness test holds the registry to it, so widening this is a deliberate edit here and never an
// accident in a type declaration.
export const IMMEDIATE_ESCALATION_CATEGORIES: readonly NotificationCategory[] = Object.freeze([
  "trust",
  "security",
] as const);

// How much of itself a kind may put in an email.
//
// `category-count` says the email states the SHAPE of the queue and never its contents: a count in
// a category, and nothing about which matter, which client, which document, or how much. Every
// matter-anchored kind takes it, and a fitness test proves that rather than trusting it. The reason
// in-app and email differ is not squeamishness: in-app, every read is behind the session, the
// chokepoint, and the visible-matter predicate, so a row rendered to the wrong person is a bug with
// a fix — where an email is a copy handed to infrastructure the platform does not control, retained
// by a provider the firm did not choose, forwarded, backed up, rendered on lock screens, and
// decisively CANNOT BE RE-FILTERED when access changes. The only content safe against a future
// access change is content that never depended on access, which is exactly what a count is.
//
// `recipient-scoped` is the carve-out and is scoped precisely: kinds with no matter anchor that are
// ABOUT THE PERSON READING THEM — a new sign-in, an invite, a support-access grant. They already
// send full content through the same port today and there is no client whose confidence a fuller
// sentence would spend.
export const NOTIFICATION_EMAIL_CONTENTS = Object.freeze([
  "category-count",
  "recipient-scoped",
] as const);
export type NotificationEmailContent = (typeof NOTIFICATION_EMAIL_CONTENTS)[number];

// How much detail a firm's ceiling permits an email to carry, most private first. The ORDER is
// load-bearing: a member may choose any level at or below their firm's ceiling and never above it,
// and `emailDetailLevelAtMost` below is the only place that comparison is made.
//
// `matter-number` is DECLARED AND NOT BUILT. It is in the vocabulary because the ceiling is a
// stored value and a firm that has chosen it must not have that choice silently rewritten when the
// level ships; nothing renders it today, and a resolved level of `matter-number` behaves as
// `counts-only` at the renderer until it does.
export const EMAIL_DETAIL_LEVELS = Object.freeze(["off", "counts-only", "matter-number"] as const);
export type EmailDetailLevel = (typeof EMAIL_DETAIL_LEVELS)[number];

// The more private of two levels. A member's choice and a firm's ceiling compose through this and
// nowhere else, so "a member may only pick more private than the ceiling" is one implementation
// rather than a rule two call sites can drift on.
export function moreCautiousEmailDetailLevel(
  first: EmailDetailLevel,
  second: EmailDetailLevel,
): EmailDetailLevel {
  return EMAIL_DETAIL_LEVELS.indexOf(first) <= EMAIL_DETAIL_LEVELS.indexOf(second) ? first : second;
}

// The feed page cap. A page is bounded by this and never by the firm's data.
export const MAX_FEED_PAGE_SIZE = 50;

// The per-event fan-out cap. A fan-out larger than a firm's staff means a resolver bug, and the cap
// turns that into a counter instead of a mail storm. Clamping is recorded, never silent.
export const MAX_RECIPIENTS_PER_EVENT = 200;

// The bounds a firm's retention window may be set within, and the platform default inside them.
// Thirty days is the floor because a member returning from two weeks' leave must still see what
// they missed; a year is the ceiling because an unbounded feed is an unbounded read, and because
// the longer a pointer lives the longer it outlives the access check that justified writing it.
export const MIN_RETENTION_DAYS = 30;
export const MAX_RETENTION_DAYS = 365;
export const DEFAULT_RETENTION_DAYS = 90;
