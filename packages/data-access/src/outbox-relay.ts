import type { BatchDatabase } from "./effect-batch.ts";
import { OUTBOX_TABLE } from "./outbox-statements.ts";

// A pending row as the relay reads it. Consumers dedup on `id` (Queues are at-least-once) and apply
// ordered topics by (aggregate_key, seq) — skip-stale / last-write-wins (ADR-0064).
export interface OutboxRow {
  readonly id: string;
  readonly topic: string;
  readonly payload: string; // canonical JSON as stored
  readonly aggregate_key: string | null;
  readonly seq: number | null;
  readonly attempts: number;
}

export interface OutboxSweepReport {
  readonly dispatched: number;
  readonly failed: number;
  readonly deadLettered: number;
}

// The relay floor (ADR-0064): sweep pending rows and publish them. Ordering is PUBLISH FIRST, then
// mark dispatched — a crash between the two republishes next sweep (at-least-once, consumers dedup).
// Marking first would risk losing the effect entirely (at-most-once), never acceptable here.
// A publish failure increments attempts; reaching maxAttempts marks the row failed and hands it to
// the dead-letter callback (surfaced to observability, ADR-0038). Failures are per-row isolated.
//
// Sweeps may OVERLAP (a slow run meeting the next Cron fire), so every status transition is guarded
// with `AND status = 'pending'` and branches on meta.changes: a row another sweep already claimed is
// never re-marked (a failed row can never flip back to dispatched — that would silently lose it)
// and the dead-letter callback fires at most once per row. Duplicate PUBLISHES under overlap remain
// possible — that is the at-least-once contract consumers already dedup against.
export async function sweepOutbox(options: {
  database: BatchDatabase;
  publish: (row: OutboxRow) => Promise<void>;
  deadLetter?: (row: OutboxRow, error: Error) => Promise<void>;
  maxAttempts?: number;
  batchSize?: number;
  now?: () => string;
}): Promise<OutboxSweepReport> {
  const maxAttempts = options.maxAttempts ?? 5;
  const batchSize = options.batchSize ?? 100;
  const now = options.now ?? (() => new Date().toISOString());

  const { results } = await options.database
    .prepare(
      `SELECT id, topic, payload, aggregate_key, seq, attempts FROM ${OUTBOX_TABLE} WHERE status = 'pending' ORDER BY created_at LIMIT ?1`,
    )
    .bind(batchSize)
    .all<OutboxRow>();

  let dispatched = 0;
  let failed = 0;
  let deadLettered = 0;
  for (const row of results) {
    try {
      await options.publish(row);
      const marked = await options.database
        .prepare(
          `UPDATE ${OUTBOX_TABLE} SET status = 'dispatched', dispatched_at = ?1 WHERE id = ?2 AND status = 'pending'`,
        )
        .bind(now(), row.id)
        .run();
      if (marked.meta.changes > 0) dispatched++; // zero changes = a concurrent sweep claimed it first
    } catch (caught) {
      failed++;
      const error = caught instanceof Error ? caught : new Error(String(caught));
      const attemptsAfterThis = row.attempts + 1;
      if (attemptsAfterThis >= maxAttempts) {
        const marked = await options.database
          .prepare(
            `UPDATE ${OUTBOX_TABLE} SET status = 'failed', attempts = attempts + 1 WHERE id = ?1 AND status = 'pending'`,
          )
          .bind(row.id)
          .run();
        if (marked.meta.changes > 0) {
          if (options.deadLetter) await options.deadLetter(row, error);
          deadLettered++;
        }
      } else {
        await options.database
          .prepare(
            `UPDATE ${OUTBOX_TABLE} SET attempts = attempts + 1 WHERE id = ?1 AND status = 'pending'`,
          )
          .bind(row.id)
          .run();
      }
    }
  }
  return { dispatched, failed, deadLettered };
}
