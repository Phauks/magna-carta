import { env } from "cloudflare:test";
import type { FirmId } from "@magna-carta/identifiers/types";
import {
  firmDatabaseFor,
  type ProxyBatchDatabase,
} from "../../src/firm-database/firm-database-proxy.ts";

// A test-side handle on a firm's per-firm database: the FirmDatabase Durable Object addressed by
// firmId (the production data-plane target), wrapped with a `.first()` convenience the DO proxy does
// not provide. The proxy mirrors the SqlDatabase the statement modules use (prepare/run/all/batch),
// so seeding and assertions read through the SAME store the worker resolves at request time — there
// is no separate per-firm D1 to migrate, the DO self-migrates on first access. The wrapper carries
// sql/bindings forward so a wrapped statement still flows correctly through commitEffectBatch's
// batch() (which reads s.sql/s.bindings off each statement).
type ProxyStatement = ReturnType<ProxyBatchDatabase["prepare"]>;

export interface FirstStatement {
  readonly sql: string;
  readonly bindings: readonly unknown[];
  bind(...values: unknown[]): FirstStatement;
  run(): Promise<{ meta: { changes: number } }>;
  all<T = Record<string, unknown>>(): Promise<{ results: T[] }>;
  first<T = Record<string, unknown>>(): Promise<T | null>;
}

export interface FirmDatabaseHandle {
  prepare(sql: string): FirstStatement;
  batch: ProxyBatchDatabase["batch"];
  // Carried from the proxy rather than declared here: this handle IS the Durable Object, so it
  // enforces a guarded write exactly as a request does. Asserting it locally would let the two drift.
  readonly enforcesGuardedWrites: ProxyBatchDatabase["enforcesGuardedWrites"];
}

export function firmDatabaseHandle(firmId: FirmId): FirmDatabaseHandle {
  const proxy = firmDatabaseFor(env.FIRM_DATABASE, firmId);
  const wrap = (statement: ProxyStatement): FirstStatement => ({
    sql: statement.sql,
    bindings: statement.bindings,
    bind: (...values: unknown[]) => wrap(statement.bind(...values)),
    run: () => statement.run(),
    all: <T>() => statement.all<T>(),
    first: async <T>() => ((await statement.all<T>()).results[0] ?? null) as T | null,
  });
  return {
    prepare: (sql: string) => wrap(proxy.prepare(sql)),
    batch: proxy.batch.bind(proxy),
    enforcesGuardedWrites: proxy.enforcesGuardedWrites,
  };
}
