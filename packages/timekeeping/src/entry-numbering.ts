import type { SqlDatabase, SqlStatement } from "@magna-carta/data-access/idempotency-statements";
import {
  allocateCounterValueStatement,
  ensureCounterRowStatement,
  readCounterValue,
  type SequenceNumberingTables,
} from "@magna-carta/sequence-numbering/counter-statements";
import type { TimeEntryId } from "@magna-carta/identifiers/types";

// The matter-scoped entry number: the matter's own number, a dot, and a zero-padded per-matter
// sequence in capture order — "2026-0147.0042". Drawn through the shared sequence-numbering
// mechanism (counter row + allocation primary key), one counter per matter (scope_key = matter id).
// The number is immutable once stored and never reused: a void keeps its number, and an entry
// captured before the sequence existed stays null forever.
//
// A capture batch may take several entries on one matter (the weekly grid), so the draw is planned
// as a BLOCK per matter: one counter read, consecutive values, one guarded increment by the block
// size. The loser of a concurrent draw aborts on the allocation primary key exactly as a
// single-value draw does, and the caller's bounded retry re-reads the advanced counter.

export const TIME_ENTRY_NUMBERING_TABLES: SequenceNumberingTables = {
  counterTable: "time_entry_number_counter",
  allocationTable: "time_entry_number_allocation",
  ownerColumn: "time_entry_id",
};

export const ENTRY_NUMBER_START_VALUE = 1;

// Four digits covers a decade of ordinary matters; a matter past 9999 entries simply grows a fifth
// digit rather than wrapping or refusing.
const ENTRY_NUMBER_PAD_WIDTH = 4;

// Renders one entry number. The prefix is the matter's assigned number; a matter that has not
// drawn one yet (an intake, or a consultation) falls back to the matter's own identifier handle —
// stable forever, unambiguous, and honestly not a matter number. The rendered string is minted at
// capture and never re-rendered, so a later matter renumber leaves existing entry numbers exactly
// as they were issued.
export function renderEntryNumber(
  matterNumber: string | null,
  matterId: string,
  value: number,
): string {
  const prefix = matterNumber ?? matterId;
  return `${prefix}.${String(value).padStart(ENTRY_NUMBER_PAD_WIDTH, "0")}`;
}

// One matter's planned block: what the drawer observed (for the bounded retry's out-of-band
// advance) and the rendered numbers, in the order the batch's entries on this matter appear.
export interface EntryNumberBlockPlan {
  readonly scopeKey: string; // the matter id
  readonly observedValue: number;
  readonly startValue: number;
  readonly count: number;
  readonly numbers: readonly string[];
}

// Reads the matter's number and the counter, and renders `count` consecutive entry numbers.
// Run INSIDE the idempotent effect (like the matter draw), so a replayed request never draws.
export async function planEntryNumberBlock(
  database: SqlDatabase,
  matterId: string,
  count: number,
): Promise<EntryNumberBlockPlan> {
  const { results } = await database
    .prepare("SELECT matter_number FROM matter WHERE id = ?1")
    .bind(matterId)
    .all<{ matter_number: string | null }>();
  const matterNumber = results[0]?.matter_number ?? null;
  const observedValue =
    (await readCounterValue(database, TIME_ENTRY_NUMBERING_TABLES, matterId)) ??
    ENTRY_NUMBER_START_VALUE;
  const numbers: string[] = [];
  for (let offset = 0; offset < count; offset += 1) {
    numbers.push(renderEntryNumber(matterNumber, matterId, observedValue + offset));
  }
  return {
    scopeKey: matterId,
    observedValue,
    startValue: ENTRY_NUMBER_START_VALUE,
    count,
    numbers,
  };
}

// The statements that open a block's draw: ensure the counter row exists, then advance it by the
// block size, guarded on the observed value. The guard aborts nothing on its own (a zero-row
// UPDATE is not an error) — the allocation primary key below is the load-bearing backstop.
export function entryNumberBlockOpenStatements(
  database: SqlDatabase,
  plan: EntryNumberBlockPlan,
): SqlStatement[] {
  return [
    ensureCounterRowStatement(
      database,
      TIME_ENTRY_NUMBERING_TABLES,
      plan.scopeKey,
      plan.startValue,
    ),
    database
      .prepare(
        `UPDATE ${TIME_ENTRY_NUMBERING_TABLES.counterTable} SET next_value = next_value + ?3 WHERE scope_key = ?1 AND next_value = ?2`,
      )
      .bind(plan.scopeKey, plan.observedValue, plan.count),
  ];
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
