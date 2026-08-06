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
  CustodyDestructionRequestId,
  CustodyHoldId,
  CustodyItemId,
  CustodyItemTypeId,
  CustodyLocationId,
  CustodyMovementId,
  CustodyOwnerId,
  CustodyPacketId,
  CustodyScanId,
  CustodyStocktakeId,
  CustodyStocktakeSightingId,
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
  DiscoveryLoadId,
  DocumentAssemblyId,
  DocumentTemplateFieldMappingId,
  DocumentTemplateId,
  DocumentTemplateVersionId,
  DocumentTypeId,
  DocumentCheckoutId,
  EmailAttachmentId,
  EmailAutoFileDecisionId,
  EmailAutoFileRuleId,
  EmailCaptureAddressId,
  EmailMatterLinkId,
  EmailMessageId,
  EmailParticipantId,
  EmailThreadId,
  EntityMergeId,
  FileId,
  FileVersionId,
  FirmSecretId,
  FolderId,
  GrantId,
  IdempotencyRecordId,
  IncidentId,
  IndexSplitId,
  IntegrationConnectionId,
  InvoiceApplicationId,
  InvoiceId,
  InvoiceLineId,
  InvoiceWipClaimId,
  LedgerAccountId,
  LedgerEntryId,
  LedgerLineId,
  LocationAddressId,
  LocationId,
  MagnusConversationId,
  MagnusTurnId,
  MatterAssetDocumentId,
  MatterAssetId,
  MatterAssetIdentifierId,
  MatterAssetInterestId,
  MatterAssetTypeId,
  MatterAssetValuationId,
  MatterDeadlineId,
  MatterEventId,
  MatterEventParticipantId,
  MatterEventTypeId,
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
  RecordCustodianId,
  RepairProvenanceId,
  ReviewDocumentExceptionId,
  ReviewDocumentId,
  ReviewDocumentOccurrenceId,
  ReviewSetId,
  RoleId,
  RolePermissionId,
  ShipmentId,
  ShipmentLabelId,
  TimeEntryId,
  TrackingEventId,
  TrustAccountId,
  TrustBankStatementId,
  TrustBankStatementLineId,
  TrustDisbursementDecisionId,
  TrustDisbursementRequestId,
  TrustHoldId,
  TrustLedgerNodeId,
  TrustMovementId,
  TrustReconciliationId,
  TrustReconciliationMatchId,
  TrustTransferId,
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
    // The office's IANA time zone (America/Los_Angeles), never a fixed offset — an offset breaks
    // across daylight saving, which is the whole reason a zone is stored instead. Nullable while
    // offices that predate the column are filled in; timeZoneForLocation in
    // packages/document-assembly/src/resolve.ts is the one place it enters the platform, so a null
    // resolves to the platform-normalized zone in exactly one spot rather than in every formatter.
    timeZone: text("time_zone"),
    numberCode: text("number_code"), // short code the matter-numbering location segment renders
    addressBlock: text("address_block"), // free-text letterhead address
    footer: text("footer"), // free-text letterhead footer
    remitTo: text("remit_to"), // free-text billing remit-to
    // The office's letterhead logo. The BYTES live in the firm's own bucket (bulk content never goes in
    // D1); the row carries the object key, what the bytes are, and how large the mark prints.
    // letterhead_logo_width_emu is the only dimension stored on purpose: the height follows from the
    // image's own proportions at render time, so no document can print a stretched logo and replacing a
    // wide mark with a tall one re-lays every letterhead out correctly without touching a template.
    letterheadLogoObjectKey: text("letterhead_logo_object_key"),
    letterheadLogoContentType: text("letterhead_logo_content_type"),
    letterheadLogoSizeBytes: integer("letterhead_logo_size_bytes"),
    letterheadLogoSha256: text("letterhead_logo_sha256"),
    letterheadLogoWidthPixels: integer("letterhead_logo_width_pixels"),
    letterheadLogoHeightPixels: integer("letterhead_logo_height_pixels"),
    letterheadLogoWidthEmu: integer("letterhead_logo_width_emu"),
    letterheadLogoUpdatedAt: text("letterhead_logo_updated_at"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("location_number_code_unique_index").on(table.numberCode),
    check("location_status_check", sql`${table.status} IN ('active', 'closed')`),
    check("location_name_nonempty_check", sql`length(${table.name}) > 0`),
    // The two letterhead-logo rules — PNG or JPEG only, and "an object key and a width or neither" —
    // are NOT CHECK constraints, deliberately. SQLite can only add a table CHECK by rebuilding the
    // table, and this lineage rebuilds no table (the migration suite asserts it); more to the point,
    // the content type here is the result of a magic-byte sniff over the uploaded bytes rather than a
    // value a caller supplies, so the enforceable version of the rule is in @magna-carta/locations,
    // where the bytes are, not in a column constraint that could only re-check a decision already made.
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
    // Names a platform-owned matter that exists to satisfy a structural requirement rather than to
    // hold a client engagement — today only the custody holding matter, which is where a scan of an
    // original held for someone with no matter is filed. Null on every real matter. Marked rather
    // than hidden by convention so list reads, reports, conflicts, and billing have one column to
    // exclude, and so the alternative (relaxing file.matter_id to nullable, which seven subsystems
    // depend on) is not forced by one consumer's need.
    systemKey: text("system_key"),
    openedAt: text("opened_at"),
    closedAt: text("closed_at"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("matter_matter_number_unique_index")
      .on(table.matterNumber)
      .where(sql`${table.matterNumber} IS NOT NULL`),
    // At most one matter per firm per system key — the find-or-insert guard that collapses two
    // concurrent first-use creations onto one row.
    uniqueIndex("matter_system_key_unique_index")
      .on(table.systemKey)
      .where(sql`${table.systemKey} IS NOT NULL`),
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

// Every counter value a number draw actually consumed, one row per {scope_key, drawn_value}. The
// guarded increment alone cannot keep concurrent draws distinct: when the active scheme carries a
// variable segment that is NOT marked scoping (a client code, staff initials, a matter-type code),
// two draws in the same counter scope render DIFFERENT numbers from the SAME value, so
// matter_matter_number_unique_index never fires and the losing draw silently commits a duplicate of
// the winner's counter value. This composite primary key is the constraint that does fire: the
// loser's whole batch aborts and its bounded retry re-reads the advanced counter.
export const matterNumberAllocation = sqliteTable(
  "matter_number_allocation",
  {
    scopeKey: text("scope_key").notNull(), // the matter_number_counter row this value came from
    drawnValue: integer("drawn_value").notNull(), // the counter value this draw consumed
    matterId: text("matter_id")
      .notNull()
      .$type<MatterId>()
      .references(() => matter.id),
    allocatedAt: text("allocated_at").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.scopeKey, table.drawnValue] }),
    index("matter_number_allocation_matter_id_index").on(table.matterId),
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
    // A matter's own lifecycle — opened, closed, reopened — lives on two nullable `matter` columns
    // and in this log, and nowhere else, so the matter timeline reads those three events from here
    // over a STRICT allowlist of event keys (packages/calendar/src/sources/matter-lifecycle.ts).
    // Leading with subject_id confines that walk to one matter; created_at then id carry the
    // newest-first order, so the read is an index walk rather than a scan of the firm's every
    // audited action. It is deliberately not a general timeline substrate: this table records when a
    // row was WRITTEN, not when the thing happened.
    index("audit_log_subject_created_id_index").on(table.subjectId, table.createdAt, table.id),
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
// write path (at most one primary per entity). `address` is stored as entered (trimmed);
// `normalized_address` is the lowercased match key an address -> entity reverse lookup queries, so a
// participant on a captured email resolves to the Person/Organization it belongs to. The reverse
// lookup joins the node row to resolve a merged-away entity to its surviving master, mirroring the
// name search channels.
export const directoryEmail = sqliteTable(
  "directory_email",
  {
    id: text("id").primaryKey().$type<DirectoryEmailId>(), // directoryEmail_ handle
    entityId: text("entity_id").notNull(),
    label: text("label"), // e.g. 'work', 'personal'
    address: text("address").notNull(),
    // Lowercased, trimmed match key for the address -> entity reverse lookup. Nullable so the column
    // is added by a non-destructive ALTER ADD COLUMN (expand-contract discipline — no table rebuild);
    // the write path always populates it, so a null only ever means a row predating the write path.
    normalizedAddress: text("normalized_address"),
    isPrimary: integer("is_primary").notNull().default(0), // 0/1
    validFrom: text("valid_from"),
    validTo: text("valid_to"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
    deletedAt: text("deleted_at"),
  },
  (table) => [
    index("directory_email_entity_id_index").on(table.entityId),
    index("directory_email_normalized_address_index").on(table.normalizedAddress),
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
    // `purchasing` is the exclusive claim a label purchase takes before it spends money at the
    // carrier: the carrier has no idempotency facility, so the claim (not a request header) is what
    // makes a retried or concurrent purchase unable to buy a second label for one shipment.
    status: text("status", {
      enum: ["draft", "rated", "purchasing", "purchased", "in_transit", "delivered", "refunded"],
    })
      .notNull()
      .default("draft"),
    fromAddress: text("from_address").notNull(), // JSON
    toAddress: text("to_address").notNull(), // JSON
    parcel: text("parcel").notNull(), // JSON
    options: text("options").notNull().default("{}"), // JSON ShipmentOptions
    remoteShipmentId: text("remote_shipment_id"), // EasyPost shipment id, set once rated/bought
    // Who holds the in-flight purchase claim (the request's idempotency key). Only the holder may
    // release it, so a failed attempt cannot be cleared out from under a purchase still in flight.
    purchaseClaimKey: text("purchase_claim_key"),
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
    // A matter's own conflicts history, newest first: leading with the matter confines the walk, and
    // created_at then id carry the order. Without it the matter timeline's conflicts source would
    // scan every check the firm has ever run to find the handful belonging to one matter.
    index("conflicts_check_subject_matter_created_id_index").on(
      table.subjectMatterId,
      table.createdAt,
      table.id,
    ),
    check("conflicts_check_trigger_check", sql`length(${table.trigger}) > 0`),
    check(
      "conflicts_check_strictness_check",
      sql`${table.strictness} IN ('balanced', 'over_inclusive')`,
    ),
    check("conflicts_check_depth_check", sql`${table.depth} >= 0`),
  ],
);

export const conflictsHit = sqliteTable(
  "conflicts_hit",
  {
    id: text("id").primaryKey().$type<ConflictsHitId>(),
    checkId: text("check_id")
      .notNull()
      .$type<ConflictsCheckId>()
      .references(() => conflictsCheck.id),
    // The merge-resolved master entity, never an archived subordinate.
    entityId: text("entity_id").notNull(),
    sourceClass: text("source_class").notNull(),
    // 1 exact identifier, 2 exact normalized name, 3 phonetic code, 4 trigram overlap only.
    // Ordering only — never a threshold. Nothing is suppressed by tier.
    evidenceTier: integer("evidence_tier").notNull(),
    matchedFieldsJson: text("matched_fields_json").notNull(),
    // The connecting edge path, '[]' when the entity was reached directly.
    graphPathJson: text("graph_path_json").notNull(),
    // 1 when the matched entity is itself a subject party of THIS check — a co-party surfacing: a
    // positional conflict (a related entity that is also a named party, e.g. the opposing party is the
    // client's parent company) or a co-party name/identifier collision. Orthogonal to source_class
    // (a co-party can be reached by the party OR the graph channel); it buckets the hit apart from a
    // conflict with a prior/other client so a reviewer can triage it separately.
    coParty: integer("co_party").notNull().default(0),
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
    hitId: text("hit_id")
      .notNull()
      .$type<ConflictsHitId>()
      .references(() => conflictsHit.id),
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

// Discovery search-index catalog: one row per immutable Tantivy split stored in the firm's R2. This is
// the authority a query enumerates to know which splits are live for a matter — never an R2 bucket list,
// which would be slower and would not carry firm scoping structurally. Firm data (the index is durable
// per-firm data, unlike the transient scan/conversion artifacts), access-gated with the matter it
// belongs to. A split is immutable: rows are inserted on publish and marked superseded by compaction,
// never mutated in place. `superseded_at IS NULL` is the live set.
export const indexSplit = sqliteTable(
  "index_split",
  {
    id: text("id").primaryKey().$type<IndexSplitId>(),
    matterId: text("matter_id").notNull().$type<MatterId>(),
    // The one document version this split indexes, for a split the write pipeline publishes. The write
    // pipeline builds one split per document version so a re-index converges: the split id is derived
    // from these two columns, a retry rebuilds the same split, and the publish deletes the document's
    // prior rows and objects before inserting the new one instead of accumulating duplicates.
    // Both are NULL for a split that spans many documents — the shape a later compaction pass publishes
    // when it merges the small per-document splits — so the merged split is simply unconstrained here.
    documentId: text("document_id").$type<FileId>(),
    version: integer("version"),
    // The split object's key in the firm's R2 bucket (e.g. search/<matter>/splits/<id>.split).
    objectKey: text("object_key").notNull(),
    // How many passages the split indexes, and its size — the inputs a compaction decision reads
    // without opening the split.
    documentCount: integer("document_count").notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    // The Tantivy schema generation the split was built with; a query refuses a split whose generation
    // it does not understand, so a schema change never silently mixes incompatible splits.
    schemaGeneration: integer("schema_generation").notNull(),
    createdAt: text("created_at").notNull(), // ISO-8601 instant
    // Null while the split is live; set to the instant compaction replaced it. A superseded split's row
    // is kept until its object is garbage-collected, so an in-flight query against it still resolves.
    supersededAt: text("superseded_at"),
  },
  (table) => [
    // The live-splits-for-a-matter read: WHERE matter_id = ? AND superseded_at IS NULL.
    index("index_split_matter_superseded_index").on(table.matterId, table.supersededAt),
    // The document's own splits: the read the write pipeline makes before publishing, to find the rows
    // and R2 objects a re-index must delete.
    index("index_split_document_index").on(table.documentId),
    // At most one LIVE split per document version. This is the convergence guarantee the write pipeline
    // rests on: a duplicate delivery that raced past the delete cannot leave two live splits indexing
    // the same version, so a query can never count a document twice. Partial, so the many-document
    // splits a compaction publishes (document_id NULL) are outside it.
    uniqueIndex("index_split_document_version_unique")
      .on(table.documentId, table.version)
      .where(sql`${table.documentId} IS NOT NULL AND ${table.supersededAt} IS NULL`),
  ],
);

// Email filing & capture — the matter-email record model. Metadata here in per-firm D1; the verbatim
// original message and every extracted attachment live in per-firm R2, never D1. A matter's email view
// is reconstructed from the links + the thread DAG, never a re-saved per-reply blob. Written by the
// @magna-carta/email-filing capture core over the @magna-carta/email parse engine; behavior lives in
// that package and @magna-carta/data-access, not here.

// The conversation grouping. Edges are carried on email_message (thread_id + in_reply_to/references);
// a separate edge table is deferred until the integrity/tamper-diff work needs it — the DAG is a
// property of the messages, and this row is the grouping key plus a normalized-subject fallback.
export const emailThread = sqliteTable(
  "email_thread",
  {
    id: text("id").primaryKey().$type<EmailThreadId>(), // emailThread_ handle
    subjectNormalized: text("subject_normalized"),
    firstSeenAt: text("first_seen_at").notNull(),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [index("email_thread_subject_normalized_index").on(table.subjectNormalized)],
);

// One row per UNIQUE message — the unit of truth. Deduped per firm on dedup_key (Message-ID when
// present, else a normalized-header+body content hash), so cross-user/cross-inbox captures of the same
// mail converge to one row. message_id_provenance is never flattened away: a MAPI-synthesized
// identifier is not the same bytes as another recipient's .eml header carries.
export const emailMessage = sqliteTable(
  "email_message",
  {
    id: text("id").primaryKey().$type<EmailMessageId>(), // emailMessage_ handle
    messageIdValue: text("message_id_value"), // null when the message carried no identifier
    messageIdProvenance: text("message_id_provenance", {
      enum: ["header", "mapi", "absent"],
    }).notNull(),
    subject: text("subject"),
    sentAt: text("sent_at"), // the Date header instant, ISO-8601; null when unparseable
    receivedAt: text("received_at").notNull(), // when the firm captured it, ISO-8601
    fromDisplay: text("from_display"),
    fromAddress: text("from_address"),
    threadId: text("thread_id")
      .notNull()
      .$type<EmailThreadId>()
      .references(() => emailThread.id),
    inReplyTo: text("in_reply_to"),
    contentSha256: text("content_sha256").notNull(),
    dedupKey: text("dedup_key").notNull(),
    originalR2Key: text("original_r2_key").notNull(), // the verbatim original, kept whole in R2
    referencesRemoteContent: integer("references_remote_content", { mode: "boolean" })
      .notNull()
      .default(false),
    integrity: text("integrity").notNull(), // JSON: verbatim DKIM signatures, Authentication-Results, Received chain — the evidence, recorded exactly as parsed
    // The adjudication OVER that evidence, kept separate from it. The verdict is informational: nothing
    // is dropped, refused, or auto-filed on the strength of it. Every inconclusive outcome stays
    // `unverified` and is told apart by the reason, so the coarse verdict means one thing to a reader.
    dkimVerdict: text("dkim_verdict", { enum: ["unverified", "pass", "fail"] })
      .notNull()
      .default("unverified"),
    dkimVerdictReason: text("dkim_verdict_reason"), // null until a verifier has looked at the message
    dkimVerifiedDomain: text("dkim_verified_domain"), // the signing domain, set only on a pass
    sourceFormat: text("source_format", { enum: ["eml", "msg", "mboxMember"] }).notNull(),
    capturedVia: text("captured_via", { enum: ["forward", "api", "addin", "sync"] }).notNull(),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    // One row per firm-unique message: the unique dedup_key is what makes a second capture converge.
    uniqueIndex("email_message_dedup_key_unique_index").on(table.dedupKey),
    index("email_message_thread_id_index").on(table.threadId),
    index("email_message_message_id_value_index").on(table.messageIdValue),
    // The content-hash "already filed" probe and the discovery-readiness content hash resolve by this.
    index("email_message_content_sha256_index").on(table.contentSha256),
    // No index on the dkim columns: they are read as part of a message already resolved by id, and
    // there is no "which mail did this domain sign" read to serve. One gets added with its reader.
    check(
      "email_message_provenance_check",
      sql`${table.messageIdProvenance} IN ('header', 'mapi', 'absent')`,
    ),
    check(
      "email_message_dkim_verdict_check",
      sql`${table.dkimVerdict} IN ('unverified', 'pass', 'fail')`,
    ),
    check(
      "email_message_source_format_check",
      sql`${table.sourceFormat} IN ('eml', 'msg', 'mboxMember')`,
    ),
    check(
      "email_message_captured_via_check",
      sql`${table.capturedVia} IN ('forward', 'api', 'addin', 'sync')`,
    ),
  ],
);

// The multi-matter junction — one message stored once, linked to many matters. Unique on
// (email_message, matter): a message can't double-file to the same matter but can link to many.
// Access is per-link/per-matter; unlink flips state, never deletes the message.
export const emailMatterLink = sqliteTable(
  "email_matter_link",
  {
    id: text("id").primaryKey().$type<EmailMatterLinkId>(), // emailMatterLink_ handle
    emailMessageId: text("email_message_id")
      .notNull()
      .$type<EmailMessageId>()
      .references(() => emailMessage.id),
    matterId: text("matter_id")
      .notNull()
      .$type<MatterId>()
      .references(() => matter.id),
    state: text("state", { enum: ["staged", "filed", "unlinked"] })
      .notNull()
      .default("staged"),
    linkedBy: text("linked_by").$type<UserId>(), // null when the forward path staged it with no acting user
    linkedAt: text("linked_at"),
    capturedVia: text("captured_via", { enum: ["forward", "api", "addin", "sync"] }).notNull(),
    tags: text("tags"), // JSON array of per-matter tag strings; null when none
    // Null means a person made this link; non-null means an auto-file rule did, and names which one.
    // The one fact every read of a link needs; everything richer is a join to the decision ledger.
    autoFileRuleId: text("auto_file_rule_id")
      .$type<EmailAutoFileRuleId>()
      .references(() => emailAutoFileRule.id),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("email_matter_link_message_matter_unique_index").on(
      table.emailMessageId,
      table.matterId,
    ),
    // A matter's email list keyset-paginates on (created_at DESC, id DESC) under a matter filter;
    // leading with matter_id lets one composite serve the filter, the reversed sort, and the FK lookup.
    index("email_matter_link_matter_created_id_index").on(
      table.matterId,
      table.createdAt,
      table.id,
    ),
    index("email_matter_link_email_message_id_index").on(table.emailMessageId),
    // "Which matters have I been filing mail to lately" — the mail-client quick-pick list. Leading
    // with linked_by confines the walk to one member's own filings; created_at then id carry the
    // newest-first order, so the read is an index walk rather than a scan of the firm's every link.
    index("email_matter_link_linked_by_created_index").on(
      table.linkedBy,
      table.createdAt,
      table.id,
    ),
    check("email_matter_link_state_check", sql`${table.state} IN ('staged', 'filed', 'unlinked')`),
    check(
      "email_matter_link_captured_via_check",
      sql`${table.capturedVia} IN ('forward', 'api', 'addin', 'sync')`,
    ),
  ],
);

// Each from/to/cc/bcc address, frozen as-at receipt (the frozen string is the record — no shadow
// address list). directory_entity_id enriches it, resolved through the Directory reverse lookup where
// a match exists and left null otherwise. No cross-domain FK on the entity id (the matter_party
// precedent) — it points into the Directory graph by value.
export const emailParticipant = sqliteTable(
  "email_participant",
  {
    id: text("id").primaryKey().$type<EmailParticipantId>(), // emailParticipant_ handle
    emailMessageId: text("email_message_id")
      .notNull()
      .$type<EmailMessageId>()
      .references(() => emailMessage.id),
    kind: text("kind", { enum: ["from", "to", "cc", "bcc"] }).notNull(),
    displayName: text("display_name"),
    address: text("address"), // null when the header carried a display name with no address
    directoryEntityId: text("directory_entity_id"), // FK-free link into directory_person/directory_organization; null when unresolved
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    index("email_participant_email_message_id_index").on(table.emailMessageId),
    index("email_participant_directory_entity_id_index").on(table.directoryEntityId),
    check("email_participant_kind_check", sql`${table.kind} IN ('from', 'to', 'cc', 'bcc')`),
  ],
);

// Ties a File Manager document back to its message. The bytes ride the existing untrusted-file ingest
// chokepoint (staged -> scanned -> quarantined), landing a matter-rooted file/file_version; this row
// is the link. A decorative inline cid: image is recorded (disposition 'inline', outcome
// 'filtered_inline', file_id null) so a later "promote to document" is a data change, not a re-parse;
// an oversize part records outcome 'oversize' rather than failing the whole message.
export const emailAttachment = sqliteTable(
  "email_attachment",
  {
    id: text("id").primaryKey().$type<EmailAttachmentId>(), // emailAttachment_ handle
    emailMessageId: text("email_message_id")
      .notNull()
      .$type<EmailMessageId>()
      .references(() => emailMessage.id),
    fileId: text("file_id")
      .$type<FileId>()
      .references(() => file.id), // null for a filtered inline image or an oversize part not extracted
    filename: text("filename"),
    mediaType: text("media_type"),
    disposition: text("disposition", { enum: ["attachment", "inline"] }).notNull(),
    promotedFromInline: integer("promoted_from_inline", { mode: "boolean" })
      .notNull()
      .default(false),
    outcome: text("outcome", { enum: ["extracted", "filtered_inline", "oversize"] })
      .notNull()
      .default("extracted"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    index("email_attachment_email_message_id_index").on(table.emailMessageId),
    index("email_attachment_file_id_index").on(table.fileId),
    check(
      "email_attachment_disposition_check",
      sql`${table.disposition} IN ('attachment', 'inline')`,
    ),
    check(
      "email_attachment_outcome_check",
      sql`${table.outcome} IN ('extracted', 'filtered_inline', 'oversize')`,
    ),
  ],
);

// A per-firm forward/CC capture address the Email Worker routes on. A per-matter token
// (matter-<token>@in.magnacarta.esq) resolves to a firm + candidate matter; the firm catch-all
// resolves to the firm with no matter (staff route it). Minted/rotated under
// emails:manageCaptureAddresses. The token is opaque and server-minted, never client-derived.
export const emailCaptureAddress = sqliteTable(
  "email_capture_address",
  {
    id: text("id").primaryKey().$type<EmailCaptureAddressId>(), // emailCaptureAddress_ handle
    token: text("token").notNull(),
    kind: text("kind", { enum: ["matter", "catchAll"] }).notNull(),
    matterId: text("matter_id")
      .$type<MatterId>()
      .references(() => matter.id), // set for a per-matter token; null for the firm catch-all
    active: integer("active", { mode: "boolean" }).notNull().default(true),
    createdBy: text("created_by").$type<UserId>(),
    rotatedAt: text("rotated_at"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("email_capture_address_token_unique_index").on(table.token),
    index("email_capture_address_matter_id_index").on(table.matterId),
    check("email_capture_address_kind_check", sql`${table.kind} IN ('matter', 'catchAll')`),
  ],
);

// One typed, matter-bound, revocable delegation: a member who could have filed a class of messages by
// hand telling the platform to do it for future ones. The kind set is CLOSED — adding a fourth is a
// schema change on purpose, because the guardrails have to know what a rule MEANS in order to reason
// about competing evidence, which a pattern or an expression could not tell them. A matter's capture
// address is not mirrored here: the credential is already the rule, and a second home for that fact
// would drift on the first token rotation.
//
// A rule carries two independent answers — WHICH matter (kind + match_value) and WHETHER the
// resulting link may be `filed` rather than `staged` (promotion). Promotion is a request, never a
// guarantee: the firm-level ceiling and every guardrail can still demote it to staging.
export const emailAutoFileRule = sqliteTable(
  "email_auto_file_rule",
  {
    id: text("id").primaryKey().$type<EmailAutoFileRuleId>(), // emailAutoFileRule_ handle
    kind: text("kind", { enum: ["threadContinuation", "correspondentMatter"] }).notNull(),
    // A rule always names exactly one matter. A multi-matter rule would fire several filings from one
    // condition, multiplying a wrong rule's blast radius by the number of matters it named.
    matterId: text("matter_id")
      .notNull()
      .$type<MatterId>()
      .references(() => matter.id),
    // One column whose meaning is fixed by `kind`: the normalized From address for
    // correspondentMatter, the email_thread identifier for threadContinuation.
    matchValue: text("match_value").notNull(),
    promotion: text("promotion", { enum: ["stage", "file"] })
      .notNull()
      .default("stage"),
    state: text("state", { enum: ["active", "suspended", "revoked"] })
      .notNull()
      .default("active"),
    // Why a suspended rule is out of service. Suspension is never deletion: a suspended rule with its
    // history explains what had been filing, and a deleted one leaves the firm unable to say.
    suspendedReason: text("suspended_reason", {
      enum: ["creatorAccessWithdrawn", "matterClosed", "blastBound", "undoRate", "member"],
    }),
    // The delegating principal. Not decorative: this member's access to the matter is re-checked at
    // every fire, because access is withdrawn as well as granted and a durable rule must not outlive
    // the access that authorized it.
    createdBy: text("created_by").$type<UserId>(),
    // The manual filing that occasioned the offer, where there was one — the rule's authorizing act,
    // so an audit of "why did this file itself" terminates in a person's decision rather than in a
    // configuration screen.
    createdFromEmailMessageId: text("created_from_email_message_id")
      .$type<EmailMessageId>()
      .references(() => emailMessage.id),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    // The same rule cannot be created twice.
    uniqueIndex("email_auto_file_rule_kind_match_matter_unique_index").on(
      table.kind,
      table.matchValue,
      table.matterId,
    ),
    // The fire-time lookup, and the reason evaluation cost does not scale with the firm's rule count:
    // a capture resolves its candidates by match VALUE, never by scanning the rule table.
    index("email_auto_file_rule_kind_match_index").on(table.kind, table.matchValue),
    index("email_auto_file_rule_matter_id_index").on(table.matterId),
    // The suspension review — "which rules stopped, and why". PARTIAL, over the rules that are not
    // in service, which is both the only set the review wants and the small one. A full index on a
    // three-value column would additionally be a trap: the query planner would prefer it for the
    // fire-time lookup's `state = 'active'` term over the (kind, match_value) walk, turning the one
    // read on the capture path into a walk of every active rule in the firm.
    index("email_auto_file_rule_state_index")
      .on(table.state)
      .where(sql`${table.state} != 'active'`),
    check(
      "email_auto_file_rule_kind_check",
      sql`${table.kind} IN ('threadContinuation', 'correspondentMatter')`,
    ),
    check("email_auto_file_rule_promotion_check", sql`${table.promotion} IN ('stage', 'file')`),
    check(
      "email_auto_file_rule_state_check",
      sql`${table.state} IN ('active', 'suspended', 'revoked')`,
    ),
    check(
      "email_auto_file_rule_suspended_reason_check",
      sql`${table.suspendedReason} IS NULL OR ${table.suspendedReason} IN ('creatorAccessWithdrawn', 'matterClosed', 'blastBound', 'undoRate', 'member')`,
    ),
    // A suspended rule always says why, and a rule that is not suspended never carries a stale reason.
    check(
      "email_auto_file_rule_suspended_reason_state_check",
      sql`(${table.state} = 'suspended') = (${table.suspendedReason} IS NOT NULL)`,
    ),
  ],
);

// The evaluation ledger: what a rule did, or what stopped it. Written only where something happened —
// at least one rule matched, or a match was suppressed — so the table stays proportional to rule
// activity rather than to the firm's mail volume.
//
// NO MESSAGE CONTENT OF ANY KIND lands here: not a subject, not an address, not a display name. The
// reason enums and the identifiers are the whole record, the same rule the capture's idempotency body
// follows; the plain-language sentences a person reads are rendered from these at read time.
export const emailAutoFileDecision = sqliteTable(
  "email_auto_file_decision",
  {
    id: text("id").primaryKey().$type<EmailAutoFileDecisionId>(), // emailAutoFileDecision_ handle
    emailMessageId: text("email_message_id")
      .notNull()
      .$type<EmailMessageId>()
      .references(() => emailMessage.id),
    // Null where the outcome is attributable to the evidence rather than to any one rule — two rules
    // disagreeing, or a rule contradicted by the subject line.
    autoFileRuleId: text("auto_file_rule_id")
      .$type<EmailAutoFileRuleId>()
      .references(() => emailAutoFileRule.id),
    // The matter the decision was about; null where the guardrails refused before a single matter was
    // resolved.
    matterId: text("matter_id")
      .$type<MatterId>()
      .references(() => matter.id),
    outcome: text("outcome", { enum: ["filed", "staged", "suppressed"] }).notNull(),
    // Why nothing fired, from a closed set matching the guardrails. A decision that DID fire but
    // landed staged instead of filed records that demotion inside `evidence`, because the outcome
    // column already carries the fact that it staged.
    suppressionReason: text("suppression_reason", {
      enum: [
        "ambiguousEvidence",
        "creatorAccessWithdrawn",
        "senderNotAuthenticated",
        "signatureFailed",
        "humanFilingDecision",
        "matterNotOpen",
        "ruleNotActive",
        "incompleteEvidence",
      ],
    }),
    // The deciding evidence as a small identifier-and-enum JSON structure: which matters the deciding
    // signals named, which rule fired, and the demotion reason where one applies.
    evidence: text("evidence").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    // The per-rule fire/undo derivation, bounded to a rolling window — the input to the circuit
    // breaker and to the undo-rate feedback, and the reason no counter is maintained on the rule row.
    index("email_auto_file_decision_rule_created_index").on(table.autoFileRuleId, table.createdAt),
    // "Why did this message file itself" — one message's decision history.
    index("email_auto_file_decision_email_message_id_index").on(table.emailMessageId),
    check(
      "email_auto_file_decision_outcome_check",
      sql`${table.outcome} IN ('filed', 'staged', 'suppressed')`,
    ),
    check(
      "email_auto_file_decision_suppression_reason_check",
      sql`${table.suppressionReason} IS NULL OR ${table.suppressionReason} IN ('ambiguousEvidence', 'creatorAccessWithdrawn', 'senderNotAuthenticated', 'signatureFailed', 'humanFilingDecision', 'matterNotOpen', 'ruleNotActive', 'incompleteEvidence')`,
    ),
    // A suppressed decision always says why, and a decision that acted never carries a stale reason.
    check(
      "email_auto_file_decision_suppression_reason_outcome_check",
      sql`(${table.outcome} = 'suppressed') = (${table.suppressionReason} IS NOT NULL)`,
    ),
  ],
);

// ---------------------------------------------------------------------------------------------
// Document automation — the assembly-template catalogue and the provenance of what it produced.
// ---------------------------------------------------------------------------------------------

// The catalogue row for one assembly template. Firm-level and never a matter document: a template
// carries no matter data, which is why it lives here rather than as a `file` row (file.matter_id is NOT
// NULL, and relaxing that would touch the quarantine gate and every matter-scoped read in the File
// Manager for one consumer's convenience).
//
// Soft-archive only, never deleted — a template that produced a filed document must remain explicable.
// `matter_type_id` and `location_id` are optional NARROWINGS of an otherwise firm-wide template: when
// set they limit which matters offer it; they never gate who may read the catalogue.
export const documentTemplate = sqliteTable(
  "document_template",
  {
    id: text("id").primaryKey().$type<DocumentTemplateId>(), // documentTemplate_ handle
    name: text("name").notNull(),
    description: text("description"),
    matterTypeId: text("matter_type_id")
      .$type<MatterTypeId>()
      .references(() => matterType.id),
    locationId: text("location_id")
      .$type<LocationId>()
      .references(() => location.id),
    status: text("status", { enum: ["active", "archived"] })
      .notNull()
      .default("active"),
    // Forward reference — set when a version's bytes clear the ingest gate, exactly like
    // file.current_version_id.
    currentVersionId: text("current_version_id")
      .$type<DocumentTemplateVersionId>()
      .references((): AnySQLiteColumn => documentTemplateVersion.id),
    createdBy: text("created_by").$type<UserId>(), // not an FK — the authoring fact outlives the member row
    archivedAt: text("archived_at"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    // The catalogue list filters on status and sorts by name; one composite serves both.
    index("document_template_status_name_index").on(table.status, table.name),
    index("document_template_matter_type_id_index").on(table.matterTypeId),
    check("document_template_name_nonempty_check", sql`length(${table.name}) > 0`),
    check("document_template_status_check", sql`${table.status} IN ('active', 'archived')`),
  ],
);

// An immutable registered version of a template's bytes, mirroring file_version's shape and its gate:
// the status ladder (pending -> clean | quarantined | abandoned) is the quarantine mechanism, and only a
// `clean` version may be assembled from. Nothing outside the firm-scoped data-access layer may assume
// the stored object is raw bytes — storage_encoding is the discriminator that keeps that true.
//
// The field manifest is stored, not re-derived: it is what lets an assembly plan its reads before
// touching any XML, and it is what the field inspector shows an author. `normalizer_version` records the
// transform that produced these bytes, so two versions registered under different normalizers stay
// explicable rather than mysteriously different.
export const documentTemplateVersion = sqliteTable(
  "document_template_version",
  {
    id: text("id").primaryKey().$type<DocumentTemplateVersionId>(), // documentTemplateVersion_ handle
    templateId: text("template_id")
      .notNull()
      .$type<DocumentTemplateId>()
      .references((): AnySQLiteColumn => documentTemplate.id),
    versionNumber: integer("version_number").notNull(),
    r2Key: text("r2_key").notNull(),
    sizeBytes: integer("size_bytes"),
    contentSha256: text("content_sha256"),
    storageEncoding: text("storage_encoding").notNull().default("full"),
    storageClass: text("storage_class", { enum: ["standard", "infrequent_access"] })
      .notNull()
      .default("standard"),
    status: text("status", { enum: ["pending", "clean", "quarantined", "abandoned"] })
      .notNull()
      .default("pending"),
    scanVerdict: text("scan_verdict", { enum: ["unscanned", "clean", "flagged"] }),
    scanEngineVersion: text("scan_engine_version"),
    scanDetail: text("scan_detail"),
    // The serialized field manifest and the normalization warnings the registration pass produced.
    fieldManifestJson: text("field_manifest_json").notNull().default("{}"),
    normalizationWarningsJson: text("normalization_warnings_json").notNull().default("[]"),
    normalizerVersion: integer("normalizer_version").notNull().default(0),
    // How many macro payload parts were stripped out of the upload before it was stored. A non-zero
    // count is what the catalogue tells an administrator was removed from the template they registered.
    macroPartsRemoved: integer("macro_parts_removed").notNull().default(0),
    createdBy: text("created_by").$type<UserId>(),
    createdAt: text("created_at").notNull(),
    committedAt: text("committed_at"),
  },
  (table) => [
    uniqueIndex("document_template_version_r2_key_unique_index").on(table.r2Key),
    uniqueIndex("document_template_version_template_version_number_unique_index").on(
      table.templateId,
      table.versionNumber,
    ),
    index("document_template_version_template_id_created_at_id_index").on(
      table.templateId,
      table.createdAt,
      table.id,
    ),
    check(
      "document_template_version_status_check",
      sql`${table.status} IN ('pending', 'clean', 'quarantined', 'abandoned')`,
    ),
    check(
      "document_template_version_storage_class_check",
      sql`${table.storageClass} IN ('standard', 'infrequent_access')`,
    ),
    check(
      "document_template_version_scan_verdict_check",
      sql`${table.scanVerdict} IS NULL OR ${table.scanVerdict} IN ('unscanned', 'clean', 'flagged')`,
    ),
  ],
);

// Which registered template versions bind which merge keys — the index behind "where is this field
// used", the picker's usage ordering, and the guard that refuses to destroy a firm's own field a
// template names.
//
// The objection to a bindings table is that it is a second copy of a fact the manifest already states,
// with its own way of going stale. That objection is answered by immutability rather than waved at: A
// TEMPLATE VERSION NEVER CHANGES. These rows are derived from one and written in the same batch as it,
// and neither side ever moves again — so there is no update path, no reconciliation, and no staleness
// mode. What it buys is an index seek where the alternative is `instr()` over every stored manifest.
export const documentTemplateFieldBinding = sqliteTable(
  "document_template_field_binding",
  {
    templateVersionId: text("template_version_id")
      .notNull()
      .$type<DocumentTemplateVersionId>()
      .references((): AnySQLiteColumn => documentTemplateVersion.id),
    // The merge key the version's manifest names. Not a foreign key: the dictionary is code, not a
    // table, and a binding onto a key a later dictionary deprecates is exactly what this index exists
    // to report rather than a row the database should have refused.
    mergeKey: text("merge_key").notNull(),
  },
  (table) => [
    // One row per distinct key per version, and the pair is the whole identity — there is nothing else
    // to record about a binding, and no surrogate key would be looked up by.
    primaryKey({ columns: [table.templateVersionId, table.mergeKey] }),
    // The other direction: every version that binds one key. The primary key serves "what does this
    // version bind"; this serves "who binds this field", which is the question an administrator asks
    // before deprecating one and the guard asks before destroying one.
    index("document_template_field_binding_merge_key_index").on(
      table.mergeKey,
      table.templateVersionId,
    ),
    check(
      "document_template_field_binding_merge_key_nonempty_check",
      sql`length(${table.mergeKey}) > 0`,
    ),
  ],
);

// The firm's own field-mapping library: one row per CONFIRMED Word-merge-field-name to merge-key
// mapping. A firm migrating from Word mail merge or an older practice-management system has fields
// called `ClientName` and `FileNo`, and nothing in the engine may guess what those mean — a mapping
// asserted by resemblance is a silent binding decision on privileged content. So the mapping becomes
// the firm's own knowledge: confirming one during a conversion writes it here, and every later
// detection consults it, which is what turns a bulk migration into one pass of human confirmation
// rather than one per document.
//
// Firm-scoped and freely editable: a mapping is a statement the firm made and can withdraw, so rows are
// listed and deleted outright rather than archived. Deleting one changes nothing already registered —
// a template version's bytes and manifest are immutable, and the mapping only ever affected the moment
// of conversion.
export const documentTemplateFieldMapping = sqliteTable(
  "document_template_field_mapping",
  {
    id: text("id").primaryKey().$type<DocumentTemplateFieldMappingId>(), // documentTemplateFieldMapping_ handle
    // The Word field name exactly as the source document recorded it. Matched literally — Word field
    // names are case-sensitive and a firm that has both `ClientName` and `clientname` means two things.
    fieldName: text("field_name").notNull(),
    // The merge-field key it was confirmed to mean. Not a foreign key: the dictionary is code, not a
    // table, and a mapping onto a key a later dictionary drops is a stale mapping to report rather than
    // a row the database should have refused.
    mergeKey: text("merge_key").notNull(),
    // How many registrations have used this mapping — the signal that says which confirmations are
    // load-bearing when a firm reviews the library.
    timesApplied: integer("times_applied").notNull().default(0),
    confirmedBy: text("confirmed_by").$type<UserId>(),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    // One confirmed meaning per Word field name: a second confirmation of the same name updates the
    // mapping rather than leaving two answers to the same question in the library.
    uniqueIndex("document_template_field_mapping_field_name_unique_index").on(table.fieldName),
    check(
      "document_template_field_mapping_field_name_nonempty_check",
      sql`length(${table.fieldName}) > 0`,
    ),
    check(
      "document_template_field_mapping_merge_key_nonempty_check",
      sql`length(${table.mergeKey}) > 0`,
    ),
  ],
);

// One row per assembly job — the reason the subsystem is auditable. It records the exact template
// version used, so a document assembled in March and one assembled in September from a template revised
// in June are explainably different rather than mysteriously so.
//
// It stores NO RESOLVED VALUES. The merge context exists in memory for the life of the job and is never
// persisted, never logged, and never placed on a queue message; the only field-level record here is the
// list of keys that were ABSENT, which by construction held nothing.
export const documentAssembly = sqliteTable(
  "document_assembly",
  {
    id: text("id").primaryKey().$type<DocumentAssemblyId>(), // documentAssembly_ handle
    matterId: text("matter_id")
      .notNull()
      .$type<MatterId>()
      .references(() => matter.id),
    templateId: text("template_id")
      .notNull()
      .$type<DocumentTemplateId>()
      .references((): AnySQLiteColumn => documentTemplate.id),
    templateVersionId: text("template_version_id")
      .notNull()
      .$type<DocumentTemplateVersionId>()
      .references((): AnySQLiteColumn => documentTemplateVersion.id),
    folderId: text("folder_id")
      .$type<FolderId>()
      .references(() => folder.id),
    status: text("status", { enum: ["queued", "running", "done", "failed"] })
      .notNull()
      .default("queued"),
    outcome: text("outcome", { enum: ["succeeded", "succeeded_with_absences", "failed"] }),
    // An error CODE from a closed set, never a failing value: a merge failure reports which key failed,
    // never what it held.
    failureReason: text("failure_reason"),
    fileId: text("file_id")
      .$type<FileId>()
      .references(() => file.id),
    fileVersionId: text("file_version_id")
      .$type<FileVersionId>()
      .references(() => fileVersion.id),
    engineVersion: integer("engine_version").notNull().default(0),
    dictionaryVersion: integer("dictionary_version").notNull().default(0),
    absentFieldCount: integer("absent_field_count").notNull().default(0),
    absentFieldKeysJson: text("absent_field_keys_json").notNull().default("[]"),
    // The Word merge fields the template still carried UNCONVERTED, which the produced document
    // therefore renders as Word's frozen cached text rather than as a merged value. Recorded beside the
    // absent keys and on the same terms: FIELD NAMES ONLY, never the frozen text itself, which is
    // template content rather than provenance. An assembly whose template has any of these completes
    // `succeeded_with_absences` — a field that prints stale words is the same class of "this document
    // needs a human before it is filed" as a blank, which is exactly why they are recorded here.
    frozenFieldCount: integer("frozen_field_count").notNull().default(0),
    frozenFieldNamesJson: text("frozen_field_names_json").notNull().default("[]"),
    requestedBy: text("requested_by").$type<UserId>(),
    createdAt: text("created_at").notNull(),
    completedAt: text("completed_at"),
  },
  (table) => [
    // A matter's assembly history keyset-paginates on (created_at DESC, id DESC) under a matter filter.
    index("document_assembly_matter_id_created_at_id_index").on(
      table.matterId,
      table.createdAt,
      table.id,
    ),
    index("document_assembly_template_version_id_index").on(table.templateVersionId),
    check(
      "document_assembly_status_check",
      sql`${table.status} IN ('queued', 'running', 'done', 'failed')`,
    ),
    check(
      "document_assembly_outcome_check",
      sql`${table.outcome} IS NULL OR ${table.outcome} IN ('succeeded', 'succeeded_with_absences', 'failed')`,
    ),
  ],
);

// ---- Custodian: the register of physical client originals the firm holds in safekeeping ----
//
// Two structural invariants govern this group and are enforced wherever SQLite can express them: a
// movement is appended and never updated or deleted (the RAISE(ABORT) triggers live in the
// hand-written migration, the only place triggers can be expressed at all), and a packet cannot
// exist without at least one owner link (an "at least one" constraint over a child table, which
// SQLite cannot state as a column check, so the write path in @magna-carta/custodian enforces it).
// Retention periods are deliberately absent: no column here carries a default retention and no code
// path derives one — destroying a client's irreplaceable original is never a platform default.

// One node of the physical container tree. A ROOT node (parent_location_id IS NULL) either binds a
// firm office through firm_location_id — which is what makes "which office holds this original"
// answerable for a multi-office practice — or binds none and stands for an external custody site (a
// bank vault, an offsite records vendor), carrying its own name and address. A bank is not one of the
// firm's offices, so it must not become a `location` row: that table drives letterhead, remit-to, the
// matter-number segment, and staff assignment for every other subsystem that reads it. `kind` drives
// iconography and grouping only — nothing in the engine branches on it.
export const custodyLocation = sqliteTable(
  "custody_location",
  {
    id: text("id").primaryKey().$type<CustodyLocationId>(), // custodyLocation_ handle
    name: text("name").notNull(),
    kind: text("kind", {
      enum: ["office", "room", "safe", "cabinet", "shelf", "box", "position", "offsite", "bank"],
    }).notNull(),
    parentLocationId: text("parent_location_id").$type<CustodyLocationId>(), // null on a root node
    firmLocationId: text("firm_location_id")
      .$type<LocationId>()
      .references(() => location.id), // set only on an office root
    address: text("address"), // free text, for an external site that is not a firm office
    status: text("status", { enum: ["active", "closed"] })
      .notNull()
      .default("active"),
    notes: text("notes"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    index("custody_location_parent_index").on(table.parentLocationId),
    index("custody_location_firm_location_index").on(table.firmLocationId),
    check("custody_location_name_check", sql`length(${table.name}) > 0`),
    check(
      "custody_location_kind_check",
      sql`${table.kind} IN ('office', 'room', 'safe', 'cabinet', 'shelf', 'box', 'position', 'offsite', 'bank')`,
    ),
    check("custody_location_status_check", sql`${table.status} IN ('active', 'closed')`),
    // Only a root may name a firm office: a shelf inside a safe inherits its office from the root,
    // and letting a mid-tree node claim a different one would make a packet's office ambiguous.
    check(
      "custody_location_firm_binding_check",
      sql`${table.firmLocationId} IS NULL OR ${table.parentLocationId} IS NULL`,
    ),
  ],
);

// The per-firm item-type catalog — original will, codicil, deed, share certificate, keys, and
// whatever else a firm holds. A catalog table rather than a platform enum for the same reason
// matter_type and document_type are: a firm that holds something nobody thought of must not be
// blocked, and a growing list of similar things is a declaration, not code. Soft-deactivate only.
// intrinsic_value_default seeds an item's own flag; a human always overrides it on the object.
export const custodyItemType = sqliteTable(
  "custody_item_type",
  {
    id: text("id").primaryKey().$type<CustodyItemTypeId>(), // custodyItemType_ handle
    name: text("name").notNull(),
    code: text("code"),
    intrinsicValueDefault: integer("intrinsic_value_default", { mode: "boolean" })
      .notNull()
      .default(false),
    active: integer("active", { mode: "boolean" }).notNull().default(true),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("custody_item_type_name_unique_index").on(table.name),
    uniqueIndex("custody_item_type_code_unique_index").on(table.code),
    check("custody_item_type_name_check", sql`length(${table.name}) > 0`),
  ],
);

// A packet is the unit of custody: the envelope, deed box, or sealed wallet the firm physically holds
// and physically moves. It carries the firm-scoped custody number a person writes on a label and
// reads over the phone, the current location, the derived status, and the optional matter link.
//
// current_location_id is nullable and that is deliberate: a packet checked out to a borrower, or
// released to its owner, is not in the tree, and recording a location it is not at would falsify the
// occupancy count the register reports. A packet being logged always names one.
//
// matter_id is nullable and that is the whole point of the subsystem — a will held for a client whose
// last matter closed eleven years ago is the steady state, and rooting custody at the matter would
// make that case either impossible or a fake matter. Closing a matter never touches a packet.
export const custodyPacket = sqliteTable(
  "custody_packet",
  {
    id: text("id").primaryKey().$type<CustodyPacketId>(), // custodyPacket_ handle
    custodyNumber: text("custody_number").notNull(),
    // 'drawn' consumed a counter value and holds an allocation row; 'manual' is a number a firm
    // carried in from a paper deeds register or a prior system and touches no counter.
    numberSource: text("number_source", { enum: ["drawn", "manual"] }).notNull(),
    name: text("name").notNull(),
    currentLocationId: text("current_location_id")
      .$type<CustodyLocationId>()
      .references(() => custodyLocation.id),
    status: text("status", { enum: ["held", "out", "released", "destroyed", "lost"] })
      .notNull()
      .default("held"),
    matterId: text("matter_id")
      .$type<MatterId>()
      .references(() => matter.id),
    // The person who physically handed the packet over — routinely neither an owner nor a client (a
    // son deposits his mother's will), and a fact about the deposit EVENT that must not be overwritten
    // when ownership changes. Null is honest for a packet inherited in a firm merger. No cross-domain
    // foreign key on the Directory handle (the matter_party precedent).
    depositorEntityId: text("depositor_entity_id"),
    depositedAt: text("deposited_at"),
    // "Look at this again", not a deadline and not a retention clock. A firm sets the date; nothing
    // derives one, nothing expires when it passes, and a passed date only puts the packet on the
    // reviews-due report. The interval rolls the date forward on its anniversary when a review is
    // recorded, so a nine-year-old envelope keeps coming back round instead of being forgotten.
    reviewOn: text("review_on"),
    reviewIntervalMonths: integer("review_interval_months"),
    notes: text("notes"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("custody_packet_custody_number_unique_index").on(table.custodyNumber),
    // The register list filters on status and orders by number; one composite serves both.
    index("custody_packet_status_number_index").on(table.status, table.custodyNumber),
    index("custody_packet_current_location_index").on(table.currentLocationId),
    index("custody_packet_matter_index").on(table.matterId),
    index("custody_packet_depositor_index").on(table.depositorEntityId),
    check("custody_packet_name_check", sql`length(${table.name}) > 0`),
    check("custody_packet_number_check", sql`length(${table.custodyNumber}) > 0`),
    check("custody_packet_number_source_check", sql`${table.numberSource} IN ('drawn', 'manual')`),
    check(
      "custody_packet_status_check",
      sql`${table.status} IN ('held', 'out', 'released', 'destroyed', 'lost')`,
    ),
    check(
      "custody_packet_review_interval_check",
      sql`${table.reviewIntervalMonths} IS NULL OR (${table.reviewIntervalMonths} > 0 AND ${table.reviewIntervalMonths} <= 600)`,
    ),
  ],
);

// An item is the unit of description: one thing inside a packet. It never moves between packets by an
// edit — re-packeting is a movement in the ledger, because "when did the will move out of the family
// envelope" has to have an answer. `ordinal` is packet-relative (CUS-00042-3): an item's identity is
// only meaningful inside its packet, so a second global counter would buy nothing.
//
// `superseded` exists only here: a will replaced by a later will is not destroyed, released, or lost,
// and firms hold both. intrinsic_value is defaulted from the type and always overridable, because it
// is the flag the destruction path reads and so must be a fact a person asserted about THIS object. A
// declared value is money, so it is minor units plus a currency, never a float.
export const custodyItem = sqliteTable(
  "custody_item",
  {
    id: text("id").primaryKey().$type<CustodyItemId>(), // custodyItem_ handle
    packetId: text("packet_id")
      .notNull()
      .$type<CustodyPacketId>()
      .references(() => custodyPacket.id),
    ordinal: integer("ordinal").notNull(),
    itemTypeId: text("item_type_id")
      .$type<CustodyItemTypeId>()
      .references(() => custodyItemType.id),
    description: text("description").notNull(),
    // The instrument's own date (a will dated 14 March 2019) — what a firm actually searches by.
    instrumentDate: text("instrument_date"),
    intrinsicValue: integer("intrinsic_value", { mode: "boolean" }).notNull().default(false),
    declaredValueAmountMinor: integer("declared_value_amount_minor"),
    declaredValueCurrency: text("declared_value_currency"),
    status: text("status", {
      enum: ["held", "out", "released", "destroyed", "lost", "superseded"],
    })
      .notNull()
      .default("held"),
    // An item carries its own review schedule because the thing that needs looking at again is
    // often one object inside the envelope — a passport that expires, a share certificate whose
    // registrar changed — not the envelope itself.
    reviewOn: text("review_on"),
    reviewIntervalMonths: integer("review_interval_months"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("custody_item_packet_ordinal_unique_index").on(table.packetId, table.ordinal),
    index("custody_item_item_type_index").on(table.itemTypeId),
    check("custody_item_description_check", sql`length(${table.description}) > 0`),
    check("custody_item_ordinal_check", sql`${table.ordinal} > 0`),
    check(
      "custody_item_status_check",
      sql`${table.status} IN ('held', 'out', 'released', 'destroyed', 'lost', 'superseded')`,
    ),
    // An amount with no currency cannot be interpreted, and a currency with no amount says nothing.
    check(
      "custody_item_declared_value_check",
      sql`(${table.declaredValueAmountMinor} IS NULL) = (${table.declaredValueCurrency} IS NULL)`,
    ),
    check(
      "custody_item_review_interval_check",
      sql`${table.reviewIntervalMonths} IS NULL OR (${table.reviewIntervalMonths} > 0 AND ${table.reviewIntervalMonths} <= 600)`,
    ),
  ],
);

// The owner link — the subsystem's orphan-prevention invariant made structural. The catastrophic
// outcome in safe custody is not a misplaced packet but an unattributable one: a sealed envelope with
// a name on it that matches nobody, which can therefore never be released and never destroyed.
// Ownership is temporal: an ownership change writes a new row and end-dates the old, never an
// overwrite. `ownership_role` is a short firm-supplied label (owner, joint owner, life tenant,
// trustee, executor) rather than a closed platform enum of tenancy forms — tenancy forms are
// jurisdiction-specific and there is no release-authority engine to consume them, so a closed
// vocabulary here would be false precision a later engine has to migrate away from.
export const custodyOwner = sqliteTable(
  "custody_owner",
  {
    id: text("id").primaryKey().$type<CustodyOwnerId>(), // custodyOwner_ handle
    packetId: text("packet_id")
      .notNull()
      .$type<CustodyPacketId>()
      .references(() => custodyPacket.id),
    // A directoryPerson_/directoryOrganization_ handle. No cross-domain foreign key (the matter_party
    // precedent) — the Directory is the only anchor that survives a matter closing.
    entityId: text("entity_id").notNull(),
    ownershipRole: text("ownership_role"),
    effectiveFrom: text("effective_from").notNull(),
    effectiveTo: text("effective_to"), // null while the link is current
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    index("custody_owner_packet_index").on(table.packetId),
    // The register's primary filter: everything this firm holds for one Directory entity.
    index("custody_owner_entity_index").on(table.entityId, table.effectiveTo),
  ],
);

// The append-only custody ledger. The register's whole value in a dispute is that it is a
// contemporaneous record nobody could have made say otherwise afterwards, so a correction is a new
// compensating row carrying corrects_movement_id, never an edit. The RAISE(ABORT) triggers that make
// that a guarantee rather than a convention are in the hand-written migration.
//
// occurred_at and recorded_at are separate columns because custody events happen in the physical
// world and are typed in afterwards — sometimes on a Monday for a Friday. Collapsing them would make
// back-dating either impossible or indistinguishable from falsification; kept apart, the register
// reports on occurred_at while recorded_at proves when the assertion was made.
//
// shipment_id binds a movement to a real carrier shipment rather than growing tracking columns here.
// The movement is written when the packet leaves, independently of whether the shipment is later
// delivered: a carrier failure must be visible as a custody event, and a package marked delivered is
// not proof the recipient was the right person.
export const custodyMovement = sqliteTable(
  "custody_movement",
  {
    id: text("id").primaryKey().$type<CustodyMovementId>(), // custodyMovement_ handle
    packetId: text("packet_id")
      .notNull()
      .$type<CustodyPacketId>()
      .references(() => custodyPacket.id),
    itemId: text("item_id")
      .$type<CustodyItemId>()
      .references(() => custodyItem.id), // set when the movement concerns one item, not the packet
    kind: text("kind", {
      enum: [
        "logged",
        "itemized",
        "moved",
        "checked_out",
        "returned",
        "withdrawn",
        "released",
        "superseded",
        "destroyed",
        "lost",
        "found",
        "reviewed",
        "hold_placed",
        "hold_released",
        "correction",
      ],
    }).notNull(),
    occurredAt: text("occurred_at").notNull(),
    recordedAt: text("recorded_at").notNull(),
    recordedByUserId: text("recorded_by_user_id").$type<UserId>(),
    fromLocationId: text("from_location_id")
      .$type<CustodyLocationId>()
      .references(() => custodyLocation.id),
    toLocationId: text("to_location_id")
      .$type<CustodyLocationId>()
      .references(() => custodyLocation.id),
    // Who has it. All three shapes really occur: a partner takes the deed to a completion meeting
    // (member), the client's accountant collects a share certificate (entity), a courier's named
    // driver signs for it (external). Forcing an external borrower into the Directory would pollute
    // the conflicts corpus with people who are party to nothing; forcing a real Directory entity into
    // free text loses the link.
    borrowerKind: text("borrower_kind", { enum: ["member", "entity", "external"] }),
    borrowerUserId: text("borrower_user_id").$type<UserId>(),
    borrowerEntityId: text("borrower_entity_id"),
    borrowerName: text("borrower_name"),
    dueBackOn: text("due_back_on"),
    reason: text("reason"),
    correctsMovementId: text("corrects_movement_id").$type<CustodyMovementId>(),
    shipmentId: text("shipment_id")
      .$type<ShipmentId>()
      .references(() => shipment.id),
    note: text("note"),
    // The release gate. An original leaving the firm's custody for good is the one movement where
    // recording after the fact is worth nothing: these four columns are what was established BEFORE
    // it left, frozen on the same append-only row as the event itself so no later edit can supply
    // them. A trigger in the migration refuses a `released` row that carries no capture.
    //
    // The basis is FREE TEXT the firm writes and no platform vocabulary, deliberately: what document
    // suffices to release an original — a grant of probate, letters of administration, a power of
    // attorney and the fact that one dies with its grantor — varies by jurisdiction, and a closed
    // enum here would be this schema inventing law. The same reasoning the ownership role and the
    // destruction basis are free text for.
    releaseAuthorityBasis: text("release_authority_basis"),
    // What was checked to establish the collector is who they say they are — an assertion about the
    // check, not a copy of the document. The ledger cannot be edited or deleted, so a passport number
    // typed here would be permanent.
    releaseIdentityEvidence: text("release_identity_evidence"),
    releaseIdentityVerifiedByUserId: text("release_identity_verified_by_user_id").$type<UserId>(),
    // The second signatory, when the firm requires two. Whether two are required is a per-firm
    // policy; that the two differ is structural, and a trigger enforces it.
    releaseWitnessedByUserId: text("release_witnessed_by_user_id").$type<UserId>(),
  },
  (table) => [
    // The packet history read, keyset-paginated newest first; also the order the register renders.
    index("custody_movement_packet_occurred_index").on(table.packetId, table.occurredAt, table.id),
    index("custody_movement_item_index").on(table.itemId),
    index("custody_movement_borrower_entity_index").on(table.borrowerEntityId),
    check(
      "custody_movement_kind_check",
      sql`${table.kind} IN ('logged', 'itemized', 'moved', 'checked_out', 'returned', 'withdrawn', 'released', 'superseded', 'destroyed', 'lost', 'found', 'reviewed', 'hold_placed', 'hold_released', 'correction')`,
    ),
    check(
      "custody_movement_borrower_kind_check",
      sql`${table.borrowerKind} IS NULL OR ${table.borrowerKind} IN ('member', 'entity', 'external')`,
    ),
    // A borrower kind names which column carries the borrower; a kind with no matching value is a
    // check-out that cannot answer the question the register exists to answer.
    check(
      "custody_movement_borrower_shape_check",
      sql`(${table.borrowerKind} IS NULL) OR (${table.borrowerKind} = 'member' AND ${table.borrowerUserId} IS NOT NULL) OR (${table.borrowerKind} = 'entity' AND ${table.borrowerEntityId} IS NOT NULL) OR (${table.borrowerKind} = 'external' AND ${table.borrowerName} IS NOT NULL)`,
    ),
    check(
      "custody_movement_correction_check",
      sql`${table.correctsMovementId} IS NULL OR ${table.kind} = 'correction'`,
    ),
  ],
);

// A hold blocks release and destruction. It does NOT block a location move: a held original still has
// to be movable to a fireproof safe or an offsite site — what a hold forbids is the property leaving
// the firm's custody or ceasing to exist. `unclaimed` is a hold kind rather than a status because "we
// cannot locate the owner" is exactly a do-not-destroy condition, and modelling it as a hold means it
// inherits the blocker for free. Placing and releasing each also append a movement, so the ledger
// stays the complete story.
export const custodyHold = sqliteTable(
  "custody_hold",
  {
    id: text("id").primaryKey().$type<CustodyHoldId>(), // custodyHold_ handle
    packetId: text("packet_id")
      .notNull()
      .$type<CustodyPacketId>()
      .references(() => custodyPacket.id),
    itemId: text("item_id")
      .$type<CustodyItemId>()
      .references(() => custodyItem.id),
    kind: text("kind", {
      enum: ["legal", "discovery", "client_instruction", "dispute", "unclaimed"],
    }).notNull(),
    placedAt: text("placed_at").notNull(),
    placedBy: text("placed_by").$type<UserId>(),
    reason: text("reason"),
    releasedAt: text("released_at"),
    releasedBy: text("released_by").$type<UserId>(),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    // The blocker read asks "is anything in force on this packet", so released_at rides the index.
    index("custody_hold_packet_released_index").on(table.packetId, table.releasedAt),
    index("custody_hold_item_index").on(table.itemId),
    check(
      "custody_hold_kind_check",
      sql`${table.kind} IN ('legal', 'discovery', 'client_instruction', 'dispute', 'unclaimed')`,
    ),
  ],
);

// A scanned copy, bound as a LINK over an ordinary File Manager file rather than as a parallel store.
// The bytes ride the existing presigned upload and quarantine chokepoint with no bypass, so a custody
// scan is previewable, convertible, searchable, and holdable exactly like any other document — there
// is no upload route in Custodian at all. A scan is never a substitute for the original and satisfies
// no gate: "we have a scan" is precisely the reasoning that destroys an original will.
export const custodyScan = sqliteTable(
  "custody_scan",
  {
    id: text("id").primaryKey().$type<CustodyScanId>(), // custodyScan_ handle
    packetId: text("packet_id")
      .notNull()
      .$type<CustodyPacketId>()
      .references(() => custodyPacket.id),
    itemId: text("item_id")
      .$type<CustodyItemId>()
      .references(() => custodyItem.id),
    fileId: text("file_id")
      .notNull()
      .$type<FileId>()
      .references(() => file.id),
    kind: text("kind", {
      enum: ["scan", "photograph", "receipt", "appraisal", "correspondence"],
    }).notNull(),
    capturedAt: text("captured_at").notNull(),
    capturedBy: text("captured_by").$type<UserId>(),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    // One file belongs to one custody link, so the hold arm resolves a file to exactly one packet.
    uniqueIndex("custody_scan_file_unique_index").on(table.fileId),
    index("custody_scan_packet_index").on(table.packetId),
    index("custody_scan_item_index").on(table.itemId),
    check(
      "custody_scan_kind_check",
      sql`${table.kind} IN ('scan', 'photograph', 'receipt', 'appraisal', 'correspondence')`,
    ),
  ],
);

// The destruction request record, and the workflow over it: request, approve or refuse, execute. Two
// refusals are structural rather than configurable, and neither is expressible as a column check
// alone, so both are also enforced by BEFORE triggers in the migration that added these columns —
// destruction is a two-person action (the approver differs from the requester, and a row naming no
// requester at all satisfies the CHECK below but not the trigger), and no request may be raised or
// executed against an item flagged intrinsic_value. Deliberately absent: any retention period,
// default, or derived date — no jurisdiction's rules produce "destroy the client's original will
// because a timer expired".
export const custodyDestructionRequest = sqliteTable(
  "custody_destruction_request",
  {
    id: text("id").primaryKey().$type<CustodyDestructionRequestId>(), // custodyDestructionRequest_ handle
    packetId: text("packet_id")
      .notNull()
      .$type<CustodyPacketId>()
      .references(() => custodyPacket.id),
    itemId: text("item_id")
      .$type<CustodyItemId>()
      .references(() => custodyItem.id),
    requestedBy: text("requested_by").$type<UserId>(),
    requestedAt: text("requested_at").notNull(),
    basis: text("basis").notNull(), // the reason and authority the requester asserts, in their words
    approvedBy: text("approved_by").$type<UserId>(),
    approvedAt: text("approved_at"),
    refusedBy: text("refused_by").$type<UserId>(),
    refusedAt: text("refused_at"),
    // Why the request was refused, in the refuser's words. Free text for the same reason the basis
    // is: the reasons are jurisdictional, professional, and factual by turns, and a closed list would
    // be this schema deciding which of them a firm is allowed to have.
    refusalReason: text("refusal_reason"),
    executedAt: text("executed_at"),
    executedBy: text("executed_by").$type<UserId>(),
    // The ledger row the execution appended. No foreign key, exactly as
    // custody_movement.corrects_movement_id has none: the movement ledger carries no referential
    // dependency, and keeping it that way is what lets the table be rebuilt when its kinds widen.
    executedMovementId: text("executed_movement_id").$type<CustodyMovementId>(),
    outcome: text("outcome", { enum: ["approved", "refused", "executed", "withdrawn"] }),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    index("custody_destruction_request_packet_index").on(table.packetId),
    // The pending queue: everything awaiting a second person, oldest first.
    index("custody_destruction_request_outcome_index").on(table.outcome, table.requestedAt),
    check("custody_destruction_request_basis_check", sql`length(${table.basis}) > 0`),
    check(
      "custody_destruction_request_approver_check",
      sql`${table.approvedBy} IS NULL OR ${table.requestedBy} IS NULL OR ${table.approvedBy} <> ${table.requestedBy}`,
    ),
    check(
      "custody_destruction_request_outcome_check",
      sql`${table.outcome} IS NULL OR ${table.outcome} IN ('approved', 'refused', 'executed', 'withdrawn')`,
    ),
  ],
);

// The custody-number counter, one row per {firm, scope_key} — the same ensure-row + guarded-increment
// shape matter_number_counter carries, for the same reason: concurrent draws must yield distinct,
// sequential numbers with no interactive transaction available.
export const custodyNumberCounter = sqliteTable("custody_number_counter", {
  scopeKey: text("scope_key").primaryKey(),
  nextValue: integer("next_value").notNull(),
});

// One row per counter value a draw consumed. This composite primary key — not the unique index on the
// rendered custody_number string — is the load-bearing backstop on the draw race: a scheme carrying a
// location code renders different strings from the same counter value in different scopes, so only a
// claim on the VALUE catches two draws that observed the same counter.
export const custodyNumberAllocation = sqliteTable(
  "custody_number_allocation",
  {
    scopeKey: text("scope_key").notNull(),
    drawnValue: integer("drawn_value").notNull(),
    packetId: text("packet_id")
      .notNull()
      .$type<CustodyPacketId>()
      .references(() => custodyPacket.id),
    allocatedAt: text("allocated_at").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.scopeKey, table.drawnValue] }),
    index("custody_number_allocation_packet_index").on(table.packetId),
  ],
);

// One physical count of the register, or of one branch of the container tree. A stocktake OBSERVES
// and REPORTS; it is the only part of Custodian that touches no packet, no item, and no movement.
// Nothing on this path disposes of property, relocates it, or corrects the register: a count that
// silently moved a packet to where somebody said they saw it would destroy the one thing the count is
// worth having for, which is the difference between what the register claims and what is on the
// shelf. The reconciliation names corrective movements as PROPOSALS, and a person records each one
// through the ordinary movement write path or does not.
//
// scope_location_id null means the whole register. A scoped count covers the named node and
// everything beneath it, which is what "we counted the Reno safe" means to the person who did it.
//
// The four discrepancy counts are frozen here on close. The lines behind them are recomputed on
// every read against a register that keeps moving, so they answer "what is different now"; the
// counts answer "what did the count find", which is the number a firm reports and cannot have drift
// under it afterwards.
export const custodyStocktake = sqliteTable(
  "custody_stocktake",
  {
    id: text("id").primaryKey().$type<CustodyStocktakeId>(), // custodyStocktake_ handle
    name: text("name").notNull(), // the firm's own label for this count
    scopeLocationId: text("scope_location_id")
      .$type<CustodyLocationId>()
      .references(() => custodyLocation.id),
    // `abandoned` is a real outcome, not a tidy-up: a count begun and not finished must not close as
    // if it had counted everything, because the reconciliation of a half-done count reads as a safe
    // full of missing originals. An abandoned stocktake freezes no counts.
    status: text("status", { enum: ["open", "closed", "abandoned"] }).notNull(),
    openedAt: text("opened_at").notNull(),
    openedByUserId: text("opened_by_user_id").$type<UserId>(),
    closedAt: text("closed_at"),
    closedByUserId: text("closed_by_user_id").$type<UserId>(),
    // Frozen on close, null while open and on an abandoned count.
    matchedCount: integer("matched_count"),
    missingCount: integer("missing_count"),
    misplacedCount: integer("misplaced_count"),
    unexpectedCount: integer("unexpected_count"),
    unregisteredCount: integer("unregistered_count"),
    note: text("note"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    index("custody_stocktake_status_opened_index").on(table.status, table.openedAt),
    index("custody_stocktake_scope_index").on(table.scopeLocationId),
    check("custody_stocktake_name_check", sql`length(${table.name}) > 0`),
    check(
      "custody_stocktake_status_check",
      sql`${table.status} IN ('open', 'closed', 'abandoned')`,
    ),
    // A closed count names when it closed; an open one cannot. Stated in the schema because the
    // reconciliation read branches on it, and a row that claimed both would make the report lie.
    check(
      "custody_stocktake_closure_check",
      sql`(${table.status} = 'open' AND ${table.closedAt} IS NULL) OR (${table.status} <> 'open' AND ${table.closedAt} IS NOT NULL)`,
    ),
  ],
);

// One observation a person made during a count: what they saw, where they saw it, and — frozen on
// the same row — where the register expected it at that moment. This is EVIDENTIARY, which is why it
// carries the movement ledger's append-only discipline rather than the ordinary child-table one: it
// is a named person's assertion about a physical object at a point in time, and an assertion that
// can be edited afterwards is worth nothing in the dispute a custody register exists for. A mistake
// is corrected by recording the later, truer observation; both stay on the record, which is what
// actually happened.
//
// expected_location_id is copied from the packet at the moment of the sighting rather than joined at
// read time, so "sighted on the wrong shelf" stays a fact about the count even after somebody moves
// the packet to the right one.
//
// Three shapes, and the CHECK holds them apart: a `sighted` row names a packet and where it was seen;
// a `not_found` row names a packet somebody looked for and did not find (which is a different and
// much stronger statement than a packet nobody got to); an `unregistered` row names no packet at all,
// because it is the unlabelled envelope on the shelf that the register has no row for.
export const custodyStocktakeSighting = sqliteTable(
  "custody_stocktake_sighting",
  {
    id: text("id").primaryKey().$type<CustodyStocktakeSightingId>(), // custodyStocktakeSighting_ handle
    stocktakeId: text("stocktake_id")
      .notNull()
      .$type<CustodyStocktakeId>()
      .references(() => custodyStocktake.id),
    kind: text("kind", { enum: ["sighted", "not_found", "unregistered"] }).notNull(),
    packetId: text("packet_id")
      .$type<CustodyPacketId>()
      .references(() => custodyPacket.id),
    itemId: text("item_id")
      .$type<CustodyItemId>()
      .references(() => custodyItem.id),
    // Where the observation was made. Null only on a `not_found` recorded without naming the place
    // that was searched.
    locationId: text("location_id")
      .$type<CustodyLocationId>()
      .references(() => custodyLocation.id),
    // Where the register expected the packet when this observation was recorded. Null when the
    // register expected it nowhere — it was checked out, released, or never in the register at all.
    expectedLocationId: text("expected_location_id")
      .$type<CustodyLocationId>()
      .references(() => custodyLocation.id),
    // What the observer physically found, in their words. Required on an `unregistered` row, since
    // it is the only description of the object that exists anywhere.
    description: text("description"),
    // The physical act and the typing are different events, exactly as they are on a movement.
    observedAt: text("observed_at").notNull(),
    recordedAt: text("recorded_at").notNull(),
    observedByUserId: text("observed_by_user_id").$type<UserId>(),
    note: text("note"),
  },
  (table) => [
    index("custody_stocktake_sighting_stocktake_index").on(table.stocktakeId, table.observedAt),
    index("custody_stocktake_sighting_packet_index").on(table.packetId),
    index("custody_stocktake_sighting_location_index").on(table.locationId),
    check(
      "custody_stocktake_sighting_kind_check",
      sql`${table.kind} IN ('sighted', 'not_found', 'unregistered')`,
    ),
    check(
      "custody_stocktake_sighting_shape_check",
      sql`(${table.kind} = 'sighted' AND ${table.packetId} IS NOT NULL AND ${table.locationId} IS NOT NULL) OR (${table.kind} = 'not_found' AND ${table.packetId} IS NOT NULL) OR (${table.kind} = 'unregistered' AND ${table.packetId} IS NULL AND ${table.itemId} IS NULL AND ${table.locationId} IS NOT NULL AND ${table.description} IS NOT NULL AND length(${table.description}) > 0)`,
    ),
  ],
);

// Trust accounting. Structure only — the account-tree composers, the entry-composition guard, and
// the hold/available-balance semantics live in @magna-carta/trust.
//
// Client money is a LIABILITY the firm owes back and the bank account holding it is an ASSET, so
// both sides are ordinary `ledger_account` rows and a trust movement is an ordinary balanced entry.
// These four tables carry only what the ledger structurally cannot: which ledger account belongs to
// whom, and the restrictions layered above a balance. No money lives here — every amount that is a
// balance is `account_balance`, and every amount that moved is a `ledger_line`.

// One real bank account holding client money. The office binding is load-bearing rather than
// descriptive: the rules require a trust account to sit in the state of the lawyer's office, so the
// governing jurisdiction is DERIVED from the location and never chosen by a user, and a multi-office
// firm runs several accounts under several profiles at once.
export const trustAccount = sqliteTable(
  "trust_account",
  {
    id: text("id").primaryKey().$type<TrustAccountId>(), // trustAccount_ handle
    name: text("name").notNull(), // the firm's own label ("IOLTA — Reno")
    locationId: text("location_id")
      .notNull()
      .$type<LocationId>()
      .references(() => location.id),
    // Copied from the office at open time so a later location edit cannot silently re-govern an
    // account that already holds client money. NULL means no jurisdiction has been recorded, and a
    // NULL REFUSES to resolve rather than falling back to any baseline — a jurisdiction fact that
    // was never researched is a different thing from a rule that is silent, and only the second one
    // has an answer.
    jurisdiction: text("jurisdiction"),
    bankName: text("bank_name"),
    // The list-view display fragment only. The full account and routing numbers are deliberately
    // NOT columns here yet: they are the sensitive identifiers of this subsystem and land through
    // the protected() chokepoint (packages/data-access) once their read-cost split is settled.
    accountNumberLastFour: text("account_number_last_four"),
    currency: text("currency").notNull(), // ISO-4217; the tree below inherits it
    iolta: integer("iolta").notNull().default(1),
    // The book side: the asset LEAF whose balance is the firm's own record of this bank account.
    bankLedgerAccountId: text("bank_ledger_account_id")
      .notNull()
      .$type<LedgerAccountId>()
      .references(() => ledgerAccount.id),
    // The client side: the liability PARENT every client node hangs under. Its stored balance stays
    // at zero forever — lines land on leaves only — so the client-side total is a SUM over its
    // descendant leaves and is never read from this row (ledger fitness re-proves the zero).
    clientLiabilityAccountId: text("client_liability_account_id")
      .notNull()
      .$type<LedgerAccountId>()
      .references(() => ledgerAccount.id),
    status: text("status", { enum: ["open", "closed"] })
      .notNull()
      .default("open"),
    openedOn: text("opened_on").notNull(), // YYYY-MM-DD civil date
    closedAt: text("closed_at"), // UTC instant
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    // One ledger account serves exactly one trust account on each side — the uniqueness is what
    // makes "which trust account does this posting belong to" answerable from a line alone.
    uniqueIndex("trust_account_bank_ledger_account_unique_index").on(table.bankLedgerAccountId),
    uniqueIndex("trust_account_client_liability_account_unique_index").on(
      table.clientLiabilityAccountId,
    ),
    index("trust_account_location_index").on(table.locationId),
    index("trust_account_status_index").on(table.status),
    check("trust_account_name_nonempty_check", sql`length(${table.name}) > 0`),
    check("trust_account_status_check", sql`${table.status} IN ('open', 'closed')`),
    check("trust_account_currency_check", sql`length(${table.currency}) = 3`),
    // The bank and the client-liability root are opposite sides of the same account; the same
    // ledger account on both would make every trust entry a self-transfer that balances to nothing.
    check(
      "trust_account_distinct_sides_check",
      sql`${table.bankLedgerAccountId} <> ${table.clientLiabilityAccountId}`,
    ),
    check(
      "trust_account_last_four_check",
      sql`${table.accountNumberLastFour} IS NULL OR ${table.accountNumberLastFour} GLOB '[0-9][0-9][0-9][0-9]'`,
    ),
    check(
      "trust_account_closed_at_check",
      sql`(${table.status} = 'closed') = (${table.closedAt} IS NOT NULL)`,
    ),
  ],
);

// The sub-ledger tree: which ledger account under a trust account belongs to which client or matter.
// Three levels — the trust account's liability root, a CLIENT node per trust client, and a MATTER
// LEAF under it. Both readings the rules and the product need are then a direct read: the bar's
// "client ledger" is the client node's roll-up, and a matter's balance is its own leaf.
//
// The tier order is not revisable after the fact. `createAccount` refuses a parent that already
// carries postings (the creation-side half of the leaf-only invariant), so a client tier cannot be
// inserted above matter leaves that have already posted — the tree is chosen once, before the first
// row, or rebuilt.
export const trustLedgerNode = sqliteTable(
  "trust_ledger_node",
  {
    id: text("id").primaryKey().$type<TrustLedgerNodeId>(), // trustLedgerNode_ handle
    trustAccountId: text("trust_account_id")
      .notNull()
      .$type<TrustAccountId>()
      .references(() => trustAccount.id),
    ledgerAccountId: text("ledger_account_id")
      .notNull()
      .$type<LedgerAccountId>()
      .references(() => ledgerAccount.id),
    // `firm_funds` is the permitted bank-charge carve-out — the firm's own money kept in a trust
    // account to cover service charges, which every researched jurisdiction allows and several
    // require a record of. The vocabulary is reserved here because widening a CHECK later is a
    // table rebuild; NOTHING creates one yet, and the composition guard refuses any entry that
    // touches one, so firm money cannot reach a trust account through this schema today.
    kind: text("kind", { enum: ["client", "matter", "firm_funds"] }).notNull(),
    clientEntityId: text("client_entity_id"), // a directoryPerson_/directoryOrganization_ handle
    matterId: text("matter_id")
      .$type<MatterId>()
      .references(() => matter.id),
    parentNodeId: text("parent_node_id")
      .$type<TrustLedgerNodeId>()
      .references((): AnySQLiteColumn => trustLedgerNode.id),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    // A ledger account belongs to at most one node: without this, the same account could be claimed
    // by two clients and every balance read would be ambiguous.
    uniqueIndex("trust_ledger_node_ledger_account_unique_index").on(table.ledgerAccountId),
    uniqueIndex("trust_ledger_node_client_unique_index")
      .on(table.trustAccountId, table.clientEntityId)
      .where(sql`${table.kind} = 'client'`),
    uniqueIndex("trust_ledger_node_matter_unique_index")
      .on(table.trustAccountId, table.matterId)
      .where(sql`${table.kind} = 'matter'`),
    // At most one firm-funds leaf per trust account — "the firm's own money in this account" must
    // be a single balance a report and a bound can address, not a set of them.
    uniqueIndex("trust_ledger_node_firm_funds_unique_index")
      .on(table.trustAccountId)
      .where(sql`${table.kind} = 'firm_funds'`),
    index("trust_ledger_node_account_kind_index").on(table.trustAccountId, table.kind),
    index("trust_ledger_node_matter_index").on(table.matterId),
    index("trust_ledger_node_parent_index").on(table.parentNodeId),
    check("trust_ledger_node_kind_check", sql`${table.kind} IN ('client', 'matter', 'firm_funds')`),
    // Each kind's column shape is stated once, here, so a node cannot exist half-attributed — a
    // matter leaf with no client, or a client node that also names a matter, would each break a
    // different roll-up.
    check(
      "trust_ledger_node_shape_check",
      sql`(${table.kind} = 'client' AND ${table.clientEntityId} IS NOT NULL AND ${table.matterId} IS NULL AND ${table.parentNodeId} IS NULL)
        OR (${table.kind} = 'matter' AND ${table.clientEntityId} IS NOT NULL AND ${table.matterId} IS NOT NULL AND ${table.parentNodeId} IS NOT NULL)
        OR (${table.kind} = 'firm_funds' AND ${table.clientEntityId} IS NULL AND ${table.matterId} IS NULL AND ${table.parentNodeId} IS NULL)`,
    ),
  ],
);

// A disputed-funds hold: a restriction on part of a node's balance where the money has NOT moved.
// Where a lawyer and another person both claim an interest in trust property, the disputed portion
// is kept separate until the dispute resolves while undisputed portions are distributed promptly —
// which is a restriction, not a transfer, and modelling it as a transfer would move money that did
// not move. Available balance is the stored balance minus the active holds, and disbursement
// authorization reads available; the `account_balance` floor still guards zero underneath, so the
// structural guarantee never depends on this domain layer being correct.
//
// APPEND-ONLY, enforced by triggers in the migration: releasing a hold INSERTS a row naming it
// through `releases_hold_id`, exactly as a ledger correction is a new reversing entry. A hold is
// active when no row names it. A partial release is a release plus a new, smaller hold.
export const trustHold = sqliteTable(
  "trust_hold",
  {
    id: text("id").primaryKey().$type<TrustHoldId>(), // trustHold_ handle
    nodeId: text("node_id")
      .notNull()
      .$type<TrustLedgerNodeId>()
      .references(() => trustLedgerNode.id),
    amountMinor: integer("amount_minor").notNull(), // always positive; a release repeats the amount
    currency: text("currency").notNull(),
    reason: text("reason").notNull(), // on a release row, the reason the hold came off
    placedAt: text("placed_at").notNull(), // UTC instant
    placedBy: text("placed_by").$type<UserId>(),
    releasesHoldId: text("releases_hold_id")
      .$type<TrustHoldId>()
      .references((): AnySQLiteColumn => trustHold.id),
  },
  (table) => [
    // UNIQUE makes a double release structurally impossible — the racing duplicate's batch aborts.
    // SQLite UNIQUE permits many NULLs, so placement rows are unaffected.
    uniqueIndex("trust_hold_releases_hold_unique_index").on(table.releasesHoldId),
    // The available-balance read wants the ACTIVE holds on a node, which is a narrow slice of a
    // table that only grows: a partial index keeps it proportional to the open disputes.
    index("trust_hold_node_active_index")
      .on(table.nodeId)
      .where(sql`${table.releasesHoldId} IS NULL`),
    check("trust_hold_amount_positive_check", sql`${table.amountMinor} > 0`),
    check("trust_hold_reason_nonempty_check", sql`length(${table.reason}) > 0`),
    check("trust_hold_currency_check", sql`length(${table.currency}) = 3`),
  ],
);

// The link between the two entries a trust-to-operating movement posts. The movement is TWO entries
// rather than one — a trust disbursement and an operating receipt — because the two sides clear on
// different bank statements and reconciliation runs per account; a single entry would put an
// uncleared operating receipt inside a trust reconciliation. The link is this shared row, never a
// mutation of either entry.
//
// `authorized_by` is the electronic-transfer authorization memo several jurisdictions require: a
// written record identifying who authorized the movement. It is recorded from the first transfer
// rather than backfilled, because the gap an examiner asks about is exactly the period before it
// existed.
export const trustTransfer = sqliteTable(
  "trust_transfer",
  {
    id: text("id").primaryKey().$type<TrustTransferId>(), // trustTransfer_ handle
    trustAccountId: text("trust_account_id")
      .notNull()
      .$type<TrustAccountId>()
      .references(() => trustAccount.id),
    fromNodeId: text("from_node_id")
      .notNull()
      .$type<TrustLedgerNodeId>()
      .references(() => trustLedgerNode.id),
    amountMinor: integer("amount_minor").notNull(),
    currency: text("currency").notNull(),
    trustEntryId: text("trust_entry_id")
      .notNull()
      .$type<LedgerEntryId>()
      .references(() => ledgerEntry.id),
    operatingEntryId: text("operating_entry_id")
      .notNull()
      .$type<LedgerEntryId>()
      .references(() => ledgerEntry.id),
    authorizedBy: text("authorized_by").$type<UserId>(),
    effectiveDate: text("effective_date").notNull(), // YYYY-MM-DD civil date
    recordedAt: text("recorded_at").notNull(), // UTC instant
  },
  (table) => [
    // Each entry participates in at most one transfer, on one side: a second row claiming either
    // entry would double-count the movement in every report that joins through this table.
    uniqueIndex("trust_transfer_trust_entry_unique_index").on(table.trustEntryId),
    uniqueIndex("trust_transfer_operating_entry_unique_index").on(table.operatingEntryId),
    index("trust_transfer_from_node_index").on(table.fromNodeId),
    index("trust_transfer_account_effective_date_index").on(
      table.trustAccountId,
      table.effectiveDate,
    ),
    check("trust_transfer_amount_positive_check", sql`${table.amountMinor} > 0`),
    check("trust_transfer_currency_check", sql`length(${table.currency}) = 3`),
    check(
      "trust_transfer_distinct_entries_check",
      sql`${table.trustEntryId} <> ${table.operatingEntryId}`,
    ),
  ],
);

// The client-ledger record beside one trust ledger entry. The ledger holds the money — amounts,
// direction, balances — and holds nothing about WHY the money moved. The trust record-keeping rules
// ask for more than that: a per-client ledger showing the source, the amount, the purpose, the
// payee, and a running balance, plus, for a disbursement by electronic transfer, a written
// memorandum authorizing the transaction and identifying the responsible attorney. Those facts are
// this row, and they are recorded from the first movement rather than backfilled, because the gap an
// examiner asks about is exactly the period before the column existed.
//
// APPEND-ONLY, enforced by triggers in the migration. A correction is a reversing ledger entry and
// its own movement row; a payee typed wrong is not edited away, because the record of what was
// stated at the time is the record the rules are about.
export const trustMovement = sqliteTable(
  "trust_movement",
  {
    id: text("id").primaryKey().$type<TrustMovementId>(), // trustMovement_ handle
    trustAccountId: text("trust_account_id")
      .notNull()
      .$type<TrustAccountId>()
      .references(() => trustAccount.id),
    // `matter_transfer` moves funds between two matter leaves of the SAME client and touches no
    // bank: the money stays in the trust account and only whose matter it is against changes. A
    // movement between two DIFFERENT clients is not in this vocabulary and never will be — at the
    // entry level it is indistinguishable from misappropriation, and the composition guard refuses
    // it outright.
    kind: text("kind", { enum: ["deposit", "disbursement", "matter_transfer"] }).notNull(),
    // The matter leaf this movement is about: credited by a deposit, debited by a disbursement, the
    // source of a matter transfer.
    nodeId: text("node_id")
      .notNull()
      .$type<TrustLedgerNodeId>()
      .references(() => trustLedgerNode.id),
    // The receiving matter leaf of a matter transfer, and null on every other kind.
    counterpartyNodeId: text("counterparty_node_id")
      .$type<TrustLedgerNodeId>()
      .references(() => trustLedgerNode.id),
    amountMinor: integer("amount_minor").notNull(),
    currency: text("currency").notNull(),
    entryId: text("entry_id")
      .notNull()
      .$type<LedgerEntryId>()
      .references(() => ledgerEntry.id),
    // How the money physically moved. Modelled as a value rather than left inside a description
    // because several jurisdictions prohibit specific methods outright — cash withdrawal, ATM or
    // debit access, a check payable to Cash — and a rule engine cannot refuse a method it cannot
    // see. `internal` is the matter transfer's method: no bank movement happened at all.
    method: text("method", {
      enum: ["check", "cash", "wire", "electronic_transfer", "card", "internal"],
    }).notNull(),
    reference: text("reference"), // check number, wire confirmation, deposit slip — null when there is none
    // Who the money came from (deposit) or went to (disbursement); null on a matter transfer, which
    // has no external counterparty. Free text: the payee on a trust check is frequently not a
    // Directory contact, and a required link would push firms into inventing contacts.
    counterpartyName: text("counterparty_name"),
    purpose: text("purpose").notNull(), // the rules' "purpose" column on the client ledger
    // Who entered the record, always; and who authorized money to move, which the rules require for
    // a disbursement and which a reallocation between matters needs for the same reason.
    recordedBy: text("recorded_by").notNull().$type<UserId>(),
    authorizedBy: text("authorized_by").$type<UserId>(),
    effectiveDate: text("effective_date").notNull(), // YYYY-MM-DD civil date
    recordedAt: text("recorded_at").notNull(), // UTC instant
  },
  (table) => [
    // One movement row per entry: a second row would double the entry in the trust journal and in
    // every client-ledger report that reads through this table.
    uniqueIndex("trust_movement_entry_unique_index").on(table.entryId),
    // The client ledger — one matter leaf, chronological — is the report the rules name, and it
    // reads by node and effective date. The counterparty index serves the receiving leaf's ledger,
    // which must show a transfer in as plainly as the source leaf shows it out.
    index("trust_movement_node_effective_date_index").on(table.nodeId, table.effectiveDate),
    index("trust_movement_counterparty_node_index").on(table.counterpartyNodeId),
    // The trust journal: receipts and disbursements for one account by effective date.
    index("trust_movement_account_effective_date_index").on(
      table.trustAccountId,
      table.effectiveDate,
    ),
    check("trust_movement_amount_positive_check", sql`${table.amountMinor} > 0`),
    check("trust_movement_currency_check", sql`length(${table.currency}) = 3`),
    check("trust_movement_purpose_nonempty_check", sql`length(${table.purpose}) > 0`),
    // Each kind's shape stated once, so the database refuses the combinations that would make a
    // movement lie about itself: a reallocation claiming a bank method or an external payee, a bank
    // movement hiding as internal, money leaving a client ledger with nobody named as having
    // authorized it, or a transfer whose two ends are the same leaf.
    check(
      "trust_movement_shape_check",
      sql`(${table.kind} = 'deposit' AND ${table.counterpartyNodeId} IS NULL AND ${table.method} <> 'internal' AND ${table.counterpartyName} IS NOT NULL)
        OR (${table.kind} = 'disbursement' AND ${table.counterpartyNodeId} IS NULL AND ${table.method} <> 'internal' AND ${table.counterpartyName} IS NOT NULL AND ${table.authorizedBy} IS NOT NULL)
        OR (${table.kind} = 'matter_transfer' AND ${table.counterpartyNodeId} IS NOT NULL AND ${table.counterpartyNodeId} <> ${table.nodeId} AND ${table.method} = 'internal' AND ${table.counterpartyName} IS NULL AND ${table.authorizedBy} IS NOT NULL)`,
    ),
  ],
);

// A proposed payment out of a client ledger, before any money has moved. THIS IS NOT A MOVEMENT: no
// ledger entry, no balance, no trust_movement row exists while a request is pending, so a request
// that is never approved leaves the client ledger exactly as it found it. The row carries the full
// particulars the movement will be composed from — the leaf, the amount, the payee, the method, the
// reference, the purpose, the description, and the effective date — because the person approving is
// approving THOSE facts, and a request that stored only an amount would be an approval of something
// nobody wrote down.
//
// APPEND-ONLY, enforced by triggers in the migration. Its outcome is a row in
// trust_disbursement_decision, never an edit here and never a status column: pending is the DERIVED
// state of a request no decision names, exactly as an active hold is a hold no release names.
export const trustDisbursementRequest = sqliteTable(
  "trust_disbursement_request",
  {
    id: text("id").primaryKey().$type<TrustDisbursementRequestId>(), // trustDisbursementRequest_ handle
    trustAccountId: text("trust_account_id")
      .notNull()
      .$type<TrustAccountId>()
      .references(() => trustAccount.id),
    // The matter leaf the money would leave. Resolved at submission rather than at approval so the
    // approver and the submitter are looking at the same client ledger.
    nodeId: text("node_id")
      .notNull()
      .$type<TrustLedgerNodeId>()
      .references(() => trustLedgerNode.id),
    amountMinor: integer("amount_minor").notNull(),
    currency: text("currency").notNull(),
    // The same vocabulary trust_movement carries, minus `internal`: a disbursement leaves the bank,
    // and `internal` names a reallocation that never touches one.
    method: text("method", {
      enum: ["check", "cash", "wire", "electronic_transfer", "card"],
    }).notNull(),
    reference: text("reference"),
    payee: text("payee").notNull(),
    purpose: text("purpose").notNull(),
    description: text("description").notNull(), // becomes the ledger entry's description on approval
    effectiveDate: text("effective_date").notNull(), // YYYY-MM-DD civil date
    requestedBy: text("requested_by").notNull().$type<UserId>(),
    requestedAt: text("requested_at").notNull(), // UTC instant
  },
  (table) => [
    // The approval queue: what is outstanding on one trust account, oldest first.
    index("trust_disbursement_request_account_requested_at_index").on(
      table.trustAccountId,
      table.requestedAt,
    ),
    index("trust_disbursement_request_node_index").on(table.nodeId),
    check("trust_disbursement_request_amount_positive_check", sql`${table.amountMinor} > 0`),
    check("trust_disbursement_request_currency_check", sql`length(${table.currency}) = 3`),
    check(
      "trust_disbursement_request_method_check",
      sql`${table.method} IN ('check', 'cash', 'wire', 'electronic_transfer', 'card')`,
    ),
    check("trust_disbursement_request_payee_nonempty_check", sql`length(${table.payee}) > 0`),
    check("trust_disbursement_request_purpose_nonempty_check", sql`length(${table.purpose}) > 0`),
    check(
      "trust_disbursement_request_description_nonempty_check",
      sql`length(${table.description}) > 0`,
    ),
  ],
);

// The one row that settles a disbursement request: approved, and the movement it posted; rejected,
// and why; or withdrawn by the member who asked for it. UNIQUE on `request_id` is what makes a
// second decision structurally impossible — two members approving the same request at the same
// instant both compose a movement, and the loser's ENTIRE batch aborts at commit, ledger entry and
// all, because the decision and the posting are one batch.
//
// APPEND-ONLY, enforced by triggers in the migration, and the approver-differs rule is a trigger
// too rather than route discipline: a second person's approval that the application layer alone
// enforced would be one forgotten code path away from not existing. `sole_trust_manager` is the
// named, visible exception for a firm that has only one member holding the trust capability — the
// database refuses it the moment a second such member exists, so it cannot be used to opt out.
export const trustDisbursementDecision = sqliteTable(
  "trust_disbursement_decision",
  {
    id: text("id").primaryKey().$type<TrustDisbursementDecisionId>(), // trustDisbursementDecision_ handle
    requestId: text("request_id")
      .notNull()
      .$type<TrustDisbursementRequestId>()
      .references(() => trustDisbursementRequest.id),
    decision: text("decision", { enum: ["approved", "rejected", "withdrawn"] }).notNull(),
    decidedBy: text("decided_by").notNull().$type<UserId>(),
    decidedAt: text("decided_at").notNull(), // UTC instant
    // Why the request was refused, in the decider's words. Required on a rejection — a refusal
    // nobody explained is a refusal the submitter cannot answer — and absent on an approval, whose
    // reasoning is the request's own purpose.
    reason: text("reason"),
    // On what footing the approval was given. `second_person` is the rule; `sole_trust_manager`
    // records, on the face of the record, that the firm had nobody else who could approve and the
    // submitter authorized their own disbursement.
    authorizationBasis: text("authorization_basis", {
      enum: ["second_person", "sole_trust_manager"],
    }),
    // The movement the approval posted, in the same batch as this row. Null on every other decision,
    // which is the whole point: nothing reached the ledger.
    movementId: text("movement_id")
      .$type<TrustMovementId>()
      .references(() => trustMovement.id),
  },
  (table) => [
    uniqueIndex("trust_disbursement_decision_request_unique_index").on(table.requestId),
    uniqueIndex("trust_disbursement_decision_movement_unique_index").on(table.movementId),
    check(
      "trust_disbursement_decision_decision_check",
      sql`${table.decision} IN ('approved', 'rejected', 'withdrawn')`,
    ),
    // Each outcome's shape stated once, so a decision cannot misdescribe itself: an approval with no
    // movement and no basis, a rejection that claims to have posted one, or an unexplained refusal.
    check(
      "trust_disbursement_decision_shape_check",
      sql`(${table.decision} = 'approved' AND ${table.authorizationBasis} IS NOT NULL AND ${table.movementId} IS NOT NULL AND ${table.reason} IS NULL)
        OR (${table.decision} = 'rejected' AND ${table.authorizationBasis} IS NULL AND ${table.movementId} IS NULL AND length(${table.reason}) > 0)
        OR (${table.decision} = 'withdrawn' AND ${table.authorizationBasis} IS NULL AND ${table.movementId} IS NULL AND (${table.reason} IS NULL OR length(${table.reason}) > 0))`,
    ),
  ],
);

// One period of a trust bank account exactly as the institution reported it. This is the ONLY
// external input to the whole trust subsystem: every other row here is the firm's own assertion
// about its own records, and the no-negative floor guards those records rather than the bank. An
// item the firm never recorded — a bank fee, a returned deposit, a forged check — exists nowhere in
// the platform until it arrives on one of these.
//
// Entered by a member or imported from a file the bank produced; the source is recorded because
// where a figure came from is part of what the reconciliation attests to. Balances are SIGNED and
// deliberately carry no positive check: a bank account really can be overdrawn, and a schema that
// refused to record it would refuse to record the exact condition reconciliation exists to catch.
//
// APPEND-ONLY, enforced by triggers in the migration. A bank that reissues a corrected statement is
// a NEW row naming the one it supersedes, because a reconciliation already closed against the
// original attested to the figures as they then read.
export const trustBankStatement = sqliteTable(
  "trust_bank_statement",
  {
    id: text("id").primaryKey().$type<TrustBankStatementId>(), // trustBankStatement_ handle
    trustAccountId: text("trust_account_id")
      .notNull()
      .$type<TrustAccountId>()
      .references(() => trustAccount.id),
    periodStart: text("period_start").notNull(), // YYYY-MM-DD civil date
    periodEnd: text("period_end").notNull(), // YYYY-MM-DD civil date
    openingBalanceMinor: integer("opening_balance_minor").notNull(),
    closingBalanceMinor: integer("closing_balance_minor").notNull(),
    currency: text("currency").notNull(),
    statementReference: text("statement_reference"), // the number the bank printed, when it printed one
    // How the figures got here. `imported` says a file the firm supplied was parsed, previewed, and
    // confirmed by a person; it never means a machine decided to store them on its own.
    source: text("source", { enum: ["entered", "imported"] }).notNull(),
    // The statement this one replaces, when a bank reissues a period. Never an edit of the original.
    supersedesStatementId: text("supersedes_statement_id")
      .$type<TrustBankStatementId>()
      .references((): AnySQLiteColumn => trustBankStatement.id),
    recordedBy: text("recorded_by").notNull().$type<UserId>(),
    recordedAt: text("recorded_at").notNull(), // UTC instant
  },
  (table) => [
    // A statement is superseded at most once; a second correction supersedes the correction.
    uniqueIndex("trust_bank_statement_supersedes_unique_index").on(table.supersedesStatementId),
    // The statement list for one account, most recent period last — the read every reconciliation
    // starts from.
    index("trust_bank_statement_account_period_index").on(table.trustAccountId, table.periodEnd),
    check("trust_bank_statement_currency_check", sql`length(${table.currency}) = 3`),
    check(
      "trust_bank_statement_period_order_check",
      sql`${table.periodEnd} >= ${table.periodStart}`,
    ),
    check("trust_bank_statement_source_check", sql`${table.source} IN ('entered', 'imported')`),
  ],
);

// One item on a bank statement: a date, a direction, an amount, and whatever text the bank printed
// beside it. `direction` is stated from the account holder's side — a `deposit` increased the trust
// bank balance and a `withdrawal` reduced it — so a line can be compared with a recorded movement
// without anyone having to reason about the bank's own debit/credit convention.
//
// `counterparty_name` is the other party as the BANK named it, which is frequently not what the firm
// called them and frequently not a Directory contact. It exists because it is what a person matches
// on; it is classified as personal data for the same reason the movement's payee is.
//
// APPEND-ONLY, enforced by triggers in the migration. A line typed wrong is not edited: the
// statement it belongs to is superseded by a corrected one.
export const trustBankStatementLine = sqliteTable(
  "trust_bank_statement_line",
  {
    id: text("id").primaryKey().$type<TrustBankStatementLineId>(), // trustBankStatementLine_ handle
    statementId: text("statement_id")
      .notNull()
      .$type<TrustBankStatementId>()
      .references(() => trustBankStatement.id),
    postedOn: text("posted_on").notNull(), // YYYY-MM-DD civil date, as the bank posted it
    direction: text("direction", { enum: ["deposit", "withdrawal"] }).notNull(),
    amountMinor: integer("amount_minor").notNull(),
    description: text("description").notNull(), // the bank's own narrative for the item
    reference: text("reference"), // check number, wire reference — null when the bank printed none
    counterpartyName: text("counterparty_name"),
    // Which row of the imported file this line came from, and null on a line a member typed. It is
    // what lets an import report point at the row a person has to look at in their own file.
    sourceRowNumber: integer("source_row_number"),
    recordedAt: text("recorded_at").notNull(), // UTC instant
  },
  (table) => [
    // The statement in bank order, and the read the matcher's candidate window narrows from.
    index("trust_bank_statement_line_statement_posted_index").on(table.statementId, table.postedOn),
    // Matching draws candidates by amount before anything else, so the amount leads this index.
    index("trust_bank_statement_line_amount_index").on(table.amountMinor, table.statementId),
    check("trust_bank_statement_line_amount_positive_check", sql`${table.amountMinor} > 0`),
    check(
      "trust_bank_statement_line_description_nonempty_check",
      sql`length(${table.description}) > 0`,
    ),
    check(
      "trust_bank_statement_line_direction_check",
      sql`${table.direction} IN ('deposit', 'withdrawal')`,
    ),
    check(
      "trust_bank_statement_line_source_row_check",
      sql`${table.sourceRowNumber} IS NULL OR ${table.sourceRowNumber} > 0`,
    ),
  ],
);

// A firm's attempt to tie one bank statement to its own records, and — once closed — the frozen
// proof it produced. Three totals must agree as of the period end: the statement's closing balance
// adjusted for items the firm recorded that have not reached the bank yet, the book balance of the
// trust bank account, and the sum of every client ledger under it.
//
// The frozen columns are the whole point of the row. While the reconciliation is open, the proof is
// recomputed on every read and moves as postings land; the close writes what the proof said at that
// instant, and from then on it never changes — a reversal posted next week with a backdated
// effective date must not alter an attestation somebody already signed. A reconciliation that did
// NOT balance closes anyway, recording exactly that: the record of a problem is the value, and a
// close that refused an unbalanced proof would teach firms to leave the disagreement unrecorded.
//
// `status` here is a real lifecycle rather than the derived-state pattern the holds and disbursement
// tables use, because closing IS the freeze rather than a second event another row could imply. The
// migration's triggers make it one-way: a closed reconciliation refuses every further write, and an
// open one refuses any change to what it is about. A correction is a new reconciliation naming the
// one it supersedes.
export const trustReconciliation = sqliteTable(
  "trust_reconciliation",
  {
    id: text("id").primaryKey().$type<TrustReconciliationId>(), // trustReconciliation_ handle
    trustAccountId: text("trust_account_id")
      .notNull()
      .$type<TrustAccountId>()
      .references(() => trustAccount.id),
    statementId: text("statement_id")
      .notNull()
      .$type<TrustBankStatementId>()
      .references(() => trustBankStatement.id),
    status: text("status", { enum: ["open", "closed"] }).notNull(),
    openedBy: text("opened_by").notNull().$type<UserId>(),
    openedAt: text("opened_at").notNull(), // UTC instant
    closedBy: text("closed_by").$type<UserId>(),
    closedAt: text("closed_at"), // UTC instant
    // The frozen proof. Every one of these is null while the reconciliation is open and non-null
    // once it has closed, which the shape check states rather than leaving to a caller.
    frozenStatementClosingMinor: integer("frozen_statement_closing_minor"),
    frozenOutstandingDepositsMinor: integer("frozen_outstanding_deposits_minor"),
    frozenOutstandingDisbursementsMinor: integer("frozen_outstanding_disbursements_minor"),
    frozenAdjustedBankMinor: integer("frozen_adjusted_bank_minor"),
    frozenBookBalanceMinor: integer("frozen_book_balance_minor"),
    frozenClientTotalMinor: integer("frozen_client_total_minor"),
    frozenUnmatchedLineCount: integer("frozen_unmatched_line_count"),
    frozenUnmatchedMovementCount: integer("frozen_unmatched_movement_count"),
    // 1 when the three legs agreed at the moment of the close, 0 when they did not. Stored rather
    // than left to be re-derived from the totals so that "this period did not tie out" is a fact a
    // report filters on directly.
    frozenBalanced: integer("frozen_balanced"),
    // The reconciliation this one replaces — a period redone against a corrected statement, or after
    // the missing movements were recorded. Never an edit of the original.
    supersedesReconciliationId: text("supersedes_reconciliation_id")
      .$type<TrustReconciliationId>()
      .references((): AnySQLiteColumn => trustReconciliation.id),
    note: text("note"),
  },
  (table) => [
    uniqueIndex("trust_reconciliation_supersedes_unique_index").on(
      table.supersedesReconciliationId,
    ),
    index("trust_reconciliation_account_opened_index").on(table.trustAccountId, table.openedAt),
    index("trust_reconciliation_statement_index").on(table.statementId),
    check("trust_reconciliation_status_check", sql`${table.status} IN ('open', 'closed')`),
    // Open carries no proof and no closer; closed carries all of both. A half-frozen row would
    // attest to part of a proof, which is not something anyone can rely on.
    check(
      "trust_reconciliation_shape_check",
      sql`(${table.status} = 'open' AND ${table.closedBy} IS NULL AND ${table.closedAt} IS NULL AND ${table.frozenStatementClosingMinor} IS NULL AND ${table.frozenOutstandingDepositsMinor} IS NULL AND ${table.frozenOutstandingDisbursementsMinor} IS NULL AND ${table.frozenAdjustedBankMinor} IS NULL AND ${table.frozenBookBalanceMinor} IS NULL AND ${table.frozenClientTotalMinor} IS NULL AND ${table.frozenUnmatchedLineCount} IS NULL AND ${table.frozenUnmatchedMovementCount} IS NULL AND ${table.frozenBalanced} IS NULL)
        OR (${table.status} = 'closed' AND ${table.closedBy} IS NOT NULL AND ${table.closedAt} IS NOT NULL AND ${table.frozenStatementClosingMinor} IS NOT NULL AND ${table.frozenOutstandingDepositsMinor} IS NOT NULL AND ${table.frozenOutstandingDisbursementsMinor} IS NOT NULL AND ${table.frozenAdjustedBankMinor} IS NOT NULL AND ${table.frozenBookBalanceMinor} IS NOT NULL AND ${table.frozenClientTotalMinor} IS NOT NULL AND ${table.frozenUnmatchedLineCount} IS NOT NULL AND ${table.frozenUnmatchedMovementCount} IS NOT NULL AND ${table.frozenBalanced} IN (0, 1))`,
    ),
    check(
      "trust_reconciliation_outstanding_sign_check",
      sql`(${table.frozenOutstandingDepositsMinor} IS NULL OR ${table.frozenOutstandingDepositsMinor} >= 0)
        AND (${table.frozenOutstandingDisbursementsMinor} IS NULL OR ${table.frozenOutstandingDisbursementsMinor} >= 0)
        AND (${table.frozenUnmatchedLineCount} IS NULL OR ${table.frozenUnmatchedLineCount} >= 0)
        AND (${table.frozenUnmatchedMovementCount} IS NULL OR ${table.frozenUnmatchedMovementCount} >= 0)`,
    ),
  ],
);

// One person's assertion that one statement line and one recorded ledger entry are the same event.
// NOTHING in this platform writes one of these on its own: the matcher offers bounded suggestions
// and a member confirms each, because a wrong automatic match hides exactly the discrepancy the
// reconciliation exists to find — the totals would tie out on a report while the ledger and the bank
// disagreed about which items actually happened.
//
// The book side is a LEDGER ENTRY rather than a `trust_movement`, and that is load-bearing: an
// earned-fee transfer out of trust records a `trust_transfer` and no movement row at all, so a match
// keyed on movements could never clear one, and every such transfer would sit outstanding forever.
// Anything that moves the bank balance is an entry touching the trust bank account, whatever composed
// it; the movement or transfer record beside it is joined for display.
//
// One line to one entry. A single bank line covering several recorded items — one deposit slip for
// three checks — is a real shape this does not yet express; it reads as one match plus items left
// outstanding, and the proof reports the resulting difference rather than hiding it.
//
// APPEND-ONLY, enforced by triggers in the migration. A match a person got wrong is withdrawn by a
// NEW row naming it in `unmatches_match_id`, on the same derivation the hold model uses: a match is
// active when no row unmatches it, so no status column exists anywhere that could disagree with the
// rows. A withdrawal repeats the line and the entry it releases, exactly as a hold release repeats
// the node it frees.
export const trustReconciliationMatch = sqliteTable(
  "trust_reconciliation_match",
  {
    id: text("id").primaryKey().$type<TrustReconciliationMatchId>(), // trustReconciliationMatch_ handle
    reconciliationId: text("reconciliation_id")
      .notNull()
      .$type<TrustReconciliationId>()
      .references(() => trustReconciliation.id),
    statementLineId: text("statement_line_id")
      .notNull()
      .$type<TrustBankStatementLineId>()
      .references(() => trustBankStatementLine.id),
    entryId: text("entry_id")
      .notNull()
      .$type<LedgerEntryId>()
      .references(() => ledgerEntry.id),
    // The match this row withdraws, and null on a match itself.
    unmatchesMatchId: text("unmatches_match_id")
      .$type<TrustReconciliationMatchId>()
      .references((): AnySQLiteColumn => trustReconciliationMatch.id),
    matchedBy: text("matched_by").notNull().$type<UserId>(),
    matchedAt: text("matched_at").notNull(), // UTC instant
  },
  (table) => [
    // A match is withdrawn at most once: two concurrent withdrawals leave one row, and the loser's
    // whole batch aborts.
    uniqueIndex("trust_reconciliation_match_unmatches_unique_index").on(table.unmatchesMatchId),
    index("trust_reconciliation_match_reconciliation_index").on(table.reconciliationId),
    // "Has this line been matched, and has this entry cleared" — the two reads the proof and the
    // unmatched lists are built from.
    index("trust_reconciliation_match_line_index").on(table.statementLineId),
    index("trust_reconciliation_match_entry_index").on(table.entryId),
  ],
);

// Billing and invoicing — the invoice spine.
//
// The tables below are organized by their MUTABILITY posture, which is the property worth organizing
// a billing subsystem by: getting it wrong in either direction is the characteristic failure of one
// hung off an append-only ledger. A draft is a working document and is freely editable; a finalized
// invoice is an evidentiary record frozen by trigger; the numbering pair is append-only from birth;
// and exactly one row is deliberately mutable — invoice_matter_balance, whose bounds CHECK is the
// only mechanism that can abort a whole D1 batch on a business condition.

// The invoice header. It carries NO stored total and NO stored balance: both derive from the
// per-matter balance rows, so a payment never has a reason to touch this row and can never drift
// from the subledger. The letterhead, remit-to, and client billing name are SNAPSHOT at finalize and
// never read live — a later edit to an office address must not silently alter a document the firm
// already gave somebody.
export const invoice = sqliteTable(
  "invoice",
  {
    id: text("id").primaryKey().$type<InvoiceId>(), // invoice_ handle
    // Exactly one client per invoice, resolved through matter_party where role = 'client'. An
    // invoice spanning two clients cannot be applied from trust at all (a trust entry touching two
    // clients is refused at the composition guard), cannot be sensibly aged, and is
    // indistinguishable at the row level from a billing error.
    clientEntityId: text("client_entity_id").notNull(),
    currency: text("currency").notNull(),
    status: text("status", { enum: ["draft", "final", "void"] })
      .notNull()
      .default("draft"),
    // Drawn inside the finalize batch, never at draft: a number drawn at draft is a number burned by
    // every abandoned draft, and gaps are the first thing an auditor asks about.
    invoiceNumber: text("invoice_number"),
    numberScopeKey: text("number_scope_key"),
    numberDrawnValue: integer("number_drawn_value"),
    billingPeriodStart: text("billing_period_start"), // civil PlainDate
    billingPeriodEnd: text("billing_period_end"),
    issueDate: text("issue_date"),
    dueDate: text("due_date"),
    notes: text("notes"),
    // The presentation snapshot: the office whose letterhead the bill was issued on, and the text of
    // that letterhead as it stood at finalize.
    locationId: text("location_id")
      .$type<LocationId>()
      .references(() => location.id),
    letterheadAddressBlock: text("letterhead_address_block"),
    letterheadFooter: text("letterhead_footer"),
    remitTo: text("remit_to"),
    clientBillingName: text("client_billing_name"),
    finalizedAt: text("finalized_at"),
    finalizedBy: text("finalized_by").$type<UserId>(),
    voidedAt: text("voided_at"),
    voidedBy: text("voided_by").$type<UserId>(),
    voidReason: text("void_reason"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
    createdBy: text("created_by").$type<UserId>(),
  },
  (table) => [
    index("invoice_client_status_index").on(table.clientEntityId, table.status),
    index("invoice_status_due_date_index").on(table.status, table.dueDate),
    index("invoice_created_at_id_index").on(table.createdAt, table.id),
    uniqueIndex("invoice_number_unique_index")
      .on(table.invoiceNumber)
      .where(sql`${table.invoiceNumber} IS NOT NULL`),
    check("invoice_status_check", sql`${table.status} IN ('draft', 'final', 'void')`),
    check("invoice_currency_check", sql`length(${table.currency}) = 3`),
    check(
      "invoice_number_paired_check",
      sql`(${table.status} = 'final') = (${table.invoiceNumber} IS NOT NULL)`,
    ),
    check(
      "invoice_number_draw_paired_check",
      sql`(${table.invoiceNumber} IS NULL) = (${table.numberDrawnValue} IS NULL) AND (${table.invoiceNumber} IS NULL) = (${table.numberScopeKey} IS NULL)`,
    ),
    check(
      "invoice_finalized_paired_check",
      sql`(${table.status} = 'final') = (${table.finalizedAt} IS NOT NULL)`,
    ),
    check(
      "invoice_voided_paired_check",
      sql`(${table.status} = 'void') = (${table.voidedAt} IS NOT NULL)`,
    ),
    check(
      "invoice_dates_final_check",
      sql`${table.status} <> 'final' OR (${table.issueDate} IS NOT NULL AND ${table.dueDate} IS NOT NULL)`,
    ),
  ],
);

// What the client is told, in presentation order. Every line NAMES ITS MATTER — there is no
// invoice.matter_id, because a stored column that is supposed to agree with the lines is a column
// that will eventually disagree with them.
//
// The description is a SNAPSHOT taken when the line is composed, not a view of the time entry's
// narrative. Bill review edits the LINE. Two records, both true and both worth keeping: the entry is
// the timekeeper's contemporaneous record of what was done, and the line is what the client was
// told. It also makes a finalized invoice self-contained — re-renderable years later without reading
// a single row from the work-in-progress stores.
export const invoiceLine = sqliteTable(
  "invoice_line",
  {
    id: text("id").primaryKey().$type<InvoiceLineId>(), // invoiceLine_ handle
    invoiceId: text("invoice_id")
      .notNull()
      .$type<InvoiceId>()
      .references(() => invoice.id),
    lineIndex: integer("line_index").notNull(),
    matterId: text("matter_id")
      .notNull()
      .$type<MatterId>()
      .references(() => matter.id),
    kind: text("kind", {
      enum: ["fee", "cost", "flat_fee", "discount", "adjustment", "interest", "tax"],
    }).notNull(),
    description: text("description").notNull(),
    quantityE4: integer("quantity_e4"), // hours at scale 4 on a fee line; null on a flat amount
    rateE4: integer("rate_e4"), // the rate snapshot the entry carried; billing never re-resolves one
    // MAY BE NEGATIVE. A discount, write-down, or courtesy adjustment is an ordinary line, which is
    // why roundInvoiceLine is half-away-from-zero rather than half-up.
    amountMinor: integer("amount_minor").notNull(),
    currency: text("currency").notNull(),
    // The UTBMS codes as strings rather than catalog references: the line is a snapshot, and an
    // exporter reading a code that was later renamed or deactivated must still emit what was billed.
    utbmsTaskCode: text("utbms_task_code"),
    utbmsActivityCode: text("utbms_activity_code"),
    utbmsExpenseCode: text("utbms_expense_code"),
    // Resolved at draft and snapshot. A firm that has configured no tax rate produces no tax line at
    // all, so the default is the empty answer.
    taxTreatment: text("tax_treatment", { enum: ["taxable", "exempt"] })
      .notNull()
      .default("exempt"),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    uniqueIndex("invoice_line_position_unique_index").on(table.invoiceId, table.lineIndex),
    index("invoice_line_matter_index").on(table.matterId, table.invoiceId),
    check(
      "invoice_line_kind_check",
      sql`${table.kind} IN ('fee', 'cost', 'flat_fee', 'discount', 'adjustment', 'interest', 'tax')`,
    ),
    check("invoice_line_currency_check", sql`length(${table.currency}) = 3`),
    check("invoice_line_description_nonempty_check", sql`length(${table.description}) > 0`),
    check("invoice_line_tax_treatment_check", sql`${table.taxTreatment} IN ('taxable', 'exempt')`),
    check("invoice_line_index_check", sql`${table.lineIndex} >= 0`),
  ],
);

// Which work-in-progress rows this invoice has taken. THE CLAIM IS THE TRUTH; the entry's invoice_id
// column is a MIRROR kept for the "what is still unbilled on this matter" read, which is the hot read
// and must not join.
//
// N claims to one line is representable without inventing anything, which is what lets several
// entries consolidate onto one line — and what lets a flat fee claim every contributing entry with a
// null invoice_line_id and a zero claimed amount, so realization reporting can still attribute the
// work the fee covered.
export const invoiceWipClaim = sqliteTable(
  "invoice_wip_claim",
  {
    id: text("id").primaryKey().$type<InvoiceWipClaimId>(), // invoiceWipClaim_ handle
    invoiceId: text("invoice_id")
      .notNull()
      .$type<InvoiceId>()
      .references(() => invoice.id),
    sourceKind: text("source_kind", { enum: ["time_entry", "cost_entry"] }).notNull(),
    sourceId: text("source_id").notNull(),
    invoiceLineId: text("invoice_line_id")
      .$type<InvoiceLineId>()
      .references(() => invoiceLine.id),
    claimedAmountMinor: integer("claimed_amount_minor").notNull(),
    claimedAt: text("claimed_at").notNull(),
    // Set when a draft releases the entry back to unbilled work-in-progress. The released row REMAINS,
    // so "this entry was on a draft that was abandoned on the 3rd" stays answerable, and the partial
    // unique index makes the released row invisible to uniqueness so the entry can be claimed again.
    releasedAt: text("released_at"),
  },
  (table) => [
    uniqueIndex("invoice_wip_claim_active_source_unique_index")
      .on(table.sourceKind, table.sourceId)
      .where(sql`${table.releasedAt} IS NULL`),
    index("invoice_wip_claim_invoice_index").on(table.invoiceId),
    index("invoice_wip_claim_line_index").on(table.invoiceLineId),
    check(
      "invoice_wip_claim_source_kind_check",
      sql`${table.sourceKind} IN ('time_entry', 'cost_entry')`,
    ),
  ],
);

// The derived balance, and the single most important table in the subsystem. Created in the finalize
// batch, one row per (invoice, matter), and mutable ONLY inside a posting batch — exactly as
// account_balance is, for exactly the same reason: D1 has no interactive transactions, so a bounds
// CHECK is the only mechanism that can abort a whole batch on a business condition.
//
// Per (invoice, matter) rather than per invoice because an earned-fee transfer draws on one matter
// leaf, so the ceiling it must respect is that matter's share of the invoice. A single-matter
// invoice, which is most of them, has exactly one row.
export const invoiceMatterBalance = sqliteTable(
  "invoice_matter_balance",
  {
    invoiceId: text("invoice_id")
      .notNull()
      .$type<InvoiceId>()
      .references(() => invoice.id),
    matterId: text("matter_id")
      .notNull()
      .$type<MatterId>()
      .references(() => matter.id),
    totalMinor: integer("total_minor").notNull(),
    appliedMinor: integer("applied_minor").notNull().default(0),
    currency: text("currency").notNull(),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.invoiceId, table.matterId] }),
    index("invoice_matter_balance_matter_index").on(table.matterId),
    check("invoice_matter_balance_currency_check", sql`length(${table.currency}) = 3`),
    check(
      "invoice_matter_balance_bounds_check",
      sql`${table.appliedMinor} >= 0 AND ${table.appliedMinor} <= ${table.totalMinor}`,
    ),
  ],
);

// The invoice-number sequence. next_value is the sanctioned exception to append-only, as it is for
// matter numbers; the mechanism lives in packages/sequence-numbering.
export const invoiceNumberCounter = sqliteTable(
  "invoice_number_counter",
  {
    scopeKey: text("scope_key").primaryKey(), // '' = firm-wide; a Location code for a per-office sequence
    nextValue: integer("next_value").notNull(),
  },
  (table) => [check("invoice_number_counter_next_value_check", sql`${table.nextValue} > 0`)],
);

// One row per counter value a draw consumed. The composite primary key is the load-bearing backstop
// on the draw — NOT the invoice_number unique index, which fires only when two draws render the same
// STRING. Append-only unconditionally by trigger.
export const invoiceNumberAllocation = sqliteTable(
  "invoice_number_allocation",
  {
    scopeKey: text("scope_key").notNull(),
    drawnValue: integer("drawn_value").notNull(),
    invoiceId: text("invoice_id")
      .notNull()
      .$type<InvoiceId>()
      .references(() => invoice.id),
    allocatedAt: text("allocated_at").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.scopeKey, table.drawnValue] }),
    uniqueIndex("invoice_number_allocation_invoice_unique_index").on(table.invoiceId),
    check("invoice_number_allocation_drawn_value_check", sql`${table.drawnValue} > 0`),
  ],
);

// Which of the firm's ledger accounts plays each role a billing posting needs. The product chart of
// accounts does not exist yet, and this is the seam that stands in for it: an unmapped role REFUSES
// finalization with a named error rather than posting somewhere plausible. The role set is the stable
// contract across the boundary the operating chart of accounts will populate.
export const firmAccountRole = sqliteTable(
  "firm_account_role",
  {
    role: text("role", {
      enum: [
        "accounts_receivable",
        "fee_income",
        "client_costs_advanced",
        "cost_recovery_income",
        "tax_payable",
        "fee_adjustments",
        "fee_write_off",
        "operating_bank",
        "client_credit_liability",
      ],
    }).primaryKey(),
    ledgerAccountId: text("ledger_account_id")
      .notNull()
      .$type<LedgerAccountId>()
      .references(() => ledgerAccount.id),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    check(
      "firm_account_role_role_check",
      sql`${table.role} IN ('accounts_receivable', 'fee_income', 'client_costs_advanced', 'cost_recovery_income', 'tax_payable', 'fee_adjustments', 'fee_write_off', 'operating_bank', 'client_credit_liability')`,
    ),
  ],
);

// Every unit of value that reaches an invoice, and the ONLY way any does. A finalized invoice is
// frozen by trigger, so value arriving at it is never an edit: it is a row here plus a delta on
// invoice_matter_balance.applied_minor, and the bounds CHECK on that balance — riding the same batch
// — is what makes over-application structurally impossible rather than hopefully pre-checked.
//
// THE TRUST KIND IS THE ONE THAT COMPOSES NO LEDGER ENTRY. Trust's transfer out of a client ledger
// already posts Dr Operating Bank / Cr Accounts Receivable on its operating leg, so a second credit
// composed here would leave the invoice subledger and the receivable control account disagreeing by
// the total of every trust-funded fee, silently and forever. Every other kind brings its own posting.
//
// Amounts are positive and direction is the row's KIND, never a sign — the ledger's own rule applied
// to the subledger. A reversal carries a positive amount and subtracts because it is a reversal, and
// its UNIQUE link makes a double reversal structurally impossible (the reverses_entry_id precedent).
export const invoiceApplication = sqliteTable(
  "invoice_application",
  {
    id: text("id").primaryKey().$type<InvoiceApplicationId>(), // invoiceApplication_ handle
    invoiceId: text("invoice_id")
      .notNull()
      .$type<InvoiceId>()
      .references(() => invoice.id),
    // Which matter's share of the invoice this pays down. A trust transfer draws on exactly one
    // matter leaf, so the ceiling it must respect is that matter's balance row, not the invoice's
    // total.
    matterId: text("matter_id")
      .notNull()
      .$type<MatterId>()
      .references(() => matter.id),
    kind: text("kind", {
      enum: ["trust_transfer", "payment", "credit_note", "client_credit", "write_off", "reversal"],
    }).notNull(),
    amountMinor: integer("amount_minor").notNull(),
    currency: text("currency").notNull(),
    trustTransferId: text("trust_transfer_id")
      .$type<TrustTransferId>()
      .references(() => trustTransfer.id),
    reversesApplicationId: text("reverses_application_id").$type<InvoiceApplicationId>(),
    effectiveDate: text("effective_date").notNull(), // civil date
    appliedBy: text("applied_by").$type<UserId>(),
    appliedAt: text("applied_at").notNull(),
  },
  (table) => [
    uniqueIndex("invoice_application_reverses_unique_index").on(table.reversesApplicationId),
    index("invoice_application_invoice_matter_index").on(table.invoiceId, table.matterId),
    index("invoice_application_matter_index").on(table.matterId),
    index("invoice_application_trust_transfer_index").on(table.trustTransferId),
    // The whole closed set, including the four kinds no code writes yet: SQLite cannot widen a CHECK
    // without a destructive table rebuild, so narrowing it to what ships today would mean the
    // credit-note and payment paths could never be added additively.
    check(
      "invoice_application_kind_check",
      sql`${table.kind} IN ('trust_transfer', 'payment', 'credit_note', 'client_credit', 'write_off', 'reversal')`,
    ),
    check("invoice_application_amount_positive_check", sql`${table.amountMinor} > 0`),
    check("invoice_application_currency_check", sql`length(${table.currency}) = 3`),
    check(
      "invoice_application_trust_transfer_paired_check",
      sql`(${table.kind} = 'trust_transfer') = (${table.trustTransferId} IS NOT NULL)`,
    ),
    check(
      "invoice_application_reversal_paired_check",
      sql`(${table.kind} = 'reversal') = (${table.reversesApplicationId} IS NOT NULL)`,
    ),
  ],
);

// ---- Case calendar: litigation events and deadlines ----
//
// Two structural positions govern this group. First, only facts BORN here get a row: a hearing, a
// filing, an order, a deposition, a deadline — the things the platform records nowhere else. What
// another subsystem already recorded (a document filed, mail captured, an assembly run, an original
// moved, money through trust, time and costs booked) is read in place through the source registry in
// @magna-carta/calendar, so the timeline cannot disagree with the register it is built from. Nothing
// is projected into these tables and nothing is backfilled into them.
//
// Second, a date here is a CIVIL date and a time is a separate optional wall-clock time, resolved in
// an explicit zone. There is no UTC timestamp on an event or a deadline anywhere in this group:
// storing midnight-local-as-UTC is the daylight-saving off-by-one that moves a hearing by a day when
// the clocks change, and a docketing system cannot have that failure. The instants in the group
// (recorded_at, satisfied_at, created_at) are instants about the RECORD, never about the appearance.

// The per-firm event-type catalog — hearing, trial, filing, service, deposition, and whatever else a
// firm's practice has. A catalog table rather than a platform enum for the reason matter_type,
// document_type, and custody_item_type are: a firm whose practice has a proceeding nobody thought of
// must not be blocked, and a growing list of similar things is a declaration, not code. Soft-
// deactivate only, so an event already classified under a retired type keeps its meaning.
//
// `origin` separates the seeded platform vocabulary from a firm's own additions: a platform row's
// name and code are immutable (a firm may deactivate it, never redefine it under everyone else),
// where a firm row is entirely the firm's. `category` drives grouping and iconography ONLY — nothing
// in the engine branches on it, the same discipline custody_location.kind carries.
export const matterEventType = sqliteTable(
  "matter_event_type",
  {
    id: text("id").primaryKey().$type<MatterEventTypeId>(), // matterEventType_ handle
    name: text("name").notNull(),
    code: text("code"),
    category: text("category", { enum: ["litigation", "transaction", "firm", "other"] })
      .notNull()
      .default("litigation"),
    origin: text("origin", { enum: ["platform", "firm"] })
      .notNull()
      .default("firm"),
    active: integer("active", { mode: "boolean" }).notNull().default(true),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("matter_event_type_name_unique_index").on(table.name),
    uniqueIndex("matter_event_type_code_unique_index").on(table.code),
    check("matter_event_type_name_check", sql`length(${table.name}) > 0`),
    check(
      "matter_event_type_category_check",
      sql`${table.category} IN ('litigation', 'transaction', 'firm', 'other')`,
    ),
    check("matter_event_type_origin_check", sql`${table.origin} IN ('platform', 'firm')`),
  ],
);

// One thing that happened or will happen in the case: a hearing, a filing, service, an order, a
// deposition, a mediation, a trial, a client meeting. Member-entered — there is no court integration
// and no docket feed, so every row here is a person's assertion about a proceeding.
//
// matter_id is REQUIRED. Every read over this table is "what happened on this case", and the
// visibility predicate keys off the matter; a personal appointment that belongs to nobody's case has
// a different audience and a different privacy posture and is its own thing when it is built, not a
// null here.
//
// An event is MUTABLE, deliberately, and that is the one place this group departs from the custody
// ledger. The ledger is append-only because its value in a dispute is that nobody could make it say
// otherwise afterwards; a calendar is a plan and a record of a plan, hearings move, and a firm made
// to record a compensating row to fix a typo stops recording. A continued hearing is the same
// hearing on a new date: the row is edited and the audit_log row written in the same batch carries
// the change, rather than leaving two hearings on the calendar for every consumer to hide one of.
//
// location_text is free text (a courtroom, a department number, an address) rather than a `location`
// foreign key: a courthouse is not one of the firm's offices, exactly as a bank vault is not, and
// that table drives letterhead, remit-to, matter numbering, and staffing for every subsystem that
// reads it. court_reference is likewise the court's own case number as a string, not an invented
// court-identity schema built to hold one field.
export const matterEvent = sqliteTable(
  "matter_event",
  {
    id: text("id").primaryKey().$type<MatterEventId>(), // matterEvent_ handle
    matterId: text("matter_id")
      .notNull()
      .$type<MatterId>()
      .references(() => matter.id),
    eventTypeId: text("event_type_id")
      .$type<MatterEventTypeId>()
      .references(() => matterEventType.id),
    title: text("title").notNull(),
    description: text("description"),
    // What the firm asserts about the event. There is deliberately no fourth "missed" value: a
    // status says what a person recorded, and nothing in this platform derives one.
    status: text("status", { enum: ["scheduled", "occurred", "cancelled"] })
      .notNull()
      .default("scheduled"),
    startsOn: text("starts_on").notNull(), // civil date, YYYY-MM-DD
    startsAtTime: text("starts_at_time"), // HH:MM wall clock; null means all day, which is what a filing is
    endsOn: text("ends_on"), // null on a point event; set on a range, which is what a three-day trial is
    endsAtTime: text("ends_at_time"),
    // The IANA zone the wall-clock time is read in, REQUIRED. It lives on the row rather than on the
    // office because no property of the firm, the matter, or the office says which zone a hearing is
    // in: a Nevada firm appearing in a California court has a hearing in America/Los_Angeles. The
    // user interface defaults it from the matter's office and a person overrides it per row.
    timeZone: text("time_zone").notNull(),
    locationText: text("location_text"),
    courtReference: text("court_reference"),
    // When a person asserted this, as against when it happens. The custody-movement precedent: the
    // two diverge routinely, and collapsing them would make a hearing typed on Monday for a Friday
    // indistinguishable from one nobody recorded at all.
    recordedAt: text("recorded_at").notNull(),
    recordedBy: text("recorded_by").$type<UserId>(),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    // The matter timeline's filter, its sort, and its keyset predicate out of one composite.
    index("matter_event_matter_starts_on_id_index").on(table.matterId, table.startsOn, table.id),
    // The firm-wide date-ranged calendar read.
    index("matter_event_starts_on_id_index").on(table.startsOn, table.id),
    // "What is still scheduled" — filtered before it is sorted, so the filter column leads.
    index("matter_event_status_starts_on_index").on(table.status, table.startsOn),
    index("matter_event_type_index").on(table.eventTypeId),
    check("matter_event_title_check", sql`length(${table.title}) > 0`),
    check(
      "matter_event_status_check",
      sql`${table.status} IN ('scheduled', 'occurred', 'cancelled')`,
    ),
    check("matter_event_time_zone_check", sql`length(${table.timeZone}) > 0`),
    // A civil date is stored as a civil date. The shape check is what keeps an instant, a locale
    // rendering, or a naive local datetime out of a column the whole timeline sorts on as text.
    check(
      "matter_event_starts_on_shape_check",
      sql`${table.startsOn} GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'`,
    ),
    check(
      "matter_event_ends_on_shape_check",
      sql`${table.endsOn} IS NULL OR ${table.endsOn} GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'`,
    ),
    check(
      "matter_event_starts_at_time_shape_check",
      sql`${table.startsAtTime} IS NULL OR ${table.startsAtTime} GLOB '[0-2][0-9]:[0-5][0-9]'`,
    ),
    check(
      "matter_event_ends_at_time_shape_check",
      sql`${table.endsAtTime} IS NULL OR ${table.endsAtTime} GLOB '[0-2][0-9]:[0-5][0-9]'`,
    ),
    check(
      "matter_event_range_check",
      sql`${table.endsOn} IS NULL OR ${table.endsOn} >= ${table.startsOn}`,
    ),
    // An end time on an event with no start time says nothing anybody can render: "all day, until
    // half past four" is not a shape the calendar can draw or a person can act on.
    check(
      "matter_event_end_time_check",
      sql`${table.endsAtTime} IS NULL OR ${table.startsAtTime} IS NOT NULL`,
    ),
  ],
);

// Who was there, or will be. The three shapes that really occur are the three the custody ledger's
// borrower model already found, and the resolution is the same: a firm member, a Directory entity,
// or somebody external to both. A judge is an ordinary participant with the role "judge" — forcing
// one into the Directory as a prerequisite would pollute the conflicts corpus with people who are
// party to nothing, which is the argument the custody ledger makes about an external borrower.
//
// `role` is a short firm-supplied label (appearing counsel, judge, court reporter, witness,
// interpreter) and NOT a platform enum, for the reason the ownership role and the release-authority
// basis are free text: the vocabulary is jurisdiction-specific, no engine consumes it, and a closed
// set here would be this schema inventing procedure.
export const matterEventParticipant = sqliteTable(
  "matter_event_participant",
  {
    id: text("id").primaryKey().$type<MatterEventParticipantId>(), // matterEventParticipant_ handle
    eventId: text("event_id")
      .notNull()
      .$type<MatterEventId>()
      .references(() => matterEvent.id),
    participantKind: text("participant_kind", { enum: ["member", "entity", "external"] }).notNull(),
    memberUserId: text("member_user_id")
      .$type<UserId>()
      .references(() => member.userId),
    // A directoryPerson_/directoryOrganization_ handle, by value with no cross-domain foreign key
    // (the matter_party and custody_owner precedent).
    entityId: text("entity_id"),
    participantName: text("participant_name"),
    role: text("role"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    index("matter_event_participant_event_index").on(table.eventId),
    // "What is on this member's calendar" — the firm calendar's member filter, resolved as a
    // predicate rather than by reading every event and discarding most of them.
    index("matter_event_participant_member_index").on(table.memberUserId),
    index("matter_event_participant_entity_index").on(table.entityId),
    check(
      "matter_event_participant_kind_check",
      sql`${table.participantKind} IN ('member', 'entity', 'external')`,
    ),
    // A kind names which column carries the participant; a kind with no matching value is a record
    // that cannot answer the question it exists to answer (mirrors custody_movement's borrower shape).
    check(
      "matter_event_participant_shape_check",
      sql`(${table.participantKind} = 'member' AND ${table.memberUserId} IS NOT NULL)
        OR (${table.participantKind} = 'entity' AND ${table.entityId} IS NOT NULL)
        OR (${table.participantKind} = 'external' AND ${table.participantName} IS NOT NULL)`,
    ),
  ],
);

// A date the firm must do something by. It is NOT an event and collapsing the two would lose the two
// things that make a deadline a deadline: that it can be SATISFIED, and that it CAME FROM SOMEWHERE.
//
// Nothing in this platform computes a due date. No business-day arithmetic, no court-holiday
// calendar, no service-method offsets, no cascade when a trigger date moves, and no default deadline
// created when a matter opens. Missed deadlines are the largest single source of malpractice claims,
// and that cuts toward VISIBILITY and against ARITHMETIC: a computed deadline that is wrong is worse
// than none, because it will be trusted precisely because it was computed, and the firm that would
// have looked the rule up will not. `source`, `catalog_entry_key`, and `catalog_version` are the
// columns a verified jurisdiction-keyed catalog will one day write through a propose-and-confirm
// path — a member accepts a proposed date and that acceptance creates the row; the catalog never
// writes one by itself, and an existing row is never recomputed when the catalog changes. The
// columns land now because the alternative is rebuilding this table later.
//
// Overdue is DERIVED, never stored. A deadline past its due instant and still open is overdue,
// computed at read time (packages/calendar/src/overdue.ts). There is no sweep, no scheduled job, no
// state transition, and no column that says the firm failed — the platform reports what it can see
// and does not adjudicate, because the deadline may have been extended by a stipulation nobody has
// typed in, satisfied under another matter, or vacated by an order that arrived this morning.
export const matterDeadline = sqliteTable(
  "matter_deadline",
  {
    id: text("id").primaryKey().$type<MatterDeadlineId>(), // matterDeadline_ handle
    matterId: text("matter_id")
      .notNull()
      .$type<MatterId>()
      .references(() => matter.id),
    title: text("title").notNull(),
    dueOn: text("due_on").notNull(), // civil date, YYYY-MM-DD
    // Real and load-bearing: many filing deadlines are five in the afternoon, and one whose time
    // nobody recorded must not be silently rendered as midnight.
    dueAtTime: text("due_at_time"),
    // The COURT'S zone, not the office's. Required for the same reason it is required on an event.
    timeZone: text("time_zone").notNull(),
    source: text("source", { enum: ["member", "court_order", "statutory_catalog"] })
      .notNull()
      .default("member"),
    catalogEntryKey: text("catalog_entry_key"),
    catalogVersion: text("catalog_version"),
    // The rule, statute, or order the firm says this comes from. Not parsed, not validated, not
    // resolved against anything — it is the firm's own note of authority, and it is what a person
    // reads when deciding whether the date is right.
    authorityText: text("authority_text"),
    // The event that started the clock (the date of death, of service, of an order's entry). A LINK
    // and never a computation: nothing derives due_on from it, and moving the trigger event does not
    // move the deadline.
    triggerEventId: text("trigger_event_id")
      .$type<MatterEventId>()
      .references(() => matterEvent.id),
    state: text("state", { enum: ["open", "satisfied", "vacated", "superseded"] })
      .notNull()
      .default("open"),
    satisfiedAt: text("satisfied_at"), // UTC instant
    satisfiedBy: text("satisfied_by").$type<UserId>(),
    // The filing that discharged it, where the firm recorded one.
    satisfyingEventId: text("satisfying_event_id")
      .$type<MatterEventId>()
      .references(() => matterEvent.id),
    satisfactionNote: text("satisfaction_note"),
    // Required on vacated and superseded, because "why is this deadline no longer in force" is the
    // question a person asks six months later and the only bad answer is silence.
    stateReason: text("state_reason"),
    supersededByDeadlineId: text("superseded_by_deadline_id").$type<MatterDeadlineId>(),
    // A small firm-set ordinal, and never a platform judgement about severity.
    priority: integer("priority"),
    recordedAt: text("recorded_at").notNull(),
    recordedBy: text("recorded_by").$type<UserId>(),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    // The upcoming-deadlines read: filtered by state before it is sorted by due date, so the filter
    // column leads and one composite serves the filter, the ascending sort, and the keyset predicate.
    index("matter_deadline_state_due_on_id_index").on(table.state, table.dueOn, table.id),
    // The matter's own deadline list and the timeline merge.
    index("matter_deadline_matter_due_on_id_index").on(table.matterId, table.dueOn, table.id),
    index("matter_deadline_trigger_event_index").on(table.triggerEventId),
    check("matter_deadline_title_check", sql`length(${table.title}) > 0`),
    check("matter_deadline_time_zone_check", sql`length(${table.timeZone}) > 0`),
    check(
      "matter_deadline_due_on_shape_check",
      sql`${table.dueOn} GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'`,
    ),
    check(
      "matter_deadline_due_at_time_shape_check",
      sql`${table.dueAtTime} IS NULL OR ${table.dueAtTime} GLOB '[0-2][0-9]:[0-5][0-9]'`,
    ),
    check(
      "matter_deadline_source_check",
      sql`${table.source} IN ('member', 'court_order', 'statutory_catalog')`,
    ),
    // A catalog key and version belong to a catalog-sourced deadline and to nothing else: a member's
    // own date carrying a catalog entry key would claim an authority nobody verified.
    check(
      "matter_deadline_catalog_shape_check",
      sql`(${table.source} = 'statutory_catalog' AND ${table.catalogEntryKey} IS NOT NULL AND ${table.catalogVersion} IS NOT NULL)
        OR (${table.source} <> 'statutory_catalog' AND ${table.catalogEntryKey} IS NULL AND ${table.catalogVersion} IS NULL)`,
    ),
    check(
      "matter_deadline_state_check",
      sql`${table.state} IN ('open', 'satisfied', 'vacated', 'superseded')`,
    ),
    check(
      "matter_deadline_state_reason_check",
      sql`${table.state} NOT IN ('vacated', 'superseded') OR (${table.stateReason} IS NOT NULL AND length(${table.stateReason}) > 0)`,
    ),
    // A satisfied deadline names who discharged it and when; an unsatisfied one claims neither.
    check(
      "matter_deadline_satisfaction_shape_check",
      sql`(${table.state} = 'satisfied' AND ${table.satisfiedAt} IS NOT NULL AND ${table.satisfiedBy} IS NOT NULL)
        OR (${table.state} <> 'satisfied' AND ${table.satisfiedAt} IS NULL AND ${table.satisfiedBy} IS NULL)`,
    ),
    check(
      "matter_deadline_superseded_shape_check",
      sql`(${table.supersededByDeadlineId} IS NULL) OR (${table.state} = 'superseded')`,
    ),
    check(
      "matter_deadline_priority_check",
      sql`${table.priority} IS NULL OR ${table.priority} > 0`,
    ),
  ],
);

// ---------------------------------------------------------------------------------------------
// Matter assets — the register of what a client or an estate owns.
//
// An asset row is ONE MATTER'S ASSERTION about one thing owned, and every number on it is dated.
// Both halves are structural. matter_id is NOT NULL because the same house is a different record in
// the husband's divorce and in his mother's estate: different valuation dates, different
// encumbrances, different disposition, different privilege. A cross-matter "thing" identity would
// have to reconcile those, and reconciling them is how one matter's numbers leak into another.
// Carrying an asset forward from a prior matter is a copy with recorded provenance, never a shared
// row. And there is NO current-value column on any table here — the append-only valuation history
// below is the whole of what an asset is worth.
//
// The boundary with Custodian, which is the question a reader arrives with: Custodian describes
// OBJECTS IN THE FIRM'S POSSESSION (where the paper deed is, who last touched it); the asset
// register describes PROPERTY IN THE CLIENT'S OWNERSHIP (what land the deed describes, what it was
// worth at the date of death). They overlap on a minority of rows, are joined by one nullable
// column, and neither copies a fact from the other.

// The per-firm asset-type catalog, sitting UNDER the platform class. The class is a closed enum
// because it decides which structured attribute table exists, which merge subject the row appears
// under, and which column a search hits — a firm cannot mint the concept "has a parcel number",
// which is a schema fact with a table, an index, and a report column behind it. The type is where
// the long tail lives without a schema change: single-family residence, condominium, timeshare and
// mineral interest under realProperty; checking, brokerage and individual retirement account under
// financialAccount. Seeded on provisioning, extended by the firm, soft-deactivated and never deleted
// (every asset already classified under it keeps its meaning) — the custody_item_type and
// document_type shape exactly.
//
// The invariant the write path enforces: an asset's type must belong to the asset's class. A firm
// that wants a retirement account under `vehicle` is making a data-entry error, not expressing a
// preference.
export const matterAssetType = sqliteTable(
  "matter_asset_type",
  {
    id: text("id").primaryKey().$type<MatterAssetTypeId>(), // matterAssetType_ handle
    name: text("name").notNull(),
    class: text("class", {
      enum: [
        "realProperty",
        "financialAccount",
        "vehicle",
        "firearm",
        "businessInterest",
        "insurancePolicy",
        "receivable",
        "digitalAsset",
        "personalProperty",
        "other",
      ],
    }).notNull(),
    code: text("code"),
    active: integer("active", { mode: "boolean" }).notNull().default(true),
    // The firm's own ordering within a class, so a picker lists the common kinds first.
    position: integer("position").notNull().default(0),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("matter_asset_type_name_unique_index").on(table.name),
    uniqueIndex("matter_asset_type_code_unique_index").on(table.code),
    // The picker read: everything under one class, in the firm's order.
    index("matter_asset_type_class_position_index").on(table.class, table.position),
    check("matter_asset_type_name_check", sql`length(${table.name}) > 0`),
    check(
      "matter_asset_type_class_check",
      sql`${table.class} IN ('realProperty', 'financialAccount', 'vehicle', 'firearm', 'businessInterest', 'insurancePolicy', 'receivable', 'digitalAsset', 'personalProperty', 'other')`,
    ),
  ],
);

// The core asset row. ONLY TWO FIELDS ARE REQUIRED — the class and a description — which is the
// deliberate inversion of Custodian's mandatory owner link. There, orphan prevention is structural
// because an unattributable original is the catastrophe. Here the catastrophe is a register nobody
// fills in, and every required attribute is a reason to keep the list in a spreadsheet instead. A row
// that says personalProperty / "contents of the garage, not yet itemized" is a useful row.
//
// The CLASS IS FROZEN at creation. A class change is a delete-and-recreate wearing an update: it
// orphans the attribute row and moves the asset to a different merge subject. The answer to a
// mis-classed row is to delete it and add it again, which is cheap because the row is minutes old and
// soft delete already exists — so freezing costs nothing and removes a whole family of
// partial-migration states.
//
// estate_treatment is ASSERTED BY A PERSON, NEVER DERIVED. Whether a jointly held house passes
// outside probate turns on the form of co-ownership, which is jurisdiction-specific, unevenly named,
// and the single fact this register most refuses to infer: encoding "joint tenancy means non-probate"
// would be right in most states and catastrophic in the ones where it is not, on the one document a
// court reads. `undetermined` is the default and is reported as its own group rather than merged away.
//
// The PRICE of a sale is deliberately not a column: it is a valuation row with basis `sale`, so the
// history tells the whole story and there is one home for every number.
export const matterAsset = sqliteTable(
  "matter_asset",
  {
    id: text("id").primaryKey().$type<MatterAssetId>(), // matterAsset_ handle
    matterId: text("matter_id")
      .notNull()
      .$type<MatterId>()
      .references(() => matter.id),
    class: text("class", {
      enum: [
        "realProperty",
        "financialAccount",
        "vehicle",
        "firearm",
        "businessInterest",
        "insurancePolicy",
        "receivable",
        "digitalAsset",
        "personalProperty",
        "other",
      ],
    }).notNull(),
    assetTypeId: text("asset_type_id")
      .$type<MatterAssetTypeId>()
      .references(() => matterAssetType.id),
    description: text("description").notNull(),
    acquiredOn: text("acquired_on"), // civil date
    estateTreatment: text("estate_treatment", {
      enum: ["probateEstate", "nonProbateTransfer", "undetermined"],
    })
      .notNull()
      .default("undetermined"),
    disposition: text("disposition", {
      enum: ["retained", "sold", "transferred", "distributed", "abandoned", "lost"],
    })
      .notNull()
      .default("retained"),
    dispositionOn: text("disposition_on"), // civil date
    // The custody item that holds this thing, where the firm holds it at all. Points at an ITEM
    // rather than a packet because the item is Custodian's unit of description. NO UNIQUE INDEX: the
    // same held object can be scheduled in two matters (the decedent's estate and the related
    // trust), and forbidding that would force a firm to unlink to get past a constraint, which is how
    // a link stops being trustworthy. The asset copies no location, status, or movement history from
    // it, and Custodian copies no valuation back — a detail view that wants either reads the other
    // subsystem. Set and cleared through the patch route in slice 4·3·3.
    custodyItemId: text("custody_item_id")
      .$type<CustodyItemId>()
      .references(() => custodyItem.id),
    notes: text("notes"),
    createdAt: text("created_at").notNull(),
    createdBy: text("created_by").$type<UserId>(),
    updatedAt: text("updated_at").notNull(),
    deletedAt: text("deleted_at"),
  },
  (table) => [
    // The matter's register list, filtered by class and keyset-walked newest first. The filter
    // columns lead so one composite serves the filter, the sort, and the cursor predicate.
    index("matter_asset_matter_class_created_id_index").on(
      table.matterId,
      table.class,
      table.createdAt,
      table.id,
    ),
    index("matter_asset_type_index").on(table.assetTypeId),
    check("matter_asset_description_check", sql`length(${table.description}) > 0`),
    check(
      "matter_asset_class_check",
      sql`${table.class} IN ('realProperty', 'financialAccount', 'vehicle', 'firearm', 'businessInterest', 'insurancePolicy', 'receivable', 'digitalAsset', 'personalProperty', 'other')`,
    ),
    check(
      "matter_asset_estate_treatment_check",
      sql`${table.estateTreatment} IN ('probateEstate', 'nonProbateTransfer', 'undetermined')`,
    ),
    check(
      "matter_asset_disposition_check",
      sql`${table.disposition} IN ('retained', 'sold', 'transferred', 'distributed', 'abandoned', 'lost')`,
    ),
  ],
);

// Real property's structured attributes, one-to-one on the asset. A class with structure gets its own
// table rather than nullable columns on matter_asset (which would let a vehicle carry a parcel
// number) or a generic attribute bag (which re-implements custom fields and makes "find the property
// with this parcel number" a scan over strings).
//
// The column names match `PropertyReference` in @magna-carta/property-links exactly (its `apn` is
// carried here as `parcel_number` under the full-names rule, mapped at the boundary). That is not
// cosmetic: it means a real-property asset renders assessor, mapping, and listing-site lookups today
// through that package with no new code, no credential, and no adapter.
//
// The parcel number is PLAINTEXT AND INDEXED because it appears on the assessor's public roll, and
// searching by it is the point. That is the whole line this subsystem draws: an identifier on a
// public record is an ordinary searchable column, and an identifier that functions as a
// credential-adjacent secret lives in matter_asset_identifier as ciphertext.
export const matterAssetRealProperty = sqliteTable(
  "matter_asset_real_property",
  {
    assetId: text("asset_id")
      .primaryKey()
      .$type<MatterAssetId>()
      .references(() => matterAsset.id),
    street: text("street"),
    city: text("city"),
    region: text("region"),
    postal: text("postal"),
    county: text("county"),
    parcelNumber: text("parcel_number"),
    legalDescription: text("legal_description"),
    recordingReference: text("recording_reference"),
  },
  (table) => [
    index("matter_asset_real_property_parcel_index").on(table.parcelNumber),
    index("matter_asset_real_property_region_city_index").on(table.region, table.city),
  ],
);

// A financial account's structured attributes, one-to-one on the asset. The ACCOUNT NUMBER IS NOT
// HERE: a full account number is a credential-adjacent secret, so it lives in
// matter_asset_identifier as ciphertext with its last four characters beside it, and every list,
// schedule, and merge field reads the suffix. Keeping the suffix on the identifier row rather than
// here means one home for the fact and no plaintext fragment that has to stay in step with a
// ciphertext somewhere else.
export const matterAssetFinancialAccount = sqliteTable(
  "matter_asset_financial_account",
  {
    assetId: text("asset_id")
      .primaryKey()
      .$type<MatterAssetId>()
      .references(() => matterAsset.id),
    institutionName: text("institution_name"),
    // An optional directoryOrganization_ handle, by value with no cross-domain foreign key (the
    // matter_party and custody_owner precedent).
    institutionOrganizationId: text("institution_organization_id"),
  },
  (table) => [
    index("matter_asset_financial_account_institution_index").on(table.institutionOrganizationId),
  ],
);

// The append-only valuation history — the register's second structural invariant. A VALUATION IS
// APPENDED, NEVER UPDATED AND NEVER DELETED, and there is no current-value column anywhere.
//
// An estate needs the date-of-death value and today's value and, in a long administration, several in
// between; a family-law matter needs date-of-marriage and date-of-separation values for the same
// house. One mutable number cannot answer two of those questions, and a number editable after a
// schedule was filed means the register and the filed document can silently disagree with nobody able
// to say when they diverged. A typo is corrected by a COMPENSATING ROW carrying
// corrects_valuation_id, which supersedes the corrected row in every read — the same discipline the
// financial ledger applies to a mis-posted entry and the custody ledger to a mis-recorded movement.
// The RAISE(ABORT) triggers that make that a guarantee rather than a convention are in the
// hand-written migration, because drizzle-kit cannot model a trigger.
//
// as_of_date and recorded_at are separate for the reason the custody ledger separates occurred_at
// from recorded_at: an appraisal dated the day of death is typed in four months later, and collapsing
// the two makes back-dating either impossible or indistinguishable from falsification. Reports read
// as_of_date; recorded_at proves when the assertion was made.
//
// `basis` is a CLOSED platform vocabulary, unlike the type catalog, because it is read by reports, by
// merge fields, and eventually by a court — a firm inventing its own basis is not a capability anyone
// wants. `sale` is how a disposition's price enters, so there is one home for every number.
// `automatedEstimate` exists with nothing writing it, so an external valuation adapter has a truthful
// basis to write and can never masquerade as an appraisal.
export const matterAssetValuation = sqliteTable(
  "matter_asset_valuation",
  {
    id: text("id").primaryKey().$type<MatterAssetValuationId>(), // matterAssetValuation_ handle
    assetId: text("asset_id")
      .notNull()
      .$type<MatterAssetId>()
      .references(() => matterAsset.id),
    // When set, the row is that ENCUMBRANCE's balance as of a date rather than the asset's value as
    // of a date — one append-only table, one trigger set, one as-of query shape, and net equity as one
    // read with a sign flip. Declared now and unused until the encumbrance table lands in slice 4·3·2;
    // adding it later would mean rebuilding a table whose triggers have to be dropped to do it.
    encumbranceId: text("encumbrance_id"),
    asOfDate: text("as_of_date").notNull(), // civil date — the date the figure speaks to
    amountMinor: integer("amount_minor"),
    currency: text("currency"),
    basis: text("basis", {
      enum: [
        "appraisal",
        "statement",
        "taxAssessment",
        "marketQuote",
        "guideBook",
        "broker",
        "sale",
        "purchasePrice",
        "courtDetermined",
        "clientEstimate",
        "automatedEstimate",
      ],
    }).notNull(),
    sourceNote: text("source_note"),
    // The appraisal, statement, or bill of sale behind the figure — an ordinary matter file. A
    // valuation whose support is in the file is worth more than one that is not, and this is the
    // cheapest possible way to say so.
    supportingFileId: text("supporting_file_id")
      .$type<FileId>()
      .references(() => file.id),
    // The row this one corrects. No foreign key, exactly as custody_movement.corrects_movement_id has
    // none: an append-only ledger carries no referential dependency, and keeping it that way is what
    // lets the table be rebuilt if its vocabulary ever widens.
    correctsValuationId: text("corrects_valuation_id").$type<MatterAssetValuationId>(),
    recordedBy: text("recorded_by").$type<UserId>(),
    recordedAt: text("recorded_at").notNull(),
  },
  (table) => [
    // THE characteristic read: for one asset, the latest as_of_date at or before a requested date,
    // newest recording winning a tie. Declared ascending because SQLite walks an ascending index
    // backwards at the same cost, so one composite serves both directions.
    index("matter_asset_valuation_asset_as_of_index").on(
      table.assetId,
      table.asOfDate,
      table.recordedAt,
    ),
    index("matter_asset_valuation_corrects_index").on(table.correctsValuationId),
    check(
      "matter_asset_valuation_as_of_shape_check",
      sql`${table.asOfDate} GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'`,
    ),
    // An amount with no currency cannot be interpreted, and a currency with no amount says nothing.
    // Money is minor units plus a currency, never a float, and no total is ever computed across two.
    check(
      "matter_asset_valuation_amount_shape_check",
      sql`(${table.amountMinor} IS NULL) = (${table.currency} IS NULL)`,
    ),
    check(
      "matter_asset_valuation_basis_check",
      sql`${table.basis} IN ('appraisal', 'statement', 'taxAssessment', 'marketQuote', 'guideBook', 'broker', 'sale', 'purchasePrice', 'courtDetermined', 'clientEstimate', 'automatedEstimate')`,
    ),
  ],
);

// Who holds an interest in the asset. THE OWNER LINK IS OPTIONAL HERE and mandatory in Custodian, and
// the inversion is deliberate: a custody packet with no owner is an orphan nobody can release, while
// an asset with no recorded interest is simply an asset of the matter — the common case for an estate
// where everything is the decedent's. Interests are for the exceptions (the jointly held house, the
// part-owned business, the account with a named beneficiary), and forcing a row for the common case
// would be friction with no failure behind it.
//
// interest_role is a FIRM-CONFIGURABLE LABEL validated against the firm's own catalog rather than a
// closed platform enum, exactly as the custody ownership role is and for the same reason: tenancy
// forms are jurisdiction-specific and unevenly named, and the platform has no engine that consumes
// them, so a closed vocabulary would be false precision a later engine has to migrate away from.
//
// A fractional share is a RATIONAL NUMBER, not a decimal, because one third is not representable as
// one and three siblings whose shares sum to less than the whole on a court filing is a defect the
// schema should make impossible rather than a rounding note. Both parts null means the share is
// unstated, which is different from zero. Ending an interest writes a date; no row ever disappears.
export const matterAssetInterest = sqliteTable(
  "matter_asset_interest",
  {
    id: text("id").primaryKey().$type<MatterAssetInterestId>(), // matterAssetInterest_ handle
    assetId: text("asset_id")
      .notNull()
      .$type<MatterAssetId>()
      .references(() => matterAsset.id),
    // A directoryPerson_/directoryOrganization_ handle, by value with no cross-domain foreign key
    // (the matter_party and custody_owner precedent).
    entityId: text("entity_id").notNull(),
    interestRole: text("interest_role"),
    shareNumerator: integer("share_numerator"),
    shareDenominator: integer("share_denominator"),
    effectiveFrom: text("effective_from").notNull(),
    effectiveTo: text("effective_to"), // null while the interest is current
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    index("matter_asset_interest_asset_index").on(table.assetId),
    // The one read that spans matters: what does this person hold an interest in.
    index("matter_asset_interest_entity_index").on(table.entityId, table.effectiveTo),
    check(
      "matter_asset_interest_share_shape_check",
      sql`(${table.shareNumerator} IS NULL) = (${table.shareDenominator} IS NULL)`,
    ),
    check(
      "matter_asset_interest_share_denominator_check",
      sql`${table.shareDenominator} IS NULL OR ${table.shareDenominator} > 0`,
    ),
  ],
);

// The document link — the association the owner asked for first. A link over ordinary File Manager
// files, and simpler here than the custody_scan it reuses, which is a direct dividend of
// matter-rooting: Custodian had to solve `file.matter_id NOT NULL` against a packet that may have no
// matter. An asset always has a matter, so its documents are ordinary matter documents in an ordinary
// matter folder. A deed attached to a house is still in the matter's file list, still previewable,
// still convertible, still under any legal hold, still in discovery — it gained an association and
// lost nothing. Bytes never reach an asset route: upload is the File Manager's presigned-upload and
// quarantine chokepoint, and this row links the resulting handle.
//
// MANY-TO-MANY, and the divergence from custody_scan's unique index on file_id is deliberate: one
// brokerage statement lists four accounts, one appraisal covers a house and its contents, one
// photograph shows a room of furniture. Requiring a file to belong to one asset would force a firm to
// upload the same statement four times, which is how a link stops being used. Do not "fix" it.
export const matterAssetDocument = sqliteTable(
  "matter_asset_document",
  {
    id: text("id").primaryKey().$type<MatterAssetDocumentId>(), // matterAssetDocument_ handle
    assetId: text("asset_id")
      .notNull()
      .$type<MatterAssetId>()
      .references(() => matterAsset.id),
    fileId: text("file_id")
      .notNull()
      .$type<FileId>()
      .references(() => file.id),
    kind: text("kind", {
      enum: [
        "deed",
        "title",
        "statement",
        "appraisal",
        "policy",
        "registration",
        "billOfSale",
        "photograph",
        "correspondence",
        "other",
      ],
    }).notNull(),
    note: text("note"),
    linkedAt: text("linked_at").notNull(),
    linkedBy: text("linked_by").$type<UserId>(),
  },
  (table) => [
    index("matter_asset_document_asset_index").on(table.assetId),
    // The reverse read: which assets does this file evidence. Not unique — see the table comment.
    index("matter_asset_document_file_index").on(table.fileId),
    check(
      "matter_asset_document_kind_check",
      sql`${table.kind} IN ('deed', 'title', 'statement', 'appraisal', 'policy', 'registration', 'billOfSale', 'photograph', 'correspondence', 'other')`,
    ),
  ],
);

// A credential-adjacent identifier: a full account, policy, certificate, or tax number. The line this
// table draws, stated once: AN IDENTIFIER THAT APPEARS ON A PUBLIC RECORD IS AN ORDINARY SEARCHABLE
// COLUMN (a parcel number, a vehicle identification number, a plate, a firearm serial — all of them
// on a title, a roll, or transfer paperwork, and all of them things a person searches by). AN
// IDENTIFIER THAT FUNCTIONS AS A CREDENTIAL-ADJACENT SECRET lives here as ciphertext, with only its
// last four characters readable without a decrypt.
//
// value_ciphertext is registered in protected-columns.ts and reaches the world only through the
// data-access protected-field chokepoint: encrypted on write, permission-checked and audited on read.
// Every list, detail, schedule, and merge field reads `display_suffix` and nothing else, so the full
// value has exactly one read path and it is a deliberate act with an audit row.
//
// value_ciphertext is NULLABLE: a firm may record no full number at all, and display_suffix alone is
// a complete and often preferable record. The register never asks for the whole number to function.
//
// NO COLUMN HERE HOLDS A CREDENTIAL — no password, passphrase, seed or recovery phrase, private key,
// personal identification number, or safe combination, in plaintext or protected. A protected column
// is decryptable by any member holding the decrypt permission, and for a self-custodied digital asset
// the seed phrase IS the asset: whoever reads it can take it, irreversibly, with no record. Storing
// one would convert a records system into a bearer instrument. The write path refuses a request that
// names one with its own problem type, and the documented answer is the one the platform already has
// — a sealed envelope in the custody register, where a physical object has a location, a hold, and an
// append-only record of every hand it has passed through.
export const matterAssetIdentifier = sqliteTable(
  "matter_asset_identifier",
  {
    id: text("id").primaryKey().$type<MatterAssetIdentifierId>(), // matterAssetIdentifier_ handle
    assetId: text("asset_id")
      .notNull()
      .$type<MatterAssetId>()
      .references(() => matterAsset.id),
    kind: text("kind", {
      enum: ["accountNumber", "policyNumber", "certificateNumber", "taxIdentifier", "other"],
    }).notNull(),
    // At most four characters, plaintext, and the ONLY part of the value any ordinary read returns.
    displaySuffix: text("display_suffix"),
    valueCiphertext: text("value_ciphertext"),
    createdAt: text("created_at").notNull(),
    createdBy: text("created_by").$type<UserId>(),
  },
  (table) => [
    index("matter_asset_identifier_asset_index").on(table.assetId),
    check(
      "matter_asset_identifier_kind_check",
      sql`${table.kind} IN ('accountNumber', 'policyNumber', 'certificateNumber', 'taxIdentifier', 'other')`,
    ),
    check(
      "matter_asset_identifier_suffix_length_check",
      sql`${table.displaySuffix} IS NULL OR length(${table.displaySuffix}) <= 4`,
    ),
    // A row that carries neither a suffix nor a sealed value records nothing at all.
    check(
      "matter_asset_identifier_presence_check",
      sql`${table.displaySuffix} IS NOT NULL OR ${table.valueCiphertext} IS NOT NULL`,
    ),
  ],
);

// Magnus — the conversational assistant. Three tables, and the shape of them IS the retention
// posture: a transcript is the firm's own WORK PRODUCT — protected, deletable, archivable — kept in
// the firm's own database under the firm-scoped data-access layer, not ephemeral state in some
// object's storage. There is exactly one copy of a transcript and the push transport is a view of it.
// It is discoverable in the way email is, which is why any surface that searches across the firm's
// records has to let a firm say whether transcripts are in scope rather than sweeping them in
// silently; that control belongs to the discovery surface, not to these tables.

// One conversation. The title is member-supplied ONLY — a model-generated title would be a model call
// over privileged content producing a second copy of it in a column that surfaces in every list, so a
// conversation with no title displays by its start instant instead.
export const magnusConversation = sqliteTable(
  "magnus_conversation",
  {
    id: text("id").primaryKey().$type<MagnusConversationId>(), // magnusConversation_ handle
    title: text("title"),
    // The member. Never null — there is no system-originated conversation. Not a foreign key, for the
    // same reason audit_log's actor is not: the record outlives the member row.
    createdBy: text("created_by").notNull().$type<UserId>(),
    // Scopes the RECORD, not the prompt. A matter link puts none of that matter's content into any
    // request; it answers which matter's file this transcript belongs to, which is a retention and
    // access question. Nullable and present from day one because backfilling the association from
    // memory later is impossible.
    matterId: text("matter_id").$type<MatterId>(),
    state: text("state", { enum: ["active", "archived", "deleted"] })
      .notNull()
      .default("active"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
    deletedAt: text("deleted_at"),
  },
  (table) => [
    // The member's own list — the read every session makes — walks this index rather than the firm's
    // every conversation.
    index("magnus_conversation_created_by_index").on(table.createdBy, table.createdAt),
    index("magnus_conversation_matter_index").on(table.matterId),
    check(
      "magnus_conversation_state_check",
      sql`${table.state} IN ('active', 'archived', 'deleted')`,
    ),
  ],
);

// One message, from either speaker. ONE table rather than two, because the ordering between the two
// speakers IS the record and two tables would need a merge to reconstruct it.
//
// `content` is TEXT and nullable: a Magnus turn is pending before it has anything to say. It is
// inline in D1 rather than in R2 because the per-turn caps in @magna-carta/magnus's limits module are
// what keep a turn from being bulk; the R2 escalation is a named seam, not a built one.
export const magnusTurn = sqliteTable(
  "magnus_turn",
  {
    id: text("id").primaryKey().$type<MagnusTurnId>(), // magnusTurn_ handle
    conversationId: text("conversation_id")
      .notNull()
      .$type<MagnusConversationId>()
      .references(() => magnusConversation.id),
    // Monotonic within the conversation. Ordering is explicit and never inferred from a timestamp two
    // rows can share; the UNIQUE below is what arbitrates a race between two submissions.
    sequence: integer("sequence").notNull(),
    speaker: text("speaker", { enum: ["member", "magnus"] }).notNull(),
    content: text("content"),
    status: text("status", { enum: ["pending", "complete", "failed", "refused"] }).notNull(),
    // A closed label, NEVER an upstream body. Null unless the turn failed or was refused.
    failureLabel: text("failure_label", {
      enum: ["model-unavailable", "not-eligible", "ceiling-reached", "too-large", "cancelled"],
    }),
    // Null on a member turn; recorded on every settled Magnus turn — the provenance answer to "what
    // produced this", which is what makes a specific answer traceable to a specific model version a
    // year later.
    modelId: text("model_id"),
    snapshotId: text("snapshot_id"),
    // Null on a member turn; set on completion from the inference RESPONSE, never from gateway logs.
    inputTokens: integer("input_tokens"),
    outputTokens: integer("output_tokens"),
    // Whether earlier turns did not fit the bounded request window, so this answer was built on part
    // of the conversation. Recorded and surfaced rather than hidden: silent truncation is what
    // produces a confidently wrong answer built on a premise the member believes was in scope.
    contextTruncated: integer("context_truncated", { mode: "boolean" }).notNull().default(false),
    createdAt: text("created_at").notNull(),
    completedAt: text("completed_at"),
  },
  (table) => [
    uniqueIndex("magnus_turn_conversation_sequence_unique").on(
      table.conversationId,
      table.sequence,
    ),
    // The firm's daily turn ceiling counts member turns over a date range; without this it is a scan
    // of every turn the firm has ever taken, on the hot path of every submission.
    index("magnus_turn_created_at_index").on(table.createdAt),
    check("magnus_turn_speaker_check", sql`${table.speaker} IN ('member', 'magnus')`),
    check(
      "magnus_turn_status_check",
      sql`${table.status} IN ('pending', 'complete', 'failed', 'refused')`,
    ),
    check(
      "magnus_turn_failure_label_check",
      sql`${table.failureLabel} IS NULL OR ${table.failureLabel} IN ('model-unavailable', 'not-eligible', 'ceiling-reached', 'too-large', 'cancelled')`,
    ),
  ],
);

// One row per member who has accepted the disclosure. The version column is the whole point of the
// table: when the disclosure changes because Magnus gains a capability, every member's stored version
// stops matching the current constant and every member is re-prompted automatically. An
// acknowledgement without a version is an acknowledgement of an unknown thing.
export const magnusMemberAcknowledgement = sqliteTable("magnus_member_acknowledgement", {
  userId: text("user_id").primaryKey().$type<UserId>(),
  disclosureVersion: integer("disclosure_version").notNull(),
  acknowledgedAt: text("acknowledged_at").notNull(),
});

// ---------------------------------------------------------------------------------------------
// Discovery — the corpus of documents under review on a matter.
//
// Six tables, and the shape of them is the defensibility posture. Nothing enters without a record
// (every review document names its load; every load names its source, its operator, and its time).
// Nothing is dropped silently (two terminal processing states, a named code for every non-success,
// and counts that must reconcile before a load may complete). Nothing is altered (a review document
// is a POINTER — it holds no bytes and copies none). Attribution survives deduplication (a duplicate
// keeps its row and gains an occurrence naming its record custodian and its load).
//
// `review_set_id` leads the index on every one of them, because every read is "within this review
// set" and the review-document table is about to be the largest in the firm's database by an order of
// magnitude — the only table in the platform whose size is set by an outside party.
//
// The word "custodian" is never alone here. The physical safekeeping register keeps `custody*`; this
// is the RECORD CUSTODIAN — whose electronic records these were — and the two appear in the same
// matter. Two words, always.

// One named corpus under review, belonging to one matter. A matter may have several: the firm's own
// collection, a production received in March, a second request.
export const reviewSet = sqliteTable(
  "review_set",
  {
    id: text("id").primaryKey().$type<ReviewSetId>(), // reviewSet_ handle
    matterId: text("matter_id")
      .notNull()
      .$type<MatterId>()
      .references(() => matter.id),
    name: text("name").notNull(),
    // Forward-only, enforced by trigger as well as by this CHECK: `locked` refuses new loads and
    // serves every read, `closed` additionally releases the derived artifacts for collection. There
    // is no reopen. Closing destroys a derived cache and never a record.
    state: text("state", { enum: ["open", "locked", "closed"] })
      .notNull()
      .default("open"),
    // Snapshotted from the firm's setting at creation rather than read live, so a firm that lowers
    // its ceiling does not retroactively make an existing review set invalid.
    documentCeiling: integer("document_ceiling").notNull(),
    // The maintained count the ceiling is checked against. A COUNT(*) over a quarter-million review
    // documents on the hot path of every load declaration is not a read; this is written in the same
    // batch as the rows it counts.
    documentCount: integer("document_count").notNull().default(0),
    // Embedding a large corpus is a real metered cost incurred whether or not anyone ever runs a
    // semantic query, so it is OFF until a firm chooses it for this corpus. The keyword half is
    // always on — exact terms, phrases, proximity and boolean are what e-discovery actually runs on.
    semanticIndexEnabled: integer("semantic_index_enabled", { mode: "boolean" })
      .notNull()
      .default(false),
    createdBy: text("created_by").notNull().$type<UserId>(), // not an FK — the record outlives the member row
    lockedAt: text("locked_at"),
    closedAt: text("closed_at"),
    // When the derived artifacts were released for collection. Distinct from closed_at because the
    // sweep is asynchronous, and "closed but not yet swept" is a real state a firm can be in.
    derivedArtifactsReleasedAt: text("derived_artifacts_released_at"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("review_set_matter_name_unique_index").on(table.matterId, table.name),
    index("review_set_matter_created_index").on(table.matterId, table.createdAt, table.id),
    check("review_set_state_check", sql`${table.state} IN ('open', 'locked', 'closed')`),
    check("review_set_name_nonempty_check", sql`length(${table.name}) > 0`),
    check("review_set_ceiling_positive_check", sql`${table.documentCeiling} > 0`),
    check("review_set_document_count_nonnegative_check", sql`${table.documentCount} >= 0`),
  ],
);

// Whose records these were. Review-set-scoped rather than firm-scoped on purpose: "John Smith,
// custodian" in one matter is not assertably the same person as in another, and asserting it wrongly
// is a defensibility problem rather than a data-modelling inconvenience.
export const recordCustodian = sqliteTable(
  "record_custodian",
  {
    id: text("id").primaryKey().$type<RecordCustodianId>(), // recordCustodian_ handle
    reviewSetId: text("review_set_id")
      .notNull()
      .$type<ReviewSetId>()
      .references(() => reviewSet.id),
    displayName: text("display_name").notNull(),
    // Usually a Directory entity — but a production may name a person the firm has never met, so the
    // link is nullable and FK-free (the matter_party precedent: it points into the Directory graph by
    // value, with no cross-domain foreign key).
    directoryEntityId: text("directory_entity_id"),
    // `unattributed` is a first-class kind rather than a null: a production that arrives with no
    // custodial attribution is a fact about the production, and recording it is a different statement
    // from leaving a column empty.
    kind: text("kind", { enum: ["person", "organization", "unattributed"] }).notNull(),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("record_custodian_review_set_name_unique_index").on(
      table.reviewSetId,
      table.displayName,
    ),
    index("record_custodian_directory_entity_index").on(table.directoryEntityId),
    check(
      "record_custodian_kind_check",
      sql`${table.kind} IN ('person', 'organization', 'unattributed')`,
    ),
    check("record_custodian_name_nonempty_check", sql`length(${table.displayName}) > 0`),
  ],
);

// One recorded act of putting material into a review set — the unit of provenance, the unit of
// resumability, and what the manifest describes. Loads are append-only: a load is never edited, only
// superseded or reversed by an explicit removal that is itself recorded.
export const discoveryLoad = sqliteTable(
  "discovery_load",
  {
    id: text("id").primaryKey().$type<DiscoveryLoadId>(), // discoveryLoad_ handle
    reviewSetId: text("review_set_id")
      .notNull()
      .$type<ReviewSetId>()
      .references(() => reviewSet.id),
    lane: text("lane", {
      enum: ["internal-files", "internal-email", "received-production", "direct-collection"],
    }).notNull(),
    state: text("state", {
      enum: ["declared", "loading", "processing", "complete", "failed", "reversed"],
    })
      .notNull()
      .default("declared"),
    // WHETHER ASSISTANT TRANSCRIPTS WERE IN SCOPE, stated by a person at declaration. Required, with
    // no default in the column and none in the contract above it: a transcript is the firm's own work
    // product, and whether the firm's own reasoning about a matter belongs in a corpus is a decision
    // somebody makes visibly. It is recorded here rather than inferred from what arrived, so the
    // manifest can state what the corpus was DRAWN FROM and not only what landed in it.
    transcriptScope: text("transcript_scope", { enum: ["exclude", "include"] }).notNull(),
    // The reconciliation. `loaded_document_count` must equal `processed_count + exception_count`
    // before a load may reach `complete`, and the CHECK below is what makes that structural rather
    // than a convention a second write path could miss.
    declaredDocumentCount: integer("declared_document_count").notNull().default(0),
    loadedDocumentCount: integer("loaded_document_count").notNull().default(0),
    processedCount: integer("processed_count").notNull().default(0),
    exceptionCount: integer("exception_count").notNull().default(0),
    // Set when one load carries one custodian's material. Null means attribution is per document,
    // which is the ordinary case for a production carrying several custodians' records.
    defaultRecordCustodianId: text("default_record_custodian_id")
      .$type<RecordCustodianId>()
      .references(() => recordCustodian.id),
    sourceDescription: text("source_description"),
    initiatedBy: text("initiated_by").notNull().$type<UserId>(), // not an FK — provenance outlives the member row
    initiatedAt: text("initiated_at").notNull(),
    completedAt: text("completed_at"),
    // Written at completion and never regenerated: a re-processing writes a new processing record,
    // while the manifest describes what arrived, which does not change.
    manifestR2Key: text("manifest_r2_key"),
    exceptionReportR2Key: text("exception_report_r2_key"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    index("discovery_load_review_set_initiated_index").on(
      table.reviewSetId,
      table.initiatedAt,
      table.id,
    ),
    index("discovery_load_review_set_state_index").on(table.reviewSetId, table.state),
    check(
      "discovery_load_lane_check",
      sql`${table.lane} IN ('internal-files', 'internal-email', 'received-production', 'direct-collection')`,
    ),
    check(
      "discovery_load_state_check",
      sql`${table.state} IN ('declared', 'loading', 'processing', 'complete', 'failed', 'reversed')`,
    ),
    check(
      "discovery_load_transcript_scope_check",
      sql`${table.transcriptScope} IN ('exclude', 'include')`,
    ),
    check(
      "discovery_load_counts_nonnegative_check",
      sql`${table.declaredDocumentCount} >= 0 AND ${table.loadedDocumentCount} >= 0 AND ${table.processedCount} >= 0 AND ${table.exceptionCount} >= 0`,
    ),
    // The reconciliation invariant, as a row constraint. A load cannot reach `complete` while its
    // counts do not add up — which is the difference between a report that reconciles and a report
    // that says it does.
    check(
      "discovery_load_reconciliation_check",
      sql`${table.state} <> 'complete' OR ${table.loadedDocumentCount} = ${table.processedCount} + ${table.exceptionCount}`,
    ),
  ],
);

// The reviewable unit, and the row whose size the scale arithmetic budgets. A POINTER plus discovery
// facts — never a copy of content, never bulk text. Every deferred discovery feature (filters,
// tagging, threading, near-duplicates, the privilege log, production) is a function over this table.
export const reviewDocument = sqliteTable(
  "review_document",
  {
    id: text("id").primaryKey().$type<ReviewDocumentId>(), // reviewDocument_ handle
    reviewSetId: text("review_set_id")
      .notNull()
      .$type<ReviewSetId>()
      .references(() => reviewSet.id),
    discoveryLoadId: text("discovery_load_id")
      .notNull()
      .$type<DiscoveryLoadId>()
      .references(() => discoveryLoad.id),
    recordCustodianId: text("record_custodian_id")
      .notNull()
      .$type<RecordCustodianId>()
      .references(() => recordCustodian.id),
    sourceKind: text("source_kind", {
      enum: ["file_version", "email_message", "email_attachment"],
    }).notNull(),
    // LOADING IS A SNAPSHOT OF A VERSION, NOT A SUBSCRIPTION TO A FILE. The version is pinned here; a
    // new version of the underlying file does not change the review set, because the corpus under
    // review is what was reviewed. A newer version enters only through a new load, which is a
    // recorded act.
    fileVersionId: text("file_version_id")
      .$type<FileVersionId>()
      .references(() => fileVersion.id),
    emailMessageId: text("email_message_id")
      .$type<EmailMessageId>()
      .references(() => emailMessage.id),
    // The family: a self-reference plus a role, not a junction table. A standalone document is its own
    // family, so every document has one and no read has a special case. An email and its attachments
    // must stay together — a responsive attachment makes its parent responsive, a privileged parent
    // taints its attachments, and a production that breaks a family will be challenged.
    familyId: text("family_id").notNull().$type<ReviewDocumentId>(),
    familyRole: text("family_role", {
      enum: ["standalone", "parent", "attachment", "container-child"],
    })
      .notNull()
      .default("standalone"),
    familySequence: integer("family_sequence").notNull().default(0),
    // The name and path AS RECEIVED, for the manifest. Evidence, never authority: identification reads
    // bytes, and a production's file names are wrong often enough that routing on one is how a
    // spreadsheet gets read as a picture.
    sourceName: text("source_name"),
    sourcePath: text("source_path"),
    sizeBytes: integer("size_bytes"),
    // Three of the five digests e-discovery load files ask for, promoted to columns because they are
    // filtered and grouped on; the full five-algorithm set rides the manifest. MD5 and SHA-1 are
    // carried as legacy interop exactly as @magna-carta/file-integrity already labels them — opposing
    // tooling and load-file specifications still ask for them.
    contentSha256: text("content_sha256"),
    contentMd5: text("content_md5"),
    contentSha1: text("content_sha1"),
    // Derived artifacts by reference. A 50,000-document review set averaging 30 KB of text is 1.5 GB;
    // that number alone settles where extracted text lives.
    textR2Key: text("text_r2_key"),
    metadataR2Key: text("metadata_r2_key"),
    // Recorded at extraction because Bates numbering will need it and it cannot be recovered later
    // without re-reading every byte of the corpus.
    pageCount: integer("page_count"),
    // The deterministic near-duplicate fingerprint, computed where the text is already in memory.
    // Clustering over it is a later slice; retrofitting the fingerprint would be a second full
    // processing run rather than a migration.
    textFingerprint: text("text_fingerprint"),
    // Deduplication KEEPS the duplicate: the row survives, marked non-primary, and its occurrence row
    // names the record custodian and the load it came from. "Which custodians held this document" is
    // asked under oath, and "we deleted that" is not an answer. What dedup buys is that only the
    // primary is extracted, indexed, and embedded.
    dedupGroupId: text("dedup_group_id"),
    isDedupPrimary: integer("is_dedup_primary", { mode: "boolean" }).notNull().default(true),
    // EXACTLY TWO TERMINAL STATES, and no third. A document that ends in neither has fallen out of the
    // corpus with nobody able to tell.
    processingState: text("processing_state", {
      enum: ["pending", "processing", "processed", "excepted"],
    })
      .notNull()
      .default("pending"),
    // What the bytes actually were, recorded even when they could not be read: "we could not read
    // this, and it was a legacy WordPerfect document" is a defensible sentence and "extraction
    // failed" is not.
    formatIdentified: text("format_identified"),
    // The date the corpus sorts and filters on, with the source of the choice recorded beside it —
    // for email the sent time, for a document the best available internal date, with the file-system
    // date as the last resort. A privilege log is a function over exactly these fields.
    sortDate: text("sort_date"),
    sortDateSource: text("sort_date_source"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    // The read every future review surface sits on: one review set's documents, newest first, with
    // the filters the reviewer actually uses. review_set_id leads every one of these.
    index("review_document_review_set_sort_index").on(table.reviewSetId, table.sortDate, table.id),
    index("review_document_review_set_load_index").on(table.reviewSetId, table.discoveryLoadId),
    index("review_document_review_set_record_custodian_index").on(
      table.reviewSetId,
      table.recordCustodianId,
    ),
    index("review_document_review_set_state_index").on(table.reviewSetId, table.processingState),
    // A family is ONE indexed read.
    index("review_document_family_index").on(
      table.reviewSetId,
      table.familyId,
      table.familySequence,
    ),
    // Exact-duplicate grouping, and the "which custodians held this" answer behind it.
    index("review_document_review_set_dedup_index").on(table.reviewSetId, table.dedupGroupId),
    index("review_document_review_set_sha256_index").on(table.reviewSetId, table.contentSha256),
    check(
      "review_document_source_kind_check",
      sql`${table.sourceKind} IN ('file_version', 'email_message', 'email_attachment')`,
    ),
    // A review document points at exactly one thing. Both null is a row about nothing; both set is a
    // row about two things, and a reader would have to guess which.
    check(
      "review_document_exactly_one_source_check",
      sql`(${table.fileVersionId} IS NOT NULL) + (${table.emailMessageId} IS NOT NULL) = 1`,
    ),
    check(
      "review_document_processing_state_check",
      sql`${table.processingState} IN ('pending', 'processing', 'processed', 'excepted')`,
    ),
    // A success nobody can describe is not a success: a processed document names the format it was
    // read as.
    check(
      "review_document_processed_names_format_check",
      sql`${table.processingState} <> 'processed' OR ${table.formatIdentified} IS NOT NULL`,
    ),
    check(
      "review_document_family_role_check",
      sql`${table.familyRole} IN ('standalone', 'parent', 'attachment', 'container-child')`,
    ),
    // A standalone document IS its own family. Without this a standalone row could point its family
    // at somebody else's and quietly join a family it does not belong to.
    check(
      "review_document_standalone_family_check",
      sql`${table.familyRole} <> 'standalone' OR ${table.familyId} = ${table.id}`,
    ),
  ],
);

// One named reason a document did not process. Several per document is normal — a container can be
// both encrypted and oversize — and the presence of a row is what makes the document `excepted`.
export const reviewDocumentException = sqliteTable(
  "review_document_exception",
  {
    id: text("id").primaryKey().$type<ReviewDocumentExceptionId>(), // reviewDocumentException_ handle
    // Carried on the row rather than reached through the document, because the exception report is a
    // read across the whole review set and joining a quarter-million rows to get there is the read
    // this column exists to avoid.
    reviewSetId: text("review_set_id")
      .notNull()
      .$type<ReviewSetId>()
      .references(() => reviewSet.id),
    reviewDocumentId: text("review_document_id")
      .notNull()
      .$type<ReviewDocumentId>()
      .references(() => reviewDocument.id),
    stage: text("stage", {
      enum: ["load", "identify", "extract", "deduplicate", "family", "index"],
    }).notNull(),
    code: text("code").notNull(),
    // A human-readable amplification, and NEVER file content: the whole pipeline handles privileged
    // material, so a detail that could carry a fragment of a document is a redaction failure wearing
    // an error message.
    detail: text("detail"),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    index("review_document_exception_review_set_code_index").on(table.reviewSetId, table.code),
    index("review_document_exception_document_index").on(table.reviewDocumentId),
    check(
      "review_document_exception_stage_check",
      sql`${table.stage} IN ('load', 'identify', 'extract', 'deduplicate', 'family', 'index')`,
    ),
    check(
      "review_document_exception_code_check",
      sql`${table.code} IN ('unsupported-format', 'corrupt', 'encrypted', 'password-protected', 'encrypted-container-entry', 'container-not-expanded', 'container-guard-tripped', 'oversize', 'extraction-timeout', 'no-text-extracted', 'malware-flagged', 'conversion-failed', 'recognition-failed', 'load-file-metadata-mismatch', 'source-bytes-missing')`,
    ),
  ],
);

// One further copy of a deduplicated document, kept rather than deleted. The two columns are named
// for what they hold rather than for the relation, because "duplicate_of" on the row that IS the
// duplicate reads backwards to half of everyone: `primary_review_document_id` is the group's primary,
// `duplicate_review_document_id` is the copy this row accounts for.
export const reviewDocumentOccurrence = sqliteTable(
  "review_document_occurrence",
  {
    id: text("id").primaryKey().$type<ReviewDocumentOccurrenceId>(), // reviewDocumentOccurrence_ handle
    reviewSetId: text("review_set_id")
      .notNull()
      .$type<ReviewSetId>()
      .references(() => reviewSet.id),
    primaryReviewDocumentId: text("primary_review_document_id")
      .notNull()
      .$type<ReviewDocumentId>()
      .references(() => reviewDocument.id),
    duplicateReviewDocumentId: text("duplicate_review_document_id")
      .notNull()
      .$type<ReviewDocumentId>()
      .references(() => reviewDocument.id),
    // The attribution deduplication must not destroy: whose records this copy was, and which load
    // brought it in.
    recordCustodianId: text("record_custodian_id")
      .notNull()
      .$type<RecordCustodianId>()
      .references(() => recordCustodian.id),
    discoveryLoadId: text("discovery_load_id")
      .notNull()
      .$type<DiscoveryLoadId>()
      .references(() => discoveryLoad.id),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    // "Which custodians held this document" is ONE indexed query, which is the entire reason the row
    // exists rather than a deletion.
    index("review_document_occurrence_primary_index").on(
      table.reviewSetId,
      table.primaryReviewDocumentId,
    ),
    uniqueIndex("review_document_occurrence_duplicate_unique_index").on(
      table.duplicateReviewDocumentId,
    ),
    // A document is not a duplicate of itself; a row saying so would inflate every custodian count.
    check(
      "review_document_occurrence_distinct_check",
      sql`${table.primaryReviewDocumentId} <> ${table.duplicateReviewDocumentId}`,
    ),
  ],
);
