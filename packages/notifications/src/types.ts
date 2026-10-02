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
  // Work with somebody's name on it. Separate from `deadlines`, which is what a court or a rule
  // requires of the firm: diluting that category with "call the client back" is how a member stops
  // reading the one whose whole point is that missing an entry is a malpractice event.
  "tasks",
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

// WHAT A MEMBER MAY CHOOSE, per category.
//
// `off` for the in-app channel means NO FEED ROW IS WRITTEN — not "the row is hidden". A suppressed
// notification must not be a row somebody later discovers, and a hidden row is a row that reappears
// the day a filter is loosened by accident. What replaces it is not silence either: the fan-out
// records the suppression as a per-member, per-category tally, so a member who chose not to hear
// something is distinguishable afterwards from a member nobody told.
export const NOTIFICATION_IN_APP_CHOICES = Object.freeze(["on", "off"] as const);
export type NotificationInAppChoice = (typeof NOTIFICATION_IN_APP_CHOICES)[number];

// Email is DIGEST-ONLY, which is why the cadences are periods rather than an "immediate". An email
// per event is a mail-bomb on any active matter, and it inverts the content rule by disclosing the
// timing and volume of activity per matter even when each line says nothing about it. The one
// bypass is a registry-declared `escalation: "immediate"`, which is a property of a KIND and not
// something a member elects.
export const NOTIFICATION_EMAIL_CADENCES = Object.freeze(["off", "daily", "weekly"] as const);
export type NotificationEmailCadence = (typeof NOTIFICATION_EMAIL_CADENCES)[number];

// The cadences that actually compose a summary. `off` is a cadence a member may CHOOSE and never a
// run that happens, so it is excluded here rather than filtered at every call site — and the
// `notification_digest_run` watermark is keyed by one of these two, so a value that cannot be a run
// must not be able to reach that column.
export const NOTIFICATION_DIGEST_CADENCES = Object.freeze(["daily", "weekly"] as const);
export type NotificationDigestCadence = (typeof NOTIFICATION_DIGEST_CADENCES)[number];

// The recommended default set: every category on in app, and mailed daily except the two that are
// about the platform working rather than about the firm's work. A conversion finishing is a thing
// you are watching; a nightly mail about it is a thing you learn to filter, and a channel people
// filter is a channel that has stopped working for the categories that matter.
export const CATEGORIES_DEFAULTING_TO_NO_EMAIL: readonly NotificationCategory[] = Object.freeze([
  "jobs",
  "system",
] as const);

export function defaultEmailCadenceFor(category: NotificationCategory): NotificationEmailCadence {
  return CATEGORIES_DEFAULTING_TO_NO_EMAIL.includes(category) ? "off" : "daily";
}

// Why an in-app row was not written for somebody the audience did reach. A CLOSED LABEL, and the
// only two answers the fan-out can give: the member silenced the category, or the firm's policy did.
// Recorded rather than inferred, because "nobody was told" and "this person asked not to be told"
// are different facts and only one of them is a bug.
export const IN_APP_SUPPRESSION_REASONS = Object.freeze([
  "member-preference",
  "firm-policy",
] as const);
export type InAppSuppressionReason = (typeof IN_APP_SUPPRESSION_REASONS)[number];

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
  // One piece of work with somebody's name on it. The row points at the task and stores nothing
  // about it — no title, no body — because a task title on a matter is the client and the
  // instruction, and this row outlives the access check that justified writing it.
  "matterTask",
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
  // The firm's own trust-compliance designation, read as an audience in its own right — a type
  // declaring it reaches exactly the designated members and nobody else. No type declares it today:
  // what actually ships is the additive rule on the trust CATEGORY, which composes the same list
  // over whatever a kind's own audience already resolved. An unconfigured designation resolves to
  // nobody either way, never to the firm.
  "designated",
  // The matter's responsible member plus everyone holding a currently-valid `matter_assignment` row
  // on it — the people carrying the file right now, ended assignments excluded.
  "matter-team",
  // ONE MEMBER, named by the topic's own payload — the task's assignee, and the first audience here
  // whose recipient is a property of the subject rather than of the matter or the firm.
  //
  // It is resolved from the PAYLOAD and never from the row. The person to tell is whoever was
  // assigned at the moment of the write; if the task has moved on by the time the queue drains, the
  // reassignment raised its own topic for its own recipient, and re-reading the row here would
  // deliver the first notification to the second person and the second one to them again.
  //
  // Deliberately NOT `designated`, which is the firm's trust-compliance designation and resolves to
  // nobody when unconfigured — a task assignment declared that way would deliver to no one, silently.
  "named-recipient",
  // SEVERAL MEMBERS, named by the topic's own payload — the member participants a calendar event
  // named when a meeting was scheduled on it.
  //
  // The plural of `named-recipient` and resolved on exactly its reasoning: from the PAYLOAD, never
  // from the row. The people to invite are the people who were on the event when it was recorded;
  // re-reading the participant rows when the queue drains would invite whoever happens to be on it
  // by then, and would miss whoever was taken off between the two.
  //
  // Deliberately NOT `matter-team`, which is the people carrying the file. Those two lists overlap
  // and are different questions: a hearing appearing on a case is the team's fact, and being asked
  // to be in a room at nine on Tuesday is the fact of the people who were asked.
  "named-members",
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

