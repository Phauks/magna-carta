// The database shape this package writes through: the control-plane D1 binding satisfies it, and so
// does the node:sqlite adapter the tests use. Declared here rather than imported from the firm-scoped
// data-access layer, because this package may not depend on that layer at all — the board is the
// one place in the platform where people at many firms read and write the same rows, and keeping it
// unable to reach a firm's own database is what keeps it from ever showing one.

export interface SqlStatement {
  bind(...values: unknown[]): SqlStatement;
  run(): Promise<{ meta: { changes: number } }>;
  all<T = Record<string, unknown>>(): Promise<{ results: T[] }>;
}

export interface SqlDatabase {
  prepare(sql: string): SqlStatement;
  // One transaction, all or nothing, statements in order — D1's batch semantics.
  batch(statements: SqlStatement[]): Promise<unknown>;
}
