import { getTableConfig, SQLiteTable } from "drizzle-orm/sqlite-core";
import { describe, expect, it } from "vitest";
import {
  account,
  authAudit,
  firm,
  idempotencyKey,
  outbox,
  session,
  twoFactor,
  user,
  verification,
} from "../src/control-plane-schema.ts";
import * as perFirmSchema from "../src/per-firm-schema.ts";

const columnOf = (table: SQLiteTable, name: string) => {
  const config = getTableConfig(table);
  const found = config.columns.find((candidate) => candidate.name === name);
  if (!found) throw new Error(`expected column ${name} on ${config.name}`);
  return found;
};

describe("control-plane schema: firm registry", () => {
  const config = getTableConfig(firm);

  it("is the firm table with a firm_ handle TEXT primary key", () => {
    expect(config.name).toBe("firm");
    expect(columnOf(firm, "id").primary).toBe(true);
    expect(columnOf(firm, "id").getSQLType()).toBe("text");
  });

  it("keeps the firm name unique — the provisioner's resume identity", () => {
    expect(columnOf(firm, "name").notNull).toBe(true);
    expect(columnOf(firm, "name").isUnique).toBe(true);
  });

  it("tracks the backing D1 database and the mirrored per-firm schema version", () => {
    // Nullable: the provisioning row exists BEFORE its database does, so the firm id stays
    // stable across provisioning resumes. UNIQUE admits multiple NULLs in SQLite.
    expect(columnOf(firm, "database_identifier").notNull).toBe(false);
    expect(columnOf(firm, "database_identifier").isUnique).toBe(true);
    expect(columnOf(firm, "per_firm_schema_version").notNull).toBe(false); // null = not yet provisioned
    expect(columnOf(firm, "created_at").getSQLType()).toBe("text"); // ISO-8601 instant
  });

  it("carries the provisioning lifecycle: status defaults 'active', bucket_name nullable", () => {
    const status = columnOf(firm, "status");
    expect(status.notNull).toBe(true);
    expect(status.getSQLType()).toBe("text");
    expect(status.default).toBe("active"); // existing rows stay valid; the provisioner writes 'provisioning' first
    expect(columnOf(firm, "bucket_name").notNull).toBe(false); // null = bucket not provisioned yet
    expect(columnOf(firm, "bucket_name").getSQLType()).toBe("text");
  });

  it("records WHO owns the firm: owner_user_id nullable text, deliberately not a foreign key", () => {
    // Null while provisioning (the owner user does not exist yet) and for pre-lifecycle rows the
    // 0001 rebuild backfills; set in the same activation batch that inserts the owner user. No
    // foreign key: user.firm_id already references firm.id, and the reverse edge would make the
    // firm<->user pair circular — complicating every future rebuild of either table.
    const ownerUserId = columnOf(firm, "owner_user_id");
    expect(ownerUserId.notNull).toBe(false);
    expect(ownerUserId.getSQLType()).toBe("text");
    expect(getTableConfig(firm).foreignKeys).toHaveLength(0);
  });
});

