import {
  insertCompletedIdempotencyRecordStatement,
  type CompletedIdempotencyRecord,
  type SqlDatabase,
  type SqlStatement,
} from "./idempotency-statements.ts";
import { insertOutboxMessageStatement, type OutboxMessage } from "./outbox-statements.ts";
import type { BatchOptions } from "@magna-carta/database/guarded-write";

// Re-exported so a domain package catches the refusal from the same module it composes its write
// through, rather than reaching past the chokepoint into the adapter layer to name it.
export { GuardedWriteRefusedError } from "@magna-carta/database/guarded-write";

// A database that can commit a batch atomically — D1Database and D1DatabaseSession both satisfy this.
export interface BatchDatabase extends SqlDatabase {
  batch(statements: SqlStatement[], options?: BatchOptions): Promise<unknown>;
  /**
   * Set by an adapter that aborts the transaction when a guarded statement affects no rows.
   *
   * Declared rather than assumed because the failure mode of assuming it is silent: a guarded effect
   * committed through an adapter that ignores guards commits exactly as it would have without them,
   * and the only sign is the absence of a refusal nobody was watching for. `commitEffectBatch`
   * refuses such a pairing outright instead.
   */
  readonly enforcesGuardedWrites?: boolean;
}

/**
 * A statement whose WHERE repeats the precondition its caller read, paired with the label the caller
 * matches on when it turns out not to hold.
 *
 * THE PRECONDITION READ IS ADVISORY AND THIS IS NOT. There is no interactive transaction here, so a
 * service reads a row's state in one round trip and commits in another, and anything can happen in
 * between. What actually holds the line is the `AND status = 'draft'` the statement carries, which
 * matches nothing once the row has moved. Marking the statement guarded is how the batch learns that
 * matching nothing means refused rather than done — without it the row is protected and the caller
 * is told its write landed.
 */
export interface GuardedStatement {
  readonly statement: SqlStatement;
  readonly guard: string;
}

export type EffectStatement = SqlStatement | GuardedStatement;

/** Marks a statement whose WHERE carries a precondition, so an unmatched row refuses the batch. */
export function guarded(statement: SqlStatement, guard: string): GuardedStatement {
  return { statement, guard };
}

function isGuarded(statement: EffectStatement): statement is GuardedStatement {
  return "guard" in statement && typeof statement.guard === "string";
}

// What a handler's effect produces: prepared business statements plus the outbox messages describing
// any external consequences. Handlers never call external services directly (the outbox chokepoint) —
// that is what makes speculative execution safe: a rolled-back batch leaves no trace anywhere.
export interface EffectWrite {
  readonly statements: readonly EffectStatement[];
  readonly outboxMessages: readonly OutboxMessage[];
}

// THE MOST STATEMENTS ONE BATCH MAY CARRY — a stated ceiling, not a discovered one.
//
// This seam used to have a ceiling nobody chose: it composed with `push(...effect.statements)`, and a
// spread argument list is bounded by the engine's remaining stack rather than by anything about
// databases. It threw `RangeError: Maximum call stack size exceeded` somewhere in the low hundreds of
// thousands, and the exact number MOVED with how deep the call stack already was — so the same effect
// could commit on one code path and abort on another. That is the worst shape a limit can have: a
// caller cannot discover it, test for it, or reason about it.
//
// The spread is gone (the loop below has no argument-count bound at all), which leaves the real
// question: SHOULD a batch that large be possible. It should not. A batch is one D1 transaction
// executed inside one Worker invocation's CPU and duration budget, and every statement in it is work
// that has to finish before the request can answer. A composer assembling six figures of statements
// has not found a large transaction; it has failed to bound something upstream, and the honest place
// to say so is here, immediately, rather than in a D1 error after the whole set has been serialized.
//
// The number is a policy ceiling with room to spare, not a measured platform limit: local commits of
// this shape run about ten microseconds a statement, so ten thousand is already a tenth of a second of
// pure commit before any network, and every batch any shipped composer assembles is orders of
// magnitude under it. It is deliberately well below where the old accident sat, so reaching it means a
// caller is unbounded rather than merely large.
export const MAX_BATCH_STATEMENTS = 10_000;

