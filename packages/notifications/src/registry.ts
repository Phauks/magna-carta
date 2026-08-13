import type { KnownPermission } from "@magna-carta/access-control/registry";
import { CONFLICTS_HIT_SURFACED_TOPIC } from "@magna-carta/conflicts/topics";
import { INVOICE_VOIDED_TOPIC } from "@magna-carta/billing/draft";
import { INVOICE_FINALIZED_TOPIC } from "@magna-carta/billing/finalize";
import {
  DOCUMENT_CHECKIN_CONFLICT_TOPIC,
  FILE_QUARANTINED_TOPIC,
  FILE_RESCAN_INFECTED_TOPIC,
} from "@magna-carta/file-manager/topics";
import { LEDGER_ENTRY_POSTED_TOPIC } from "@magna-carta/ledger/post-entry";
import { MATTER_CLOSED_TOPIC, MATTER_REOPENED_TOPIC } from "@magna-carta/matters/topics";
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

export interface NotificationType {
  // The stable key. A WIRE CONTRACT once shipped: it appears in feed responses and in the `kind`
  // filter, and it is what the `notification_event.kind` column stores.
  readonly key: string;
  readonly category: NotificationCategory;
  readonly severity: NotificationSeverity;
  // Non-silenceable IN APP. Derived from the category rather than declared freely — a fitness test
  // asserts the two agree, so a type cannot quietly opt a `trust` kind out of the floor.
  readonly mandatory: boolean;
  readonly audience: NotificationAudience;
  // Set exactly when `audience` is `capability-holders`: the capability whose holders hear it.
  readonly audienceCapability?: KnownPermission;
  // Set when a declared audience is not resolvable yet and something narrower stands in. Today only
  // `matter-team` substitutes (to `responsible-member`), because there is no per-matter team table.
  // Declaring the substitution here means the day one lands the change is ONE resolver rather than
  // a hunt through every type that meant "the team".
  readonly audienceSubstitutedFrom?: NotificationAudience;
  // The actor is excluded by default: nobody needs telling they did the thing they just did. A type
  // sets this where a confirmation is genuinely the point.
  readonly includeActor: boolean;
  // The outbox topic that raises it, BY IMPORTED CONSTANT wherever the producing package exports
  // one. Two spellings of one emission point is the failure this indirection exists to refuse, and
  // it is a silent failure: an unrecognized topic on the per-firm bus is acked and ignored by
  // design, so a typo does not throw, it just stops delivering.
  readonly subscribesTo: string;
  readonly subjectKind: NotificationSubjectKind;
  // Which field of the topic's payload carries the subject's handle.
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

// The registered types, drawn ONLY from topics that already exist and already commit
// transactionally. Nothing here asks a producing package to change; that is the point of
// subscribing.
const DECLARED_TYPES: readonly NotificationType[] = [
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
    // The matter's responsible member. Declared as `matter-team` because the people who should hear
    // that a file on their matter was pulled are the people working it — which is a team, and there
    // is no team table. The substitution is recorded rather than hidden so it is one resolver to
    // change when one exists.
    audience: "matter-team",
    audienceSubstitutedFrom: "matter-team",
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
    audienceSubstitutedFrom: "matter-team",
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
    audienceSubstitutedFrom: "matter-team",
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
    // there is no package constant to import here. apps/worker/test/notifications-routes.test.ts
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
];

export const NOTIFICATION_TYPES: readonly NotificationType[] = Object.freeze(DECLARED_TYPES);

// Topic -> the types subscribing to it. Built once. A topic may carry more than one type, and most
// topics carry none — the bus is open, and not finding a type here is the ORDINARY case rather than
// an error.
const TYPES_BY_TOPIC: ReadonlyMap<string, readonly NotificationType[]> = (() => {
  const byTopic = new Map<string, NotificationType[]>();
  for (const type of NOTIFICATION_TYPES) {
    const existing = byTopic.get(type.subscribesTo);
    if (existing === undefined) byTopic.set(type.subscribesTo, [type]);
    else existing.push(type);
  }
  return byTopic;
})();

export function notificationTypesForTopic(topic: string): readonly NotificationType[] {
  return TYPES_BY_TOPIC.get(topic) ?? [];
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
