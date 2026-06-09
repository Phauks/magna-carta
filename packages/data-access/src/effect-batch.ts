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
// any external consequences. Handlers never call external services directly (ADR-0064 chokepoint) —
// that is what makes speculative execution safe: a rolled-back batch leaves no trace anywhere.
export interface EffectWrite {
  readonly statements: readonly SqlStatement[];
  readonly outboxMessages: readonly OutboxMessage[];
}

// THE chokepoint: the one place a write batch is assembled (ADR-0063 + ADR-0064 batch realization).
// Order matters — the idempotency record goes FIRST so its UNIQUE conflict aborts the transaction
// before any business statement executes; outbox rows ride in the same commit as the change they
// describe (the transactional-outbox guarantee).
export function composeEffectBatch(
  database: BatchDatabase,
  effect: EffectWrite,
  options: { idempotencyRecord?: CompletedIdempotencyRecord; now: () => string },
): SqlStatement[] {
  const statements: SqlStatement[] = [];
  if (options.idempotencyRecord) {
    statements.push(insertCompletedIdempotencyRecordStatement(database, options.idempotencyRecord));
  }
  statements.push(...effect.statements);
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
