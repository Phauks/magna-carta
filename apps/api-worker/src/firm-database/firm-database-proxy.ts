import type { SqlStatement } from "@magna-carta/data-access/idempotency-statements";
import type { FirmDatabase } from "./firm-database-object.ts";

// The minimal SQL-statement shape the statement modules and effect-batch build against.
// Mirrors SqlDatabase / SqlStatement from @magna-carta/data-access/idempotency-statements —
// satisfied here without importing D1Database.
export interface ProxySqlStatement {
  readonly sql: string;
  readonly bindings: readonly unknown[];
  bind(...values: unknown[]): ProxySqlStatement;
  run(): Promise<{ meta: { changes: number } }>;
  all<T = Record<string, unknown>>(): Promise<{ results: T[] }>;
  // D1-parity convenience: the first row, or null when the read returns none. The statement modules
  // only ever call run()/all() (the SqlStatement contract has no first()); first() exists for direct
  // callers — tests and ad-hoc reads — so a single-row lookup need not destructure results[0].
  first<T = Record<string, unknown>>(): Promise<T | null>;
}

// The full BatchDatabase shape that commitEffectBatch drives: a SqlDatabase (prepare) plus
// an atomic batch (batch). Every write that goes through commitEffectBatch reaches the DO as
// one commitBatch RPC, so effects are atomic — the batch either fully commits or fully rolls back.
//
// `batch` accepts the PORT's statement type, not this module's richer one. prepare() returning the
// richer ProxySqlStatement is a promise this proxy keeps; batch() demanding it would be a promise it
// asks of its callers, and the port it stands in for (BatchDatabase in
// packages/data-access/src/effect-batch.ts) only ever promises them a SqlStatement — which declares
// `sql` optional and no `bindings` at all, because a statement module hands back the port type and
// throws the extra members away. Narrowing an input like that does not fail to compile: TypeScript
// compares method parameters bivariantly, so the mismatch stays invisible at every call through the
// port and surfaces only on a direct call. Taking the port shape here is what makes the substitution
// actually sound rather than merely accepted.
export interface ProxyBatchDatabase {
  prepare(sql: string): ProxySqlStatement;
  batch(statements: readonly SqlStatement[]): Promise<{ success: boolean }[]>;
}

export interface FirmDatabaseMigrationState {
  /** Why the lineage could not be applied, or null when it was. */
  readonly fault: string | null;
  readonly appliedCount: number;
  readonly appliedHead: string | null;
  /**
   * The instant before the last migration batch, as a bookmark Cloudflare can restore this object
   * to. Null when nothing has been applied since restore points began, or when the bookmark could
   * not be taken. The lineage runs only forwards, so this is the only undo a wrong-but-successful
   * migration has.
   */
  readonly restorePoint: {
    readonly bookmark: string;
    readonly takenAt: string;
    readonly appliedTags: string[];
  } | null;
}

// Every statement in a batch has to reach the Durable Object as a `sql` + `bindings` pair, and the
// port type guarantees neither. In practice each one was built by this proxy's own prepare()/bind(),
// which carries both — so this checks that rather than assuming it. A statement prepared against some
// other database cannot be committed into a firm's Durable Object at all, and saying so by name beats
// spreading `undefined` into an RPC argument and reading the failure downstream.
function isProxyStatement(statement: SqlStatement): statement is SqlStatement & ProxySqlStatement {
  return (
    typeof statement.sql === "string" &&
    Array.isArray((statement as { readonly bindings?: unknown }).bindings)
  );
}

// A Durable Object RPC can fail for reasons that are the platform's, not the statement's: the
// object was reset (every deploy resets every live object — and main deploys on every merge), the
// isolate was evicted, or the connection dropped. The runtime marks exactly those failures
// `retryable: true`; an object refusing load carries `overloaded: true` as well, and re-sending
// into an overload only deepens it. Anything else (a SQL error, a thrown migration) is
// deterministic and must surface immediately.
function isTransientRpcFailure(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const flags = error as { readonly retryable?: unknown; readonly overloaded?: unknown };
  return flags.retryable === true && flags.overloaded !== true;
}

// Waits before each re-send: the first is immediate (the object re-instantiates on the very next
// call after a reset), the second gives a wobbling isolate a beat. Two retries, then the failure is
// real and surfaces with its Error ID — a read that cannot land in three attempts is an outage, not
// a blip, and hiding it behind more attempts would only stretch the request past its own timeout.
const TRANSIENT_READ_RETRY_DELAYS_MILLISECONDS: readonly number[] = [0, 150];

