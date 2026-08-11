import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { splitSqlStatements } from "../src/migration.ts";

const DRIZZLE = join(import.meta.dirname, "..", "drizzle");
const CONTRACT_MARKER = "-- contract:";

// Destructive patterns per the expand-contract discipline. ADD COLUMN ... NOT NULL is
// destructive only without a DEFAULT (existing rows cannot satisfy it); plain
// CREATE TABLE ... NOT NULL is fine.
function destructiveReason(statement: string): string | null {
  // `IS NOT NULL` is a PREDICATE — it appears inside CHECK constraints and partial-index WHERE
  // clauses — and is never a column's nullability. Left in, it makes any additive column add whose
  // constraint tests another column read as a NOT NULL add, and the "fix" a reader reaches for is
  // the `-- contract:` marker, which switches the guard off for the whole file.
  const sql = statement.toUpperCase().replaceAll(/\bIS\s+NOT\s+NULL\b/g, "");
  if (/\bDROP\s+TABLE\b/.test(sql)) return "DROP TABLE";
  if (/\bDROP\s+COLUMN\b/.test(sql)) return "DROP COLUMN";
  if (
    /\bALTER\s+TABLE\b[\s\S]*\bADD\s+COLUMN\b[\s\S]*\bNOT\s+NULL\b/.test(sql) &&
    !/\bDEFAULT\b/.test(sql)
  ) {
    return "ADD COLUMN NOT NULL without DEFAULT";
  }
  return null;
}

describe("destructiveReason (the detector itself)", () => {
  it("flags the destructive shapes", () => {
    expect(destructiveReason("DROP TABLE outbox;")).toBe("DROP TABLE");
    expect(destructiveReason("ALTER TABLE firm DROP COLUMN name;")).toBe("DROP COLUMN");
    expect(destructiveReason("ALTER TABLE firm ADD COLUMN tier text NOT NULL;")).toBe(
      "ADD COLUMN NOT NULL without DEFAULT",
    );
  });

  it("does not flag additive shapes", () => {
    expect(destructiveReason("CREATE TABLE a (id text NOT NULL);")).toBeNull();
    expect(destructiveReason("ALTER TABLE firm ADD COLUMN tier text;")).toBeNull();
    expect(
      destructiveReason("ALTER TABLE firm ADD COLUMN tier text NOT NULL DEFAULT 'standard';"),
    ).toBeNull();
    // A nullable add whose CHECK tests another column for presence: additive, and the predicate is
    // not a nullability declaration.
    expect(
      destructiveReason(
        "ALTER TABLE firm ADD COLUMN tier text CHECK (tier IS NULL OR name IS NOT NULL);",
      ),
    ).toBeNull();
  });
});

describe("expand-contract guard over the committed migrations", () => {
  it("every destructive statement in either lineage carries an explicit -- contract: annotation", async () => {
    const violations: string[] = [];
    for (const lineage of ["control-plane", "per-firm"]) {
      const files = (await readdir(join(DRIZZLE, lineage))).filter((file) => file.endsWith(".sql"));
      for (const file of files) {
        const sql = await readFile(join(DRIZZLE, lineage, file), "utf8");
        const annotated = sql.includes(CONTRACT_MARKER);
        for (const statement of splitSqlStatements(sql)) {
          const reason = destructiveReason(statement);
          if (reason && !annotated) violations.push(`${lineage}/${file}: ${reason}`);
        }
      }
    }
    expect(violations).toEqual([]);
  });
});
