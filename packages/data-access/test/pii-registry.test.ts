import { describe, expect, it } from "vitest";
import { PII_TABLES } from "../src/pii-registry.ts";

describe("PII/erasure registry", () => {
  it("declares at least the known directory PII tables", () => {
    const tables = new Set(PII_TABLES.map((entry) => entry.table));
    for (const table of ["directory_identifier", "directory_email", "directory_person"]) {
      expect(tables.has(table), `${table} must be registered`).toBe(true);
    }
  });

  it("every entry has a table, a subjectKey, and a valid action", () => {
    const actions = new Set([
      "hard-delete",
      "anonymize",
      "retain-under-matter",
      "pseudonymize-keep",
      "report-manual",
    ]);
    for (const entry of PII_TABLES) {
      expect(entry.table.length, "table is non-empty").toBeGreaterThan(0);
      expect(entry.subjectKey.length, "subjectKey is non-empty").toBeGreaterThan(0);
      expect(actions.has(entry.action), `${entry.table} has a valid action`).toBe(true);
    }
  });

  it("a retain-under-matter entry carries a note stating the basis", () => {
    for (const entry of PII_TABLES.filter((candidate) => entry_is_retain(candidate))) {
      expect(entry.note, `${entry.table} retain entry needs a note`).toBeTruthy();
    }
    function entry_is_retain(entry: (typeof PII_TABLES)[number]) {
      return entry.action === "retain-under-matter";
    }
  });
});
