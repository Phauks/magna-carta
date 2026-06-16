import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";
import type {
  AccountId,
  AuthAuditId,
  FirmId,
  IdempotencyRecordId,
  OutboxId,
  SessionId,
  TwoFactorId,
  UserId,
  VerificationId,
} from "@magna-carta/identifiers/types";

// CONTROL-PLANE LINEAGE. The firm registry: one row per tenant firm, in the single control-plane D1.
// This file is the source of truth drizzle-kit generates control-plane migrations from — schema changes
// happen HERE, never by hand-editing SQL.
export const firm = sqliteTable("firm", {
  // The firm_ handle is both primary key and public id.
  id: text("id").primaryKey().$type<FirmId>(),
  // UNIQUE: the firm name is the provisioner's RESUME IDENTITY — a crashed
  // provisioning run re-invoked with the same name must find its own partial row, and firm ids
  // are CSPRNG handles minted per attempt, so the name is the only stable client-supplied handle.
  // Platform-admin-controlled input on a fleet of ~1; revisit if self-serve signup ever exists.
  name: text("name").notNull().unique(),
  // The Cloudflare D1 database backing this firm (the database UUID from the Cloudflare API;
  // locally a dev-pool binding name). Null = the provisioner has not created/claimed it yet —
  // the firm row is inserted FIRST so the firm id is stable across provisioning resumes.
  // UNIQUE still holds (SQLite unique indexes admit multiple NULLs).
  databaseIdentifier: text("database_identifier").unique(),
  // Mirror of the firm database's latest applied migration tag (fleet-wide visibility).
  // Null = the firm database has not been provisioned yet. Tags order lexicographically (NNNN_ prefix).
  perFirmSchemaVersion: text("per_firm_schema_version"),
  // Provisioning lifecycle: the provisioner writes 'provisioning' first and flips to 'active' once
  // the firm's resources exist. The DEFAULT keeps pre-lifecycle rows valid (expand-contract).
  status: text("status").notNull().default("active"),
  // The per-firm R2 bucket backing this firm. Null = the bucket has not been provisioned yet.
  bucketName: text("bucket_name"),
  // WHO owns the firm: set in the same activation batch that inserts the owner user
  // — the provisioner's already-active no-op matches the REQUESTED owner against this column, so a
  // mere invited member's email cannot impersonate the owner. Null while provisioning and for
  // pre-lifecycle rows. Deliberately NOT a foreign key: user.firm_id already references firm.id,
  // and the reverse edge would make the firm<->user pair circular.
  ownerUserId: text("owner_user_id").$type<UserId>(),
  // The firm's data key, sealed under the root key-encryption key — the wrapped form that never
  // leaves the control plane in the clear. Null = not yet minted (the key-mint sweep fills it for
  // active firms); nulling it is also the crypto-shred mechanism, after which the firm's protected
  // values become permanently unreadable. The unwrap/cache lives in @magna-carta/data-access.
  wrappedFirmKey: text("wrapped_firm_key"),
  // Which key version the wrapped data key is at, and which root key-encryption key version sealed
  // it. Both default 1 so pre-mint rows are valid (expand-contract); rotation bumps them.
  firmKeyVersion: integer("firm_key_version").notNull().default(1),
  rootKeyVersion: integer("root_key_version").notNull().default(1),
  // ISO-8601 UTC instant.
  createdAt: text("created_at").notNull(),
});

// BETTER AUTH-OWNED TABLES. Transcribed from better-auth 1.6.16's own table definitions (getAuthTables
// with emailAndPassword + the twoFactor plugin + our firmId additional field) — Better Auth NEVER runs
// migrations; this file stays the source of truth and the generate output is reference material only.
// Storage is what Better Auth's drizzle adapter expects: snake_case columns, epoch-MILLISECOND integer
// timestamps (mode "timestamp_ms"), boolean-mode integers — the one sanctioned exception to the
// house ISO-8601 text-timestamp convention, scoped to these five tables. Ids are still our prefixed
// handles: the auth config's generateId hook mints them.

