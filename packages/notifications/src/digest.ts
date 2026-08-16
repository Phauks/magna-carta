import { newIdentifier } from "@magna-carta/identifiers/generate";
import type { RandomSource } from "@magna-carta/identifiers/random";
import type { NotificationDigestId } from "@magna-carta/identifiers/types";
import type { SqlDatabase, SqlStatement } from "@magna-carta/data-access/idempotency-statements";
import { notificationTypeForKey } from "./registry.ts";
import {
  selectDigestWindowStatement,
  type DigestWatermark,
  type DigestWindowRawRow,
  type VisibleNotificationScope,
} from "./read-statements.ts";
import {
  NOTIFICATION_DELIVERY_TABLE,
  NOTIFICATION_DIGEST_RUN_TABLE,
  NOTIFICATION_RECIPIENT_TABLE,
  NOTIFICATION_EVENT_TABLE,
} from "./statements.ts";
import {
  MAX_DIGEST_ITEMS_PER_RUN,
  MAX_DIGEST_RECIPIENTS_PER_RUN,
  type NotificationCategory,
  type NotificationDigestCadence,
  type NotificationEmailCadence,
  type NotificationEscalation,
  type NotificationSuppressedReason,
} from "./types.ts";

// COMPOSING WHAT A MEMBER MISSED SINCE THE LAST TIME THE PLATFORM WROTE TO THEM.
//
// Everything in this file is the READ and the BOOKKEEPING half of that; what the resulting mail is
// allowed to say is decided in `digest-render.ts`, which is deliberately a separate home because it
// is the only place in this subsystem where content crosses out of the platform.
//
// THE WATERMARK IS A KEYSET PAIR, PER MEMBER PER CADENCE. An instant alone would carry or drop every
// event sharing it, and the pair is total. Per cadence because the two cadences are independent
// walks over the same rows: a member with `trust` on weekly and `deadlines` on daily has both runs
// stepping through their feed at different speeds, each settling only the rows its own cadence
// claims.
//
// SEND FIRST, THEN MARK — the ordering the outbox relay already argues for, and the reasoning
// transfers exactly. A crash between the two re-sends a summary next run, which is an annoyance;
// marking first risks losing one, which is a missed deadline. Where those are the two outcomes there
// is no debate, so nothing in this file advances a watermark until a send has actually returned.

// One member's un-summarized rows, and whether the cap cut the window short.
export interface DigestWindow {
  readonly rows: readonly DigestWindowRawRow[];
  // True when there was more after the cap. The counts are then reported as "at least N": a summary
  // has no per-item list to truncate, so a clamp costs precision rather than content.
  readonly clamped: boolean;
}

export async function readDigestWindow(
  database: SqlDatabase,
  scope: Omit<VisibleNotificationScope, "category" | "state">,
  after: DigestWatermark | null,
  limit: number = MAX_DIGEST_ITEMS_PER_RUN,
): Promise<DigestWindow> {
  const capped = Math.min(Math.max(limit, 1), MAX_DIGEST_ITEMS_PER_RUN);
  const { results } = await selectDigestWindowStatement(database, scope, {
    after,
    limit: capped,
  }).all<DigestWindowRawRow>();
  return { rows: results.slice(0, capped), clamped: results.length > capped };
}

// ---- who has anything waiting ----

export interface DigestCandidate {
  readonly recipientUserId: string;
  readonly watermark: DigestWatermark | null;
}

export interface DigestCandidates {
  readonly candidates: readonly DigestCandidate[];
  // Members the cap removed before they were considered. A firm's staff is the natural bound and
  // the cap sits well above any plausible one, so a non-zero value here is a fan-out that reached
  // more people than the firm employs — a resolver fault, and one that must be counted rather than
  // mailed.
  readonly clamped: number;
}

