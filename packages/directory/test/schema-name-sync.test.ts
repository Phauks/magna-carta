// @repo-wide-fitness scope=schema — the statements are here, the tables they name are in
// packages/database, so the diff that renames one never touches this package.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { getTableConfig, type SQLiteTable } from "drizzle-orm/sqlite-core";
import {
  auditLog,
  customFieldValue,
  directoryAddress,
  directoryCategory,
  directoryEdge,
  directoryEmail,
  directoryEntityCategory,
  directoryEntityPhoto,
  directoryIdentifier,
  directoryName,
  directoryNamePhoneticCode,
  directoryOrganization,
  directoryPartyRole,
  directoryPerson,
  directoryPhone,
  entityMerge,
  matter,
  matterParty,
  nicknameEquivalence,
} from "@magna-carta/database/per-firm-schema";
import { describe, expect, it } from "vitest";
import {
  DIRECTORY_IDENTIFIER_TABLE,
  DIRECTORY_NAME_PHONETIC_CODE_TABLE,
  DIRECTORY_NAME_TABLE,
  DIRECTORY_ORGANIZATION_TABLE,
  DIRECTORY_PERSON_TABLE,
} from "../src/statements.ts";
import { DIRECTORY_ENTITY_PHOTO_TABLE } from "../src/entity-photo.ts";

// Fitness function (the ledger/data-access source-scan pattern): every SQL identifier the directory
// package hand-writes must track @magna-carta/database's schema — the single source of truth. The
// directory's SQL is spread across statement builders (statements.ts) AND inline queries inside the
// service modules (merge.ts, search.ts, edges.ts, categories.ts, party.ts, entity-kind.ts,
// identifiers.ts), so rather than enumerate every builder, this scan reads every
// .prepare(`…`) SQL string from the package source and asserts each bare identifier it names is either
// a known table, a column of a directory table, or a sanctioned non-schema token (a SQL keyword/
// function, a table alias, the FTS5 virtual table, or a pseudo-column). Renaming a table or column in
// the schema fails here, not in production.

const DIRECTORY_SRC = join(import.meta.dirname, "..", "src");

// The drizzle tables the directory SQL touches, by their canonical names. matter rides along
// (the party reads join it); auditLog rides along (the audit
// statement helpers are imported, but their column names appear in no directory-authored SQL string —
// included defensively so a future inline audit query stays pinned).
const TOUCHED_TABLES: readonly SQLiteTable[] = [
  directoryPerson,
  directoryOrganization,
  directoryName,
  directoryNamePhoneticCode,
  nicknameEquivalence,
  directoryIdentifier,
  directoryEdge,
  directoryCategory,
  directoryEntityCategory,
  directoryPartyRole,
  directoryEmail,
  directoryPhone,
  directoryAddress,
  matterParty,
  entityMerge,
  matter,
  auditLog,
  // Contact-email write path + reverse address->entity lookup (contact-email.ts) hand-writes SQL over
  // directory_email, so its name and columns must track the schema here.
  directoryEmail,
  // The merge engine repoints custom-field reference values (value_reference_id) and absorbs owned
  // values to history (target_row_id), and the fitness probe scans both — so this table's name and
  // columns are now hand-written in directory SQL and must track the schema.
  customFieldValue,
  // A record's picture (entity-photo.ts): the row naming the object that holds the bytes.
  directoryEntityPhoto,
];

const tableNames = new Set(TOUCHED_TABLES.map((table) => getTableConfig(table).name));
const columnNames = new Set(
  TOUCHED_TABLES.flatMap((table) => getTableConfig(table).columns.map((column) => column.name)),
);