// Builds a worker-side BatchDatabase that marshals every operation to the firm's FirmDatabase
// Durable Object over RPC. Individual run()/all() calls are one-RPC reads or writes; a batch()
// is one commitBatch RPC, giving the transactional guarantee with no buffering in the worker.
//
// READS RETRY THROUGH A TRANSIENT FAILURE; WRITES NEVER DO. A SELECT re-sent after a reset answers
// the same question and is safe to repeat, and without the retry every deploy hands whoever is
// mid-request an Error ID for a failure the next attempt would clear. A write re-sent blind could
// commit twice — a retryable failure does not promise the first send never executed — so a write
// failure propagates and the idempotency machinery above (every mutation rides an Idempotency-Key)
// is what makes the CALLER's retry safe.
//
// The retry takes a stub FACTORY, not a stub: an RPC stub whose connection broke stays broken — every
// later call on it fails with the same error — so each attempt must address the namespace afresh.
//
// On a typed conflict outcome the proxy reconstructs the exact SQLite error message the
// data-access conflict detectors (isIdempotencyKeyConflict, isMatterNumberConflict, …) already
// match, from the column list the outcome carries — so neither the detectors nor their callers need
// to change, and detection works for every unique constraint, not just one. The adapter is transparent.
// Module-internal: callers resolve a firm database through firmDatabaseFor (below), the one annotated
// boundary — the proxy is never wrapped around a stub from outside this module.
function firmDatabaseProxy(freshStub: () => DurableObjectStub<FirmDatabase>): ProxyBatchDatabase {
  let stub = freshStub();

  async function readWithTransientRetry<T>(
    read: (target: DurableObjectStub<FirmDatabase>) => Promise<T>,
  ): Promise<T> {
    let attempt = 0;
    for (;;) {
      try {
        return await read(stub);
      } catch (error) {
        const delay = TRANSIENT_READ_RETRY_DELAYS_MILLISECONDS[attempt];
        if (delay === undefined || !isTransientRpcFailure(error)) throw error;
        attempt += 1;
        if (delay > 0) await new Promise((resolve) => setTimeout(resolve, delay));
        stub = freshStub();
      }
    }
  }

  function makeStatement(sql: string, bindings: readonly unknown[]): ProxySqlStatement {
    return {
      sql,
      bindings,
      bind: (...values: unknown[]) => makeStatement(sql, values),
      run: async () => ({ meta: { changes: (await stub.runWrite(sql, [...bindings])).changes } }),
      all: async <T>() =>
        await readWithTransientRetry(
          (target) => target.runRead(sql, [...bindings]) as unknown as Promise<{ results: T[] }>,
        ),
      first: async <T>() => {
        const { results } = await readWithTransientRetry(
          (target) => target.runRead(sql, [...bindings]) as unknown as Promise<{ results: T[] }>,
        );
        return results[0] ?? null;
      },
    };
  }

  return {
    prepare: (sql: string) => makeStatement(sql, []),

    batch: async (statements: readonly SqlStatement[]) => {
      const outcome = await stub.commitBatch(
        statements.map((statement) => {
          if (!isProxyStatement(statement)) {
            throw new TypeError(
              "firmDatabaseFor: batch() accepts only statements prepared against this firm database — " +
                "one carrying no sql/bindings was prepared elsewhere and cannot commit into this firm's Durable Object.",
            );
          }
          return { sql: statement.sql, bindings: [...statement.bindings] };
        }),
      );
      if (!outcome.ok) {
        // Reconstruct the SQLite UNIQUE constraint message from the column list the DO parsed, so the
        // data-access detectors' message-based checks (each an .includes on its own column) work
        // unchanged — for every unique constraint, not just one.
        throw new Error(`UNIQUE constraint failed: ${outcome.uniqueConstraint}`);
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
  // A jurisdiction-constrained view of the same namespace (Cloudflare Durable Object jurisdictions:
  // "eu", "fedramp"). Present on the real binding; optional here so tests can omit it.
  jurisdiction?(jurisdiction: "eu" | "fedramp"): FirmDatabaseNamespace;
}

// Resolve a firm's per-firm database by firmId: address its FirmDatabase Durable Object by name and
// wrap the stub in the proxy. The explicit ProxyBatchDatabase return is the single annotated boundary.
// The firmId comes from a trusted source (the session, a control-plane row, or a firm-scoped job),
// never client input.
//
// Residency activation seam: when the first eu-region firm is provisioned, resolve the firm's
// data_region at the tenancy chokepoint and pass jurisdictionForRegion(region) here so every
// statement addresses the firm's DO under its jurisdiction. Until then all firms are us (bare id).
/**
 * What the lineage did for one firm, and what stopped it.
 *
 * Resolved separately from the statement proxy above rather than hung off it. Every statement the
 * proxy carries is refused while a migration is stuck — that is the point of the gate — so a
 * diagnostic asked through `prepare` would go dark exactly when it is wanted. It is also not a
 * statement, and the port that statements travel on is implemented by a great many test doubles that
 * have no business answering questions about migrations.
 */
export function firmDatabaseMigrationStateFor(
  namespace: FirmDatabaseNamespace,
  firmId: string,
  jurisdiction?: "eu" | "fedramp",
): Promise<FirmDatabaseMigrationState> {
  const resolver =
    jurisdiction !== undefined && namespace.jurisdiction !== undefined
      ? namespace.jurisdiction(jurisdiction)
      : namespace;
  const stub = resolver.get(resolver.idFromName(firmId)) as DurableObjectStub<FirmDatabase>;
  return stub.migrationState();
}

export function firmDatabaseFor(
  namespace: FirmDatabaseNamespace,
  firmId: string,
  jurisdiction?: "eu" | "fedramp",
): ProxyBatchDatabase {
  // A jurisdiction-bound id differs from the bare id, so a firm must always be addressed under the
  // same jurisdiction it was provisioned in — never mix the two for one firm.
  const resolver =
    jurisdiction !== undefined && namespace.jurisdiction !== undefined
      ? namespace.jurisdiction(jurisdiction)
      : namespace;
  return firmDatabaseProxy(
    () => resolver.get(resolver.idFromName(firmId)) as DurableObjectStub<FirmDatabase>,
  );
}
