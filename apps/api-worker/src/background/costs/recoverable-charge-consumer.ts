import { canonicalJsonStringify } from "@magna-carta/data-access/canonical";
import { runIdempotentEffect } from "@magna-carta/data-access/run-idempotent-effect";
import { readFirmSetting } from "@magna-carta/data-access/setting-statements";
import { captureCost } from "@magna-carta/costs/cost-entry-service";
import { CostValidationError } from "@magna-carta/costs/cost-validation";
import { chargeToCaptureInputs } from "@magna-carta/costs/recoverable-charge";
import { recoverPlatformFeeDefinition } from "@magna-carta/costs/recovery-policy";
import { assertIdentifier } from "@magna-carta/identifiers/validate";
import { notificationTypesForTopic } from "@magna-carta/notifications/registry";
import { translateOutboxMessage } from "@magna-carta/notifications/translate";
import { newCorrelationId } from "@magna-carta/telemetry/ids";
import type { Logger } from "@magna-carta/telemetry/logger";
import { logOperationFailed } from "@magna-carta/telemetry/operation";
import { createWorkersLogger } from "@magna-carta/telemetry/workers-logger";
import type { Bindings } from "../../bindings.ts";
import { MAGNUS_TURN_SUBMITTED_TOPIC } from "@magna-carta/magnus/turn";
import { RECHECK_CAUSE_TOPICS } from "@magna-carta/conflicts/recheck-cause";
import { CONFLICTS_RECHECK_REQUESTED_TOPIC } from "@magna-carta/conflicts/topics";
import {
  NATURAL_LANGUAGE_FEED_DELETION_TOPIC,
  NATURAL_LANGUAGE_INSTANCE_PROVISION_TOPIC,
  NATURAL_LANGUAGE_INSTANCE_TEARDOWN_TOPIC,
  type NaturalLanguageFeedDeletionPayload,
} from "@magna-carta/search/natural-language-topics";
import { RECORD_INDEX_REBUILD_REQUESTED_TOPIC } from "@magna-carta/search/record-index-topics";
import { consumeRecheckRequest } from "../conflicts/recheck-request-consumer.ts";
import { consumeRecheckRun } from "../conflicts/recheck-run-consumer.ts";
import { CAPTURE_ROUTE_TOPIC } from "../../emails/capture-address-service.ts";
import { FILE_VERSION_COMMITTED_TOPIC } from "@magna-carta/file-manager/topics";
import {
  EXPORT_COPY_REQUESTED_TOPIC,
  handleExportCopyRequested,
} from "../../exports/export-copy-consumer.ts";
import { consumeCaptureRouteRegistration } from "../emails/capture-route-consumer.ts";
import {
  firmDatabaseFor,
  type ProxyBatchDatabase,
} from "../../firm-database/firm-database-proxy.ts";
import { forwardMagnusTurnSubmitted } from "../../magnus/turn-relay.ts";
import {
  handleNaturalLanguageFeedDeletion,
  handleNaturalLanguageProvision,
  handleNaturalLanguageTeardown,
} from "../../search/natural-language-lifecycle.ts";
import { rebuildRecordIndexPlacesBehind } from "../../search/record-index-rebuild.ts";
import {
  buildShipmentRecoverableCharge,
  parseShipmentPurchasedPayload,
} from "../../costs/shipping-cost-recovery.ts";

