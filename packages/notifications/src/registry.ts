import type { KnownPermission } from "@magna-carta/access-control/registry";
import {
  CALENDAR_DEADLINE_DUE_EMISSION_POINT,
  CALENDAR_DEADLINE_OVERDUE_EMISSION_POINT,
  CALENDAR_EVENT_CANCELLED_TOPIC,
  CALENDAR_EVENT_MEETING_SCHEDULED_TOPIC,
  CALENDAR_EVENT_RESCHEDULED_TOPIC,
  CALENDAR_EVENT_SCHEDULED_TOPIC,
} from "@magna-carta/calendar/notifications";
import { MEETING_MEDIA, isMeetingMedium } from "@magna-carta/meetings/types";
import { CONFLICTS_HIT_SURFACED_TOPIC } from "@magna-carta/conflicts/topics";
import { INVOICE_VOIDED_TOPIC } from "@magna-carta/billing/draft";
import { INVOICE_FINALIZED_TOPIC } from "@magna-carta/billing/finalize";
import { EMAIL_FILED_TOPIC } from "@magna-carta/email-filing/topics";
import {
  DOCUMENT_CHECKIN_CONFLICT_TOPIC,
  FILE_QUARANTINED_TOPIC,
  FILE_RESCAN_INFECTED_TOPIC,
} from "@magna-carta/file-manager/topics";
import { LEDGER_ENTRY_POSTED_TOPIC } from "@magna-carta/ledger/post-entry";
import {
  MATTER_CLOSED_TOPIC,
  MATTER_HELD_TOPIC,
  MATTER_RELEASED_TOPIC,
  MATTER_REOPENED_TOPIC,
} from "@magna-carta/matters/topics";
import {
  FIRM_TASK_ASSIGNED_TOPIC,
  FIRM_TASK_REASSIGNED_TOPIC,
  TASK_ASSIGNED_TOPIC,
  TASK_REASSIGNED_TOPIC,
  FIRM_WATCHED_TASK_CHANGED_TOPIC,
  WATCHED_TASK_CHANGED_TOPIC,
  WATCHED_TASK_CHANGES,
  FIRM_TASK_COMMENTED_TOPIC,
  FIRM_TASK_COMMENT_MENTIONED_TOPIC,
  TASK_COMMENTED_TOPIC,
  TASK_COMMENT_MENTIONED_TOPIC,
} from "@magna-carta/tasks/notifications";
import { TASK_PRIORITIES } from "@magna-carta/tasks/types";
import {
  CUSTODY_CHECKOUT_OVERDUE_EMISSION_POINT,
  CUSTODY_OVERDUE_BUCKETS,
  CUSTODY_REVIEW_DUE_EMISSION_POINT,
  DOCUMENT_ASSEMBLY_COMPLETED_EMISSION_POINT,
  RECOVERY_JOB_COMPLETED_EMISSION_POINT,
  RECOVERY_JOB_OUTCOMES,
} from "./emission-points.ts";
import type { FactsSchema, Facts } from "./facts-grammar.ts";
import type {
  NotificationAudience,
  NotificationCategory,
  NotificationChannel,
  NotificationEmailContent,
  NotificationEscalation,
  NotificationSeverity,
  NotificationSubjectKind,
} from "./types.ts";
import { MANDATORY_CATEGORIES } from "./types.ts";

// THE REGISTRY: one declaration per kind of thing a member can be told about, and the reason this
// subsystem is a registry rather than a switch statement.
//
// Everything a delivery decision needs is DECLARED here — who hears it, what it may carry, whether
// it is anchored to a matter, whether it may bypass the digest, and how much of itself it may put
// in an email — so a new kind is one entry and never a change to the translator, the reader, the
// fan-out, or the sweep. The fitness tests in test/registry-fitness.test.ts hold every declaration
// to the rules, which is what makes "the registry owns the decision" a property rather than a
// sentence.
//
// A type SUBSCRIBES; it never produces. Thirty-one topics already commit a durable outbox row in
// the same atomic batch as the write that produced them, so the outbox row IS the emission. A
// second row beside it would be a weaker copy of a guarantee that already holds, and would double
// the write amplification of every money movement in the platform.

// How a materializer gets to the matter that anchors a notification's visibility.
export type MatterResolution =
  // The topic's payload names it outright — one field read, no query.
  | { readonly kind: "payload"; readonly payloadKey: string }
  // The payload names the subject and the matter is one bounded lookup away. The SQL is a
  // code-supplied constant, never assembled from a payload value; it takes the subject handle as
  // its single binding and returns at most one `matter_id`. This runs in the queue consumer, off
  // every request path and off every emitting write path.
  | { readonly kind: "query"; readonly sql: string }
  // Genuinely firm-scoped: there is no matter, and inventing one would put the row behind a filter
  // it must not be behind.
  | { readonly kind: "none" };

// WHICH PRODUCTION PATH RAISES A TYPE, and the reason the registry has to say rather than infer.
//
// `outbox-topic` is a subscription: something already committed a durable row in the same batch as
// the write, and this subsystem reads the bus. `comparison-sweep` is not — "this deadline is
// overdue" is a subtraction nobody performs, so there is no batch to ride and no row to subscribe
// to; a scheduled pass materializes what a comparison returns. `job-coordinator` is a third shape
// again: a terminal state a Durable Object reaches, which has no firm-database batch of its own.
//
// Inferring this from the name would be guessing. Declaring it lets `notificationTypesForTopic`
// index only what actually arrives on the bus, so a comparison kind can never be matched by a topic
// that happens to share its spelling — and lets each path's own fitness test check the right rule.
export type NotificationRaisedBy = "outbox-topic" | "comparison-sweep" | "job-coordinator";