// WHO THIS RUN HAS ANYTHING TO SAY TO, and why this one read composes no visibility predicate.
//
// It returns member handles and a stored watermark. No notification, no subject, no matter, and
// nothing that could be rendered to anybody — every row it counted is decided again by
// `readDigestWindow`, which does compose the wall, before one word of mail is composed. A member
// whose only waiting rows turn out to be invisible is a candidate here and receives nothing, which
// is the same outcome as not being a candidate and reveals exactly as much.
//
// Deactivated members are excluded at the join rather than after: this audience reaches a MAILBOX,
// where a deactivated member's feed reaches only a session they no longer have. The same filter the
// capability-holder and assignment resolvers apply, for the same reason.
export function selectDigestCandidatesStatement(
  database: SqlDatabase,
  cadence: NotificationDigestCadence,
  limit: number = MAX_DIGEST_RECIPIENTS_PER_RUN,
): SqlStatement {
  const capped = Math.min(Math.max(limit, 1), MAX_DIGEST_RECIPIENTS_PER_RUN);
  return database
    .prepare(
      `SELECT ${NOTIFICATION_RECIPIENT_TABLE}.recipient_user_id AS recipient_user_id, ` +
        `${NOTIFICATION_DIGEST_RUN_TABLE}.last_occurred_at AS last_occurred_at, ` +
        `${NOTIFICATION_DIGEST_RUN_TABLE}.last_event_id AS last_event_id ` +
        `FROM ${NOTIFICATION_RECIPIENT_TABLE} ` +
        `JOIN ${NOTIFICATION_EVENT_TABLE} ON ${NOTIFICATION_EVENT_TABLE}.id = ${NOTIFICATION_RECIPIENT_TABLE}.notification_event_id ` +
        `JOIN member ON member.user_id = ${NOTIFICATION_RECIPIENT_TABLE}.recipient_user_id AND member.status = 'active' ` +
        `LEFT JOIN ${NOTIFICATION_DIGEST_RUN_TABLE} ON ${NOTIFICATION_DIGEST_RUN_TABLE}.recipient_user_id = ${NOTIFICATION_RECIPIENT_TABLE}.recipient_user_id AND ${NOTIFICATION_DIGEST_RUN_TABLE}.cadence = ?1 ` +
        `WHERE ${NOTIFICATION_DIGEST_RUN_TABLE}.last_occurred_at IS NULL ` +
        `OR ${NOTIFICATION_EVENT_TABLE}.occurred_at > ${NOTIFICATION_DIGEST_RUN_TABLE}.last_occurred_at ` +
        `OR (${NOTIFICATION_EVENT_TABLE}.occurred_at = ${NOTIFICATION_DIGEST_RUN_TABLE}.last_occurred_at AND ${NOTIFICATION_EVENT_TABLE}.id > ${NOTIFICATION_DIGEST_RUN_TABLE}.last_event_id) ` +
        `GROUP BY ${NOTIFICATION_RECIPIENT_TABLE}.recipient_user_id ` +
        `ORDER BY ${NOTIFICATION_RECIPIENT_TABLE}.recipient_user_id LIMIT ?2`,
    )
    .bind(cadence, capped + 1);
}

export async function readDigestCandidates(
  database: SqlDatabase,
  cadence: NotificationDigestCadence,
  limit: number = MAX_DIGEST_RECIPIENTS_PER_RUN,
): Promise<DigestCandidates> {
  const capped = Math.min(Math.max(limit, 1), MAX_DIGEST_RECIPIENTS_PER_RUN);
  const { results } = await selectDigestCandidatesStatement(database, cadence, capped).all<{
    recipient_user_id: string;
    last_occurred_at: string | null;
    last_event_id: string | null;
  }>();
  return {
    candidates: results.slice(0, capped).map((row) => ({
      recipientUserId: row.recipient_user_id,
      // The pair or nothing — the schema's own CHECK says the same thing, and reading half of one
      // as a watermark would walk from a boundary that does not exist.
      watermark:
        row.last_occurred_at === null || row.last_event_id === null
          ? null
          : { lastOccurredAt: row.last_occurred_at, lastEventId: row.last_event_id },
    })),
    clamped: Math.max(0, results.length - capped),
  };
}

// ---- composition ----

// One category's contribution. A label and a number: the entire vocabulary a summary is built from.
export interface DigestCategoryCount {
  readonly category: NotificationCategory;
  readonly count: number;
}

