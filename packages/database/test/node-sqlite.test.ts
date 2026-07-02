import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import {
  applyMigrations,
  loadMigrationsFromDisk,
  nodeSqliteBatchDatabase,
} from "../src/node-sqlite.ts";

function freshPerFirmDatabase() {
  const raw = new DatabaseSync(":memory:");
  applyMigrations(raw, loadMigrationsFromDisk("per-firm"));
  return raw;
}

describe("node:sqlite D1-shaped adapter (dev/test only)", () => {
  it("applies the committed per-firm migrations — ledger tables exist", () => {
    const raw = freshPerFirmDatabase();
    const tables = raw
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
      .all() as { name: string }[];
    const names = tables.map((table) => table.name);
    for (const expected of [
      "account_balance",
      "idempotency_key",
      "ledger_account",
      "ledger_entry",
      "ledger_line",
      "outbox",
      "member",
      "role",
      "role_permission",
      "member_role",
      "direct_grant",
    ]) {
      expect(names).toContain(expected);
    }
  });

  it("the role seeds actually execute: five default roles with their default grants", () => {
    const raw = freshPerFirmDatabase();
    const roles = raw.prepare("SELECT id, name FROM role ORDER BY name").all() as {
      id: string;
      name: string;
    }[];
    expect(roles.map((row) => row.name)).toEqual([
      "Attorney",
      "Billing",
      "Owner/Admin",
      "Paralegal",
      "Read-only",
    ]);
    const grants = raw.prepare("SELECT role_id, permission FROM role_permission").all() as {
      role_id: string;
      permission: string;
    }[];
    const grantsFor = (name: string) => {
      const roleId = roles.find((row) => row.name === name)?.id;
      return grants.filter((grant) => grant.role_id === roleId).map((grant) => grant.permission);
    };
    const ownerAdmin = roles.find((row) => row.name === "Owner/Admin");
    // firm:manageMembers is seeded onto Owner/Admin ONLY (0002_member-rbac.sql).
    expect(grants.filter((grant) => grant.permission === "firm:manageMembers")).toEqual([
      { role_id: ownerAdmin?.id, permission: "firm:manageMembers" },
    ]);
    expect(grantsFor("Attorney")).not.toContain("firm:manageMembers");
    // firm:reportIncident is seeded onto EVERY default role (0003_incident-intake.sql) — any member
    // may file a diagnostic incident.
    expect(
      grants
        .filter((grant) => grant.permission === "firm:reportIncident")
        .map((grant) => grant.role_id)
        .sort(),
    ).toEqual(roles.map((row) => row.id).sort());
    // The matters/locations/files grants (0004) extend the seed per the role distribution.
    expect(grantsFor("Owner/Admin")).toContain("matters:create");
    // Paralegal: firm:reportIncident (0003) + matters:create + files upload/organize (0004)
    // + tools:whois/safeBrowse (0017) + firm:scanFile (0019) + tools:metadataScrubber (0020)
    // + tools:fileIntegrity (0022) + costs:track (0028) + support:request (0029 — seeded to every role so any member can request help)
    // + tools:fileTypeVerifier (0032).
    expect(grantsFor("Paralegal").sort()).toEqual(
      [
        "costs:track",
        "files:organize",
        "files:upload",
        "firm:reportIncident",
        "firm:scanFile",
        "matters:create",
        "support:request",
        "tools:fileIntegrity",
        "tools:fileTypeVerifier",
        "tools:metadataScrubber",
        "tools:safeBrowse",
        "tools:whois",
      ].sort(),
    );
    // Billing and Read-only carry firm:reportIncident (0003) + tools:whois/safeBrowse (0017) +
    // firm:scanFile (0019) + tools:metadataScrubber (0020) + tools:fileIntegrity (0022) +
    // tools:fileTypeVerifier (0032) by default (all seeded to every role); Billing additionally
    // carries costs:approve (0028); support:request (0029) by default (all seeded to every role).
    expect(grantsFor("Billing").sort()).toEqual(
      [
        "costs:approve",
        "firm:reportIncident",
        "firm:scanFile",
        "support:request",
        "tools:fileIntegrity",
        "tools:fileTypeVerifier",
        "tools:metadataScrubber",
        "tools:safeBrowse",
        "tools:whois",
      ].sort(),
    );
    expect(grantsFor("Read-only").sort()).toEqual(
      [
        "firm:reportIncident",
        "firm:scanFile",
        "support:request",
        "tools:fileIntegrity",
        "tools:fileTypeVerifier",
        "tools:metadataScrubber",
        "tools:safeBrowse",
        "tools:whois",
      ].sort(),
    );
  });

  it("prepare/bind/run/all round-trips and batch() is atomic (all-or-nothing)", async () => {
    const raw = freshPerFirmDatabase();
    const database = nodeSqliteBatchDatabase(raw);
    const goodInsert = database
      .prepare(
        "INSERT INTO ledger_account (id, name, type, currency, active, created_at) VALUES (?1, ?2, 'asset', 'USD', 1, ?3)",
      )
      .bind("ledgerAccount_aaaaaaaaaaaaaaaaaaaaa", "Operating Bank", "2026-01-05T09:00:00.000Z");
    // Second statement violates the name CHECK — the whole batch must roll back.
    const badInsert = database
      .prepare(
        "INSERT INTO ledger_account (id, name, type, currency, active, created_at) VALUES (?1, ?2, 'asset', 'USD', 1, ?3)",
      )
      .bind("ledgerAccount_bbbbbbbbbbbbbbbbbbbbb", "", "2026-01-05T09:00:00.000Z");
    await expect(database.batch([goodInsert, badInsert])).rejects.toThrow(/CHECK/);
    const { results } = await database
      .prepare("SELECT COUNT(*) AS n FROM ledger_account")
      .bind()
      .all<{ n: number }>();
    expect(results[0]?.n).toBe(0); // nothing committed
  });

  it("control-plane 0001 rebuild backfills a 0000-era firm row and lands the new constraints", () => {
    const raw = new DatabaseSync(":memory:");
    const [firmRegistry, authAndProvisioning] = loadMigrationsFromDisk("control-plane");
    if (firmRegistry === undefined || authAndProvisioning === undefined)
      throw new Error("control-plane lineage is shorter than the two migrations this test pins");
    applyMigrations(raw, [firmRegistry]);
    raw
      .prepare(
        "INSERT INTO firm (id, name, database_identifier, per_firm_schema_version, created_at) VALUES (?, ?, ?, ?, ?)",
      )
      .run(
        "firm_aaaaaaaaaaaaaaaaaaaaa",
        "Legacy Firm",
        "legacy-database",
        null,
        "2026-01-05T09:00:00.000Z",
      );
    applyMigrations(raw, [authAndProvisioning]);
    // The pre-lifecycle row survives the rebuild with the expand-contract backfill values.
    const row = raw
      .prepare(
        "SELECT status, bucket_name, owner_user_id, database_identifier FROM firm WHERE name = ?",
      )
      .get("Legacy Firm") as {
      status: string;
      bucket_name: string | null;
      owner_user_id: string | null;
      database_identifier: string;
    };
    expect(row).toEqual({
      status: "active",
      bucket_name: null,
      owner_user_id: null, // pre-lifecycle rows have no recorded owner
      database_identifier: "legacy-database",
    });
    // UNIQUE(name) holds post-rebuild, and database_identifier is now nullable (the provisioning
    // lifecycle inserts the firm row before a database exists).
    const insertNameOnly = raw.prepare(
      "INSERT INTO firm (id, name, status, created_at) VALUES (?, ?, 'provisioning', ?)",
    );
    expect(() =>
      insertNameOnly.run("firm_bbbbbbbbbbbbbbbbbbbbb", "Legacy Firm", "2026-01-05T09:00:00.000Z"),
    ).toThrow(/UNIQUE/);
    insertNameOnly.run(
      "firm_ccccccccccccccccccccc",
      "Provisioning Firm",
      "2026-01-05T09:00:00.000Z",
    );
  });

  it("run() outside a batch autocommits independently", async () => {
    const raw = freshPerFirmDatabase();
    const database = nodeSqliteBatchDatabase(raw);
    const { meta } = await database
      .prepare(
        "INSERT INTO ledger_account (id, name, type, currency, active, created_at) VALUES (?1, ?2, 'asset', 'USD', 1, ?3)",
      )
      .bind("ledgerAccount_ccccccccccccccccccccc", "Trust Bank", "2026-01-05T09:00:00.000Z")
      .run();
    expect(meta.changes).toBe(1);
    // Visible immediately through the raw handle — committed, not held in an open transaction.
    const row = raw
      .prepare("SELECT name FROM ledger_account WHERE id = ?")
      .get("ledgerAccount_ccccccccccccccccccccc") as { name: string };
    expect(row.name).toBe("Trust Bank");
  });
});
