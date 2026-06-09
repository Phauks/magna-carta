import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import type { IdempotencyRecordId, OutboxId } from "@magna-carta/identifiers/types";

// PER-FIRM LINEAGE. Every tenant firm's D1 carries these tables; drizzle-kit generates per-firm
// migrations from this file (ADR-0065). The BEHAVIOR over these tables (middleware, relay) lives in
// @magna-carta/data-access — this package only defines the structure.

// Idempotency records (ADR-0063). The UNIQUE(key) insert inside the effect's transaction IS the
// concurrency guard — exactly-once with no separate lock.
export const idempotencyKey = sqliteTable(
  "idempotency_key",
  {
    id: text("id").primaryKey().$type<IdempotencyRecordId>(), // idr_ handle (server record id)
    key: text("key").notNull(), // client-supplied Idempotency-Key
    fingerprint: text("fingerprint").notNull(), // hash(method + path + canonical body)
    status: text("status", { enum: ["in_progress", "completed"] }).notNull(),
    responseCode: integer("response_code"), // captured on completion
    responseBody: text("response_body"), // captured on completion, redacted per ADR-0038
    createdAt: text("created_at").notNull(), // ISO-8601 instant (ADR-0055); TTL purge keys off this
  },
  (table) => [
    uniqueIndex("idempotency_key_key_unique_index").on(table.key),
    index("idempotency_key_created_at_index").on(table.createdAt),
  ],
);

// Transactional outbox (ADR-0064): the effect row commits in the SAME D1 transaction as the business
// change; the relay sweeps pending rows to Queues.
export const outbox = sqliteTable(
  "outbox",
  {
    id: text("id").primaryKey().$type<OutboxId>(), // obx_ handle
    topic: text("topic").notNull(), // e.g. 'payment.capture', 'comms.send'
    payload: text("payload").notNull(), // JSON: ids + non-privileged fields ONLY (ADR-0038)
    aggregateKey: text("aggregate_key"), // ordering scope for ordered topics
    seq: integer("seq"), // monotonic within aggregate_key
    status: text("status", { enum: ["pending", "dispatched", "failed"] }).notNull(),
    attempts: integer("attempts").notNull().default(0),
    createdAt: text("created_at").notNull(),
    dispatchedAt: text("dispatched_at"),
  },
  (table) => [index("outbox_status_created_at_index").on(table.status, table.createdAt)],
);
