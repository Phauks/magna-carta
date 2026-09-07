import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { applyMigrations, loadMigrationsFromDisk } from "../src/node-sqlite.ts";

// The matter status rename shipped copying `status` verbatim into the rebuilt table, on the
// reasoning that no firm held a matter yet and so nothing could still be spelled `prospective`. A
// deployed firm did hold one. The replacement's CHECK admits only the new vocabulary, so the copy
// rejected that row and the whole migration failed — and because the per-firm lineage is applied in
// the FirmDatabase durable object's constructor, ahead of any read or write it serves, a migration
// that cannot complete takes the firm's entire database offline rather than degrading one screen.
//
// So the guard is not "the chain applies to an empty database" — it always did, which is exactly
// why the fault reached production. It is that the chain applies to a database holding a row at the
// OLD vocabulary, and that the row survives under its new name. Seed the pre-rename statuses, run
// the rest of the lineage over them, and read them back.
const RENAME_TAG = "20260906T013304_matter-status-intake-and-consultation";
const NOW = "2026-09-05T12:00:00.000Z";
const RESPONSIBLE_MEMBER_ID = "user_statusrename";

// The statuses the vocabulary allowed before the rename, one row each: `prospective` is the one the
// rename moves, and open/closed are the controls that must come through untouched.
const SEEDED_MATTERS = [
  { id: "matter_prospective", status: "prospective" },
  { id: "matter_open", status: "open" },
  { id: "matter_closed", status: "closed" },
] as const;

// A row that POINTS AT a matter. The rebuild's whole hazard is here: dropping a parent table while
// foreign keys are enforced fires a violation for every child row, and a database with no children
// cannot show it. The production firm had these; every test fixture did not, which is exactly how a
// rebuild that could not survive contact with real data passed everything.
function seedChildOfMatter(raw: DatabaseSync, matterId: string): void {
  raw
    .prepare(
      `INSERT INTO matter_party (id, matter_id, entity_id, role, created_at, updated_at)
       VALUES (?, ?, 'directoryEntity_seed', 'client', ?, ?)`,
    )
    .run(`matterParty_${matterId}`, matterId, NOW, NOW);
}

function seedPreRenameMatters(raw: DatabaseSync): void {
  raw
    .prepare(
      `INSERT INTO member (user_id, display_name, status, opted_out_of_usage_analytics, created_at)
       VALUES (?, 'Status Rename', 'active', 0, ?)`,
    )
    .run(RESPONSIBLE_MEMBER_ID, NOW);
  for (const { id, status } of SEEDED_MATTERS) {
    raw
      .prepare(
        `INSERT INTO matter (id, title, status, responsible_member_id, e_billing, created_at, updated_at)
         VALUES (?, 'Seeded Matter', ?, ?, 0, ?, ?)`,
      )
      .run(id, status, RESPONSIBLE_MEMBER_ID, NOW, NOW);
  }
}

describe("the matter status rename, applied to a database that already holds matters", () => {
  it("carries a `prospective` matter across as `consultation` and leaves the rest alone", () => {
    const migrations = loadMigrationsFromDisk("per-firm");
    const renameAt = migrations.findIndex((migration) => migration.tag === RENAME_TAG);
    // A collapsed lineage retires this migration; when that happens this whole test goes with it.
    expect(renameAt, `${RENAME_TAG} is no longer in the per-firm lineage`).toBeGreaterThan(0);

    const raw = new DatabaseSync(":memory:");
    applyMigrations(raw, migrations.slice(0, renameAt));
    seedPreRenameMatters(raw);
    for (const { id } of SEEDED_MATTERS) seedChildOfMatter(raw, id);

    // Two failures are pinned here, and the second only appears once the first is fixed. The copy
    // threw on a status the widened CHECK would not admit; past that, DROP TABLE threw because the
    // migration's own `PRAGMA foreign_keys=OFF` is a no-op inside a transaction and the seeded
    // children were still pointing at the table being dropped.
    expect(() => applyMigrations(raw, migrations.slice(renameAt))).not.toThrow();

    // Nothing was re-keyed: every child still resolves to the matter it resolved to before.
    expect(raw.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
    expect(raw.prepare("SELECT COUNT(*) AS n FROM matter_party").get() as { n: number }).toEqual({
      n: SEEDED_MATTERS.length,
    });

    const rows = raw.prepare("SELECT id, status FROM matter ORDER BY id").all();
    expect(rows).toEqual([
      { id: "matter_closed", status: "closed" },
      { id: "matter_open", status: "open" },
      { id: "matter_prospective", status: "consultation" },
    ]);
  });

  it("leaves the old spelling unwritable once the rename has run", () => {
    const migrations = loadMigrationsFromDisk("per-firm");
    const raw = new DatabaseSync(":memory:");
    applyMigrations(raw, migrations);
    raw
      .prepare(
        `INSERT INTO member (user_id, display_name, status, opted_out_of_usage_analytics, created_at)
         VALUES (?, 'Status Rename', 'active', 0, ?)`,
      )
      .run(RESPONSIBLE_MEMBER_ID, NOW);

    const insertWithStatus = (status: string): void => {
      raw
        .prepare(
          `INSERT INTO matter (id, title, status, responsible_member_id, e_billing, created_at, updated_at)
           VALUES (?, 'Seeded Matter', ?, ?, 0, ?, ?)`,
        )
        .run(`matter_${status}`, status, RESPONSIBLE_MEMBER_ID, NOW, NOW);
    };
    // The rename really did change the vocabulary rather than widen it: the mapping in the copy is
    // the only place `prospective` may still appear.
    expect(() => insertWithStatus("prospective")).toThrow(/matter_status_check/u);
    expect(() => insertWithStatus("consultation")).not.toThrow();
  });
});
