import { describe, expect, it } from "vitest";
import { PII_TABLES } from "@magna-carta/data-access/pii-registry";
import { REPOINT_REFERENCE_COLUMNS } from "../src/merge.ts";

// Drift tripwire: every entity reference the merge repoints must also be an entity-axis entry in the
// PII/erasure registry, so an inbound entity reference can never be added to merge without also being
// attributed for erasure.
describe("PII registry ⊇ merge repoint references", () => {
  it("every REPOINT_REFERENCE_COLUMNS pair is a registry entry", () => {
    const registryPairs = new Set(PII_TABLES.map((entry) => `${entry.table}.${entry.subjectKey}`));
    const missing = REPOINT_REFERENCE_COLUMNS.filter(
      (reference) => !registryPairs.has(`${reference.table}.${reference.column}`),
    ).map((reference) => `${reference.table}.${reference.column}`);
    expect(missing, `merge references missing from PII_TABLES: ${missing.join(", ")}`).toEqual([]);
  });
});