// The dispatcher for the shared per-firm queue, and the home of its first topic: posting matter
// disbursements for the financial core. Every active firm's outbox rows cross the SINGLE bound
// env.QUEUE, so the relay tags each message with the originating firmId — the consumer has no other
// handle on which physical database a row came from, and resolves the firm database from the message.
// Topics beyond cost recovery register their handler in the table below and implement it in their own
// subsystem's module (the email capture-route registration is the first of those).
//
// The dispatch table mirrors the control-plane CONSUMERS map (scheduled.ts), with ONE deliberate
// difference: the control-plane sweep THROWS on an unregistered topic because it owns its whole
// closed topic set; this per-firm bus is OPEN. The relay sweeps EVERY per-firm outbox topic onto this
// one queue (shipment.created and shipment.refunded ride alongside shipment.purchased, and future
// slices add more), but this consumer only owns cost recovery for shipment.purchased. So an unknown
// topic is ACKED AND IGNORED, never thrown — throwing would dead-letter or retry-storm a message we
// simply do not handle. A counter makes the drop observable rather than silent.
//
// Beside that table there is a SECOND, NON-EXCLUSIVE PASS: the notification translator, which owns
// no topic and subscribes to many. It runs AFTER the owning handler and cannot suppress it or be
// suppressed by it — a topic may legitimately both post costs and notify. Whether ITS failure acks
// or retries depends on whether an owning handler already committed for the message; see
// offerToNotifications below for the two arms and why they differ.
//
// IDEMPOTENCY has two floors, both keyed on the per-line recoveryRef (`${shipmentId}:${category}`):
// the per-line idempotency record committed in the same atomic batch as the cost insert, and the
// cost_entry recovery_ref unique index. A queue redelivery re-derives identical keys, so the
// idempotency pre-check replays the stored response and no second row is posted. There is no separate
// message.id dedup table — the recoveryRef is the natural idempotency key.

// The per-firm queue message the outbox relay publishes (scheduled.ts). payload is the outbox row's
// canonical JSON delivered as a STRING (parse it before reading the fields); topic — not type —
// selects the handler; id is the originating outbox row id (for telemetry, not dedup).
export interface PerFirmQueueMessage {
  readonly id: string;
  readonly firmId: string;
  readonly topic: string;
  readonly payload: string;
  readonly aggregateKey: string | null;
  readonly seq: number | null;
  // When the outbox row was written, and therefore when the business write it describes committed.
  // Optional because a message enqueued before the relay carried it through has none; a handler that
  // needs it falls back to its own clock rather than refusing the message.
  readonly causeOccurredAt?: string;
}

// Recognizes a cost_entry.recovery_ref UNIQUE violation. After the 24h idempotency-TTL purge the
// per-line idempotency record is gone, so a redelivered already-posted line slips past the idempotency
// pre-check and re-attempts the insert — the recovery_ref unique index is the surviving floor. D1
// surfaces SQLite's message text; detection is centralized here so a wire-format change is a one-line fix.
function isRecoveryRefConflict(error: unknown): boolean {
  return (
    error instanceof Error &&
    error.message.includes("UNIQUE constraint failed") &&
    error.message.includes("cost_entry.recovery_ref")
  );
}

// A per-topic handler: the firm database is already resolved (the dispatcher addresses the firm's
// FirmDatabase Durable Object by firmId), and the handler reads what it needs from the message payload.
// `env` rides along because a per-firm effect may have a CONTROL-PLANE consequence — the capture-route
// registration is one: its business row is per-firm, but the routing index it must reach is shared.
type PerFirmTopicHandler = (
  env: Bindings,
  firmDatabase: ProxyBatchDatabase,
  message: PerFirmQueueMessage,
  logger: Logger,
) => Promise<void>;

