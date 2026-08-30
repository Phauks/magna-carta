import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { newIdentifier } from "@magna-carta/identifiers/generate";
import type { UserId } from "@magna-carta/identifiers/types";
import {
  insertMemberStatement,
  insertRoleAssignmentStatement,
  selectFirmMembersStatement,
  selectMemberPermissionsStatements,
  ROLE_NAME_SEPARATOR,
  type FirmMemberRow,
} from "../src/member-statements.ts";
import { captured, stubD1 } from "./support/stub-d1.ts";

// The replay no-op rests on SQLite semantics the stub cannot prove: ON CONFLICT DO NOTHING must
// swallow BOTH the member PK conflict and member_role's UNIQUE(member_user_id, role_id) — a replay
// arrives with a freshly minted mrl_ handle, so the PK alone would not dedupe it. These tests run
// the REAL builder SQL against real SQLite (node:sqlite) to pin those facts.
describe("member statements against real SQLite (replay no-op + read shape)", () => {
  function setupDatabase() {
    const database = new DatabaseSync(":memory:");
    // Mirrors drizzle/per-firm/0002_member-rbac.sql (names guarded by schema-name-sync.test.ts);
    // foreign keys omitted — parent rows are out of scope here, and the pinned facts don't involve FKs.
    database.exec(
      `CREATE TABLE member (
        user_id TEXT PRIMARY KEY,
        display_name TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'active',
        created_at TEXT NOT NULL
      );
      CREATE TABLE role (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL UNIQUE,
        created_at TEXT NOT NULL
      );
      CREATE TABLE role_permission (
        id TEXT PRIMARY KEY,
        role_id TEXT NOT NULL,
        permission TEXT NOT NULL,
        UNIQUE (role_id, permission)
      );
      CREATE TABLE member_role (
        id TEXT PRIMARY KEY,
        member_user_id TEXT NOT NULL,
        role_id TEXT NOT NULL,
        UNIQUE (member_user_id, role_id)
      );
      CREATE TABLE direct_grant (
        id TEXT PRIMARY KEY,
        member_user_id TEXT NOT NULL,
        permission TEXT NOT NULL,
        expires_at TEXT,
        granted_by TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE TABLE member_professional_profile (
        member_user_id TEXT PRIMARY KEY,
        title TEXT,
        admissions TEXT,
        direct_dial TEXT,
        professional_email TEXT,
        signature_block TEXT,
        updated_at TEXT NOT NULL
      );`,
    );
    return database;
  }

  // The EXACT SQL and binding order the production builders emit, captured via the stub.
  function capturedStatement(build: (database: ReturnType<typeof stubD1>["database"]) => unknown) {
    const statement = captured(build(stubD1().database));
    return { sql: statement.sql, bindings: statement.bindings as (string | null)[] };
  }

  it("replayed member insert no-ops and never overwrites a later display_name edit", () => {
    const database = setupDatabase();
    const userId = newIdentifier("user");
    const insert = capturedStatement((stub) =>
      insertMemberStatement(stub, {
        userId,
        displayName: "Ada Lovelace",
        now: "2026-06-10T00:00:00.000Z",
      }),
    );
    database.prepare(insert.sql).run(...insert.bindings);
    database.prepare("UPDATE member SET display_name = 'Ada King' WHERE user_id = ?1").run(userId);
    database.prepare(insert.sql).run(...insert.bindings); // at-least-once redelivery
    const rows = database.prepare("SELECT user_id, display_name, status FROM member").all() as {
      user_id: string;
      display_name: string;
      status: string;
    }[];
    expect(rows.length).toBe(1);
    expect(rows[0]?.display_name).toBe("Ada King");
    expect(rows[0]?.status).toBe("active");
  });

  it("replayed role assignment no-ops even with a freshly minted id (UNIQUE conflict, not PK)", () => {
    const database = setupDatabase();
    const memberUserId = newIdentifier("user");
    const roleId = newIdentifier("role");
    const original = capturedStatement((stub) =>
      insertRoleAssignmentStatement(stub, {
        id: newIdentifier("memberRole"),
        memberUserId,
        roleId,
      }),
    );
    const replay = capturedStatement((stub) =>
      insertRoleAssignmentStatement(stub, {
        id: newIdentifier("memberRole"),
        memberUserId,
        roleId,
      }),
    );
    database.prepare(original.sql).run(...original.bindings);
    database.prepare(replay.sql).run(...replay.bindings);
    const rows = database.prepare("SELECT id FROM member_role").all() as { id: string }[];
    expect(rows.length).toBe(1);
    expect(rows[0]?.id).toBe(original.bindings[0]);
  });

  function insertMember(
    database: DatabaseSync,
    userId: string,
    status: "active" | "deactivated",
  ): void {
    database
      .prepare(
        "INSERT INTO member (user_id, display_name, status, created_at) VALUES (?1, ?2, ?3, ?4)",
      )
      .run(userId, "Test Member", status, "2026-06-10T00:00:00.000Z");
  }

  it("permission reads return rows shaped for direct pass-through to the resolver, expiry unfiltered", () => {
    const database = setupDatabase();
    const userId = newIdentifier("user");
    const otherUserId = newIdentifier("user");
    const roleId = newIdentifier("role");
    const otherRoleId = newIdentifier("role");
    // Both members ACTIVE — the reads gate on member.status, so the rows below are reachable.
    insertMember(database, userId, "active");
    insertMember(database, otherUserId, "active");
    database
      .prepare("INSERT INTO role (id, name, created_at) VALUES (?1, ?2, ?3)")
      .run(roleId, "Attorney", "2026-06-10T00:00:00.000Z");
    database
      .prepare("INSERT INTO role (id, name, created_at) VALUES (?1, ?2, ?3)")
      .run(otherRoleId, "Billing", "2026-06-10T00:00:00.000Z");
    database
      .prepare("INSERT INTO role_permission (id, role_id, permission) VALUES (?1, ?2, ?3)")
      .run(newIdentifier("rolePermission"), roleId, "firm:manageMembers");
    database
      .prepare("INSERT INTO role_permission (id, role_id, permission) VALUES (?1, ?2, ?3)")
      .run(newIdentifier("rolePermission"), otherRoleId, "firm:provision"); // unheld role — must not leak
    database
      .prepare("INSERT INTO member_role (id, member_user_id, role_id) VALUES (?1, ?2, ?3)")
      .run(newIdentifier("memberRole"), userId, roleId);
    const grantedBy = newIdentifier("user");
    const insertGrant = database.prepare(
      "INSERT INTO direct_grant (id, member_user_id, permission, expires_at, granted_by, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
    );
    insertGrant.run(
      newIdentifier("grant"),
      userId,
      "firm:provision",
      "2026-01-01T00:00:00.000Z", // already expired — the SQL must STILL return it
      grantedBy,
      "2025-12-01T00:00:00.000Z",
    );
    insertGrant.run(
      newIdentifier("grant"),
      userId,
      "firm:manageMembers",
      null,
      grantedBy,
      "2025-12-01T00:00:00.000Z",
    );
    insertGrant.run(
      newIdentifier("grant"),
      otherUserId, // someone else's grant — must not leak
      "firm:provision",
      null,
      grantedBy,
      "2025-12-01T00:00:00.000Z",
    );

    const reads = selectMemberPermissionsStatements(stubD1().database, userId as UserId);
    const rolePermissionsRead = captured(reads.rolePermissions);
    const directGrantsRead = captured(reads.directGrants);
    const rolePermissionRows = database
      .prepare(rolePermissionsRead.sql)
      .all(...(rolePermissionsRead.bindings as string[])) as { permission: string }[];
    const directGrantRows = database
      .prepare(directGrantsRead.sql)
      .all(...(directGrantsRead.bindings as string[])) as {
      permission: string;
      expires_at: string | null;
    }[];

    // Exactly the resolver's RolePermissionRow / DirectGrantRow shapes — no extra columns.
    expect(rolePermissionRows.map((row) => ({ ...row }))).toEqual([
      { permission: "firm:manageMembers" },
    ]);
    expect(
      directGrantRows
        .map((row) => ({ ...row }))
        .sort((a, b) => (a.permission < b.permission ? -1 : 1)),
    ).toEqual([
      { permission: "firm:manageMembers", expires_at: null },
      { permission: "firm:provision", expires_at: "2026-01-01T00:00:00.000Z" },
    ]);
  });

  it("a deactivated member's reads both return EMPTY — roles and grants alike (the read-path gate)", () => {
    const database = setupDatabase();
    const userId = newIdentifier("user");
    const roleId = newIdentifier("role");
    insertMember(database, userId, "deactivated");
    database
      .prepare("INSERT INTO role (id, name, created_at) VALUES (?1, ?2, ?3)")
      .run(roleId, "Attorney", "2026-06-10T00:00:00.000Z");
    database
      .prepare("INSERT INTO role_permission (id, role_id, permission) VALUES (?1, ?2, ?3)")
      .run(newIdentifier("rolePermission"), roleId, "firm:manageMembers");
    database
      .prepare("INSERT INTO member_role (id, member_user_id, role_id) VALUES (?1, ?2, ?3)")
      .run(newIdentifier("memberRole"), userId, roleId);
    database
      .prepare(
        "INSERT INTO direct_grant (id, member_user_id, permission, expires_at, granted_by, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
      )
      .run(
        newIdentifier("grant"),
        userId,
        "firm:provision",
        null, // unexpired — only the deactivation gate can exclude it
        newIdentifier("user"),
        "2025-12-01T00:00:00.000Z",
      );

    const reads = selectMemberPermissionsStatements(stubD1().database, userId as UserId);
    const rolePermissionsRead = captured(reads.rolePermissions);
    const directGrantsRead = captured(reads.directGrants);
    const rolePermissionRows = database
      .prepare(rolePermissionsRead.sql)
      .all(...(rolePermissionsRead.bindings as string[]));
    const directGrantRows = database
      .prepare(directGrantsRead.sql)
      .all(...(directGrantsRead.bindings as string[]));

    expect(rolePermissionRows).toEqual([]);
    expect(directGrantRows).toEqual([]);
  });

  // The roster read packs a member's roles into one column and asks whether a profile exists — two
  // correlated subqueries the stub cannot evaluate. Real SQLite is what proves the column names, the
  // separator, and the three shapes a row can take.
  it("reads the whole roster in one row per member, roles packed and profile presence flagged", () => {
    const database = setupDatabase();
    const attorneyRoleId = newIdentifier("role");
    const billingRoleId = newIdentifier("role");
    for (const [id, name] of [
      [attorneyRoleId, "Attorney"],
      [billingRoleId, "Billing"],
    ] as const) {
      database
        .prepare("INSERT INTO role (id, name, created_at) VALUES (?1, ?2, ?3)")
        .run(id, name, "2026-06-10T00:00:00.000Z");
    }

    // Three members, deliberately inserted out of display order so the ORDER BY has to do work: one
    // holding two roles with a profile, one departed with one role, one holding no role at all.
    const twoRoles = newIdentifier("user");
    const departed = newIdentifier("user");
    const roleless = newIdentifier("user");
    for (const [userId, displayName, status] of [
      [twoRoles, "Zara Okonkwo", "active"],
      [departed, "Cormac Vale", "deactivated"],
      [roleless, "Bea Nightingale", "active"],
    ] as const) {
      database
        .prepare(
          "INSERT INTO member (user_id, display_name, status, created_at) VALUES (?1, ?2, ?3, ?4)",
        )
        .run(userId, displayName, status, "2026-06-10T00:00:00.000Z");
    }
    for (const [memberUserId, roleId] of [
      [twoRoles, attorneyRoleId],
      [twoRoles, billingRoleId],
      [departed, attorneyRoleId],
    ] as const) {
      database
        .prepare("INSERT INTO member_role (id, member_user_id, role_id) VALUES (?1, ?2, ?3)")
        .run(newIdentifier("memberRole"), memberUserId, roleId);
    }
    database
      .prepare(
        "INSERT INTO member_professional_profile (member_user_id, updated_at) VALUES (?1, ?2)",
      )
      .run(twoRoles, "2026-06-10T00:00:00.000Z");

    const read = captured(selectFirmMembersStatement(stubD1().database));
    const rows = database.prepare(read.sql).all() as unknown as FirmMemberRow[];

    // Ordered by display name — a roster, not an arbitrary set.
    expect(rows.map((row) => row.displayName)).toEqual([
      "Bea Nightingale",
      "Cormac Vale",
      "Zara Okonkwo",
    ]);
    // A departed member is READ, with the status that says so: they still hold matters.
    expect(rows[1]?.status).toBe("deactivated");

    const packed = rows[2];
    expect(packed?.roleNames?.split(ROLE_NAME_SEPARATOR).sort()).toEqual(["Attorney", "Billing"]);
    expect(packed?.hasProfessionalProfile).toBe(1);
    // No role at all is NULL, not an empty string — the caller reads that as an empty list rather
    // than as one role with no name.
    expect(rows[0]?.roleNames).toBeNull();
    expect(rows[0]?.hasProfessionalProfile).toBe(0);
  });
});
