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
  AiDetectionUsageId,
  AuditLogId,
  ConflictsCheckId,
  ConflictsDispositionId,
  ConflictsHitId,
  CostEntryId,
  CustomFieldId,
  CustomFieldValueId,
  DirectoryAddressId,
  DirectoryCategoryId,
  DirectoryEdgeId,
  DirectoryEmailId,
  DirectoryIdentifierId,
  DirectoryNameId,
  DirectoryOrganizationId,
  DirectoryPartyRoleId,
  DirectoryPersonId,
  DirectoryPhoneId,
  DocumentTypeId,
  DocumentCheckoutId,
  EntityMergeId,
  FileId,
  FileVersionId,
  FirmSecretId,
  FolderId,
  GrantId,
  IdempotencyRecordId,
  IncidentId,
  IntegrationConnectionId,
  LedgerAccountId,
  LedgerEntryId,
  LedgerLineId,
  LocationAddressId,
  LocationId,
  MatterId,
  MatterPartyId,
  MatterTypeId,
  MemberLocationId,
  MemberRoleId,
  NarrativeTemplateId,
  NonBillableCategoryId,
  NumberingSchemeId,
  OutboxId,
  PicklistOptionId,
  RateCardId,
  RateId,
  RepairProvenanceId,
  RoleId,
  RolePermissionId,
  ShipmentId,
  ShipmentLabelId,
  TimeEntryId,
  TrackingEventId,
  UploadSessionId,
  UserId,
  UtbmsCodeId,
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
  // Per-user opt-out of product-usage analytics (the per-user override; the firm-level enable lives
  // in the setting table). Default off (events flow) — a member sets this to opt themselves out.
  optedOutOfUsageAnalytics: integer("opted_out_of_usage_analytics", { mode: "boolean" })
    .notNull()
    .default(false),
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

// A firm office/branch: the root of trust-account jurisdiction and the Custodian hierarchy in later phases, and
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
    // On when the matter bills through an e-billing (LEDES/UTBMS) channel; capture validation reads
    // it to require a UTBMS task/activity code. Lands ahead of any capture logic that consults it.
    eBilling: integer("e_billing").notNull().default(0),
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
    check("matter_e_billing_check", sql`${table.eBilling} IN (0, 1)`),
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
    // The live editing working copy (slice 2·2): the mutable `current` R2 object an editing session
    // overwrites on save, plus its host-recorded hash/size/timestamp. All nullable — a file never
    // opened for editing has no working copy; a version cut copies `current` to an immutable version
    // key. current_wopi_timestamp is the server-authoritative modification time the WOPI stale-write
    // guard compares the editor's presented timestamp against.
    currentR2Key: text("current_r2_key"),
    currentSha256: text("current_sha256"),
    currentSizeBytes: integer("current_size_bytes"),
    currentWopiTimestamp: text("current_wopi_timestamp"),
    // The document's editing posture: idle, in a live co-editing session, or held under an offline
    // checkout / exclusive lock. Reading is never blocked in any state; this drives the launch-time
    // join-vs-new decision and the reap transitions back to idle.
    editState: text("edit_state", { enum: ["idle", "coediting", "checked_out"] })
      .notNull()
      .default("idle"),
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
    check("file_edit_state_check", sql`${table.editState} IN ('idle', 'coediting', 'checked_out')`),
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
    scanVerdict: text("scan_verdict", { enum: ["unscanned", "clean", "flagged"] }),
    scanEngineVersion: text("scan_engine_version"),
    // The reason behind an `unscanned` badge ("no-engine"/"encrypted"/"oversize"), an "active-content"
    // badge on an otherwise-clean file (PDF JavaScript / Office macros), or a suspicious
    // quarantine ("decompression-bomb"/"archive-nesting"/"archive-entry-count"). Null for a plain
    // clean scan. Surfaces the "not scanned" badge in read models without overloading scan_verdict.
    scanDetail: text("scan_detail"),
    // NULL = never sniffed; set by the codec sniff when a reader first computes it. NULL must stay
    // distinct from 'indeterminate' (sniffed-but-undecidable) so a corpus roll-up can tell "never
    // looked" from "looked, can't decide". Only a positive 'playable' unlocks inline media.
    inlinePlayable: text("inline_playable", {
      enum: ["playable", "download-only", "indeterminate"],
    }),
    status: text("status", { enum: ["pending", "clean", "quarantined", "abandoned"] })
      .notNull()
      .default("pending"),
    uploadedBy: text("uploaded_by").$type<UserId>(), // not an FK — the upload fact outlives the member row
    // Editing reconciliation (slice 2·2): a version cut from a live save is `clean`; a version landed
    // from an offline check-in whose base no longer matches `current` is a `conflict_pending`
    // conflicting copy (retained forever), flipped to `reconciled` once a human resolves it.
    reconciliationStatus: text("reconciliation_status", {
      enum: ["clean", "conflict_pending", "reconciled"],
    })
      .notNull()
      .default("clean"),
    // For a conflicting copy, the version its offline working copy diverged from (the stale base) — a
    // self-reference into file_version. Null for an ordinary clean version.
    divergedFromVersionId: text("diverged_from_version_id")
      .$type<FileVersionId>()
      .references((): AnySQLiteColumn => fileVersion.id),
    // Provenance for a version that arrived via an offline check-in: the checkout it came back through.
    // Null for an ordinary upload or live-edit version. The ingest consumer reads it to route a cleared
    // check-in into divergence resolution rather than a plain commit.
    checkoutId: text("checkout_id")
      .$type<DocumentCheckoutId>()
      .references((): AnySQLiteColumn => documentCheckout.id),
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
    // The tiering sweep's firm-wide candidate scan (storage_class='standard' + status='clean' +
    // committed_at < cutoff) seeks this composite instead of walking every clean version.
    index("file_version_tiering_index").on(table.storageClass, table.status, table.committedAt),
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
      sql`${table.scanVerdict} IS NULL OR ${table.scanVerdict} IN ('unscanned', 'clean', 'flagged')`,
    ),
    check(
      "file_version_inline_playable_check",
      sql`${table.inlinePlayable} IS NULL OR ${table.inlinePlayable} IN ('playable', 'download-only', 'indeterminate')`,
    ),
    check(
      "file_version_status_check",
      sql`${table.status} IN ('pending', 'clean', 'quarantined', 'abandoned')`,
    ),
    check(
      "file_version_reconciliation_status_check",
      sql`${table.reconciliationStatus} IN ('clean', 'conflict_pending', 'reconciled')`,
    ),
    check(
      "file_version_size_bytes_nonneg_check",
      sql`${table.sizeBytes} IS NULL OR ${table.sizeBytes} >= 0`,
    ),
  ],
);

