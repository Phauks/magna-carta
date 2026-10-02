import { commitEffectBatch } from "@magna-carta/data-access/effect-batch";
import type { BatchDatabase } from "@magna-carta/data-access/effect-batch";
import type { SqlDatabase } from "@magna-carta/data-access/idempotency-statements";
import type { RandomSource } from "@magna-carta/identifiers/random";
import type { UserId } from "@magna-carta/identifiers/types";
import { FactsValidationError } from "./facts-grammar.ts";
import { materializeNotification, outboxDedupeKey } from "./materialize.ts";
import { createNotificationPolicyReader } from "./preferences.ts";
import { resolveNotificationRecipients } from "./recipients.ts";
import { notificationTypesForTopic, type NotificationType } from "./registry.ts";
import { insertNotificationStatements } from "./statements.ts";
import { inAppSuppressionEffects, type InAppSuppressionCount } from "./suppression-statements.ts";

// THE SUBSCRIBER. One message off the per-firm bus in, zero or more notifications out.
//
// This is where "the emission half is already built" becomes true in code. Thirty-one topics
// already commit a durable outbox row in the SAME ATOMIC BATCH as the write that produced them, and
// the relay already publishes them onto a per-firm queue that already resolves the firm's database
// and dispatches by topic. So the Notifications subsystem is a CONSUMER of that bus and the owner
// of nothing on it: no producing package changed, no emitting write path grew a second write, and
// no money movement doubled its write amplification.
//
// Two properties that has to preserve, and both are about not breaking the bus for everybody else:
//
//   * AN UNKNOWN TOPIC IS THE ORDINARY CASE. Most of the thirty topics have no notification type,
//     and finding none must never throw — a throw would dead-letter or retry-storm a message
//     nobody handles.
//   * A TOPIC MAY HAVE BOTH A BUSINESS CONSUMER AND A NOTIFICATION, and neither may suppress the
//     other. `shipment.purchased` posts costs AND may notify. So this runs as a SECOND,
//     non-exclusive pass after the owning handler rather than as another row in the dispatch table.
//
// And the asymmetry that decides what happens when one of them fails: the owning handler's failure
// propagates (it always did), and this translator's failure is caught, counted, and logged by its
// caller. A missed notification is an annoyance; a re-driven cost posting is a double charge. Where
// the two are not equal, the weaker one yields.

export interface TranslateOptions {
  readonly database: BatchDatabase;
  // The originating outbox row id. THE dedupe anchor: it is stable across every redelivery of the
  // message, so a redelivery re-derives the identical key and the unique index refuses the second
  // insert. There is no separate message-id dedup table because there does not need to be one.
  readonly outboxRowId: string;
  readonly topic: string;
  // The outbox payload as delivered: canonical JSON, already redacted by its producer.
  readonly payload: string;
  readonly now: () => string;
  readonly randomSource?: RandomSource;
}

export interface TranslateResult {
  // How many types matched the topic. Zero is the ordinary case for most of the bus.
  readonly matchedTypes: number;
  readonly materializedEvents: number;
  readonly recipientRows: number;
  // Types that matched but resolved to nobody — a real outcome worth counting rather than silently
  // succeeding at. A type that never reaches anybody is either a resolver bug or an audience that
  // has not been configured, and both are invisible without this.
  readonly emptyAudiences: number;
  readonly clampedRecipients: number;
  readonly substitutedAudiences: number;
  // Types whose producer sent facts the type's own declaration refuses. PERMANENT — a producer
  // changed shape, and no number of retries makes the payload conform — so it is reported rather
  // than thrown, and one such type does not stop its siblings on the same topic. The caller's
  // counter is what makes it visible.
  readonly refusedFacts: number;
  // Members the audience reached who got no feed row because a preference silenced the category, by
  // category and by whose choice it was. Reported so the caller can count it: an absent feed row
  // that nobody counted is indistinguishable afterwards from a notification that was never raised,
  // which is the failure mode a preference system has.
  readonly suppressedInApp: readonly InAppSuppressionCount[];
  // Recipients the firm's trust-compliance designation added over the type's own audience.
  readonly designatedRecipients: number;
}

