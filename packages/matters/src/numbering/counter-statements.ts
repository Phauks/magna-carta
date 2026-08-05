import type { SqlDatabase, SqlStatement } from "@magna-carta/data-access/idempotency-statements";
import type { MatterId } from "@magna-carta/identifiers/types";
import {
  allocateCounterValueStatement as allocateSequenceValueStatement,
  ensureCounterRowStatement as ensureSequenceCounterRowStatement,
  guardedIncrementStatement as guardedSequenceIncrementStatement,
  isNumberAllocationConflict as isSequenceAllocationConflict,
  readCounterValue as readSequenceCounterValue,
  selectCounterValueStatement as selectSequenceCounterValueStatement,
  type SequenceNumberingTables,
} from "@magna-carta/sequence-numbering/counter-statements";

// The matter-number counter, one row per {firm, scope_key}. The mechanism — ensure-row, guarded
// increment, and an allocation row whose composite primary key is the load-bearing backstop — is
// @magna-carta/sequence-numbering's; the reasoning that makes it correct lives there, in one place,
// because a copy loses exactly the subtlety that a zero-row guarded UPDATE aborts nothing.
//
// What stays here is what is matter-specific: the table names, the matter_id owner column, and the
// MatterId typing on the allocation. The UNIQUE index on matter_number is a SEPARATE mechanism
// covering what the allocation key cannot — a rendered number colliding with a manually assigned
// court or legacy number — and lives with the matter service that renders it.
export const MATTER_NUMBER_COUNTER_TABLE = "matter_number_counter";

// One row per counter value a draw consumed, keyed by {scope_key, drawn_value}.
export const MATTER_NUMBER_ALLOCATION_TABLE = "matter_number_allocation";

export const MATTER_NUMBERING_TABLES: SequenceNumberingTables = {
  counterTable: MATTER_NUMBER_COUNTER_TABLE,
  allocationTable: MATTER_NUMBER_ALLOCATION_TABLE,
  ownerColumn: "matter_id",
};

export function ensureCounterRowStatement(
  database: SqlDatabase,
  scopeKey: string,
  startValue: number,
): SqlStatement {
  return ensureSequenceCounterRowStatement(database, MATTER_NUMBERING_TABLES, scopeKey, startValue);
}

export function guardedIncrementStatement(
  database: SqlDatabase,
  scopeKey: string,
  observedValue: number,
): SqlStatement {
  return guardedSequenceIncrementStatement(
    database,
    MATTER_NUMBERING_TABLES,
    scopeKey,
    observedValue,
  );
}

// Composed AFTER the matter write in the draw batch — matter_id is a foreign key, so the matter row
// has to exist by the time this statement runs.
export function allocateCounterValueStatement(
  database: SqlDatabase,
  scopeKey: string,
  drawnValue: number,
  matterId: MatterId,
  allocatedAt: string,
): SqlStatement {
  return allocateSequenceValueStatement(
    database,
    MATTER_NUMBERING_TABLES,
    scopeKey,
    drawnValue,
    matterId,
    allocatedAt,
  );
}

// A losing concurrent draw aborts its batch on the allocation primary key. Mirrors
// isMatterNumberConflict — both are retryable outcomes of the same draw race.
export function isNumberAllocationConflict(error: unknown): boolean {
  return isSequenceAllocationConflict(error, MATTER_NUMBERING_TABLES);
}

export function selectCounterValueStatement(database: SqlDatabase, scopeKey: string): SqlStatement {
  return selectSequenceCounterValueStatement(database, MATTER_NUMBERING_TABLES, scopeKey);
}

// Reads the next value to assign for a scope, or undefined when the counter has never been drawn
// (the caller falls back to the scheme's configured start).
export function readCounterValue(
  database: SqlDatabase,
  scopeKey: string,
): Promise<number | undefined> {
  return readSequenceCounterValue(database, MATTER_NUMBERING_TABLES, scopeKey);
}