// Topic → handler. Mirrors CONTROL_PLANE_CONSUMERS; add a row to own a new per-firm topic.
//
// The conflicts entries are the one BLOCK rather than one row: every corpus-change topic that could
// alter an already-checked matter's answer routes to the same request handler, and the catalogue of
// which topics those are belongs to the conflicts package rather than to this table. Spreading it
// here means adding a cause is one entry in that catalogue and nothing at all in this file.
const PER_FIRM_CONSUMERS: Readonly<Record<string, PerFirmTopicHandler>> = {
  "shipment.purchased": handleShipmentPurchased,
  [CAPTURE_ROUTE_TOPIC]: handleCaptureRouteRegistration,
  [MAGNUS_TURN_SUBMITTED_TOPIC]: handleMagnusTurnSubmitted,
  ...Object.fromEntries(
    RECHECK_CAUSE_TOPICS.map((topic) => [topic, handleConflictsRecheckCause] as const),
  ),
  [CONFLICTS_RECHECK_REQUESTED_TOPIC]: handleConflictsRecheckRun,
  [NATURAL_LANGUAGE_INSTANCE_PROVISION_TOPIC]: handleNaturalLanguageInstanceProvision,
  [NATURAL_LANGUAGE_INSTANCE_TEARDOWN_TOPIC]: handleNaturalLanguageInstanceTeardown,
  [NATURAL_LANGUAGE_FEED_DELETION_TOPIC]: handleNaturalLanguageFeedDeletionRequest,
  // A version's export copy (every tracked change accepted): asked for directly by the save that
  // cut the version, and reached again by the relay's publication of every commit as the backstop.
  // One handler, idempotent — see ../exports/export-copy-consumer.ts.
  [EXPORT_COPY_REQUESTED_TOPIC]: handleExportCopyRequested,
  [FILE_VERSION_COMMITTED_TOPIC]: handleExportCopyRequested,
  // A member asked, on the Search and Indexing page, for the places of the record index that have
  // fallen behind their records to be rebuilt. See ../../search/record-index-rebuild.ts.
  [RECORD_INDEX_REBUILD_REQUESTED_TOPIC]: handleRecordIndexRebuildRequested,
};

// The message carries nothing to read: the rebuild counts what is behind when it runs. A failure
// propagates and the message retries, which is safe to any number of deliveries because a place
// already rebuilt counts as up to date and is left alone.
async function handleRecordIndexRebuildRequested(
  _env: Bindings,
  firmDatabase: ProxyBatchDatabase,
  _message: PerFirmQueueMessage,
  logger: Logger,
): Promise<void> {
  await rebuildRecordIndexPlacesBehind(firmDatabase, logger);
}

// The three natural-language search lifecycle topics. Each rides this bus rather than a queue of its
// own because they are rare, small messages and the shared lane already carries the relay, the
// dispatch, and the dead-letter discipline a dedicated queue would need built again.
//
// The message lands in the SAME atomic batch as the state change that caused it, which is what makes
// the gate honest: a firm whose opt-in committed has a provisioning message, and a firm whose opt-in
// rolled back has neither the open gate nor the message.
function handleNaturalLanguageInstanceProvision(
  env: Bindings,
  firmDatabase: ProxyBatchDatabase,
  message: PerFirmQueueMessage,
  logger: Logger,
): Promise<void> {
  return handleNaturalLanguageProvision(env, firmDatabase, message.firmId, logger);
}

function handleNaturalLanguageInstanceTeardown(
  env: Bindings,
  firmDatabase: ProxyBatchDatabase,
  message: PerFirmQueueMessage,
  logger: Logger,
): Promise<void> {
  return handleNaturalLanguageTeardown(env, firmDatabase, message.firmId, logger);
}

// The deletion scope is read off the message and narrowed to the three shapes the catalog read
// accepts. An unrecognized scope deletes NOTHING rather than falling back to the firm scope: a
// malformed message must not be able to widen a deletion, and a message that deletes nothing is
// visible in the catalog while a message that deleted a firm's whole feed is not undoable.
function handleNaturalLanguageFeedDeletionRequest(
  env: Bindings,
  firmDatabase: ProxyBatchDatabase,
  message: PerFirmQueueMessage,
  logger: Logger,
): Promise<void> {
  const payload = JSON.parse(message.payload) as NaturalLanguageFeedDeletionPayload;
  const scope =
    payload.scope === "matter"
      ? ({ kind: "matter", matterId: payload.matterId } as const)
      : payload.scope === "document-version"
        ? ({ kind: "document-version", fileId: payload.fileId, version: payload.version } as const)
        : payload.scope === "firm"
          ? ({ kind: "firm" } as const)
          : undefined;
  if (scope === undefined) {
    logger.count("costs.recovery.unhandled_topic", { topic: message.topic }, 1);
    return Promise.resolve();
  }
  return handleNaturalLanguageFeedDeletion(env, message.firmId, firmDatabase, scope, logger);
}