// How many findings ONE comparison kind may contribute to ONE sweep of ONE firm.
//
// A comparison is unbounded by nature: "every open deadline past its due instant" is a number the
// firm chooses by how it works, not a number the platform chooses, and a register nobody has looked
// at in two years answers in the thousands. So the read is capped and the clamp is COUNTED rather
// than silent — a firm hitting this ceiling every night is a firm being told about two hundred
// things and not being told about the rest, which is a fact an operator has to be able to see.
//
// The cap is per kind rather than per sweep so one runaway comparison cannot starve the others: a
// thousand overdue deadlines must not mean nobody hears about a custody review.
export const MAX_COMPARISON_FINDINGS_PER_KIND = 200;

// How many statements one write from the sweep carries. The sweep composes at most
// MAX_COMPARISON_FINDINGS_PER_KIND events per kind, each with up to MAX_RECIPIENTS_PER_EVENT
// recipient rows, which is far more than belongs in one round trip — so the statements are
// committed in chunks. Chunking rather than one giant batch also means a firm whose database fails
// halfway keeps what already landed, and the dedupe keys make the next pass top up the rest.
export const MAX_SWEEP_STATEMENTS_PER_WRITE = 100;

// How many of a member's un-summarized rows ONE digest run reads.
//
// A digest has no per-item list to truncate — it states counts — so a cap does not cost the reader a
// line. What it costs is precision: past this the counts are reported as "at least N", which is the
// honest reading of a capped page and is why the overrun is carried through the renderer rather than
// silently rounded away. A member back from three weeks' leave is exactly the case this bounds.
export const MAX_DIGEST_ITEMS_PER_RUN = 500;

// How many members ONE firm's digest pass composes for, per cadence. A firm's staff is the natural
// bound and this sits above any plausible one; a pass that hits it is a pass that fanned out to more
// people than the firm employs, which is a resolver fault and is counted rather than mailed.
export const MAX_DIGEST_RECIPIENTS_PER_RUN = 500;

// WHEN a summary lands, in the firm's OWN wall-clock hour rather than UTC's.
//
// A digest that leaves at UTC midnight arrives in the middle of the previous afternoon in Nevada and
// before breakfast in Berlin, which makes "your morning mail" a property of where the platform's
// clock happens to be set. So the hour is the firm's, resolved against the firm's own default
// office, and seven is the default because the mail should be waiting when the day starts rather
// than arriving during it.
export const MIN_DIGEST_LOCAL_HOUR = 0;
export const MAX_DIGEST_LOCAL_HOUR = 23;
export const DEFAULT_DIGEST_LOCAL_HOUR = 7;

// The weekday a weekly summary lands on, as `Date.prototype.getUTCDay` numbers it — Monday. A
// platform constant rather than a firm setting: the hour is the part a firm has an opinion about
// (their working day starts when it starts), and a second knob whose only effect is which morning
// the same counts arrive on is a setting nobody would ever revisit. It is named here so the choice
// is visible and one edit wide if that turns out to be wrong.
export const DIGEST_WEEKLY_LOCAL_WEEKDAY = 1;

// The bounds a firm's retention window may be set within, and the platform default inside them.
// Thirty days is the floor because a member returning from two weeks' leave must still see what
// they missed; a year is the ceiling because an unbounded feed is an unbounded read, and because
// the longer a pointer lives the longer it outlives the access check that justified writing it.
export const MIN_RETENTION_DAYS = 30;
export const MAX_RETENTION_DAYS = 365;
export const DEFAULT_RETENTION_DAYS = 90;
