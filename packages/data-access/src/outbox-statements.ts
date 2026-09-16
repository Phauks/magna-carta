import { newIdentifier } from "@magna-carta/identifiers/generate";
import { canonicalJsonStringify } from "./canonical.ts";
import type { SqlDatabase, SqlStatement } from "./idempotency-statements.ts";

// Table name tracked against @magna-carta/database's schema by the schema-name-sync fitness test.
export const OUTBOX_TABLE = "outbox";

export interface OutboxMessage {
  readonly topic: string; // e.g. 'payment.capture', 'comms.send'
  readonly payload: unknown; // ids + non-privileged fields ONLY; stored as canonical JSON
  readonly aggregateKey?: string; // ordering scope; consumers apply by (aggregateKey, seq)
}

// Revive a dead-lettered row (the operator-intervention seam — sweepOutbox marks status='failed'
// TERMINAL by design, so nothing re-queues a stranded message on its own). Resets status to
// 'pending' and attempts to 0 so the next sweep re-dispatches it. Guarded on `status = 'failed'`:
// it only ever revives a genuinely dead-lettered row, never disturbs a pending/dispatched one
// (meta.changes is 0 when the id isn't a failed row). The documented manual seam until an admin
// surface exists (security.md).
// fitness:unguarded-write — the caller runs this on its own and branches on the affected-row count, so a refusal is already surfaced there
export function requeueDeadLetteredMessageStatement(
  database: SqlDatabase,
  options: { id: string },
): SqlStatement {
  return database
    .prepare(
      `UPDATE ${OUTBOX_TABLE} SET status = 'pending', attempts = 0 WHERE id = ?1 AND status = 'failed'`,
    )
    .bind(options.id);
}

// seq is computed INSIDE the insert: batch statements cannot share JS-side results, but a subselect
// over the same aggregate runs sequentially within the batch's transaction, so multi-message effects
// get consecutive seq values. Messages without an aggregate key are unordered (NULL seq).
export function insertOutboxMessageStatement(
  database: SqlDatabase,
  message: OutboxMessage,
  createdAt: string,
): SqlStatement {
  return database
    .prepare(
      `INSERT INTO ${OUTBOX_TABLE} (id, topic, payload, aggregate_key, seq, status, attempts, created_at) VALUES (?1, ?2, ?3, ?4, CASE WHEN ?4 IS NULL THEN NULL ELSE (SELECT COALESCE(MAX(seq), -1) + 1 FROM ${OUTBOX_TABLE} WHERE aggregate_key = ?4) END, 'pending', 0, ?5)`,
    )
    .bind(
      newIdentifier("outbox"),
      message.topic,
      canonicalJsonStringify(message.payload),
      message.aggregateKey ?? null,
      createdAt,
    );
}