// A corpus change that could have changed an already-checked matter's answer: resolve the affected
// matters and record a ledger row for each. This handler NEVER runs a check — request and run are
// separate so a slow check cannot back-pressure the recording of causes, and the recording is what
// makes staleness visible.
//
// The message's cause instant is the OUTBOX ROW's own creation time rather than now: the interval a
// firm can point to is between the corpus change and the check that answered it, not between the
// queue getting round to it and the check.
function handleConflictsRecheckCause(
  _env: Bindings,
  firmDatabase: ProxyBatchDatabase,
  message: PerFirmQueueMessage,
  logger: Logger,
): Promise<void> {
  return consumeRecheckRequest(
    firmDatabase,
    {
      topic: message.topic,
      payload: message.payload,
      causeOccurredAt: message.causeOccurredAt ?? new Date().toISOString(),
    },
    logger,
  );
}

// The drain signal for one matter: claim every cause open against it, run ONE check that names them
// all, stamp each claimed request with that check.
function handleConflictsRecheckRun(
  env: Bindings,
  firmDatabase: ProxyBatchDatabase,
  message: PerFirmQueueMessage,
  logger: Logger,
): Promise<void> {
  return consumeRecheckRun(env, message.firmId, firmDatabase, message.payload, logger);
}

// Hands a submitted assistant turn from the per-firm outbox onto the assistant's own queue, which is
// what gives that work its own dead-letter queue and concurrency rather than sharing this bus's. The
// outbox row was written in the same atomic batch as the turn rows it names, so the message is proof
// those rows committed. The payload carries identifiers only — what the member typed stays in the
// turn row the consumer reads back through the firm-scoped data-access layer.
function handleMagnusTurnSubmitted(
  env: Bindings,
  _firmDatabase: ProxyBatchDatabase,
  message: PerFirmQueueMessage,
  _logger: Logger,
): Promise<void> {
  return forwardMagnusTurnSubmitted(env, message.firmId, message.id, message.payload);
}

// Completes an email capture-address mint by writing its control-plane routing row — the step that
// turns a minted address into one that actually receives mail. The per-firm batch that created the
// address wrote this message in the same commit, so the message is proof the address exists; a
// failure here is transient by definition (the row is durable, the retry re-applies), which is why it
// propagates rather than being acked away.
function handleCaptureRouteRegistration(
  env: Bindings,
  _firmDatabase: ProxyBatchDatabase,
  message: PerFirmQueueMessage,
  _logger: Logger,
): Promise<void> {
  return consumeCaptureRouteRegistration(
    {
      controlPlaneDatabase: env.DB_CONTROL,
      firmId: assertIdentifier(message.firmId, "firm"),
      now: () => new Date().toISOString(),
    },
    message.id,
    message.payload,
  );
}

