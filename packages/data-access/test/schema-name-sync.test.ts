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
  assignRoleStatement,
  insertMemberStatement,
  selectMemberPermissionsStatements,
} from "../src/member-statements.ts";
import { OUTBOX_TABLE } from "../src/outbox-statements.ts";
import {
  insertCompletedIdempotencyRecordStatement,
  selectIdempotencyRecordStatement,
} from "../src/idempotency-statements.ts";
import { insertOutboxMessageStatement } from "../src/outbox-statements.ts";
import { captured, stubD1 } from "./support/stub-d1.ts";

// Fitness function: the raw SQL in this package must track @magna-carta/database's schema — the
// single source of truth (ADR-0065). Renaming a table/column there fails here, not in production.
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
          id: "idr_x" as never,
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

    // Column lists appear inside ( ... ) after the table name and in SELECT/WHERE clauses; extract
    // bare identifiers and check each against the schema (ignoring SQL keywords and table names).
    const identifiers = (sql: string) => sql.match(/\b[a-z_]+\b/g) ?? [];
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
      "pending",
      "completed",
      IDEMPOTENCY_TABLE,
      OUTBOX_TABLE,
    ]);
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
    const userId = "usr_x" as never;
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
            assignRoleStatement(stub.database, {
              id: "mrl_x" as never,
              memberUserId: userId,
              roleId: "rol_x" as never,
            }),
          ).sql,
          tables: [memberRole],
        },
        {
          label: "role-permissions read",
          sql: captured(reads.rolePermissions).sql,
          tables: [rolePermission, memberRole],
        },
        {
          label: "direct-grants read",
          sql: captured(reads.directGrants).sql,
          tables: [directGrant],
        },
        {
          label: "auth-audit insert",
          sql: captured(
            insertAuthAuditStatement(stub.database, {
              id: "aud_x" as never,
              event: "e",
              userId: null,
              metadata: null,
              now: "t",
            }),
          ).sql,
          tables: [authAudit],
        },
      ];

    const sqlKeywords = new Set([
      "active", // baked status literal on the member insert
      MEMBER_TABLE,
      MEMBER_ROLE_TABLE,
      ROLE_PERMISSION_TABLE,
      DIRECT_GRANT_TABLE,
      AUTH_AUDIT_TABLE,
    ]);
    const identifiers = (sql: string) => sql.match(/\b[a-z_]+\b/g) ?? [];
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
