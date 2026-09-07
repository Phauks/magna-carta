import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PERMISSIONS } from "@magna-carta/access-control/registry";
import { expect, test } from "vitest";

// The two-person rule for trust disbursements lives in triggers, so it lives in the migration SQL —
// which means it names a permission key as a literal, with no import to keep it honest. This suite
// is that check: the key the trigger counts by has to be a key the platform actually issues, and the
// tables it guards have to carry the append-only discipline every other evidentiary trust table has.

const MIGRATION = readFileSync(
  join(import.meta.dirname, "..", "drizzle", "per-firm", "20260908T000000_baseline.sql"),
  "utf8",
);

test("the sole-authorizer trigger counts by a permission the registry actually issues", () => {
  const quoted = [...MIGRATION.matchAll(/'([a-z]+:[a-zA-Z]+)'/g)].map((match) => match[1]);
  expect(quoted.length).toBeGreaterThan(0);
  for (const permission of quoted) {
    expect(PERMISSIONS as readonly string[]).toContain(permission);
  }
});

test("both authorization tables carry the append-only trigger set", () => {
  for (const table of ["trust_disbursement_request", "trust_disbursement_decision"]) {
    for (const guard of ["no_update", "no_delete", "no_replace"]) {
      expect(MIGRATION).toContain(`CREATE TRIGGER \`${table}_${guard}\``);
    }
  }
});
