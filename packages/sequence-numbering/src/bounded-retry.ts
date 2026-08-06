import type { SqlDatabase } from "@magna-carta/data-access/idempotency-statements";
import {
  ensureCounterRowStatement,
  guardedIncrementStatement,
  isNumberAllocationConflict,
  type SequenceNumberingTables,
} from "./counter-statements.ts";

export const DEFAULT_MAX_DRAW_ATTEMPTS = 5;

// What one attempt observed, so a losing attempt can advance the counter it read.
export interface ObservedDraw {
  readonly scopeKey: string;
  readonly observedValue: number;
  readonly startValue: number;
}

export interface BoundedDrawOptions {
  readonly maxAttempts?: number;
  // A caller may hold a second retryable collision of its own — matters renders a number that can
  // collide with a manually assigned court number on its own unique index. Anything this returns
  // false for is rethrown untouched.
  readonly alsoRetryable?: (error: unknown) => boolean;
  // Names the sequence in the non-convergence error, so an operator reading it knows which one gave up.
  readonly sequenceLabel: string;
}

// The bounded-retry draw. `attempt` runs the read-render-commit; when it loses, its whole batch —
// including the in-batch increment — has rolled back, so the counter is advanced OUT OF BAND here
// before retrying. That advance is itself guarded on the observed value, so it is a no-op when the
// concurrent winner already moved the counter, and two losers never double-advance it.
//
// `attempt` reports what it observed through `observe` rather than returning it, because the losing
// path has no return value to read: the throw is the outcome.
export async function drawWithBoundedRetry<T>(
  database: SqlDatabase,
  tables: SequenceNumberingTables,
  options: BoundedDrawOptions,
  attempt: (observe: (draw: ObservedDraw) => void) => Promise<T>,
): Promise<T> {
  const maxAttempts = options.maxAttempts ?? DEFAULT_MAX_DRAW_ATTEMPTS;
  let lastError: unknown;
  for (let index = 0; index < maxAttempts; index += 1) {
    let observed: ObservedDraw | undefined;
    try {
      return await attempt((draw) => {
        observed = draw;
      });
    } catch (caught) {
      const retryable =
        isNumberAllocationConflict(caught, tables) || (options.alsoRetryable?.(caught) ?? false);
      if (!retryable || !observed) throw caught;
      lastError = caught;
      await ensureCounterRowStatement(
        database,
        tables,
        observed.scopeKey,
        observed.startValue,
      ).run();
      await guardedIncrementStatement(
        database,
        tables,
        observed.scopeKey,
        observed.observedValue,
      ).run();
    }
  }
  throw new Error(
    `${options.sequenceLabel} allocation did not converge after ${maxAttempts} attempts: ${String(lastError)}`,
  );
}