export interface NotificationType {
  // The stable key. A WIRE CONTRACT once shipped: it appears in feed responses and in the `kind`
  // filter, and it is what the `notification_event.kind` column stores.
  readonly key: string;
  readonly raisedBy: NotificationRaisedBy;
  readonly category: NotificationCategory;
  readonly severity: NotificationSeverity;
  // Non-silenceable IN APP. Derived from the category rather than declared freely — a fitness test
  // asserts the two agree, so a type cannot quietly opt a `trust` kind out of the floor.
  readonly mandatory: boolean;
  readonly audience: NotificationAudience;
  // Set exactly when `audience` is `capability-holders`: the capability whose holders hear it.
  readonly audienceCapability?: KnownPermission;
  // Set exactly when `audience` is `named-recipient`: which field of the payload carries the one
  // member's handle. Declared here rather than assumed by the resolver for the same reason
  // `subjectPayloadKey` is — a producer's field name is the producer's to choose, and a generic
  // consumer that guessed one would silently reach nobody for every producer that spelled it
  // differently.
  readonly audiencePayloadKey?: string;
  // Set when a declared audience is not resolvable yet and something narrower stands in, so the day
  // the real one lands the change is ONE resolver rather than a hunt through every type. NO TYPE
  // DECLARES ONE TODAY — `matter-team` did until `matter_assignment` gave it a real team to resolve,
  // and that swap was exactly the one-resolver edit this field exists to buy. The seam stays for the
  // next audience that needs it; a fitness test holds the "none today" to being deliberate.
  readonly audienceSubstitutedFrom?: NotificationAudience;
  // The actor is excluded by default: nobody needs telling they did the thing they just did. A type
  // sets this where a confirmation is genuinely the point.
  readonly includeActor: boolean;
  // The emission point that raises it, BY IMPORTED CONSTANT wherever the producing package exports
  // one. Two spellings of one emission point is the failure this indirection exists to refuse, and
  // it is a silent failure: an unrecognized topic on the per-firm bus is acked and ignored by
  // design, so a typo does not throw, it just stops delivering.
  readonly subscribesTo: string;
  readonly subjectKind: NotificationSubjectKind;
  // Which field of the payload carries the subject's handle. For a `comparison-sweep` or
  // `job-coordinator` type the payload is the one the raiser builds from its own finding rather
  // than one a producer sent, which is why the materializer's contract is identical for all three
  // paths — one shape in, one set of rows out, and no path gets its own materializer to drift.
  readonly subjectPayloadKey: string;
  readonly matterAnchored: boolean;
  readonly matterResolution: MatterResolution;
  // The declared non-privileged slot, validated against the closed grammar in facts-grammar.ts. A
  // declared string field is a validation failure, not a warning.
  readonly facts: FactsSchema;
  // Pure: payload in, facts out. No clock, no database, no network. Whatever it returns is checked
  // against `facts` above before anything is written, so a materializer cannot widen its own
  // declaration.
  readonly buildFacts: (payload: Readonly<Record<string, unknown>>) => Facts;
  readonly escalation: NotificationEscalation;
  readonly channels: readonly NotificationChannel[];
  readonly emailContent: NotificationEmailContent;
  // Where following the notification takes the reader. A path only — the subject itself is resolved
  // there, through the owning subsystem's own access-checked read, which is why nothing about the
  // subject has to be stored on the row.
  readonly deepLink: (subjectId: string, matterId: string | null) => string;
}

// A file version reaches its matter through the file that owns it. Two hops, one statement, one
// binding — and it is the same join the File Manager's own reads take, so a version whose file was
// removed resolves to nothing rather than to somebody else's matter.
const MATTER_BY_FILE_VERSION =
  "SELECT file.matter_id AS matter_id FROM file_version JOIN file ON file.id = file_version.file_id WHERE file_version.id = ?1";

function matterSectionLink(
  section: string,
): (subjectId: string, matterId: string | null) => string {
  return (subjectId, matterId) => `/matters/${matterId ?? ""}/${section}?entry=${subjectId}`;
}

// The two facts a custody reminder is allowed to carry, read from the finding the register handed
// over. Shared by both custody types because both reasons return the same shape — one builder, so
// the two can never come to disagree about which fields survive the boundary.
function custodyReminderFacts(payload: Readonly<Record<string, unknown>>): Facts {
  const daysOverdue = payload["daysOverdue"];
  const bucket = payload["bucket"];
  return {
    daysOverdue: typeof daysOverdue === "number" ? daysOverdue : 0,
    bucket:
      typeof bucket === "string" && (CUSTODY_OVERDUE_BUCKETS as readonly string[]).includes(bucket)
        ? bucket
        : CUSTODY_OVERDUE_BUCKETS[0],
  };
}

// A type as it is written down, minus the one field the array it lives in already answers. Stating
// the production path once per group beats repeating it on every entry, where it would be a line
// somebody copies from the neighbour above without meaning it.
type NotificationTypeDeclaration = Omit<NotificationType, "raisedBy">;

function raisedBy(
  path: NotificationRaisedBy,
): (declaration: NotificationTypeDeclaration) => NotificationType {
  return (declaration) => ({ ...declaration, raisedBy: path });
}