// Posts the recovered matter disbursements for a purchased shipment. The producer adapter reads the
// matter link back from the shipment row and builds the neutral recoverable-charge event; this handler
// resolves the firm's per-category recovery policy, maps the event into cost captures, and commits each
// capture through the idempotency chokepoint.
async function handleShipmentPurchased(
  _env: Bindings,
  firmDatabase: ProxyBatchDatabase,
  message: PerFirmQueueMessage,
  logger: Logger,
): Promise<void> {
  const payload = parseShipmentPurchasedPayload(message.payload);
  if (payload === null) {
    // Unparseable or structurally invalid payload (no shipment id, no currency, a non-integer minor
    // amount) → permanently unprocessable. Retrying can never make it valid; it would only march a
    // permanent error to the dead-letter queue. Ack-drop with telemetry instead. A well-formed payload
    // that merely yields no recoverable lines (e.g. zero amounts) is NOT malformed and flows on below.
    logger.count("costs.recovery.malformed_payload", {}, 1);
    return;
  }
  const event = await buildShipmentRecoverableCharge(firmDatabase, payload);
  if (event === null) {
    // No shipment row for the id → permanently unprocessable (producer/store drift or a deleted
    // shipment). Drop with telemetry rather than retry a row that will never appear.
    logger.count("costs.recovery.shipment_missing", {}, 1);
    return;
  }

  // Pre-resolve each category's recovery policy BEFORE the pure mapping. chargeToCaptureInputs takes a
  // SYNCHRONOUS predicate, but the policy lives in the firm's setting table (an async read) — so read
  // the flag for every category present on the event, then hand the mapping a pure lookup. A
  // pass_through line ignores the policy (shouldRecover), but resolving its category anyway keeps the
  // lookup total at one row per distinct category.
  const recovered = new Map<string, boolean>();
  for (const line of event.lines) {
    if (!recovered.has(line.category)) {
      recovered.set(
        line.category,
        await readFirmSetting(firmDatabase, recoverPlatformFeeDefinition(line.category)),
      );
    }
  }
  const policy = (category: string): boolean => recovered.get(category) ?? false;

  // The calendar date (YYYY-MM-DD, the cost_entry.incurred_date convention) the recovered cost is
  // effective-dated on. Non-request code reads the wall clock — the same discipline the cron sweeps and
  // the ingest consumer use off the request path. Computed once so every line of one event shares it.
  const now = () => new Date().toISOString();
  const incurredDate = now().slice(0, 10);
  const captures = chargeToCaptureInputs(event, policy, incurredDate);

  for (const input of captures) {
    // ONE idempotent effect PER LINE, keyed on the line's recoveryRef (`${shipmentId}:${category}`).
    // A queue redelivery re-derives the identical key, so the pre-check replays the stored response and
    // posts no second row. The fingerprint is the immutable charge identity (matter + amount + currency
    // + category), deliberately EXCLUDING the wall-clock incurredDate: the per-line recoveryRef is the
    // real double-post floor, so leaving the date out lets a cross-day redelivery replay cleanly instead
    // of tripping a spurious mismatch. A genuine producer drift (same line, changed amount) instead
    // surfaces as a fingerprint-mismatch outcome, which is recorded on a counter below rather than
    // acked away unseen.
    const fingerprint = canonicalJsonStringify({
      matterId: input.matterId,
      amountMinor: input.amountMinor,
      currency: input.currency,
      recoveryCategory: input.recoveryCategory ?? null,
      recoveryRef: input.recoveryRef ?? null,
    });
    let result;
    try {
      result = await runIdempotentEffect({
        database: firmDatabase,
        key: input.recoveryRef,
        fingerprint,
        now,
        effect: async () => {
          // The cost write rides the chokepoint: captureCost composes the cost insert + its domain
          // audit statement (audit metadata stays NULL), and runIdempotentEffect commits them with the
          // per-line idempotency record in one atomic batch. actorUserId is null — a queue has no
          // request actor (the established system-actor pattern the ingest consumer uses).
          const captured = await captureCost(firmDatabase, input, {
            clock: { now },
            actorUserId: null,
          });
          return {
            write: captured.effect,
            responseCode: 201,
            responseBody: canonicalJsonStringify({ costEntryId: captured.costEntryId }),
          };
        },
      });
    } catch (caught) {
      if (caught instanceof CostValidationError) {
        // A permanently malformed line (non-positive/non-integer amount, or a non-USD currency):
        // retrying can never make it valid, so drop THIS line with telemetry and let the siblings post.
        // A non-validation error (a transient DB fault) propagates → the message retries, and any
        // already-posted sibling line is short-circuited by its idempotency key on redelivery.
        logger.count("costs.recovery.rejected", { code: caught.code }, 1);
        continue;
      }
      if (isRecoveryRefConflict(caught)) {
        // The per-line idempotency record was TTL-purged (>24h), so a redelivered already-posted line
        // slipped past the idempotency pre-check and re-attempted the insert — and the recovery_ref
        // unique index caught it. recoveryRef === key by construction, so an existing row provably
        // represents THIS exact line: this is a benign replay, not a fault. Drop it with telemetry and
        // let the siblings post — do NOT rethrow (which would retry-storm a poison pill that blocks its
        // sibling line forever) and do NOT retry.
        logger.count("costs.recovery.replayed_after_purge", {}, 1);
        continue;
      }
      throw caught;
    }

    if (result.kind === "fingerprint-mismatch") {
      // The stored line under this recoveryRef carries a DIFFERENT immutable identity — the producer
      // re-emitted the same line with a changed amount/currency/category. At-least-once delivery makes a
      // clean replay routine, but a mismatch is real producer drift, so make it observable rather than a
      // silent ack. The already-stored line stands; nothing here overwrites it, and the message is acked
      // normally (re-applying an already-posted line is not a transient fault to retry).
      logger.count(
        "costs.recovery.fingerprint_mismatch",
        { recoveryCategory: input.recoveryCategory ?? "" },
        1,
      );
    }
  }
}