// A document checkout (slice 2·2): an offline-working-copy claim or an opt-in exclusive lock on a
// file, held by one member against a base version. The row tracks the lifecycle (active -> stale ->
// released, or reconciling while a divergent check-in is resolved). divergence is detected by
// comparing the file's current_version_id against base_version_id at check-in time.
export const documentCheckout = sqliteTable(
  "document_checkout",
  {
    id: text("id").primaryKey().$type<DocumentCheckoutId>(), // documentCheckout_ handle
    fileId: text("file_id")
      .notNull()
      .$type<FileId>()
      .references(() => file.id),
    holderMemberId: text("holder_member_id")
      .notNull()
      .$type<UserId>()
      .references(() => member.userId),
    lockType: text("lock_type", { enum: ["exclusive", "offline_working_copy"] }).notNull(),
    baseVersionId: text("base_version_id")
      .notNull()
      .$type<FileVersionId>()
      .references(() => fileVersion.id),
    acquiredAt: text("acquired_at").notNull(),
    lastActivityAt: text("last_activity_at").notNull(),
    status: text("status", { enum: ["active", "stale", "released", "reconciling"] })
      .notNull()
      .default("active"),
    // When a generous idle window auto-releases the checkout (null until scheduled).
    idleReleaseAt: text("idle_release_at"),
  },
  (table) => [
    // The active-checkout lookup for a file (the launch + check-in paths) and the holder's open list.
    index("document_checkout_file_id_index").on(table.fileId),
    index("document_checkout_holder_member_id_index").on(table.holderMemberId),
    // The idle-checkout sweep's firm-wide stage-1 scan (status='active' + last_activity_at < cutoff)
    // seeks this composite instead of walking every checkout; the status prefix also serves the
    // stage-2 stale scan.
    index("document_checkout_status_last_activity_index").on(table.status, table.lastActivityAt),
    // The sweep's stage-2 scan (status='stale' + idle_release_at < cutoff) seeks this composite — the
    // (status, last_activity_at) index does not cover the idle_release_at range predicate.
    index("document_checkout_status_idle_release_index").on(table.status, table.idleReleaseAt),
    check(
      "document_checkout_lock_type_check",
      sql`${table.lockType} IN ('exclusive', 'offline_working_copy')`,
    ),
    check(
      "document_checkout_status_check",
      sql`${table.status} IN ('active', 'stale', 'released', 'reconciling')`,
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

// Per-firm content-addressed scan cache — the "scan-once" dedup. Records the full serialized
// RawScanResult for a content hash under a specific engine version, so a re-scan or bulk migration
// can SKIP the scan engine when identical content was already scanned by the SAME engine. Sound:
// identical bytes + the same signature database yield the same raw result, and `engine_version` is
// part of the key, so a database update is a cache MISS (the content is re-scanned under the new
// engine) — never a stale result. Only real engine scans are cached (engineVersion non-null);
// the no-engine adapter is never written here.
// Natural composite key (content hash + engine version), not a handle.
export const scanCache = sqliteTable(
  "scan_cache",
  {
    contentSha256: text("content_sha256").notNull(),
    engineVersion: text("engine_version").notNull(),
    rawResult: text("raw_result").notNull(), // JSON-serialized RawScanResult
    scannedAt: text("scanned_at").notNull(),
  },
  (table) => [primaryKey({ columns: [table.contentSha256, table.engineVersion] })],
);

// Authoritative per-firm AI token usage, captured from the inference RESPONSE (the provider usage
// object) — the durable, reconcilable billing source, never the gateway logs. Rolled up by
// (day, slot, model_id) so the firm-usage diagnostics feed reads a compact per-day breakdown. Composite
// NATURAL key (no handle) — the same documented exception as storage_meter; every key column is TEXT.
// The rollup moves by delta (INSERT ... ON CONFLICT DO UPDATE SET col = col + excluded.col) in the same
// batch as the run it counts.
export const tokenUsageMeter = sqliteTable(
  "token_usage_meter",
  {
    day: text("day").notNull(), // YYYY-MM-DD civil date bucket (UTC)
    slot: text("slot").notNull(), // reasoning | utility | embedding
    modelId: text("model_id").notNull(), // the gateway-routable, provider-prefixed id
    inputTokens: integer("input_tokens").notNull(),
    outputTokens: integer("output_tokens").notNull(),
    requestCount: integer("request_count").notNull(),
  },
  (table) => [primaryKey({ columns: [table.day, table.slot, table.modelId] })],
);

// Authoritative per-firm AI-text-detection usage — one row per successful detection. Word count is the
// billing-relevant unit (the provider bills by words); cost_minor is an indicative snapshot. matter_id
// is the matter-action seam (nullable — Tools detection is matter-less today). Handle PK.
export const aiDetectionUsage = sqliteTable(
  "ai_detection_usage",
  {
    id: text("id").primaryKey().$type<AiDetectionUsageId>(),
    requestedBy: text("requested_by").notNull(),
    wordCount: integer("word_count").notNull(),
    mode: text("mode", { enum: ["realtime", "bulk"] }).notNull(),
    costMinor: integer("cost_minor").notNull(),
    adapterId: text("adapter_id").notNull(),
    vendorVersion: text("vendor_version"),
    resultBand: text("result_band"),
    matterId: text("matter_id").$type<MatterId>(),
    createdAt: text("created_at").notNull(),
  },
  (table) => [index("ai_detection_usage_created_at_index").on(table.createdAt)],
);

// The honest provenance of a machine-reconstructed file version: the operation and the verbatim loss
// manifest, so viewing the file surfaces "reconstructed — here is what was lost/synthesized". Firm
// data (access-gated like the version it describes), never the redacted log pipeline. Keyed by the
// file version it belongs to; a row's existence IS the "this version is a reconstruction" marker.
export const fileRepairProvenance = sqliteTable(
  "file_repair_provenance",
  {
    id: text("id").primaryKey().$type<RepairProvenanceId>(),
    fileVersionId: text("file_version_id").notNull().$type<FileVersionId>(),
    operation: text("operation", { enum: ["repair", "carve"] }).notNull(),
    fullyRecovered: integer("fully_recovered").notNull(),
    manifestJson: text("manifest_json").notNull(),
    sourceMediaType: text("source_media_type"),
    createdAt: text("created_at").notNull(),
  },
  (table) => [index("file_repair_provenance_version_index").on(table.fileVersionId)],
);

// Per-firm key/value config (JSON values), read through a typed accessor with defaults in code: a
// missing row IS the default. Natural-key PK (the setting key), not a handle.
export const setting = sqliteTable("setting", {
  key: text("key").primaryKey(),
  value: text("value").notNull(), // JSON
  updatedAt: text("updated_at").notNull(),
});

// Scope-resolved settings: most-specific-first precedence (matter -> client -> user -> location ->
// firm -> in-code default). The first realization of the settings-precedence chain; the flat
// `setting` table stays for firm-level-only knobs. A firm row carries a null scoped_id.
export const scopedSetting = sqliteTable(
  "scoped_setting",
  {
    key: text("key").notNull(),
    scopeTier: text("scope_tier", {
      enum: ["matter", "client", "user", "location", "firm"],
    }).notNull(),
    scopedId: text("scoped_id"), // null for the firm tier
    value: text("value").notNull(), // JSON
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.key, table.scopeTier, table.scopedId] }),
    check(
      "scoped_setting_scope_tier_check",
      sql`${table.scopeTier} IN ('matter', 'client', 'user', 'location', 'firm')`,
    ),
  ],
);

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
  // user-authored plaintext, NULLABLE now that new writes are encrypted-only into
  // description_ciphertext (the route writes NULL here); the backfill sweep encrypts pre-existing
  // rows and this plaintext column is dropped in a later slice after a verification window.
  description: text("description"),
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