// A row this run did not carry, and the closed reason it did not. Settled all the same, because an
// email that was NOT sent has to be as findable afterwards as one that was — otherwise "nobody
// wrote to me" and "I asked not to be written to" are the same observable, and only one of them is
// a fault.
export interface WithheldDigestRow {
  readonly notificationRecipientId: string;
  readonly reason: NotificationSuppressedReason;
}

export interface DigestComposition {
  readonly cadence: NotificationDigestCadence;
  // Sorted by category so two runs over the same rows render byte-identically.
  readonly counts: readonly DigestCategoryCount[];
  readonly totalCount: number;
  // The counts are a floor rather than an exact number, because the window was capped.
  readonly atLeast: boolean;
  readonly carriedRecipientIds: readonly string[];
  readonly withheld: readonly WithheldDigestRow[];
  // Rows belonging to the OTHER cadence's walk. Not withheld and not carried — the other run has
  // its own watermark and will settle them. Counted only so a pass that is composing nothing can
  // say why.
  readonly deferred: number;
  // Rows a kind declaring `immediate` contributed. A summary may not carry one, so the walk STOPS
  // at the first and the watermark stays behind it rather than stepping over mail nobody sent. No
  // registered kind declares it and a registry fitness test holds that to being deliberate, so this
  // is a bound on a future edit rather than a path with traffic.
  readonly refusedEscalation: number;
  // Where the watermark may move to, or null where it may not move at all.
  readonly advanceTo: DigestWatermark | null;
}

export interface ComposeDigestInput {
  readonly cadence: NotificationDigestCadence;
  readonly window: DigestWindow;
  // The member's resolved email cadence per category — `resolveCategoryPreference`'s answer, read
  // once per member per pass by the shared policy reader.
  readonly cadenceForCategory: (category: NotificationCategory) => NotificationEmailCadence;
  // Defaults to the registry, and exists as a seam because the halt below cannot otherwise be
  // exercised: no registered kind declares `immediate`, deliberately, and a behaviour with no test
  // is a behaviour nobody has checked. A kind the registry does not know falls back to `digest`,
  // which is the safe default — a type removed from the registry still has to be counted rather
  // than silently dropped from somebody's mail.
  readonly escalationFor?: (kind: string) => NotificationEscalation;
}

export function composeDigest(input: ComposeDigestInput): DigestComposition {
  const counts = new Map<NotificationCategory, number>();
  const carriedRecipientIds: string[] = [];
  const withheld: WithheldDigestRow[] = [];
  let deferred = 0;
  let refusedEscalation = 0;
  let advanceTo: DigestWatermark | null = null;
  let halted = false;
  const escalationFor =
    input.escalationFor ?? ((kind: string) => notificationTypeForKey(kind)?.escalation ?? "digest");

  for (const row of input.window.rows) {
    if (halted) {
      refusedEscalation++;
      continue;
    }
    // The stored `category` is the authority for counting, not the registry: it is denormalized onto
    // the event precisely so a count is an index walk, and a kind whose registry entry was removed
    // still has to be counted rather than silently dropped from somebody's mail.
    const category = row.category as NotificationCategory;
    const escalation = escalationFor(row.kind);
    if (escalation === "immediate") {
      // A kind that may not wait a day may not be folded into a day's summary either. Stopping —
      // rather than skipping — is what keeps the watermark honest: stepping over it would settle a
      // row no channel carried, and the count that follows would be a promise nothing kept.
      halted = true;
      refusedEscalation++;
      continue;
    }

    const cadence = input.cadenceForCategory(category);
    if (cadence === "off") {
      withheld.push({
        notificationRecipientId: row.notification_recipient_id,
        reason: "preference",
      });
    } else if (cadence !== input.cadence) {
      deferred++;
    } else {
      counts.set(category, (counts.get(category) ?? 0) + 1);
      carriedRecipientIds.push(row.notification_recipient_id);
    }
    // Every row this run accounted for — carried, withheld, or another cadence's — moves the mark.
    advanceTo = { lastOccurredAt: row.occurred_at, lastEventId: row.notification_event_id };
  }

  // Sorted so two runs over the same rows render byte-identically — a summary that reordered its own
  // categories between sends would look like a different message about the same day.
  const sorted = [...counts]
    .map(([category, count]) => ({ category, count }))
    .toSorted((first, second) => first.category.localeCompare(second.category));

  return {
    cadence: input.cadence,
    counts: sorted,
    totalCount: sorted.reduce((total, entry) => total + entry.count, 0),
    atLeast: input.window.clamped,
    carriedRecipientIds,
    withheld,
    deferred,
    refusedEscalation,
    advanceTo,
  };
}

