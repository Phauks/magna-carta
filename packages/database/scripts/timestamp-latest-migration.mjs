// Give the newest migration a monotonic UTC-timestamp id `YYYYMMDDThhmmss_slug`, renaming its .sql
// and rewriting its journal tag. Snapshots keep their idx name (drizzle diffs by idx); the loader
// and the worker bundles key off the tag.
//
// TWO JOBS, AND THE SECOND ONE IS WHY THIS IS RUNNABLE BY HAND.
//
//   1. After `drizzle-kit generate`: turn the `NNNN_slug` drizzle just wrote into a timestamp id, so
//      migrations authored on parallel branches never collide on a number.
//   2. After merging `main` into a branch that adds a migration: RE-STAMP it above the new lineage
//      head. A branch cut on Monday and merged on Wednesday keeps Monday's timestamp while drizzle
//      renumbers its idx to the end — and since apply order is by TAG, a fresh database would then
//      run it before the migrations it was written on top of. Two of those merged in September 2026
//      because the renumber is a hand edit somebody has to think of during a conflict resolution.
//      Now it is one command, and tooling/migration-integrity refuses the lineage if it is skipped.
//
// Idempotent: a latest migration that already sorts above every other tag is left untouched, as is a
// no-op generate. When it DOES re-stamp, it prints the old and new tags, then regenerates the worker
// bundles that import the .sql by name.
//
// ONE MIGRATION ONLY. A merge that brings in several at once — or one that leaves the lineage
// inverted somewhere other than at its end — is `node tooling/resolve-journal/index.mjs`, which
// resolves the journal itself and re-stamps everything the trunk does not already carry. This
// borrows its tag arithmetic from there rather than keeping a second copy: two implementations of
// "a tag that sorts above the head" is the shape of the bug both of them exist to prevent.
//
// usage: node scripts/timestamp-latest-migration.mjs <control-plane|per-firm>

import { readFileSync, writeFileSync, renameSync, existsSync } from "node:fs";
import { join } from "node:path";
import { generateBundles } from "../../../tooling/migration-bundles/index.mjs";
import { nextTagAbove, slugOf, TAG_PATTERN } from "../../../tooling/resolve-journal/stamp.mjs";

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

// The tag every other migration in the lineage sorts at or below. The newest migration has to sort
// ABOVE this, because that is the order it will be applied in.
const head = journal.entries
  .filter((entry) => entry.idx !== latest.idx)
  .reduce((highest, entry) => (entry.tag > highest ? entry.tag : highest), "");

const timestamped = TAG_PATTERN.test(latest.tag);
if (timestamped && latest.tag > head) {
  console.log(`${lineage}: latest migration ${latest.tag} already sorts above the lineage head`);
  process.exit(0);
}

let slug;
if (timestamped) {
  // Case 2: a merge moved the head above this migration's stamp. Re-stamp it.
  slug = slugOf(latest.tag);
} else {
  const legacyMatch = /^(\d{4})_(.+)$/.exec(latest.tag);
  if (legacyMatch === null) {
    console.log(
      `${lineage}: latest migration ${latest.tag} is not a drizzle NNNN_ tag; leaving it`,
    );
    process.exit(0);
  }
  slug = legacyMatch[2];
}
const newTag = nextTagAbove(head, slug);

const oldSql = join(dir, `${latest.tag}.sql`);
const newSql = join(dir, `${newTag}.sql`);
if (!existsSync(oldSql)) {
  console.error(`${lineage}: expected ${latest.tag}.sql for the new migration, not found`);
  process.exit(1);
}
const previousTag = latest.tag;
renameSync(oldSql, newSql);
latest.tag = newTag;
writeFileSync(journalPath, JSON.stringify(journal, null, 2) + "\n");
console.log(`${lineage}: ${previousTag} -> ${newTag}`);
if (timestamped) console.log(`${lineage}: re-stamped above the head (${head}).`);

// The worker bundles import the .sql by name, so a rename that stops here leaves them naming a file
// that no longer exists. Regenerating them is part of the rename, not a follow-up somebody has to
// remember — that is what the old hand-kept map got wrong.
for (const module of generateBundles().written) {
  console.log(`${lineage}: regenerated ${module}`);
}