// Directory — person/organization entity graph. Structure only — domain logic lives in
// @magna-carta/directory. Every PK is a TEXT identifier handle; no REAL columns;
// soft-delete via deleted_at.

// A natural person in the directory. All protected fields (dob, ssn, dl, etc.) are stored uniformly
// as directory_identifier rows — no ciphertext columns here.
// status/merged_into_id support the merge graph (see entity_merge); these columns must exist before
// any merge logic is added so there is no expand-contract migration at merge time.
export const directoryPerson = sqliteTable(
  "directory_person",
  {
    id: text("id").primaryKey().$type<DirectoryPersonId>(), // directoryPerson_ handle
    namePrefix: text("name_prefix"),
    nameGiven: text("name_given"),
    nameMiddle: text("name_middle"),
    nameFamily: text("name_family"),
    nameSuffix: text("name_suffix"),
    displayName: text("display_name"),
    memberId: text("member_id").$type<UserId>(), // nullable; set if this person maps to a firm member
    status: text("status").notNull().default("active"), // 'active' | 'merged_into'
    mergedIntoId: text("merged_into_id").$type<DirectoryPersonId>(), // set when status = 'merged_into'
    needsReview: integer("needs_review").notNull().default(0), // 0/1; set by provisional imports awaiting review
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
    deletedAt: text("deleted_at"),
  },
  (table) => [
    check("directory_person_status_check", sql`${table.status} IN ('active', 'merged_into')`),
    check("directory_person_needs_review_check", sql`${table.needsReview} IN (0, 1)`),
  ],
);

// A legal entity (company, trust, government body, etc.) in the directory. All protected fields
// (ein, etc.) are stored uniformly as directory_identifier rows — no ciphertext columns here.
// status/merged_into_id mirror directory_person for the same merge-graph reason.
export const directoryOrganization = sqliteTable(
  "directory_organization",
  {
    id: text("id").primaryKey().$type<DirectoryOrganizationId>(), // directoryOrganization_ handle
    legalName: text("legal_name"),
    displayName: text("display_name"),
    status: text("status").notNull().default("active"), // 'active' | 'merged_into'
    mergedIntoId: text("merged_into_id").$type<DirectoryOrganizationId>(), // set when status = 'merged_into'
    needsReview: integer("needs_review").notNull().default(0), // 0/1; set by provisional imports awaiting review
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
    deletedAt: text("deleted_at"),
  },
  (table) => [
    check("directory_organization_status_check", sql`${table.status} IN ('active', 'merged_into')`),
    check("directory_organization_needs_review_check", sql`${table.needsReview} IN (0, 1)`),
  ],
);

// A name record for a person or organization. Temporal (valid_from/valid_to) and role-typed so that
// a person's maiden name, legal name, and preferred name can all coexist.
// The implicit SQLite rowid backs the FTS5 external-content link — do NOT use WITHOUT ROWID here.
export const directoryName = sqliteTable(
  "directory_name",
  {
    id: text("id").primaryKey().$type<DirectoryNameId>(), // directoryName_ handle
    entityId: text("entity_id").notNull(), // FK to directory_person.id or directory_organization.id
    entityKind: text("entity_kind").notNull(), // 'person' | 'organization'
    nameRole: text("name_role").notNull(), // e.g. 'legal', 'preferred', 'maiden', 'trading'
    namePrefix: text("name_prefix"),
    nameGiven: text("name_given"),
    nameMiddle: text("name_middle"),
    nameFamily: text("name_family"),
    nameSuffix: text("name_suffix"),
    normalizedDisplay: text("normalized_display").notNull(), // lowercased + stripped; the FTS5 content column
    isCurrent: integer("is_current").notNull().default(1), // 0/1; the write path manages transitions
    validFrom: text("valid_from"),
    validTo: text("valid_to"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
    deletedAt: text("deleted_at"),
  },
  (table) => [
    index("directory_name_entity_id_index").on(table.entityId),
    index("directory_name_normalized_display_index").on(table.normalizedDisplay),
    check(
      "directory_name_entity_kind_check",
      sql`${table.entityKind} IN ('person', 'organization')`,
    ),
    check("directory_name_name_role_check", sql`length(${table.nameRole}) > 0`),
    check("directory_name_is_current_check", sql`${table.isCurrent} IN (0, 1)`),
  ],
);

// Phonetic codes for a name — enables double-metaphone fuzzy search alongside the
// FTS5 trigram index. Multiple codes per name (one row per scheme).
// scheme is an open, application-managed catalog: current values are 'double_metaphone_primary'
// and 'double_metaphone_secondary' (Double Metaphone yields two codes per input, stored as
// separate rows so every row carries a single scalar code). Future schemes such as Beider-Morse
// are added by the application layer without a schema migration — hence the open length() check
// rather than a closed IN(...) enumeration.
export const directoryNamePhoneticCode = sqliteTable(
  "directory_name_phonetic_code",
  {
    nameId: text("name_id")
      .notNull()
      .$type<DirectoryNameId>()
      .references(() => directoryName.id),
    scheme: text("scheme").notNull(),
    code: text("code").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.nameId, table.scheme] }),
    index("directory_name_phonetic_code_scheme_code_index").on(table.scheme, table.code),
    // The duplicate-candidate phonetic channel filters `code` across all schemes (no scheme bound), so
    // it cannot seek the (scheme, code) index above (leading column unbound). This code-leading index
    // makes that hot-path probe an index seek rather than a scan.
    index("directory_name_phonetic_code_code_index").on(table.code),
    check("directory_name_phonetic_code_scheme_check", sql`length(${table.scheme}) > 0`),
  ],
);

