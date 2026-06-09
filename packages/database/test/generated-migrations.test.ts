import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { migrationsFromJournal, type MigrationJournal } from "../src/migration.ts";

const DRIZZLE = join(import.meta.dirname, "..", "drizzle");

async function loadLineage(lineage: "control-plane" | "per-firm") {
  const journal = JSON.parse(
    await readFile(join(DRIZZLE, lineage, "meta", "_journal.json"), "utf8"),
  ) as MigrationJournal;
  const sqlByTag: Record<string, string> = {};
  for (const entry of journal.entries) {
    sqlByTag[entry.tag] = await readFile(join(DRIZZLE, lineage, `${entry.tag}.sql`), "utf8");
  }
  return migrationsFromJournal(journal, sqlByTag);
}

describe("generated migrations (committed artifacts)", () => {
  it("control-plane lineage loads, starts at the firm registry, and statements are non-empty", async () => {
    const migrations = await loadLineage("control-plane");
    expect(migrations.length).toBeGreaterThanOrEqual(1);
    expect(migrations[0]?.tag).toMatch(/^0000_/);
    expect(migrations[0]?.statements.join("\n")).toContain("firm");
    for (const migration of migrations) {
      expect(migration.statements.length).toBeGreaterThan(0);
    }
  });

  it("per-firm lineage loads and creates idempotency_key and outbox", async () => {
    const migrations = await loadLineage("per-firm");
    const allSql = migrations.flatMap((migration) => migration.statements).join("\n");
    expect(allSql).toContain("idempotency_key");
    expect(allSql).toContain("outbox");
    expect(allSql).toContain("ledger_account");
    expect(allSql).toContain("ledger_entry");
    expect(allSql).toContain("ledger_line");
    expect(allSql).toContain("account_balance");
    // The CHECKs are the point — bounds enforcement and positive amounts must exist in the DDL.
    expect(allSql).toContain("account_balance_bounds_check");
    expect(allSql).toContain("ledger_line_amount_minor_positive_check");
    expect(allSql).toContain("ledger_line_direction_check");
  });
});
