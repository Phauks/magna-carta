import type { SqlStatement } from "./idempotency-statements.ts";
import type { BatchDatabase } from "./effect-batch.ts";

// DEV/TEST ONLY. A BatchDatabase that runs a second writer at a chosen point inside somebody else's
// mutation, so the window between a precondition read and its commit can be opened on purpose.
// Never import from Worker code — it exists to make a test deterministic and has no production use.
//
// WHY THIS WINDOW IS REAL. There is no interactive transaction here: a domain mutation reads its
// precondition in one round trip and commits its batch in another. The batch is atomic, the read is
// not part of it, and two callers can therefore both read the same pre-state and both commit. What
// stops them is never the batch's atomicity — it is a UNIQUE or CHECK constraint that aborts the
// batch, or a guarded UPDATE whose WHERE carries the precondition so a stale caller changes no rows.
// A verifier for any of those has to place a competing writer INSIDE the window, and firing it at a
// named point beats racing two promises: two promises interleave however the runtime happened to
// schedule them that run, which is a test that passes for reasons nobody chose and stops failing for
// reasons nobody notices.

/** Where inside the operation under test the competing writer runs. */
export interface InterleavePoint {
  readonly kind: "before-commit" | "after-read";
  /** For after-read: the read is matched on this text appearing in its SQL. */
  readonly matching?: string;
  /** Which matching occurrence fires the writer. 1 is the first. */
  readonly occurrence: number;
  /** What a failure to reach the point should say, phrased for whoever wrote the test. */
  readonly description: string;
}

/**
 * Fire before the operation's nth commit — the default point, and the right one whenever the
 * precondition is read and the decision is committed in the same call.
 *
 * `nth` is for a mutation that commits more than once (a resumable provisioning step, say). Pointing
 * at a commit the operation never reaches is a failed test rather than a silent pass.
 */
export function beforeCommit(nth = 1): InterleavePoint {
  return {
    kind: "before-commit",
    occurrence: nth,
    description: nth === 1 ? "the first commit" : `commit number ${String(nth)}`,
  };
}

/**
 * Fire once a read whose SQL contains `matching` has resolved.
 *
 * Use it when the precondition read and the commit are not adjacent — the operation reads, then does
 * other work (draws a number, resolves a policy, calls a port) before committing — and the race you
 * mean to test is against that whole span rather than against the commit alone. Also the only point
 * that can catch an operation whose refusal happens before it ever composes a batch.
 */
export function afterRead(matching: string, occurrence = 1): InterleavePoint {
  return {
    kind: "after-read",
    matching,
    occurrence,
    description:
      occurrence === 1
        ? `the first read matching ${JSON.stringify(matching)}`
        : `read number ${String(occurrence)} matching ${JSON.stringify(matching)}`,
  };
}

export interface InterleavedDatabase extends BatchDatabase {
  /** Whether the point was reached and the competing writer actually ran. */
  readonly interleaved: boolean;
}

/**
 * Wrap a database so `concurrentWriter` runs at `point` inside whatever is driven through it.
 *
 * Prefer `runInterleaved` below, which cannot pass vacuously. Reach for this directly only when a
 * test needs the wrapper to outlive one operation.
 */
export function interleaveAt(
  database: BatchDatabase,
  point: InterleavePoint,
  concurrentWriter: () => Promise<unknown>,
): InterleavedDatabase {
  let reached = 0;
  let interleaved = false;

  async function fireIfDue(): Promise<void> {
    reached++;
    if (reached !== point.occurrence) return;
    interleaved = true;
    await concurrentWriter();
  }

  // Statements are wrapped only to observe reads, so the real statement is carried along and handed
  // back at batch(). A structural copy would execute identically against every adapter here, but the
  // adapters are entitled to expect their own prepare()'s output and one of them may come to check.
  const realStatements = new WeakMap<object, SqlStatement>();

  function wrapStatement(statement: SqlStatement): SqlStatement {
    if (point.kind !== "after-read") return statement;
    const text = statement.sql ?? "";
    const matches = point.matching !== undefined && text.includes(point.matching);
    const wrapped: SqlStatement = {
      sql: statement.sql,
      bind: (...values: unknown[]) => wrapStatement(statement.bind(...values)),
      run: () => statement.run(),
      all: async <T>() => {
        const result = await statement.all<T>();
        if (matches) await fireIfDue();
        return result;
      },
      first: async <T>() => {
        const result = await statement.first<T>();
        if (matches) await fireIfDue();
        return result;
      },
    };
    realStatements.set(wrapped, statement);
    return wrapped;
  }

  return {
    get interleaved() {
      return interleaved;
    },
    prepare: (sql: string) => wrapStatement(database.prepare(sql)),
    batch: async (statements: SqlStatement[]) => {
      if (point.kind === "before-commit") await fireIfDue();
      return database.batch(statements.map((one) => realStatements.get(one) ?? one));
    },
  };
}

/** Raised when the operation finished without ever reaching the point the test named. */
export class InterleaveNotReachedError extends Error {
  constructor(
    point: InterleavePoint,
    readonly operationFailure?: unknown,
  ) {
    super(
      `the interleave point was never reached: nothing fired at ${point.description}. ` +
        `The competing writer never ran, so this test proves nothing about concurrency — it asserts the ` +
        `single-caller outcome under a different name. Either the operation does not reach that point ` +
        `(check the point, and that the operation was driven through the wrapped database rather than ` +
        `the underlying one), or it refused earlier for an unrelated reason.`,
    );
    this.name = "InterleaveNotReachedError";
  }
}

export interface RunInterleavedOptions<T> {
  readonly database: BatchDatabase;
  /** The mutation under test. It must use the database it is handed, not one captured from outside. */
  readonly operation: (racing: BatchDatabase) => Promise<T>;
  /** The competing write that lands inside the operation's window. */
  readonly concurrentWriter: () => Promise<unknown>;
  /** Defaults to the first commit. */
  readonly point?: InterleavePoint;
}

/**
 * Drive `operation` with `concurrentWriter` landing inside it, and REFUSE to return quietly if the
 * point was never reached.
 *
 * That refusal is the whole reason to prefer this over `interleaveAt`. A concurrency verifier whose
 * competing writer never ran still exercises the operation, still asserts whatever it asserted, and
 * still passes — it has quietly become a single-caller test wearing a concurrency test's name, and
 * nothing about it looks wrong on the day the guard it was meant to pin is removed. The operation's
 * own failure is preserved as `operationFailure` when it had one, because a test written around
 * `rejects.toMatchObject` otherwise loses the error it was reading.
 */
export async function runInterleaved<T>(options: RunInterleavedOptions<T>): Promise<T> {
  const point = options.point ?? beforeCommit();
  const racing = interleaveAt(options.database, point, options.concurrentWriter);

  let value: T;
  try {
    value = await options.operation(racing);
  } catch (operationFailure) {
    if (!racing.interleaved) throw new InterleaveNotReachedError(point, operationFailure);
    throw operationFailure;
  }
  if (!racing.interleaved) throw new InterleaveNotReachedError(point);
  return value;
}