// The SECOND, NON-EXCLUSIVE PASS: after the owning handler (if there is one), the message is
// offered to the notification translator, which consults the registry and materializes on a hit.
//
// Non-exclusive rather than another row in the dispatch table above, because a topic may legitimately
// have BOTH a business consumer and a notification — shipment.purchased posts costs and may also
// notify — and neither may suppress the other. Most topics on this bus have no notification type at
// all, which is the ordinary case and not an error: the translator finding nothing returns quietly,
// exactly as an unhandled topic is acked and ignored.
//
// WHAT A TRANSLATOR FAILURE DOES depends on whether anything else already committed for this
// message, because that is what decides whether a retry is free.
//
//   * An owning handler RAN → the failure is caught, counted, and logged, and the message acks.
//     Retrying would re-run that handler, and a re-driven cost posting is a double charge where a
//     missed notification is an annoyance. Where the two are not equal, the weaker one yields.
//   * NO owning handler exists for the topic (matter.closed and most of this registry) → the
//     failure PROPAGATES and the message retries. Nothing else committed, so a retry costs one
//     redelivery and buys back a notification that a transient database fault would otherwise have
//     dropped silently. It cannot duplicate anything: the translator re-derives the same dedupe key
//     and the UNIQUE constraint makes the second attempt a no-op.
//
// Only genuine faults reach either arm. The permanently-unprocessable cases — a payload that will
// not parse, a subject whose matter has since gone — return normally from the translator rather
// than throwing, precisely so they ack instead of marching to the dead-letter queue.
async function offerToNotifications(
  firmDatabase: ProxyBatchDatabase,
  message: PerFirmQueueMessage,
  logger: Logger,
  anOwningHandlerRan: boolean,
): Promise<void> {
  try {
    const result = await translateOutboxMessage({
      database: firmDatabase,
      outboxRowId: message.id,
      topic: message.topic,
      payload: message.payload,
      // Non-request code reads the wall clock — the same discipline the cron sweeps and the ingest
      // consumer use off the request path.
      now: () => new Date().toISOString(),
    });
    if (result.matchedTypes === 0) return;
    // Counters only, and only closed labels: a kind and a category are enum values from the
    // registry, where a subject id or a matter id would be a telemetry dimension whose cardinality
    // tracks firm data.
    if (result.materializedEvents > 0) {
      logger.count(
        "notifications.materialized",
        { topic: message.topic },
        result.materializedEvents,
      );
      logger.count("notifications.recipients", { topic: message.topic }, result.recipientRows);
    }
    if (result.emptyAudiences > 0) {
      // A type that matched and reached nobody. Worth a counter rather than a silent success: it is
      // either a resolver bug or an audience nobody has configured, and both are invisible without it.
      logger.count("notifications.empty_audience", { topic: message.topic }, result.emptyAudiences);
    }
    if (result.clampedRecipients > 0) {
      // A fan-out larger than a firm's staff means a resolver bug. The cap turns that into a metric
      // instead of a mail storm.
      logger.count(
        "notifications.recipients_clamped",
        { topic: message.topic },
        result.clampedRecipients,
      );
    }
    if (result.refusedFacts > 0) {
      // A producer changed the shape of what it publishes and a registered type's declaration
      // refused it. Permanent, so it acks — but silent would mean the notifications for that topic
      // simply stopped, which is the failure mode this whole bus is prone to.
      logger.count("notifications.refused_facts", { topic: message.topic }, result.refusedFacts);
    }
    // A member the audience reached who got no feed row because they silenced the category, or
    // because their firm's policy did. The one counter here that reports an ABSENCE, and the reason
    // it exists: without it a working preference and a broken fan-out look identical afterwards —
    // nothing arrived either way — and neither a member's question nor an operator's can be
    // answered. Both dimensions are closed labels and no member appears in them; the per-member
    // detail is in the firm's own tally, where that member can read it.
    for (const suppression of result.suppressedInApp) {
      logger.count(
        "notifications.suppressed_by_preference",
        { category: suppression.category, reason: suppression.reason },
        suppression.count,
      );
    }
    if (result.designatedRecipients > 0) {
      // A firm's trust-compliance designation reaching somebody. Counted because a designation that
      // quietly reaches nobody is precisely the kind of control a firm believes is working.
      logger.count(
        "notifications.designated_recipients",
        { category: "trust" },
        result.designatedRecipients,
      );
    }
  } catch (caught) {
    logOperationFailed(logger, `queue:notifications:${message.id}`, caught, newCorrelationId());
    logger.count("notifications.translate_failed", { topic: message.topic }, 1);
    if (!anOwningHandlerRan) throw caught;
  }
}

