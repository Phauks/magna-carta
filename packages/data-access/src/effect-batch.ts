import {
  insertCompletedIdempotencyRecordStatement,
  type CompletedIdempotencyRecord,
  type SqlDatabase,
  type SqlStatement,
} from "./idempotency-statements.ts";
import { insertOutboxMessageStatement, type OutboxMessage } from "./outbox-statements.ts";

// A database that can commit a batch atomically — D1Database and D1DatabaseSession both satisfy this.
export interface BatchDatabase extends SqlDatabase {
  batch(statements: SqlStatement[]): Promise<unknown>;
}

// What a handler's effect produces: prepared business statements plus the outbox messages describing
// any external consequences. Handlers never call external services directly (the outbox chokepoint) —
// that is what makes speculative execution safe: a rolled-back batch leaves no trace anywhere.
export interface EffectWrite {
  readonly statements: readonly SqlStatement[];
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
): SqlStatement[] {
  // Counted before anything is built, so an oversized effect costs one addition rather than the
  // construction of the batch it is about to be refused for.
  const statementCount =
    (options.idempotencyRecord ? 1 : 0) + effect.statements.length + effect.outboxMessages.length;
  if (statementCount > MAX_BATCH_STATEMENTS) throw new EffectBatchTooLargeError(statementCount);

  const statements: SqlStatement[] = [];
  if (options.idempotencyRecord) {
    statements.push(insertCompletedIdempotencyRecordStatement(database, options.idempotencyRecord));
  }
  // Appended one at a time rather than spread: a spread passes every element as a separate ARGUMENT,
  // which is what put an engine stack limit in the middle of a data path.
  for (const statement of effect.statements) statements.push(statement);
  const createdAt = options.now();
  for (const message of effect.outboxMessages) {
    statements.push(insertOutboxMessageStatement(database, message, createdAt));
  }
  return statements;
}

export async function commitEffectBatch(
  database: BatchDatabase,
  effect: EffectWrite,
  options: { idempotencyRecord?: CompletedIdempotencyRecord; now: () => string },
): Promise<void> {
  const statements = composeEffectBatch(database, effect, options);
  if (statements.length === 0) return; // nothing to commit — skip the roundtrip
  await database.batch(statements);
}