// ---- settling ----

export function newNotificationDigestId(randomSource?: RandomSource): NotificationDigestId {
  return newIdentifier("notificationDigest", randomSource);
}

// A copy that left the platform. `attempts` is 1 because it took one, and `digest_id` names which
// summary carried it — the only join from a delivered row back to the run that delivered it.
function sentDeliveryStatement(
  database: SqlDatabase,
  options: {
    readonly notificationRecipientId: string;
    readonly digestId: NotificationDigestId;
    readonly now: string;
    readonly randomSource?: RandomSource;
  },
): SqlStatement {
  return database
    .prepare(
      `INSERT INTO ${NOTIFICATION_DELIVERY_TABLE} (id, notification_recipient_id, channel, state, attempts, suppressed_reason, digest_id, dispatched_at, created_at) ` +
        `VALUES (?1, ?2, 'email', 'sent', 1, NULL, ?3, ?4, ?4) ON CONFLICT(notification_recipient_id, channel) DO NOTHING`,
    )
    .bind(
      newIdentifier("notificationDelivery", options.randomSource),
      options.notificationRecipientId,
      options.digestId,
      options.now,
    );
}

// A copy that did NOT leave, and the closed label saying why. `suppressed` is a real state rather
// than an absent row: "we decided not to mail you about this" is a fact a support conversation needs
// and an absence cannot express. `digest_id` is null because no summary carried it, `attempts` is
// zero because nothing was attempted, and the reason is a label and never a sentence.
function suppressedDeliveryStatement(
  database: SqlDatabase,
  options: {
    readonly notificationRecipientId: string;
    readonly reason: NotificationSuppressedReason;
    readonly now: string;
    readonly randomSource?: RandomSource;
  },
): SqlStatement {
  return database
    .prepare(
      `INSERT INTO ${NOTIFICATION_DELIVERY_TABLE} (id, notification_recipient_id, channel, state, attempts, suppressed_reason, digest_id, dispatched_at, created_at) ` +
        `VALUES (?1, ?2, 'email', 'suppressed', 0, ?3, NULL, NULL, ?4) ON CONFLICT(notification_recipient_id, channel) DO NOTHING`,
    )
    .bind(
      newIdentifier("notificationDelivery", options.randomSource),
      options.notificationRecipientId,
      options.reason,
      options.now,
    );
}

// The watermark upsert. One row per member per cadence, moved forward in place — a run's history is
// the `notification_delivery` rows it wrote, not a second log of where it had got to.
export function advanceDigestWatermarkStatement(
  database: SqlDatabase,
  options: {
    readonly recipientUserId: string;
    readonly cadence: NotificationDigestCadence;
    readonly watermark: DigestWatermark;
    readonly now: string;
    readonly randomSource?: RandomSource;
  },
): SqlStatement {
  return database
    .prepare(
      `INSERT INTO ${NOTIFICATION_DIGEST_RUN_TABLE} (id, recipient_user_id, cadence, last_occurred_at, last_event_id, last_run_at, created_at, updated_at) ` +
        `VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?6, ?6) ` +
        `ON CONFLICT(recipient_user_id, cadence) DO UPDATE SET last_occurred_at = excluded.last_occurred_at, last_event_id = excluded.last_event_id, last_run_at = excluded.last_run_at, updated_at = excluded.updated_at`,
    )
    .bind(
      newNotificationDigestId(options.randomSource),
      options.recipientUserId,
      options.cadence,
      options.watermark.lastOccurredAt,
      options.watermark.lastEventId,
      options.now,
    );
}

