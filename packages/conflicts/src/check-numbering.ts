import type { SequenceNumberingTables } from "@magna-carta/sequence-numbering/counter-statements";

// The numbered check's table, named here rather than in check-run.ts so the sequence module owes
// nothing to the module that draws from it: check-run.ts imports this file, and a module that
// imports its way back to itself is the one shape the hard rules refuse.
export const CONFLICTS_NUMBERED_CHECK_TABLE = "conflicts_numbered_check";

// The conflicts check sequence over the shared numbering idiom. What the number LOOKS like is the
// firm's own choice, written on the numbering settings screen under the `conflicts_check` purpose
// and read by the shared draw planner; the built-in default (CC2026-00001, restarting each year)
// lives on the purpose register in @magna-carta/sequence-numbering/purposes with the reason a
// four-digit firm-wide run was the wrong default for the busiest sequence a firm has.
//
// What stays here is what is conflicts-specific: the table names and the `check_id` owner column.
// The mechanism — ensure-row, guarded increment, and an allocation row whose composite primary key
// is the load-bearing backstop — and the reasoning that makes it correct live in the shared package.
export const CONFLICTS_CHECK_NUMBERING_TABLES: SequenceNumberingTables = {
  counterTable: "conflicts_check_number_counter",
  allocationTable: "conflicts_check_number_allocation",
  ownerColumn: "check_id",
};

// The rendered-string collision the counter cannot see: the unique index on
// conflicts_numbered_check.check_number. A check numbered before the scheme existed drew no
// allocation row, so only this index sees a new draw landing on its number, and the bounded retry
// steps past it. Registered as the draw's `alsoRetryable`, mirroring the matter number's arrangement.
export function isCheckNumberConflict(error: unknown): boolean {
  return (
    error instanceof Error &&
    error.message.includes("UNIQUE constraint failed") &&
    error.message.includes(`${CONFLICTS_NUMBERED_CHECK_TABLE}.check_number`)
  );
}
