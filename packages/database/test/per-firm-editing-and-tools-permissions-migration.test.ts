import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { applyMigrations, loadMigrationsFromDisk } from "@magna-carta/database/node-sqlite";

const MIGRATION_TAG = "20260819T220000_seed-document-editing-and-tools-permissions";

// The five default roles the baseline seeds. Read by name so the test says which SEAT it means
// rather than restating a committed handle.
const ALL_SEATS = ["Admin", "Attorney", "Paralegal", "Billing", "Read-only"] as const;
const CONTENT_WRITING_SEATS = ["Admin", "Attorney", "Paralegal"] as const;

// The grant this migration is FOR, permission by permission, as seat names. This table is the
// assertion: a change to the seed that nobody meant shows up here as a diff, and a seat quietly
// gaining a key it was deliberately kept away from fails on the exact row.
const EXPECTED: ReadonlyArray<readonly [string, readonly string[]]> = [
  ["documents:edit", CONTENT_WRITING_SEATS],
  ["documents:checkout", CONTENT_WRITING_SEATS],
  ["documents:reconcile", ["Admin", "Attorney"]],
  ["documents:forceReleaseLock", ["Admin"]],
  ["tools:propertyListings", ALL_SEATS],
  ["tools:propertyRecords", ALL_SEATS],
  ["tools:businessLookup", ALL_SEATS],
  ["tools:attorneyLicense", ALL_SEATS],
  ["tools:shipping", ["Admin"]],
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
});
