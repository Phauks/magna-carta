import { describe, expect, it } from "vitest";
import {
  PLATFORM_STAFF_TABLE,
  SUPPORT_GRANT_TABLE,
  cosignSupportGrantStatement,
  insertPlatformStaffStatement,
  insertSupportGrantStatement,
  redeemSupportGrantStatement,
  revokeSupportGrantStatement,
  selectFirmSupportGrantsStatement,
  selectSupportGrantStatement,
} from "../src/support-access-statements.ts";
import type { SqlDatabase, SqlStatement } from "../src/idempotency-statements.ts";

// A recording fake: captures the SQL + bound args so we assert on the built statement.
function recorder(): { db: SqlDatabase; calls: { sql: string; args: unknown[] }[] } {
  const calls: { sql: string; args: unknown[] }[] = [];
  const db: SqlDatabase = {
    prepare(sql: string): SqlStatement {
      const call = { sql, args: [] as unknown[] };
      const stmt: SqlStatement = {
        sql,
        bind(...values: unknown[]) {
          call.args = values;
          calls.push(call);
          return stmt;
        },
        async run() {
          return { meta: { changes: 1 } };
        },
        async all<T = Record<string, unknown>>() {
          return { results: [] as T[] };
        },
      };
      return stmt;
    },
  };
  return { db, calls };
}

describe("support-access statements", () => {
  it("inserts a platform staff row with positional bindings", () => {
    const { db, calls } = recorder();
    insertPlatformStaffStatement(db, {
      id: "platformStaff_abc",
      email: "dana@example.com",
      displayName: "Dana",
      role: "support",
      now: "2026-06-26T00:00:00.000Z",
    } as never);
    expect(calls[0]?.sql).toContain(PLATFORM_STAFF_TABLE);
    expect(calls[0]?.args).toEqual([
      "platformStaff_abc",
      "dana@example.com",
      "Dana",
      "support",
      "2026-06-26T00:00:00.000Z",
    ]);
  });

  it("inserts a support grant row", () => {
    const { db, calls } = recorder();
    insertSupportGrantStatement(db, {
      id: "supportGrant_1",
      firmId: "firm_1",
      requestedByUserId: "user_1",
      tier: "diagnostic",
      status: "active",
      reason: "page errors",
      requiresCosign: false,
      expiresAt: "2026-06-26T02:00:00.000Z",
      now: "2026-06-26T00:00:00.000Z",
    } as never);
    expect(calls[0]?.sql).toContain(SUPPORT_GRANT_TABLE);
    expect(calls[0]?.args[0]).toBe("supportGrant_1");
    expect(calls[0]?.args).toContain("diagnostic");
  });

  it("redeem sets principal only when grant is active and is guarded by firm_id", () => {
    const { db, calls } = recorder();
    redeemSupportGrantStatement(db, {
      id: "supportGrant_1",
      principalId: "platformStaff_abc",
      firmId: "firm_1",
    } as never);
    expect(calls[0]?.sql).toContain("status = 'active'");
    expect(calls[0]?.sql).toContain("firm_id = ?");
    expect(calls[0]?.args).toEqual(["platformStaff_abc", "supportGrant_1", "firm_1"]);
  });

  it("cosign flips requested → active and is guarded by firm_id", () => {
    const { db, calls } = recorder();
    cosignSupportGrantStatement(db, {
      id: "supportGrant_1",
      cosignedByUserId: "user_admin",
      firmId: "firm_1",
    } as never);
    expect(calls[0]?.sql).toContain("'requested'");
    expect(calls[0]?.sql).toContain("'active'");
    expect(calls[0]?.sql).toContain("firm_id = ?");
  });

  it("revoke guards against terminal states and is guarded by firm_id", () => {
    const { db, calls } = recorder();
    revokeSupportGrantStatement(db, { id: "supportGrant_1", firmId: "firm_1" } as never);
    expect(calls[0]?.sql).toContain("'revoked'");
    expect(calls[0]?.sql).toContain("status = 'active'");
    expect(calls[0]?.sql).toContain("firm_id = ?");
  });

  it("select-by-id and select-firm-grants build statements", () => {
    const { db, calls } = recorder();
    selectSupportGrantStatement(db, "supportGrant_1" as never);
    selectFirmSupportGrantsStatement(db, "firm_1" as never);
    expect(calls[0]?.args).toEqual(["supportGrant_1"]);
    expect(calls[1]?.args).toEqual(["firm_1"]);
    expect(calls[1]?.sql).toContain("ORDER BY");
  });
});
