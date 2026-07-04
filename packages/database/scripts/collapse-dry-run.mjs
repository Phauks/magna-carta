// Dependency-free dry-run of the migration baseline collapse (node:sqlite only).
// READ-ONLY on the real migration files. For each lineage it:
//   1. applies the full legacy chain to an in-memory DB -> reference schema + data
//   2. builds a collapsed baseline: schema = end-state sqlite_master DDL;
//      seed(A) = concatenation of the source INSERT statements (design's method),
//      seed(B) = end-state data re-emitted as INSERTs (fallback method)
//   3. applies baseline+seed to a fresh DB and checks schema + data equivalence.
// Answers: does the chain apply cleanly? does one baseline reproduce it? does
// naive source-INSERT concatenation reproduce the seeded data, or is a data dump
// needed (the real question behind the seed trap)?

import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const DRIZZLE = process.argv[2] || "C:/dev/magna-carta-worktrees/monotonic-migration-ids/packages/database/drizzle";
const LINEAGES = ["control-plane", "per-firm"];
const BREAKPOINT = "--> statement-breakpoint";

function orderedTags(dir) {
  const journal = JSON.parse(readFileSync(join(dir, "meta", "_journal.json"), "utf8"));
  return [...journal.entries].sort((a, b) => a.idx - b.idx).map((e) => e.tag);
}
function statements(sql) {
  return sql.split(BREAKPOINT).map((s) => s.trim()).filter(Boolean);
}
function applySql(db, sqlText) {
  for (const st of statements(sqlText)) db.exec(st);
}
function applyChain(db, dir, tags) {
  for (const tag of tags) applySql(db, readFileSync(join(dir, `${tag}.sql`), "utf8"));
}
function sourceInserts(dir, tags) {
  const out = [];
  for (const tag of tags) {
    for (const st of statements(readFileSync(join(dir, `${tag}.sql`), "utf8"))) {
      if (/^insert\s+into/i.test(st)) out.push(st);
    }
  }
  return out;
}
function virtualNames(db) {
  return db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND sql LIKE 'CREATE VIRTUAL TABLE%'").all().map((r) => r.name);
}
function isShadow(name, vnames) {
  return vnames.some((v) => name.startsWith(v + "_"));
}
function userObjects(db) {
  // real DDL for the baseline replay: exclude internal/autoindex AND FTS shadow tables
  // (they are auto-created by their CREATE VIRTUAL TABLE). rowid order = creation order.
  const vnames = virtualNames(db);
  return db.prepare(
    "SELECT type,name,sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' ORDER BY rowid",
  ).all().filter((o) => !isShadow(o.name, vnames));
}
function schemaKey(db) {
  return userObjects(db).map((o) => `${o.type} ${o.name}\n${o.sql}`).sort().join("\n;;\n");
}
function tables(db) {
  // real row-storage tables only: not virtual, not FTS shadow tables
  const vnames = virtualNames(db);
  return db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all()
    .map((r) => r.name)
    .filter((n) => !vnames.includes(n) && !isShadow(n, vnames))
    .sort();
}
function lit(v) {
  if (v === null || v === undefined) return "NULL";
  if (typeof v === "bigint") return v.toString();
  if (typeof v === "number") return String(v);
  if (v instanceof Uint8Array) return "X'" + Buffer.from(v).toString("hex") + "'";
  return "'" + String(v).replace(/'/g, "''") + "'";
}
function dumpData(db) {
  const parts = [];
  let totalRows = 0;
  for (const t of tables(db)) {
    const cols = db.prepare(`PRAGMA table_info("${t}")`).all().map((c) => c.name);
    const rows = db.prepare(`SELECT * FROM "${t}"`).all();
    // deterministic order: sort serialized rows
    const ser = rows.map((r) => cols.map((c) => lit(r[c])).join("|")).sort();
    totalRows += ser.length;
    parts.push(`### ${t} (${ser.length} rows)\n` + ser.join("\n"));
  }
  return { text: parts.join("\n"), totalRows };
}
function dataAsInserts(db) {
  const out = [];
  for (const t of tables(db)) {
    const cols = db.prepare(`PRAGMA table_info("${t}")`).all().map((c) => c.name);
    for (const r of db.prepare(`SELECT * FROM "${t}"`).all()) {
      out.push(`INSERT INTO "${t}" (${cols.map((c) => `"${c}"`).join(",")}) VALUES (${cols.map((c) => lit(r[c])).join(",")});`);
    }
  }
  return out;
}

function run() {
  for (const lineage of LINEAGES) {
    const dir = join(DRIZZLE, lineage);
    const tags = orderedTags(dir);
    console.log(`\n========== ${lineage} (${tags.length} migrations) ==========`);

    // 1. reference: apply full legacy chain
    let ref;
    try {
      ref = new DatabaseSync(":memory:");
      applyChain(ref, dir, tags);
    } catch (e) {
      console.log(`  LEGACY CHAIN FAILED TO APPLY: ${e.message}`);
      continue;
    }
    const refSchema = schemaKey(ref);
    const refData = dumpData(ref);
    const refObjs = userObjects(ref);
    console.log(`  legacy chain applied OK: ${refObjs.length} schema objects, ${tables(ref).length} tables, ${refData.totalRows} total rows`);

    // 2. baseline schema = end-state DDL (rowid/creation order for a valid replay)
    const baselineSchema = refObjs.map((o) => o.sql).join(";\n") + ";";

    // 3a. seed method A: concatenate source INSERTs
    const srcInserts = sourceInserts(dir, tags);
    const colA = new DatabaseSync(":memory:");
    let aOk = true, aErr = "";
    try {
      applySql(colA, baselineSchema);
      for (const ins of srcInserts) colA.exec(ins);
    } catch (e) { aOk = false; aErr = e.message; }
    const aSchema = aOk ? schemaKey(colA) : "";
    const aData = aOk ? dumpData(colA) : { text: "", totalRows: -1 };

    // 3b. seed method B: end-state data re-emitted as INSERTs
    const dumpInserts = dataAsInserts(ref);
    const colB = new DatabaseSync(":memory:");
    let bOk = true, bErr = "";
    try {
      applySql(colB, baselineSchema);
      for (const ins of dumpInserts) colB.exec(ins);
    } catch (e) { bOk = false; bErr = e.message; }
    const bSchema = bOk ? schemaKey(colB) : "";
    const bData = bOk ? dumpData(colB) : { text: "", totalRows: -1 };

    // report
    const schemaMatchA = aOk && aSchema === refSchema;
    const schemaMatchB = bOk && bSchema === refSchema;
    const dataMatchA = aOk && aData.text === refData.text;
    const dataMatchB = bOk && bData.text === refData.text;
    console.log(`  baseline schema replays: ${schemaMatchA || schemaMatchB ? "OK" : "FAILED"}`);
    console.log(`  seed source INSERTs: ${srcInserts.length}  |  end-state data rows: ${dumpInserts.length}`);
    console.log(`  [method A: concat source INSERTs] applied=${aOk}${aOk ? "" : " ("+aErr+")"}  schema=${schemaMatchA}  DATA=${dataMatchA}`);
    console.log(`  [method B: dump end-state data]   applied=${bOk}${bOk ? "" : " ("+bErr+")"}  schema=${schemaMatchB}  DATA=${dataMatchB}`);
    if (aOk && !dataMatchA) {
      // show which tables differ under method A
      const refByTable = new Map(refData.text.split("\n### ").map((b) => [b.split(" (")[0], b]));
      const aByTable = new Map(aData.text.split("\n### ").map((b) => [b.split(" (")[0], b]));
      const diffs = [];
      for (const [t, block] of refByTable) if (aByTable.get(t) !== block) diffs.push(t);
      console.log(`    -> method A data diffs in tables: ${diffs.join(", ") || "(row-order only)"}`);
    }
    console.log(`  VERDICT: ${dataMatchB && schemaMatchB ? "COLLAPSE REPRODUCES DB (method B = data-dump seed) ✓" : dataMatchA && schemaMatchA ? "COLLAPSE REPRODUCES DB (method A = source-INSERT seed) ✓" : "NEEDS ATTENTION"}`);
  }
}
run();