export const user = sqliteTable("user", {
  id: text("id").primaryKey().$type<UserId>(), // usr_ handle
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: integer("email_verified", { mode: "boolean" }).notNull().default(false),
  image: text("image"),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" })
    .notNull()
    .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`),
  // The twoFactor plugin's user flag — optional in Better Auth's reference, defaults false.
  twoFactorEnabled: integer("two_factor_enabled", { mode: "boolean" }).default(false),
  // OUR additional field: every user belongs to exactly one tenant firm.
  firmId: text("firm_id")
    .notNull()
    .$type<FirmId>()
    .references(() => firm.id),
});

export const session = sqliteTable(
  "session",
  {
    id: text("id").primaryKey().$type<SessionId>(), // ses_ handle
    expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
    token: text("token").notNull().unique(),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    userId: text("user_id")
      .notNull()
      .$type<UserId>()
      .references(() => user.id, { onDelete: "cascade" }),
  },
  // The better-auth 1.6.16 reference generator marks user_id `index: true`.
  (table) => [index("session_user_id_index").on(table.userId)],
);

export const account = sqliteTable(
  "account",
  {
    id: text("id").primaryKey().$type<AccountId>(), // acc_ handle
    accountId: text("account_id").notNull(), // provider-side account id; equals user id for credentials
    providerId: text("provider_id").notNull(), // 'credential' for email-and-password
    userId: text("user_id")
      .notNull()
      .$type<UserId>()
      .references(() => user.id, { onDelete: "cascade" }),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: integer("access_token_expires_at", { mode: "timestamp_ms" }),
    refreshTokenExpiresAt: integer("refresh_token_expires_at", { mode: "timestamp_ms" }),
    scope: text("scope"),
    password: text("password"), // Better Auth stores the scrypt hash, never plaintext
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
  },
  // The better-auth 1.6.16 reference generator marks user_id `index: true`.
  (table) => [index("account_user_id_index").on(table.userId)],
);

export const verification = sqliteTable(
  "verification",
  {
    id: text("id").primaryKey().$type<VerificationId>(), // ver_ handle
    identifier: text("identifier").notNull(),
    value: text("value").notNull(),
    expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
      .notNull()
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`),
  },
  // The better-auth 1.6.16 reference generator marks identifier `index: true`.
  (table) => [index("verification_identifier_index").on(table.identifier)],
);

export const twoFactor = sqliteTable(
  "two_factor",
  {
    id: text("id").primaryKey().$type<TwoFactorId>(), // twf_ handle
    secret: text("secret").notNull(), // encrypted TOTP secret (Better Auth encrypts before storing)
    backupCodes: text("backup_codes").notNull(), // encrypted, Better Auth-managed
    userId: text("user_id")
      .notNull()
      .$type<UserId>()
      .references(() => user.id, { onDelete: "cascade" }),
    verified: integer("verified", { mode: "boolean" }).default(true),
  },
  // The twoFactor plugin schema marks secret and user_id `index: true`.
  (table) => [
    index("two_factor_secret_index").on(table.secret),
    index("two_factor_user_id_index").on(table.userId),
  ],
);

// OUR CONTROL-PLANE TABLES — house conventions resume here: ISO-8601 UTC text timestamps.

// Auth audit trail: sign-in/sign-out/2FA lifecycle events. user_id is deliberately NOT a foreign key —
// audit rows must outlive the user row they describe, and pre-identification events (e.g. a failed
// sign-in) have no user at all.
export const authAudit = sqliteTable("auth_audit", {
  id: text("id").primaryKey().$type<AuthAuditId>(), // aud_ handle
  event: text("event").notNull(), // e.g. 'sign_in.success', 'two_factor.enabled'
  userId: text("user_id").$type<UserId>(), // null for pre-identification events
  metadata: text("metadata"), // JSON: ids + non-privileged fields ONLY, redacted (never privileged content)
  createdAt: text("created_at").notNull(), // ISO-8601 instant
});

// Control-plane copies of the reliability tables — same shapes as the per-firm lineage so the
// data-access middleware and relay run identically against either database.

// Idempotency records. The UNIQUE(key) insert inside the effect's transaction IS the
// concurrency guard — exactly-once with no separate lock.
export const idempotencyKey = sqliteTable(
  "idempotency_key",
  {
    id: text("id").primaryKey().$type<IdempotencyRecordId>(), // idr_ handle (server record id)
    key: text("key").notNull(), // client-supplied Idempotency-Key
    fingerprint: text("fingerprint").notNull(), // hash(method + path + canonical body)
    status: text("status", { enum: ["in_progress", "completed"] }).notNull(),
    responseCode: integer("response_code"), // captured on completion
    responseBody: text("response_body"), // captured on completion, redacted (no privileged content)
    createdAt: text("created_at").notNull(), // ISO-8601 instant; TTL purge keys off this
  },
  (table) => [
    uniqueIndex("idempotency_key_key_unique_index").on(table.key),
    index("idempotency_key_created_at_index").on(table.createdAt),
  ],
);

// Transactional outbox: the effect row commits in the SAME D1 transaction as the business
// change; the relay sweeps pending rows to Queues.
export const outbox = sqliteTable(
  "outbox",
  {
    id: text("id").primaryKey().$type<OutboxId>(), // obx_ handle
    topic: text("topic").notNull(), // e.g. 'payment.capture', 'comms.send'
    payload: text("payload").notNull(), // JSON: ids + non-privileged fields ONLY (never privileged content)
    aggregateKey: text("aggregate_key"), // ordering scope for ordered topics
    seq: integer("seq"), // monotonic within aggregate_key
    status: text("status", { enum: ["pending", "dispatched", "failed"] }).notNull(),
    attempts: integer("attempts").notNull().default(0),
    createdAt: text("created_at").notNull(),
    dispatchedAt: text("dispatched_at"),
  },
  (table) => [index("outbox_status_created_at_index").on(table.status, table.createdAt)],
);