// Refused because the effect is unbounded, never because the platform hiccuped: a caller catching this
// must fix the size of what it composed, not retry it.
export class EffectBatchTooLargeError extends Error {
  readonly statementCount: number;
  readonly maximumStatementCount: number;

  constructor(statementCount: number) {
    super(
      `composeEffectBatch: ${statementCount} statements in one atomic batch exceeds the ceiling of ${MAX_BATCH_STATEMENTS}. ` +
        `A batch is one transaction inside one request, so the fix is to bound the effect where the domain knows what its rows mean — ` +
        `packages/conflicts/src/run-check.ts bounds its candidate set and records the refusal on the check row — never to split the batch, ` +
        `which would trade the ceiling for a partially committed write.`,
    );
    this.name = "EffectBatchTooLargeError";
    this.statementCount = statementCount;
    this.maximumStatementCount = MAX_BATCH_STATEMENTS;
  }
}

// THE chokepoint: the one place a write batch is assembled.
// Order matters — the idempotency record goes FIRST so its UNIQUE conflict aborts the transaction
// before any business statement executes; outbox rows ride in the same commit as the change they
// describe (the transactional-outbox guarantee).
export function composeEffectBatch(
  database: BatchDatabase,
  effect: EffectWrite,
  options: { idempotencyRecord?: CompletedIdempotencyRecord; now: () => string },
): { statements: SqlStatement[]; guards: ReadonlyMap<number, string> } {
  // Counted before anything is built, so an oversized effect costs one addition rather than the
  // construction of the batch it is about to be refused for.
  const statementCount =
    (options.idempotencyRecord ? 1 : 0) + effect.statements.length + effect.outboxMessages.length;
  if (statementCount > MAX_BATCH_STATEMENTS) throw new EffectBatchTooLargeError(statementCount);

  const statements: SqlStatement[] = [];
  // Guards are carried by POSITION rather than on the statement, because the statement handed down is
  // the port's SqlStatement and an adapter is entitled to expect exactly that — a marker property
  // riding on it would survive to whichever adapter happened to look for one and be invisible to the
  // rest. A position is unambiguous to all of them.
  const guards = new Map<number, string>();
  if (options.idempotencyRecord) {
    statements.push(insertCompletedIdempotencyRecordStatement(database, options.idempotencyRecord));
  }
  // Appended one at a time rather than spread: a spread passes every element as a separate ARGUMENT,
  // which is what put an engine stack limit in the middle of a data path.
  for (const statement of effect.statements) {
    if (isGuarded(statement)) guards.set(statements.length, statement.guard);
    statements.push(isGuarded(statement) ? statement.statement : statement);
  }
  const createdAt = options.now();
  for (const message of effect.outboxMessages) {
    statements.push(insertOutboxMessageStatement(database, message, createdAt));
  }
  return { statements, guards };
}

export async function commitEffectBatch(
  database: BatchDatabase,
  effect: EffectWrite,
  options: { idempotencyRecord?: CompletedIdempotencyRecord; now: () => string },
): Promise<void> {
  const { statements, guards } = composeEffectBatch(database, effect, options);
  if (statements.length === 0) return; // nothing to commit — skip the roundtrip
  if (guards.size > 0 && database.enforcesGuardedWrites !== true) {
    throw new UnenforceableGuardError(guards.size);
  }
  await database.batch(statements, guards.size > 0 ? { guards } : undefined);
}

/**
 * Raised when a guarded effect is handed to a database that cannot enforce guards.
 *
 * Loud on purpose. The alternative — commit it anyway, unguarded — is the exact bug the guard was
 * added to close, restored silently and only on whichever adapter happens to be in the way.
 */
export class UnenforceableGuardError extends Error {
  constructor(guardCount: number) {
    super(
      `this effect carries ${String(guardCount)} guarded statement(s) but the database it was handed cannot enforce them. ` +
        `A guarded write must abort its transaction when it matches no row, so committing it here would silently drop the guard. ` +
        `Adapters that enforce guards declare enforcesGuardedWrites — see packages/database/src/guarded-write.ts.`,
    );
    this.name = "UnenforceableGuardError";
  }
}