// SUBSCRIBED to a transactional outbox topic. Every one of these rides a durable row a producing
// package already commits in the same atomic batch as the write it describes, so nothing here asks
// a producer to change — that is the point of subscribing.
const OUTBOX_SUBSCRIBED_DECLARATIONS: readonly NotificationTypeDeclaration[] = [
  {
    key: "trust.ledger.entry.posted",
    category: "trust",
    severity: "attention",
    mandatory: true,
    // Whoever can act on trust, rather than whoever happens to be near the matter. A trust posting
    // is a firm-level control fact; the person who needs it is the person who could correct it.
    audience: "capability-holders",
    audienceCapability: "trust:manage",
    includeActor: false,
    subscribesTo: LEDGER_ENTRY_POSTED_TOPIC,
    subjectKind: "ledgerEntry",
    subjectPayloadKey: "entryId",
    // A ledger entry's lines land on accounts, and a firm's chart of accounts is not per matter. The
    // sub-ledger resolves whose money it is; the ENTRY is a firm-scoped fact and filtering it behind
    // a matter would hide it from exactly the trust-compliance read it exists for.
    matterAnchored: false,
    matterResolution: { kind: "none" },
    // Whether this posting reverses an earlier one — a boolean, and the one fact about a trust entry
    // that changes what the reader should do about it. No amount, no account, no client.
    facts: { reversal: { kind: "boolean" } },
    buildFacts: (payload) => ({ reversal: typeof payload["reversesEntryId"] === "string" }),
    // Digest, deliberately, even though the trust category is ALLOWED to escalate. Escalation is
    // reserved for the trust events where a day's delay is a compliance failure — a below-threshold
    // balance, an overdraft — and every posting is not that. A category that escalates on its
    // highest-volume topic trains people to ignore the channel.
    escalation: "digest",
    channels: ["in_app", "email"],
    emailContent: "category-count",
    deepLink: (subjectId) => `/trust/ledger?entry=${subjectId}`,
  },
  {
    key: "billing.invoice.finalized",
    category: "billing",
    severity: "informational",
    mandatory: false,
    audience: "capability-holders",
    audienceCapability: "billing:read",
    includeActor: false,
    subscribesTo: INVOICE_FINALIZED_TOPIC,
    subjectKind: "invoice",
    subjectPayloadKey: "invoiceId",
    // One invoice may bill several of a client's matters, so the matter is what is billed rather
    // than the tenancy root — the same reasoning billing:* binds the firm.
    matterAnchored: false,
    matterResolution: { kind: "none" },
    // Deliberately empty. The payload carries the invoice number, the client's entity handle, and
    // the total; an invoice NUMBER is client-identifying to anyone holding a prior bill, and the
    // total is the client's own financial fact. Both resolve behind the deep link, through billing's
    // own access-checked read, which is where they belong.
    facts: {},
    buildFacts: () => ({}),
    escalation: "digest",
    channels: ["in_app", "email"],
    emailContent: "category-count",
    deepLink: (subjectId) => `/billing/invoices/${subjectId}`,
  },
  {
    key: "billing.invoice.voided",
    category: "billing",
    severity: "attention",
    mandatory: false,
    audience: "capability-holders",
    audienceCapability: "billing:read",
    includeActor: false,
    subscribesTo: INVOICE_VOIDED_TOPIC,
    subjectKind: "invoice",
    subjectPayloadKey: "invoiceId",
    matterAnchored: false,
    matterResolution: { kind: "none" },
    facts: {},
    buildFacts: () => ({}),
    escalation: "digest",
    channels: ["in_app", "email"],
    emailContent: "category-count",
    deepLink: (subjectId) => `/billing/invoices/${subjectId}`,
  },
  {
    key: "documents.file.quarantined",
    category: "documents",
    severity: "critical",
    mandatory: false,
    // The people working the matter — its responsible member and everyone currently assigned to it.
    // A file on a matter being pulled is the whole team's problem, not only the owner's.
    audience: "matter-team",
    includeActor: false,
    subscribesTo: FILE_QUARANTINED_TOPIC,
    subjectKind: "fileVersion",
    subjectPayloadKey: "versionId",
    matterAnchored: true,
    matterResolution: { kind: "query", sql: MATTER_BY_FILE_VERSION },
    // The producing payload carries a `reason` string, and it is deliberately NOT carried here.
    // Some of its values are codes and some are sentences, and a slot that is a code today and a
    // sentence after one refactor is exactly the door this grammar exists to close.
    facts: {},
    buildFacts: () => ({}),
    escalation: "digest",
    channels: ["in_app", "email"],
    emailContent: "category-count",
    deepLink: matterSectionLink("files"),
  },
  {
    key: "documents.file.rescanInfected",
    category: "documents",
    severity: "critical",
    mandatory: false,
    audience: "matter-team",
    includeActor: false,
    subscribesTo: FILE_RESCAN_INFECTED_TOPIC,
    subjectKind: "fileVersion",
    subjectPayloadKey: "versionId",
    matterAnchored: true,
    matterResolution: { kind: "query", sql: MATTER_BY_FILE_VERSION },
    facts: {},
    buildFacts: () => ({}),
    escalation: "digest",
    channels: ["in_app", "email"],
    emailContent: "category-count",
    deepLink: matterSectionLink("files"),
  },
  {
    key: "documents.checkinConflict",
    category: "documents",
    severity: "attention",
    mandatory: false,
    audience: "matter-team",
    includeActor: false,
    subscribesTo: DOCUMENT_CHECKIN_CONFLICT_TOPIC,
    subjectKind: "fileVersion",
    subjectPayloadKey: "versionId",
    matterAnchored: true,
    matterResolution: { kind: "query", sql: MATTER_BY_FILE_VERSION },
    // A conflict is a divergence FROM a version, and which one is a handle rather than content —
    // the one fact that tells a reader what they are about to reconcile against.
    facts: { divergedFrom: { kind: "identifier" } },
    // Always supplied, never conditionally omitted: a declared fact that is missing from a payload
    // is a producer that changed shape, and the grammar refusing the write (which the caller counts
    // and logs) is how that gets noticed. Quietly dropping the field would make a shape change
    // invisible until somebody wondered why the cards stopped saying anything.
    buildFacts: (payload) => {
      const divergedFrom = payload["divergedFromVersionId"];
      return { divergedFrom: typeof divergedFrom === "string" ? divergedFrom : "" };
    },
    escalation: "digest",
    channels: ["in_app", "email"],
    emailContent: "category-count",
    deepLink: matterSectionLink("files"),
  },
  {
    key: "email.filed",
    category: "email",
    severity: "informational",
    mandatory: false,
    // The people carrying the file. Correspondence arriving on a matter is the team's fact, not only
    // the responsible member's — a paralegal working the file needs to know the other side wrote in.
    audience: "matter-team",
    // Whoever filed it does not need telling they filed it. The automatic path has no actor to
    // exclude, and its recipients are the same team — a rule filing mail to a matter is precisely the
    // case where nobody performed the act and everybody on the file wants to hear about it.
    includeActor: false,
    subscribesTo: EMAIL_FILED_TOPIC,
    subjectKind: "emailMessage",
    subjectPayloadKey: "emailMessageId",
    matterAnchored: true,
    matterResolution: { kind: "payload", payloadKey: "matterId" },
    // Deliberately empty, and this is the type where that matters most. An email's subject line is
    // routinely the client's name, the opposing party, or the substance of the advice, and the sender
    // address names who the firm is talking to — both are exactly the strings a notification row must
    // not hold, because the row outlives the access check that justified writing it. Neither reaches
    // this package at all: the producing payload carries two identifiers, so there is nothing here to
    // decline. What a reader needs resolves behind the deep link, through email filing's own
    // access-checked read.
    facts: {},
    buildFacts: () => ({}),
    escalation: "digest",
    channels: ["in_app", "email"],
    emailContent: "category-count",
    deepLink: matterSectionLink("emails"),
  },
  {
    key: "system.matter.closed",
    category: "system",
    severity: "informational",
    mandatory: false,
    audience: "responsible-member",
    includeActor: false,
    subscribesTo: MATTER_CLOSED_TOPIC,
    subjectKind: "matter",
    subjectPayloadKey: "matterId",
    matterAnchored: true,
    matterResolution: { kind: "payload", payloadKey: "matterId" },
    facts: {},
    buildFacts: () => ({}),
    escalation: "digest",
    channels: ["in_app", "email"],
    emailContent: "category-count",
    deepLink: (_subjectId, matterId) => `/matters/${matterId ?? ""}/overview`,
  },
  {
    key: "system.matter.reopened",
    category: "system",
    severity: "informational",
    mandatory: false,
    audience: "responsible-member",
    includeActor: false,
    subscribesTo: MATTER_REOPENED_TOPIC,
    subjectKind: "matter",
    subjectPayloadKey: "matterId",
    matterAnchored: true,
    matterResolution: { kind: "payload", payloadKey: "matterId" },
    facts: {},
    buildFacts: () => ({}),
    escalation: "digest",
    channels: ["in_app", "email"],
    emailContent: "category-count",
    deepLink: (_subjectId, matterId) => `/matters/${matterId ?? ""}/overview`,
  },
  // The hold and its release are the same kind of fact as the close and the reopen: an
  // administrative act about the file, for the person accountable for it.
  {
    key: "system.matter.held",
    category: "system",
    severity: "informational",
    mandatory: false,
    audience: "responsible-member",
    includeActor: false,
    subscribesTo: MATTER_HELD_TOPIC,
    subjectKind: "matter",
    subjectPayloadKey: "matterId",
    matterAnchored: true,
    matterResolution: { kind: "payload", payloadKey: "matterId" },
    facts: {},
    buildFacts: () => ({}),
    escalation: "digest",
    channels: ["in_app", "email"],
    emailContent: "category-count",
    deepLink: (_subjectId, matterId) => `/matters/${matterId ?? ""}/overview`,
  },
  {
    key: "system.matter.released",
    category: "system",
    severity: "informational",
    mandatory: false,
    audience: "responsible-member",
    includeActor: false,
    subscribesTo: MATTER_RELEASED_TOPIC,
    subjectKind: "matter",
    subjectPayloadKey: "matterId",
    matterAnchored: true,
    matterResolution: { kind: "payload", payloadKey: "matterId" },
    facts: {},
    buildFacts: () => ({}),
    escalation: "digest",
    channels: ["in_app", "email"],
    emailContent: "category-count",
    deepLink: (_subjectId, matterId) => `/matters/${matterId ?? ""}/overview`,
  },
  {
    key: "conflicts.hit.surfaced",
    category: "conflicts",
    severity: "attention",
    mandatory: false,
    // Whoever can read a conflicts result, rather than whoever happens to be near the matter. A
    // surfaced candidate is a firm-level professional-responsibility fact, and the person who needs
    // it is the person entitled to look at the evidence and decide.
    audience: "capability-holders",
    audienceCapability: "conflicts:read",
    includeActor: false,
    subscribesTo: CONFLICTS_HIT_SURFACED_TOPIC,
    subjectKind: "conflictsCheck",
    subjectPayloadKey: "checkId",
    matterAnchored: true,
    matterResolution: { kind: "payload", payloadKey: "matterId" },
    // Two counts and nothing else. NOT the entity, not what matched, not the tier's evidence — a
    // notification row outlives the access check that justified it, and a name that surfaced in a
    // conflicts search is the single most sensitive thing this platform holds about who a firm is
    // talking to. The counts say how much is waiting and how much of it is strong; the subject
    // resolves behind the deep link, through the conflicts read that checks the reader's capability.
    facts: {
      hitCount: { kind: "integer" },
      // Hits at the two strongest evidence tiers — an exact identifier or an exact name. The one
      // fact that separates "look at this today" from "look at this."
      strongHitCount: { kind: "integer" },
    },
    buildFacts: (payload) => ({
      hitCount: typeof payload["hitCount"] === "number" ? payload["hitCount"] : 0,
      strongHitCount: typeof payload["strongHitCount"] === "number" ? payload["strongHitCount"] : 0,
    }),
    // Digest, because IMMEDIATE_ESCALATION_CATEGORIES admits only trust and security today and this
    // type does not get to widen that on its own. Whether a day's delay on an exact-identifier match
    // against a matter a firm is about to accept is an inconvenience or a failure is a real question
    // and the firm's to answer; flipping it is one word here plus one entry in that list.
    escalation: "digest",
    channels: ["in_app", "email"],
    emailContent: "category-count",
    deepLink: matterSectionLink("conflicts"),
  },
  {
    key: "system.incident.created",
    category: "system",
    severity: "attention",
    mandatory: false,
    // Whoever administers the firm. An incident is a report about the platform failing somebody, and
    // the person who can act on it is an administrator rather than anyone on a matter.
    audience: "capability-holders",
    audienceCapability: "firm:manageMembers",
    includeActor: false,
    // The only registered topic whose producer is a worker route rather than a domain package, so
    // there is no package constant to import here. apps/api-worker/test/notifications-routes.test.ts
    // pins this spelling against the route's own exported constant, which is the same guarantee the
    // imports above give by construction.
    subscribesTo: "incident.created",
    subjectKind: "incident",
    subjectPayloadKey: "incidentId",
    // An incident is filed against the firm, not a matter — the route's own resource binding. It is
    // also the type that exercises the firm-scoped path: a null anchor must reach its audience
    // rather than being filtered out with the matters.
    matterAnchored: false,
    matterResolution: { kind: "none" },
    // How many error identifiers the report gathered — an integer, and the one fact that separates
    // "something odd happened once" from "this is on fire". The member's description is sealed under
    // the firm key and is not readable from here, which is exactly right.
    facts: { errorIdCount: { kind: "integer" } },
    buildFacts: (payload) => {
      const count = payload["errorIdCount"];
      return { errorIdCount: typeof count === "number" ? count : 0 };
    },
    escalation: "digest",
    channels: ["in_app", "email"],
    emailContent: "category-count",
    deepLink: (subjectId) => `/support/incidents/${subjectId}`,
  },
  {
    key: "calendar.event.scheduled",
    category: "calendar",
    severity: "informational",
    mandatory: false,
    // The people carrying the file. A setting appearing on a case is the team's fact — the
    // paralegal who has to prepare for it needs it as much as the attorney who will appear.
    audience: "matter-team",
    includeActor: false,
    subscribesTo: CALENDAR_EVENT_SCHEDULED_TOPIC,
    subjectKind: "matterEvent",
    subjectPayloadKey: "matterEventId",
    matterAnchored: true,
    matterResolution: { kind: "payload", payloadKey: "matterId" },
    // Deliberately empty, and the date is the interesting omission. A hearing's date is not
    // privileged the way its title is, but it is also the fact most likely to be STALE — the whole
    // reason `rescheduled` exists is that settings move — and a card stating a date the record no
    // longer agrees with is worse than a card stating none. The live date resolves behind the deep
    // link, from the row itself.
    facts: {},
    buildFacts: () => ({}),
    escalation: "digest",
    channels: ["in_app", "email"],
    emailContent: "category-count",
    deepLink: matterSectionLink("calendar"),
  },
  {
    key: "calendar.event.rescheduled",
    category: "calendar",
    // A setting that moved is the one calendar fact a member has to act on: the preparation they had
    // planned is now due on another day, and the day they had blocked out is now free.
    severity: "attention",
    mandatory: false,
    audience: "matter-team",
    includeActor: false,
    subscribesTo: CALENDAR_EVENT_RESCHEDULED_TOPIC,
    subjectKind: "matterEvent",
    subjectPayloadKey: "matterEventId",
    matterAnchored: true,
    matterResolution: { kind: "payload", payloadKey: "matterId" },
    facts: {},
    buildFacts: () => ({}),
    escalation: "digest",
    channels: ["in_app", "email"],
    emailContent: "category-count",
    deepLink: matterSectionLink("calendar"),
  },
  // SCHEDULING A MEETING IS RECORDING AN EVENT WITH A MEDIUM ON IT, so the invitation rides the
  // event-recording path rather than a subsystem of its own.
  //
  // Only the MATTER arm exists today, and the reason is a table rebuild rather than a decision:
  // `notification_event.subject_kind` is a SQLite CHECK with no `firmEvent` value in it, and
  // widening one rebuilds a table `notification_recipient` points at — which cannot complete against
  // a firm database that holds data (packages/database/src/reviewed-rebuilds.ts). A firm meeting is
  // scheduled, created and joinable; it is the notification alone that waits on that migration.
  {
    key: "meetings.meeting.scheduled",
    category: "calendar",
    // Somebody has to be somewhere, at an hour, with other people waiting. That is the line between
    // the two levels here, and it is the same reading `calendar.event.rescheduled` takes.
    severity: "attention",
    mandatory: false,
    // The members named ON THE EVENT, never the matter team: a hearing appearing on a case is the
    // team's fact, and being asked into a room at nine on Tuesday is the fact of the people asked.
    audience: "named-members",
    audiencePayloadKey: "invitedMemberUserIds",
    // Nobody needs inviting to the meeting they just scheduled. The producer leaves the actor off
    // the list as well, so this is a statement of intent rather than the only thing holding it.
    includeActor: false,
    subscribesTo: CALENDAR_EVENT_MEETING_SCHEDULED_TOPIC,
    // The EVENT, not the meeting: it is what the deep link opens, what carries the title and the
    // hour, and what the member presses Join on. `meeting` is not a subject kind the schema's CHECK
    // knows, and it does not need to be — the meeting has no surface of its own before it starts.
    subjectKind: "matterEvent",
    subjectPayloadKey: "matterEventId",
    matterAnchored: true,
    matterResolution: { kind: "payload", payloadKey: "matterId" },
    // The medium, and nothing else. Not the title, which on a matter is routinely the parties and
    // the dispute; not the date, on this registry's standing reasoning about settings that move. The
    // sentence a member reads — "You are invited to a video meeting: <title>, <when>" — is composed
    // by the surface from the live event behind the deep link, under the access check that still
    // applies there.
    facts: { medium: { kind: "enum", labels: MEETING_MEDIA } },
    buildFacts: (payload) => {
      const medium = payload["medium"];
      return {
        medium: typeof medium === "string" && isMeetingMedium(medium) ? medium : "video",
      };
    },
    escalation: "digest",
    channels: ["in_app", "email"],
    emailContent: "category-count",
    deepLink: matterSectionLink("calendar"),
  },
  {
    key: "calendar.event.cancelled",
    category: "calendar",
    severity: "attention",
    mandatory: false,
    audience: "matter-team",
    includeActor: false,
    subscribesTo: CALENDAR_EVENT_CANCELLED_TOPIC,
    subjectKind: "matterEvent",
    subjectPayloadKey: "matterEventId",
    matterAnchored: true,
    matterResolution: { kind: "payload", payloadKey: "matterId" },
    facts: {},
    buildFacts: () => ({}),
    escalation: "digest",
    channels: ["in_app", "email"],
    emailContent: "category-count",
    deepLink: matterSectionLink("calendar"),
  },
  // TASKS — four types for two acts, split by whether the task is on a matter.
  //
  // The split is the `calendar.event.*` / `calendar.firmEvent.*` split exactly, and for the reason
  // this registry already enforces two tests over: a matter-anchored type must resolve a matter, and
  // a type that is not matter-anchored must not. A task's matter is nullable, so one type could not
  // honestly be both — and the producer knows which it is holding, so it raises the right topic at
  // the write rather than leaving a consumer to infer it from a field that happened to be null.
  //
  // All four reach ONE person, and that is the point rather than a narrowing to justify: a task is
  // an obligation placed on a named member, not a fact about the case that the team shares. The
  // matter-team audience is what a hearing gets, because a setting is everybody's to prepare for; an
  // assignment is one person's to do. `named-recipient` reads that member from the payload.
  {
    key: "tasks.task.assigned",
    category: "tasks",
    // Attention rather than informational: somebody put work in your name and there may be a date on
    // it. That is a thing to act on, which is the line between the two levels here.
    severity: "attention",
    mandatory: false,
    audience: "named-recipient",
    audiencePayloadKey: "assigneeUserId",
    // Never raised when a member assigns themselves, so the actor is never in this audience anyway —
    // declared false to say so rather than leaving it to the producer's discretion.
    includeActor: false,
    subscribesTo: TASK_ASSIGNED_TOPIC,
    subjectKind: "matterTask",
    subjectPayloadKey: "taskId",
    matterAnchored: true,
    matterResolution: { kind: "payload", payloadKey: "matterId" },
    // The priority and whether there is a date, and nothing else. NOT the title: a task title on a
    // matter is routinely the client and the instruction ("Call Mrs. Herrera re the settlement
    // offer"), and this row outlives the access check that justified writing it. NOT the date
    // itself either, on the calendar's own reasoning about `rescheduled`: a due date moves, and a
    // card stating one the record no longer agrees with is worse than a card stating none. Whether
    // there IS a date does not go stale in the same way and is what tells a member to open it now.
    facts: { priority: { kind: "enum", labels: TASK_PRIORITIES }, dated: { kind: "boolean" } },
    buildFacts: (payload) => {
      const priority = payload["priority"];
      return {
        priority:
          typeof priority === "string" && (TASK_PRIORITIES as readonly string[]).includes(priority)
            ? priority
            : "normal",
        dated: typeof payload["dueOn"] === "string",
      };
    },
    escalation: "digest",
    channels: ["in_app", "email"],
    emailContent: "category-count",
    deepLink: matterSectionLink("tasks"),
  },
  {
    key: "tasks.task.reassigned",
    category: "tasks",
    severity: "attention",
    mandatory: false,
    audience: "named-recipient",
    audiencePayloadKey: "assigneeUserId",
    includeActor: false,
    subscribesTo: TASK_REASSIGNED_TOPIC,
    subjectKind: "matterTask",
    subjectPayloadKey: "taskId",
    matterAnchored: true,
    matterResolution: { kind: "payload", payloadKey: "matterId" },
    facts: { priority: { kind: "enum", labels: TASK_PRIORITIES }, dated: { kind: "boolean" } },
    buildFacts: (payload) => {
      const priority = payload["priority"];
      return {
        priority:
          typeof priority === "string" && (TASK_PRIORITIES as readonly string[]).includes(priority)
            ? priority
            : "normal",
        dated: typeof payload["dueOn"] === "string",
      };
    },
    escalation: "digest",
    channels: ["in_app", "email"],
    emailContent: "category-count",
    deepLink: matterSectionLink("tasks"),
  },
  // The same two acts on a task that is on no matter — renewing the malpractice policy, interviewing
  // a candidate. No matter anchor, so no matter resolution, and the deep link goes to the member's
  // own list rather than to a matter section that does not exist for this row.
  {
    key: "tasks.firmTask.assigned",
    category: "tasks",
    severity: "attention",
    mandatory: false,
    audience: "named-recipient",
    audiencePayloadKey: "assigneeUserId",
    includeActor: false,
    subscribesTo: FIRM_TASK_ASSIGNED_TOPIC,
    subjectKind: "matterTask",
    subjectPayloadKey: "taskId",
    // Not behind the matter wall, because there is no matter whose visibility could decide it. The
    // containment here is the audience: exactly the one member the task names.
    matterAnchored: false,
    matterResolution: { kind: "none" },
    facts: { priority: { kind: "enum", labels: TASK_PRIORITIES }, dated: { kind: "boolean" } },
    buildFacts: (payload) => {
      const priority = payload["priority"];
      return {
        priority:
          typeof priority === "string" && (TASK_PRIORITIES as readonly string[]).includes(priority)
            ? priority
            : "normal",
        dated: typeof payload["dueOn"] === "string",
      };
    },
    escalation: "digest",
    channels: ["in_app", "email"],
    emailContent: "category-count",
    deepLink: (subjectId) => `/tasks?entry=${subjectId}`,
  },
  {
    key: "tasks.firmTask.reassigned",
    category: "tasks",
    severity: "attention",
    mandatory: false,
    audience: "named-recipient",
    audiencePayloadKey: "assigneeUserId",
    includeActor: false,
    subscribesTo: FIRM_TASK_REASSIGNED_TOPIC,
    subjectKind: "matterTask",
    subjectPayloadKey: "taskId",
    matterAnchored: false,
    matterResolution: { kind: "none" },
    facts: { priority: { kind: "enum", labels: TASK_PRIORITIES }, dated: { kind: "boolean" } },
    buildFacts: (payload) => {
      const priority = payload["priority"];
      return {
        priority:
          typeof priority === "string" && (TASK_PRIORITIES as readonly string[]).includes(priority)
            ? priority
            : "normal",
        dated: typeof payload["dueOn"] === "string",
      };
    },
    escalation: "digest",
    channels: ["in_app", "email"],
    emailContent: "category-count",
    deepLink: (subjectId) => `/tasks?entry=${subjectId}`,
  },
  // A TASK SOMEBODY IS WATCHING MOVED. A watcher is copied in, as on a CC line: the work is not
  // theirs, so these are informational where an assignment asks for attention. Reaches the watchers
  // the payload names, never the matter team: being copied on one task is a choice somebody made
  // about one person, not a fact about the case.
  {
    key: "tasks.task.watchedChange",
    category: "tasks",
    severity: "informational",
    mandatory: false,
    audience: "named-members",
    audiencePayloadKey: "watcherUserIds",
    includeActor: false,
    subscribesTo: WATCHED_TASK_CHANGED_TOPIC,
    subjectKind: "matterTask",
    subjectPayloadKey: "taskId",
    matterAnchored: true,
    matterResolution: { kind: "payload", payloadKey: "matterId" },
    // What moved and how urgent the task is. Not the new status's name: a status is the firm's own
    // free text, and the card reads it live behind the deep link instead.
    facts: {
      change: { kind: "enum", labels: WATCHED_TASK_CHANGES },
      priority: { kind: "enum", labels: TASK_PRIORITIES },
    },
    buildFacts: watchedChangeFacts,
    escalation: "digest",
    channels: ["in_app", "email"],
    emailContent: "category-count",
    deepLink: matterSectionLink("tasks"),
  },
  {
    key: "tasks.firmTask.watchedChange",
    category: "tasks",
    severity: "informational",
    mandatory: false,
    audience: "named-members",
    audiencePayloadKey: "watcherUserIds",
    includeActor: false,
    subscribesTo: FIRM_WATCHED_TASK_CHANGED_TOPIC,
    subjectKind: "matterTask",
    subjectPayloadKey: "taskId",
    matterAnchored: false,
    matterResolution: { kind: "none" },
    facts: {
      change: { kind: "enum", labels: WATCHED_TASK_CHANGES },
      priority: { kind: "enum", labels: TASK_PRIORITIES },
    },
    buildFacts: watchedChangeFacts,
    escalation: "digest",
    channels: ["in_app", "email"],
    emailContent: "category-count",
    deepLink: (subjectId) => `/tasks?entry=${subjectId}`,
  },
  // SOMEBODY COMMENTED ON A TASK. Two pairs, split on the matter as the others are. The first tells
  // the people the task is assigned to and the people watching it, as information. The second tells
  // the colleagues the comment names with @, and asks for attention, because being named is being
  // asked. A member named is told by the second alone. Neither carries a word of the comment.
  {
    key: "tasks.task.commented",
    category: "tasks",
    severity: "informational",
    mandatory: false,
    audience: "named-members",
    audiencePayloadKey: "recipientUserIds",
    includeActor: false,
    subscribesTo: TASK_COMMENTED_TOPIC,
    subjectKind: "matterTask",
    subjectPayloadKey: "taskId",
    matterAnchored: true,
    matterResolution: { kind: "payload", payloadKey: "matterId" },
    // How urgent the task is, and nothing of what was said: the comment is read behind the link.
    facts: { priority: { kind: "enum", labels: TASK_PRIORITIES } },
    buildFacts: commentFacts,
    escalation: "digest",
    channels: ["in_app", "email"],
    emailContent: "category-count",
    deepLink: matterSectionLink("tasks"),
  },
  {
    key: "tasks.firmTask.commented",
    category: "tasks",
    severity: "informational",
    mandatory: false,
    audience: "named-members",
    audiencePayloadKey: "recipientUserIds",
    includeActor: false,
    subscribesTo: FIRM_TASK_COMMENTED_TOPIC,
    subjectKind: "matterTask",
    subjectPayloadKey: "taskId",
    matterAnchored: false,
    matterResolution: { kind: "none" },
    // How urgent the task is, and nothing of what was said: the comment is read behind the link.
    facts: { priority: { kind: "enum", labels: TASK_PRIORITIES } },
    buildFacts: commentFacts,
    escalation: "digest",
    channels: ["in_app", "email"],
    emailContent: "category-count",
    deepLink: (subjectId) => `/tasks?entry=${subjectId}`,
  },
  {
    key: "tasks.task.commentMentioned",
    category: "tasks",
    severity: "attention",
    mandatory: false,
    audience: "named-members",
    audiencePayloadKey: "recipientUserIds",
    includeActor: false,
    subscribesTo: TASK_COMMENT_MENTIONED_TOPIC,
    subjectKind: "matterTask",
    subjectPayloadKey: "taskId",
    matterAnchored: true,
    matterResolution: { kind: "payload", payloadKey: "matterId" },
    // How urgent the task is, and nothing of what was said: the comment is read behind the link.
    facts: { priority: { kind: "enum", labels: TASK_PRIORITIES } },
    buildFacts: commentFacts,
    escalation: "digest",
    channels: ["in_app", "email"],
    emailContent: "category-count",
    deepLink: matterSectionLink("tasks"),
  },
  {
    key: "tasks.firmTask.commentMentioned",
    category: "tasks",
    severity: "attention",
    mandatory: false,
    audience: "named-members",
    audiencePayloadKey: "recipientUserIds",
    includeActor: false,
    subscribesTo: FIRM_TASK_COMMENT_MENTIONED_TOPIC,
    subjectKind: "matterTask",
    subjectPayloadKey: "taskId",
    matterAnchored: false,
    matterResolution: { kind: "none" },
    // How urgent the task is, and nothing of what was said: the comment is read behind the link.
    facts: { priority: { kind: "enum", labels: TASK_PRIORITIES } },
    buildFacts: commentFacts,
    escalation: "digest",
    channels: ["in_app", "email"],
    emailContent: "category-count",
    deepLink: (subjectId) => `/tasks?entry=${subjectId}`,
  },
];

