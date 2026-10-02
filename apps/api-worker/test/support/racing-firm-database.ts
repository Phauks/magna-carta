import { env } from "cloudflare:test";

// A firm database BINDING that fires a competing writer inside somebody else's request.
//
// WHY NOT `@magna-carta/data-access/interleave`. That harness wraps a `BatchDatabase` and hands the
// wrapped one to the operation under test — which is exactly right for a domain service a test calls
// directly, and is what packages/meetings' own race tests use. It cannot reach a route: a handler
// resolves its database at the chokepoint, from the `FIRM_DATABASE` binding, and builds the
// `BatchDatabase` itself. The only seam a test holds over a real request is therefore the binding,
// which is the same seam `scan-unreachable-engine-seam.test.ts` drives the unreachable engine
// through. So this wraps the namespace and intercepts the one RPC a batch commit becomes.
//
// The window it opens is the real one: a domain service reads its precondition in one round trip and
// commits in another, and the competing write lands between the two. Firing at a named point beats
// racing two requests — two promises interleave however the runtime happened to schedule them that
// run, which is a test that passes for reasons nobody chose.
//
// `interleaved` is the half that keeps this from passing vacuously. A competing writer that never
// ran leaves the test asserting the single-caller outcome under a concurrency test's name, so every
// caller asserts on it.

interface RpcStatement {
  readonly sql: string;
  readonly bindings: unknown[];
  readonly guard?: string;
}

export interface RacingFirmDatabase {
  /** The environment to hand `app.request`, identical to the one passed in but for the binding. */
  readonly environment: Record<string, unknown>;
  /** Whether the point was reached and the competing writer actually ran. */
  readonly interleaved: boolean;
}

/**
 * Wraps `environment`'s firm-database binding so `fire` runs immediately before the first batch
 * commit carrying `guard`.
 *
 * The guard label is the point: it names the statement whose precondition the test is racing, so the
 * writer cannot land inside some unrelated commit the same request happens to make first.
 */
export function racingFirmDatabase(
  environment: Record<string, unknown>,
  guard: string,
  fire: () => Promise<unknown>,
): RacingFirmDatabase {
  const namespace = env.FIRM_DATABASE;
  let fired = false;

  const wrapped = {
    idFromName: (name: string) => namespace.idFromName(name),
    get: (id: DurableObjectId) => {
      const stub = namespace.get(id);
      return {
        runRead: (sql: string, bindings: unknown[]) => stub.runRead(sql, bindings),
        runWrite: (sql: string, bindings: unknown[]) => stub.runWrite(sql, bindings),
        migrationState: () => stub.migrationState(),
        commitBatch: async (statements: RpcStatement[]) => {
          if (!fired && statements.some((statement) => statement.guard === guard)) {
            fired = true;
            await fire();
          }
          return await stub.commitBatch(statements);
        },
      };
    },
  };

  return {
    environment: { ...environment, FIRM_DATABASE: wrapped },
    get interleaved() {
      return fired;
    },
  };
}
