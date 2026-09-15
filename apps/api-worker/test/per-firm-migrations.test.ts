import { describe, expect, it } from "vitest";
import { perFirmMigrations, perFirmHeadSchemaVersion } from "../src/per-firm-migrations.ts";
import perFirmJournal from "@magna-carta/database/drizzle/per-firm/meta/_journal.json" with { type: "json" };

// THE CHEAPEST TEST IN THIS DIRECTORY, AND IT HAS EARNED ITS PLACE TWICE.
//
// The per-firm lineage is hand-registered: `perFirmMigrations` maps every journal tag to a bundled
// `.sql` import, because the FirmDatabase Durable Object has no filesystem and must carry the SQL in
// the worker bundle. `migrationsFromJournal` already fails loud on a tag the map does not carry — but
// nothing called it outside a Durable Object, so the failure surfaced as a DO that threw on wake and
// took every route touching that firm down with it. Twice, that was diagnosed from a twenty-second
// route timeout rather than from a test naming the missing import.
//
// A merge is where the gap opens: two branches each add a migration, the journal merges cleanly
// because the entries are adjacent lines, and one branch's import is dropped in the conflict
// resolution. So this runs on every suite and names the tag.

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
    // tooling/migration-integrity now refuses it on every pull request, not only under `run-tests`.
    const migrations = perFirmMigrations();
    expect(migrations.at(-1)?.tag).toBe(perFirmHeadSchemaVersion());
    expect(perFirmHeadSchemaVersion()).toMatch(/^\d{8}T\d{6}_/);
  });
});
