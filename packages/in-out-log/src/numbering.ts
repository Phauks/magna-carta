import type { SqlDatabase, SqlStatement } from "@magna-carta/data-access/idempotency-statements";
import type { InOutEntryId } from "@magna-carta/identifiers/types";
import {
  allocateCounterValueStatement as allocateSequenceValueStatement,
  isNumberAllocationConflict as isSequenceAllocationConflict,
  type SequenceNumberingTables,
} from "@magna-carta/sequence-numbering/counter-statements";

// The number the front desk writes on the envelope: IO-0187 by default, drawn from the firm's
// `in_out_entry` scheme on the numbering register (@magna-carta/sequence-numbering/purposes). The
// mechanism, and the reasoning that makes it correct, live in that package; what stays here is the
// two table names and the owner column, on the custody number's model.
export const IN_OUT_ENTRY_NUMBERING_TABLES: SequenceNumberingTables = {
  counterTable: "in_out_entry_number_counter",
  allocationTable: "in_out_entry_number_allocation",
  ownerColumn: "entry_id",
};

// Claims the counter value this draw consumed. Composed AFTER the entry's insert in the same batch,
// because entry_id is a foreign key.
export function allocateEntryNumberStatement(
  database: SqlDatabase,
  scopeKey: string,
  drawnValue: number,
  entryId: InOutEntryId,
  allocatedAt: string,
): SqlStatement {
  return allocateSequenceValueStatement(
    database,
    IN_OUT_ENTRY_NUMBERING_TABLES,
    scopeKey,
    drawnValue,
    entryId,
    allocatedAt,
  );
}

// A losing concurrent draw aborts its batch on the allocation primary key.
export function isEntryNumberAllocationConflict(error: unknown): boolean {
  return isSequenceAllocationConflict(error, IN_OUT_ENTRY_NUMBERING_TABLES);
}

// The rendered number's own unique index, which catches what the allocation key cannot: a rendered
// number colliding with one drawn under a different scheme.
export function isEntryNumberConflict(error: unknown): boolean {
  return (
    error instanceof Error &&
    error.message.includes("UNIQUE constraint failed") &&
    error.message.includes("in_out_entry.number")
  );
}
