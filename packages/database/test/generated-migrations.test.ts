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
    // The firm lifecycle lands as a table rebuild (database_identifier loses NOT NULL, name gains
    // UNIQUE — both provisioning-resume requirements) with the lifecycle columns in the new shape.
    // The rebuild's copy backfills the new columns ('active'/NULL/NULL) rather than selecting them
    // from the 0000-era table, and uses the D1-compatible defer_foreign_keys pragma — the two
    // hand-corrections documented in the migration file itself.
    expect(allSql).toContain("`status` text DEFAULT 'active' NOT NULL");
    expect(allSql).toContain("`bucket_name` text");
    expect(allSql).toContain("`owner_user_id` text");
    expect(allSql).toContain("CREATE UNIQUE INDEX `firm_name_unique` ON `firm` (`name`)");
    expect(allSql).toContain(
      'SELECT "id", "name", "database_identifier", "per_firm_schema_version", \'active\', NULL, NULL, "created_at" FROM `firm`',
    );
    expect(allSql).toContain("PRAGMA defer_foreign_keys = on");
    expect(allSql).not.toContain("PRAGMA foreign_keys"); // not in D1's compatible-PRAGMA set
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
      expect(seed.created_at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/); // ISO-8601 instant
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

  it("per-firm 0004 creates the matters/locations/file-manager tables with their CHECKs, and leaves ledger_account alone", async () => {
    const migrations = await loadLineage("per-firm");
    expect(migrations.length).toBeGreaterThanOrEqual(5);
    expect(migrations[4]?.tag).toMatch(/^0004_/);
    const sql = (migrations[4]?.statements ?? []).join("\n");
    for (const tableName of [
      "location",
      "location_address",
      "member_location",
      "matter_type",
      "document_type",
      "numbering_scheme",
      "matter_number_counter",
      "matter",
      "folder",
      "file",
      "file_version",
      "upload_session",
      "storage_meter",
      "setting",
      "audit_log",
    ]) {
      expect(sql, tableName).toContain(`CREATE TABLE \`${tableName}\``);
    }
    // The CHECKs are the point — the status gates must exist in the DDL.
    expect(sql).toContain("matter_status_check");
    expect(sql).toContain("file_version_status_check");
    expect(sql).toContain("location_status_check");
    // The frozen-number partial UNIQUE index (a duplicate number within a firm is impossible).
    expect(sql).toContain(`WHERE "matter"."matter_number" IS NOT NULL`);
    // 0004 (regenerated atop 0003 incident-intake) adds only the matters/locations/file tables: no
    // spurious ledger_account table-rebuild.
    expect(sql).not.toContain("__new_ledger_account");
    expect(sql).not.toContain("DROP TABLE `ledger_account`");
  });

  it("per-firm 0004 seeds the matters/locations/files role grants per the default-role policy", async () => {
    const migrations = await loadLineage("per-firm");
    const statements0002 = migrations[2]?.statements ?? [];
    const statements0004 = migrations[4]?.statements ?? [];

    // Role ids are seeded in 0002; map name -> id so the 0004 grant assertions read by role NAME.
    const roleIdByName = new Map<string, string>(
      statements0002
        .filter((statement) => statement.includes("INSERT INTO `role`"))
        .map(parseSingleRowInsert)
        .map((seed) => [String(seed.name), String(seed.id)]),
    );

    // Collect 0004's role_permission grants, grouped by role name.
    const grantsByRole = new Map<string, Set<string>>();
    for (const statement of statements0004) {
      if (!statement.includes("INSERT INTO `role_permission`")) continue;
      const seed = parseSingleRowInsert(statement);
      expect(isIdentifier(seed.id, "rolePermission"), String(seed.id)).toBe(true);
      const roleName = [...roleIdByName].find(([, id]) => id === seed.role_id)?.[0];
      expect(
        roleName,
        `grant role_id ${String(seed.role_id)} resolves to a seeded role`,
      ).toBeDefined();
      const set = grantsByRole.get(roleName as string) ?? new Set<string>();
      set.add(String(seed.permission));
      grantsByRole.set(roleName as string, set);
    }

    const sorted = (name: string) => [...(grantsByRole.get(name) ?? new Set())].sort();
    // Owner/Admin gets every new permission; Attorney/Paralegal a curated subset; Billing/Read-only none.
    expect(sorted("Owner/Admin")).toEqual(
      [
        "files:delete",
        "files:manageDocumentTypes",
        "files:organize",
        "files:upload",
        "locations:manage",
        "matters:close",
        "matters:create",
        "matters:edit",
        "matters:manageNumbering",
        "matters:manageTypes",
        "matters:open",
        "matters:renumber",
        "matters:reopen",
      ].sort(),
    );
    expect(sorted("Attorney")).toEqual(
      [
        "matters:create",
        "matters:open",
        "matters:close",
        "matters:edit",
        "files:upload",
        "files:organize",
        "files:delete",
      ].sort(),
    );
    expect(sorted("Paralegal")).toEqual(
      ["matters:create", "files:upload", "files:organize"].sort(),
    );
    expect(grantsByRole.get("Billing")).toBeUndefined();
    expect(grantsByRole.get("Read-only")).toBeUndefined();
  });

  it("per-firm 0005 only swaps list indexes (drop + create), never rebuilds a table", async () => {
    const migrations = await loadLineage("per-firm");
    expect(migrations.length).toBeGreaterThanOrEqual(6);
    expect(migrations[5]?.tag).toMatch(/^0005_/);
    const statements = migrations[5]?.statements ?? [];
    const sql = statements.join("\n");
    // The composite list-keyset indexes are the point: filter column first, then (created_at, id) so
    // one ASC index serves both the filter and the reversed keyset sort with no temporary B-tree.
    for (const indexName of [
      "file_matter_id_created_at_id_index",
      "file_folder_id_created_at_id_index",
      "folder_matter_id_created_at_id_index",
      "matter_responsible_member_id_created_at_id_index",
      "matter_created_at_id_index",
    ]) {
      expect(sql, indexName).toContain(`CREATE INDEX \`${indexName}\``);
    }
    // The single-column FK indexes the composites replace are dropped (the composites cover them).
    for (const droppedIndex of [
      "file_matter_id_index",
      "file_folder_id_index",
      "folder_matter_id_index",
      "matter_responsible_member_id_index",
    ]) {
      expect(sql, droppedIndex).toContain(`DROP INDEX \`${droppedIndex}\``);
    }
    // An index swap must never trigger a table rebuild — no new shadow table, no table drop.
    for (const statement of statements) {
      expect(statement).toMatch(/^\s*(?:DROP INDEX|CREATE INDEX)\b/u);
    }
  });

  it("per-firm 0010 seeds tools:firmUsage onto the Owner/Admin role only", async () => {
    const migrations = await loadLineage("per-firm");
    const migration = migrations.find((m) => m.tag === "0010_seed-tools-firm-usage");
    expect(migration, "0010_seed-tools-firm-usage missing from the per-firm lineage").toBeDefined();
    const seeds = (migration?.statements ?? [])
      .filter((statement) => statement.includes("INSERT INTO `role_permission`"))
      .map(parseSingleRowInsert);
    expect(seeds).toHaveLength(1);
    expect(seeds[0]?.permission).toBe("tools:firmUsage");
    expect(seeds[0]?.role_id).toBe("role_Gw-zKO8hOHQuNv2bWokMp"); // the Owner/Admin role (0002)
    expect(isIdentifier(seeds[0]?.id, "rolePermission")).toBe(true);
  });

  it("per-firm 0034 seeds tools:aiTextDetection onto all five default roles", async () => {
    const migrations = await loadLineage("per-firm");
    const migration = migrations.find((m) => m.tag === "0034_seed-tools-ai-text-detection");
    expect(migration, "0034_seed-tools-ai-text-detection missing from the per-firm lineage").toBeDefined();
    const seeds = (migration?.statements ?? [])
      .filter((statement) => statement.includes("INSERT INTO `role_permission`"))
      .map(parseSingleRowInsert);
    expect(seeds).toHaveLength(5);
    for (const seed of seeds) {
      expect(seed.permission).toBe("tools:aiTextDetection");
      expect(isIdentifier(seed.id, "rolePermission"), String(seed.id)).toBe(true);
    }
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
