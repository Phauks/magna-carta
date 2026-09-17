// A guarded write is an UPDATE or DELETE whose WHERE repeats the precondition the caller read, so a
// caller working from a stale read matches no row instead of overwriting somebody's work. Every
// adapter that can commit a batch enforces the same rule for them, and this is the one home for what
// that rule is.
//
// WHY IT ABORTS THE TRANSACTION RATHER THAN REPORTING AFTERWARDS. A guarded statement rides a batch
// with the other statements describing the same act — the audit row, the outbox message. Checking
// the row count after the batch has committed is too late for those: the change was refused and the
// record of it landed anyway, which is worse than either outcome on its own. Raising from inside the
// transaction is what makes the refusal total.

/** Raised when a guarded statement matched no row, so the whole batch is rolled back. */
export class GuardedWriteRefusedError extends Error {
  readonly guard: string;

  constructor(guard: string) {
    super(
      `guarded write "${guard}" affected no rows: the precondition its WHERE clause carries no longer holds, ` +
        `so the batch was rolled back rather than committing a change that was refused alongside the record of it.`,
    );
    this.name = "GuardedWriteRefusedError";
    this.guard = guard;
  }
}

/** What a batch may be told about the statements it is committing. */
export interface BatchOptions {
  /**
   * The positions in the batch that must affect at least one row, each mapped to the label the
   * caller matches on. A position absent from the map is an ordinary statement and is not checked —
   * an INSERT, or an UPDATE whose WHERE is only a primary key, has nothing to be stale about.
   */
  readonly guards?: ReadonlyMap<number, string>;
}

/** Throws when a guarded position reported no affected rows. Called by each adapter, mid-transaction. */
export function assertGuardAffectedRows(
  options: BatchOptions | undefined,
  index: number,
  changes: number,
): void {
  const guard = options?.guards?.get(index);
  if (guard !== undefined && changes === 0) throw new GuardedWriteRefusedError(guard);
}
