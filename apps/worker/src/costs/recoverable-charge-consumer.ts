import { canonicalJsonStringify } from "@magna-carta/data-access/canonical";
import { runIdempotentEffect } from "@magna-carta/data-access/run-idempotent-effect";
import { readFirmSetting } from "@magna-carta/data-access/setting-statements";
import { captureCost } from "@magna-carta/costs/cost-entry-service";
import { CostValidationError } from "@magna-carta/costs/cost-validation";
import { chargeToCaptureInputs } from "@magna-carta/costs/recoverable-charge";
import { recoverPlatformFeeDefinition } from "@magna-carta/costs/recovery-policy";
import { newCorrelationId } from "@magna-carta/telemetry/ids";
import type { Logger } from "@magna-carta/telemetry/logger";
import { logOperationFailed } from "@magna-carta/telemetry/operation";
import { createWorkersLogger } from "@magna-carta/telemetry/workers-logger";
import type { Bindings } from "../app.ts";
import { resolveFirmDatabase } from "../firm-binding-resolver.ts";
import {
  buildShipmentRecoverableCharge,
  parseShipmentPurchasedPayload,
} from "./shipping-cost-recovery.ts";

// The first per-firm queue consumer: it posts matter disbursements for the financial core off the
// shared per-firm queue. Every active firm's outbox rows cross the SINGLE bound env.QUEUE, so the
// relay tags each message with the originating firmId — the consumer has no other handle on which
// physical database a row came from, and resolves the firm database from the message.
//
// The dispatch table mirrors the control-plane CONSUMERS map (scheduled.ts), with ONE deliberate
// difference: the control-plane sweep THROWS on an unregistered topic because it owns its whole
// closed topic set; this per-firm bus is OPEN. The relay sweeps EVERY per-firm outbox topic onto this
// one queue (shipment.created and shipment.refunded ride alongside shipment.purchased, and future
// slices add more), but this consumer only owns cost recovery for shipment.purchased. So an unknown
// topic is ACKED AND IGNORED, never thrown — throwing would dead-letter or retry-storm a message we
// simply do not handle. A counter makes the drop observable rather than silent.
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

// A per-topic handler: the firm database is already resolved (the dispatcher does the two-hop), and
// the handler reads what it needs from the message payload.
type PerFirmTopicHandler = (
  firmDatabase: D1Database,
  message: PerFirmQueueMessage,
  logger: Logger,
) => Promise<void>;

// Topic → handler. Mirrors CONTROL_PLANE_CONSUMERS; add a row to own a new per-firm topic.
const PER_FIRM_CONSUMERS: Readonly<Record<string, PerFirmTopicHandler>> = {
  "shipment.purchased": handleShipmentPurchased,
};

// Posts the recovered matter disbursements for a purchased shipment. The producer adapter reads the
// matter link back from the shipment row and builds the neutral recoverable-charge event; this handler
// resolves the firm's per-category recovery policy, maps the event into cost captures, and commits each
// capture through the idempotency chokepoint.
async function handleShipmentPurchased(
  firmDatabase: D1Database,
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

// Routes one message to its topic handler, resolving the firm database first. Unknown topics are
// acked-and-ignored (see the file header). Returns normally for every terminal outcome (handled,
// dropped, or skipped) and THROWS only on a transient fault so the queue() wrapper retries it.
async function dispatchMessage(
  env: Bindings,
  message: PerFirmQueueMessage,
  logger: Logger,
): Promise<void> {
  const handler = PER_FIRM_CONSUMERS[message.topic];
  if (handler === undefined) {
    logger.count("costs.recovery.unhandled_topic", { topic: message.topic }, 1);
    return;
  }

  // Two-hop firm resolution: the message carries firmId (a control-plane id), NOT a database handle.
  // 1. firmId → the firm's database_identifier in the control-plane registry; 2. that identifier → the
  // bound D1 database. A missing firm row, a null identifier, or an unreachable binding is acked and
  // skipped — there is no work this deployment can do and a retry cannot make the binding exist
  // (mirrors the ingest consumer's bucket→firm resolution). Uses `.all()` + results[0], never
  // `.first()` (absent from the node-sqlite test adapter).
  const { results } = await env.DB_CONTROL.prepare(
    "SELECT database_identifier FROM firm WHERE id = ?1",
  )
    .bind(message.firmId)
    .all<{ database_identifier: string | null }>();
  const databaseIdentifier = results[0]?.database_identifier ?? null;
  if (databaseIdentifier === null) return;
  const firmDatabase = resolveFirmDatabase(env, databaseIdentifier);
  if (firmDatabase === null) return;

  await handler(firmDatabase, message, logger);
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
