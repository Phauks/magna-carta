export interface RpcStatement {
  readonly sql: string;
  readonly bindings: readonly unknown[];
}

// commitBatch returns a typed outcome rather than throwing across the RPC boundary, so conflict
// detection never depends on an error message surviving serialization. The proxy reconstructs the
// thrown shape worker-side (firm-database-proxy.ts).
export type CommitOutcome = { ok: true } | { ok: false; conflict: "idempotency_key" | "unique" };

// Determines whether a caught error is a UNIQUE constraint violation on a specific column (given
// as "table.column"). Used by FirmDatabase.commitBatch to translate the idempotency_key conflict
// into the typed CommitOutcome before the result crosses the RPC boundary.
export function isUniqueConflict(error: unknown, qualifiedColumn: string): boolean {
  return (
    error instanceof Error &&
    error.message.includes("UNIQUE constraint failed") &&
    error.message.includes(qualifiedColumn)
  );
}
