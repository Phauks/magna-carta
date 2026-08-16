import type { BatchDatabase } from "@magna-carta/data-access/effect-batch";
import type { DirectoryNameId } from "@magna-carta/identifiers/types";
import { backfillNameMatchKeysStatement } from "./statements.ts";

// Filling the match keys for names that predate them.
//
// New names get their keys in the batch that inserts them. The corpus a firm already holds does not,
// and until it does, every one of those names is invisible to the two match-key blocking channels —
// while a conflicts check reports them as channels that ran. That is the platform saying it looked
// somewhere it did not look, so the sweep exists, and two properties matter more than its speed:
//
//   RESUMABLE. It never walks the whole table. Each pass claims a bounded slice of the rows that are
//   still missing a key, writes them, and returns; the next pass finds a smaller set because the
//   selection predicate IS the outstanding work rather than a cursor somebody has to store correctly.
//   A pass that dies halfway leaves the rows it committed done and the rest still selected.
//
//   IDEMPOTENT UNDER OVERLAP. The update is guarded on the column still being null, so a sweep racing
//   a live write on the same name — the one way the two can meet — settles rather than conflicting.
//
// It reads before it writes and commits one atomic batch per pass, because D1 has no interactive
// transactions.

// How many name rows one pass derives. Sized so a pass stays well inside a scheduled invocation's
// budget on a firm with a large Directory; the derivation itself is string work over one column.
export const DEFAULT_BACKFILL_BATCH_SIZE = 500;

export interface NameIndexBackfillResult {
  // Rows whose match keys this pass filled.
  readonly matchKeysFilled: number;
  // True when this pass hit its budget, so more rows are still outstanding and the next pass has work.
  readonly moreRemaining: boolean;
}

interface PendingNameRow {
  readonly id: string;
  readonly normalized_display: string;
}

export async function runNameIndexBackfillPass(
  database: BatchDatabase,
  options: { readonly batchSize?: number } = {},
): Promise<NameIndexBackfillResult> {
  const batchSize = Math.max(1, Math.trunc(options.batchSize ?? DEFAULT_BACKFILL_BATCH_SIZE));

  // The ordering is explicit: the sweep must claim the same slice for the same corpus every time, and
  // a LIMIT without an ORDER BY leaves that to the query planner.
  const { results } = await database
    .prepare(
      `SELECT id, normalized_display
         FROM directory_name
        WHERE deleted_at IS NULL
          AND (normalized_match_key IS NULL OR normalized_match_key_bare IS NULL)
        ORDER BY id ASC
        LIMIT ?1`,
    )
    .bind(batchSize)
    .all<PendingNameRow>();

  if (results.length === 0) return { matchKeysFilled: 0, moreRemaining: false };

  await database.batch(
    results.map((row) =>
      backfillNameMatchKeysStatement(database, row.id as DirectoryNameId, row.normalized_display),
    ),
  );

  return {
    matchKeysFilled: results.length,
    // The slice came back full, so the predicate almost certainly still selects rows. Reporting it
    // rather than looping here is what keeps the pass bounded: falling behind is a visible fact for
    // the caller's telemetry, never a pass that runs until it is killed.
    moreRemaining: results.length === batchSize,
  };
}

// How much work the sweep still has, without doing any of it.
export async function countNamesAwaitingIndexBackfill(database: BatchDatabase): Promise<number> {
  const { results } = await database
    .prepare(
      `SELECT COUNT(*) AS pending FROM directory_name
        WHERE deleted_at IS NULL
          AND (normalized_match_key IS NULL OR normalized_match_key_bare IS NULL)`,
    )
    .all<{ pending: number }>();
  return results[0]?.pending ?? 0;
}
