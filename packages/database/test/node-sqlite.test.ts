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
    // firm:manageMembers is seeded onto Owner/Admin ONLY.
    expect(grants.filter((grant) => grant.permission === "firm:manageMembers")).toEqual([
      { role_id: ownerAdmin?.id, permission: "firm:manageMembers" },
    ]);
    expect(grantsFor("Attorney")).not.toContain("firm:manageMembers");
    // firm:reportIncident is seeded onto EVERY default role — any member may file a diagnostic
    // incident.
    expect(
      grants
        .filter((grant) => grant.permission === "firm:reportIncident")
        .map((grant) => grant.role_id)
        .sort(),
    ).toEqual(roles.map((row) => row.id).sort());
    // The matters/locations/files grants extend the seed per the role distribution.
    expect(grantsFor("Owner/Admin")).toContain("matters:create");
    // Configuring the machine that files mail is narrower than filing mail: the two roles that own
    // the correspondence decision carry it by seed, and a paralegal receives it only by an explicit
    // firm grant. It is therefore absent from the Paralegal set asserted exhaustively below.
    expect(grantsFor("Owner/Admin")).toContain("emails:manageAutoFileRules");
    expect(grantsFor("Attorney")).toContain("emails:manageAutoFileRules");
    expect(grantsFor("Paralegal")).not.toContain("emails:manageAutoFileRules");
    // Reading every member's assistant conversation is a supervision capability and a separate grant
    // from being able to hold one, so it stops at Owner/Admin by seed.
    expect(grantsFor("Owner/Admin")).toContain("magnus:readAllConversations");
    expect(grantsFor("Attorney")).not.toContain("magnus:readAllConversations");
    expect(grantsFor("Paralegal")).not.toContain("magnus:readAllConversations");
    expect(grantsFor("Attorney")).toContain("magnus:converse");
    // Paralegal carries the practitioner set: file/matter work plus the firm-wide tools. The
    // firm-wide tool grants (whois/safeBrowse, scanFile, metadataScrubber, fileIntegrity,
    // fileTypeVerifier, aiTextDetection, decryption, fileRepair, ocr) and support:request are
    // seeded to every role; for aiTextDetection the consent setting, not the permission, gates
    // egress.
    // conflicts:read and conflicts:run are broad, everyday capabilities (any member may screen a
    // prospective matter or read back a completed check) and are likewise seeded to every role;
    // conflicts:dispose is narrower (adjudicating a hit) and stays limited to Owner/Admin and
    // Attorney, so it is absent here.
    expect(grantsFor("Paralegal").sort()).toEqual(
      [
        // Assembling a working bill asserts nothing to anybody, so billing:draft reaches the
        // practitioner set; turning one into evidence (billing:finalize) does not.
        "billing:draft",
        "billing:read",
        // A paralegal docketing a hearing is the ordinary case, so this role carries both calendar
        // keys; Billing and Read-only get calendar:read alone.
        "calendar:manage",
        "calendar:read",
        "conflicts:read",
        "conflicts:run",
        "costs:track",
        // A paralegal files originals into the safe and takes them back out, so this role carries
        // both custody keys; Billing and Read-only get custody:read alone.
        "custody:manage",
        "custody:read",
        "documents:assemble",
        "emails:file",
        "emails:manageLinks",
        "emails:read",
        "files:organize",
        "files:upload",
        "firm:reportIncident",
        "firm:scanFile",
        // The assistant reaches the seats that do legal work. Seeding the key turns nothing on:
        // both firm-level consent settings default closed and every route reads them first.
        // magnus:readAllConversations is Owner/Admin only, so it is absent here.
        "magnus:converse",
        // Logging what an estate owns is the paralegal's job, so this role carries both asset keys.
        // Unlike custody:read and calendar:read, neither reaches Billing or Read-only by seed: the
        // register concentrates a matter's financially sensitive facts in one surface, so a firm
        // that wants its bookkeeper on it grants that deliberately.
        "matterAssets:manage",
        "matterAssets:read",
        "matters:create",
        "support:request",
        "tools:aiTextDetection",
        "tools:decryption",
        "tools:emailInspector",
        "tools:fileIntegrity",
        "tools:fileRepair",
        "tools:fileTypeVerifier",
        "tools:metadataScrubber",
        "tools:ocr",
        "tools:safeBrowse",
        "tools:speedTest",
        // A paralegal answers "how much of this client's money do we hold"; moving it is
        // trust:manage, which they deliberately do not have.
        "trust:read",
        "tools:whois",
      ].sort(),
    );
    // Billing and Read-only carry only the every-role set (firm:reportIncident, the firm-wide
    // tools, support:request, conflicts:read/run, custody:read, emails:read); Billing additionally
    // carries costs:approve and both trust keys. custody:read is deliberately in the every-role set:
    // "do we hold the deed for this client" is a question a billing clerk legitimately asks, and
    // custody:manage — which moves originals — is exactly what they must not have. The trust keys go
    // the other way: a bookkeeper is exactly who records trust activity, so Billing carries both,
    // and Read-only carries neither.
    expect(grantsFor("Billing").sort()).toEqual(
      [
        // A billing clerk assembles the bill and records the money that comes back against it; the
        // approval that turns a draft into evidence is a partner's, so billing:finalize is absent.
        "billing:apply",
        "billing:draft",
        "billing:read",
        "calendar:read",
        "conflicts:read",
        "conflicts:run",
        "costs:approve",
        "custody:read",
        "emails:read",
        "firm:reportIncident",
        "firm:scanFile",
        "support:request",
        "trust:manage",
        "trust:read",
        "tools:aiTextDetection",
        "tools:decryption",
        "tools:emailInspector",
        "tools:fileIntegrity",
        "tools:fileRepair",
        "tools:fileTypeVerifier",
        "tools:metadataScrubber",
        "tools:ocr",
        "tools:safeBrowse",
        "tools:speedTest",
        "tools:whois",
      ].sort(),
    );
    expect(grantsFor("Read-only").sort()).toEqual(
      [
        // calendar:read reaches every default role, custody:read's line: "when is the hearing" is a
        // question every seat in a firm asks, and a case timeline some seats cannot see is one that
        // gets kept in a spreadsheet instead. Asserting when a hearing IS stays calendar:manage.
        "calendar:read",
        "conflicts:read",
        "conflicts:run",
        "custody:read",
        "emails:read",
        "firm:reportIncident",
        "firm:scanFile",
        "support:request",
        "tools:aiTextDetection",
        "tools:decryption",
        "tools:emailInspector",
        "tools:fileIntegrity",
        "tools:fileRepair",
        "tools:fileTypeVerifier",
        "tools:metadataScrubber",
        "tools:ocr",
        "tools:safeBrowse",
        "tools:speedTest",
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

  it("the control-plane baseline lands the firm lifecycle constraints (status default, nullable database_identifier, UNIQUE name)", () => {
    const raw = new DatabaseSync(":memory:");
    applyMigrations(raw, loadMigrationsFromDisk("control-plane"));
    // The provisioning lifecycle inserts the firm row before a database exists: database_identifier
    // is nullable and status defaults to 'active'.
    const insertNameOnly = raw.prepare(
      "INSERT INTO firm (id, name, status, created_at) VALUES (?, ?, ?, ?)",
    );
    insertNameOnly.run(
      "firm_aaaaaaaaaaaaaaaaaaaaa",
      "Provisioning Firm",
      "provisioning",
      "2026-01-05T09:00:00.000Z",
    );
    const row = raw
      .prepare(
        "SELECT status, bucket_name, owner_user_id, database_identifier FROM firm WHERE name = ?",
      )
      .get("Provisioning Firm") as {
      status: string;
      bucket_name: string | null;
      owner_user_id: string | null;
      database_identifier: string | null;
    };
    expect(row).toEqual({
      status: "provisioning",
      bucket_name: null,
      owner_user_id: null,
      database_identifier: null,
    });
    // status defaults to 'active' when omitted.
    raw
      .prepare("INSERT INTO firm (id, name, created_at) VALUES (?, ?, ?)")
      .run("firm_ddddddddddddddddddddd", "Active Firm", "2026-01-05T09:00:00.000Z");
    const active = raw.prepare("SELECT status FROM firm WHERE name = ?").get("Active Firm") as {
      status: string;
    };
    expect(active.status).toBe("active");
    // UNIQUE(name) holds.
    expect(() =>
      insertNameOnly.run(
        "firm_bbbbbbbbbbbbbbbbbbbbb",
        "Provisioning Firm",
        "provisioning",
        "2026-01-05T09:00:00.000Z",
      ),
    ).toThrow(/UNIQUE/);
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
