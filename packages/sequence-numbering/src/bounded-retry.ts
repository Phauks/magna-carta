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

// Everything known at the moment the loop gives up, handed to the caller's `nonConvergenceError` so
// it can raise the refusal its own route already understands.
export interface DrawNonConvergence {
  readonly sequenceLabel: string;
  readonly attempts: number;
  readonly lastError: unknown;
  // The sentence describing the give-up, composed HERE so every sequence words it identically and no
  // consumer has to re-derive it from the parts.
  readonly message: string;
}

export interface BoundedDrawOptions {
  readonly maxAttempts?: number;
  // A caller may hold a second retryable collision of its own — matters renders a number that can
  // collide with a manually assigned court number on its own unique index, and custodian's packet
  // write races on the shared custody holding matter before it reaches the counter at all. Anything
  // this returns false for is rethrown untouched.
  readonly alsoRetryable?: (error: unknown) => boolean;
  // Names the sequence in the non-convergence message, so an operator reading it knows which one gave up.
  readonly sequenceLabel: string;
  // REQUIRED, and required on purpose. Running out of attempts is a REFUSAL that leaves this package
  // and becomes an HTTP response: custodian answers a named `CustodyValidationError` its route maps
  // to a problem type, matters answers a plain `Error` the chokepoint reports as unexpected. A loop
  // that could only throw its own bare `Error` could not say either thing, which is why both
  // consumers kept private copies of it instead of adopting it.
  //
  // A MAPPER RATHER THAN A RESULT TYPE, deliberately. The alternative shape — return
  // `{ converged: true, value } | { converged: false, … }` and let the caller translate — reads
  // safer, because the failure arm is in the type. It is not, here. Every consumer's translation is
  // the same two words, "throw mine", so a result type buys a mandatory unwrap at every call site
  // whose only branch is a throw, and it pushes the "did not converge after N attempts" sentence
  // back out into each consumer, which is precisely the duplication being removed. It would also
  // wrap the SUCCESS path — the one that runs every time — in ceremony to make the failure path,
  // which needs a firm to lose five consecutive races, marginally more visible. The mapper keeps the
  // happy path returning `T`, keeps the wording in one place, and is required rather than defaulted
  // so a new sequence cannot inherit a bare `Error` by saying nothing: the person adding it has to
  // decide what their route surfaces.
  readonly nonConvergenceError: (detail: DrawNonConvergence) => unknown;
}

// The bounded-retry draw. `attempt` runs the read-render-commit; when it loses, its whole batch —
// including the in-batch increment — has rolled back, so the counter is advanced OUT OF BAND here
// before retrying. That advance is itself guarded on the observed value, so it is a no-op when the
// concurrent winner already moved the counter, and two losers never double-advance it.
//
// `attempt` reports what it observed through `observe` rather than returning it, because the losing
// path has no return value to read: the throw is the outcome.
//
// A RETRYABLE FAILURE WITH NOTHING OBSERVED IS STILL RETRIED — there is simply no counter to
// advance. The two facts are independent and conflating them was the loop's second gap: custodian
// reaches its draw only after resolving the firm's shared custody holding matter, and a concurrent
// first use of that matter loses a uniqueness race before any counter has been read. Its retry
// succeeds by reading the winner's row, and no counter value was consumed for it to skip past. The
// same arm covers a manual number colliding with one already on the register — no draw, nothing to
// advance, and the attempt bound is what stops it. Whether to retry at all stays entirely with
// `alsoRetryable`; `observe` only ever decides whether the counter moves.
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
      if (!retryable) throw caught;
      lastError = caught;
      if (observed !== undefined) {
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
  }
  throw options.nonConvergenceError({
    sequenceLabel: options.sequenceLabel,
    attempts: maxAttempts,
    lastError,
    message: `${options.sequenceLabel} allocation did not converge after ${maxAttempts} attempts: ${String(lastError)}`,
  });
}
