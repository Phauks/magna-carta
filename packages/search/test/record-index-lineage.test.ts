// @repo-wide-fitness scope=schema — the declarations are here, but the tables they name and the
// migrations that carry their triggers are in packages/database, so the diff that rebuilds a source
// table (and drops its triggers with it) never touches this package.
import { createMigratedNodeDatabase } from "@magna-carta/database/node-sqlite";
import { recordTextEntry } from "@magna-carta/database/per-firm-schema";
import { PROTECTED_COLUMNS } from "@magna-carta/database/protected-columns";
import { getTableConfig } from "drizzle-orm/sqlite-core";
import { describe, expect, it } from "vitest";
import {
  RECORD_TEXT_ENTRY_TABLE,
  RECORD_TEXT_FTS_DEFINITION,
  RECORD_TEXT_FTS_TABLE,
  recordIndexTriggerNames,
  recordIndexTriggers,
} from "../src/record-index-schema.ts";
import { recordIndexSources, type RecordIndexSource } from "../src/record-index-sources.ts";

// THE DECLARED SOURCES AND THE DATABASE A FIRM ACTUALLY HAS, HELD TOGETHER.
//
// The triggers are the index's only write path and they live in migrations, which are immutable
// text. The declarations they were rendered from live here and are ordinary code. Nothing but this
// file notices when the two part: a source edited after its migration shipped, a source added with
// no migration at all, or a later migration that rebuilds an indexed table — which drops the table
// and every trigger on it, silently, leaving a source that is declared searchable and has stopped
// being indexed.
//
// So the whole lineage is applied to a fresh database and what it holds is compared, object for
// object, with what the declarations render today.

const { raw } = createMigratedNodeDatabase("per-firm");

function liveSql(type: "trigger" | "table", name: string): string | undefined {
  const row = raw
    .prepare("SELECT sql FROM sqlite_master WHERE type = ? AND name = ?")
    .get(type, name) as { sql: string } | undefined;
  return row?.sql;
}

function liveColumns(table: string): Set<string> {
  const rows = raw.prepare(`PRAGMA table_info(\`${table}\`)`).all() as { name: string }[];
  return new Set(rows.map((row) => row.name));
}

// SQLite keeps a statement as it was written, less the terminator.
function asStored(statement: string): string {
  return statement.replace(/;$/u, "");
}

function expressionsOf(source: RecordIndexSource): string {
  return [
    source.matterExpression,
    source.sortExpression,
    source.titleExpression,
    source.bodyExpression,
    source.includeWhen ?? "",
  ].join(" ");
}

describe("the record index a migrated firm database holds", () => {
  it("carries exactly the triggers the declared sources render, word for word", () => {
    const expected = new Map<string, string>();
    for (const source of recordIndexSources) {
      const names = recordIndexTriggerNames(source);
      recordIndexTriggers(source).forEach((statement, index) => {
        expected.set(names[index]!, asStored(statement));
      });
    }
    const live = raw
      .prepare(
        "SELECT name, sql FROM sqlite_master WHERE type = 'trigger' AND name LIKE 'record_text_%'",
      )
      .all() as { name: string; sql: string }[];

    expect(live.map((row) => row.name).toSorted()).toEqual([...expected.keys()].toSorted());
    for (const row of live) {
      // A difference here is fixed by a NEW migration that drops and recreates the trigger from
      // `node packages/search/scripts/render-record-index-migration.mts <source key>` — never by
      // editing the migration that shipped it.
      expect(row.sql, `trigger ${row.name}`).toBe(expected.get(row.name));
    }
  });

  it("carries the full-text table as this package defines it", () => {
    expect(liveSql("table", RECORD_TEXT_FTS_TABLE)).toBe(asStored(RECORD_TEXT_FTS_DEFINITION));
  });

  it("names the entry table as the schema declares it, with the columns the statements write", () => {
    const declared = getTableConfig(recordTextEntry);
    expect(declared.name).toBe(RECORD_TEXT_ENTRY_TABLE);
    expect(declared.columns.map((column) => column.name).toSorted()).toEqual([
      "container_id",
      "id",
      "matter_id",
      "record_id",
      "sort_key",
      "source",
    ]);
  });
});

describe("every declared record index source", () => {
  it.each(recordIndexSources.map((source) => [source.key, source] as const))(
    "%s names a table and columns that exist",
    (_key, source) => {
      const columns = liveColumns(source.table);
      expect(columns.size, `table ${source.table}`).toBeGreaterThan(0);
      expect(columns.has("id")).toBe(true);
      for (const column of source.reindexOn) {
        expect(columns.has(column), `${source.table}.${column}`).toBe(true);
      }
      if (source.container !== null) {
        expect(columns.has(source.container.foreignKey)).toBe(true);
        const containerColumns = liveColumns(source.container.table);
        expect(containerColumns.has("id")).toBe(true);
        for (const column of source.container.reindexOn) {
          expect(containerColumns.has(column), `${source.container.table}.${column}`).toBe(true);
        }
      }
    },
  );

  // A column a source reads but does not re-index on is a column whose change leaves stale words in
  // the index. Every `table.column` an expression mentions must be watched on the table it is on.
  it.each(recordIndexSources.map((source) => [source.key, source] as const))(
    "%s re-indexes on every column it reads",
    (_key, source) => {
      const watched = new Map<string, readonly string[]>([[source.table, source.reindexOn]]);
      if (source.container !== null) {
        watched.set(source.container.table, source.container.reindexOn);
      }
      for (const [, table, column] of expressionsOf(source).matchAll(
        /\b([a-z_]+)\.([a-z_]+)\b/gu,
      )) {
        expect(
          watched.has(table!),
          `${source.key} reads ${table!}, which it does not declare`,
        ).toBe(true);
        // The row's own creation instant never changes, so it needs no watching.
        if (column === "created_at") continue;
        expect(watched.get(table!), `${source.key} reads ${table!}.${column!}`).toContain(column);
      }
    },
  );

  it("reads no protected column and no review-set table", () => {
    for (const source of recordIndexSources) {
      const tables = [source.table, source.container?.table].filter(
        (table): table is string => table !== undefined,
      );
      for (const table of tables) {
        // Material an opposing party produced is searched only from inside its own review set.
        expect(table.startsWith("review_"), `${source.key} reads ${table}`).toBe(false);
      }
      for (const protectedColumn of PROTECTED_COLUMNS) {
        // An index over an encrypted column would confirm a value to someone who cannot read it.
        expect(
          expressionsOf(source).includes(`${protectedColumn.table}.${protectedColumn.column}`),
          `${source.key} reads ${protectedColumn.table}.${protectedColumn.column}`,
        ).toBe(false);
      }
    }
  });
});
