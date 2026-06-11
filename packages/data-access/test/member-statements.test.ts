import { describe, expect, it } from "vitest";
import { newIdentifier } from "@magna-carta/identifiers/generate";
import {
  assignRoleStatement,
  insertMemberStatement,
  selectMemberPermissionsStatements,
} from "../src/member-statements.ts";
import { captured, stubD1 } from "./support/stub-d1.ts";

describe("insertMemberStatement", () => {
  it("inserts an active member row binding user id, display name, and the instant", () => {
    const stub = stubD1();
    const userId = newIdentifier("user");
    const statement = captured(
      insertMemberStatement(stub.database, {
        userId,
        displayName: "Ada Lovelace",
        now: "2026-06-10T00:00:00.000Z",
      }),
    );
    expect(statement.sql).toContain("INSERT INTO member");
    expect(statement.sql).toContain("'active'");
    expect(statement.bindings).toEqual([userId, "Ada Lovelace", "2026-06-10T00:00:00.000Z"]);
  });

  it("carries ON CONFLICT DO NOTHING so an at-least-once replay is a no-op", () => {
    const stub = stubD1();
    const statement = captured(
      insertMemberStatement(stub.database, {
        userId: newIdentifier("user"),
        displayName: "Ada Lovelace",
        now: "2026-06-10T00:00:00.000Z",
      }),
    );
    expect(statement.sql).toContain("ON CONFLICT DO NOTHING");
  });
});

describe("assignRoleStatement", () => {
  it("inserts the assignment with ON CONFLICT DO NOTHING (replay-safe, UNIQUE-backed)", () => {
    const stub = stubD1();
    const id = newIdentifier("memberRole");
    const memberUserId = newIdentifier("user");
    const roleId = newIdentifier("role");
    const statement = captured(assignRoleStatement(stub.database, { id, memberUserId, roleId }));
    expect(statement.sql).toContain("INSERT INTO member_role");
    expect(statement.sql).toContain("ON CONFLICT DO NOTHING");
    expect(statement.bindings).toEqual([id, memberUserId, roleId]);
  });
});

describe("selectMemberPermissionsStatements", () => {
  it("role-permissions read joins member_role to role_permission on role_id for the member", () => {
    const stub = stubD1();
    const userId = newIdentifier("user");
    const { rolePermissions } = selectMemberPermissionsStatements(stub.database, userId);
    const statement = captured(rolePermissions);
    expect(statement.sql).toContain("FROM role_permission");
    expect(statement.sql).toContain("JOIN member_role");
    expect(statement.sql).toContain("member_role.role_id = role_permission.role_id");
    expect(statement.sql).toContain("member_role.member_user_id = ?1");
    expect(statement.bindings).toEqual([userId]);
  });

  it("grants read returns permission + expires_at WITHOUT filtering expiry in SQL (the resolver owns the boundary rule)", () => {
    const stub = stubD1();
    const userId = newIdentifier("user");
    const { directGrants } = selectMemberPermissionsStatements(stub.database, userId);
    const statement = captured(directGrants);
    expect(statement.sql).toContain(
      "SELECT permission, expires_at FROM direct_grant WHERE member_user_id = ?1",
    );
    // No expiry comparison and no clock binding — a grant expiring exactly at `now` is the
    // resolver's call, not SQL's.
    expect(statement.sql).not.toMatch(/expires_at\s*[<>=]/);
    expect(statement.bindings).toEqual([userId]);
  });
});