// A typed identifier for a person or organization (driver's licence, ACN, ABN, bar number, etc.).
// The value is always encrypted; a blind index is generated for schemes that support equality search.
export const directoryIdentifier = sqliteTable(
  "directory_identifier",
  {
    id: text("id").primaryKey().$type<DirectoryIdentifierId>(), // directoryIdentifier_ handle
    entityId: text("entity_id").notNull(), // FK to directory_person.id or directory_organization.id
    identifierType: text("identifier_type").notNull(), // e.g. 'drivers_licence', 'acn', 'bar_number'
    valueCiphertext: text("value_ciphertext").notNull(), // encrypted; never logged
    valueBlindIndex: text("value_blind_index"), // nullable; set for searchable schemes
    validFrom: text("valid_from"),
    validTo: text("valid_to"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
    deletedAt: text("deleted_at"),
  },
  (table) => [
    index("directory_identifier_entity_id_index").on(table.entityId),
    index("directory_identifier_type_blind_index_index").on(
      table.identifierType,
      table.valueBlindIndex,
    ),
    check(
      "directory_identifier_identifier_type_nonempty_check",
      sql`length(${table.identifierType}) > 0`,
    ),
  ],
);

// One authorized external account per category (the grant). Firm-scoped today (shipping); the unique
// index keys it on (category, principal) so a firm has exactly one connection per category.
// `credential_ref` points at the firm_secret entry; `capability_snapshot` is the adapter descriptor
// captured at connect time.
export const integrationConnection = sqliteTable(
  "integration_connection",
  {
    id: text("id").primaryKey().$type<IntegrationConnectionId>(),
    category: text("category").notNull(),
    adapterId: text("adapter_id").notNull(),
    scope: text("scope", { enum: ["firm", "user"] }).notNull(),
    principalRef: text("principal_ref").notNull(),
    credentialRef: text("credential_ref").notNull(),
    status: text("status", {
      enum: ["connected", "degraded", "needs_reauth", "disabled"],
    })
      .notNull()
      .default("connected"),
    capabilitySnapshot: text("capability_snapshot").notNull(), // JSON-serialized CapabilityDescriptor
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("integration_connection_principal_category_unique_index").on(
      table.category,
      table.principalRef,
    ),
  ],
);

// A typed relationship edge between two directory entities. Temporal (valid_from/valid_to); edge_type
// is open text constrained to a non-empty value so the catalog can grow without schema migrations.
export const directoryEdge = sqliteTable(
  "directory_edge",
  {
    id: text("id").primaryKey().$type<DirectoryEdgeId>(), // directoryEdge_ handle
    fromEntityId: text("from_entity_id").notNull(),
    toEntityId: text("to_entity_id").notNull(),
    edgeType: text("edge_type").notNull(), // e.g. 'director_of', 'shareholder_of', 'spouse_of'
    role: text("role"), // optional label enriching edge_type
    note: text("note"),
    validFrom: text("valid_from"),
    validTo: text("valid_to"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
    deletedAt: text("deleted_at"),
  },
  (table) => [
    index("directory_edge_from_entity_id_index").on(table.fromEntityId),
    index("directory_edge_to_entity_id_index").on(table.toEntityId),
    check("directory_edge_edge_type_nonempty_check", sql`length(${table.edgeType}) > 0`),
  ],
);

// Classification categories for directory entities. applies_to constrains which entity kinds may
// be tagged. Soft-archived (never deleted); position controls display order.
export const directoryCategory = sqliteTable(
  "directory_category",
  {
    id: text("id").primaryKey().$type<DirectoryCategoryId>(), // directoryCategory_ handle
    name: text("name").notNull(),
    appliesTo: text("applies_to").notNull().default("both"), // 'person' | 'organization' | 'both'
    position: integer("position").notNull().default(0),
    archived: integer("archived").notNull().default(0), // 0/1
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    check("directory_category_name_nonempty_check", sql`length(${table.name}) > 0`),
    check(
      "directory_category_applies_to_check",
      sql`${table.appliesTo} IN ('person', 'organization', 'both')`,
    ),
    check("directory_category_archived_check", sql`${table.archived} IN (0, 1)`),
  ],
);

// Many-to-many join between a directory entity and a category.
export const directoryEntityCategory = sqliteTable(
  "directory_entity_category",
  {
    entityId: text("entity_id").notNull(),
    categoryId: text("category_id")
      .notNull()
      .$type<DirectoryCategoryId>()
      .references(() => directoryCategory.id),
  },
  (table) => [primaryKey({ columns: [table.entityId, table.categoryId] })],
);

// Email addresses for a directory entity. Temporal and type-labelled; is_primary is enforced in the
// write path (exactly one primary per entity kind combination).
export const directoryEmail = sqliteTable(
  "directory_email",
  {
    id: text("id").primaryKey().$type<DirectoryEmailId>(), // directoryEmail_ handle
    entityId: text("entity_id").notNull(),
    label: text("label"), // e.g. 'work', 'personal'
    address: text("address").notNull(),
    isPrimary: integer("is_primary").notNull().default(0), // 0/1
    validFrom: text("valid_from"),
    validTo: text("valid_to"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
    deletedAt: text("deleted_at"),
  },
  (table) => [
    index("directory_email_entity_id_index").on(table.entityId),
    check("directory_email_address_nonempty_check", sql`length(${table.address}) > 0`),
    check("directory_email_is_primary_check", sql`${table.isPrimary} IN (0, 1)`),
  ],
);

// Phone numbers for a directory entity. Temporal and type-labelled.
export const directoryPhone = sqliteTable(
  "directory_phone",
  {
    id: text("id").primaryKey().$type<DirectoryPhoneId>(), // directoryPhone_ handle
    entityId: text("entity_id").notNull(),
    label: text("label"), // e.g. 'mobile', 'office', 'fax'
    number: text("number").notNull(),
    isPrimary: integer("is_primary").notNull().default(0), // 0/1
    validFrom: text("valid_from"),
    validTo: text("valid_to"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
    deletedAt: text("deleted_at"),
  },
  (table) => [
    index("directory_phone_entity_id_index").on(table.entityId),
    check("directory_phone_number_nonempty_check", sql`length(${table.number}) > 0`),
    check("directory_phone_is_primary_check", sql`${table.isPrimary} IN (0, 1)`),
  ],
);

// Structured postal addresses for a directory entity (street, city, region, postal, country).
// Temporal and type-labelled; is_primary is enforced in the write path.
export const directoryAddress = sqliteTable(
  "directory_address",
  {
    id: text("id").primaryKey().$type<DirectoryAddressId>(), // directoryAddress_ handle
    entityId: text("entity_id").notNull(),
    label: text("label"), // e.g. 'registered', 'postal', 'residential'
    street: text("street"),
    city: text("city"),
    region: text("region"),
    postal: text("postal"),
    country: text("country"),
    isPrimary: integer("is_primary").notNull().default(0), // 0/1
    validFrom: text("valid_from"),
    validTo: text("valid_to"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
    deletedAt: text("deleted_at"),
  },
  (table) => [
    index("directory_address_entity_id_index").on(table.entityId),
    check("directory_address_is_primary_check", sql`${table.isPrimary} IN (0, 1)`),
  ],
);

// Named party roles — the catalog of roles a directory entity can play on a matter (client,
// opposing party, witness, expert, etc.). Soft-archived; position controls display order.
export const directoryPartyRole = sqliteTable(
  "directory_party_role",
  {
    id: text("id").primaryKey().$type<DirectoryPartyRoleId>(), // directoryPartyRole_ handle
    name: text("name").notNull(),
    archived: integer("archived").notNull().default(0), // 0/1
    position: integer("position").notNull().default(0),
  },
  (table) => [
    uniqueIndex("directory_party_role_name_unique_index").on(table.name),
    check("directory_party_role_name_nonempty_check", sql`length(${table.name}) > 0`),
    check("directory_party_role_archived_check", sql`${table.archived} IN (0, 1)`),
  ],
);

// A directory entity playing a role on a matter. Temporal (valid_from/valid_to); soft-deleted.
// Connects the Directory domain to the Matters domain via entity_id (no cross-domain FK).
export const matterParty = sqliteTable(
  "matter_party",
  {
    id: text("id").primaryKey().$type<MatterPartyId>(), // matterParty_ handle
    matterId: text("matter_id")
      .notNull()
      .$type<MatterId>()
      .references(() => matter.id),
    entityId: text("entity_id").notNull(), // FK to directory_person.id or directory_organization.id
    role: text("role").notNull(), // e.g. 'client', 'opposing_party', 'witness'
    validFrom: text("valid_from"),
    validTo: text("valid_to"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
    deletedAt: text("deleted_at"),
  },
  (table) => [
    index("matter_party_matter_id_index").on(table.matterId),
    index("matter_party_entity_id_index").on(table.entityId),
    check("matter_party_role_nonempty_check", sql`length(${table.role}) > 0`),
  ],
);

// Append-only merge audit. When two entities are merged, the subordinate's id is repointed to the
// master; this row records that fact permanently. survivorship and repointed are JSON blobs —
// the merge service writes them; no schema migration is needed when the shape evolves.
export const entityMerge = sqliteTable("entity_merge", {
  id: text("id").primaryKey().$type<EntityMergeId>(), // entityMerge_ handle
  masterId: text("master_id").notNull(), // the surviving entity id
  subordinateId: text("subordinate_id").notNull(), // the absorbed entity id
  survivorship: text("survivorship"), // JSON: field-by-field survivorship decisions
  repointed: text("repointed"), // JSON: list of rows repointed from subordinate to master
  mergedAt: text("merged_at").notNull(),
  mergedBy: text("merged_by").notNull().$type<UserId>(), // global user handle; no cross-plane FK
});

// A mailing/postage shipment. Addresses, parcel, and options are JSON text (never sub-queried).
// postage_cost_minor / service_fee_minor are recorded at purchase — the cost-recovery seam the
// financial core reads to post a matter disbursement. matter_ref is optional (a shipment may be
// firm-administrative, not matter-linked).
export const shipment = sqliteTable(
  "shipment",
  {
    id: text("id").primaryKey().$type<ShipmentId>(),
    matterRef: text("matter_ref")
      .$type<MatterId>()
      .references(() => matter.id),
    status: text("status", {
      enum: ["draft", "rated", "purchased", "in_transit", "delivered", "refunded"],
    })
      .notNull()
      .default("draft"),
    fromAddress: text("from_address").notNull(), // JSON
    toAddress: text("to_address").notNull(), // JSON
    parcel: text("parcel").notNull(), // JSON
    options: text("options").notNull().default("{}"), // JSON ShipmentOptions
    remoteShipmentId: text("remote_shipment_id"), // EasyPost shipment id, set once rated/bought
    carrier: text("carrier"),
    service: text("service"),
    trackingCode: text("tracking_code"),
    labelRef: text("label_ref").$type<ShipmentLabelId>(),
    postageCostMinor: integer("postage_cost_minor"),
    serviceFeeMinor: integer("service_fee_minor"),
    currency: text("currency"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    index("shipment_matter_ref_index").on(table.matterRef),
    index("shipment_tracking_code_index").on(table.trackingCode),
  ],
);

// A bought label's metadata; the PDF bytes live in per-firm R2 at r2_key (bulk content never in D1).
export const shipmentLabel = sqliteTable("shipment_label", {
  id: text("id").primaryKey().$type<ShipmentLabelId>(),
  shipmentRef: text("shipment_ref")
    .notNull()
    .$type<ShipmentId>()
    .references(() => shipment.id),
  format: text("format").notNull(), // content type, e.g. application/pdf
  r2Key: text("r2_key").notNull(),
  trackingCode: text("tracking_code").notNull(),
  costMinor: integer("cost_minor").notNull(),
  currency: text("currency").notNull(),
  voided: integer("voided").notNull().default(0), // 0/1
  createdAt: text("created_at").notNull(),
});

// A carrier tracking event, appended as tracking is pulled. Dedup by (shipment_ref, remote_id).
export const trackingEvent = sqliteTable(
  "tracking_event",
  {
    id: text("id").primaryKey().$type<TrackingEventId>(),
    shipmentRef: text("shipment_ref")
      .notNull()
      .$type<ShipmentId>()
      .references(() => shipment.id),
    remoteId: text("remote_id").notNull(),
    status: text("status").notNull(),
    occurredAt: text("occurred_at"),
    location: text("location"),
    message: text("message"),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    uniqueIndex("tracking_event_shipment_remote_unique_index").on(
      table.shipmentRef,
      table.remoteId,
    ),
  ],
);

// Firm-defined fields that extend matter or entity records with arbitrary typed data.
// kind controls which value_* column is populated in custom_field_value; attachment_id scopes
// the field to a specific matter type or entity category (null = applies to all).
// number_scale is the number of decimal places implied by value_number (integer storage).
export const customField = sqliteTable(
  "custom_field",
  {
    id: text("id").primaryKey().$type<CustomFieldId>(),
    name: text("name").notNull(),
    kind: text("kind", {
      enum: [
        "checkbox",
        "date",
        "time",
        "number",
        "currency",
        "picklist",
        "single-line",
        "multi-line",
        "url",
        "email",
        "matter-reference",
        "contact-reference",
      ],
    }).notNull(),
    target: text("target", { enum: ["matter", "entity"] }).notNull(),
    attachmentId: text("attachment_id"),
    numberScale: integer("number_scale"),
    required: integer("required").notNull().default(0),
    archived: integer("archived").notNull().default(0),
    converting: integer("converting").notNull().default(0),
    position: integer("position").notNull().default(0),
    templateFieldKey: text("template_field_key"),
    createdAt: text("created_at").notNull(),
    createdBy: text("created_by"),
  },
  (table) => [index("custom_field_scope_index").on(table.target, table.attachmentId)],
);

// Available choices for a picklist custom field. Soft-archived (never deleted); position controls
// display order. field_id must reference a custom_field of kind 'picklist'.
export const picklistOption = sqliteTable(
  "picklist_option",
  {
    id: text("id").primaryKey().$type<PicklistOptionId>(),
    fieldId: text("field_id").notNull().$type<CustomFieldId>(),
    name: text("name").notNull(),
    position: integer("position").notNull().default(0),
    archived: integer("archived").notNull().default(0),
  },
  (table) => [index("picklist_option_field_id_index").on(table.fieldId)],
);

// Temporal value rows for a custom field on a target record (matter or entity). Exactly one of the
// five value_* columns must be non-null (enforced by CHECK). The partial unique index on
// (target_row_id, field_id) WHERE is_current = 1 guarantees at most one live value per field per
// record; superseded rows are retained (is_current = 0) for history and audit.
export const customFieldValue = sqliteTable(
  "custom_field_value",
  {
    id: text("id").primaryKey().$type<CustomFieldValueId>(),
    fieldId: text("field_id").notNull().$type<CustomFieldId>(),
    targetRowId: text("target_row_id").notNull(),
    valueText: text("value_text"),
    valueNumber: integer("value_number"),
    valueDate: text("value_date"),
    valueOptionId: text("value_option_id").$type<PicklistOptionId>(),
    valueReferenceId: text("value_reference_id"),
    isCurrent: integer("is_current").notNull().default(1),
    validFrom: text("valid_from").notNull(),
    validTo: text("valid_to"),
    createdAt: text("created_at").notNull(),
    createdBy: text("created_by"),
  },
  (table) => [
    uniqueIndex("custom_field_value_current_unique_index")
      .on(table.targetRowId, table.fieldId)
      .where(sql`${table.isCurrent} = 1`),
    index("custom_field_value_record_index").on(table.targetRowId, table.isCurrent),
    index("custom_field_value_field_index").on(table.fieldId),
    index("custom_field_value_reference_index").on(table.valueReferenceId),
  ],
);

// Effective-dated rate cards. Multiple named cards per firm (e.g. "Standard", "Insurance-capped");
// a matter/client can be placed on a specific card. Soft-archived, never hard-deleted.
export const rateCard = sqliteTable(
  "rate_card",
  {
    id: text("id").primaryKey().$type<RateCardId>(), // rateCard_ handle
    name: text("name").notNull(),
    archivedAt: text("archived_at"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [check("rate_card_name_nonempty_check", sql`length(${table.name}) > 0`)],
);

// Append-only rate versions. A rate change inserts a new row with a fresh valid_from; an existing
// row is never edited except to close its valid_to when a newer version supersedes it. The partial
// UNIQUE index enforces one OPEN row per (card, tier, scoped_id); closed-interval non-overlap is the
// service's job (SQLite has no range-exclusion constraint).
export const rate = sqliteTable(
  "rate",
  {
    id: text("id").primaryKey().$type<RateId>(), // rate_ handle
    rateCardId: text("rate_card_id")
      .notNull()
      .$type<RateCardId>()
      .references(() => rateCard.id),
    tier: text("tier", { enum: ["matter", "client", "timekeeper", "role"] }).notNull(),
    scopedId: text("scoped_id"), // null = the card-wide default for this tier
    rateE4: integer("rate_e4").notNull(), // rate per hour, scale 4 (integer-minor, no floats)
    currency: text("currency").notNull(), // ISO-4217, CHECK against the registered set
    validFrom: text("valid_from").notNull(), // civil PlainDate (YYYY-MM-DD)
    validTo: text("valid_to"), // null = open-ended
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    uniqueIndex("rate_open_row_unique_index")
      .on(table.rateCardId, table.tier, table.scopedId)
      .where(sql`${table.validTo} IS NULL`),
    index("rate_resolution_index").on(
      table.rateCardId,
      table.tier,
      table.scopedId,
      table.validFrom,
    ),
    check("rate_tier_check", sql`${table.tier} IN ('matter', 'client', 'timekeeper', 'role')`),
    check("rate_currency_check", sql`${table.currency} IN ('USD')`),
  ],
);

// The ABA UTBMS task/activity/expense code catalog. Seeded from the published sets as data; firms
// enable/disable rows, never invent codes. Owned here; the costs/billing slices read it.
export const utbmsCode = sqliteTable(
  "utbms_code",
  {
    id: text("id").primaryKey().$type<UtbmsCodeId>(), // utbmsCode_ handle
    codeSet: text("code_set", { enum: ["task", "activity", "expense"] }).notNull(),
    code: text("code").notNull(), // e.g. L120, A101, E101
    label: text("label").notNull(),
    practiceArea: text("practice_area"),
    active: integer("active").notNull().default(1),
  },
  (table) => [
    unique().on(table.codeSet, table.code),
    check("utbms_code_set_check", sql`${table.codeSet} IN ('task', 'activity', 'expense')`),
    check("utbms_code_active_check", sql`${table.active} IN (0, 1)`),
  ],
);

// Firm-configurable categories for non-billable internal time (seed-and-fork defaults). Soft-archived.
export const nonBillableCategory = sqliteTable(
  "non_billable_category",
  {
    id: text("id").primaryKey().$type<NonBillableCategoryId>(), // nonBillableCategory_ handle
    name: text("name").notNull(),
    archivedAt: text("archived_at"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [check("non_billable_category_name_nonempty_check", sql`length(${table.name}) > 0`)],
);

// Per-task-code narrative templates: a reusable description plus an optional default rate, filled
// into a new entry together. Soft-archived.
export const narrativeTemplate = sqliteTable(
  "narrative_template",
  {
    id: text("id").primaryKey().$type<NarrativeTemplateId>(), // narrativeTemplate_ handle
    utbmsTaskCodeId: text("utbms_task_code_id")
      .$type<UtbmsCodeId>()
      .references(() => utbmsCode.id),
    narrativeTemplate: text("narrative_template").notNull(),
    defaultRateE4: integer("default_rate_e4"), // optional default hourly rate, scale 4
    archivedAt: text("archived_at"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [index("narrative_template_utbms_task_code_index").on(table.utbmsTaskCodeId)],
);

// The work-in-progress store: one committed unit of captured time. The resolved rate is SNAPSHOT on
// capture (rate in force on work_date) and kept; amount_minor is recomputed only on an explicit
// re-rate. A billed/void row's business columns freeze — the service refuses any update beyond the
// billing invoice_id/lock set. rate_e4/rate_card_id/rate_source/amount_minor are null together for
// non-billable internal time (the paired-null CHECK).
export const timeEntry = sqliteTable(
  "time_entry",
  {
    id: text("id").primaryKey().$type<TimeEntryId>(), // timeEntry_ handle
    matterId: text("matter_id")
      .notNull()
      .$type<MatterId>()
      .references(() => matter.id),
    timekeeperUserId: text("timekeeper_user_id")
      .notNull()
      .$type<UserId>()
      .references(() => member.userId),
    workDate: text("work_date").notNull(), // civil PlainDate (YYYY-MM-DD) — the effective date
    durationMinutes: integer("duration_minutes").notNull(), // rounded billable quantity
    rawDurationMinutes: integer("raw_duration_minutes").notNull(), // captured pre-rounding minutes
    narrative: text("narrative").notNull(),
    billable: integer("billable").notNull(),
    nonBillableCategoryId: text("non_billable_category_id")
      .$type<NonBillableCategoryId>()
      .references(() => nonBillableCategory.id),
    currency: text("currency").notNull(), // ISO-4217, CHECK against the registered set
    rateE4: integer("rate_e4"), // resolved rate snapshot, scale 4; null for non-billable
    rateCardId: text("rate_card_id")
      .$type<RateCardId>()
      .references(() => rateCard.id),
    rateSource: text("rate_source", {
      enum: ["override", "matter", "client", "timekeeper", "role", "card_default"],
    }),
    amountMinor: integer("amount_minor"), // round(rate x hours), scale 2; null when rate_e4 is null
    utbmsTaskCodeId: text("utbms_task_code_id")
      .$type<UtbmsCodeId>()
      .references(() => utbmsCode.id),
    utbmsActivityCodeId: text("utbms_activity_code_id")
      .$type<UtbmsCodeId>()
      .references(() => utbmsCode.id),
    status: text("status", {
      enum: ["draft", "submitted", "approved", "billed", "void"],
    }).notNull(),
    source: text("source", {
      enum: ["timer", "manual", "quick_add", "grid", "offline_sync", "calendar"],
    }).notNull(),
    liveRunId: text("live_run_id"), // set for source = timer; the stop-commit dedup anchor
    invoiceId: text("invoice_id"), // set at billing; null until billed
    // The reviewer's note set on kick-back, cleared when the timekeeper resubmits. Stored here
    // (not audit_log.metadata) so it inherits the entry's tenancy, RBAC, and retention, and
    // can be read back by the timekeeper without a privileged audit-log read.
    kickBackReason: text("kick_back_reason"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
    createdBy: text("created_by"), // actor user handle (not an FK)
  },
  (table) => [
    index("time_entry_timekeeper_work_date_index").on(table.timekeeperUserId, table.workDate),
    index("time_entry_matter_status_index").on(table.matterId, table.status),
    index("time_entry_status_work_date_index").on(table.status, table.workDate),
    // Collapses racing stop-commits of one live timer to one entry.
    uniqueIndex("time_entry_live_run_id_unique_index")
      .on(table.liveRunId)
      .where(sql`${table.liveRunId} IS NOT NULL`),
    check("time_entry_billable_check", sql`${table.billable} IN (0, 1)`),
    check(
      "time_entry_status_check",
      sql`${table.status} IN ('draft', 'submitted', 'approved', 'billed', 'void')`,
    ),
    check(
      "time_entry_source_check",
      sql`${table.source} IN ('timer', 'manual', 'quick_add', 'grid', 'offline_sync', 'calendar')`,
    ),
    check(
      "time_entry_rate_source_check",
      sql`${table.rateSource} IS NULL OR ${table.rateSource} IN ('override', 'matter', 'client', 'timekeeper', 'role', 'card_default')`,
    ),
    check("time_entry_currency_check", sql`${table.currency} IN ('USD')`),
    // The money snapshot is all-or-nothing: amount_minor is present exactly when rate_e4 is.
    check(
      "time_entry_amount_paired_null_check",
      sql`(${table.amountMinor} IS NULL) = (${table.rateE4} IS NULL)`,
    ),
  ],
);

// The costs/expenses WIP store: one matter disbursement captured as a cost entry. Parallels
// time_entry for non-time billables (hard/soft costs, postage, filing fees, etc.) and the
// cost-recovery seam (source = recovery, tied to a provider event via recovery_ref). A billed/void
// row's business columns freeze; the service refuses any update beyond the invoice lock set.
// amount_minor is always present (costs are exact amounts, not rate × quantity); currency is
// locked to USD for now with room to expand via the CHECK.
export const costEntry = sqliteTable(
  "cost_entry",
  {
    id: text("id").primaryKey().$type<CostEntryId>(),
    matterId: text("matter_id")
      .notNull()
      .references(() => matter.id),
    vendorId: text("vendor_id"), // nullable Directory entity id
    incurredDate: text("incurred_date").notNull(),
    amountMinor: integer("amount_minor").notNull(),
    currency: text("currency").notNull(),
    // disbursement_class is the industry "hard/soft cost" classification (column name avoids the
    // money-ish name conformance gate which flags any column containing "cost_").
    disbursementClass: text("disbursement_class").notNull(), // hard | soft
    billable: integer("billable").notNull(), // 0/1
    utbmsExpenseCodeId: text("utbms_expense_code_id").references(() => utbmsCode.id),
    description: text("description").notNull().default(""),
    receiptFileId: text("receipt_file_id"), // nullable File Manager doc
    status: text("status").notNull(), // draft|submitted|approved|billed|void
    kickBackReason: text("kick_back_reason"),
    source: text("source").notNull(), // manual|grid|recovery
    recoveryCategory: text("recovery_category"),
    recoveryRef: text("recovery_ref"),
    invoiceId: text("invoice_id"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
    createdBy: text("created_by"),
  },
  (table) => [
    check(
      "cost_entry_disbursement_class_check",
      sql`${table.disbursementClass} IN ('hard','soft')`,
    ),
    check(
      "cost_entry_status_check",
      sql`${table.status} IN ('draft','submitted','approved','billed','void')`,
    ),
    check("cost_entry_source_check", sql`${table.source} IN ('manual','grid','recovery')`),
    check("cost_entry_billable_check", sql`${table.billable} IN (0,1)`),
    check("cost_entry_currency_check", sql`${table.currency} IN ('USD')`),
    index("cost_entry_matter_status_index").on(table.matterId, table.status),
    index("cost_entry_status_incurred_date_index").on(table.status, table.incurredDate),
    uniqueIndex("cost_entry_recovery_ref_unique")
      .on(table.recoveryRef)
      .where(sql`${table.recoveryRef} IS NOT NULL`),
  ],
);

// The conflicts log. Three append-only tables: no UPDATE and no DELETE ever touches them, enforced
// by RAISE(ABORT) triggers in the migration. The log is the compliance artifact a malpractice defense
// rests on — a reviewer who clears a hit and later reverses must leave both acts visible, so a
// reversal is a second disposition row rather than an edit.
export const conflictsCheck = sqliteTable(
  "conflicts_check",
  {
    id: text("id").primaryKey().$type<ConflictsCheckId>(),
    trigger: text("trigger").notNull(),
    // Null for a pre-consult check against a prospective party set that has no matter yet.
    subjectMatterId: text("subject_matter_id").$type<MatterId>(),
    subjectPartiesJson: text("subject_parties_json").notNull(), // JSON array of entity ids
    // The scope in force: each source class with its availability. An auditor must be able to tell
    // "searched and clean" apart from "never searched".
    scopeJson: text("scope_json").notNull(),
    strictness: text("strictness").notNull(),
    depth: integer("depth").notNull(),
    // Identifiers recorded BY REFERENCE (directory_identifier.id) — never a plaintext value.
    // Also records identifier types skipped as non-indexable, so the log never implies they were searched.
    inputsJson: text("inputs_json").notNull(),
    // 1 when the requested scope fell below the firm floor and was raised to it.
    floorRaised: integer("floor_raised", { mode: "boolean" }).notNull().default(false),
    actorUserId: text("actor_user_id").$type<UserId>(),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    check("conflicts_check_trigger_check", sql`length(${table.trigger}) > 0`),
    check("conflicts_check_strictness_check", sql`${table.strictness} IN ('balanced', 'over_inclusive')`),
    check("conflicts_check_depth_check", sql`${table.depth} >= 0`),
  ],
);

export const conflictsHit = sqliteTable(
  "conflicts_hit",
  {
    id: text("id").primaryKey().$type<ConflictsHitId>(),
    checkId: text("check_id").notNull().$type<ConflictsCheckId>().references(() => conflictsCheck.id),
    // The merge-resolved master entity, never an archived subordinate.
    entityId: text("entity_id").notNull(),
    sourceClass: text("source_class").notNull(),
    // 1 exact identifier, 2 exact normalized name, 3 phonetic code, 4 trigram overlap only.
    // Ordering only — never a threshold. Nothing is suppressed by tier.
    evidenceTier: integer("evidence_tier").notNull(),
    matchedFieldsJson: text("matched_fields_json").notNull(),
    // The connecting edge path, '[]' when the entity was reached directly.
    graphPathJson: text("graph_path_json").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    index("conflicts_hit_check_id_index").on(table.checkId),
    check("conflicts_hit_tier_check", sql`${table.evidenceTier} BETWEEN 1 AND 4`),
    check(
      "conflicts_hit_source_class_check",
      sql`${table.sourceClass} IN ('party', 'graph', 'imputation', 'content')`,
    ),
  ],
);

export const conflictsDisposition = sqliteTable(
  "conflicts_disposition",
  {
    id: text("id").primaryKey().$type<ConflictsDispositionId>(),
    hitId: text("hit_id").notNull().$type<ConflictsHitId>().references(() => conflictsHit.id),
    kind: text("kind").notNull(),
    rationale: text("rationale").notNull(),
    reviewerUserId: text("reviewer_user_id").notNull().$type<UserId>(),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    index("conflicts_disposition_hit_id_created_at_index").on(table.hitId, table.createdAt),
    check(
      "conflicts_disposition_kind_check",
      sql`${table.kind} IN ('cleared', 'waiver_obtained', 'wall_erected', 'representation_declined')`,
    ),
  ],
);