// The one fact a comment notice carries, held to its closed vocabulary.
function commentFacts(payload: Readonly<Record<string, unknown>>): Facts {
  const priority = payload["priority"];
  return {
    priority:
      typeof priority === "string" && (TASK_PRIORITIES as readonly string[]).includes(priority)
        ? priority
        : "normal",
  };
}

// The two facts a watched-task notice carries, each held to its closed vocabulary.
function watchedChangeFacts(payload: Readonly<Record<string, unknown>>): Facts {
  const change = payload["change"];
  const priority = payload["priority"];
  return {
    change:
      typeof change === "string" && (WATCHED_TASK_CHANGES as readonly string[]).includes(change)
        ? change
        : "statusChanged",
    priority:
      typeof priority === "string" && (TASK_PRIORITIES as readonly string[]).includes(priority)
        ? priority
        : "normal",
  };
}

// RAISED BY A COMPARISON, not by a write. Nothing in the platform writes "this deadline is overdue"
// or "this review has come round" — they are subtractions against the clock, true continuously, and
// the packages that own the records refuse to store them for good reasons of their own. So there is
// no batch to ride and no topic to subscribe to: a scheduled per-firm pass performs the comparison
// the owning package already ships and materializes what it returns.
//
// The consequence that shapes every entry here is idempotency. A comparison that is true today is
// true again in five minutes, so the dedupe key carries a CIVIL DATE and the row is raised once per
// day rather than once per pass.
const COMPARISON_SWEPT_DECLARATIONS: readonly NotificationTypeDeclaration[] = [
  {
    key: "deadlines.deadline.due",
    category: "deadlines",
    severity: "attention",
    mandatory: false,
    // Everyone carrying the file, not only the responsible attorney. A deadline reaching its day is
    // the case's most consequential fact and the one whose miss is hardest to undo; narrowing it to
    // one person means one person's holiday is a missed filing.
    audience: "matter-team",
    includeActor: false,
    subscribesTo: CALENDAR_DEADLINE_DUE_EMISSION_POINT,
    subjectKind: "matterDeadline",
    subjectPayloadKey: "matterDeadlineId",
    matterAnchored: true,
    matterResolution: { kind: "payload", payloadKey: "matterId" },
    // The deadline's own title is what a reader most wants and is exactly what this must not carry:
    // a deadline is routinely titled after the filing, the motion, or the other side. It resolves
    // behind the deep link, through the calendar's access-checked read.
    facts: {},
    buildFacts: () => ({}),
    escalation: "digest",
    channels: ["in_app", "email"],
    emailContent: "category-count",
    deepLink: matterSectionLink("deadlines"),
  },
  {
    key: "deadlines.deadline.overdue",
    category: "deadlines",
    severity: "critical",
    mandatory: false,
    audience: "matter-team",
    includeActor: false,
    subscribesTo: CALENDAR_DEADLINE_OVERDUE_EMISSION_POINT,
    subjectKind: "matterDeadline",
    subjectPayloadKey: "matterDeadlineId",
    matterAnchored: true,
    matterResolution: { kind: "payload", payloadKey: "matterId" },
    // How long it has been past due. An integer, and the one fact that separates "this slipped
    // overnight" from "nobody has looked at this in a month" — which are different problems with
    // different responses, and the distinction is lost if the card only says "overdue".
    //
    // Note what this is NOT: an assertion that the firm missed anything. The platform reports the
    // subtraction it can see. The deadline may have been extended by a stipulation nobody has typed
    // in, satisfied under another matter, or vacated by an order that arrived this morning.
    facts: { daysOverdue: { kind: "integer" } },
    buildFacts: (payload) => ({
      daysOverdue: typeof payload["daysOverdue"] === "number" ? payload["daysOverdue"] : 0,
    }),
    escalation: "digest",
    channels: ["in_app", "email"],
    emailContent: "category-count",
    deepLink: matterSectionLink("deadlines"),
  },
  {
    key: "custody.review.due",
    category: "custody",
    severity: "attention",
    mandatory: false,
    // Whoever keeps the register. Custody is a firm-level control function with its own firm-bound
    // capability — a packet may have no matter at all — so the audience is the people who can act on
    // it rather than anyone near a case.
    audience: "capability-holders",
    audienceCapability: "custody:manage",
    includeActor: false,
    subscribesTo: CUSTODY_REVIEW_DUE_EMISSION_POINT,
    subjectKind: "custodyPacket",
    subjectPayloadKey: "custodyPacketId",
    // A custody packet may exist with no matter by construction — originals held for somebody who
    // is not yet a client are the whole reason the platform keeps a holding matter — so anchoring
    // this to a matter would hide exactly the packets the register most needs surfaced.
    matterAnchored: false,
    matterResolution: { kind: "none" },
    // A count and a band. NOT the custody number, the owner, the borrower, the item description, or
    // the location: the register is a list of the most sensitive things a firm holds, and its
    // metadata alone identifies a client.
    facts: {
      daysOverdue: { kind: "integer" },
      bucket: { kind: "enum", labels: CUSTODY_OVERDUE_BUCKETS },
    },
    buildFacts: custodyReminderFacts,
    escalation: "digest",
    channels: ["in_app", "email"],
    emailContent: "category-count",
    deepLink: (subjectId) => `/custody/packets/${subjectId}`,
  },
  {
    key: "custody.checkout.overdue",
    category: "custody",
    severity: "attention",
    mandatory: false,
    audience: "capability-holders",
    audienceCapability: "custody:manage",
    includeActor: false,
    subscribesTo: CUSTODY_CHECKOUT_OVERDUE_EMISSION_POINT,
    subjectKind: "custodyPacket",
    subjectPayloadKey: "custodyPacketId",
    matterAnchored: false,
    matterResolution: { kind: "none" },
    facts: {
      daysOverdue: { kind: "integer" },
      bucket: { kind: "enum", labels: CUSTODY_OVERDUE_BUCKETS },
    },
    buildFacts: custodyReminderFacts,
    escalation: "digest",
    channels: ["in_app", "email"],
    emailContent: "category-count",
    deepLink: (subjectId) => `/custody/packets/${subjectId}`,
  },
];

