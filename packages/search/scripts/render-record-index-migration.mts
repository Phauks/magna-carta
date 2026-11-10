// Prints the migration text that makes declared record index sources real in a firm's database: each
// source's triggers, then the statements that fill its index rows from the records the firm already
// holds.
//
// A source declared in src/record-index-sources.ts is searchable only once a migration carrying this
// output has been applied, so adding a source is: declare it, run this for its key, and append what
// it prints to a new per-firm migration. The fitness test in test/record-index-lineage.test.ts fails
// until the applied lineage and the declarations agree.
//
// usage: node packages/search/scripts/render-record-index-migration.mts [--with-table] [<source key>...]
//
//   --with-table   also print the full-text table's own definition (the first migration only)
//   no keys        every declared source

import {
  RECORD_TEXT_FTS_DEFINITION,
  recordIndexMigrationStatements,
} from "../src/record-index-schema.ts";
import { recordIndexSource, recordIndexSources } from "../src/record-index-sources.ts";

const BREAKPOINT = "--> statement-breakpoint";

const parameters = process.argv.slice(2);
const withTable = parameters.includes("--with-table");
const keys = parameters.filter((parameter) => parameter !== "--with-table");
const sources = keys.length === 0 ? recordIndexSources : keys.map((key) => recordIndexSource(key));

const statements = [
  ...(withTable ? [RECORD_TEXT_FTS_DEFINITION] : []),
  ...recordIndexMigrationStatements(sources),
];

process.stdout.write(`${statements.join(`\n${BREAKPOINT}\n`)}\n`);
