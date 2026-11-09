import { CANONICAL_INSTANT_PATTERN } from "@magna-carta/civil-time/instant";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { PERMISSIONS } from "@magna-carta/access-control/registry";
import { isIdentifier } from "@magna-carta/identifiers/validate";
import { describe, expect, it } from "vitest";
import { migrationsFromJournal, type MigrationJournal } from "../src/migration.ts";
import { REVIEWED_REBUILDS } from "../src/reviewed-rebuilds.ts";
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

// A monotonic timestamp migration id: YYYYMMDDThhmmss_slug.
const TIMESTAMP_TAG = /^\d{8}T\d{6}_/u;

describe("collapsed migration baselines (committed artifacts)", () => {
  it("control-plane starts with a timestamp-id baseline carrying the auth + firm tables and firm lifecycle columns; later features append their own timestamp migrations", async () => {
    const migrations = await loadLineage("control-plane");
    // The first migration is the collapsed timestamp-id baseline; features that land after the collapse
    // append their own timestamp-id migrations after it (the email capture-route index is the first).
    // Every migration id — the baseline and everything after — is a monotonic timestamp.
    expect(migrations.length).toBeGreaterThanOrEqual(1);
    for (const migration of migrations) {
      expect(migration.tag).toMatch(TIMESTAMP_TAG);
    }
    const baseline = migrations[0]?.statements.join("\n") ?? "";
    expect(migrations[0]?.statements.length ?? 0).toBeGreaterThan(0);
    for (const tableName of [
      ...BETTER_AUTH_TABLE_NAMES,
      "auth_audit",
      "outbox",
      "idempotency_key",
      "firm",
    ]) {
      expect(baseline, tableName).toContain(`CREATE TABLE \`${tableName}\``);
    }
    // Firm lifecycle columns land in the baseline's final shape (the collapse removed the
    // incremental table-rebuild that historically introduced them).
    expect(baseline).toContain("`status` text DEFAULT 'active' NOT NULL");
    expect(baseline).toContain("`bucket_name` text");
    expect(baseline).toContain("`owner_user_id` text");
    expect(baseline).toContain("CREATE UNIQUE INDEX `firm_name_unique` ON `firm` (`name`)");
    // No migration — baseline or later — rebuilds a table on its own say-so: no shadow tables, no
    // defer_foreign_keys dance. A rebuild is sometimes genuinely unavoidable (SQLite cannot drop a
    // column constraint in place), and the way one becomes acceptable is a written audit plus its
    // tag in REVIEWED_REBUILDS — so this defers to that sentinel rather than keeping a second,
    // blunter answer that a legitimate rebuild would have to be argued past twice.
    const wholeLineage = migrations.map((migration) => migration.statements.join("\n")).join("\n");
    const unreviewed = migrations
      .filter((migration) => !REVIEWED_REBUILDS.has(migration.tag))
      .map((migration) => migration.statements.join("\n"))
      .join("\n");
    expect(unreviewed).not.toMatch(/__new_/u);
    expect(unreviewed).not.toContain("defer_foreign_keys");
    // The token->firm routing index the single-catch-all Email Worker resolves against lands additively.
    expect(wholeLineage).toContain("CREATE TABLE `email_capture_route`");
  });

  it("per-firm starts with a single timestamp-id baseline carrying the ledger/matters/files/RBAC/directory tables and their CHECKs", async () => {
    const migrations = await loadLineage("per-firm");
    // The first migration is the collapsed timestamp-id baseline; features that land after the collapse
    // append their own timestamp-id migrations after it (File Repair's seed + provenance table are the
    // first). Every migration id — the baseline and everything after — is a monotonic timestamp.
    expect(migrations.length).toBeGreaterThanOrEqual(1);
    for (const migration of migrations) {
      expect(migration.tag).toMatch(TIMESTAMP_TAG);
    }
    const sql = migrations[0]?.statements.join("\n") ?? "";
    for (const tableName of [
      "idempotency_key",
      "outbox",
      "ledger_account",
      "ledger_entry",
      "ledger_line",
      "account_balance",
      "member",
      "role",
      "role_permission",
      "member_role",
      "direct_grant",
      "location",
      "matter",
      "matter_type",
      "folder",
      "file",
      "file_version",
      "audit_log",
      "directory_name",
      "custom_field",
    ]) {
      // Quote-agnostic on purpose. The baseline is SQLite's OWN rendering of what the retired
      // chain built, and a table that was rebuilt somewhere in that chain comes back double-quoted
      // because that is what the rename left behind. The schema is what matters here, not which
      // quote character it survived in.
      expect(sql, tableName).toMatch(new RegExp(`CREATE TABLE [\`"]${tableName}[\`"]`, "u"));
    }
    // The CHECKs are the point — bounds/status/positive-amount gates must survive the collapse.
    for (const check of [
      "account_balance_bounds_check",
      "ledger_line_amount_minor_positive_check",
      "ledger_line_direction_check",
      "ledger_account_name_nonempty_check",
      "ledger_entry_description_nonempty_check",
      "matter_status_check",
      "file_version_status_check",
      "location_status_check",
    ]) {
      expect(sql, check).toContain(check);
    }
    // The frozen-number partial UNIQUE index (a duplicate number within a firm is impossible).
    expect(sql).toContain(`WHERE "matter"."matter_number" IS NOT NULL`);
    expect(sql).not.toMatch(/__new_/u);
  });

  it("per-firm baseline preserves the directory full-text-search virtual table and its sync triggers", async () => {
    // The FTS5 table + its triggers are raw SQL, not part of the drizzle schema, so a naive
    // re-baseline would silently drop them — this guards that the collapse re-expressed them.
    const migrations = await loadLineage("per-firm");
    const sql = migrations[0]?.statements.join("\n") ?? "";
    expect(sql).toContain("CREATE VIRTUAL TABLE `directory_name_fts` USING fts5");
    for (const trigger of [
      "directory_name_fts_insert",
      "directory_name_fts_delete",
      "directory_name_fts_update",
    ]) {
      expect(sql, trigger).toContain(`CREATE TRIGGER \`${trigger}\``);
    }
  });

  it("per-firm baseline seeds the five default roles and the folded permission grants", async () => {
    const migrations = await loadLineage("per-firm");
    const statements = migrations[0]?.statements ?? [];

    const roleSeeds = statements
      .filter((statement) => statement.includes("INSERT INTO `role`"))
      .map(parseSingleRowInsert);
    const seededRoleNames = roleSeeds.map((seed) => String(seed.name)).toSorted();
    expect(seededRoleNames).toEqual([
      "Attorney",
      "Billing",
      "Owner/Admin",
      "Paralegal",
      "Read-only",
    ]);
    for (const seed of roleSeeds) {
      expect(isIdentifier(seed.id, "role"), String(seed.id)).toBe(true);
      expect(seed.created_at).toMatch(CANONICAL_INSTANT_PATTERN); // ISO-8601 instant
    }
    const ownerAdminId = roleSeeds.find((seed) => seed.name === "Owner/Admin")?.id;

    const grants = statements
      .filter((statement) => statement.includes("INSERT INTO `role_permission`"))
      .map(parseSingleRowInsert);
    const permissions = new Set(grants.map((grant) => String(grant.permission)));
    // Representative grants proving the folded seed migrations survived the collapse: RBAC (was
    // 0002), matters/files (was 0004), and the tools:* grants (was 0010 firmUsage … 0034 aiText).
    for (const permission of [
      "firm:manageMembers",
      "matters:create",
      "files:upload",
      "tools:firmUsage",
      "tools:aiTextDetection",
    ]) {
      expect(permissions.has(permission), permission).toBe(true);
    }
    // firm:manageMembers is Admin only; tools:aiTextDetection went to all five roles.
    const manageMembers = grants.filter((grant) => grant.permission === "firm:manageMembers");
    expect(manageMembers).toHaveLength(1);
    expect(manageMembers[0]?.role_id).toBe(ownerAdminId);
    expect(grants.filter((grant) => grant.permission === "tools:aiTextDetection")).toHaveLength(5);
  });

  it("the whole per-firm lineage creates index_split exactly once", async () => {
    // A second CREATE TABLE for a table an earlier migration already made would fail on every
    // already-provisioned firm — the failure mode a re-generated (rather than hand-extracted)
    // migration produces, since drizzle-kit diffs against the last committed snapshot.
    const migrations = await loadLineage("per-firm");
    const wholeLineage = migrations.map((migration) => migration.statements.join("\n")).join("\n");
    const creations = wholeLineage.match(/CREATE TABLE `index_split`/gu) ?? [];
    expect(creations).toHaveLength(1);
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

describe("migration ids stay monotonic and collision-free (fitness function)", () => {
  // Guards the timestamp-id scheme against a future hand-authored migration: every tag must be a
  // YYYYMMDDThhmmss_slug id, tags must be unique within a lineage, and the journal's dense idx must
  // stay a gapless 0..n-1 range. `scripts/timestamp-latest-migration.mjs` keeps generated migrations
  // conformant; this catches a stamp edited or added by hand.
  //
  // IT DOES NOT ASSERT THAT TAG ORDER MATCHES IDX ORDER — not because the two may disagree, but
  // because tooling/migration-integrity asserts it (applyOrderViolations) and the pre-push hook and
  // the gate's governance dimension run that on EVERY change, where this file's battery is the
  // gate's last and longest dimension. That is the whole reason the check moved: two inversions
  // merged in September 2026 with nothing failing, because the only assertion was here and the
  // hosted gate of the time ran the battery only when asked. Do not re-add it alongside; a guard in
  // two places is one that can disagree with itself.
  //
  // The remedy there is to RE-STAMP the incoming migration above the lineage head, which is free
  // while no database has applied it. It stops being free the moment one has: the applied ledger is
  // keyed by tag, and a tag a database holds but this code no longer knows is a hard refusal on wake
  // (src/migration-runner.ts, "deploy mismatch"). An inversion discovered after that point is
  // reported at apply time instead (runPendingMigrations, outOfOrderTags) and repaired with a new
  // migration, never by moving the tag.
  for (const lineage of ["control-plane", "per-firm"] as const) {
    it(`${lineage}: tags are unique, timestamp-formatted, and the idx range is dense`, async () => {
      const journal = JSON.parse(
        await readFile(join(DRIZZLE, lineage, "meta", "_journal.json"), "utf8"),
      ) as MigrationJournal;
      const entries = journal.entries;
      expect(entries.length).toBeGreaterThan(0);

      const tags = entries.map((entry) => entry.tag);
      expect(new Set(tags).size, `${lineage} has duplicate migration tags`).toBe(tags.length);
      for (const tag of tags) {
        expect(tag, `${lineage} migration ${tag} is not a timestamp id`).toMatch(TIMESTAMP_TAG);
      }

      // The journal's own integrity: a dense, gapless, duplicate-free 0..n-1 range, which is what
      // makes "the highest idx is the one just generated" true for the authoring scripts.
      const indexes = [...entries].map((entry) => entry.idx).toSorted((a, b) => a - b);
      expect(
        indexes,
        `${lineage} idx values are not the dense range 0..${entries.length - 1}`,
      ).toEqual(entries.map((_, position) => position));

      // Apply order is tag order, so it must be total: no tag may be a duplicate (asserted above)
      // and sorting must be deterministic. Pinned as the property the runtime actually reads.
      const byTag = [...tags].toSorted((a, b) => (a < b ? -1 : a > b ? 1 : 0));
      expect(new Set(byTag).size, `${lineage} tag order is not total`).toBe(entries.length);
    });
  }
});