// RAISED BY A JOB REACHING ITS TERMINAL STATE. The push over the job's own socket is unchanged and
// remains the fast path; the row exists for the tab that was closed when the job finished, which is
// the ordinary case for work measured in minutes.
//
// Both entries reach ONE person on purpose, and it is the only place in this registry where that is
// the right answer: a job notification is a reply to a request, and the requester is the only person
// who asked. That is why both declare `includeActor` — the default exclusion exists so nobody is
// told they did the thing they just did, and here being told is the entire point.
const JOB_COMPLETION_DECLARATIONS: readonly NotificationTypeDeclaration[] = [
  {
    key: "jobs.documentAssembly.completed",
    category: "jobs",
    severity: "informational",
    mandatory: false,
    audience: "actor",
    includeActor: true,
    subscribesTo: DOCUMENT_ASSEMBLY_COMPLETED_EMISSION_POINT,
    subjectKind: "documentAssembly",
    subjectPayloadKey: "documentAssemblyId",
    // The assembly files a document onto a matter, so the row is anchored there and filtered like
    // everything else. A requester who has since been walled off the matter stops seeing the reply
    // to their own request, which is the correct outcome: what they asked for is on that matter.
    matterAnchored: true,
    matterResolution: { kind: "payload", payloadKey: "matterId" },
    // Whether it worked. Not the failure reason — the coordinator's reasons are a mix of codes and
    // sentences, and a slot that is a code today and a sentence after one refactor is the door the
    // grammar exists to close. The reason is on the job's own status read.
    facts: { succeeded: { kind: "boolean" } },
    buildFacts: (payload) => ({ succeeded: payload["succeeded"] === true }),
    escalation: "digest",
    channels: ["in_app", "email"],
    emailContent: "category-count",
    deepLink: matterSectionLink("documents"),
  },
  {
    key: "jobs.recovery.completed",
    category: "jobs",
    severity: "informational",
    mandatory: false,
    audience: "actor",
    includeActor: true,
    subscribesTo: RECOVERY_JOB_COMPLETED_EMISSION_POINT,
    subjectKind: "recoveryJob",
    // A recovery job is about a file the member handed in, not about a matter, and it is bound to
    // the member who started it — the recovered secret is returned to that identity and to nobody
    // else. Anchoring it to a matter it does not have would be inventing one.
    matterAnchored: false,
    matterResolution: { kind: "none" },
    subjectPayloadKey: "recoveryJobId",
    // Which terminal state, as a closed label. Never the recovered secret, and never the hash: the
    // job state holds the password for exactly one read by exactly one member, and a notification
    // row is neither.
    facts: { outcome: { kind: "enum", labels: RECOVERY_JOB_OUTCOMES } },
    buildFacts: (payload) => {
      const outcome = payload["outcome"];
      return {
        outcome:
          typeof outcome === "string" &&
          (RECOVERY_JOB_OUTCOMES as readonly string[]).includes(outcome)
            ? outcome
            : "exhausted",
      };
    },
    escalation: "digest",
    channels: ["in_app", "email"],
    emailContent: "category-count",
    deepLink: (subjectId) => `/tools/recovery/${subjectId}`,
  },
];

