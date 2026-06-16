import { getTableConfig, SQLiteTable } from "drizzle-orm/sqlite-core";
import { describe, expect, it } from "vitest";
import {
  directGrant,
  idempotencyKey,
  incident,
  member,
  memberRole,
  outbox,
  role,
  rolePermission,
} from "../src/per-firm-schema.ts";

const columnOf = (table: SQLiteTable, name: string) => {
  const config = getTableConfig(table);
  const found = config.columns.find((candidate) => candidate.name === name);
  if (!found) throw new Error(`expected column ${name} on ${config.name}`);
  return found;
};

// Unique constraints (drizzle `unique().on(...)`) as comparable column-name lists.
const uniqueConstraintColumnsOf = (table: SQLiteTable) =>
  getTableConfig(table).uniqueConstraints.map((constraint) =>
    constraint.columns.map((column) => column.name),
  );

describe("per-firm schema: idempotency_key", () => {
  it("matches the expected columns", () => {
    const config = getTableConfig(idempotencyKey);
    expect(config.name).toBe("idempotency_key");
    expect(columnOf(idempotencyKey, "id").primary).toBe(true);
    expect(columnOf(idempotencyKey, "key").notNull).toBe(true);
    expect(columnOf(idempotencyKey, "fingerprint").notNull).toBe(true);
    expect(columnOf(idempotencyKey, "status").notNull).toBe(true);
    expect(columnOf(idempotencyKey, "response_code").getSQLType()).toBe("integer");
    expect(columnOf(idempotencyKey, "response_body").notNull).toBe(false);
    expect(columnOf(idempotencyKey, "created_at").getSQLType()).toBe("text");
  });

  it("enforces UNIQUE(key) — the UNIQUE insert IS the concurrency guard", () => {
    const config = getTableConfig(idempotencyKey);
    const uniqueOnKey = config.indexes.some(
      (index) =>
        index.config.unique &&
        index.config.columns.some((column) => "name" in column && column.name === "key"),
    );
    expect(uniqueOnKey).toBe(true);
  });
});

describe("per-firm schema: outbox", () => {
  it("matches the expected columns", () => {
    const config = getTableConfig(outbox);
    expect(config.name).toBe("outbox");
    expect(columnOf(outbox, "id").primary).toBe(true);
    expect(columnOf(outbox, "topic").notNull).toBe(true);
    expect(columnOf(outbox, "payload").notNull).toBe(true);
    expect(columnOf(outbox, "aggregate_key").notNull).toBe(false);
    expect(columnOf(outbox, "seq").getSQLType()).toBe("integer");
    expect(columnOf(outbox, "attempts").notNull).toBe(true);
    expect(columnOf(outbox, "dispatched_at").notNull).toBe(false);
  });

  it("has the relay-sweep index on (status, created_at)", () => {
    const config = getTableConfig(outbox);
    const sweepIndex = config.indexes.find((index) =>
      index.config.columns.some((column) => "name" in column && column.name === "status"),
    );
    expect(sweepIndex).toBeDefined();
  });
});

describe("per-firm schema: member (the per-firm mirror of the control-plane user)", () => {
  it("is keyed by the GLOBAL user handle — the join key across planes, not a fresh id", () => {
    const config = getTableConfig(member);
    expect(config.name).toBe("member");
    expect(columnOf(member, "user_id").primary).toBe(true);
    expect(columnOf(member, "user_id").getSQLType()).toBe("text"); // usr_ handle
  });

  it("matches the expected columns", () => {
    expect(columnOf(member, "display_name").notNull).toBe(true);
    const status = columnOf(member, "status");
    expect(status.notNull).toBe(true);
    expect(status.default).toBe("active");
    expect(columnOf(member, "created_at").getSQLType()).toBe("text"); // ISO-8601 instant
  });
});

