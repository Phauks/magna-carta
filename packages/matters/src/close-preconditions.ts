import type { SqlDatabase, SqlStatement } from "@magna-carta/data-access/idempotency-statements";
import type { MatterId } from "@magna-carta/identifiers/types";

// The named close-precondition hook. Closing a matter runs every supplied precondition; any failure
// blocks the close and is surfaced to the caller as a list (a problem document's errors[]). The
// registry below is EMPTY and stays empty — the matter shell imposes no close rule of its own, and a
// rule that belongs to another subsystem is passed in by the composition root rather than imported
// here, so the matter shell never learns what money or property is.
export interface ClosePreconditionContext {
  readonly matterId: MatterId;
  readonly database: SqlDatabase;
}

export interface ClosePreconditionFailure {
  readonly code: string;
  readonly message: string;
}

export interface ClosePrecondition {
  // Reads the current state and reports, in language the caller can act on, what blocks the close.
  check(context: ClosePreconditionContext): Promise<readonly ClosePreconditionFailure[]>;
  // Statements that ride the close batch itself and ABORT it when the condition `check` read has
  // changed by the time it commits. D1 has no interactive transaction, so a check that reads and
  // then writes cannot be atomic: a concurrent writer can satisfy the check and then invalidate it
  // in the window before the close commits. A guard closes that window by re-asserting the condition
  // inside the same transaction — it must therefore be a statement that either matches nothing or
  // violates a constraint, never one that stores a row. Optional: a precondition with no such
  // exposure supplies none.
  commitGuard?(context: ClosePreconditionContext): readonly SqlStatement[];
}

export const CLOSE_PRECONDITIONS: readonly ClosePrecondition[] = [];

export async function runClosePreconditions(
  context: ClosePreconditionContext,
  preconditions: readonly ClosePrecondition[] = CLOSE_PRECONDITIONS,
): Promise<ClosePreconditionFailure[]> {
  const failures: ClosePreconditionFailure[] = [];
  for (const precondition of preconditions) {
    failures.push(...(await precondition.check(context)));
  }
  return failures;
}

// The guards, flattened in registry order, for the caller to place at the head of the close batch.
export function closePreconditionGuardStatements(
  context: ClosePreconditionContext,
  preconditions: readonly ClosePrecondition[] = CLOSE_PRECONDITIONS,
): SqlStatement[] {
  return preconditions.flatMap((precondition) => [...(precondition.commitGuard?.(context) ?? [])]);
}

// Thrown when one or more close preconditions fail — carries every failure so the route can render
// them together.
export class ClosePreconditionError extends Error {
  constructor(readonly failures: readonly ClosePreconditionFailure[]) {
    super(`matter close blocked by ${failures.length} precondition(s)`);
    this.name = "ClosePreconditionError";
  }
}