const DECLARED_TYPES: readonly NotificationType[] = [
  ...OUTBOX_SUBSCRIBED_DECLARATIONS.map(raisedBy("outbox-topic")),
  ...COMPARISON_SWEPT_DECLARATIONS.map(raisedBy("comparison-sweep")),
  ...JOB_COMPLETION_DECLARATIONS.map(raisedBy("job-coordinator")),
];

export const NOTIFICATION_TYPES: readonly NotificationType[] = Object.freeze(DECLARED_TYPES);

// Topic -> the types subscribing to it. Built once. A topic may carry more than one type, and most
// topics carry none — the bus is open, and not finding a type here is the ORDINARY case rather than
// an error.
//
// Only the types RAISED BY a topic are indexed. A comparison kind whose emission-point name happened
// to collide with a topic on the bus would otherwise be materialized twice: once by the sweep that
// owns it and once by the translator that mistook it for a subscription.
const TYPES_BY_TOPIC: ReadonlyMap<string, readonly NotificationType[]> =
  indexBySubscription("outbox-topic");

// The same index for the two paths that are not subscriptions, so a sweep or a coordinator resolves
// its type the same way the translator resolves one. Held separately rather than filtered at the
// call site: three raisers reaching into one map and remembering to check `raisedBy` is three
// chances to forget.
const TYPES_BY_COMPARISON_POINT: ReadonlyMap<string, readonly NotificationType[]> =
  indexBySubscription("comparison-sweep");
