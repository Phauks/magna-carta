import type { BatchDatabase } from "./effect-batch.ts";
import { OUTBOX_TABLE } from "./outbox-statements.ts";

// A pending row as the relay reads it. Consumers dedup on `id` (Queues are at-least-once) and apply
// ordered topics by (aggregate_key, seq) — skip-stale / last-write-wins.
export interface OutboxRow {
  readonly id: string;
  readonly topic: string;
  readonly payload: string; // canonical JSON as stored
  readonly aggregate_key: string | null;
  readonly seq: number | null;
  readonly attempts: number;
  // When the row was written — which is when the business write it describes COMMITTED, because the
  // two land in one atomic batch. A consumer that needs to know when something actually happened
  // reads this rather than its own clock: the gap between them is queue latency, and reporting queue
  // latency as the moment a firm's records changed would make every interval the platform quotes a
  // measurement of itself.
  readonly created_at: string;
}

export interface OutboxSweepReport {
  readonly dispatched: number;
  readonly failed: number;
  readonly deadLettered: number;
}

// The relay floor: sweep pending rows and publish them. Ordering is PUBLISH FIRST, then
// mark dispatched — a crash between the two republishes next sweep (at-least-once, consumers dedup).
// Marking first would risk losing the effect entirely (at-most-once), never acceptable here.
// A publish failure increments attempts; reaching maxAttempts marks the row failed and hands it to
// the dead-letter callback (surfaced to observability). Failures are per-row isolated.
// status='failed' is TERMINAL — the relay never re-dispatches a dead-lettered row on its own. The
// recovery seam is requeueDeadLetteredMessageStatement (outbox-statements.ts): an operator flips a
// failed row back to pending and the next sweep retries it (the documented manual intervention
// until an admin surface exists — security.md).
//
// Sweeps may OVERLAP (a slow run meeting the next Cron fire), so every status transition is guarded
// with `AND status = 'pending'` and branches on meta.changes: a row another sweep already claimed is
// never re-marked (a failed row can never flip back to dispatched — that would silently lose it)
// and the dead-letter callback fires at most once per row. Duplicate PUBLISHES under overlap remain
// possible — that is the at-least-once contract consumers already dedup against.
//
// A CONSUMER CAN WRITE THE NEXT ROW INTO THE TABLE THIS PASS IS SWEEPING, and that is the reason for
// `maxRounds`. The pending set is read ONCE, up front, so a row committed by a consumer running
// inside the pass is not in it: the pass finishes, the chain stops one link short, and the rest of
// it waits for the next fire — five minutes of a person watching a screen that says their workspace
// is nearly ready. Founding a firm is exactly that chain (a firm becomes active, which queues the
// member record every permission resolves through), and the wait it produced is what this option
// exists to end. Re-reading is safe by the same contract the rest of this relay rests on: every
// status transition is guarded and every consumer dedups, so a round is indistinguishable from the
// overlapping sweeps that already happen. It costs one extra SELECT per pass that dispatched
// anything, and nothing at all on an idle one.
export async function sweepOutbox(options: {
  database: BatchDatabase;
  publish: (row: OutboxRow) => Promise<void>;
  deadLetter?: (row: OutboxRow, error: Error) => Promise<void>;
  maxAttempts?: number;
  batchSize?: number;
  /**
   * How many times one pass re-reads the pending set. The default of 1 is a single batch, which is
   * what a relay whose consumers publish ELSEWHERE wants. Raise it where a consumer commits its own
   * rows back into THIS table — see the cascade note above — and the pass will finish the chain
   * instead of leaving its tail for the next fire. A round that filled `batchSize` also continues,
   * so raising this drains a backlog further in one pass; that is why it is a bound rather than a
   * flag, and why the sweeps that cannot cascade keep the default.
   */
  maxRounds?: number;
  now?: () => string;
}): Promise<OutboxSweepReport> {
  const maxAttempts = options.maxAttempts ?? 5;
  const batchSize = options.batchSize ?? 100;
  const maxRounds = options.maxRounds ?? 1;
  const now = options.now ?? (() => new Date().toISOString());

  let dispatched = 0;
  let failed = 0;
  let deadLettered = 0;
  // Every row this pass has already published to, whatever came of it. A row whose publish FAILED
  // stays pending and sorts oldest-first, so the next round would read it straight back — and
  // retrying it here, seconds later, would spend its attempts against a fault that has had no time
  // to clear and dead-letter work that the next cron fire would have carried. A round therefore
  // takes only rows this pass has not touched, and a round with none of those is the end of the
  // cascade and stops the pass.
  const attempted = new Set<string>();

  for (let round = 0; round < maxRounds; round++) {
    const { results } = await options.database
      .prepare(
        `SELECT id, topic, payload, aggregate_key, seq, attempts, created_at FROM ${OUTBOX_TABLE} WHERE status = 'pending' ORDER BY created_at LIMIT ?1`,
      )
      .bind(batchSize)
      .all<OutboxRow>();
    const unattempted = results.filter((row) => !attempted.has(row.id));
    if (unattempted.length === 0) break;

    for (const row of unattempted) {
      attempted.add(row.id);
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
  }
  return { dispatched, failed, deadLettered };
}
