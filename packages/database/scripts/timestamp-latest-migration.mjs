// Post-process `drizzle-kit generate`: rename the just-generated `NNNN_slug`
// migration to a monotonic UTC-timestamp id `YYYYMMDDThhmmss_slug` and rewrite its
// journal tag, so migrations authored on parallel branches never collide on a
// number. Snapshots keep their idx name (drizzle diffs by idx); the loader and the
// worker bundles key off the tag. Idempotent: a migration already timestamped, or
// a no-op generate, is left untouched.
//
// usage: node scripts/timestamp-latest-migration.mjs <control-plane|per-firm>

import { readFileSync, writeFileSync, renameSync, existsSync } from "node:fs";
import { join } from "node:path";

const lineage = process.argv[2];
if (lineage !== "control-plane" && lineage !== "per-firm") {
  console.error(`usage: node scripts/timestamp-latest-migration.mjs <control-plane|per-firm>`);
  process.exit(2);
}

const dir = join(import.meta.dirname, "..", "drizzle", lineage);
const journalPath = join(dir, "meta", "_journal.json");
const journal = JSON.parse(readFileSync(journalPath, "utf8"));

// The newest migration is the highest-idx journal entry.
const latest = [...journal.entries].toSorted((a, b) => a.idx - b.idx).at(-1);
if (latest === undefined) {
  console.log(`${lineage}: journal empty, nothing to timestamp`);
  process.exit(0);
}

// Already a timestamp id, or a no-op generate that produced nothing new: leave it.
if (/^\d{8}T\d{6}_/.test(latest.tag)) {
  console.log(`${lineage}: latest migration ${latest.tag} already has a timestamp id`);
  process.exit(0);
}
const legacyMatch = /^(\d{4})_(.+)$/.exec(latest.tag);
if (legacyMatch === null) {
  console.log(`${lineage}: latest migration ${latest.tag} is not a drizzle NNNN_ tag; leaving it`);
  process.exit(0);
}

const slug = legacyMatch[2];
const stamp = new Date()
  .toISOString()
  .replace(/[-:]/g, "")
  .replace(/\.\d+Z$/, ""); // YYYYMMDDThhmmss
const newTag = `${stamp}_${slug}`;

const oldSql = join(dir, `${latest.tag}.sql`);
const newSql = join(dir, `${newTag}.sql`);
if (!existsSync(oldSql)) {
  console.error(`${lineage}: expected ${latest.tag}.sql for the new migration, not found`);
  process.exit(1);
}
renameSync(oldSql, newSql);
latest.tag = newTag;
writeFileSync(journalPath, JSON.stringify(journal, null, 2) + "\n");
console.log(`${lineage}: ${legacyMatch[0]} -> ${newTag}`);
