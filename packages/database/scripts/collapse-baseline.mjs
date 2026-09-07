/*
 * Collapse a lineage's whole migration chain into ONE baseline migration.
 *
 * A lineage grows a migration per change forever, and every database provisioned after a collapse
 * pays for the whole history on its first wake. Worse, the history is where the accidents live: a
 * table rebuild that cannot run against a populated database is a permanent hazard once it is in the
 * chain, because every new firm replays it. Collapsing retires that history into the schema it
 * produced.
 *
 * HOW THIS STAYS HONEST. The baseline is not written by hand and never edited from the old one. It
 * is DUMPED from a database built by applying the existing chain, so the only thing it can express
 * is what the chain actually produced — and the verify pass applies both and compares every object
 * and every seeded row. A baseline that drifted from its chain would be a schema no review could
 * catch, because there is nothing to compare it against by eye.
 *
 * WHAT IT DELIBERATELY DOES NOT CARRY: the applied ledger. Databases provisioned before the collapse
 * hold the retired tags, and the runner reconciles those through LEGACY_BASELINES (legacy-baselines.ts)
 * rather than through anything written here.
 *
 *   node packages/database/scripts/collapse-baseline.mjs per-firm --tag 20260908T000000_baseline
 *   node packages/database/scripts/collapse-baseline.mjs per-firm --verify
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { applyMigrations, loadMigrationsFromDisk } from "../src/node-sqlite.ts";

const DRIZZLE = join(import.meta.dirname, "..", "drizzle");

/**
 * The objects SQLite maintains on a table's behalf, which a dump must never emit.
 *
 * `sqlite_autoindex_*` backs a UNIQUE or PRIMARY KEY declared in the table itself; emitting it would
 * be declaring the same constraint twice. An FTS5 virtual table keeps SHADOW TABLES, and creating
 * the virtual table creates them — writing them out would collide on the first apply.
 *
 * The shadow set is named exactly, not by prefix. The obvious prefix test — anything starting with
 * the virtual table's name — also swallows `directory_name_fts_insert`, `_update` and `_delete`,
 * which are OUR triggers and the only thing keeping the search index in step with the table it
 * indexes. A baseline missing them would build a directory whose full-text search silently returned
 * nothing but whatever existed at the collapse. The verify pass caught it; the narrower rule is what
 * stops it recurring.
 */
const FTS_SHADOW_SUFFIXES = ["data", "idx", "content", "docsize", "config"];

function isManagedBySqlite(type, name, virtualTableNames) {
  if (name.startsWith("sqlite_")) return true;
  if (type !== "table") return false;
  return virtualTableNames.some((virtualName) =>
    FTS_SHADOW_SUFFIXES.some((suffix) => name === `${virtualName}_${suffix}`),
  );
}

/** Everything the chain built, in an order that applies: tables, then indexes, then triggers. */
function dumpSchema(database) {
  const objects = database
    .prepare("SELECT type, name, sql FROM sqlite_master WHERE sql IS NOT NULL ORDER BY rowid")
    .all();
  const virtualTableNames = objects
    .filter((object) => /CREATE VIRTUAL TABLE/i.test(object.sql))
    .map((object) => object.name);

  const statements = [];
  for (const wanted of ["table", "index", "trigger", "view"]) {
    for (const object of objects) {
      if (object.type !== wanted) continue;
      if (isManagedBySqlite(object.type, object.name, virtualTableNames)) continue;
      // Emitted verbatim: this is SQLite's own normalised text for what the chain created, so the
      // baseline cannot say something subtly different from what it is replacing.
      statements.push(`${object.sql.trim()};`);
    }
  }
  return { statements, virtualTableNames };
}

/**
 * The rows the chain seeded. A freshly migrated database holds nothing else, so whatever is in it IS
 * the seed — the roles, the permission grants, the catalogs a firm starts with.
 */
function dumpSeedRows(database, virtualTableNames) {
  const tables = database
    .prepare("SELECT name, sql FROM sqlite_master WHERE type = 'table' AND sql IS NOT NULL")
    .all()
    .filter((table) => !isManagedBySqlite("table", table.name, virtualTableNames))
    .filter((table) => !/CREATE VIRTUAL TABLE/i.test(table.sql))
    .map((table) => table.name)
    .sort();

  const statements = [];
  for (const table of tables) {
    const rows = database.prepare(`SELECT * FROM "${table}"`).all();
    if (rows.length === 0) continue;
    const columns = Object.keys(rows[0]);
    // Backticks, matching how the lineage has always written its seeds. The CREATE statements above
    // are SQLite's own stored text and keep whatever quoting it holds them in — a table rebuilt at
    // some point in the retired chain comes back double-quoted, because that is what the rename left
    // behind. Rewriting that text to match would mean editing DDL with a regular expression, which
    // is a worse risk than an inconsistent quote.
    const columnList = columns.map((column) => `\`${column}\``).join(", ");
    for (const row of rows) {
      const values = columns.map((column) => literal(row[column])).join(", ");
      statements.push(`INSERT INTO \`${table}\` (${columnList}) VALUES (${values});`);
    }
  }
  return statements;
}

function literal(value) {
  if (value === null) return "NULL";
  if (typeof value === "number") return String(value);
  if (typeof value === "bigint") return String(value);
  if (value instanceof Uint8Array) {
    return `X'${Array.from(value, (byte) => byte.toString(16).padStart(2, "0")).join("")}'`;
  }
  return `'${String(value).replaceAll("'", "''")}'`;
}

