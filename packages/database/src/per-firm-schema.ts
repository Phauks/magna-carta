import {
  check,
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  unique,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";
import type { AnySQLiteColumn } from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";
import type {
  AuditLogId,
  DocumentTypeId,
  FileId,
  FileVersionId,
  FirmSecretId,
  FolderId,
  GrantId,
  IdempotencyRecordId,
  IncidentId,
  LedgerAccountId,
  LedgerEntryId,
  LedgerLineId,
  LocationAddressId,
  LocationId,
  MatterId,
  MatterTypeId,
  MemberLocationId,
  MemberRoleId,
  NumberingSchemeId,
  OutboxId,
  RoleId,
  RolePermissionId,
  UploadSessionId,
  UserId,
} from "@magna-carta/identifiers/types";

// PER-FIRM LINEAGE. Every tenant firm's D1 carries these tables; drizzle-kit generates per-firm
// migrations from this file. The BEHAVIOR over these tables (middleware, relay) lives in
// @magna-carta/data-access — this package only defines the structure.

// Idempotency records. The UNIQUE(key) insert inside the effect's transaction IS the
// concurrency guard — exactly-once with no separate lock.
export const idempotencyKey = sqliteTable(
  "idempotency_key",
  {
    id: text("id").primaryKey().$type<IdempotencyRecordId>(), // idempotencyRecord_ handle (server record id)
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
    id: text("id").primaryKey().$type<OutboxId>(), // outbox_ handle
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

// Per-firm RBAC: roles are DATA, permissions are registry keys. The permission registry
// and the effective-permissions resolver live in @magna-carta/access-control — this package only
// defines the structure. Auth state (credentials, sessions) never lives here: it is control-plane only.

// The per-firm mirror of the control-plane user. Keyed by the GLOBAL user_ handle — the join key
// across planes — never a fresh per-firm id.
export const member = sqliteTable("member", {
  userId: text("user_id").primaryKey().$type<UserId>(), // the global join key
  displayName: text("display_name").notNull(),
  status: text("status", { enum: ["active", "deactivated"] })
    .notNull()
    .default("active"),
  createdAt: text("created_at").notNull(), // ISO-8601 instant
});

// A named bundle of permissions. Five defaults are seeded by migration — the seeded handles are
// committed literals; see drizzle/per-firm/0002_member-rbac.sql.
export const role = sqliteTable("role", {
  id: text("id").primaryKey().$type<RoleId>(), // role_ handle
  name: text("name").notNull().unique(),
  createdAt: text("created_at").notNull(),
});

// role -> permission key. The value is a registry key from @magna-carta/access-control — a fitness
// test cross-checks every seeded value against the registry.
export const rolePermission = sqliteTable(
  "role_permission",
  {
    id: text("id").primaryKey().$type<RolePermissionId>(), // rolePermission_ handle
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
    id: text("id").primaryKey().$type<MemberRoleId>(), // memberRole_ handle
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
    id: text("id").primaryKey().$type<GrantId>(), // grant_ handle
    memberUserId: text("member_user_id")
      .notNull()
      .$type<UserId>()
      .references(() => member.userId),
    permission: text("permission").notNull(),
    expiresAt: text("expires_at"), // null = no expiry; ISO-8601 instant
    grantedBy: text("granted_by").notNull().$type<UserId>(),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    // The per-request authorization read is WHERE member_user_id = ? — index the FK lookup column.
    index("direct_grant_member_user_id_index").on(table.memberUserId),
  ],
);

// Append-only double-entry ledger. Structure only — the posting
// service, validation, and balance composition live in @magna-carta/ledger.

// The structural account model — no chart-of-accounts product (Phase 3 adds it on this schema).
// Normal balance is DERIVED IN CODE from `type` (asset/expense = debit-normal), never a column.
export const ledgerAccount = sqliteTable(
  "ledger_account",
  {
    id: text("id").primaryKey().$type<LedgerAccountId>(), // ledgerAccount_ handle
    name: text("name").notNull(),
    type: text("type", {
      enum: ["asset", "liability", "equity", "income", "expense"],
    }).notNull(),
    currency: text("currency").notNull(), // ISO-4217; always USD now; lines inherit
    parentAccountId: text("parent_account_id")
      .$type<LedgerAccountId>()
      .references((): AnySQLiteColumn => ledgerAccount.id), // subledger seam; children share type+currency
    active: integer("active").notNull().default(1), // soft close — accounts are never deleted
    createdAt: text("created_at").notNull(), // UTC instant
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
    id: text("id").primaryKey().$type<LedgerEntryId>(), // ledgerEntry_ handle
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

// The money. Direction is DATA + amounts are always positive: a sign-flip cannot be expressed.
// Currency is inherited from the account.
export const ledgerLine = sqliteTable(
  "ledger_line",
  {
    id: text("id").primaryKey().$type<LedgerLineId>(), // ledgerLine_ handle
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
    amountMinor: integer("amount_minor").notNull(), // 2dp minor units
  },
  (table) => [
    uniqueIndex("ledger_line_entry_id_line_index_unique_index").on(table.entryId, table.lineIndex),
    index("ledger_line_account_id_index").on(table.accountId),
    check("ledger_line_amount_minor_positive_check", sql`${table.amountMinor} > 0`),
    // Drizzle text enums are type-level only — the direction constraint is stated as an explicit
    // CHECK so the DDL enforces it (defense in depth on permanent rows).
    check("ledger_line_direction_check", sql`${table.direction} IN ('debit', 'credit')`),
  ],
);

// Materialized balance in NORMAL-BALANCE terms (positive = normal), one row per account, created in
// the same batch as the account. The CHECK is the enforcement mechanism: a bounds violation inside a
// posting batch aborts the WHOLE transaction — D1's only batch-abort primitive.
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

// Matters, Locations & File Manager. Structure only — the lifecycle, numbering, folder, upload, and
// metering BEHAVIOR lives in @magna-carta/{locations,matters,file-manager}, composed through the
// data-access effect batch. No domain logic here.

// A firm office/branch: the root of trust-account jurisdiction and safe custody in later phases, and
// the source of per-location letterhead/remit-to. Soft close only (never deleted).
export const location = sqliteTable(
  "location",
  {
    id: text("id").primaryKey().$type<LocationId>(), // location_ handle
    name: text("name").notNull(),
    status: text("status", { enum: ["active", "closed"] })
      .notNull()
      .default("active"),
    jurisdiction: text("jurisdiction"), // jurisdiction key the trust-rules catalog will key off
    numberCode: text("number_code"), // short code the matter-numbering location segment renders
    addressBlock: text("address_block"), // free-text letterhead address
    footer: text("footer"), // free-text letterhead footer
    remitTo: text("remit_to"), // free-text billing remit-to
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("location_number_code_unique_index").on(table.numberCode),
    check("location_status_check", sql`${table.status} IN ('active', 'closed')`),
    check("location_name_nonempty_check", sql`length(${table.name}) > 0`),
  ],
);

// Structured addresses for a location — at most one physical and one mailing, replace-set on update.
export const locationAddress = sqliteTable(
  "location_address",
  {
    id: text("id").primaryKey().$type<LocationAddressId>(), // locationAddress_ handle
    locationId: text("location_id")
      .notNull()
      .$type<LocationId>()
      .references(() => location.id),
    kind: text("kind", { enum: ["physical", "mailing"] }).notNull(),
    street: text("street"),
    city: text("city"),
    region: text("region"),
    postal: text("postal"),
    phone: text("phone"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    index("location_address_location_id_index").on(table.locationId),
    check("location_address_kind_check", sql`${table.kind} IN ('physical', 'mailing')`),
  ],
);

// Which members staff which locations; exactly one primary per member is enforced in the write path.
export const memberLocation = sqliteTable(
  "member_location",
  {
    id: text("id").primaryKey().$type<MemberLocationId>(), // memberLocation_ handle
    memberUserId: text("member_user_id")
      .notNull()
      .$type<UserId>()
      .references(() => member.userId),
    locationId: text("location_id")
      .notNull()
      .$type<LocationId>()
      .references(() => location.id),
    isPrimary: integer("is_primary").notNull().default(0), // 0/1
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    unique().on(table.memberUserId, table.locationId),
    index("member_location_location_id_index").on(table.locationId),
  ],
);

// Per-firm matter types and document types — classification catalogs, soft-deactivated never deleted.
export const matterType = sqliteTable(
  "matter_type",
  {
    id: text("id").primaryKey().$type<MatterTypeId>(), // matterType_ handle
    name: text("name").notNull(),
    code: text("code"), // short code the matter-numbering type segment renders
    active: integer("active").notNull().default(1),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("matter_type_name_unique_index").on(table.name),
    uniqueIndex("matter_type_code_unique_index").on(table.code),
    check("matter_type_name_nonempty_check", sql`length(${table.name}) > 0`),
  ],
);

export const documentType = sqliteTable(
  "document_type",
  {
    id: text("id").primaryKey().$type<DocumentTypeId>(), // documentType_ handle
    name: text("name").notNull(),
    code: text("code"),
    active: integer("active").notNull().default(1),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("document_type_name_unique_index").on(table.name),
    uniqueIndex("document_type_code_unique_index").on(table.code),
    check("document_type_name_nonempty_check", sql`length(${table.name}) > 0`),
  ],
);

// The matter-number template: an ordered array of segments stored as validated JSON. One active
// scheme per firm is enforced in the write path; superseded schemes are retained so a historical
// number still explains how it was rendered.
export const numberingScheme = sqliteTable("numbering_scheme", {
  id: text("id").primaryKey().$type<NumberingSchemeId>(), // numberingScheme_ handle
  segments: text("segments").notNull(), // JSON; shape validated by numberingSchemeSchema
  active: integer("active").notNull().default(1),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

// The matter-number counter, one row per {firm, scope_key}. The primary key is the natural scope key,
// NOT an identifier handle — like the migration tracker, this is a counter keyed by what it counts
// (a documented exception to the handle-PK fitness rule). The guarded increment against next_value
// plus the matter_number UNIQUE index are what make concurrent draws yield distinct numbers.
export const matterNumberCounter = sqliteTable("matter_number_counter", {
  scopeKey: text("scope_key").primaryKey(), // scoping-segment values joined by ":"; "" = firm-wide
  nextValue: integer("next_value").notNull(),
});

// The matter shell. status drives the owner-shaped lifecycle: prospective (an unnumbered
// consultation) -> open (draws the number) -> closed (archived but still additive). The number is
// frozen at assignment; the partial UNIQUE index makes a duplicate number within the firm impossible
// while leaving unnumbered prospectives unconstrained.
export const matter = sqliteTable(
  "matter",
  {
    id: text("id").primaryKey().$type<MatterId>(), // matter_ handle
    title: text("title").notNull(),
    description: text("description"),
    status: text("status", { enum: ["prospective", "open", "closed"] }).notNull(),
    matterTypeId: text("matter_type_id")
      .$type<MatterTypeId>()
      .references(() => matterType.id),
    locationId: text("location_id")
      .$type<LocationId>()
      .references(() => location.id),
    responsibleMemberId: text("responsible_member_id")
      .notNull()
      .$type<UserId>()
      .references(() => member.userId),
    clientDisplayName: text("client_display_name"), // display-only until the Directory link lands
    clientCode: text("client_code"),
    matterNumber: text("matter_number"), // null until open draws it; frozen thereafter
    numberedAt: text("numbered_at"),
    openedAt: text("opened_at"),
    closedAt: text("closed_at"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("matter_matter_number_unique_index")
      .on(table.matterNumber)
      .where(sql`${table.matterNumber} IS NOT NULL`),
    index("matter_status_index").on(table.status),
    // List reads keyset-paginate on (created_at DESC, id DESC). SQLite walks an ASC index in reverse,
    // so these ASC composites serve the sort order from the index itself — no temporary B-tree. The
    // responsible-member composite leads with the filter column, so it also serves the bare FK lookup
    // (a strict prefix); the second covers the unfiltered/status-filtered caseload list's sort.
    index("matter_responsible_member_id_created_at_id_index").on(
      table.responsibleMemberId,
      table.createdAt,
      table.id,
    ),
    index("matter_created_at_id_index").on(table.createdAt, table.id),
    check("matter_status_check", sql`${table.status} IN ('prospective', 'open', 'closed')`),
    check("matter_title_nonempty_check", sql`length(${table.title}) > 0`),
  ],
);

// Folder tree per matter (in D1). Folders are organizational only; R2 keys are opaque and NEVER
// derived from folder paths, so renaming or moving a folder never touches stored bytes.
export const folder = sqliteTable(
  "folder",
  {
    id: text("id").primaryKey().$type<FolderId>(), // folder_ handle
    matterId: text("matter_id")
      .notNull()
      .$type<MatterId>()
      .references(() => matter.id),
    parentFolderId: text("parent_folder_id")
      .$type<FolderId>()
      .references((): AnySQLiteColumn => folder.id), // null = matter root
    name: text("name").notNull(),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    // SQLite treats NULLs as distinct, so this backstops sibling-name collisions for non-root folders;
    // the folder service enforces the root-level (null-parent) case as well.
    unique().on(table.matterId, table.parentFolderId, table.name),
    // The per-matter folder list keyset-paginates on (created_at, id); leading with matter_id serves
    // both the filter and the sort from one index (and still covers the bare matter_id FK lookup).
    index("folder_matter_id_created_at_id_index").on(table.matterId, table.createdAt, table.id),
    check("folder_name_nonempty_check", sql`length(${table.name}) > 0`),
  ],
);

// A file is metadata plus a pointer to its current version; bytes live in R2 under opaque keys.
// Soft-delete only (deleted_at); versions are immutable and never removed with the file.
export const file = sqliteTable(
  "file",
  {
    id: text("id").primaryKey().$type<FileId>(), // file_ handle
    matterId: text("matter_id")
      .notNull()
      .$type<MatterId>()
      .references(() => matter.id),
    folderId: text("folder_id")
      .$type<FolderId>()
      .references(() => folder.id),
    name: text("name").notNull(),
    documentTypeId: text("document_type_id")
      .$type<DocumentTypeId>()
      .references(() => documentType.id),
    currentVersionId: text("current_version_id")
      .$type<FileVersionId>()
      .references((): AnySQLiteColumn => fileVersion.id), // forward ref — set when a version commits
    deletedAt: text("deleted_at"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    // File lists keyset-paginate on (created_at DESC, id DESC) under a matter or folder filter.
    // Leading with the filter column lets one ASC composite serve both the filter and the reversed
    // sort (and still cover the bare FK lookup that each replaces).
    index("file_matter_id_created_at_id_index").on(table.matterId, table.createdAt, table.id),
    index("file_folder_id_created_at_id_index").on(table.folderId, table.createdAt, table.id),
    check("file_name_nonempty_check", sql`length(${table.name}) > 0`),
  ],
);

// An immutable version of a file. The status gate (pending -> clean | quarantined | abandoned) is the
// quarantine mechanism: read paths serve ONLY `clean` versions. r2_key is opaque, minted at initiate
// and UNIQUE; content_sha256 backs the no-op re-upload skip.
export const fileVersion = sqliteTable(
  "file_version",
  {
    id: text("id").primaryKey().$type<FileVersionId>(), // fileVersion_ handle
    fileId: text("file_id")
      .notNull()
      .$type<FileId>()
      .references(() => file.id),
    versionNumber: integer("version_number").notNull(),
    r2Key: text("r2_key").notNull(),
    sizeBytes: integer("size_bytes"),
    declaredContentType: text("declared_content_type"),
    sniffedContentType: text("sniffed_content_type"),
    contentSha256: text("content_sha256"),
    storageEncoding: text("storage_encoding").notNull().default("full"), // full | (delta seam, later)
    artifactRole: text("artifact_role", { enum: ["original", "derived"] })
      .notNull()
      .default("original"),
    pinned: integer("pinned").notNull().default(0), // 0/1; promotes evidence past eviction
    storageClass: text("storage_class", { enum: ["standard", "infrequent_access"] })
      .notNull()
      .default("standard"),
    scanVerdict: text("scan_verdict", { enum: ["unscanned", "clean", "infected"] }),
    scanEngineVersion: text("scan_engine_version"),
    status: text("status", { enum: ["pending", "clean", "quarantined", "abandoned"] })
      .notNull()
      .default("pending"),
    uploadedBy: text("uploaded_by").$type<UserId>(), // not an FK — the upload fact outlives the member row
    createdAt: text("created_at").notNull(),
    committedAt: text("committed_at"),
  },
  (table) => [
    uniqueIndex("file_version_r2_key_unique_index").on(table.r2Key),
    uniqueIndex("file_version_file_id_version_number_unique_index").on(
      table.fileId,
      table.versionNumber,
    ),
    index("file_version_status_index").on(table.status),
    check(
      "file_version_artifact_role_check",
      sql`${table.artifactRole} IN ('original', 'derived')`,
    ),
    check(
      "file_version_storage_class_check",
      sql`${table.storageClass} IN ('standard', 'infrequent_access')`,
    ),
    check(
      "file_version_scan_verdict_check",
      sql`${table.scanVerdict} IS NULL OR ${table.scanVerdict} IN ('unscanned', 'clean', 'infected')`,
    ),
    check(
      "file_version_status_check",
      sql`${table.status} IN ('pending', 'clean', 'quarantined', 'abandoned')`,
    ),
    check(
      "file_version_size_bytes_nonneg_check",
      sql`${table.sizeBytes} IS NULL OR ${table.sizeBytes} >= 0`,
    ),
  ],
);

// An in-flight direct-to-R2 upload. Tracks the PUT/multipart lifecycle and expiry; the stale-pending
// sweep aborts expired sessions and abandons their pending versions.
export const uploadSession = sqliteTable(
  "upload_session",
  {
    id: text("id").primaryKey().$type<UploadSessionId>(), // uploadSession_ handle
    fileVersionId: text("file_version_id")
      .notNull()
      .$type<FileVersionId>()
      .references(() => fileVersion.id),
    mode: text("mode", { enum: ["put", "multipart"] }).notNull(),
    r2UploadId: text("r2_upload_id"), // the S3 multipart upload id, when mode = multipart
    declaredSize: integer("declared_size"),
    declaredContentType: text("declared_content_type"),
    status: text("status", { enum: ["open", "completed", "aborted", "expired"] }).notNull(),
    createdAt: text("created_at").notNull(),
    expiresAt: text("expires_at"),
  },
  (table) => [
    index("upload_session_status_expires_at_index").on(table.status, table.expiresAt),
    check("upload_session_mode_check", sql`${table.mode} IN ('put', 'multipart')`),
    check(
      "upload_session_status_check",
      sql`${table.status} IN ('open', 'completed', 'aborted', 'expired')`,
    ),
  ],
);

// Authoritative per-firm storage rollup, keyed by (storage_class, artifact_role, prefix). Composite
// NATURAL key (no handle) — the same documented exception as the counter. D1 is the source of truth;
// Analytics Engine carries trends; a scheduled R2 LIST reconciles drift.
export const storageMeter = sqliteTable(
  "storage_meter",
  {
    storageClass: text("storage_class").notNull(),
    artifactRole: text("artifact_role").notNull(),
    prefix: text("prefix").notNull(), // top-level R2 key segment (today always "files")
    bytes: integer("bytes").notNull(),
    objectCount: integer("object_count").notNull(),
  },
  (table) => [primaryKey({ columns: [table.storageClass, table.artifactRole, table.prefix] })],
);

// Per-firm key/value config (JSON values), read through a typed accessor with defaults in code: a
// missing row IS the default. Natural-key PK (the setting key), not a handle.
export const setting = sqliteTable("setting", {
  key: text("key").primaryKey(),
  value: text("value").notNull(), // JSON
  updatedAt: text("updated_at").notNull(),
});

// Append-only per-firm audit log. Written in the same batch as the mutation it records; metadata is
// redacted JSON (ids and non-privileged fields only, NEVER privileged content). actor_user_id is not
// an FK — the audit fact must outlive the actor's member row.
export const auditLog = sqliteTable(
  "audit_log",
  {
    id: text("id").primaryKey().$type<AuditLogId>(), // auditLog_ handle
    event: text("event").notNull(),
    actorUserId: text("actor_user_id").$type<UserId>(),
    subjectId: text("subject_id"),
    metadata: text("metadata"), // JSON, redacted
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    index("audit_log_created_at_index").on(table.createdAt),
    index("audit_log_event_index").on(table.event),
  ],
);

// User-initiated incident reports — the row written by POST /api/v1/incidents. Structure only — the
// route and its outbox→Queue seam (`incident.created`, no consumer yet) live in apps/worker. JSON
// columns are redacted by construction: error_ids and breadcrumbs are id-and-action shaped, never
// content. The `description` is the user's words — encrypted into description_ciphertext (access-gated,
// audited reads) by the firm-scoped data-access chokepoint; the plaintext column is retained until a
// later slice drops it (expand-contract).
export const incident = sqliteTable("incident", {
  id: text("id").primaryKey().$type<IncidentId>(), // incident_ handle
  errorIds: text("error_ids").notNull(), // JSON array of error_ handles (may be empty — "nothing crashed but…")
  breadcrumbs: text("breadcrumbs").notNull(), // JSON array of { at, action, route } — redacted by construction
  description: text("description").notNull(), // user-authored plaintext; superseded by description_ciphertext
  // The encrypted form of the user's words, sealed under the firm key and read only with
  // incidents:viewDescription (an audited decrypt). Nullable while the plaintext column still
  // exists; the plaintext `description` is dropped in a later slice after a verification window.
  descriptionCiphertext: text("description_ciphertext"),
  context: text("context").notNull(), // JSON { route, appVersion, clientAt }
  screenshotKey: text("screenshot_key"), // R2 seam, nullable; the UI slice populates capture/upload
  // Lifecycle stays open text (not an enum): the diagnostics agent defines the states it transitions
  // through later — constraining now would be premature (no consumer exists yet).
  status: text("status").notNull().default("open"),
  reportedBy: text("reported_by").notNull().$type<UserId>(), // global usr_ handle; no cross-plane FK
  createdAt: text("created_at").notNull(), // ISO-8601 instant
});

// Named per-firm secrets — a small key/value store whose values are always encrypted at rest under
// the firm key. The row only ever holds ciphertext; the encrypt/decrypt and the access gate
// (firm:manageSecrets, audited) live in @magna-carta/data-access. name is the lookup handle, unique
// per firm. created_at/updated_at are ISO-8601 instants (updated_at moves on an upsert).
export const firmSecret = sqliteTable("firm_secret", {
  id: text("id").primaryKey().$type<FirmSecretId>(), // firmSecret_ handle
  name: text("name").notNull().unique(),
  ciphertext: text("ciphertext").notNull(),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});
