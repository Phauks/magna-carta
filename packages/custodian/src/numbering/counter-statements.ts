import type { SqlDatabase, SqlStatement } from "@magna-carta/data-access/idempotency-statements";
import type { CustodyPacketId } from "@magna-carta/identifiers/types";
import {
  allocateCounterValueStatement as allocateSequenceValueStatement,
  ensureCounterRowStatement as ensureSequenceCounterRowStatement,
  guardedIncrementStatement as guardedSequenceIncrementStatement,
  isNumberAllocationConflict as isSequenceAllocationConflict,
  readCounterValue as readSequenceCounterValue,
  selectCounterValueStatement as selectSequenceCounterValueStatement,
  type SequenceNumberingTables,
} from "@magna-carta/sequence-numbering/counter-statements";

// The custody-number counter, one row per {firm, scope_key}, and the allocation ledger behind it. The
// mechanism — ensure-row, guarded increment, and an allocation row whose composite primary key is the
// load-bearing backstop — is @magna-carta/sequence-numbering's; the reasoning that makes it correct
// lives there, in one place, because a copy loses exactly the subtlety that a zero-row guarded UPDATE
// aborts nothing.
//
// What stays here is what is custody-specific: the table names, the packet_id owner column, and the
// CustodyPacketId typing on the allocation. The unique index on the rendered custody_number is a
// SEPARATE mechanism covering what the allocation key cannot — a rendered number colliding with a
// manually assigned one — and lives with packet-statements.ts as isCustodyNumberConflict.
export const CUSTODY_NUMBER_COUNTER_TABLE = "custody_number_counter";

// One row per counter value a draw consumed, keyed by {scope_key, drawn_value}.
export const CUSTODY_NUMBER_ALLOCATION_TABLE = "custody_number_allocation";

export const CUSTODY_NUMBERING_TABLES: SequenceNumberingTables = {
  counterTable: CUSTODY_NUMBER_COUNTER_TABLE,
  allocationTable: CUSTODY_NUMBER_ALLOCATION_TABLE,
  ownerColumn: "packet_id",
};

export function ensureCounterRowStatement(
  database: SqlDatabase,
  scopeKey: string,
  startValue: number,
): SqlStatement {
  return ensureSequenceCounterRowStatement(
    database,
    CUSTODY_NUMBERING_TABLES,
    scopeKey,
    startValue,
  );
}

export function guardedIncrementStatement(
  database: SqlDatabase,
  scopeKey: string,
  observedValue: number,
): SqlStatement {
  return guardedSequenceIncrementStatement(
    database,
    CUSTODY_NUMBERING_TABLES,
    scopeKey,
    observedValue,
  );
}

// Claims the counter value this draw consumed. The composite primary key — NOT the unique index on
// the rendered custody_number string — is the load-bearing backstop: a firm that scopes numbering per
// custody root renders RNO-00042 and LVS-00042 from the same counter value in different scopes, so
// only a claim on the VALUE catches two draws that observed the same counter. Composed AFTER the
// packet write in the draw batch — packet_id is a foreign key, so the packet row has to exist by the
// time this statement runs.
export function allocateCounterValueStatement(
  database: SqlDatabase,
  scopeKey: string,
  drawnValue: number,
  packetId: CustodyPacketId,
  allocatedAt: string,
): SqlStatement {
  return allocateSequenceValueStatement(
    database,
    CUSTODY_NUMBERING_TABLES,
    scopeKey,
    drawnValue,
    packetId,
    allocatedAt,
  );
}

// A losing concurrent draw aborts its batch on the allocation primary key. Its twin is
// isCustodyNumberConflict — both are retryable outcomes of the same draw race.
//
// The shared predicate also recognises the append-only refusal an allocation table with a
// no-overwrite BEFORE INSERT trigger raises ahead of its primary key. custody_number_allocation
// carries no such trigger, so that arm cannot fire here; it costs nothing and it is what keeps this
// one predicate correct for every consumer.
export function isNumberAllocationConflict(error: unknown): boolean {
  return isSequenceAllocationConflict(error, CUSTODY_NUMBERING_TABLES);
}

export function selectCounterValueStatement(database: SqlDatabase, scopeKey: string): SqlStatement {
  return selectSequenceCounterValueStatement(database, CUSTODY_NUMBERING_TABLES, scopeKey);
}

// Reads the next value to assign for a scope, or undefined when the counter has never been drawn
// (the caller falls back to the configured start).
export function readCounterValue(
  database: SqlDatabase,
  scopeKey: string,
): Promise<number | undefined> {
  return readSequenceCounterValue(database, CUSTODY_NUMBERING_TABLES, scopeKey);
}
