import {
  AUDIT_LOG_TABLE,
  insertAuditLogStatement,
} from "@magna-carta/data-access/audit-statements";
import type { EffectWrite } from "@magna-carta/data-access/effect-batch";
import type { SqlDatabase, SqlStatement } from "@magna-carta/data-access/idempotency-statements";
import { newIdentifier } from "@magna-carta/identifiers/generate";
import type { UserId } from "@magna-carta/identifiers/types";
import { RECORD_INDEX_REBUILD_REQUESTED_TOPIC } from "./record-index-topics.ts";

// A rebuild of the record index, as the two facts a firm's audit log keeps about one: that a member
// asked for it, and that it ran and which places it took.
//
// The index is a copy, so a rebuild loses nothing: it empties a place's index rows and derives them
// again from the records. What is recorded is therefore not a change to anything a firm holds but
// the answer to two questions a person asks afterwards: who asked for this, and did it happen.
//
// THE TWO ROWS ARE ALSO HOW A SCREEN KNOWS ONE IS OUTSTANDING. A request newer than the last
// completed rebuild is a rebuild still to run. That is read from the log, where each row was written
// in the same batch as the thing it describes, and not from a flag something would have to remember
// to clear.

export const RECORD_INDEX_REBUILD_REQUESTED_EVENT = "firm.record_index_rebuild_requested";
export const RECORD_INDEX_REBUILT_EVENT = "firm.record_index_rebuilt";

// What a request for a rebuild writes: its audit row and the message that carries the work to the
// queue, for the caller to commit in one batch.
export function recordIndexRebuildRequestedEffect(
  database: SqlDatabase,
  input: { readonly actorUserId: UserId; readonly now: string },
): EffectWrite {
  return {
    statements: [
      insertAuditLogStatement(database, {
        id: newIdentifier("auditLog"),
        event: RECORD_INDEX_REBUILD_REQUESTED_EVENT,
        actorUserId: input.actorUserId,
        subjectId: null,
        metadata: null,
        now: input.now,
      }),
    ],
    outboxMessages: [{ topic: RECORD_INDEX_REBUILD_REQUESTED_TOPIC, payload: {} }],
  };
}

// The row a completed rebuild leaves: the keys of the places it rebuilt, which is an empty list when
// nothing was behind by the time it ran. Written by the queue's consumer, so it has no actor.
export function recordIndexRebuiltAuditStatement(
  database: SqlDatabase,
  input: { readonly places: readonly string[]; readonly now: string },
): SqlStatement {
  return insertAuditLogStatement(database, {
    id: newIdentifier("auditLog"),
    event: RECORD_INDEX_REBUILT_EVENT,
    actorUserId: null,
    subjectId: null,
    // Source keys only: closed labels from the declarations, never anything a record holds.
    metadata: { places: [...input.places] },
    now: input.now,
  });
}

export interface RecordIndexRebuildStanding {
  // When a member last asked for a rebuild, or null where nobody has.
  readonly requestedAt: string | null;
  // When a rebuild last ran to its end, or null where none has.
  readonly finishedAt: string | null;
}

// When a rebuild was last asked for and when one last finished. Two lookups on the audit log's
// event index, so it is cheap beside the counts it is read with.
export async function readRecordIndexRebuildStanding(
  database: SqlDatabase,
): Promise<RecordIndexRebuildStanding> {
  const { results } = await database
    .prepare(
      `SELECT (SELECT MAX(created_at) FROM ${AUDIT_LOG_TABLE} WHERE event = ?1) AS requested_at, ` +
        `(SELECT MAX(created_at) FROM ${AUDIT_LOG_TABLE} WHERE event = ?2) AS finished_at`,
    )
    .bind(RECORD_INDEX_REBUILD_REQUESTED_EVENT, RECORD_INDEX_REBUILT_EVENT)
    .all<{ requested_at: string | null; finished_at: string | null }>();
  return {
    requestedAt: results[0]?.requested_at ?? null,
    finishedAt: results[0]?.finished_at ?? null,
  };
}

// Whether a rebuild that was asked for has yet to finish: there is a request, and no rebuild has
// completed at or after it.
//
// A rebuild that started before the request and finished after it counts as answering it. That is
// right: it counted what was behind when it ran, and a place that fell behind in between is shown
// as behind by the same screen, with the button to ask again.
export function recordIndexRebuildIsOutstanding(standing: RecordIndexRebuildStanding): boolean {
  if (standing.requestedAt === null) return false;
  return standing.finishedAt === null || standing.finishedAt < standing.requestedAt;
}
