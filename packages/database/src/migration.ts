// A migration as plain data — the runtime shape. Workers have no filesystem, so the generated SQL is
// imported as raw text by the consumer (Vite `?raw` / wrangler Text rule) and assembled here; this
// module never touches the filesystem itself.
export interface Migration {
  readonly tag: string;
  readonly statements: readonly string[];
}

// The drizzle-kit 0.31.x journal shape (out/meta/_journal.json). The 1.0 line drops the journal for
// per-migration snapshot folders — adopting it changes only this file and the loader below.
export interface MigrationJournalEntry {
  readonly idx: number;
  readonly version: string;
  readonly when: number;
  readonly tag: string;
  readonly breakpoints: boolean;
}

export interface MigrationJournal {
  readonly version: string;
  readonly dialect: string;
  readonly entries: readonly MigrationJournalEntry[];
}

// drizzle-kit separates statements with this literal line; D1 prepared statements are single-statement,
// so the runner needs them split.
const STATEMENT_BREAKPOINT = "--> statement-breakpoint";

export function splitSqlStatements(sql: string): string[] {
  return sql
    .split(STATEMENT_BREAKPOINT)
    .map((statement) => statement.trim())
    .filter((statement) => statement.length > 0);
}

// Assemble the ordered migration list from the generated journal plus a map of tag -> raw SQL text.
export function migrationsFromJournal(
  journal: MigrationJournal,
  sqlByTag: Record<string, string>,
): Migration[] {
  return [...journal.entries]
    .sort((a, b) => a.idx - b.idx)
    .map((entry) => {
      const sql = sqlByTag[entry.tag];
      if (sql === undefined) {
        throw new Error(`migration "${entry.tag}" is in the journal but its SQL was not provided`);
      }
      return { tag: entry.tag, statements: splitSqlStatements(sql) };
    });
}
