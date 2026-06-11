import { getTableConfig, SQLiteTable } from "drizzle-orm/sqlite-core";
import { describe, expect, it } from "vitest";
import * as controlPlaneSchema from "../src/control-plane-schema.ts";
import * as perFirmSchema from "../src/per-firm-schema.ts";
import { BETTER_AUTH_TABLE_NAMES } from "./better-auth-table-names.ts";

// Every drizzle table exported by either lineage. New tables are enumerated automatically —
// these fitness functions bind to the whole schema surface, not a hand-kept list.
const ALL_TABLES = (
  [...Object.values(controlPlaneSchema), ...Object.values(perFirmSchema)] as unknown[]
).filter((candidate): candidate is SQLiteTable => candidate instanceof SQLiteTable);

describe("schema conformance (fitness functions)", () => {
  it("found the expected tables (guards the enumeration itself)", () => {
    // control-plane: firm + the five Better Auth tables + auth_audit + outbox + idempotency_key (9);
    // per-firm: idempotency_key, outbox, ledger_account, ledger_entry, ledger_line, account_balance,
    // member, role, role_permission, member_role, direct_grant (11).
    expect(ALL_TABLES.length).toBeGreaterThanOrEqual(20);
  });

  it("auth tables exist ONLY in the control-plane lineage — never in the per-firm schema", () => {
    // Tenancy boundary (ADR-0003): credentials and sessions live in the control plane; each firm's
    // D1 carries only the member MIRROR (keyed by the global user handle), never auth state.
    const perFirmTableNames = new Set(
      (Object.values(perFirmSchema) as unknown[])
        .filter((candidate): candidate is SQLiteTable => candidate instanceof SQLiteTable)
        .map((table) => getTableConfig(table).name),
    );
    for (const authTableName of BETTER_AUTH_TABLE_NAMES) {
      expect(perFirmTableNames.has(authTableName), authTableName).toBe(false);
    }
  });

  it("every table's primary key is a TEXT identifier handle named id (ADR-0062)", () => {
    // Sanctioned exceptions: 1:1 extension tables keyed by the OWNING entity's handle. The primary
    // key is still a TEXT identifier handle (ADR-0062) — it is the owner's, not a fresh one.
    // account_balance is the materialized balance row of its ledger_account (ADR-0072).
    // member is the per-firm mirror of the control-plane user — keyed by the GLOBAL usr_ handle,
    // the join key across planes (white paper, Core domain).
    const extensionTablePrimaryKeyNames: Record<string, string> = {
      account_balance: "account_id",
      member: "user_id",
    };
    for (const table of ALL_TABLES) {
      const config = getTableConfig(table);
      const primaryColumns = config.columns.filter((column) => column.primary);
      expect(primaryColumns, config.name).toHaveLength(1);
      expect(primaryColumns[0]?.name, config.name).toBe(
        extensionTablePrimaryKeyNames[config.name] ?? "id",
      );
      expect(primaryColumns[0]?.getSQLType(), config.name).toBe("text");
    }
  });

  it("no money column is a float: *_minor and *_rate_e4 must be INTEGER (ADR-0061)", () => {
    for (const table of ALL_TABLES) {
      const config = getTableConfig(table);
      for (const column of config.columns) {
        if (column.name.endsWith("_minor") || column.name.endsWith("_rate_e4")) {
          expect(column.getSQLType(), `${config.name}.${column.name}`).toBe("integer");
        }
      }
    }
  });

  it("no column anywhere is REAL — float money can never sneak in under another name", () => {
    // If a legitimately-float column ever appears (it has not yet), add an explicit allowlist HERE
    // with a comment justifying it — the default posture is no floats in a legal/financial schema.
    for (const table of ALL_TABLES) {
      const config = getTableConfig(table);
      for (const column of config.columns) {
        expect(column.getSQLType(), `${config.name}.${column.name}`).not.toBe("real");
      }
    }
  });

  it("timestamp columns are ISO-8601 TEXT in our tables; epoch-ms INTEGER in Better Auth's (ADR-0055)", () => {
    // *_at catches every timestamp column either lineage uses (created_at, updated_at, expires_at,
    // dispatched_at, recorded_at, …). Better Auth-owned tables are the scoped exception — their
    // drizzle adapter reads and writes epoch-millisecond integers (mode "timestamp_ms").
    for (const table of ALL_TABLES) {
      const config = getTableConfig(table);
      const expectedType = BETTER_AUTH_TABLE_NAMES.has(config.name) ? "integer" : "text";
      for (const column of config.columns) {
        if (column.name.endsWith("_at")) {
          expect(column.getSQLType(), `${config.name}.${column.name}`).toBe(expectedType);
        }
      }
    }
  });

  it("money-ish column names must use the storage-encoding suffixes (*_minor / *_rate_e4)", () => {
    const moneyName = /(amount|balance|total|price|fee|cost)(_|$)/;
    for (const table of ALL_TABLES) {
      const config = getTableConfig(table);
      for (const column of config.columns) {
        if (moneyName.test(column.name)) {
          const suffixed = column.name.endsWith("_minor") || column.name.endsWith("_rate_e4");
          expect(suffixed, `${config.name}.${column.name} must be *_minor or *_rate_e4`).toBe(true);
        }
      }
    }
  });
});
