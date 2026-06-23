import type { DurableObjectId, DurableObjectStub } from "@cloudflare/workers-types";
import type { FirmDatabase } from "./firm-database-object.ts";
import { isUniqueConflict } from "./rpc-types.ts";

// The minimal SQL-statement shape the statement modules and effect-batch build against.
// Mirrors SqlDatabase / SqlStatement from @magna-carta/data-access/idempotency-statements —
// satisfied here without importing D1Database.
export interface ProxySqlStatement {
  readonly sql: string;
  readonly bindings: readonly unknown[];
  bind(...values: unknown[]): ProxySqlStatement;
  run(): Promise<{ meta: { changes: number } }>;
  all<T = Record<string, unknown>>(): Promise<{ results: T[] }>;
}

// The full BatchDatabase shape that commitEffectBatch drives: a SqlDatabase (prepare) plus
// an atomic batch (batch). Every write that goes through commitEffectBatch reaches the DO as
// one commitBatch RPC, so effects are atomic — the batch either fully commits or fully rolls back.
export interface ProxyBatchDatabase {
  prepare(sql: string): ProxySqlStatement;
  batch(statements: ProxySqlStatement[]): Promise<{ success: boolean }[]>;
}

// Builds a worker-side BatchDatabase that marshals every operation to the firm's FirmDatabase
// Durable Object over RPC. Individual run()/all() calls are one-RPC reads or writes; a batch()
// is one commitBatch RPC, giving the transactional guarantee with no buffering in the worker.
//
// On a typed conflict outcome the proxy reconstructs the exact SQLite error message the
// data-access conflict detectors (isIdempotencyKeyConflict) already match, so neither the
// detectors nor their callers need to change — the adapter is transparent.
export function firmDatabaseProxy(stub: DurableObjectStub<FirmDatabase>): ProxyBatchDatabase {
  function makeStatement(sql: string, bindings: readonly unknown[]): ProxySqlStatement {
    return {
      sql,
      bindings,
      bind: (...values: unknown[]) => makeStatement(sql, values),
      run: async () => ({ meta: { changes: (await stub.runWrite(sql, [...bindings])).changes } }),
      all: async <T>() => (await stub.runRead(sql, [...bindings])) as { results: T[] },
    };
  }

  return {
    prepare: (sql: string) => makeStatement(sql, []),

    batch: async (statements: ProxySqlStatement[]) => {
      const outcome = await stub.commitBatch(
        statements.map((s) => ({ sql: s.sql, bindings: [...s.bindings] })),
      );
      if (!outcome.ok) {
        // Reconstruct the SQLite UNIQUE constraint message so the data-access detectors'
        // message-based checks work unchanged. The "unique" arm is currently unreachable
        // (the DO only produces "idempotency_key" and re-throws everything else as a fault)
        // but is included so the type is fully handled.
        const column = outcome.conflict === "idempotency_key" ? "idempotency_key.key" : "unique";
        throw new Error(`UNIQUE constraint failed: ${column}`);
      }
      return statements.map(() => ({ success: true }));
    },
  };
}

// The minimal namespace shape this resolver needs: address-by-name and get-stub. `get` is typed to an
// opaque stub (not DurableObjectStub<FirmDatabase>) on purpose: matching a caller's
// DurableObjectNamespace<FirmDatabase> against a FirmDatabase-parameterized type forces TS to expand
// the cyclic Bindings ↔ FirmDatabase namespace type into the statement-module generics at every call
// site — the recursion TS reports as "excessively deep". The stub is narrowed to the proxy's required
// type inside, where the cycle is not re-entered.
interface FirmDatabaseNamespace {
  idFromName(name: string): DurableObjectId;
  get(id: DurableObjectId): unknown;
}

// Resolve a firm's per-firm database by firmId: address its FirmDatabase Durable Object by name and
// wrap the stub in the proxy. The explicit ProxyBatchDatabase return is the single annotated boundary.
// The firmId comes from a trusted source (the session, a control-plane row, or a firm-scoped job),
// never client input.
export function firmDatabaseFor(
  namespace: FirmDatabaseNamespace,
  firmId: string,
): ProxyBatchDatabase {
  const stub = namespace.get(namespace.idFromName(firmId)) as DurableObjectStub<FirmDatabase>;
  return firmDatabaseProxy(stub);
}

// Re-export so callers that need both the proxy and the conflict tester can import from one place.
export { isUniqueConflict };
