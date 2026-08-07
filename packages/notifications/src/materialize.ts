import { newIdentifier } from "@magna-carta/identifiers/generate";
import type { RandomSource } from "@magna-carta/identifiers/random";
import type {
  NotificationEventId,
  NotificationRecipientId,
  UserId,
} from "@magna-carta/identifiers/types";
import { assertFacts, type Facts } from "./facts-grammar.ts";
import type { NotificationType } from "./registry.ts";
import { MAX_RECIPIENTS_PER_EVENT } from "./types.ts";

// Turning a decided notification into the rows that represent it. Pure: no clock, no database, no
// binding. Everything time-shaped arrives as an argument, so a materialization is reproducible and
// a test does not have to freeze a clock to assert what was written.

export interface MaterializedEventRow {
  readonly id: NotificationEventId;
  readonly kind: string;
  readonly category: string;
  readonly severity: string;
  readonly subjectKind: string;
  readonly subjectId: string;
  readonly matterId: string | null;
  readonly occurredAt: string;
  readonly facts: Facts;
  readonly dedupeKey: string;
  readonly createdAt: string;
}

export interface MaterializedRecipientRow {
  readonly id: NotificationRecipientId;
  readonly notificationEventId: NotificationEventId;
  readonly recipientUserId: UserId;
  readonly createdAt: string;
}

export interface Materialization {
  readonly event: MaterializedEventRow;
  readonly recipients: readonly MaterializedRecipientRow[];
  // How many recipients the cap removed. A fan-out larger than a firm's staff means a resolver bug,
  // and reporting the clamp turns that into a counter instead of a mail storm nobody can explain.
  readonly clampedRecipients: number;
}

export interface MaterializeInput {
  readonly type: NotificationType;
  readonly payload: Readonly<Record<string, unknown>>;
  readonly subjectId: string;
  readonly matterId: string | null;
  readonly recipientUserIds: readonly UserId[];
  readonly dedupeKey: string;
  readonly occurredAt: string;
  readonly createdAt: string;
  readonly randomSource?: RandomSource;
}

// The event-driven path's key: the topic plus the ORIGINATING OUTBOX ROW ID. That id is stable
// across every redelivery of the message, so a redelivery is a no-op by construction rather than by
// a check-then-insert that has its own race.
export function outboxDedupeKey(topic: string, outboxRowId: string): string {
  return `${topic}:${outboxRowId}`;
}

// The comparison-driven path's key: the kind, the subject, and a CIVIL DATE. The date is the whole
// reason a comparison needs a bucket — `deadline.overdue` is true continuously, so without one a
// firm gets a notification about the same deadline every time the sweep runs, forever. The date is
// computed in the firm's own zone by the caller, because "which day is it" is a question with a
// different answer in Reno and in Berlin.
export function comparisonDedupeKey(kind: string, subjectId: string, civilDate: string): string {
  return `${kind}:${subjectId}:${civilDate}`;
}

// Builds the event row and its recipient rows. The facts are validated against the type's own
// declaration BEFORE anything is composed, so a materializer that computes a value outside its
// declared grammar throws here rather than persisting a string somebody typed.
export function materializeNotification(input: MaterializeInput): Materialization {
  const { type } = input;
  if (type.matterAnchored && input.matterId === null) {
    // The wall is a join on this column, so a matter-anchored row without one is not "unfiltered",
    // it is UNFILTERABLE — the predicate has nothing to decide about and the row would either
    // vanish from every read or appear in all of them, depending on how the join were written.
    // Neither is acceptable, so this is a refusal and not a warning.
    throw new Error(
      `notification ${type.key} is matter-anchored but its materializer resolved no matter`,
    );
  }

  const facts = assertFacts(type.key, type.facts, type.buildFacts(input.payload));

  const eventId = newIdentifier("notificationEvent", input.randomSource);
  const event: MaterializedEventRow = {
    id: eventId,
    kind: type.key,
    category: type.category,
    severity: type.severity,
    subjectKind: type.subjectKind,
    subjectId: input.subjectId,
    matterId: input.matterId,
    occurredAt: input.occurredAt,
    facts,
    dedupeKey: input.dedupeKey,
    createdAt: input.createdAt,
  };

  // De-duplicate before capping so a resolver that returned the same member twice does not consume
  // two of the two hundred slots — and so the clamp count reports people, not rows.
  const distinct = [...new Set(input.recipientUserIds)];
  const kept = distinct.slice(0, MAX_RECIPIENTS_PER_EVENT);
  const recipients = kept.map((recipientUserId) => ({
    id: newIdentifier("notificationRecipient", input.randomSource),
    notificationEventId: eventId,
    recipientUserId,
    createdAt: input.createdAt,
  }));

  return { event, recipients, clampedRecipients: distinct.length - kept.length };
}
