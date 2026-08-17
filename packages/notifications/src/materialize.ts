import { newIdentifier } from "@magna-carta/identifiers/generate";
import type { RandomSource } from "@magna-carta/identifiers/random";
import type {
  NotificationEventId,
  NotificationRecipientId,
  UserId,
} from "@magna-carta/identifiers/types";
import { assertFacts, type Facts } from "./facts-grammar.ts";
import type { NotificationRaisedBy, NotificationType } from "./registry.ts";
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

// WHAT THE DEDUPE KEY GUARANTEES, AND FOR HOW LONG.
//
// The uniqueness lives in one UNIQUE index on `notification_event.dedupe_key` — and the retention
// sweep in `retention.ts` DELETES that row on the firm's window. So the key is a
// DUPLICATE-SUPPRESSION FLOOR, not a permanent record that a subject was ever notified about: it
// makes a second raise of the same key a no-op only for as long as the row it lives on survives.
// Read as "once, ever" it is a promise the storage does not make.
//
// That is not a defect, because no production path can re-present a key after the window. Each has a
// REDELIVERY HORIZON — the longest a duplicate of one key can arrive after the first — and every one
// of them is far shorter than the thirty-day retention floor in `types.ts`. The horizons are declared
// below rather than left to be re-derived, because the property is what makes the sweep safe and it
// is invisible in either file alone.
//
// The rule that follows, and the one thing to get right when adding a raiser: A CONDITION THAT MUST
// RAISE ONCE PER SUBJECT FOREVER DOES NOT USE THIS KEY FOR THAT. It carries its convergence in the
// owning subsystem's own tables — a row with its own UNIQUE index and its own retention posture — and
// the notification points at that record. Billing's payment reminders are the worked example: the
// convergence is a `invoice_reminder` row, unique on the invoice and the reason, and it outlives the
// notification that announced it precisely because it is a billing row rather than a pointer. This
// subsystem's own rule already implies it — a notification is a pointer and never a record — and this
// is the consequence of that rule for idempotency.

// How long a duplicate of one key can arrive after the first, per production path. Named so the
// retention sweep's safety is checkable rather than assumed.
export type ConvergenceHorizon =
  // The dispatchable life of one outbox row. `sweepOutbox` publishes only rows with
  // `status = 'pending'` and flips each to `dispatched` (or terminally `failed`), so the relay never
  // re-publishes a row it carried. A duplicate therefore comes from overlapping sweeps or a queue
  // redelivery — minutes — or from an operator deliberately reviving a dead-lettered row. Nothing
  // re-presents a ninety-day-old outbox row on its own.
  | "outbox-row-dispatch"
  // One civil day, and the bucket only ever MOVES FORWARD: both comparison collectors derive the
  // date from the pass's own instant, so a pass can produce today's bucket and never a past one. A
  // swept key for a date gone by is unreachable by construction, not merely unlikely.
  | "civil-day"
  // The life of one job. A coordinator reports each terminal state it reaches once, within the job's
  // own lifetime; nothing revisits a job that ended a window ago.
  | "job-terminal-outcome";

// One horizon per production path, exhaustive over the union by construction:
// `Record<NotificationRaisedBy, ...>` refuses to compile if a fourth raiser is added without stating
// how long its key has to hold. That refusal is the point — a raiser whose condition needs
// once-per-subject-forever convergence has to confront the boundary here rather than discover it as
// a notification that quietly raises itself again months later.
export const CONVERGENCE_HORIZON_BY_RAISER: Readonly<
  Record<NotificationRaisedBy, ConvergenceHorizon>
> = Object.freeze({
  "outbox-topic": "outbox-row-dispatch",
  "comparison-sweep": "civil-day",
  "job-coordinator": "job-terminal-outcome",
});

// The event-driven path's key: the topic plus the ORIGINATING OUTBOX ROW ID. That id is stable
// across every redelivery of the message, so a redelivery is a no-op by construction rather than by
// a check-then-insert that has its own race.
//
// Its horizon is the outbox row's dispatchable life. Note where the once-ever guarantee actually
// comes from on this path when a condition needs one: from the PRODUCER, which committed exactly one
// outbox row against its own convergence table in the same batch as the write. This key inherits
// that; it does not supply it.
export function outboxDedupeKey(topic: string, outboxRowId: string): string {
  return `${topic}:${outboxRowId}`;
}

// The comparison-driven path's key: the kind, the subject, and a CIVIL DATE. The date is the whole
// reason a comparison needs a bucket — `deadline.overdue` is true continuously, so without one a
// firm gets a notification about the same deadline every time the sweep runs, forever. The date is
// computed in the firm's own zone by the caller, because "which day is it" is a question with a
// different answer in Reno and in Berlin.
//
// So the guarantee here is ONCE PER SUBJECT PER CIVIL DAY, never once per subject. It is what the
// path wants — a deadline still overdue tomorrow is worth saying again tomorrow — and it is also what
// makes the retention sweep harmless on this path: a caller derives the date from the pass's own
// instant, so the bucket only moves forward and a swept key for a past date can never be built
// again. A caller that passed a date from anywhere but its own clock would break that, which is why
// `test/retention-convergence.test.ts` holds the collectors to deriving it from `now`.
export function comparisonDedupeKey(kind: string, subjectId: string, civilDate: string): string {
  return `${kind}:${subjectId}:${civilDate}`;
}

// A job coordinator's key: the kind, the job, and WHICH TERMINAL STATE it reported. The outcome is
// in the key rather than only in the facts because a job can honestly report more than one: a slow
// assembly can be failed by its stuck-job alarm and then report success, and the coordinator lets
// the confirmed result win. Keying on the job alone would leave the timeout's row standing and tell
// the member their document failed while it sits filed on the matter. Redelivery of either report
// is still a no-op, which is the property the key exists for.
//
// Its horizon is the job's own life. A job id is never reissued, so the key is unique forever in
// principle; what makes it retention-safe is that nothing revisits a job that ended a window ago, so
// the row's disappearance is never observed.
export function jobCompletionDedupeKey(
  kind: string,
  subjectId: string,
  terminalOutcome: string,
): string {
  return `${kind}:${subjectId}:${terminalOutcome}`;
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