const EMPTY_RESULT: TranslateResult = {
  matchedTypes: 0,
  materializedEvents: 0,
  recipientRows: 0,
  emptyAudiences: 0,
  clampedRecipients: 0,
  substitutedAudiences: 0,
  refusedFacts: 0,
  suppressedInApp: [],
  designatedRecipients: 0,
};

export async function translateOutboxMessage(options: TranslateOptions): Promise<TranslateResult> {
  const types = notificationTypesForTopic(options.topic);
  if (types.length === 0) return EMPTY_RESULT;

  const payload = parsePayload(options.payload);
  if (payload === null) {
    // A payload that will not parse is permanently unprocessable: retrying cannot make it valid.
    // The message is not this subsystem's to fail — an owning handler may well have read it fine —
    // so treat it as no match and let the caller ack.
    return EMPTY_RESULT;
  }

  let materializedEvents = 0;
  let recipientRows = 0;
  let emptyAudiences = 0;
  let clampedRecipients = 0;
  let substitutedAudiences = 0;
  let refusedFacts = 0;
  let designatedRecipients = 0;
  const suppressedInApp: InAppSuppressionCount[] = [];

  // One reader for the whole message: a topic may carry several types over the same recipients, and
  // the preference chain does not change between them.
  const policy = createNotificationPolicyReader(options.database);

  for (const type of types) {
    const subjectId = payload[type.subjectPayloadKey];
    if (typeof subjectId !== "string" || subjectId.length === 0) continue;

    const matterId = await resolveMatterId(options.database, type, payload, subjectId);
    if (type.matterAnchored && matterId === null) {
      // The subject is gone, or its matter is — a version whose file was removed between the write
      // and this pass. There is nothing to anchor the row to and therefore no way to filter it, so
      // it is not written. Skipped rather than thrown: this is a race, not a fault, and retrying
      // will not make the matter reappear.
      continue;
    }

    const audience = await resolveNotificationRecipients(type, {
      database: options.database,
      matterId,
      actorUserId: readActor(payload),
      // The member a `named-recipient` type names. Read from the payload rather than from the
      // subject's row, so the person told is whoever was named at the write.
      namedRecipientUserId: readNamedRecipient(type, payload),
      // The members a `named-members` type names, from the same declared payload field. Read here
      // for the same reason the single handle is: the invitation is addressed to whoever was on the
      // event at the write.
      namedMemberUserIds: readNamedMembers(type, payload),
      now: options.now,
      policy,
    });
    if (audience.substituted) substitutedAudiences++;
    designatedRecipients += audience.designatedAdded;

    const now = options.now();
    // Recorded whether or not an event is written. A category everybody silenced produces no event
    // and no feed row, and the tally is then the ONLY record that anything was decided — which is
    // exactly the case a member asking "why did nobody tell me" needs answered.
    const suppression = inAppSuppressionEffects(options.database, {
      category: type.category,
      suppressed: audience.suppressed,
      now,
    });
    suppressedInApp.push(...suppression.counts);

    if (audience.recipientUserIds.length === 0) {
      // An audience that resolved to nobody and an audience everybody in it silenced are different
      // facts, and only one of them is a resolver bug. Counting the second as the first would hide
      // a working preference behind a counter that means "something is broken".
      if (audience.suppressed.length === 0) emptyAudiences++;
      else
        await commitEffectBatch(
          options.database,
          { statements: suppression.statements, outboxMessages: [] },
          { now: () => new Date().toISOString() },
        );
      // No recipients means no feed rows, and an event row nobody can see is a row that only the
      // retention sweep will ever touch. Do not write one.
      continue;
    }
    let materialization;
    try {
      materialization = materializeNotification({
        type,
        payload,
        subjectId,
        matterId,
        recipientUserIds: audience.recipientUserIds,
        dedupeKey: outboxDedupeKey(options.topic, options.outboxRowId),
        // The outbox row was written in the same batch as the change it describes, so the message's
        // arrival time is not when the thing happened. This pass has no better witness than its own
        // clock, and using it means a message that sat in the queue ages and digests from now rather
        // than from a time nothing recorded. Where a producer starts carrying its own instant, that
        // is the value to prefer.
        occurredAt: now,
        createdAt: now,
        randomSource: options.randomSource,
      });
    } catch (caught) {
      if (caught instanceof FactsValidationError) {
        // The producer sent something this type's declaration refuses — it changed shape. PERMANENT:
        // no retry can make the payload conform, so this is reported and the sibling types on the
        // same topic still run. Letting it throw would hand the caller a fault indistinguishable
        // from a database outage, and the caller's whole retry decision turns on that difference.
        refusedFacts++;
        continue;
      }
      throw caught;
    }

    // Everything past here is a database write, so a throw from it IS plausibly transient — which
    // is precisely what the caller retries on when nothing else has committed for the message.
    // The suppression tally rides the SAME batch as the rows it is the counterpart of: who was told
    // and who was not are one decision, and committing them apart would leave a crash between them
    // reporting one without the other.
    await options.database.batch([
      ...insertNotificationStatements(options.database, materialization),
      ...suppression.statements,
    ]);

    materializedEvents++;
    recipientRows += materialization.recipients.length;
    clampedRecipients += materialization.clampedRecipients;
  }

  return {
    matchedTypes: types.length,
    materializedEvents,
    recipientRows,
    emptyAudiences,
    clampedRecipients,
    substitutedAudiences,
    refusedFacts,
    suppressedInApp,
    designatedRecipients,
  };
}

