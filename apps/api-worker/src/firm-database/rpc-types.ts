export interface RpcStatement {
  readonly sql: string;
  readonly bindings: readonly unknown[];
}

// commitBatch returns a typed outcome rather than throwing across the RPC boundary, so conflict
// detection never depends on an error message surviving serialization. On a unique violation the
// outcome carries the qualified column list (everything after "UNIQUE constraint failed: ", e.g.
// "idempotency_key.key", "matter.matter_number", or a comma-joined list for a composite key); the
// proxy reconstructs the exact thrown message worker-side (firm-database-proxy.ts), so every
// data-access detector matches generically — no detector depends on which column conflicted.
export type CommitOutcome =
  | { readonly ok: true }
  | { readonly ok: false; readonly uniqueConstraint: string };

// Parses the qualified column list out of a SQLite UNIQUE constraint violation, or null if the error
// is not one. Runs DO-side, where the SQLite message text is reliable — never across RPC, where it
// might not survive serialization. The returned string is exactly what follows
// "UNIQUE constraint failed: " (e.g. "matter.matter_number"), which the proxy uses to rebuild the
// message the data-access detectors match.
export function uniqueConstraintColumns(error: unknown): string | null {
  if (!(error instanceof Error)) return null;
  const match = /UNIQUE constraint failed: (.+)/.exec(error.message);
  return match ? (match[1] ?? "").trim() : null;
}
