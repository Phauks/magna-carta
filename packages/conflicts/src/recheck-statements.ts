import type { SqlDatabase, SqlStatement } from "@magna-carta/data-access/idempotency-statements";
import type { ConflictsCheckId, ConflictsRecheckRequestId } from "@magna-carta/identifiers/types";

// Table name tracked against @magna-carta/database's per-firm schema by the schema-name-sync fitness
// test. The ledger is not append-only in the way the three log tables are — satisfaction has to be
// recordable — but it is close: nothing deletes a row (a trigger refuses it), the cause columns are
// immutable (a second trigger refuses that), and satisfaction moves once, forwards (a third). So the
// only mutating builder in this file is the one that stamps a satisfaction, and it is guarded on the
// row still being open.
export const CONFLICTS_RECHECK_REQUEST_TABLE = "conflicts_recheck_request";

export interface InsertRecheckRequestRow {
  readonly id: ConflictsRecheckRequestId;
  readonly matterId: string;
  readonly causeTopic: string;
  // A handle — an entity, an edge, an identifier row, a matter party. Never a value.
  readonly causeReference: string;
  readonly causeOccurredAt: string;
  readonly requestedAt: string;
}

// ON CONFLICT DO NOTHING against the partial unique index over open rows: a redelivered queue message
// re-derives the identical (matter, topic, reference) triple and lands here as a genuine no-op rather
// than as an error the consumer would have to classify. The same cause recurring AFTER the earlier
// request was satisfied is a different matter entirely — the satisfied row has left the partial
// index, so the new request is recorded, which is exactly the behaviour a recurring cause needs.
export function insertRecheckRequestStatement(
  database: SqlDatabase,
  row: InsertRecheckRequestRow,
): SqlStatement {
  return database
    .prepare(
      `INSERT INTO ${CONFLICTS_RECHECK_REQUEST_TABLE} (id, matter_id, cause_topic, cause_reference, cause_occurred_at, requested_at, satisfied_by_check_id, satisfied_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, NULL, NULL) ON CONFLICT DO NOTHING`,
    )
    .bind(
      row.id,
      row.matterId,
      row.causeTopic,
      row.causeReference,
      row.causeOccurredAt,
      row.requestedAt,
    );
}

// Stamps the check that answered a request. Guarded on `satisfied_at IS NULL` so a redelivery, or a
// cron drain racing the queue over the same matter, cannot re-point an already-answered request at a
// later check and lose the interval the row exists to record.
// fitness:unguarded-write — a repeat is meant to be a no-op — zero rows means the state it moves to was already reached
export function markRecheckRequestSatisfiedStatement(
  database: SqlDatabase,
  row: {
    readonly id: ConflictsRecheckRequestId;
    readonly checkId: ConflictsCheckId;
    readonly satisfiedAt: string;
  },
): SqlStatement {
  return database
    .prepare(
      `UPDATE ${CONFLICTS_RECHECK_REQUEST_TABLE} SET satisfied_by_check_id = ?2, satisfied_at = ?3 WHERE id = ?1 AND satisfied_at IS NULL`,
    )
    .bind(row.id, row.checkId, row.satisfiedAt);
}

export interface OpenRecheckRequestRow {
  readonly id: ConflictsRecheckRequestId;
  readonly matterId: string;
  readonly causeTopic: string;
  readonly causeReference: string;
  readonly causeOccurredAt: string;
  readonly requestedAt: string;
}

interface RawRecheckRow {
  readonly id: string;
  readonly matter_id: string;
  readonly cause_topic: string;
  readonly cause_reference: string;
  readonly cause_occurred_at: string;
  readonly requested_at: string;
}

function toOpenRequest(row: RawRecheckRow): OpenRecheckRequestRow {
  return {
    id: row.id as ConflictsRecheckRequestId,
    matterId: row.matter_id,
    causeTopic: row.cause_topic,
    causeReference: row.cause_reference,
    causeOccurredAt: row.cause_occurred_at,
    requestedAt: row.requested_at,
  };
}

// Every open request for one matter, oldest cause first — the set one coalesced check covers. Walks
// (matter_id, satisfied_at). Bounded by `limit` so a matter that has accumulated an implausible
// number of causes cannot make one drain invocation unbounded; the remainder stays open and visible
// rather than being dropped, and the next pass takes it.
export async function readOpenRecheckRequestsForMatter(
  database: SqlDatabase,
  matterId: string,
  limit: number,
): Promise<OpenRecheckRequestRow[]> {
  const { results } = await database
    .prepare(
      `SELECT id, matter_id, cause_topic, cause_reference, cause_occurred_at, requested_at
         FROM ${CONFLICTS_RECHECK_REQUEST_TABLE}
        WHERE matter_id = ?1 AND satisfied_at IS NULL
        ORDER BY cause_occurred_at ASC, rowid ASC
        LIMIT ?2`,
    )
    .bind(matterId, limit)
    .all<RawRecheckRow>();
  return results.map(toOpenRequest);
}

// The pending re-checks the posture read reports for a matter — the same open set, capped at a page
// so a matter with a large backlog still reads. `pendingRecheck` is a statement that something is
// owed, not a work queue, so a bounded list is the right shape for it.
export async function readPendingRecheckRequests(
  database: SqlDatabase,
  matterId: string,
  limit: number,
): Promise<OpenRecheckRequestRow[]> {
  return readOpenRecheckRequestsForMatter(database, matterId, limit);
}

// The matters with the oldest unsatisfied causes, for the cron drain. One row per matter (the drain
// coalesces per matter anyway), oldest cause first, so falling behind is worked off in the order the
// firm's corpus actually moved. Walks (satisfied_at, requested_at).
export async function readMattersAwaitingRecheck(
  database: SqlDatabase,
  limit: number,
): Promise<string[]> {
  const { results } = await database
    .prepare(
      `SELECT matter_id, MIN(requested_at) AS oldest_requested_at
         FROM ${CONFLICTS_RECHECK_REQUEST_TABLE}
        WHERE satisfied_at IS NULL
        GROUP BY matter_id
        ORDER BY oldest_requested_at ASC
        LIMIT ?1`,
    )
    .bind(limit)
    .all<{ matter_id: string; oldest_requested_at: string }>();
  return results.map((row) => row.matter_id);
}

// How many requests are still open across the firm. A counter for the drain-lag signal: the RATE is
// what says whether the firm is falling behind, and a per-row detail has no place in a metric.
export async function countOpenRecheckRequests(database: SqlDatabase): Promise<number> {
  const { results } = await database
    .prepare(
      `SELECT COUNT(*) AS open_count FROM ${CONFLICTS_RECHECK_REQUEST_TABLE} WHERE satisfied_at IS NULL`,
    )
    .all<{ open_count: number }>();
  return results[0]?.open_count ?? 0;
}
