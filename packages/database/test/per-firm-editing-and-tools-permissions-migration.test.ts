import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { applyMigrations, loadMigrationsFromDisk } from "@magna-carta/database/node-sqlite";

const MIGRATION_TAG = "20260819T220000_seed-document-editing-and-tools-permissions";

// The five default roles the baseline seeds. Read by name so the test says which SEAT it means
// rather than restating a committed handle.
const ALL_SEATS = ["Owner/Admin", "Attorney", "Paralegal", "Billing", "Read-only"] as const;
const CONTENT_WRITING_SEATS = ["Owner/Admin", "Attorney", "Paralegal"] as const;

// The grant this migration is FOR, permission by permission, as seat names. This table is the
// assertion: a change to the seed that nobody meant shows up here as a diff, and a seat quietly
// gaining a key it was deliberately kept away from fails on the exact row.
const EXPECTED: ReadonlyArray<readonly [string, readonly string[]]> = [
  ["documents:edit", CONTENT_WRITING_SEATS],
  ["documents:checkout", CONTENT_WRITING_SEATS],
  ["documents:reconcile", ["Owner/Admin", "Attorney"]],
  ["documents:forceReleaseLock", ["Owner/Admin"]],
  ["tools:propertyListings", ALL_SEATS],
  ["tools:propertyRecords", ALL_SEATS],
  ["tools:businessLookup", ALL_SEATS],
  ["tools:attorneyLicense", ALL_SEATS],
  ["tools:shipping", ["Owner/Admin"]],
];

// Seat names holding `permission`, sorted, straight out of the applied database.
function seatsHolding(raw: DatabaseSync, permission: string): string[] {
  const rows = raw
    .prepare(
      "SELECT role.name AS name FROM role_permission JOIN role ON role.id = role_permission.role_id WHERE role_permission.permission = ? ORDER BY role.name",
    )
    .all(permission) as { name: string }[];
  return rows.map((row) => row.name);
}

function applyWholeLineage(): DatabaseSync {
  const raw = new DatabaseSync(":memory:");
  applyMigrations(raw, loadMigrationsFromDisk("per-firm"));
  return raw;
}

describe("the co-editing and Tools permission seed", () => {
  it("grants each of the nine keys to exactly the seats intended, and to no others", () => {
    const raw = applyWholeLineage();
    for (const [permission, seats] of EXPECTED) {
      expect(seatsHolding(raw, permission), permission).toEqual([...seats].toSorted());
    }
    raw.close();
  });

  it("keeps the co-editing keys away from Billing and Read-only", () => {
    // Stated as its own assertion because it is the half that must not drift: Billing carries no
    // content-writing key at all, and a Read-only seat that could open the editor, take the
    // document offline or break a colleague's lock would not be read-only.
    const raw = applyWholeLineage();
    for (const permission of [
      "documents:edit",
      "documents:checkout",
      "documents:reconcile",
      "documents:forceReleaseLock",
    ]) {
      const seats = seatsHolding(raw, permission);
      expect(seats, permission).not.toContain("Billing");
      expect(seats, permission).not.toContain("Read-only");
    }
    raw.close();
  });

  it("reaches a firm whose database was provisioned BEFORE it: the same rows, applied on the next wake", () => {
    // The real population. A firm's database is a Durable Object that applies pending migrations
    // when it wakes, so an existing firm arrives at this migration with every earlier one already
    // applied and none of these rows present. Split the lineage at the migration and drive exactly
    // that: nothing before, everything after, and the same end state as a firm created today.
    const lineage = loadMigrationsFromDisk("per-firm");
    const index = lineage.findIndex((migration) => migration.tag === MIGRATION_TAG);
    expect(index, `${MIGRATION_TAG} is not in the committed journal`).toBeGreaterThan(0);

    const raw = new DatabaseSync(":memory:");
    applyMigrations(raw, lineage.slice(0, index));
    for (const [permission] of EXPECTED) {
      expect(seatsHolding(raw, permission), `${permission} before the migration`).toEqual([]);
    }

    applyMigrations(raw, [lineage[index]!]);
    for (const [permission, seats] of EXPECTED) {
      expect(seatsHolding(raw, permission), `${permission} after the migration`).toEqual(
        [...seats].toSorted(),
      );
    }
    raw.close();
  });

  it("adds rows and nothing else — no schema statement, no touch to an existing grant", () => {
    // Expand-contract, and narrower: a seed migration that altered a table or replaced an existing
    // row would be changing what firms already have rather than adding to it.
    const lineage = loadMigrationsFromDisk("per-firm");
    const migration = lineage.find((entry) => entry.tag === MIGRATION_TAG);
    expect(migration).toBeDefined();
    for (const statement of migration?.statements ?? []) {
      // The journal keeps each statement with the comment block above it, which is where this
      // migration's reasoning lives; the executable half is what has to be an INSERT.
      const executable = statement
        .split("\n")
        .filter((line) => !line.trimStart().startsWith("--"))
        .join("\n")
        .trim();
      expect(executable).toMatch(/^INSERT INTO `role_permission`/u);
      expect(executable).not.toMatch(/\bOR\s+REPLACE\b/iu);
    }
  });
});
