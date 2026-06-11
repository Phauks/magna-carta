import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { PERMISSIONS } from "@magna-carta/access-control/registry";
import { isIdentifier } from "@magna-carta/identifiers/validate";
import { describe, expect, it } from "vitest";
import { migrationsFromJournal, type MigrationJournal } from "../src/migration.ts";
import { BETTER_AUTH_TABLE_NAMES } from "./better-auth-table-names.ts";

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

  it("control-plane 0001 adds the auth tables, auth_audit, outbox + idempotency, and the firm lifecycle columns", async () => {
    const migrations = await loadLineage("control-plane");
    expect(migrations.length).toBeGreaterThanOrEqual(2);
    expect(migrations[1]?.tag).toMatch(/^0001_/);
    const allSql = migrations.flatMap((migration) => migration.statements).join("\n");
    for (const tableName of [
      ...BETTER_AUTH_TABLE_NAMES,
      "auth_audit",
      "outbox",
      "idempotency_key",
    ]) {
      expect(allSql, tableName).toContain(`CREATE TABLE \`${tableName}\``);
    }
    // The firm lifecycle columns arrive as additive ALTERs — NOT NULL only with a DEFAULT.
    expect(allSql).toContain("ALTER TABLE `firm` ADD `status` text DEFAULT 'active' NOT NULL");
    expect(allSql).toContain("ALTER TABLE `firm` ADD `bucket_name` text");
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
    expect(allSql).toContain("ledger_account_name_nonempty_check");
    expect(allSql).toContain("ledger_entry_description_nonempty_check");
  });

  it("per-firm 0002 creates the RBAC tables and seeds the five default roles", async () => {
    const migrations = await loadLineage("per-firm");
    expect(migrations.length).toBeGreaterThanOrEqual(3);
    expect(migrations[2]?.tag).toMatch(/^0002_/);
    const statements = migrations[2]?.statements ?? [];
    const sql = statements.join("\n");
    for (const tableName of ["member", "role", "role_permission", "member_role", "direct_grant"]) {
      expect(sql, tableName).toContain(`CREATE TABLE \`${tableName}\``);
    }
    const roleSeeds = statements
      .filter((statement) => statement.includes("INSERT INTO `role`"))
      .map(parseSingleRowInsert);
    const seededRoleNames = roleSeeds.map((seed) => String(seed.name));
    seededRoleNames.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    expect(seededRoleNames).toEqual([
      "Attorney",
      "Billing",
      "Owner/Admin",
      "Paralegal",
      "Read-only",
    ]);
    for (const seed of roleSeeds) {
      // Seeded handles are committed literals — see drizzle/per-firm/0002_member-rbac.sql.
      expect(isIdentifier(seed.id, "role"), String(seed.id)).toBe(true);
      expect(seed.created_at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/); // ADR-0055
    }
    const ownerAdmin = roleSeeds.find((seed) => seed.name === "Owner/Admin");
    const permissionSeeds = statements
      .filter((statement) => statement.includes("INSERT INTO `role_permission`"))
      .map(parseSingleRowInsert);
    // firm:manageMembers goes to Owner/Admin ONLY — the other four defaults start permissionless.
    expect(permissionSeeds).toHaveLength(1);
    expect(permissionSeeds[0]?.role_id).toBe(ownerAdmin?.id);
    expect(permissionSeeds[0]?.permission).toBe("firm:manageMembers");
    expect(isIdentifier(permissionSeeds[0]?.id, "rolePermission")).toBe(true);
  });

  it("per-firm lineage never creates the auth tables — they are control-plane only", async () => {
    const migrations = await loadLineage("per-firm");
    const allSql = migrations.flatMap((migration) => migration.statements).join("\n");
    for (const tableName of BETTER_AUTH_TABLE_NAMES) {
      expect(allSql, tableName).not.toContain(`CREATE TABLE \`${tableName}\``);
    }
  });
});

// One INSERT, one row, drizzle backtick column style — what the seed SQL in this repo looks like.
// Values must be single-quoted literals or NULL; anything else fails loud so the parser cannot
// silently misread a future seed.
function parseSingleRowInsert(statement: string): Record<string, string | null> {
  const match = /INSERT INTO `\w+` \(([^)]*)\) VALUES \((.*)\);?$/su.exec(statement);
  if (!match) throw new Error(`unparseable seed INSERT: ${statement}`);
  const columns = (match[1] ?? "").split(",").map((column) => column.trim().replaceAll("`", ""));
  const values = (match[2] ?? "").split(",").map((value) => {
    const trimmed = value.trim();
    if (trimmed === "NULL") return null;
    const quoted = /^'((?:[^']|'')*)'$/su.exec(trimmed);
    if (!quoted) throw new Error(`unparseable seed value ${trimmed} in: ${statement}`);
    return (quoted[1] ?? "").replaceAll("''", "'");
  });
  if (columns.length !== values.length) throw new Error(`column/value mismatch in: ${statement}`);
  return Object.fromEntries(columns.map((column, index) => [column, values[index] ?? null]));
}

// Resolves an INSERT statement to its target table, or null for non-INSERT statements. Detection is
// case-insensitive and the table name may be backtick-quoted, double-quoted, or bare — an INSERT
// whose target cannot be resolved THROWS rather than being silently skipped, so a future seed
// written in an unanticipated style breaks the fitness test instead of evading it.
function insertTargetTableName(statement: string): string | null {
  if (!/^\s*INSERT\b/iu.test(statement)) return null;
  const match =
    /^\s*INSERT\s+(?:OR\s+[A-Za-z]+\s+)?INTO\s+(?:`([^`]+)`|"([^"]+)"|([A-Za-z_][A-Za-z0-9_]*))/iu.exec(
      statement,
    );
  const tableName = match?.[1] ?? match?.[2] ?? match?.[3];
  if (tableName === undefined) {
    throw new Error(`INSERT whose target table cannot be resolved: ${statement}`);
  }
  return tableName;
}

describe("seed permission values stay inside the registry (fitness function)", () => {
  it("every role_permission/direct_grant permission seeded by ANY committed migration is registered", async () => {
    const registered = new Set<string>(PERMISSIONS);
    const permissionSeedTableNames = new Set(["role_permission", "direct_grant"]);
    let seedCount = 0;
    for (const lineage of ["control-plane", "per-firm"] as const) {
      const migrations = await loadLineage(lineage);
      for (const migration of migrations) {
        for (const statement of migration.statements) {
          const tableName = insertTargetTableName(statement);
          if (tableName === null || !permissionSeedTableNames.has(tableName)) continue;
          seedCount += 1;
          const row = parseSingleRowInsert(statement);
          const permission = row["permission"];
          expect(typeof permission, `${migration.tag}: ${statement}`).toBe("string");
          expect(
            registered.has(permission as string),
            `${migration.tag} seeds unregistered permission ${String(permission)}`,
          ).toBe(true);
        }
      }
    }
    expect(seedCount).toBeGreaterThanOrEqual(1); // the parse actually covered the committed seed
  });
});