// SQL keywords/functions the extractor hits (all written lowercase in the directory SQL builders),
// plus baked status/role literals, table aliases the inline joins introduce, the FTS5 virtual table
// and its MATCH/bm25 surface, and SQLite pseudo-columns. None is a schema column.
const SANCTIONED_NON_SCHEMA = new Set<string>([
  // keywords
  "select",
  "distinct",
  "as",
  "from",
  "join",
  "left",
  "inner",
  "on",
  "where",
  "and",
  "or",
  "not",
  "is",
  "null",
  "insert",
  "into",
  "values",
  "update",
  "set",
  "delete",
  "order",
  "by",
  "asc",
  "desc",
  "limit",
  "in",
  "exists",
  "case",
  // Projection aliases — names that exist only on the wire, never in the schema. A display read that
  // resolves a party's entity name has to call the two joined columns something, and the something it
  // calls them is not a column of any table. They are listed rather than pattern-matched, because a
  // rule like "anything ending _display_name" would wave through a genuine typo in a real column.
  "person_display_name",
  "organization_display_name",
  // The same, for the read that answers which matters an entity is a party to: the matter's own
  // title and status are joined in beside the role, and both need a name that says whose they are.
  "matter_title",
  "matter_status",
  "when",
  "then",
  "else",
  "end",
  // functions
  "coalesce",
  "count",
  "max",
  "min",
  "length",
  "trim",
  "bm25",
  "match",
  // baked literals in the SQL (statuses, roles, schemes, kinds)
  "active",
  "merged_into",
  "client",
  "person",
  "organization",
  "current",
  "former",
  "both",
  "double_metaphone_primary",
  "double_metaphone_secondary",
  // identifier-type literal baked into the directory-measurements probe shape (none here) and ssn etc.
  "ssn",
  // table aliases used in inline joins (search.ts, categories.ts, merge.ts)
  "dn",
  "dp",
  "do",
  "pc",
  "ec",
  "c",
  "e",
  "n",
  "o",
  "p",
  // self-join aliases for the conflicts blind-index channel (identifiers.ts): the subject entity's
  // sealed identifiers matched against every other entity's on the same directory_identifier table.
  "subject",
  "other",
  // output-column aliases (SELECT … AS row / AS edge_id) — not schema columns, just result labels
  "row",
  "edge_id",
  // the set-valued blind-index self-join projects the SUBJECT side under its own label, so a hit
  // shared across many subjects in one read still names whose identifier matched it
  "subject_id",
  // output-column aliases the derived-matching-data probes and the backfill sweep label their
  // computed columns with (SELECT CASE … AS needs_match_keys, the two COUNT subqueries)
  "match_key",
  // the backfill sweep labels its outstanding-row count
  "pending",
  // the nickname catalogue existence probe labels its constant 1 so a caller reads a row, not a column
  "present",
  // the entity index labels the name it sorts on, and the size of the whole record beside the page.
  // Both exist only on the wire: neither person nor organization has a sort_name column, and the
  // total is a COUNT over the union rather than anything stored.
  "sort_name",
  "total",
  // FTS5 virtual table + content link pseudo-column
  "directory_name_fts",
  "rowid",
]);

// Pull every SQL string from a .prepare(`…`) call. The directory builders always pass the SQL as the
// first (and only) template-literal argument to prepare; this captures the backtick body. ${…}
// interpolations are stripped: a few queries build the table/column name dynamically from a sanctioned
// constant map (NODE_TABLE, REPOINT_TARGETS, INBOUND_REFERENCE_PROBES) — those runtime values are
// validated separately (see "dynamic table/column constants" below), not as static SQL text.
function extractPreparedSql(source: string): string[] {
  const sql: string[] = [];
  const pattern = /\.prepare\(\s*`([\s\S]*?)`/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(source)) !== null) {
    sql.push((match[1] ?? "").replace(/\$\{[^}]*\}/g, " "));
  }
  return sql;
}

// Bare lowercase identifiers in a SQL string, with single-quoted string literals stripped first so a
// baked value never reads as an identifier. Parameter placeholders (?1) carry no letters and drop out.
function identifiers(sql: string): string[] {
  return sql.replace(/'(?:[^']|'')*'/g, " ").match(/\b[a-z_][a-z0-9_]*\b/g) ?? [];
}