describe("per-firm schema: role + role_permission (roles as data)", () => {
  it("role matches the expected columns with a unique name", () => {
    const config = getTableConfig(role);
    expect(config.name).toBe("role");
    expect(columnOf(role, "id").primary).toBe(true);
    expect(columnOf(role, "id").getSQLType()).toBe("text"); // rol_ handle
    expect(columnOf(role, "name").notNull).toBe(true);
    expect(columnOf(role, "name").isUnique).toBe(true);
    expect(columnOf(role, "created_at").getSQLType()).toBe("text");
  });

  it("role_permission links role -> permission key, unique per pair", () => {
    const config = getTableConfig(rolePermission);
    expect(config.name).toBe("role_permission");
    expect(columnOf(rolePermission, "id").primary).toBe(true);
    expect(columnOf(rolePermission, "id").getSQLType()).toBe("text"); // rpm_ handle
    expect(columnOf(rolePermission, "role_id").notNull).toBe(true);
    expect(columnOf(rolePermission, "permission").notNull).toBe(true);
    expect(config.foreignKeys).toHaveLength(1); // role_id -> role.id
    expect(uniqueConstraintColumnsOf(rolePermission)).toEqual([["role_id", "permission"]]);
  });
});

describe("per-firm schema: member_role (assignment, unique per member+role)", () => {
  it("matches the expected columns and foreign keys", () => {
    const config = getTableConfig(memberRole);
    expect(config.name).toBe("member_role");
    expect(columnOf(memberRole, "id").primary).toBe(true);
    expect(columnOf(memberRole, "id").getSQLType()).toBe("text"); // mrl_ handle
    expect(columnOf(memberRole, "member_user_id").notNull).toBe(true);
    expect(columnOf(memberRole, "role_id").notNull).toBe(true);
    expect(config.foreignKeys).toHaveLength(2); // member_user_id -> member.user_id, role_id -> role.id
    expect(uniqueConstraintColumnsOf(memberRole)).toEqual([["member_user_id", "role_id"]]);
  });
});

describe("per-firm schema: direct_grant (per-member permission, optionally expiring)", () => {
  it("matches the expected columns", () => {
    const config = getTableConfig(directGrant);
    expect(config.name).toBe("direct_grant");
    expect(columnOf(directGrant, "id").primary).toBe(true);
    expect(columnOf(directGrant, "id").getSQLType()).toBe("text"); // gnt_ handle
    expect(columnOf(directGrant, "member_user_id").notNull).toBe(true);
    expect(columnOf(directGrant, "permission").notNull).toBe(true);
    expect(columnOf(directGrant, "expires_at").notNull).toBe(false); // null = no expiry
    expect(columnOf(directGrant, "expires_at").getSQLType()).toBe("text"); // ISO-8601 instant
    expect(columnOf(directGrant, "granted_by").notNull).toBe(true);
    expect(columnOf(directGrant, "created_at").notNull).toBe(true);
  });

  it("foreign-keys ONLY member_user_id — granted_by is an audit fact that must outlive the granter", () => {
    const config = getTableConfig(directGrant);
    expect(config.foreignKeys).toHaveLength(1); // member_user_id -> member.user_id
  });
});

describe("per-firm schema: incident (user-initiated incident intake)", () => {
  it("matches the column shape", () => {
    const config = getTableConfig(incident);
    expect(config.name).toBe("incident");
    expect(columnOf(incident, "id").primary).toBe(true);
    expect(columnOf(incident, "id").getSQLType()).toBe("text"); // incident_ handle
    expect(columnOf(incident, "error_ids").notNull).toBe(true); // JSON array of error_ handles (may be empty)
    expect(columnOf(incident, "breadcrumbs").notNull).toBe(true); // JSON array of { at, action, route }
    expect(columnOf(incident, "description").notNull).toBe(true); // firm-boundary now, protected() later
    expect(columnOf(incident, "context").notNull).toBe(true); // JSON { route, appVersion, clientAt }
    expect(columnOf(incident, "screenshot_key").notNull).toBe(false); // R2 seam, nullable; UI slice fills it
    const status = columnOf(incident, "status");
    expect(status.notNull).toBe(true);
    expect(status.default).toBe("open");
    expect(columnOf(incident, "reported_by").notNull).toBe(true);
    expect(columnOf(incident, "reported_by").getSQLType()).toBe("text"); // usr_ handle
    expect(columnOf(incident, "created_at").getSQLType()).toBe("text"); // ISO-8601 instant
  });

  it("has no foreign keys — reported_by is a usr_ handle the per-firm plane does not own", () => {
    // Like granted_by on direct_grant: the reporter handle is the global control-plane user id; the
    // per-firm plane carries no auth state to FK against.
    expect(getTableConfig(incident).foreignKeys).toHaveLength(0);
  });
});