// Routes one message to its topic handler, resolving the firm database first. Unknown topics are
// acked-and-ignored (see the file header). Returns normally for every terminal outcome (handled,
// dropped, or skipped) and THROWS only on a transient fault so the queue() wrapper retries it.
async function dispatchMessage(
  env: Bindings,
  message: PerFirmQueueMessage,
  logger: Logger,
): Promise<void> {
  const handler = PER_FIRM_CONSUMERS[message.topic];
  const notificationTypes = notificationTypesForTopic(message.topic);
  if (handler === undefined && notificationTypes.length === 0) {
    logger.count("costs.recovery.unhandled_topic", { topic: message.topic }, 1);
    return;
  }

  // firmId → the firm's per-firm database. The message carries firmId (a control-plane id), NOT a
  // database handle. A row is read from the control-plane registry only to confirm the firm exists;
  // the firm's FirmDatabase Durable Object is then addressed directly by that firmId and self-migrates
  // the per-firm lineage on first access — there is no database_identifier hop. A missing firm row is
  // acked and skipped: there is no work this deployment can do and a retry cannot make the firm exist
  // (mirrors the ingest consumer's bucket→firm resolution). Uses `.all()` + results[0], never
  // `.first()` (absent from the node-sqlite test adapter).
  const { results } = await env.DB_CONTROL.prepare("SELECT id FROM firm WHERE id = ?1")
    .bind(message.firmId)
    .all<{ id: string }>();
  if (results[0] === undefined) return;
  const firmDatabase = firmDatabaseFor(env.FIRM_DATABASE, message.firmId);

  // The owning handler goes FIRST and its failure still propagates: the notification pass must
  // never run against a business effect that has not committed, and must never be the reason a
  // message is retried or acked.
  if (handler !== undefined) await handler(env, firmDatabase, message, logger);
  if (notificationTypes.length > 0) {
    await offerToNotifications(firmDatabase, message, logger, handler !== undefined);
  }
}

// The queue() handler for the shared per-firm queue. One logger per batch; a transient failure routes
// through the one telemetry pipeline (golden rule 4 — the console ban is structural) and the message
// is retried, dead-lettering at max attempts. Each message acks independently so one bad message never
// re-runs an already-committed sibling.
export async function perFirmQueue(
  batch: MessageBatch<PerFirmQueueMessage>,
  env: Bindings,
): Promise<void> {
  const logger = createWorkersLogger(env.TELEMETRY);
  for (const message of batch.messages) {
    const correlationId = newCorrelationId();
    try {
      await dispatchMessage(env, message.body, logger);
      message.ack();
    } catch (error) {
      logOperationFailed(logger, `queue:cost-recovery:${message.id}`, error, correlationId);
      message.retry();
    }
  }
}