function buildFromChain(lineage) {
  const database = new DatabaseSync(":memory:");
  applyMigrations(database, loadMigrationsFromDisk(lineage));
  return database;
}

/** Every object and every seeded row, as one comparable value. */
export function fingerprint(database) {
  const objects = database
    .prepare("SELECT type, name, sql FROM sqlite_master WHERE sql IS NOT NULL ORDER BY type, name")
    .all()
    .map((object) => `${object.type} ${object.name}\n${normalise(object.sql)}`);
  const virtualTableNames = database
    .prepare("SELECT name, sql FROM sqlite_master WHERE sql IS NOT NULL")
    .all()
    .filter((object) => /CREATE VIRTUAL TABLE/i.test(object.sql))
    .map((object) => object.name);
  const rows = dumpSeedRows(database, virtualTableNames);
  return { objects: objects.sort(), rows: rows.slice().sort() };
}

// SQLite stores a CREATE statement as it was written. Two chains that build the same schema can
// differ in whitespace alone, which is not a difference in the schema.
function normalise(sql) {
  return sql.replace(/\s+/gu, " ").trim();
}

// Importable as a module — `fingerprint` above is how a caller proves one lineage reproduces another,
// including a chain that only exists in git history. Running the command line on import would make
// that impossible, so the CLI is behind the usual entry-point check.
const invokedDirectly =
  process.argv[1] !== undefined && process.argv[1].endsWith("collapse-baseline.mjs");
if (!invokedDirectly) {
  // Imported for its helpers; nothing to run.
} else {
  run();
}

function run() {
  const [, , lineage, ...rest] = process.argv;
  if (lineage !== "per-firm" && lineage !== "control-plane") {
    console.error("usage: collapse-baseline.mjs <per-firm|control-plane> [--tag <tag>] [--verify]");
    process.exit(2);
  }

  if (rest.includes("--verify")) {
    const fromChain = fingerprint(buildFromChain(lineage));
    const baselineTag = rest[rest.indexOf("--verify") + 1];
    if (baselineTag === undefined) {
      console.error("--verify needs the baseline tag to check against the chain");
      process.exit(2);
    }
    const database = new DatabaseSync(":memory:");
    applyMigrations(database, [
      {
        tag: baselineTag,
        statements: readFileSync(join(DRIZZLE, lineage, `${baselineTag}.sql`), "utf8")
          .split("--> statement-breakpoint")
          .map((statement) => statement.trim())
          .filter((statement) => statement.length > 0),
      },
    ]);
    const fromBaseline = fingerprint(database);

    const differences = [];
    const missing = fromChain.objects.filter((object) => !fromBaseline.objects.includes(object));
    const extra = fromBaseline.objects.filter((object) => !fromChain.objects.includes(object));
    const rowsMissing = fromChain.rows.filter((row) => !fromBaseline.rows.includes(row));
    const rowsExtra = fromBaseline.rows.filter((row) => !fromChain.rows.includes(row));
    for (const object of missing) differences.push(`only the chain has:\n  ${object}`);
    for (const object of extra) differences.push(`only the baseline has:\n  ${object}`);
    for (const row of rowsMissing) differences.push(`only the chain seeds: ${row}`);
    for (const row of rowsExtra) differences.push(`only the baseline seeds: ${row}`);

    if (differences.length > 0) {
      console.error(
        `the baseline does not reproduce the chain (${differences.length} difference(s)):\n`,
      );
      for (const difference of differences.slice(0, 20)) console.error(`  ${difference}`);
      process.exit(1);
    }
    console.log(
      `collapse-baseline: ${baselineTag} reproduces the ${lineage} chain exactly — ` +
        `${fromChain.objects.length} objects, ${fromChain.rows.length} seeded rows.`,
    );
    process.exit(0);
  }

  const tagIndex = rest.indexOf("--tag");
  const tag = tagIndex === -1 ? undefined : rest[tagIndex + 1];
  if (tag === undefined) {
    console.error("--tag <YYYYMMDDThhmmss_baseline> is required");
    process.exit(2);
  }

  const database = buildFromChain(lineage);
  const { statements, virtualTableNames } = dumpSchema(database);
  const seeds = dumpSeedRows(database, virtualTableNames);
  const retired = loadMigrationsFromDisk(lineage).map((migration) => migration.tag);

  const header = [
    `-- THE ${lineage.toUpperCase()} LINEAGE, COLLAPSED.`,
    "--",
    `-- Every migration through ${retired.at(-1)} folded into the schema they produced. This file is`,
    "-- DUMPED from a database built by applying that chain, never written by hand, so it cannot",
    "-- express anything the chain did not — and the collapse script's verify pass applies both and",
    "-- compares every object and every seeded row.",
    "--",
    "-- Databases provisioned before the collapse carry the retired tags in their applied ledger; the",
    "-- runner reconciles those through LEGACY_BASELINES in packages/database/src/legacy-baselines.ts,",
    "-- not through anything here.",
    "--",
    `-- Regenerate: node packages/database/scripts/collapse-baseline.mjs ${lineage} --tag <tag>`,
  ].join("\n");

  const body = [...statements, ...seeds].join("\n--> statement-breakpoint\n");
  writeFileSync(join(DRIZZLE, lineage, `${tag}.sql`), `${header}\n${body}\n`, "utf8");
  console.log(
    `collapse-baseline: wrote ${tag}.sql — ${statements.length} schema statements, ` +
      `${seeds.length} seeded rows, retiring ${retired.length} migrations.`,
  );
}
