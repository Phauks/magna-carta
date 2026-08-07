import type { BatchDatabase } from "@magna-carta/data-access/effect-batch";
import type { SqlDatabase } from "@magna-carta/data-access/idempotency-statements";
import type { RandomSource } from "@magna-carta/identifiers/random";
import type { UserId } from "@magna-carta/identifiers/types";
import { FactsValidationError } from "./facts-grammar.ts";
import { materializeNotification, outboxDedupeKey } from "./materialize.ts";
import { resolveNotificationRecipients } from "./recipients.ts";
import { notificationTypesForTopic, type NotificationType } from "./registry.ts";
import { insertNotificationStatements } from "./statements.ts";

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
}

const EMPTY_RESULT: TranslateResult = {
  matchedTypes: 0,
  materializedEvents: 0,
  recipientRows: 0,
  emptyAudiences: 0,
  clampedRecipients: 0,
  substitutedAudiences: 0,
  refusedFacts: 0,
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
      now: options.now,
    });
    if (audience.substituted) substitutedAudiences++;
    if (audience.recipientUserIds.length === 0) {
      emptyAudiences++;
      // No recipients means no feed rows, and an event row nobody can see is a row that only the
      // retention sweep will ever touch. Do not write one.
      continue;
    }

    const now = options.now();
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
    await options.database.batch([
      ...insertNotificationStatements(options.database, materialization),
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
