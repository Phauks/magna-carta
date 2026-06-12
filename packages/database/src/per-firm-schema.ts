import {
  check,
  index,
  integer,
  sqliteTable,
  text,
  unique,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";
import type { AnySQLiteColumn } from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";
import type {
  GrantId,
  IdempotencyRecordId,
  LedgerAccountId,
  LedgerEntryId,
  LedgerLineId,
  MemberRoleId,
  OutboxId,
  RoleId,
  RolePermissionId,
  UserId,
} from "@magna-carta/identifiers/types";

// PER-FIRM LINEAGE. Every tenant firm's D1 carries these tables; drizzle-kit generates per-firm
// migrations from this file (ADR-0065). The BEHAVIOR over these tables (middleware, relay) lives in
// @magna-carta/data-access — this package only defines the structure.

// Idempotency records (ADR-0063). The UNIQUE(key) insert inside the effect's transaction IS the
// concurrency guard — exactly-once with no separate lock.
export const idempotencyKey = sqliteTable(
  "idempotency_key",
  {
    id: text("id").primaryKey().$type<IdempotencyRecordId>(), // idr_ handle (server record id)
    key: text("key").notNull(), // client-supplied Idempotency-Key
    fingerprint: text("fingerprint").notNull(), // hash(method + path + canonical body)
    status: text("status", { enum: ["in_progress", "completed"] }).notNull(),
    responseCode: integer("response_code"), // captured on completion
    responseBody: text("response_body"), // captured on completion, redacted per ADR-0038
    createdAt: text("created_at").notNull(), // ISO-8601 instant (ADR-0055); TTL purge keys off this
  },
  (table) => [
    uniqueIndex("idempotency_key_key_unique_index").on(table.key),
    index("idempotency_key_created_at_index").on(table.createdAt),
  ],
);

// Transactional outbox (ADR-0064): the effect row commits in the SAME D1 transaction as the business
// change; the relay sweeps pending rows to Queues.
export const outbox = sqliteTable(
  "outbox",
  {
    id: text("id").primaryKey().$type<OutboxId>(), // obx_ handle
    topic: text("topic").notNull(), // e.g. 'payment.capture', 'comms.send'
    payload: text("payload").notNull(), // JSON: ids + non-privileged fields ONLY (ADR-0038)
    aggregateKey: text("aggregate_key"), // ordering scope for ordered topics
    seq: integer("seq"), // monotonic within aggregate_key
    status: text("status", { enum: ["pending", "dispatched", "failed"] }).notNull(),
    attempts: integer("attempts").notNull().default(0),
    createdAt: text("created_at").notNull(),
    dispatchedAt: text("dispatched_at"),
  },
  (table) => [index("outbox_status_created_at_index").on(table.status, table.createdAt)],
);

// Per-firm RBAC (ADR-0068): roles are DATA, permissions are registry keys. The permission registry
// and the effective-permissions resolver live in @magna-carta/access-control — this package only
// defines the structure. Auth state (credentials, sessions) never lives here: it is control-plane only.

// The per-firm mirror of the control-plane user. Keyed by the GLOBAL usr_ handle — the join key
// across planes (white paper, Core domain) — never a fresh per-firm id.
export const member = sqliteTable("member", {
  userId: text("user_id").primaryKey().$type<UserId>(), // the global join key (white paper)
  displayName: text("display_name").notNull(),
  status: text("status", { enum: ["active", "deactivated"] })
    .notNull()
    .default("active"),
  createdAt: text("created_at").notNull(), // ISO-8601 instant (ADR-0055)
});

// A named bundle of permissions. Five defaults are seeded by migration — the seeded handles are
// committed literals; see drizzle/per-firm/0002_member-rbac.sql.
export const role = sqliteTable("role", {
  id: text("id").primaryKey().$type<RoleId>(), // rol_ handle
  name: text("name").notNull().unique(),
  createdAt: text("created_at").notNull(),
});

// role -> permission key. The value is a registry key from @magna-carta/access-control — a fitness
// test cross-checks every seeded value against the registry.
export const rolePermission = sqliteTable(
  "role_permission",
  {
    id: text("id").primaryKey().$type<RolePermissionId>(), // rpm_ handle
    roleId: text("role_id")
      .notNull()
      .$type<RoleId>()
      .references(() => role.id),
    permission: text("permission").notNull(),
  },
  (table) => [unique().on(table.roleId, table.permission)],
);

// Assignment: which members hold which roles. UNIQUE makes a duplicate assignment structurally
// impossible — a racing duplicate fails loud instead of double-assigning.
export const memberRole = sqliteTable(
  "member_role",
  {
    id: text("id").primaryKey().$type<MemberRoleId>(), // mrl_ handle
    memberUserId: text("member_user_id")
      .notNull()
      .$type<UserId>()
      .references(() => member.userId),
    roleId: text("role_id")
      .notNull()
      .$type<RoleId>()
      .references(() => role.id),
  },
  (table) => [unique().on(table.memberUserId, table.roleId)],
);

// A per-member permission outside any role, optionally expiring. granted_by is deliberately NOT a
// foreign key — the audit fact must outlive the granter's member row. No UNIQUE on
// (member_user_id, permission): rows with distinct expiry/granter are distinct audit facts, and the
// effective-permissions resolver unions them.
export const directGrant = sqliteTable(
  "direct_grant",
  {
    id: text("id").primaryKey().$type<GrantId>(), // gnt_ handle
    memberUserId: text("member_user_id")
      .notNull()
      .$type<UserId>()
      .references(() => member.userId),
    permission: text("permission").notNull(),
    expiresAt: text("expires_at"), // null = no expiry; ISO-8601 instant (ADR-0055)
    grantedBy: text("granted_by").notNull().$type<UserId>(),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    // The per-request authorization read is WHERE member_user_id = ? — index the FK lookup column.
    index("direct_grant_member_user_id_index").on(table.memberUserId),
  ],
);

// Append-only double-entry ledger (ADR-0008, posting model ADR-0072). Structure only — the posting
// service, validation, and balance composition live in @magna-carta/ledger.

// The structural account model — no chart-of-accounts product (Phase 3 adds it on this schema).
// Normal balance is DERIVED IN CODE from `type` (asset/expense = debit-normal), never a column.
export const ledgerAccount = sqliteTable(
  "ledger_account",
  {
    id: text("id").primaryKey().$type<LedgerAccountId>(), // acct_ handle
    name: text("name").notNull(),
    type: text("type", {
      enum: ["asset", "liability", "equity", "income", "expense"],
    }).notNull(),
    currency: text("currency").notNull(), // ISO-4217; always USD now; lines inherit (ADR-0061)
    parentAccountId: text("parent_account_id")
      .$type<LedgerAccountId>()
      .references((): AnySQLiteColumn => ledgerAccount.id), // subledger seam; children share type+currency
    active: integer("active").notNull().default(1), // soft close — accounts are never deleted
    createdAt: text("created_at").notNull(), // UTC instant (ADR-0055)
  },
  (table) => [
    index("ledger_account_parent_account_id_index").on(table.parentAccountId),
    check("ledger_account_name_nonempty_check", sql`length(${table.name}) > 0`),
    // Drizzle text enums are type-level only (same rationale as ledger_line_direction_check): an
    // unknown type silently reads as credit-normal everywhere, inverting every balance delta on
    // the account with no fitness signal — the DDL refuses it on permanent rows.
    check(
      "ledger_account_type_check",
      sql`${table.type} IN ('asset', 'liability', 'equity', 'income', 'expense')`,
    ),
  ],
);

// The transaction header. APPEND-ONLY: no UPDATE/DELETE ever targets this table; reversed status is
// derived from the reverses link, never a mutated flag.
export const ledgerEntry = sqliteTable(
  "ledger_entry",
  {
    id: text("id").primaryKey().$type<LedgerEntryId>(), // led_ handle
    description: text("description").notNull(),
    effectiveDate: text("effective_date").notNull(), // YYYY-MM-DD civil date — backdatable bookkeeping fact
    recordedAt: text("recorded_at").notNull(), // UTC instant — system-set, immutable audit truth
    reversesEntryId: text("reverses_entry_id")
      .$type<LedgerEntryId>()
      .references((): AnySQLiteColumn => ledgerEntry.id),
  },
  (table) => [
    // UNIQUE makes double-reversal structurally impossible — a racing duplicate's batch rolls back.
    // SQLite UNIQUE permits many NULLs, so unreversed entries are unaffected.
    uniqueIndex("ledger_entry_reverses_entry_id_unique_index").on(table.reversesEntryId),
    index("ledger_entry_effective_date_index").on(table.effectiveDate),
    check("ledger_entry_description_nonempty_check", sql`length(${table.description}) > 0`),
  ],
);

// The money. Direction is DATA + amounts are always positive: a sign-flip cannot be expressed
// (ADR-0072 — the line-encoding decision). Currency is inherited from the account.
export const ledgerLine = sqliteTable(
  "ledger_line",
  {
    id: text("id").primaryKey().$type<LedgerLineId>(), // lln_ handle
    entryId: text("entry_id")
      .notNull()
      .$type<LedgerEntryId>()
      .references(() => ledgerEntry.id),
    accountId: text("account_id")
      .notNull()
      .$type<LedgerAccountId>()
      .references(() => ledgerAccount.id),
    lineIndex: integer("line_index").notNull(), // stable display/export order
    direction: text("direction", { enum: ["debit", "credit"] }).notNull(),
    amountMinor: integer("amount_minor").notNull(), // 2dp minor units (ADR-0061)
  },
  (table) => [
    uniqueIndex("ledger_line_entry_id_line_index_unique_index").on(table.entryId, table.lineIndex),
    index("ledger_line_account_id_index").on(table.accountId),
    check("ledger_line_amount_minor_positive_check", sql`${table.amountMinor} > 0`),
    // Drizzle text enums are type-level only — the direction constraint is stated as an explicit
    // CHECK so the DDL enforces it (defense in depth on permanent rows — ADR-0072, line encoding).
    check("ledger_line_direction_check", sql`${table.direction} IN ('debit', 'credit')`),
  ],
);

// Materialized balance in NORMAL-BALANCE terms (positive = normal), one row per account, created in
// the same batch as the account. The CHECK is the enforcement mechanism: a bounds violation inside a
// posting batch aborts the WHOLE transaction — D1's only batch-abort primitive (ADR-0072/ADR-0009).
export const accountBalance = sqliteTable(
  "account_balance",
  {
    accountId: text("account_id")
      .primaryKey()
      .$type<LedgerAccountId>()
      .references(() => ledgerAccount.id),
    balanceMinor: integer("balance_minor").notNull().default(0),
    minBalanceMinor: integer("min_balance_minor"), // NULL = unbounded; trust sets 0 in Phase 3
    maxBalanceMinor: integer("max_balance_minor"),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    check(
      "account_balance_bounds_check",
      sql`(${table.minBalanceMinor} IS NULL OR ${table.balanceMinor} >= ${table.minBalanceMinor}) AND (${table.maxBalanceMinor} IS NULL OR ${table.balanceMinor} <= ${table.maxBalanceMinor})`,
    ),
  ],
);