// A run that composed nothing worth mailing still records that it ran, so "this member has never
// been written to" and "there has been nothing to write about" stay distinguishable. The watermark
// itself is untouched by this: only rows that were actually accounted for move it.
export function recordDigestRunStatement(
  database: SqlDatabase,
  options: {
    readonly recipientUserId: string;
    readonly cadence: NotificationDigestCadence;
    readonly now: string;
    readonly randomSource?: RandomSource;
  },
): SqlStatement {
  return database
    .prepare(
      `INSERT INTO ${NOTIFICATION_DIGEST_RUN_TABLE} (id, recipient_user_id, cadence, last_occurred_at, last_event_id, last_run_at, created_at, updated_at) ` +
        `VALUES (?1, ?2, ?3, NULL, NULL, ?4, ?4, ?4) ` +
        `ON CONFLICT(recipient_user_id, cadence) DO UPDATE SET last_run_at = excluded.last_run_at, updated_at = excluded.updated_at`,
    )
    .bind(
      newNotificationDigestId(options.randomSource),
      options.recipientUserId,
      options.cadence,
      options.now,
    );
}

export interface SettleDigestInput {
  readonly recipientUserId: string;
  readonly cadence: NotificationDigestCadence;
  readonly composition: DigestComposition;
  // Present when a summary actually left the platform. Absent when nothing was sent — either there
  // was nothing to say, or every row in the window was withheld.
  readonly digestId: NotificationDigestId | null;
  // Set when the whole window was withheld for a reason that is not a per-category preference — a
  // member with no address to write to, or a firm or member who set the detail level to `off`.
  readonly withholdAllReason?: NotificationSuppressedReason;
  readonly now: string;
  readonly randomSource?: RandomSource;
}

// ONE batch: the delivery rows and the watermark move together. A crash between them would either
// re-send a summary already settled (harmless — the conflict clause absorbs it) or advance past
// rows nothing recorded (not harmless), and committing them together removes the second.
export function settleDigestStatements(
  database: SqlDatabase,
  input: SettleDigestInput,
): readonly SqlStatement[] {
  const statements: SqlStatement[] = [];
  const { composition } = input;

  if (input.digestId !== null) {
    for (const notificationRecipientId of composition.carriedRecipientIds) {
      statements.push(
        sentDeliveryStatement(database, {
          notificationRecipientId,
          digestId: input.digestId,
          now: input.now,
          randomSource: input.randomSource,
        }),
      );
    }
  } else if (input.withholdAllReason !== undefined) {
    // Nothing was sent for a reason that applies to the member rather than to a category, so the
    // rows this run WOULD have carried are settled as suppressed under that reason. Without this,
    // a member with no address would look exactly like a member with nothing to hear about.
    for (const notificationRecipientId of composition.carriedRecipientIds) {
      statements.push(
        suppressedDeliveryStatement(database, {
          notificationRecipientId,
          reason: input.withholdAllReason,
          now: input.now,
          randomSource: input.randomSource,
        }),
      );
    }
  }

  for (const row of composition.withheld) {
    statements.push(
      suppressedDeliveryStatement(database, {
        notificationRecipientId: row.notificationRecipientId,
        reason: row.reason,
        now: input.now,
        randomSource: input.randomSource,
      }),
    );
  }

  // The watermark moves only where the run actually settled the rows it walked. A send that never
  // happened and was not recorded as suppressed leaves the mark where it was, and the next run
  // reads the same window — at-least-once, which is the side of the trade a missed deadline decides.
  const settled =
    input.digestId !== null ||
    input.withholdAllReason !== undefined ||
    composition.carriedRecipientIds.length === 0;
  if (settled && composition.advanceTo !== null) {
    statements.push(
      advanceDigestWatermarkStatement(database, {
        recipientUserId: input.recipientUserId,
        cadence: input.cadence,
        watermark: composition.advanceTo,
        now: input.now,
        randomSource: input.randomSource,
      }),
    );
  } else {
    statements.push(
      recordDigestRunStatement(database, {
        recipientUserId: input.recipientUserId,
        cadence: input.cadence,
        now: input.now,
        randomSource: input.randomSource,
      }),
    );
  }

  return statements;
}