function listSourceFiles(directory: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(directory)) {
    const absolute = join(directory, entry);
    if (statSync(absolute).isDirectory()) {
      if (entry === "test") continue;
      found.push(...listSourceFiles(absolute));
      continue;
    }
    if (entry.endsWith(".test.ts")) continue;
    if (entry.endsWith(".ts")) found.push(absolute);
  }
  return found;
}

describe("schema name sync (directory SQL pinned to @magna-carta/database)", () => {
  it("the table-name constants match the drizzle schema", () => {
    expect(DIRECTORY_PERSON_TABLE).toBe(getTableConfig(directoryPerson).name);
    expect(DIRECTORY_ORGANIZATION_TABLE).toBe(getTableConfig(directoryOrganization).name);
    expect(DIRECTORY_NAME_TABLE).toBe(getTableConfig(directoryName).name);
    expect(DIRECTORY_NAME_PHONETIC_CODE_TABLE).toBe(getTableConfig(directoryNamePhoneticCode).name);
    expect(DIRECTORY_IDENTIFIER_TABLE).toBe(getTableConfig(directoryIdentifier).name);
    expect(DIRECTORY_ENTITY_PHOTO_TABLE).toBe(getTableConfig(directoryEntityPhoto).name);
  });

  it("the scan found prepared SQL across the package (non-vacuity floor)", () => {
    const allSql = listSourceFiles(DIRECTORY_SRC).flatMap((file) =>
      extractPreparedSql(readFileSync(file, "utf8")),
    );
    // Many .prepare(`…`) sites across statements.ts plus the inline-SQL services.
    expect(allSql.length).toBeGreaterThan(20);
    expect(columnNames.size).toBeGreaterThan(0);
  });

  it("the dynamic table/column constants resolve to schema names", () => {
    // A few queries build the table/column name at runtime from a constant map rather than baking it
    // into the SQL string (merge.ts NODE_TABLE + REPOINT_TARGETS, fitness.ts INBOUND_REFERENCE_PROBES,
    // search.ts node-table-by-prefix, entity-kind.ts). Those names are stripped from the static scan as
    // ${…}, so pin them here: every table name the package selects dynamically is a schema table, and
    // every column it repoints/probes dynamically is a schema column. A rename breaks this too.
    for (const dynamicTable of ["directory_person", "directory_organization"]) {
      expect(tableNames.has(dynamicTable), `dynamic table "${dynamicTable}"`).toBe(true);
    }
    for (const dynamicColumn of [
      "entity_id", // matter_party / directory_entity_category repoint + probe
      "from_entity_id", // directory_edge repoint + probe
      "to_entity_id", // directory_edge repoint + probe
      "category_id", // directory_entity_category row discriminator
      "id", // node-row identity
      "status", // node-row lifecycle guard
      "deleted_at", // soft-delete guard
      "merged_into_id", // merge pointer
      "value_reference_id", // custom_field_value contact-reference repoint + probe
      "target_row_id", // custom_field_value owned-value repoint + probe
    ]) {
      expect(columnNames.has(dynamicColumn), `dynamic column "${dynamicColumn}"`).toBe(true);
    }
  });

  it("every SQL identifier the directory package names is a known table, column, or sanctioned token", () => {
    const offenders: string[] = [];
    for (const file of listSourceFiles(DIRECTORY_SRC)) {
      const relativeName = file.slice(DIRECTORY_SRC.length + 1);
      for (const sql of extractPreparedSql(readFileSync(file, "utf8"))) {
        for (const identifier of identifiers(sql)) {
          if (tableNames.has(identifier)) continue;
          if (columnNames.has(identifier)) continue;
          if (SANCTIONED_NON_SCHEMA.has(identifier)) continue;
          offenders.push(`${relativeName}: SQL names unknown identifier "${identifier}"`);
        }
      }
    }
    expect(offenders, offenders.join("\n")).toEqual([]);
  });
});
