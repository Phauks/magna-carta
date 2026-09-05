import type { SqlDatabase, SqlStatement } from "@magna-carta/data-access/idempotency-statements";
import type { MatterId } from "@magna-carta/identifiers/types";

// The named open-precondition hook: the close hook's mirror on the other side of the lifecycle.
// Opening a matter (drawing its number, prospective -> open) runs every supplied precondition; any
// failure blocks the open and is surfaced to the caller as a list (a problem document's errors[]).
// The registry below is EMPTY and stays empty — the matter shell imposes no opening rule of its own,
// and a rule that belongs to another subsystem (what a consultation must clear before the firm acts:
// the conflicts posture, the intake procedure) is passed in by the composition root rather than
// imported here, so the matter shell never learns what a conflicts check is.
export interface OpenPreconditionContext {
  readonly matterId: MatterId;
  readonly database: SqlDatabase;
}

export interface OpenPreconditionFailure {
  readonly code: string;
  readonly message: string;
}

export interface OpenPrecondition {
  // Reads the current state and reports, in language the caller can act on, what blocks the open.
  check(context: OpenPreconditionContext): Promise<readonly OpenPreconditionFailure[]>;
  // Statements that ride the open batch and ABORT it when the condition `check` read has changed by
  // commit time — the close hook's commitGuard, for the same reason (D1 has no interactive
  // transaction). Optional: a precondition whose facts are derived across several subsystems has no
  // single statement to re-assert them with, and supplies none.
  commitGuard?(context: OpenPreconditionContext): readonly SqlStatement[];
}

export const OPEN_PRECONDITIONS: readonly OpenPrecondition[] = [];

export async function runOpenPreconditions(
  context: OpenPreconditionContext,
  preconditions: readonly OpenPrecondition[] = OPEN_PRECONDITIONS,
): Promise<OpenPreconditionFailure[]> {
  const failures: OpenPreconditionFailure[] = [];
  for (const precondition of preconditions) {
    failures.push(...(await precondition.check(context)));
  }
  return failures;
}

// The guards, flattened in registry order, for the caller to place at the head of the open batch.
export function openPreconditionGuardStatements(
  context: OpenPreconditionContext,
  preconditions: readonly OpenPrecondition[] = OPEN_PRECONDITIONS,
): SqlStatement[] {
  return preconditions.flatMap((precondition) => [...(precondition.commitGuard?.(context) ?? [])]);
}

// Thrown when one or more open preconditions fail — carries every failure so the route can render
// them together.
export class OpenPreconditionError extends Error {
  constructor(readonly failures: readonly OpenPreconditionFailure[]) {
    super(`matter open blocked by ${failures.length} precondition(s)`);
    this.name = "OpenPreconditionError";
  }
}
