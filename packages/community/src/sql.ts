// The minimal SQL surface this package's statement builders need, declared HERE rather than
// imported from the firm-scoped data-access layer.
//
// The duplication is the point, and it is about ten lines. Every other domain package in this
// repository reaches its database through `@magna-carta/data-access`, which exists to bind a query
// to exactly one firm. This package must never do that: the board is cross-firm by construction, so
// the firm-scoped layer's guarantees do not apply to it and depending on that layer would make the
// board look, to any future reader and to any dependency scan, like one more firm-scoped consumer.
// It is not, and test/purity.test.ts fails the build if it ever becomes one.
//
// The shape is structurally satisfied by D1Database, by a D1DatabaseSession, and by the node:sqlite
// adapter the tests run against — the same three implementations the rest of the repository uses.
export interface SqlDatabase {
  prepare(sql: string): SqlStatement;
}

export interface SqlStatement {
  readonly sql?: string;
  bind(...values: unknown[]): SqlStatement;
  // meta.changes is the affected-row count. A guarded UPDATE branches on it: zero rows changed is
  // not an error in SQLite, so a caller that needs to know whether its update won has to look.
  run(): Promise<{ meta: { changes: number } }>;
  all<T = Record<string, unknown>>(): Promise<{ results: T[] }>;
  first<T = Record<string, unknown>>(): Promise<T | null>;
}

// A database that can run several statements as one all-or-nothing unit. Every write on this board
// that touches more than one row uses it — a vote is a row plus two counters, and a hide is a
// visibility flip plus a moderation record. Half of either is worse than neither.
export interface BatchSqlDatabase extends SqlDatabase {
  batch(statements: SqlStatement[]): Promise<unknown>;
}

// A clock, injected rather than read from the ambient environment so a test can pin an instant and
// so every row written in one request shares one timestamp.
export interface Clock {
  now(): string; // ISO-8601 instant
}