describe("control-plane schema: Better Auth-owned tables (better-auth 1.6.16 reference)", () => {
  it("user matches the reference: snake_case columns, epoch-ms timestamps, boolean-mode integers", () => {
    expect(getTableConfig(user).name).toBe("user");
    expect(columnOf(user, "id").primary).toBe(true);
    expect(columnOf(user, "id").getSQLType()).toBe("text"); // usr_ handle via generateId
    expect(columnOf(user, "name").notNull).toBe(true);
    expect(columnOf(user, "email").notNull).toBe(true);
    expect(columnOf(user, "email").isUnique).toBe(true);
    expect(columnOf(user, "email_verified").getSQLType()).toBe("integer"); // boolean mode
    expect(columnOf(user, "email_verified").notNull).toBe(true);
    expect(columnOf(user, "image").notNull).toBe(false);
    expect(columnOf(user, "created_at").getSQLType()).toBe("integer"); // epoch-ms — the sanctioned Better Auth exception to our ISO-8601 text instants
    expect(columnOf(user, "updated_at").getSQLType()).toBe("integer");
  });

  it("user carries the twoFactor plugin field and OUR firmId additional field", () => {
    expect(columnOf(user, "two_factor_enabled").getSQLType()).toBe("integer"); // boolean mode
    expect(columnOf(user, "two_factor_enabled").notNull).toBe(false); // plugin field is optional
    const firmId = columnOf(user, "firm_id");
    expect(firmId.notNull).toBe(true);
    expect(getTableConfig(user).foreignKeys).toHaveLength(1); // firm_id -> firm.id
  });

  it("session matches the reference: unique token, epoch-ms instants, cascade to user", () => {
    expect(getTableConfig(session).name).toBe("session");
    expect(columnOf(session, "id").primary).toBe(true);
    expect(columnOf(session, "id").getSQLType()).toBe("text"); // ses_ handle
    expect(columnOf(session, "expires_at").notNull).toBe(true);
    expect(columnOf(session, "token").notNull).toBe(true);
    expect(columnOf(session, "token").isUnique).toBe(true);
    expect(columnOf(session, "updated_at").notNull).toBe(true);
    expect(columnOf(session, "ip_address").notNull).toBe(false);
    expect(columnOf(session, "user_agent").notNull).toBe(false);
    expect(columnOf(session, "user_id").notNull).toBe(true);
    expect(getTableConfig(session).foreignKeys).toHaveLength(1); // user_id -> user.id ON DELETE CASCADE
    expect(getTableConfig(session).foreignKeys[0]?.onDelete).toBe("cascade");
  });

  it("account matches the reference: credential + oauth columns, nullable token expiries", () => {
    expect(getTableConfig(account).name).toBe("account");
    expect(columnOf(account, "id").primary).toBe(true);
    expect(columnOf(account, "id").getSQLType()).toBe("text"); // acc_ handle
    expect(columnOf(account, "account_id").notNull).toBe(true);
    expect(columnOf(account, "provider_id").notNull).toBe(true);
    expect(columnOf(account, "user_id").notNull).toBe(true);
    expect(columnOf(account, "access_token").notNull).toBe(false);
    expect(columnOf(account, "refresh_token").notNull).toBe(false);
    expect(columnOf(account, "id_token").notNull).toBe(false);
    expect(columnOf(account, "access_token_expires_at").notNull).toBe(false);
    expect(columnOf(account, "refresh_token_expires_at").notNull).toBe(false);
    expect(columnOf(account, "scope").notNull).toBe(false);
    expect(columnOf(account, "password").notNull).toBe(false); // hashed by Better Auth, never plaintext
    expect(getTableConfig(account).foreignKeys).toHaveLength(1); // user_id -> user.id ON DELETE CASCADE
    expect(getTableConfig(account).foreignKeys[0]?.onDelete).toBe("cascade");
  });

  it("verification matches the reference", () => {
    expect(getTableConfig(verification).name).toBe("verification");
    expect(columnOf(verification, "id").primary).toBe(true);
    expect(columnOf(verification, "id").getSQLType()).toBe("text"); // ver_ handle
    expect(columnOf(verification, "identifier").notNull).toBe(true);
    expect(columnOf(verification, "value").notNull).toBe(true);
    expect(columnOf(verification, "expires_at").notNull).toBe(true);
  });

  it("two_factor matches the reference", () => {
    expect(getTableConfig(twoFactor).name).toBe("two_factor");
    expect(columnOf(twoFactor, "id").primary).toBe(true);
    expect(columnOf(twoFactor, "id").getSQLType()).toBe("text"); // twf_ handle
    expect(columnOf(twoFactor, "secret").notNull).toBe(true);
    expect(columnOf(twoFactor, "backup_codes").notNull).toBe(true);
    expect(columnOf(twoFactor, "user_id").notNull).toBe(true);
    expect(columnOf(twoFactor, "verified").notNull).toBe(false); // optional, defaults true in the reference
    expect(getTableConfig(twoFactor).foreignKeys).toHaveLength(1); // user_id -> user.id ON DELETE CASCADE
    expect(getTableConfig(twoFactor).foreignKeys[0]?.onDelete).toBe("cascade");
  });
});

describe("control-plane schema: auth_audit (our table — house conventions)", () => {
  it("matches the expected columns", () => {
    expect(getTableConfig(authAudit).name).toBe("auth_audit");
    expect(columnOf(authAudit, "id").primary).toBe(true);
    expect(columnOf(authAudit, "id").getSQLType()).toBe("text"); // aud_ handle
    expect(columnOf(authAudit, "event").notNull).toBe(true);
    expect(columnOf(authAudit, "user_id").notNull).toBe(false); // null for pre-identification events
    expect(columnOf(authAudit, "metadata").notNull).toBe(false); // redacted JSON
    expect(columnOf(authAudit, "created_at").notNull).toBe(true);
    expect(columnOf(authAudit, "created_at").getSQLType()).toBe("text"); // ISO-8601 instant
  });

  it("does NOT foreign-key user_id — audit rows must outlive the user row they describe", () => {
    expect(getTableConfig(authAudit).foreignKeys).toHaveLength(0);
  });
});

describe("control-plane schema: outbox + idempotency_key are verbatim copies of per-firm", () => {
  const shapeOf = (table: SQLiteTable) =>
    getTableConfig(table).columns.map((column) => ({
      name: column.name,
      type: column.getSQLType(),
      notNull: column.notNull,
      primary: column.primary,
      default: column.default,
      enumValues: column.enumValues,
    }));

  const indexShapeOf = (table: SQLiteTable) =>
    getTableConfig(table).indexes.map((tableIndex) => ({
      name: tableIndex.config.name,
      unique: tableIndex.config.unique,
      columns: tableIndex.config.columns.map((column) => {
        if (!("name" in column)) {
          throw new Error(`expected a plain indexed column in ${tableIndex.config.name}`);
        }
        return column.name;
      }),
    }));

  it("idempotency_key shape matches per-firm column-for-column", () => {
    expect(shapeOf(idempotencyKey)).toEqual(shapeOf(perFirmSchema.idempotencyKey));
  });

  it("outbox shape matches per-firm column-for-column", () => {
    expect(shapeOf(outbox)).toEqual(shapeOf(perFirmSchema.outbox));
  });

  it("idempotency_key indexes match per-firm exactly — name, unique flag, ordered columns", () => {
    expect(indexShapeOf(idempotencyKey)).toEqual(indexShapeOf(perFirmSchema.idempotencyKey));
    expect(indexShapeOf(idempotencyKey)).toEqual([
      { name: "idempotency_key_key_unique_index", unique: true, columns: ["key"] },
      { name: "idempotency_key_created_at_index", unique: false, columns: ["created_at"] },
    ]);
  });

  it("outbox indexes match per-firm exactly — name, unique flag, ordered columns", () => {
    expect(indexShapeOf(outbox)).toEqual(indexShapeOf(perFirmSchema.outbox));
    expect(indexShapeOf(outbox)).toEqual([
      { name: "outbox_status_created_at_index", unique: false, columns: ["status", "created_at"] },
    ]);
  });
});
