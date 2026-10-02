import type { SqlDatabase, SqlStatement } from "@magna-carta/data-access/idempotency-statements";
import {
  allocateCounterValueStatement,
  type SequenceNumberingTables,
} from "@magna-carta/sequence-numbering/counter-statements";
import {
  planSchemeDraw,
  schemeDrawOpeningStatements,
  type SchemeDrawPlan,
} from "@magna-carta/sequence-numbering/scheme-draw";
import type { TimeEntryId } from "@magna-carta/identifiers/types";

// The matter-scoped entry number — "2026-0147.0042" by default: the matter's own number, a dot, and
// a zero-padded per-matter sequence in capture order. What it LOOKS like is the firm's own choice,
// written on the numbering settings screen under the `time_entry` purpose and read by the shared
// draw planner; the tables and the per-matter scope are this package's.
//
// THE COUNT IS PER MATTER, AND THE MATTER IS NOT A RENDERED VALUE. The scope key is the matter's
// handle, so a matter renumbered after the fact keeps its entries' numbering dense — where a scope
// derived from the rendered matter number would restart the count under the new number and issue a
// second 0001. That is why the `time_entry` purpose is `scopeSource: "owner"` on the register: the
// domain decides the scope and the caller passes it.
//
// The number is immutable once stored and never reused: a void keeps its number, and an entry
// captured before the sequence existed stays null forever.
//
// A capture batch may take several entries on one matter (the weekly grid), so the draw is planned
// as a BLOCK per matter: one counter read, consecutive values, one guarded advance by the block
// size. The loser of a concurrent draw aborts on the allocation primary key exactly as a
// single-value draw does, and the caller's bounded retry re-reads the advanced counter.

export const TIME_ENTRY_NUMBERING_TABLES: SequenceNumberingTables = {
  counterTable: "time_entry_number_counter",
  allocationTable: "time_entry_number_allocation",
  ownerColumn: "time_entry_id",
};

/** One matter's planned block: what the drawer observed, and the rendered numbers in order. */
export type EntryNumberBlockPlan = SchemeDrawPlan;

// Reads the matter's number and the counter, and renders `count` consecutive entry numbers.
// Run INSIDE the idempotent effect (like the matter draw), so a replayed request never draws.
export async function planEntryNumberBlock(
  database: SqlDatabase,
  matterId: string,
  count: number,
  capturedOn: string,
): Promise<EntryNumberBlockPlan> {
  const { results } = await database
    .prepare("SELECT matter_number FROM matter WHERE id = ?1")
    .bind(matterId)
    .all<{ matter_number: string | null }>();
  // A matter that has not drawn a number yet (an intake, or a consultation) falls back to its own
  // identifier handle — stable forever, unambiguous, and honestly not a matter number. The rendered
  // string is minted at capture and never re-rendered, so a later matter renumber leaves existing
  // entry numbers exactly as they were issued.
  const matterNumber = results[0]?.matter_number ?? matterId;
  return planSchemeDraw(
    database,
    "time_entry",
    TIME_ENTRY_NUMBERING_TABLES,
    { openedDate: capturedOn, matterNumber },
    { scopeKey: matterId, count },
  );
}

// The statements that open a block's draw: ensure the counter row exists, then advance it by the
// block size, guarded on the observed value. The guard aborts nothing on its own (a zero-row
// UPDATE is not an error) — the allocation primary key below is the load-bearing backstop.
export function entryNumberBlockOpenStatements(
  database: SqlDatabase,
  plan: EntryNumberBlockPlan,
): SqlStatement[] {
  return schemeDrawOpeningStatements(database, TIME_ENTRY_NUMBERING_TABLES, plan);
}

// Claims the value at `index` within the block for one inserted entry. Composed AFTER the entry's
// own INSERT in the batch — time_entry_id is a foreign key. A concurrent draw that consumed the
// same value aborts this whole batch here, which is what makes the draw safe.
export function entryNumberAllocationStatement(
  database: SqlDatabase,
  plan: EntryNumberBlockPlan,
  index: number,
  timeEntryId: TimeEntryId,
  allocatedAt: string,
): SqlStatement {
  return allocateCounterValueStatement(
    database,
    TIME_ENTRY_NUMBERING_TABLES,
    plan.scopeKey,
    plan.observedValue + index,
    timeEntryId,
    allocatedAt,
  );
}

// The rendered-string collision the counter cannot see: the partial UNIQUE index on
// time_entry.entry_number. Registered as the caller's `alsoRetryable`, mirroring the matter
// number's arrangement.
export function isEntryNumberConflict(error: unknown): boolean {
  return (
    error instanceof Error &&
    error.message.includes("UNIQUE constraint failed") &&
    error.message.includes("time_entry.entry_number")
  );
}
