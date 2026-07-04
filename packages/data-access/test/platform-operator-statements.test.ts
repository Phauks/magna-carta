import { expect, test } from "vitest";
import {
  insertPlatformOperatorStatement,
  selectActivePlatformOperatorStatement,
} from "../src/platform-operator-statements.ts";

function fakeDb() {
  const calls: { sql: string; bound: unknown[] }[] = [];
  const db = {
    prepare(sql: string) {
      const record = { sql, bound: [] as unknown[] };
      calls.push(record);
      const stmt = {
        bind(...values: unknown[]) {
          record.bound = values;
          return stmt;
        },
        async run() {
          return { meta: { changes: 1 } };
        },
        async all<T>() {
          return { results: [] as T[] };
        },
      };
      return stmt;
    },
  };
  return { db, calls };
}

test("select filters unexpired operators and joins the user 2FA flag", () => {
  const { db, calls } = fakeDb();
  selectActivePlatformOperatorStatement(db as never, "usr_1" as never, "2026-07-02T00:00:00.000Z");
  expect(calls[0]?.sql).toContain("platform_operator");
  expect(calls[0]?.sql).toContain("two_factor_enabled");
  expect(calls[0]?.sql).toContain("expires_at IS NULL OR");
  expect(calls[0]?.bound).toEqual(["usr_1", "2026-07-02T00:00:00.000Z"]);
});

test("insert is idempotent (ON CONFLICT DO NOTHING) and binds all columns", () => {
  const { db, calls } = fakeDb();
  insertPlatformOperatorStatement(db as never, {
    userId: "usr_1" as never,
    grantedByUserId: "usr_2" as never,
    grantedAt: "2026-07-02T00:00:00.000Z",
    expiresAt: null,
    note: "bootstrap",
  });
  expect(calls[0]?.sql).toContain("ON CONFLICT DO NOTHING");
  expect(calls[0]?.bound).toEqual([
    "usr_1",
    "2026-07-02T00:00:00.000Z",
    "usr_2",
    null,
    "bootstrap",
  ]);
});
