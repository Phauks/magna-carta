import { newIdentifier } from "@magna-carta/identifiers/generate";
import { canonicalJsonStringify } from "./canonical.ts";
import type { SqlDatabase, SqlStatement } from "./idempotency-statements.ts";

// Table name tracked against @magna-carta/database's schema by the schema-name-sync fitness test.
export const OUTBOX_TABLE = "outbox";

export interface OutboxMessage {
  readonly topic: string; // e.g. 'payment.capture', 'comms.send'
  readonly payload: unknown; // ids + non-privileged fields ONLY (ADR-0038); stored as canonical JSON
  readonly aggregateKey?: string; // ordering scope; consumers apply by (aggregateKey, seq)
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
