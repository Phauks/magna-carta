// @node-runtime — reaches no Workers runtime API; see vitest.node-runtime.ts.
import { describe, expect, it } from "vitest";
import { perFirmMigrations, perFirmHeadSchemaVersion } from "../src/per-firm-migrations.ts";
import perFirmJournal from "@magna-carta/database/drizzle/per-firm/meta/_journal.json" with { type: "json" };

// THE CHEAPEST TEST IN THIS DIRECTORY, AND IT HAS EARNED ITS PLACE TWICE.
//
// `perFirmMigrations` maps every journal tag to a bundled `.sql` import, because the FirmDatabase
// Durable Object has no filesystem and must carry the SQL in the worker bundle. That map is now
// GENERATED from the journal (tooling/migration-bundles), which removes the way it used to go wrong:
// a merge resolved the journal cleanly — the entries are adjacent lines — and dropped one branch's
// import in the same conflict, leaving a tag with nothing behind it. `migrationsFromJournal` fails
// loud on that, but nothing called it outside a Durable Object, so twice it surfaced as a DO that
// threw on wake and took every route touching that firm down with it, diagnosed from a twenty-second
// route timeout rather than from a test naming the missing import.
//
// What is left for this test is what the generator cannot see: the generator compares TEXT to the
// journal, so it proves the import was written, not that the bundler RESOLVED it. Only running the
// real module through the real `.sql` text-import plugin proves that.

const journalTags = perFirmJournal.entries.map((entry) => entry.tag);

describe("perFirmMigrations bundle", () => {
  it("carries a bundled .sql for every journal entry", () => {
    // The call itself is the assertion — migrationsFromJournal throws naming the unregistered tag.
    const migrations = perFirmMigrations();
    expect(migrations.map((migration) => migration.tag)).toEqual(journalTags);
    for (const migration of migrations) {
      // A registered-but-empty import is the other half of the same failure: the tag is present, the
      // bundler resolved nothing, and the Durable Object applies a migration that does nothing.
      expect(migration.statements.length, `${migration.tag} carries no statements`).toBeGreaterThan(
        0,
      );
    }
  });

  it("reports the last-applied tag as the head", () => {
    // `perFirmHeadSchemaVersion` picks the greatest TAG, and the runner applies in TAG order too
    // (`migrationsFromJournal` sorts by tag) — so the head always names the last-applied migration.
    // What this pins is that the head also names the last AUTHORED one, which is the same migration
    // only while tag order and idx order agree. A merge breaks that silently: a branch cut before
    // another one lands keeps its earlier timestamp and is renumbered to a later idx, after which a
    // fresh firm applies it before the migration it was written on top of. Provisioning stamps
    // `schema_version` from the head, so a firm would also record itself at a version it had passed.
    // Re-stamp the merged-in migration above the new head rather than relaxing this —
    // tooling/migration-integrity refuses it in the pre-push hook and the gate, on every change.
    const migrations = perFirmMigrations();
    expect(migrations.at(-1)?.tag).toBe(perFirmHeadSchemaVersion());
    expect(perFirmHeadSchemaVersion()).toMatch(/^\d{8}T\d{6}_/);
  });
});
