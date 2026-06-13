import type { SqlDatabase } from "@magna-carta/data-access/idempotency-statements";
import type { MatterId } from "@magna-carta/identifiers/types";

// The named close-precondition hook. Closing a matter runs every registered precondition; any
// failure blocks the close and is surfaced to the caller as a list (a 422 problem's errors[]). The
// registry is EMPTY at this layer — the matter shell imposes no close rule of its own. The Financial
// Core registers the zero-trust-balance rule against this seam when it lands.
export interface ClosePreconditionContext {
  readonly matterId: MatterId;
  readonly database: SqlDatabase;
}

export interface ClosePreconditionFailure {
  readonly code: string;
  readonly message: string;
}

export type ClosePrecondition = (
  context: ClosePreconditionContext,
) => Promise<readonly ClosePreconditionFailure[]>;

export const CLOSE_PRECONDITIONS: readonly ClosePrecondition[] = [];

export async function runClosePreconditions(
  context: ClosePreconditionContext,
): Promise<ClosePreconditionFailure[]> {
  const failures: ClosePreconditionFailure[] = [];
  for (const precondition of CLOSE_PRECONDITIONS) {
    failures.push(...(await precondition(context)));
  }
  return failures;
}

// Thrown when one or more close preconditions fail — carries every failure so the route can render
// them together.
export class ClosePreconditionError extends Error {
  constructor(readonly failures: readonly ClosePreconditionFailure[]) {
    super(`matter close blocked by ${failures.length} precondition(s)`);
    this.name = "ClosePreconditionError";
  }
}