function parsePayload(raw: string): Readonly<Record<string, unknown>> | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  return parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)
    ? (parsed as Record<string, unknown>)
    : null;
}

// The actor, where a producer names one. Most do not — the payloads on this bus are identifiers and
// non-privileged fields, and the member who performed the act is usually not among them. That is
// fine: the actor is EXCLUDED by default anyway, since nobody needs telling they did the thing they
// just did.
function readActor(payload: Readonly<Record<string, unknown>>): UserId | null {
  const actor = payload["actorUserId"];
  return typeof actor === "string" ? (actor as UserId) : null;
}

// The one member a `named-recipient` type is for, from the payload field the TYPE declares. Every
// other audience declares no key and gets null, which is why an unreadable value is null rather than
// a throw: the audience that wants it is the only one that will miss it, and it then reaches nobody
// rather than guessing at somebody.
function readNamedRecipient(
  type: NotificationType,
  payload: Readonly<Record<string, unknown>>,
): UserId | null {
  const key = type.audiencePayloadKey;
  if (key === undefined) return null;
  const named = payload[key];
  return typeof named === "string" && named.length > 0 ? (named as UserId) : null;
}

// The members a `named-members` type is for, from the payload field the TYPE declares. The same
// indirection the single handle takes, and the same tolerance: a field that is not an array of
// non-empty strings yields an empty list rather than a throw, because the audience that wants it is
// the only one that will miss it, and a producer that changed shape is reported by the empty-audience
// counter rather than by dead-lettering a message an owning handler read perfectly well.
function readNamedMembers(
  type: NotificationType,
  payload: Readonly<Record<string, unknown>>,
): readonly UserId[] {
  const key = type.audiencePayloadKey;
  if (key === undefined) return [];
  const named = payload[key];
  if (!Array.isArray(named)) return [];
  return named.filter((value): value is UserId => typeof value === "string" && value.length > 0);
}

async function resolveMatterId(
  database: SqlDatabase,
  type: NotificationType,
  payload: Readonly<Record<string, unknown>>,
  subjectId: string,
): Promise<string | null> {
  switch (type.matterResolution.kind) {
    case "none":
      return null;
    case "payload": {
      const value = payload[type.matterResolution.payloadKey];
      return typeof value === "string" && value.length > 0 ? value : null;
    }
    case "query": {
      const { results } = await database
        .prepare(type.matterResolution.sql)
        .bind(subjectId)
        .all<{ matter_id: string | null }>();
      const row = results[0];
      return row?.matter_id ?? null;
    }
  }
}
