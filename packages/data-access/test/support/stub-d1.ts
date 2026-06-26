// Scriptable D1 stub for the data-access tests. Mirrors the surface the package uses
// (prepare/bind/run/all/batch) and real D1 semantics where they matter:
// - batch() is all-or-nothing (a scripted failure records nothing)
// - all() answers from scripted results matched by SQL substring (first match wins)
export interface ExecutedStatement {
  readonly sql: string;
  readonly bindings: readonly unknown[];
}

export interface StubD1 {
  readonly database: {
    prepare(sql: string): StubStatement;
    batch(statements: StubStatement[]): Promise<{ success: boolean }[]>;
  };
  readonly executed: ExecutedStatement[];
  readonly batches: ExecutedStatement[][];
  /** Script the results all() returns for any statement whose SQL contains `sqlSubstring`. */
  onAll(sqlSubstring: string, results: unknown[] | (() => unknown[])): void;
  /** Script the meta.changes run() reports for any statement whose SQL contains `sqlSubstring`. */
  onRunChanges(sqlSubstring: string, changes: number): void;
  /** Make the next batch containing a matching SQL fail (whole batch records nothing). */
  failBatchWith(error: Error, sqlSubstring?: string): void;
}

export interface StubStatement {
  readonly sql: string;
  readonly bindings: readonly unknown[];
  bind(...values: unknown[]): StubStatement;
  run(): Promise<{ success: boolean; meta: { changes: number } }>;
  all<T>(): Promise<{ results: T[]; success: boolean }>;
  first<T>(): Promise<T | null>;
}

// Narrow a builder-returned statement (typed as the package's minimal SqlStatement) back to the
// stub's richer shape so tests can read the captured sql/bindings.
export function captured(statement: unknown): StubStatement {
  return statement as StubStatement;
}

export function stubD1(): StubD1 {
  const executed: ExecutedStatement[] = [];
  const batches: ExecutedStatement[][] = [];
  const scriptedResults: { match: string; results: unknown[] | (() => unknown[]) }[] = [];
  const scriptedChanges: { match: string; changes: number }[] = [];
  let pendingBatchFailure: { error: Error; match: string | undefined } | undefined;

  function makeStatement(sql: string, bindings: unknown[] = []): StubStatement {
    return {
      sql,
      bindings,
      bind: (...values: unknown[]) => makeStatement(sql, values),
      run: () => {
        executed.push({ sql, bindings });
        const scripted = scriptedChanges.find((entry) => sql.includes(entry.match));
        return Promise.resolve({ success: true, meta: { changes: scripted?.changes ?? 1 } });
      },
      all: <T>() => {
        executed.push({ sql, bindings });
        const scripted = scriptedResults.find((entry) => sql.includes(entry.match));
        const results =
          typeof scripted?.results === "function" ? scripted.results() : (scripted?.results ?? []);
        return Promise.resolve({ results: results as T[], success: true });
      },
      first: <T>() => {
        executed.push({ sql, bindings });
        const scripted = scriptedResults.find((entry) => sql.includes(entry.match));
        const results =
          typeof scripted?.results === "function" ? scripted.results() : (scripted?.results ?? []);
        return Promise.resolve(results.length > 0 ? (results[0] as T) : null);
      },
    };
  }

  return {
    database: {
      prepare: (sql: string) => makeStatement(sql),
      batch: (statements: StubStatement[]) => {
        const failure = pendingBatchFailure;
        if (
          failure &&
          (failure.match === undefined ||
            statements.some((statement) => statement.sql.includes(failure.match as string)))
        ) {
          pendingBatchFailure = undefined;
          return Promise.reject(failure.error); // all-or-nothing: nothing recorded
        }
        const entries = statements.map((statement) => ({
          sql: statement.sql,
          bindings: statement.bindings,
        }));
        batches.push(entries);
        executed.push(...entries);
        return Promise.resolve(statements.map(() => ({ success: true })));
      },
    },
    executed,
    batches,
    onAll: (match, results) => {
      scriptedResults.push({ match, results });
    },
    onRunChanges: (match, changes) => {
      scriptedChanges.push({ match, changes });
    },
    failBatchWith: (error, match) => {
      pendingBatchFailure = { error, match };
    },
  };
}