const TYPES_BY_JOB_COMPLETION_POINT: ReadonlyMap<string, readonly NotificationType[]> =
  indexBySubscription("job-coordinator");

function indexBySubscription(
  path: NotificationRaisedBy,
): ReadonlyMap<string, readonly NotificationType[]> {
  const index = new Map<string, NotificationType[]>();
  for (const type of NOTIFICATION_TYPES) {
    if (type.raisedBy !== path) continue;
    const existing = index.get(type.subscribesTo);
    if (existing === undefined) index.set(type.subscribesTo, [type]);
    else existing.push(type);
  }
  return index;
}

export function notificationTypesForTopic(topic: string): readonly NotificationType[] {
  return TYPES_BY_TOPIC.get(topic) ?? [];
}

export function notificationTypesForComparisonPoint(
  emissionPoint: string,
): readonly NotificationType[] {
  return TYPES_BY_COMPARISON_POINT.get(emissionPoint) ?? [];
}

export function notificationTypesForJobCompletionPoint(
  emissionPoint: string,
): readonly NotificationType[] {
  return TYPES_BY_JOB_COMPLETION_POINT.get(emissionPoint) ?? [];
}

const TYPES_BY_KEY: ReadonlyMap<string, NotificationType> = new Map(
  NOTIFICATION_TYPES.map((type) => [type.key, type]),
);

export function notificationTypeForKey(key: string): NotificationType | undefined {
  return TYPES_BY_KEY.get(key);
}

// Whether a category may be silenced in app. Read from the category rather than from a type, so the
// answer cannot differ between two types in the same category.
export function categoryIsMandatory(category: NotificationCategory): boolean {
  return MANDATORY_CATEGORIES.includes(category);
}
