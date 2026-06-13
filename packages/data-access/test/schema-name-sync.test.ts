import { getTableConfig } from "drizzle-orm/sqlite-core";
import { describe, expect, it } from "vitest";
import { authAudit } from "@magna-carta/database/control-plane-schema";
import {
  directGrant,
  idempotencyKey,
  member,
  memberRole,
  outbox,
  rolePermission,
} from "@magna-carta/database/per-firm-schema";
import { AUTH_AUDIT_TABLE, insertAuthAuditStatement } from "../src/auth-audit-statements.ts";
import { IDEMPOTENCY_TABLE } from "../src/idempotency-statements.ts";
import {
  DIRECT_GRANT_TABLE,
  MEMBER_ROLE_TABLE,
  MEMBER_TABLE,
  ROLE_PERMISSION_TABLE,
  insertMemberStatement,
  insertRoleAssignmentStatement,
  selectMemberPermissionsStatements,
  selectMemberStatusStatement,
} from "../src/member-statements.ts";
import { OUTBOX_TABLE } from "../src/outbox-statements.ts";
import {
  insertCompletedIdempotencyRecordStatement,
  selectIdempotencyRecordStatement,
} from "../src/idempotency-statements.ts";
import { insertOutboxMessageStatement } from "../src/outbox-statements.ts";
import { captured, stubD1 } from "./support/stub-d1.ts";

// Fitness function: the raw SQL in this package must track @magna-carta/database's schema — the
// single source of truth. Renaming a table/column there fails here, not in production.

// Column lists appear inside ( ... ) after the table name and in SELECT/WHERE clauses; extract
// bare lowercase identifiers (SQL keywords are uppercase in the builders) and check each against
// the schema, ignoring known non-column tokens below.
const identifiers = (sql: string) => sql.match(/\b[a-z_]+\b/g) ?? [];

// Non-column tokens the extractor can hit: lowercase SQL keywords/functions, baked literal values
// ('pending', 'completed', 'active'), and the table names themselves. One set serves every block.
const sqlKeywords = new Set([
  "select",
  "from",
  "where",
  "insert",
  "into",
  "values",
  "delete",
  "case",
  "when",
  "then",
  "else",
  "end",
  "is",
  "null",
  "coalesce",
  "max",
  "and",
  "or",
  "not",
  "pending", // baked status literal on the idempotency statements
  "completed", // baked status literal on the idempotency statements
  "active", // baked status literal on the member insert
  IDEMPOTENCY_TABLE,
  OUTBOX_TABLE,
  MEMBER_TABLE,
  MEMBER_ROLE_TABLE,
  ROLE_PERMISSION_TABLE,
  DIRECT_GRANT_TABLE,
  AUTH_AUDIT_TABLE,
]);

describe("schema-name sync", () => {
  it("table name constants match the drizzle schema", () => {
    expect(IDEMPOTENCY_TABLE).toBe(getTableConfig(idempotencyKey).name);
    expect(OUTBOX_TABLE).toBe(getTableConfig(outbox).name);
    expect(MEMBER_TABLE).toBe(getTableConfig(member).name);
    expect(MEMBER_ROLE_TABLE).toBe(getTableConfig(memberRole).name);
    expect(ROLE_PERMISSION_TABLE).toBe(getTableConfig(rolePermission).name);
    expect(DIRECT_GRANT_TABLE).toBe(getTableConfig(directGrant).name);
    expect(AUTH_AUDIT_TABLE).toBe(getTableConfig(authAudit).name);
  });

  it("every column the SQL statements name exists in the schema", () => {
    const stub = stubD1();
    const idempotencyColumns = new Set(
      getTableConfig(idempotencyKey).columns.map((column) => column.name),
    );
    const outboxColumns = new Set(getTableConfig(outbox).columns.map((column) => column.name));

    const idempotencySql = [
      captured(selectIdempotencyRecordStatement(stub.database, "k")).sql,
      captured(
        insertCompletedIdempotencyRecordStatement(stub.database, {
          id: "idempotencyRecord_x" as never,
          key: "k",
          fingerprint: "f",
          responseCode: 200,
          responseBody: null,
          createdAt: "t",
        }),
      ).sql,
    ].join("\n");
    const outboxSql = captured(
      insertOutboxMessageStatement(stub.database, { topic: "t", payload: {} }, "t"),
    ).sql;

    for (const identifier of identifiers(idempotencySql)) {
      if (sqlKeywords.has(identifier)) continue;
      expect(idempotencyColumns.has(identifier), `idempotency SQL names "${identifier}"`).toBe(
        true,
      );
    }
    for (const identifier of identifiers(outboxSql)) {
      if (sqlKeywords.has(identifier)) continue;
      expect(outboxColumns.has(identifier), `outbox SQL names "${identifier}"`).toBe(true);
    }
  });

  it("every column the member-mirror and auth-audit SQL names exists in the schema", () => {
    const stub = stubD1();
    const userId = "user_x" as never;
    const reads = selectMemberPermissionsStatements(stub.database, userId);

    // Each statement is checked against the union of columns of EXACTLY the tables it touches.
    const checks: { label: string; sql: string; tables: Parameters<typeof getTableConfig>[0][] }[] =
      [
        {
          label: "member insert",
          sql: captured(
            insertMemberStatement(stub.database, { userId, displayName: "n", now: "t" }),
          ).sql,
          tables: [member],
        },
        {
          label: "role assignment insert",
          sql: captured(
            insertRoleAssignmentStatement(stub.database, {
              id: "memberRole_x" as never,
              memberUserId: userId,
              roleId: "role_x" as never,
            }),
          ).sql,
          tables: [memberRole],
        },
        {
          label: "role-permissions read",
          sql: captured(reads.rolePermissions).sql,
          // member rides along: the read gates on member.status = 'active'.
          tables: [rolePermission, memberRole, member],
        },
        {
          label: "direct-grants read",
          sql: captured(reads.directGrants).sql,
          // member rides along: the read gates on member.status = 'active'.
          tables: [directGrant, member],
        },
        {
          label: "member-status read",
          sql: captured(selectMemberStatusStatement(stub.database, userId)).sql,
          tables: [member],
        },
        {
          label: "auth-audit insert",
          sql: captured(
            insertAuthAuditStatement(stub.database, {
              id: "authAudit_x" as never,
              event: "e",
              userId: null,
              metadata: null,
              now: "t",
            }),
          ).sql,
          tables: [authAudit],
        },
      ];

    for (const check of checks) {
      const columns = new Set(
        check.tables.flatMap((table) => getTableConfig(table).columns.map((column) => column.name)),
      );
      for (const identifier of identifiers(check.sql)) {
        if (sqlKeywords.has(identifier)) continue;
        expect(columns.has(identifier), `${check.label} SQL names "${identifier}"`).toBe(true);
      }
    }
  });
});
