import {
  check,
  foreignKey,
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
import { civilDateShape } from "./date-shape-checks.ts";
import type {
  AiDetectionUsageId,
  AuditLogId,
  BillingArrangementId,
  CalendarEventLinkId,
  ClientCreditId,
  ConflictsCheckId,
  ConflictsDispositionId,
  ConflictsHitId,
  ConflictsRecheckRequestId,
  CostEntryId,
  FeeEntryId,
  CreditNoteId,
  CreditNoteLineId,
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
  CommunicationId,
  EmailAutoFileRuleId,
  EmailCaptureAddressId,
  EmailMatterLinkId,
  EmailMessageId,
  EmailParticipantId,
  EmailThreadId,
  EntityMergeId,
  FileId,
  FileVersionId,
  FirmEventId,
  FirmEventParticipantId,
  FirmResourceBookingId,
  FirmResourceId,
  FirmSecretId,
  FolderId,
  GrantId,
  IdempotencyRecordId,
  IncidentId,
  IndexSplitId,
  IntegrationConnectionId,
  IntegrationCredentialId,
  InvoiceApplicationId,
  DownloadItemId,
  InvoiceDeliveryId,
  InvoiceId,
  InvoiceLineId,
  InvoiceTrustApplicationLineId,
  InvoiceWipClaimId,
  LedgerAccountId,
  LedgerEntryId,
  LedgerLineId,
  LocationAddressId,
  LocationId,
  MagnusConversationId,
  MagnusTurnId,
  MatterAssetDocumentId,
  MatterAssetEncumbranceId,
  MatterAssetId,
  MatterAssetIdentifierId,
  MatterAssetInterestId,
  MatterAssetTypeId,
  MatterAssetValuationId,
  MatterAssignmentId,
  MatterCourtCaseId,
  MatterDeadlineId,
  MatterNoteDocumentId,
  MatterNoteId,
  MatterEstateId,
  MatterEventId,
  MatterEventParticipantId,
  MatterEventTypeId,
  MatterId,
  MatterPartyId,
  MatterPlanTaskTemplateId,
  MatterPlanTemplateId,
  IntakeProcedureId,
  IntakeProcedureStepId,
  MatterIntakeStepRecordId,
  MatterRecoveryId,
  MatterTaskDocumentId,
  MatterTaskDeletionId,
  MatterTaskExternalLinkId,
  MatterTaskAssigneeId,
  MatterTaskChecklistItemId,
  MatterTaskId,
  MatterTaskLinkId,
  MatterTypeId,
  MeetingAttendanceId,
  MeetingGuestInvitationId,
  MeetingGuestStayId,
  MeetingHostId,
  MeetingId,
  MeetingMessageId,
  MeetingPollAnswerId,
  MeetingPollId,
  MeetingPollOptionId,
  MeetingPollRespondentId,
  MeetingQuestionId,
  MeetingQuestionUpvoteId,
  MeetingRecordingId,
  MeetingRecordingNoticeId,
  MeetingRecordingTrackId,
  MeetingTranscriptId,
  MeetingTranscriptSegmentId,
  MeetingSummaryId,
  MeetingSummaryActionItemId,
  MemberLocationId,
  MemberRoleId,
  NarrativeTemplateId,
  NonBillableCategoryId,
  NotificationDeliveryId,
  NotificationDigestId,
  NotificationEventId,
  NotificationRecipientId,
  NumberingSchemeId,
  OutboxId,
  PicklistOptionId,
  RateCardId,
  RateId,
  RecordCustodianId,
  RepairProvenanceId,
  RetainerReplenishmentRequestId,
  ReviewDocumentExceptionId,
  ReviewDocumentId,
  ReviewDocumentOccurrenceId,
  ReviewDocumentTagId,
  ReviewSetAccessId,
  ReviewTagEventId,
  ReviewTagGroupId,
  ReviewTagId,
  ReviewSetId,
  RoleId,
  RolePermissionId,
  ShipmentId,
  ShipmentLabelId,
  TimeEntryId,
  TrackingEventId,
  TrustAccountId,
  TrustAuthorizationPolicyId,
  TrustBankStatementId,
  TrustBankStatementLineId,
  TrustDisbursementDecisionId,
  TrustDisbursementRequestId,
  TrustFirmFundsMovementId,
  TrustHoldId,
  TrustLedgerNodeId,
  TrustMovementId,
  TrustReconciliationId,
  TrustReconciliationMatchId,
  TrustTransferId,
  TrustUnclaimedFundsContactAttemptId,
  TrustUnclaimedFundsReviewClosureId,
  TrustUnclaimedFundsReviewId,
  UploadSessionId,
  UserId,
  UtbmsCodeId,
  TaskListId,
  TaskListStatusId,
  TaskTeamId,
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
    status: text("status", {
      enum: ["pending", "dispatched", "failed"],
    }).notNull(),
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
  optedOutOfUsageAnalytics: integer("opted_out_of_usage_analytics", {
    mode: "boolean",
  })
    .notNull()
    .default(false),
  createdAt: text("created_at").notNull(), // ISO-8601 instant
});

// THE MEMBER'S OWN PICTURE — what a colleague recognises them by across the product.
//
// A SEPARATE TABLE RATHER THAN COLUMNS ON `member`, on the firm_brand_image reasoning: a picture is
// seven facts about some bytes, and seven nullable columns on the row every permission read joins
// against would be carried by every one of those reads to answer a question none of them asks.
// One row per member at most — the member's own user id IS the key — so "no picture" is the
// absence of a row rather than a row full of nulls.
//
// THE BYTES LIVE IN THE FIRM'S BUCKET, under their own hash, and this row carries what a screen
// needs to draw them. `sha256` is not the key here, unlike the firm's marks: two members may
// legitimately hold the same bytes (the same photographer's placeholder, a firm's own silhouette),
// and keying on content would make one member's upload silently become the other's row.
//
// WHY THE FIRM'S DATABASE AND NOT THE ACCOUNT'S. A member's own name is an ACCOUNT fact and lives
// on the control-plane user row (apps/api-worker/src/http/routes/session/me-name.ts says why). A picture is not
// the same kind of fact: it is what this firm's colleagues see beside this person's work, it is
// stored in this firm's bucket under this firm's key, and a person who leaves takes their name to
// their next account and leaves the firm's roster photograph behind. Better Auth's `user.image`
// column exists and is deliberately unused — it holds a URL, and a URL to a firm-scoped object
// read through a session is not a thing the control plane can resolve.
export const memberPhoto = sqliteTable(
  "member_photo",
  {
    memberUserId: text("member_user_id")
      .primaryKey()
      .$type<UserId>()
      .references(() => member.userId),
    // The SHA-256 of the bytes, which is also what the object is keyed by. Not the primary key;
    // see above.
    sha256: text("sha256").notNull(),
    objectKey: text("object_key").notNull(),
    contentType: text("content_type").notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    // The intrinsic size, so a surface can reserve the space before the bytes arrive.
    widthPixels: integer("width_pixels").notNull(),
    heightPixels: integer("height_pixels").notNull(),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    check("member_photo_size_check", sql`${table.sizeBytes} > 0`),
    check("member_photo_pixels_check", sql`${table.widthPixels} > 0 AND ${table.heightPixels} > 0`),
  ],
);

// A named bundle of permissions. The defaults are seeded by migration, and the seeded handles are
// committed literals.
//
// A role with a parent is a SUB-ROLE of it: Partner and Associate under Attorney. A member who holds
// a sub-role also holds its parent, as a second member_role row, so every read that joins member_role
// to role_permission sees the parent's permissions without knowing sub-roles exist; the sub-role's
// own role_permission rows are only what it ADDS. Sub-roles add and never subtract, because a member
// can do what any of their roles allows and nothing narrows that. One level deep: a sub-role's parent
// has no parent. The set-roles route holds both rules and the at-most-one-sub-role-per-parent rule.
export const role = sqliteTable("role", {
  id: text("id").primaryKey().$type<RoleId>(), // role_ handle
  name: text("name").notNull().unique(),
  parentRoleId: text("parent_role_id")
    .$type<RoleId>()
    .references((): AnySQLiteColumn => role.id), // null = a top-level role
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

// A member's professional identity as documents and letterhead state it — title, bar admissions,
// direct dial, professional email, and the signature block a pleading signs off with. One row per
// member, keyed by the member's own user id (the profile IS the member's, so a second handle would
// only be a second name for the same fact). A member's bar number is deliberately NOT a column
// here: it is a sensitive identifier and lives encrypted in directory_identifier on the member's
// mapped Directory person, read only through the protected-field chokepoint.
export const memberProfessionalProfile = sqliteTable("member_professional_profile", {
  memberUserId: text("member_user_id")
    .primaryKey()
    .$type<UserId>()
    .references(() => member.userId),
  title: text("title"), // "Partner", "Associate", "Senior Paralegal"
  admissions: text("admissions"), // "Nevada, 2014; California, 2016" — running prose, not a catalog
  directDial: text("direct_dial"),
  professionalEmail: text("professional_email"),
  // The multi-line block a pleading signs off with, stored with its line breaks. Rendered into a
  // document only once the assembly engine emits real line breaks (w:br) — a literal newline in a
  // w:t renders as a space, so the merge facet waits for that machinery.
  signatureBlock: text("signature_block"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

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
    // The office's own email address — what a letterhead, a bill and a portal page name as the way
    // to write to THIS office. One per office: an office's telephone belongs to each of its
    // addresses (a mailing address can carry a different line from the street one), but mail reaches
    // an office, not a building.
    email: text("email"),
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
    // The international field set, named for POSITION in an address rather than for any one
    // country's words — the same columns the directory's addresses carry, so the product's one
    // address form (the design system's AddressFields) writes an office's address the way it writes
    // a client's. The country is what decides which of them a form shows and what each is called.
    street: text("street"),
    streetTwo: text("street_two"),
    dependentLocality: text("dependent_locality"),
    city: text("city"),
    region: text("region"),
    postal: text("postal"),
    sortingCode: text("sorting_code"),
    country: text("country"), // ISO 3166-1 alpha-2; null on an address recorded before the column
    phone: text("phone"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    index("location_address_location_id_index").on(table.locationId),
    check("location_address_kind_check", sql`${table.kind} IN ('physical', 'mailing')`),
  ],
);

// The firm's own marks — the images branding the product and printed into generated documents.
// FIRM-WIDE, where the letterhead logo on `location` is per office: an office with no logo of its
// own prints the firm's primary mark, so a single-office firm sets its mark once and never has to
// know the difference. Content-addressed: the primary key IS the SHA-256 of the bytes, so uploading
// the same mark twice is the same row, and a replaced mark never overwrites the object a document
// was already produced from. The bytes live in the firm's own bucket under that hash; the row
// carries what a document needs to draw them — what they are, and their intrinsic pixel size.
// There is exactly one `primary` row at a time, enforced in the write path rather than by a
// partial index (the snapshot cannot record one): promoting an image demotes the previous primary
// to `additional` rather than removing it, so nothing is lost by choosing.
export const firmBrandImage = sqliteTable(
  "firm_brand_image",
  {
    id: text("id").primaryKey(), // sha256 hex of the bytes
    role: text("role", { enum: ["primary", "additional"] }).notNull(),
    // What the image is FOR, in the firm's own words ("Seal", "Wordmark"). Nullable: the primary
    // mark needs no caption, and an additional image without one is still an image.
    label: text("label"),
    objectKey: text("object_key").notNull(),
    contentType: text("content_type").notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    widthPixels: integer("width_pixels").notNull(),
    heightPixels: integer("height_pixels").notNull(),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    check("firm_brand_image_role_check", sql`${table.role} IN ('primary', 'additional')`),
    check("firm_brand_image_size_check", sql`${table.sizeBytes} > 0`),
    check(
      "firm_brand_image_pixels_check",
      sql`${table.widthPixels} > 0 AND ${table.heightPixels} > 0`,
    ),
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

// A numbering template: an ordered array of segments stored as validated JSON. One active scheme
// per firm PER PURPOSE is enforced in the write path; superseded schemes are retained so a
// historical number still explains how it was rendered.
export const numberingScheme = sqliteTable(
  "numbering_scheme",
  {
    id: text("id").primaryKey().$type<NumberingSchemeId>(), // numberingScheme_ handle
    segments: text("segments").notNull(), // JSON; shape validated by numberingSchemeSchema
    // Which sequence this template renders — one value per purpose on the firm-wide numbering
    // register (@magna-carta/sequence-numbering/purposes) that takes a scheme: the permanent matter
    // number, the tentative number a consultation carries, the number an intake wears from the
    // moment the enquiry is written down, the number a conflicts check is opened under, and the
    // number a custody packet is labelled with. One active scheme per purpose; a firm that has
    // configured nothing for a purpose falls back to the register's built-in default, so nothing
    // is ever unnumbered while somebody gets round to the settings screen. Only the matter purpose
    // refuses to default, because a matter number is the firm's own file spine and there is no
    // defensible shape to invent for one. Widening this enum is the whole of admitting a new
    // purpose here: there is no CHECK on the column (below), so no migration rewrites the table.
    purpose: text("purpose", {
      enum: [
        "matter",
        "consultation",
        "intake",
        "conflicts_check",
        "custody_packet",
        "invoice",
        "time_entry",
        "communication",
      ],
    })
      .notNull()
      .default("matter"),
    active: integer("active").notNull().default(1),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  // No CHECK on purpose: adding one to a table that already exists costs SQLite a full table
  // rebuild, which is destructive DDL for a small enum column the write path is the only producer of.
  // The enum on the column carries the constraint where it is actually enforced.
  () => [],
);

// The matter-number counter, one row per {firm, scope_key}. The primary key is the natural scope key,
// NOT an identifier handle — like the migration tracker, this is a counter keyed by what it counts
// (a documented exception to the handle-PK fitness rule). The guarded increment against next_value
// plus the matter_number UNIQUE index are what make concurrent draws yield distinct numbers.
export const matterNumberCounter = sqliteTable("matter_number_counter", {
  scopeKey: text("scope_key").primaryKey(), // scoping-segment values joined by ":"; "" = firm-wide
  nextValue: integer("next_value").notNull(),
});

// The matter shell. status drives the owner-shaped lifecycle: consultation (an unnumbered
// consultation) -> open (draws the number) -> closed (archived but still additive). The number is
// frozen at assignment; the partial UNIQUE index makes a duplicate number within the firm impossible
// while leaving unnumbered consultations unconstrained.
export const matter = sqliteTable(
  "matter",
  {
    id: text("id").primaryKey().$type<MatterId>(), // matter_ handle
    title: text("title").notNull(),
    description: text("description"),
    status: text("status", {
      enum: ["intake", "consultation", "open", "hold", "closed"],
    }).notNull(),
    matterTypeId: text("matter_type_id")
      .$type<MatterTypeId>()
      .references(() => matterType.id),
    locationId: text("location_id")
      .$type<LocationId>()
      .references(() => location.id),
    // Where the firm's own PAPER file for this matter is kept, which is a different fact from the
    // owning office above and must never be collapsed into it: a matter run out of one office can
    // have its folder boxed at another, or at a remote store the firm keeps as an office of its
    // own, and closing the matter moves none of that. It points at an office rather than carrying
    // free text so the file's whereabouts is the same record the rest of the product reads. What
    // the folder physically sits INSIDE — a box, a drawer, a safe, a shelf — is deliberately not
    // here: one container holds several matters' folders, so it is its own record a matter will
    // point at, and a column here would have decided the medium for every firm.
    physicalFileLocationId: text("physical_file_location_id")
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
    // Excludes this matter from the firm's natural-language search index. OPT-OUT, defaulting in:
    // once the firm has opted in, every matter is fed, because a search that covers only the matters
    // somebody remembered to tick is worse than no search — its gaps are invisible, and a lawyer who
    // finds nothing concludes there is nothing. The escape hatch exists because a matter under a
    // heightened confidentiality undertaking is a real thing and the firm needs somewhere to put it.
    // Setting it stops the feed writer AND deletes the matter's existing feed objects: an opt-out
    // that only stopped new writes would leave the material that prompted it sitting in the index.
    naturalLanguageIndexExcluded: integer("natural_language_index_excluded").notNull().default(0),
    matterNumber: text("matter_number"), // null until open draws it; frozen thereafter
    numberedAt: text("numbered_at"),
    // The tentative number a consultation carries from the moment it is created, drawn from the
    // firm's consultation sequence. A consultation is a real thing a firm has to be able to
    // name — on an intake sheet, a conflicts check, a bill for the consultation itself — and
    // "Consultation" is not a name. It is drawn once and frozen: opening the matter draws the
    // permanent matter_number alongside it rather than replacing it, so a document filed under the
    // tentative number still resolves. Null only on matters created straight to open (which never
    // were a consultation) and on consultations created before the sequence existed. The draw instant
    // is created_at by construction — the number is allocated in the insert's own batch.
    consultationNumber: text("consultation_number"),
    // The number an INTAKE wears from the moment the enquiry is written down, drawn from the firm's
    // intake sequence (owner ruling, 2026-09-14: "everything should have a number, intake would have
    // a number as well"). An intake is already work — somebody took the call, a conflicts check may
    // have run, steps are being cleared — and until this existed its only name was its handle, which
    // is what the platform joins on and what nobody can read back down a telephone.
    //
    // A THIRD RUN, not an early draw on the consultation one, for the reason the consultation number
    // is not an early draw on the matter number: most enquiries never become consultations, and a
    // consultation run pitted with declined enquiries cannot be told apart from one with records
    // missing. Drawn once and frozen; graduation adds consultation_number beside it and opening adds
    // matter_number beside that, so a note filed under this number still resolves. Null on matters
    // created straight to consultation or to open, and on intakes created before the sequence
    // existed. The draw instant is created_at by construction — allocated in the insert's own batch.
    intakeNumber: text("intake_number"),
    // Names a platform-owned matter that exists to satisfy a structural requirement rather than to
    // hold a client engagement — today only the custody holding matter, which is where a scan of an
    // original held for someone with no matter is filed. Null on every real matter. Marked rather
    // than hidden by convention so list reads, reports, conflicts, and billing have one column to
    // exclude, and so the alternative (relaxing file.matter_id to nullable, which seven subsystems
    // depend on) is not forced by one consumer's need.
    systemKey: text("system_key"),
    openedAt: text("opened_at"),
    // A HOLD is an open matter the firm has stopped working without closing it: a client who has
    // stopped paying, a party who has gone quiet, an instruction to wait. The matter keeps its
    // number, because a hold is a pause of the engagement and not the end of it; what it gains is
    // the reason, in the firm's own words, and the instant the pause began. Both are cleared when
    // the hold is released and the matter returns to open. A close leaves them standing so a
    // reopen can return the matter to the hold it was in, which is the rung it left.
    heldAt: text("held_at"),
    holdReason: text("hold_reason"),
    closedAt: text("closed_at"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("matter_matter_number_unique_index")
      .on(table.matterNumber)
      .where(sql`${table.matterNumber} IS NOT NULL`),
    // Same shape as the matter-number index and for the same reason: the tentative number is a name
    // people quote, so two consultations must never wear one. Partial, so the matters that carry no
    // consultation number are unconstrained.
    uniqueIndex("matter_consultation_number_unique_index")
      .on(table.consultationNumber)
      .where(sql`${table.consultationNumber} IS NOT NULL`),
    // And the same again for the intake run. Three partial unique indexes rather than one shared
    // column, because the three numbers coexist on a matter that came the whole way: a file's intake
    // number, its consultation number and its matter number are different names it answers to, and
    // each has to be unique against its own run rather than against the other two.
    uniqueIndex("matter_intake_number_unique_index")
      .on(table.intakeNumber)
      .where(sql`${table.intakeNumber} IS NOT NULL`),
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
    // The lifecycle: an INTAKE is the walk from first contact to a consultation the firm's own
    // procedure lets through; a CONSULTATION is a prospective client's matter, numbered from the
    // consultation sequence and not yet taken on; OPEN draws the matter number; HOLD is an open
    // matter the firm has paused, for a recorded reason, keeping its number; CLOSED keeps the
    // record. Held by a CHECK so a sixth status is a reviewed migration.
    check(
      "matter_status_check",
      sql`${table.status} IN ('intake', 'consultation', 'open', 'hold', 'closed')`,
    ),
    // A hold is a reason and an instant together, or neither: a matter on hold with no reason
    // recorded would be a pause nobody can explain, and a reason with no instant a pause nobody
    // can date.
    check("matter_hold_check", sql`(${table.heldAt} IS NULL) = (${table.holdReason} IS NULL)`),
    check("matter_title_nonempty_check", sql`length(${table.title}) > 0`),
    check("matter_e_billing_check", sql`${table.eBilling} IN (0, 1)`),
    check(
      "matter_natural_language_index_excluded_check",
      sql`${table.naturalLanguageIndexExcluded} IN (0, 1)`,
    ),
  ],
);

// The date on or after which the firm may destroy its own PAPER file for a matter, as the firm
// recorded it. A date a person entered, never one this platform derived: retention periods are
// jurisdictional, and a date invented here is a date somebody destroys a client's file on. Nothing
// reads this to delete anything — it is a reminder on the matter and on the firm calendar, and the
// destruction itself stays a person's act.
//
// A table of its own rather than a column on `matter` for two reasons. A date column carries the
// shared shape guard, and adding a CHECK to `matter` is a rebuild of the table most of the schema
// points at. And the retention record will grow — the basis a firm states, the policy a date came
// from — without each arrival widening the matter row. One row per matter, keyed by the matter, so
// two dates for one file are unrepresentable; clearing the date deletes the row, and the audit log
// keeps every date the matter has carried.
export const matterFileRetention = sqliteTable(
  "matter_file_retention",
  {
    matterId: text("matter_id")
      .primaryKey()
      .$type<MatterId>()
      .references(() => matter.id),
    destroyOn: text("destroy_on").notNull(),
    recordedByUserId: text("recorded_by_user_id")
      .notNull()
      .$type<UserId>()
      .references(() => member.userId),
    recordedAt: text("recorded_at").notNull(),
  },
  (table) => [
    check("matter_file_retention_destroy_on_shape_check", civilDateShape(table.destroyOn)),
    // The firm calendar's window reads these by date across every matter; the matter id rides along
    // so the keyset cursor seeks rather than sorts.
    index("matter_file_retention_destroy_on_matter_id_index").on(table.destroyOn, table.matterId),
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

// The matter's staffing beyond the single responsible attorney: who originated it, who supervises,
// who bills it, which paralegal carries it. Wanted well beyond documents — caseload views, billing
// attribution, conflicts imputation, and workload reporting all ask the same question — and until
// this table every one of them was answered by matter.responsible_member_id or not at all. The
// responsible attorney deliberately STAYS on the matter row (one home per fact); the write path
// refuses an assignment_role that normalizes to it. assignment_role is free text matched the way
// matter_party.role is: lowercased with every non-alphanumeric character removed, so a merge
// subject and a firm's own spelling of the same role meet without a mapping table.
export const matterAssignment = sqliteTable(
  "matter_assignment",
  {
    id: text("id").primaryKey().$type<MatterAssignmentId>(), // matterAssignment_ handle
    matterId: text("matter_id")
      .notNull()
      .$type<MatterId>()
      .references(() => matter.id),
    memberUserId: text("member_user_id")
      .notNull()
      .$type<UserId>()
      .references(() => member.userId),
    assignmentRole: text("assignment_role").notNull(), // e.g. 'originating_attorney', 'assigned_paralegal'
    // A bound recorded at creation is a civil date (YYYY-MM-DD, inclusive of its whole day);
    // ending an assignment stamps valid_to with the ending instant instead. The staffing read
    // (packages/document-assembly/src/merge-statements.ts) tells the two forms apart by length.
    validFrom: text("valid_from"),
    validTo: text("valid_to"), // null = current; set = the assignment ended
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    // The staffing read is WHERE matter_id = ? — lead with it. The member index narrows the
    // caseload question ("what is this member staffed on") to that member's rows; it is
    // single-column, so the row fetch follows the index rather than being answered from it.
    index("matter_assignment_matter_id_index").on(table.matterId),
    index("matter_assignment_member_user_id_index").on(table.memberUserId),
    check("matter_assignment_role_nonempty_check", sql`length(${table.assignmentRole}) > 0`),
  ],
);

// The matter's court-and-case identity — the record a caption reads and rules-based docketing will
// later hang off. The court and the judge are Directory references (an organisation and a person),
// so a court's own address and a judge's name formats come from the Directory rather than from
// columns restated here; both are plain entity ids (no cross-domain FK, exactly as matter_party).
// The two designation words are what make a caption read correctly in its own jurisdiction's
// vocabulary — "Plaintiff"/"Defendant", "Petitioner"/"Respondent" — recorded once rather than baked
// into key names. One live record per matter: a matter is before one court at a time, and the
// partial unique index is what makes a second live record structurally impossible.
export const matterCourtCase = sqliteTable(
  "matter_court_case",
  {
    id: text("id").primaryKey().$type<MatterCourtCaseId>(), // matterCourtCase_ handle
    matterId: text("matter_id")
      .notNull()
      .$type<MatterId>()
      .references(() => matter.id),
    courtEntityId: text("court_entity_id"), // FK to directory_organization.id (the court)
    judgeEntityId: text("judge_entity_id"), // FK to directory_person.id (the assigned judge)
    caseNumber: text("case_number"),
    division: text("division"),
    department: text("department"),
    filedOn: text("filed_on"), // civil date, YYYY-MM-DD
    clientDesignation: text("client_designation"), // e.g. 'Plaintiff', 'Petitioner'
    opposingDesignation: text("opposing_designation"), // e.g. 'Defendant', 'Respondent'
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
    deletedAt: text("deleted_at"),
  },
  (table) => [
    uniqueIndex("matter_court_case_matter_id_unique_index")
      .on(table.matterId)
      .where(sql`${table.deletedAt} IS NULL`),
  ],
);

// The estate a probate matter administers — a first-class identity on the matter, because an estate
// has SEVERAL names and a document uses each in a different place: the decedent's (a Directory
// person, so every name format applies), the style a caption and a bank account use, and the short
// style a letter's second reference uses. THE STYLE IS STORED, NOT COMPOSED: "the Estate of Rowan
// Ashcroft, Deceased" is a legal designation a firm may need to state exactly as the court has it,
// and a composed string would be right most of the time — which is the worst frequency. The
// estate's own Directory record (estate_entity_id, an organisation) is where its tax identifier
// lives, through the same encrypted directory_identifier mechanism every entity uses — never a
// ciphertext column here. One live record per matter, as the court case is.
export const matterEstate = sqliteTable(
  "matter_estate",
  {
    id: text("id").primaryKey().$type<MatterEstateId>(), // matterEstate_ handle
    matterId: text("matter_id")
      .notNull()
      .$type<MatterId>()
      .references(() => matter.id),
    decedentEntityId: text("decedent_entity_id"), // FK to directory_person.id
    estateEntityId: text("estate_entity_id"), // FK to directory_organization.id (the estate's own record)
    dateOfDeath: text("date_of_death"), // civil date, YYYY-MM-DD
    estateStyle: text("estate_style"), // "the Estate of Rowan Ashcroft, Deceased" — as the court has it
    shortStyle: text("short_style"), // "the Ashcroft Estate"
    proceedingType: text("proceeding_type"), // 'testate' | 'intestate' | 'small_estate' | 'ancillary'
    lettersIssuedOn: text("letters_issued_on"), // civil date, YYYY-MM-DD
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
    deletedAt: text("deleted_at"),
  },
  (table) => [
    uniqueIndex("matter_estate_matter_id_unique_index")
      .on(table.matterId)
      .where(sql`${table.deletedAt} IS NULL`),
    check(
      "matter_estate_proceeding_type_check",
      sql`${table.proceedingType} IS NULL OR ${table.proceedingType} IN ('testate', 'intestate', 'small_estate', 'ancillary')`,
    ),
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
    editState: text("edit_state", {
      enum: ["idle", "coediting", "checked_out"],
    })
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
    storageClass: text("storage_class", {
      enum: ["standard", "infrequent_access"],
    })
      .notNull()
      .default("standard"),
    scanVerdict: text("scan_verdict", {
      enum: ["unscanned", "clean", "flagged"],
    }),
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
    status: text("status", {
      enum: ["pending", "clean", "quarantined", "abandoned"],
    })
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
    // The last-modified instant the uploading device reported for the file this version came from,
    // as the reader's browser saw it (File.lastModified). A fact about the SOURCE, recorded on every
    // version whether or not the reader chose to date the file by it — so a later question about
    // where a document's date came from has an answer. Null for a version that arrived some other
    // way (a live-edit save, an assembled document, a version older than the column).
    sourceModifiedAt: text("source_modified_at"),
    // What kind of save cut this version, for a version the browser editor cut from the working
    // copy: the member's own Save (`explicit`), the editor's periodic autosave (`autosave`), the save
    // made as the last view leaves (`exit`), or the idle reap's cut (`reap`). Null for a version that
    // arrived by upload, check-in or restore. History folds the autosaves and names the rest.
    saveKind: text("save_kind", {
      enum: ["explicit", "autosave", "exit", "reap"],
    }),
    // The copy of this version that leaves the platform, for a word-processing version the editor
    // cut: the stored bytes keep every tracked change, and a download, a bundle or any other copy
    // produced for outside the firm is served from a copy with all changes accepted. `pending` from
    // the cut until the copy is written, `ready` with the copy's key and size (the version's own key
    // when it recorded nothing), `unavailable` when the document is past what the accept pass can
    // hold. Null for a version that needs no copy: an upload, a check-in, a restore, or a document
    // in a format that records no changes.
    exportCopyState: text("export_copy_state", {
      enum: ["pending", "ready", "unavailable"],
    }),
    exportR2Key: text("export_r2_key"),
    exportSizeBytes: integer("export_size_bytes"),
  },
  (table) => [
    uniqueIndex("file_version_r2_key_unique_index").on(table.r2Key),
    uniqueIndex("file_version_file_id_version_number_unique_index").on(
      table.fileId,
      table.versionNumber,
    ),
    index("file_version_status_index").on(table.status),
    // The upload dialog's "does the firm already hold these bytes" lookup, by the committed hash.
    index("file_version_content_sha256_index").on(table.contentSha256),
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

// Who was in the editing session when a version was cut from the working copy — every member with
// a view open, editor or reader, by identifier. The version's `uploaded_by` names the one member whose
// save cut it; this names everyone who could have written the words in it. Not a foreign key to the
// member row, on the same terms as `uploaded_by`: the fact outlives the member.
export const fileVersionParticipant = sqliteTable(
  "file_version_participant",
  {
    versionId: text("version_id")
      .notNull()
      .$type<FileVersionId>()
      .references(() => fileVersion.id),
    memberUserId: text("member_user_id").notNull().$type<UserId>(),
  },
  (table) => [primaryKey({ columns: [table.versionId, table.memberUserId] })],
);

// One tracked change a version carries that no earlier version of the file carried: who wrote or
// removed which words, and where. Read from the document itself when the version's export copy is
// made (the marks are the document's own record; the platform never re-derives them from a text
// comparison), one row per mark, the author resolved to a member at that moment. The author's name
// is kept as the document holds it beside the resolution, so a mark whose name resolves to nobody
// is kept rather than dropped. Not a foreign key to the member row, on the same terms as
// `uploaded_by`. The words are capped (`text_truncated`), since a row is a record of a change and
// not a second copy of the document.
export const fileVersionChange = sqliteTable(
  "file_version_change",
  {
    versionId: text("version_id")
      .notNull()
      .$type<FileVersionId>()
      .references(() => fileVersion.id),
    // Document order within the version, from zero.
    sequence: integer("sequence").notNull(),
    kind: text("kind", {
      enum: ["insertion", "deletion", "formatting"],
    }).notNull(),
    authorName: text("author_name").notNull(),
    authorUserId: text("author_user_id").$type<UserId>(),
    changedAt: text("changed_at"),
    text: text("text").notNull(),
    textTruncated: integer("text_truncated").notNull().default(0),
    // The package part the change sits in, and the paragraph within it, counted from zero.
    part: text("part").notNull(),
    paragraphIndex: integer("paragraph_index").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.versionId, table.sequence] }),
    check(
      "file_version_change_kind_check",
      sql`${table.kind} IN ('insertion', 'deletion', 'formatting')`,
    ),
  ],
);

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
    lockType: text("lock_type", {
      enum: ["exclusive", "offline_working_copy"],
    }).notNull(),
    baseVersionId: text("base_version_id")
      .notNull()
      .$type<FileVersionId>()
      .references(() => fileVersion.id),
    acquiredAt: text("acquired_at").notNull(),
    lastActivityAt: text("last_activity_at").notNull(),
    status: text("status", {
      enum: ["active", "stale", "released", "reconciling"],
    })
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
    status: text("status", {
      enum: ["open", "completed", "aborted", "expired"],
    }).notNull(),
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
  (table) => [
    primaryKey({
      columns: [table.storageClass, table.artifactRole, table.prefix],
    }),
  ],
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
// route and its outbox→Queue seam (`incident.created`, no consumer yet) live in apps/api-worker. JSON
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
    // The person's pronouns, as the person states them and the firm records them. NEVER derived —
    // not from a given name, not from a courtesy title, not from any other column — because a
    // guessed pronoun misgenders a real person in a document that gets filed.
    //
    // THE WHOLE DECLENSION IS STORED, not a label and not a code. A two-form label ("she/her") does
    // not determine the possessive, the possessive pronoun, or the reflexive for a set nobody here
    // has seen, so a label would need a lookup table — which is a closed enum in disguise, and the
    // sets it lacks are exactly the ones a person is most often asked to accept a wrong rendering
    // of. Five columns let a template render every grammatical position for any set, including one
    // this platform has never heard of, with no code change.
    pronounSubject: text("pronoun_subject"), // "she", "he", "they", "xe"
    pronounObject: text("pronoun_object"), // "her", "him", "them", "xem"
    pronounPossessiveDeterminer: text("pronoun_possessive_determiner"), // "her book", "their book"
    pronounPossessivePronoun: text("pronoun_possessive_pronoun"), // "the book is hers"
    pronounReflexive: text("pronoun_reflexive"), // "she represented herself"
    // Which verb form the set takes — "she is" against "they are". Stored rather than derived
    // because nothing in the five forms says it: "they" agrees plurally and "xe" singularly, and
    // no rule over the letters tells them apart.
    pronounVerbNumber: text("pronoun_verb_number"), // 'singular' | 'plural'
    // A DATE OF BIRTH IS A FACT ABOUT A PERSON, NOT AN IDENTIFIER OF ONE, and it is stored here as
    // an ordinary ISO date rather than as a sealed directory_identifier row. It used to be the
    // latter, which is why a firm could not record one usefully: the identifier table matches by
    // exact blind index, a date of birth is too low-entropy to index safely, and so the code
    // deliberately refused to index it. Every question a firm actually asks of a date of birth is a
    // RANGE — is this client a minor, has a limitation period tolled, is this person over
    // sixty-five, whose birthday falls this month — and a range query over ciphertext is not a
    // query. Filing it as an identifier made it unaskable.
    //
    // Held in the clear on the same reasoning as the pronoun columns above it: it is printed in
    // pleadings, discovery responses and court forms all day, so a permission gate and an audit row
    // on every document render buys no confidentiality against a member who already has the file
    // open, and costs enough that the practical result is a firm that stops recording it. It is
    // registered in the erasure registry (packages/data-access/src/pii-registry.ts) and covered by
    // the standing redaction default, so erasure reaches it and no log line ever carries it.
    //
    // The `dob` identifier type is NOT dropped. Values already sealed under it stay readable
    // forever; it is closed to new writes.
    dateOfBirth: text("date_of_birth"), // ISO 8601 date, no time
    // Wanted by a consumer that already exists: the schema carries decedent_entity_id for an estate
    // and had nowhere to record when that person died.
    dateOfDeath: text("date_of_death"), // ISO 8601 date, no time
    // Separate from the date because "known dead, date unknown" is a state probate work meets
    // constantly and a nullable date alone cannot express it. The write path holds the implication
    // that a recorded date of death means deceased; a CHECK cannot be added to a table that already
    // holds rows without rebuilding it.
    deceased: integer("deceased").notNull().default(0), // 0/1
    status: text("status").notNull().default("active"), // 'active' | 'merged_into'
    mergedIntoId: text("merged_into_id").$type<DirectoryPersonId>(), // set when status = 'merged_into'
    needsReview: integer("needs_review").notNull().default(0), // 0/1; set by provisional imports awaiting review
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
    deletedAt: text("deleted_at"),
  },
  (table) => [
    // The member mapping, sought by the staffing merge read (a member's name parts and bar number
    // live on their mapped Directory person). Partial: most Directory persons map to no member.
    index("directory_person_member_id_index")
      .on(table.memberId)
      .where(sql`${table.memberId} IS NOT NULL`),
    check("directory_person_status_check", sql`${table.status} IN ('active', 'merged_into')`),
    check("directory_person_needs_review_check", sql`${table.needsReview} IN (0, 1)`),
    check("directory_person_deceased_check", sql`${table.deceased} IN (0, 1)`),
    check(
      "directory_person_pronoun_verb_number_check",
      sql`${table.pronounVerbNumber} IS NULL OR ${table.pronounVerbNumber} IN ('singular', 'plural')`,
    ),
    // A PRONOUN SET IS ONE VALUE, so a half-recorded one must not be storable: a row holding "she"
    // and nothing else is what renders "she … them" in the same sentence, which is the exact defect
    // this field exists to prevent. All six together or all six absent — the constraint that makes
    // "partial" unrepresentable rather than merely discouraged.
    check(
      "directory_person_pronoun_complete_check",
      sql`(${table.pronounObject} IS NULL) = (${table.pronounSubject} IS NULL)
        AND (${table.pronounPossessiveDeterminer} IS NULL) = (${table.pronounSubject} IS NULL)
        AND (${table.pronounPossessivePronoun} IS NULL) = (${table.pronounSubject} IS NULL)
        AND (${table.pronounReflexive} IS NULL) = (${table.pronounSubject} IS NULL)
        AND (${table.pronounVerbNumber} IS NULL) = (${table.pronounSubject} IS NULL)`,
    ),
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
    // Two derived keys BESIDE normalized_display, never instead of it. normalized_display is a frozen
    // contract stored across every firm; these layer on its output so `Smith & Jones LLP` and
    // `Smith and Jones, L.L.P.` compare equal (match key) and `Smith & Jones LLC` meets them one step
    // weaker (bare key, legal form removed). Nullable because they are backfilled over an existing
    // corpus rather than added with a default; the fitness probe reports the outstanding count while
    // that runs. Derived in packages/directory/src/match-key.ts.
    normalizedMatchKey: text("normalized_match_key"),
    normalizedMatchKeyBare: text("normalized_match_key_bare"),
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
    index("directory_name_normalized_match_key_index").on(table.normalizedMatchKey),
    index("directory_name_normalized_match_key_bare_index").on(table.normalizedMatchKeyBare),
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
// separate rows so every row carries a single scalar code). The open length() check rather than a
// closed IN(...) enumeration lets the application layer add a scheme without a migration.
//
// The primary key is (name_id, scheme), so this table holds at most ONE code per name per scheme.
// That fits an encoder returning a fixed, small number of codes and nothing else: an encoder whose
// output is a VARIABLE SET per name — Beider-Morse returns tens of phonemes for one surname — needs a
// table keyed by the code instead. The open CHECK on `scheme` is therefore only half a seam, and a
// reader planning a new encoder needs both halves.
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

// The nickname equivalence catalogue — `Bob`/`Robert`, `Peggy`/`Margaret`. These are not phonetic
// relationships and no algorithm derives them; they are curated data, and curating them carries a
// licensing question this platform has not answered.
//
// So the table SHIPS EMPTY, deliberately, and that is the point of shipping it at all: an empty
// catalogue makes every conflicts check record `nickname_equivalence` as a source it could not
// search, which is a different statement from omitting the dimension and letting a reader assume it
// was covered. A firm reading its own check log can see the gap. Populating it is a later slice.
//
// One row per DIRECTED pair, so a curator can record that `Bob` implies `Robert` without asserting
// the reverse; the read side unions both directions when it eventually has data to union.
export const nicknameEquivalence = sqliteTable(
  "nickname_equivalence",
  {
    nameForm: text("name_form").notNull(),
    equivalentForm: text("equivalent_form").notNull(),
    source: text("source").notNull(), // where the curator took the pair from
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.nameForm, table.equivalentForm] }),
    index("nickname_equivalence_equivalent_form_index").on(table.equivalentForm),
    check("nickname_equivalence_name_form_check", sql`length(${table.nameForm}) > 0`),
    check("nickname_equivalence_equivalent_form_check", sql`length(${table.equivalentForm}) > 0`),
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
    // The plaintext part of an identifier that a list may show without a reveal: the region that
    // issued a licence, the jurisdiction that issued a bar number, who an account is held with.
    // Never the value or any part of it. Null for a type with nothing to say beside the seal (SSN).
    label: text("label"),
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

// One authorized external account per category (the grant). Firm-scoped (shipping) or member-scoped
// (a member's own calendar account); the unique index keys it on (category, principal), so a firm or
// a member has exactly one connection per category.
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
    // Which account at the provider this is, as the provider names it (a member's own sign-in
    // address). A member with two accounts at one provider has to be able to see which one they
    // connected. Null on a connection that has no such name, as a firm's API-key account does not.
    accountLabel: text("account_label"),
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

// A connected integration's credential, encrypted at rest under the firm key, addressed by the
// `credential_ref` its integration_connection row carries. Values are ciphertext only; the
// encrypt/decrypt and the access gate live in @magna-carta/data-access.
//
// WHY THIS IS NOT firm_secret. Both hold a sealed value and the shapes are nearly identical, but the
// permission that governs reading them is not. firm_secret is the firm's own vault — reading any
// entry means holding firm:manageSecrets, which is the right gate for an administrator and the wrong
// one for the act this column exists for: a member buying postage is not reading a secret, the worker
// is using a credential on their behalf, and that member holds shipping:manage rather than the keys to
// everything the firm has sealed. A protected column carries exactly one declaration and the decrypt
// gate is that declaration's permission, so the two acts cannot be told apart while they share a
// column. They are separated here instead: this column is declared under integrations:useConnection,
// and firm_secret keeps its administrator gate unweakened.
export const integrationCredential = sqliteTable("integration_credential", {
  id: text("id").primaryKey().$type<IntegrationCredentialId>(), // integrationCredential_ handle
  credentialRef: text("credential_ref").notNull().unique(),
  ciphertext: text("ciphertext").notNull(),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

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

// A DIRECTORY RECORD'S PICTURE — a person's photograph or an organization's logo. The member_photo
// shape, for the member_photo reasons: a separate table rather than columns on the node rows, so the
// reads that never draw a face never carry one, and one row per entity at most, keyed by the entity
// itself, so "no picture" is the absence of a row. entity_id names a person OR an organization (the
// handle's prefix says which), which is why it carries no foreign key, the same as every other
// entity-generic directory table.
//
// THE BYTES LIVE IN THE FIRM'S BUCKET and this row names them. Unlike member_photo the object key is
// scoped to the entity as well as to the bytes' hash, so two records holding the same image (a
// firm's own placeholder) never share an object that removing one of them would delete.
export const directoryEntityPhoto = sqliteTable(
  "directory_entity_photo",
  {
    entityId: text("entity_id").primaryKey(),
    sha256: text("sha256").notNull(),
    objectKey: text("object_key").notNull(),
    contentType: text("content_type").notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    // The intrinsic size, so a surface can reserve the space before the bytes arrive.
    widthPixels: integer("width_pixels").notNull(),
    heightPixels: integer("height_pixels").notNull(),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    check("directory_entity_photo_size_check", sql`${table.sizeBytes} > 0`),
    check(
      "directory_entity_photo_pixels_check",
      sql`${table.widthPixels} > 0 AND ${table.heightPixels} > 0`,
    ),
  ],
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
    contactUse: text("contact_use"), // 'work' | 'home' | 'other' | 'former' | 'temporary'
    // ── Whether the firm MAY use this contact point, and whether it SHOULD ──
    // Two different facts, and a single flag cannot hold both. `contact_permitted` is the person's
    // stated permission: a number they asked the firm never to ring is recorded rather than deleted,
    // because deleting it loses the instruction along with the value and the next member re-enters it.
    // `contact_preferred` is the route they asked to be reached by, and the write path keeps at most
    // one preferred contact point per entity ACROSS email, phone and address — "reach me by post" is
    // an answer about all three at once, which is why it cannot live in one table's own flag.
    //
    // `is_primary` is neither: it is this CHANNEL's default row, the address a message goes to when
    // the sender named no address. A person may be permitted three numbers, prefer email, and still
    // have a primary number.
    //
    // NOT a Rule 4.2 no-contact flag. A represented party may not be contacted about the subject of
    // ONE matter, which is a fact about that matter and stays matter-scoped and derived; this column
    // is the person's own standing preference and applies everywhere.
    contactPermitted: integer("contact_permitted").notNull().default(1), // 0/1
    contactPreferred: integer("contact_preferred").notNull().default(0), // 0/1
    contactNote: text("contact_note"), // why it may not be used, or how it should be
    // ── Whether the firm has confirmed this is still true ──
    // 'unverified' (default) | 'verified' | 'failed'. `failed` is returned mail, a bounced message, a
    // disconnected line. A failure is surfaced to whoever is about to send and NEVER blocks the send.
    verificationStatus: text("verification_status").notNull().default("unverified"),
    verifiedAt: text("verified_at"),
    verifiedBy: text("verified_by").$type<UserId>(),
    verificationDetail: text("verification_detail"), // what the failure said, in the words it said it
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
    check("directory_email_contact_permitted_check", sql`${table.contactPermitted} IN (0, 1)`),
    check("directory_email_contact_preferred_check", sql`${table.contactPreferred} IN (0, 1)`),
  ],
);

// Phone numbers for a directory entity. Temporal and type-labelled.
export const directoryPhone = sqliteTable(
  "directory_phone",
  {
    id: text("id").primaryKey().$type<DirectoryPhoneId>(), // directoryPhone_ handle
    entityId: text("entity_id").notNull(),
    label: text("label"), // legacy free text; retained read-only now the typed columns below exist
    // The number AS ENTERED, never overwritten. A number the parser cannot split is still stored and
    // still displayed; only the structured columns go null, so an unparseable input is recorded
    // honestly rather than guessed at or refused.
    number: text("number").notNull(),
    // What technology answers it ('voice' | 'fax' | 'sms' | 'pager') and in what context
    // ('work' | 'home' | 'mobile' | 'other' | 'former' | 'temporary'). Two columns because they are
    // orthogonal: one flat list holding both `fax` and `work` cannot express a work fax.
    contactSystem: text("contact_system"),
    contactUse: text("contact_use"),
    // The number split the way it is dialled. The country calling code and the national number are
    // separate so a dialler can reach the number from anywhere, and the extension is a third column
    // because E.164 has no extension concept and one embedded in the canonical string breaks every
    // downstream dialler. countryRegionCode records the region the number was read against, so a
    // re-parse is reproducible.
    countryCallingCode: text("country_calling_code"), // digits only, no leading '+'
    nationalNumber: text("national_number"), // digits only
    extension: text("extension"),
    countryRegionCode: text("country_region_code"), // ISO 3166-1 alpha-2
    isPrimary: integer("is_primary").notNull().default(0), // 0/1
    // ── Whether the firm MAY use this contact point, and whether it SHOULD ──
    // Two different facts, and a single flag cannot hold both. `contact_permitted` is the person's
    // stated permission: a number they asked the firm never to ring is recorded rather than deleted,
    // because deleting it loses the instruction along with the value and the next member re-enters it.
    // `contact_preferred` is the route they asked to be reached by, and the write path keeps at most
    // one preferred contact point per entity ACROSS email, phone and address — "reach me by post" is
    // an answer about all three at once, which is why it cannot live in one table's own flag.
    //
    // `is_primary` is neither: it is this CHANNEL's default row, the address a message goes to when
    // the sender named no address. A person may be permitted three numbers, prefer email, and still
    // have a primary number.
    //
    // NOT a Rule 4.2 no-contact flag. A represented party may not be contacted about the subject of
    // ONE matter, which is a fact about that matter and stays matter-scoped and derived; this column
    // is the person's own standing preference and applies everywhere.
    contactPermitted: integer("contact_permitted").notNull().default(1), // 0/1
    contactPreferred: integer("contact_preferred").notNull().default(0), // 0/1
    contactNote: text("contact_note"), // why it may not be used, or how it should be
    // ── Whether the firm has confirmed this is still true ──
    // 'unverified' (default) | 'verified' | 'failed'. `failed` is returned mail, a bounced message, a
    // disconnected line. A failure is surfaced to whoever is about to send and NEVER blocks the send.
    verificationStatus: text("verification_status").notNull().default("unverified"),
    verifiedAt: text("verified_at"),
    verifiedBy: text("verified_by").$type<UserId>(),
    verificationDetail: text("verification_detail"), // what the failure said, in the words it said it
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
    check("directory_phone_contact_permitted_check", sql`${table.contactPermitted} IN (0, 1)`),
    check("directory_phone_contact_preferred_check", sql`${table.contactPreferred} IN (0, 1)`),
    // The dialable form, sought when a number is looked up rather than displayed. Two columns
    // because the pair IS the canonical number; a third column holding them concatenated would be a
    // derived value to keep in sync forever.
    index("directory_phone_national_number_index").on(
      table.countryCallingCode,
      table.nationalNumber,
    ),
  ],
);

// Structured postal addresses for a directory entity (street, city, region, postal, country).
// Temporal and type-labelled; is_primary is enforced in the write path.
export const directoryAddress = sqliteTable(
  "directory_address",
  {
    id: text("id").primaryKey().$type<DirectoryAddressId>(), // directoryAddress_ handle
    entityId: text("entity_id").notNull(),
    label: text("label"), // legacy free text; retained read-only now addressUse/addressType exist
    // THE FIELD SET IS THE INTERNATIONAL ONE, not the American one. Which fields a country uses,
    // what they are called and what order they read in all vary — Japan writes the postal code
    // first, Ireland has no state at all, Brazil has a neighbourhood line — so the columns are named
    // for their POSITION in a postal address rather than for what one country calls them, following
    // the address-internationalization field set: recipient, organization, address lines, dependent
    // locality, locality, administrative area, postal code, sorting code, country. Nothing here
    // assumes a state and a five-digit ZIP.
    recipient: text("recipient"), // the addressee line, where it differs from the entity's own name
    organizationName: text("organization_name"), // the care-of organization line
    street: text("street"), // first address line
    streetTwo: text("street_two"), // second address line — a suite or unit had nowhere to go
    dependentLocality: text("dependent_locality"), // neighbourhood, district, suburb, county
    city: text("city"), // locality
    region: text("region"), // administrative area — state, province, prefecture, county
    postal: text("postal"), // postal code
    sortingCode: text("sorting_code"), // CEDEX and its equivalents
    country: text("country"), // ISO 3166-1 alpha-2
    // Context, and whether the place physically exists. Personal service turns on the second: a post
    // office box is 'postal' and cannot be served; a registered office is 'physical' and can.
    addressUse: text("address_use"),
    addressType: text("address_type"), // 'physical' | 'postal' | 'both'
    // Lowercased, punctuation-stripped concatenation of the address lines — the duplicate-detection
    // key, mirroring what normalized_address does for email. Nullable: a row predating the write path
    // has none, and the write path always populates it.
    normalizedKey: text("normalized_key"),
    isPrimary: integer("is_primary").notNull().default(0), // 0/1
    // ── Whether the firm MAY use this contact point, and whether it SHOULD ──
    // Two different facts, and a single flag cannot hold both. `contact_permitted` is the person's
    // stated permission: a number they asked the firm never to ring is recorded rather than deleted,
    // because deleting it loses the instruction along with the value and the next member re-enters it.
    // `contact_preferred` is the route they asked to be reached by, and the write path keeps at most
    // one preferred contact point per entity ACROSS email, phone and address — "reach me by post" is
    // an answer about all three at once, which is why it cannot live in one table's own flag.
    //
    // `is_primary` is neither: it is this CHANNEL's default row, the address a message goes to when
    // the sender named no address. A person may be permitted three numbers, prefer email, and still
    // have a primary number.
    //
    // NOT a Rule 4.2 no-contact flag. A represented party may not be contacted about the subject of
    // ONE matter, which is a fact about that matter and stays matter-scoped and derived; this column
    // is the person's own standing preference and applies everywhere.
    contactPermitted: integer("contact_permitted").notNull().default(1), // 0/1
    contactPreferred: integer("contact_preferred").notNull().default(0), // 0/1
    contactNote: text("contact_note"), // why it may not be used, or how it should be
    // ── Whether the firm has confirmed this is still true ──
    // 'unverified' (default) | 'verified' | 'failed'. `failed` is returned mail, a bounced message, a
    // disconnected line. A failure is surfaced to whoever is about to send and NEVER blocks the send.
    verificationStatus: text("verification_status").notNull().default("unverified"),
    verifiedAt: text("verified_at"),
    verifiedBy: text("verified_by").$type<UserId>(),
    verificationDetail: text("verification_detail"), // what the failure said, in the words it said it
    validFrom: text("valid_from"),
    validTo: text("valid_to"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
    deletedAt: text("deleted_at"),
  },
  (table) => [
    index("directory_address_entity_id_index").on(table.entityId),
    check("directory_address_is_primary_check", sql`${table.isPrimary} IN (0, 1)`),
    check("directory_address_contact_permitted_check", sql`${table.contactPermitted} IN (0, 1)`),
    check("directory_address_contact_preferred_check", sql`${table.contactPreferred} IN (0, 1)`),
    index("directory_address_normalized_key_index").on(table.normalizedKey),
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
    // The capacity the party acts in on THIS matter — "Administrator", "Trustee",
    // "Attorney-in-fact". A fact about the link, not about the entity: the same person is an
    // administrator on one matter and a beneficiary on the next. Free text the firm records;
    // never inferred, so an unrecorded capacity is an honest absence wherever a document asks.
    capacity: text("capacity"),
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

// Firm-defined fields that extend matter, entity (directory contact), or matter-asset records with
// arbitrary typed data. kind controls which value_* column is populated in custom_field_value;
// attachment_id scopes the field within its target — a matter type, an entity category, or an asset
// class (null = applies to all of that target).
// number_scale is the number of decimal places implied by value_number (integer storage).
//
// `target` carries no CHECK and never has: the column is a bare TEXT and the enum below is a
// TypeScript type that emits no SQL, which is why widening it takes no migration. The vocabulary's
// one home is CUSTOM_FIELD_TARGETS in @magna-carta/custom-fields; this list is restated here only
// because a schema package cannot import a domain package that imports it, and
// packages/custom-fields/test/schema-name-sync.test.ts fails if the two ever disagree.
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
    target: text("target", {
      enum: ["matter", "entity", "matterAsset"],
    }).notNull(),
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
    tier: text("tier", {
      enum: ["matter", "client", "timekeeper", "role"],
    }).notNull(),
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
    codeSet: text("code_set", {
      enum: ["task", "activity", "expense"],
    }).notNull(),
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
    // The task this time was worked on, if the timekeeper named one. Nullable and expected to be
    // null on most rows: time is captured against a matter, and naming a task is an extra the
    // timekeeper chooses. ONE task per entry, never a set — an entry split across two tasks is a
    // narrative problem (write two entries), and a set would need an allocation of the minutes
    // between them, which turns a link into a second ledger. The task must be on this entry's own
    // matter; the service refuses anything else, including a task on no matter at all.
    taskId: text("task_id")
      .$type<MatterTaskId>()
      .references(() => matterTask.id),
    invoiceId: text("invoice_id"), // set at billing; null until billed
    // The reviewer's note set on kick-back, cleared when the timekeeper resubmits. Stored here
    // (not audit_log.metadata) so it inherits the entry's tenancy, RBAC, and retention, and
    // can be read back by the timekeeper without a privileged audit-log read.
    kickBackReason: text("kick_back_reason"),
    // The firm's own note about the entry — one audience, the firm. It never reaches a bill, a
    // print sheet, the client portal, or audit_log.metadata (an audit row records THAT the memo
    // changed, never what it says). Nullable: most entries carry none.
    memo: text("memo"),
    // The matter-scoped human reference, e.g. "2026-0147.0042" — the matter's number, a dot, and a
    // zero-padded per-matter sequence drawn at capture. Immutable once assigned and never reused (a
    // void keeps its number). Null on every entry captured before the sequence existed: an honest
    // gap, never a backfilled guess.
    entryNumber: text("entry_number"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
    createdBy: text("created_by"), // actor user handle (not an FK)
  },
  (table) => [
    // Rendered-string backstop, mirroring matter_number: the allocation primary key catches the
    // counter race; this catches a rendered collision the counter cannot see. Partial, so the
    // pre-sequence null rows stay unconstrained.
    uniqueIndex("time_entry_entry_number_unique_index")
      .on(table.entryNumber)
      .where(sql`${table.entryNumber} IS NOT NULL`),
    index("time_entry_timekeeper_work_date_index").on(table.timekeeperUserId, table.workDate),
    index("time_entry_matter_status_index").on(table.matterId, table.status),
    index("time_entry_status_work_date_index").on(table.status, table.workDate),
    // The firm-wide period read behind /time when it is asked for everybody's time: a date range
    // with no timekeeper and no status. The (timekeeper_user_id, work_date) index above serves the
    // same read narrowed to one person, and the (status, work_date) index serves it narrowed to one
    // status; neither has work_date in its leading position, so the unnarrowed range had nothing to
    // ride and walked the table.
    index("time_entry_work_date_index").on(table.workDate),
    // The grouped read behind "how long did this task actually take". Partial, because the column
    // is null on nearly every row and an index over those nulls would be mostly dead weight.
    index("time_entry_task_index")
      .on(table.taskId)
      .where(sql`${table.taskId} IS NOT NULL`),
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

// The per-matter entry-number sequence (scope_key = the matter id). Same two-table draw as the
// matter and invoice numbers, through @magna-carta/sequence-numbering: the counter row is what a
// drawer reads, the allocation primary key is what aborts a losing draw's whole batch.
export const timeEntryNumberCounter = sqliteTable("time_entry_number_counter", {
  scopeKey: text("scope_key").primaryKey(), // the matter id — one sequence per matter
  nextValue: integer("next_value").notNull(),
});

export const timeEntryNumberAllocation = sqliteTable(
  "time_entry_number_allocation",
  {
    scopeKey: text("scope_key").notNull(), // the time_entry_number_counter row this value came from
    drawnValue: integer("drawn_value").notNull(), // the counter value this draw consumed
    timeEntryId: text("time_entry_id")
      .notNull()
      .$type<TimeEntryId>()
      .references(() => timeEntry.id),
    allocatedAt: text("allocated_at").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.scopeKey, table.drawnValue] }),
    index("time_entry_number_allocation_time_entry_id_index").on(table.timeEntryId),
  ],
);

// A time entry's attached files — references to documents already in the entry's matter, many per
// entry. Detaching deletes THIS row only; the file stays in the matter (the audit trail keeps the
// attach/detach history). The attach path refuses a file on another matter, so an entry can never
// point outside its own matter's record.
export const timeEntryAttachment = sqliteTable(
  "time_entry_attachment",
  {
    timeEntryId: text("time_entry_id")
      .notNull()
      .$type<TimeEntryId>()
      .references(() => timeEntry.id),
    fileId: text("file_id")
      .notNull()
      .$type<FileId>()
      .references(() => file.id),
    createdAt: text("created_at").notNull(),
    createdBy: text("created_by"), // actor user handle (not an FK); null for system writes
  },
  (table) => [
    primaryKey({ columns: [table.timeEntryId, table.fileId] }),
    index("time_entry_attachment_file_id_index").on(table.fileId),
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
    // The firm-wide period read behind /costs when it is asked for every matter's cost: a date
    // range with no matter and no status. The (matter_id, status) index above serves the same read
    // narrowed to one matter, and the (status, incurred_date) index serves it narrowed to one
    // status; neither has incurred_date in its leading position, so the unnarrowed range had
    // nothing to ride and walked the table.
    index("cost_entry_incurred_date_index").on(table.incurredDate),
    uniqueIndex("cost_entry_recovery_ref_unique")
      .on(table.recoveryRef)
      .where(sql`${table.recoveryRef} IS NOT NULL`),
  ],
);

// Fees WIP — one flat charge for professional services, typed by hand.
//
// The THIRD work-in-progress record, beside time_entry and cost_entry, and the one that had nowhere
// to live: an hourly matter's fee value is the time ledger's and reaches a bill as a consolidated
// line at compose time, and a flat-fee arrangement's amount is the arrangement's. A fee somebody
// simply decided to charge was neither, so it was recorded nowhere at all.
//
// It is NEVER computed from time entries. The amount is what somebody decided to charge, which is
// the whole reason it needs a row rather than a projection over invoice lines: a projection can
// show only what a bill has already taken up, and what a work-in-progress ledger is for is the part
// no bill has reached yet.
//
// Column-for-column the disbursement record wherever the fact is the same; different only where the
// domain is. A cost has a payee, a receipt and a hard/soft class; a fee has a timekeeper and none of
// those.
export const feeEntry = sqliteTable(
  "fee_entry",
  {
    id: text("id").primaryKey().$type<FeeEntryId>(),
    matterId: text("matter_id")
      .notNull()
      .references(() => matter.id),
    // The date the charge is FOR — the day the work was done — which anchors the ledger exactly as a
    // cost's incurred date does and is a different fact from created_at, the day somebody wrote it
    // down. Named for the service rather than the fee because the money-ish name conformance gate
    // flags any column containing "fee" and requires a *_minor suffix; cost_entry's incurred_date
    // sidesteps the same gate the same way.
    serviceDate: text("service_date").notNull(),
    // Whose professional services the charge is for. Not a foreign key, for the reason created_by
    // is not one: whose work was charged is a fact about the past that outlives the membership.
    timekeeperUserId: text("timekeeper_user_id").$type<UserId>(),
    description: text("description").notNull().default(""),
    amountMinor: integer("amount_minor").notNull(),
    currency: text("currency").notNull(),
    billable: integer("billable").notNull(), // 0/1
    status: text("status").notNull(), // draft|submitted|approved|billed|void
    kickBackReason: text("kick_back_reason"),
    // The mirror set at finalization, so a billed fee names its bill without a join. The CLAIM is
    // the truth about who holds a fee; this is what a read can carry cheaply.
    invoiceId: text("invoice_id"),
    // For the firm alone. It never reaches a bill, a print sheet or the client portal.
    memo: text("memo"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
    createdBy: text("created_by").$type<UserId>(),
  },
  (table) => [
    check(
      "fee_entry_status_check",
      sql`${table.status} IN ('draft','submitted','approved','billed','void')`,
    ),
    check("fee_entry_billable_check", sql`${table.billable} IN (0,1)`),
    check("fee_entry_currency_check", sql`${table.currency} IN ('USD')`),
    // A fee is a charge somebody decided on, so a zero or negative one is a record of nothing. A
    // reduction is a discount line on the bill, which is a different act with a different audit.
    check("fee_entry_amount_check", sql`${table.amountMinor} > 0`),
    // The matter's own section: every fee on one file, in every status.
    index("fee_entry_matter_status_index").on(table.matterId, table.status),
    // The firm-wide period read: a date range across every matter, with no matter and no status.
    // Taken at birth rather than retrofitted — cost_entry needed this one added a day later, once a
    // screen existed that walked the table without it.
    index("fee_entry_service_date_index").on(table.serviceDate),
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
    // Null for a pre-consult check against a consultation party set that has no matter yet.
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
    // How the run was started: 'manual' | 'event' | 'schedule'. NULL on every row written before the
    // automated paths existed, and on any run a person asked for, which reads exactly as it always
    // did. Kept beside actor_user_id rather than derived from it: an absent actor says nobody is
    // being credited with the run, not what set it going.
    triggerSource: text("trigger_source"),
    // The corpus changes an automated run covers, as recorded JSON — several accumulated causes
    // collapse into ONE check that names them all, never into a check that names one and forgets the
    // rest. NULL for a manual run, which has no cause but the person who asked.
    causeJson: text("cause_json"),
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
    // The FIRM-WIDE history, newest first. The index above leads with the matter, so it serves a
    // matter's own history and cannot serve a listing across every matter — the load-profile plan
    // probe measured that read as a full table scan of a log that only grows, which is a listing
    // that gets slower every week the firm operates. This one leads with the sort key instead, so
    // the walk stops at the page rather than reading the table and sorting it.
    index("conflicts_check_created_id_index").on(table.createdAt, table.id),
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
    // Where in the firm's own records a content result was found: JSON {kind, id, matterId, at},
    // the kind one of call, text, email, task or magnus_conversation. Identifiers and an instant
    // only, never a subject line or a message, because this log outlives every record it points
    // at. NULL on a Directory result, and on every row written before the firm's own records were
    // searched.
    foundInJson: text("found_in_json"),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    index("conflicts_hit_check_id_index").on(table.checkId),
    // "What has this firm already said about this party?" — asked of every hit of a check at once,
    // to show a reviewer an earlier answer as CONTEXT. Without an index leading with entity_id that
    // read scans conflicts_hit, which is append-only and only grows, so the cost would rise every
    // week the firm operates. created_at follows it so the walk per entity is already in time order.
    index("conflicts_hit_entity_created_index").on(table.entityId, table.createdAt),
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
    // ---- the waiver's own record -------------------------------------------------------------
    //
    // What a firm is actually asked to produce when somebody questions a waiver is the client's
    // informed consent CONFIRMED IN WRITING, not a sentence saying one was obtained. These four
    // columns are that record. All four are null on the other three kinds — a database trigger
    // refuses a non-waiver row that carries any of them — and null on a waiver row written before
    // they existed, which reads as the row not saying rather than as a waiver given by nobody.
    //
    // Who consented. A Directory entity handle, carried the way conflicts_hit.entity_id is and for
    // the same reason: an entity is a directory_person OR a directory_organization, so no single
    // foreign key can name it. The consenting party is a real record in the firm's Directory, never
    // a typed-in name — a waiver whose giver cannot be looked up is the free-text sentence this
    // whole record replaces.
    waiverGivenByEntityId: text("waiver_given_by_entity_id"),
    // Whether the consent was confirmed in writing, as a fact in its own right. Deliberately NOT
    // inferred from the presence of a filed document: consent confirmed in a writing the firm has
    // not filed here, and a document filed against consent nobody confirmed, are different states,
    // and a boolean derived from the file id could not tell them apart.
    waiverConfirmedInWriting: integer("waiver_confirmed_in_writing"),
    // The filed document evidencing the confirmation — an ordinary matter file, like
    // matter_asset_valuation.supporting_file_id. A reference the firm can actually produce on
    // demand, rather than a string naming a document nothing can fetch.
    waiverDocumentFileId: text("waiver_document_file_id")
      .$type<FileId>()
      .references(() => file.id),
    // When the waiver was GIVEN, as a civil date — a different fact from created_at, which is when
    // this row was written. A waiver given on Tuesday and recorded on Friday has to be able to say
    // both, because the interval is exactly what a reviewer is asked about.
    waiverGivenOn: text("waiver_given_on"),
  },
  (table) => [
    index("conflicts_disposition_hit_id_created_at_index").on(table.hitId, table.createdAt),
    check(
      "conflicts_disposition_kind_check",
      sql`${table.kind} IN ('cleared', 'waiver_obtained', 'wall_erected', 'representation_declined')`,
    ),
  ],
);

// THE CHECK A PERSON REFERS TO, AND THE RUNS UNDER IT.
//
// `conflicts_check` above is the immutable record of ONE search — what ran, over what, and what it
// found. It is what a court is shown, so it never moves. But the thing a firm refers to out loud is a
// CHECK: "CC-0042", run when the caller first rang, run again when the matter opened, filed on the
// matter once there was one. That is a record with a number, a history and a matter that can be
// assigned after the fact, and none of those can live on an append-only row. So two mutable tables
// sit over the log: the numbered check, and the runs that belong to it.
//
// A CHECK IS IDENTIFIED BY ITS FIRST RUN'S HANDLE, and every run is identified by the handle of the
// search record it writes — a run's id IS the `conflicts_check.id` its search lands under once it
// completes. So `/conflicts/checks/{id}` accepts a numbered check's id or any run's id and resolves
// to the check, every address written before the runs existed still lands on the check it named,
// and no new identifier kind was needed for a thing that is, in the domain's own words, a conflicts
// check.
export const conflictsNumberedCheck = sqliteTable(
  "conflicts_numbered_check",
  {
    id: text("id").primaryKey().$type<ConflictsCheckId>(),
    // The counter value the draw consumed, under the scheme's scope, and the rendered number a
    // person actually says — stored beside it so the log lists and searches that. Drawn through
    // the firm's conflicts check numbering scheme (the conflicts_check_number_counter below), so the
    // sequence restarts wherever the scheme's scoping parts say it does and is unique only together
    // with the scope; the rendered number is what is unique on its own.
    checkSequence: integer("check_sequence").notNull(),
    checkNumber: text("check_number").notNull(),
    // Where the check is FILED. Null for the pre-engagement screen — a check run on a name given
    // over the telephone — and set later from the check's own screen once a matter exists. This is
    // the one column here that moves after the fact, and it is the reason the numbered check is not
    // the append-only search record: the matter a search ran against stays on that record.
    subjectMatterId: text("subject_matter_id").$type<MatterId>(),
    // The run most recently opened under this check: a plain handle rather than a foreign key,
    // because the run references this row and a key in both directions would make the first
    // insert impossible to order.
    latestRunId: text("latest_run_id").$type<ConflictsCheckId>(),
    // Null on an automated check, which is nobody's act.
    createdByUserId: text("created_by_user_id").$type<UserId>(),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("conflicts_numbered_check_number_unique_index").on(table.checkNumber),
    // A matter's own checks, newest first, and the firm-wide log in the same order.
    index("conflicts_numbered_check_matter_created_index").on(
      table.subjectMatterId,
      table.createdAt,
      table.id,
    ),
    index("conflicts_numbered_check_created_id_index").on(table.createdAt, table.id),
    check("conflicts_numbered_check_sequence_check", sql`${table.checkSequence} > 0`),
    check("conflicts_numbered_check_number_check", sql`length(${table.checkNumber}) > 0`),
  ],
);

// The conflicts check number counter, one row per {firm, scope_key} — the same ensure-row +
// guarded-increment shape matter_number_counter carries, for the same reason: concurrent draws must
// yield distinct, sequential numbers with no interactive transaction available. The check number
// used to be MAX(check_sequence) + 1 under a unique index; that gave the firm a shape it could not
// change, and a firm-wide four-digit run that every intake, party and automatic re-check drew from.
export const conflictsCheckNumberCounter = sqliteTable("conflicts_check_number_counter", {
  scopeKey: text("scope_key").primaryKey(),
  nextValue: integer("next_value").notNull(),
});

// One row per counter value a draw consumed. This composite primary key — not the unique index on the
// rendered check_number string — is the load-bearing backstop on the draw race, for the reason
// matter_number_allocation gives: a scheme may render different strings from the same counter value,
// so only a claim on the VALUE catches two draws that observed the same counter.
export const conflictsCheckNumberAllocation = sqliteTable(
  "conflicts_check_number_allocation",
  {
    scopeKey: text("scope_key").notNull(),
    drawnValue: integer("drawn_value").notNull(),
    checkId: text("check_id")
      .notNull()
      .$type<ConflictsCheckId>()
      .references(() => conflictsNumberedCheck.id),
    allocatedAt: text("allocated_at").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.scopeKey, table.drawnValue] }),
    index("conflicts_check_number_allocation_check_index").on(table.checkId),
  ],
);

// One run of a numbered check: opened before the search starts, so the screen watching it has a
// row to read, and settled when the search has written its record or failed to. The lifecycle is
// queued, running, completed, failed — and a run is the one conflicts row that is UPDATED, because
// it is a report on work in flight rather than the record of what the work found.
//
// `request_json` is the search as it was asked for, kept so a later run of the same check runs the
// same search (with the check's current matter) rather than whatever the panel would compose today.
export const conflictsCheckRun = sqliteTable(
  "conflicts_check_run",
  {
    // The handle the search record takes when it completes — see the numbered check above.
    id: text("id").primaryKey().$type<ConflictsCheckId>(),
    numberedCheckId: text("numbered_check_id")
      .notNull()
      .$type<ConflictsCheckId>()
      .references(() => conflictsNumberedCheck.id),
    // 1 for the first run, counting up: what the check screen's history is ordered by.
    ordinal: integer("ordinal").notNull(),
    status: text("status").notNull(),
    // Where a running search has got to (sources, walking, matching, candidates) and its counts so
    // far, as JSON. Null before the run starts and after it settles: a settled run's account is the
    // search record, never a stale progress line.
    stage: text("stage"),
    progressJson: text("progress_json"),
    requestJson: text("request_json").notNull(),
    trigger: text("trigger").notNull(),
    triggerSource: text("trigger_source"),
    requestedByUserId: text("requested_by_user_id").$type<UserId>(),
    startedAt: text("started_at"),
    // Written on every progress report. What tells a stale run from a slow one: a run whose
    // heartbeat has stopped is a run whose invocation died, and the read settles it as failed rather
    // than letting a screen poll a row nothing will ever finish.
    heartbeatAt: text("heartbeat_at"),
    finishedAt: text("finished_at"),
    // Why a failed run failed, in a sentence a reader can act on. Null unless the status is failed.
    failure: text("failure"),
    // Set when a member stopped the run. A cancelled run is settled with status 'failed' and these
    // two columns, rather than a fifth status: the status set is a CHECK constraint, and widening it
    // in SQLite rebuilds the table. A read reports such a run as cancelled, never as failed.
    cancelledAt: text("cancelled_at"),
    cancelledByUserId: text("cancelled_by_user_id").$type<UserId>(),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    uniqueIndex("conflicts_check_run_check_ordinal_unique_index").on(
      table.numberedCheckId,
      table.ordinal,
    ),
    check(
      "conflicts_check_run_status_check",
      sql`${table.status} IN ('queued', 'running', 'completed', 'failed')`,
    ),
    check("conflicts_check_run_ordinal_check", sql`${table.ordinal} > 0`),
  ],
);

// The re-check ledger: one row per corpus change that could alter an already-checked matter's
// answer, written when the change commits and satisfied later by the check that covers it.
//
// It exists because a queue message is not a record. A matter whose corpus moved has to be able to
// say "a re-check is owed because entity X was merged on 12 August" from the moment the merge
// commits — not from whenever a consumer gets round to it — and a drain that runs out of budget has
// to leave that fact visible rather than dropping it. The satisfied rows are the other half: the
// interval between a cause and the check that answered it is the evidence that the firm's procedure
// noticed something, which no check row on its own can show.
//
// Rows are never deleted and the cause columns are immutable; only the two satisfaction columns move,
// once, forwards. All three rules are enforced by triggers in the migration, not by convention.
export const conflictsRecheckRequest = sqliteTable(
  "conflicts_recheck_request",
  {
    id: text("id").primaryKey().$type<ConflictsRecheckRequestId>(),
    matterId: text("matter_id")
      .notNull()
      .$type<MatterId>()
      .references(() => matter.id),
    // The outbox topic that caused it, e.g. directory.entity.merged.
    causeTopic: text("cause_topic").notNull(),
    // The handle the cause is about — an entity, an edge, an identifier row, a matter party. Never a
    // value: an identifier cause names the identifier ROW and its type, so nothing sealed leaks into
    // a table that is read to build a report.
    causeReference: text("cause_reference").notNull(),
    causeOccurredAt: text("cause_occurred_at").notNull(),
    requestedAt: text("requested_at").notNull(),
    satisfiedByCheckId: text("satisfied_by_check_id").$type<ConflictsCheckId>(),
    satisfiedAt: text("satisfied_at"),
  },
  (table) => [
    // One OPEN request per (matter, cause): a queue redelivery re-derives the same three values and
    // is a no-op. Partial, so satisfying a request releases the key and the same cause recurring
    // later can be requested again.
    uniqueIndex("conflicts_recheck_request_open_cause_unique")
      .on(table.matterId, table.causeTopic, table.causeReference)
      .where(sql`${table.satisfiedAt} IS NULL`),
    // The drain: unsatisfied rows, oldest cause first.
    index("conflicts_recheck_request_satisfied_requested_index").on(
      table.satisfiedAt,
      table.requestedAt,
    ),
    // One matter's open requests — the posture read, and the per-matter claim the drain makes.
    index("conflicts_recheck_request_matter_satisfied_index").on(table.matterId, table.satisfiedAt),
    check("conflicts_recheck_request_cause_topic_check", sql`length(${table.causeTopic}) > 0`),
    check(
      "conflicts_recheck_request_cause_reference_check",
      sql`length(${table.causeReference}) > 0`,
    ),
    // Satisfied by a check and satisfied at a time are one fact, so they arrive together or not at
    // all — a row carrying one without the other would report an interval nothing closed.
    check(
      "conflicts_recheck_request_satisfaction_check",
      sql`(${table.satisfiedByCheckId} IS NULL) = (${table.satisfiedAt} IS NULL)`,
    ),
  ],
);

// Discovery search-index catalog: one row per immutable Tantivy split stored in the firm's R2. This is
// the authority a query enumerates to know which splits are live for a CORPUS — never an R2 bucket
// list, which would be slower and would not carry firm scoping structurally. Firm data (the index is
// durable per-firm data, unlike the transient scan/conversion artifacts), access-gated with the corpus
// it belongs to. A split is immutable: rows are inserted on publish and marked superseded by
// compaction, never mutated in place. `superseded_at IS NULL` is the live set.
export const indexSplit = sqliteTable(
  "index_split",
  {
    id: text("id").primaryKey().$type<IndexSplitId>(),
    // THE MATTER IS PROVENANCE, NOT SCOPE. It predates the widening of the index scope key from a
    // matter to a corpus and is kept because the per-firm lineage is additive; a review-set split
    // carries the matter its review set belongs to, so this column still says which file the index
    // work was done under. NOTHING enumerates a corpus by it — a review set's splits are reachable
    // only through corpus_id below, which is what makes a matter query structurally unable to name
    // material an opposing party produced under a protective order.
    matterId: text("matter_id").notNull().$type<MatterId>(),
    // Which corpus this split belongs to: the index's partition key, and the value the split's own R2
    // key is derived from. `matter` for a matter's File Manager documents, `reviewSet` for a discovery
    // review set's review documents. The kind is carried for readability and for a report that has to
    // say what a split is; the ID alone is what every scope read matches on, because an identifier is
    // a self-describing handle and two kinds can never collide on one.
    corpusKind: text("corpus_kind").notNull().default("matter"),
    // Nullable only because the column was added to a table that already existed. Every write binds
    // it, every scope read names it, and a row without one is therefore in no corpus and reachable by
    // no query — which is the safe direction for a column whose whole job is to keep two corpora apart.
    corpusId: text("corpus_id"),
    // The one document version this split indexes, for a split the write pipeline publishes. The write
    // pipeline builds one split per document version so a re-index converges: the split id is derived
    // from these two columns, a retry rebuilds the same split, and the publish deletes the document's
    // prior rows and objects before inserting the new one instead of accumulating duplicates.
    // Both are NULL for a split that spans many documents — the shape a later compaction pass publishes
    // when it merges the small per-document splits — so the merged split is simply unconstrained here.
    //
    // WHAT A DOCUMENT IS depends on the corpus: a File Manager file in a matter corpus, a review
    // document in a review-set corpus. A review document is already a version pin, so its version is
    // always 1 and the pin lives in the identifier.
    documentId: text("document_id").$type<FileId | ReviewDocumentId>(),
    version: integer("version"),
    // The split object's key in the firm's R2 bucket (e.g. search/<corpus>/splits/<id>.split).
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
    // The live-splits-for-a-corpus read: WHERE corpus_id = ? AND superseded_at IS NULL ORDER BY
    // created_at. This is the index every query and every compaction decision walks, and the sort
    // column is on the end so the enumeration comes back ordered from the index rather than through a
    // temporary b-tree — the order is what makes a compaction pass select the same set twice and
    // therefore derive the same merged split id.
    index("index_split_corpus_superseded_index").on(
      table.corpusId,
      table.supersededAt,
      table.createdAt,
    ),
    // Retained from before the widening. Nothing reads a corpus by matter any more; the index stays
    // because dropping one is a table rebuild against a table firms have already provisioned.
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

// What is inside a MERGED split. A split the write pipeline publishes carries its own document_id and
// version on the row above, so it needs no membership; a split compaction publishes covers many document
// versions and those columns are NULL, which would leave nothing able to say which versions it holds.
//
// The catalog has to be able to say, because a merged split is immutable and the corpus is not. When a
// document is re-indexed, its replacement is published as a new per-document split while the merged
// split still holds the older version's passages — and both are live. The membership is what lets the
// query path name that stale version to the engine as a per-split exclusion, so it stops matching
// immediately, and what lets the next compaction of that split pass the same id to the merge, which
// deletes it and repacks so the postings leave the bytes. Marking makes it stop matching; compaction
// makes it stop costing anything.
export const indexSplitMember = sqliteTable(
  "index_split_member",
  {
    // The merged split this membership belongs to (index_split.id).
    splitId: text("split_id").notNull().$type<IndexSplitId>(),
    documentId: text("document_id").notNull().$type<FileId | ReviewDocumentId>(),
    version: integer("version").notNull(),
    // Null while this document version is still the current one inside the split. Set to the instant a
    // re-index or a removal superseded it, which both excludes it from queries against this split and
    // makes the split a compaction candidate.
    supersededAt: text("superseded_at"),
  },
  (table) => [
    // A document version appears at most once in a given split.
    primaryKey({ columns: [table.splitId, table.documentId, table.version] }),
    // The query-path read: the stale members of the splits a corpus holds live.
    index("index_split_member_split_superseded_index").on(table.splitId, table.supersededAt),
    // The write-path read: every live split carrying any version of the document just re-indexed.
    index("index_split_member_document_index").on(table.documentId),
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
    referencesRemoteContent: integer("references_remote_content", {
      mode: "boolean",
    })
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
    sourceFormat: text("source_format", {
      enum: ["eml", "msg", "mboxMember"],
    }).notNull(),
    capturedVia: text("captured_via", {
      enum: ["forward", "api", "addin", "sync"],
    }).notNull(),
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
    capturedVia: text("captured_via", {
      enum: ["forward", "api", "addin", "sync"],
    }).notNull(),
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
    // The links a rule made — the undo half of the circuit-breaker feedback, and the review read of
    // what has been filing itself lately. PARTIAL, over the automatic links only, which is both the
    // only set either reader wants and the small one: a firm with no rules carries an empty index and
    // pays nothing for it on the capture path, and the index grows with rule activity rather than with
    // the firm's mail. Without it the undo derivation's `WHERE auto_file_rule_id = ?` subquery is a
    // scan of every link the firm holds, issued on the capture path the moment a rule matches.
    index("email_matter_link_auto_file_rule_created_index")
      .on(table.autoFileRuleId, table.createdAt, table.id)
      .where(sql`${table.autoFileRuleId} IS NOT NULL`),
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
    disposition: text("disposition", {
      enum: ["attachment", "inline"],
    }).notNull(),
    promotedFromInline: integer("promoted_from_inline", { mode: "boolean" })
      .notNull()
      .default(false),
    outcome: text("outcome", {
      enum: ["extracted", "filtered_inline", "oversize"],
    })
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
    kind: text("kind", {
      enum: ["threadContinuation", "correspondentMatter"],
    }).notNull(),
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
    outcome: text("outcome", {
      enum: ["filed", "staged", "suppressed"],
    }).notNull(),
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
// Calls and texts — the log of what the firm said down a phone line, on every channel that is not
// email.
// ---------------------------------------------------------------------------------------------

// One voice call or one SMS/MMS message. The LOG is the durable thing here, and the carrier is a
// producer of rows into it rather than the feature: a member typing in a call they made from their
// own mobile and a Telnyx webhook reporting the call it just carried write the same row, and
// `producer` is what says which. That is deliberate and load-bearing — it is what lets this table,
// and the two screens over it, exist before any carrier account does, since A2P 10DLC registration
// is weeks of procurement.
//
// EMAIL IS NOT HERE, and its absence is a decision rather than an omission. Mail already lives in
// the firm's own mailbox and is FILED onto a matter from there (`email_message` and its link table);
// its verb is route-what-exists. A call leaves no trace at all unless the platform makes one, so the
// verb here is cause-a-record-to-exist. One table for both would have to carry a threading model
// serving neither.
export const communication = sqliteTable(
  "communication",
  {
    id: text("id").primaryKey().$type<CommunicationId>(), // communication_ handle
    // THE NUMBER A PERSON SAYS OUT LOUD. A handle is what the platform joins on and it is not
    // something anybody can read back down a telephone; a firm that has just taken a call needs to
    // be able to name the record of it — on a message slip, in a note on the file, to the caller
    // themselves. It carries the day the call happened and a per-day sequence, so it sorts the way a
    // log is read and says when it happened without being looked up.
    //
    // Nullable, because the column lands on a table that already holds rows. The migration that adds
    // it numbers every one of them, so a null here means a row written by something that has not
    // been taught to draw one rather than a row that is allowed to go without.
    referenceNumber: text("reference_number"),
    channel: text("channel", { enum: ["voice", "sms", "mms"] }).notNull(),
    direction: text("direction", { enum: ["inbound", "outbound"] }).notNull(),
    // THE ANCHOR, and it is nullable for two different reasons worth keeping apart. An inbound text
    // from a number the firm has never seen belongs to nobody until a person files it — that is the
    // unrouted queue, and it is the whole reason the firm-wide screen exists. A member's own call
    // that genuinely concerns no file is the other.
    //
    // What it points at need NOT be a numbered matter. `matter.matter_number` is null until the
    // status reaches `open`, and an `intake` or a `consultation` is a real anchor a first contact
    // usually lands on — a firm texts a prospect before the file exists. So every read and every
    // picker over this column takes the matter's STATUS as the thing that must exist, never its
    // number (owner ruling, docs/specs/2026-09-07-call-and-text-log-design.md).
    matterId: text("matter_id")
      .$type<MatterId>()
      .references(() => matter.id),
    // The other end of the conversation. The number as dialled, in E.164 where the carrier gave it
    // to us; plus the Directory entity it resolves to, where it resolves to one. A plain entity id
    // with no cross-domain foreign key, on the matter_party precedent: the entity may be a person or
    // an organization, which are two tables.
    counterpartyNumber: text("counterparty_number").notNull(),
    counterpartyEntityId: text("counterparty_entity_id"),
    // The firm's end. Null on an inbound call nobody answered, which is a real and common row: the
    // call happened, the firm has a record of it, and no member was on it.
    memberUserId: text("member_user_id").$type<UserId>(),
    // WHEN IT HAPPENED, not when it was typed. A member logging Tuesday's call on Thursday records
    // Tuesday here and Thursday in created_at. An instant rather than the calendar's civil-date pair
    // because a call occupies a moment somebody can name, unlike a note about no particular time.
    occurredAt: text("occurred_at").notNull(),
    // WHEN THE CALL ENDED, which is a different fact from how long it ran (owner ruling,
    // 2026-09-08: a typed length "doesn't need to match calculation, considering people can be put
    // on hold"). The span from occurred_at to here is the time the line was open; duration_seconds
    // is the time that was actually spent on the call. A firm that bills the second and a firm that
    // records the first are both served, and a form that derived either from the other would be
    // asserting they are the same number. Null on a message, and null on a call nobody timed.
    endedAt: text("ended_at"),
    // Whole seconds, voice only. Null on a message, and null on a call whose length nobody recorded.
    durationSeconds: integer("duration_seconds"),
    // The message text for sms/mms. Null for voice, whose content is the recording and the
    // transcript that arrive with the later rungs; a member's account of a call goes in `summary`.
    body: text("body"),
    // What a member wrote down about a call — the part that makes a hand-logged call worth anything.
    // Kept apart from `body` so a read never has to ask whether the text it holds is what was sent
    // or what somebody remembered.
    summary: text("summary"),
    // How the row came to exist, so a hand-logged call is never mistaken for an observed one. A
    // member's recollection and a carrier's report of the same call carry different weight, and a
    // reader who cannot tell them apart will trust the wrong one.
    producer: text("producer", { enum: ["member", "carrier"] }).notNull(),
    // Who typed it in, on a member-produced row. Null on a carrier row, which nobody authored.
    loggedByUserId: text("logged_by_user_id").$type<UserId>(),
    // THE OTHER ANCHOR, and the reason it exists (owner ruling, 2026-09-08): not every call a firm
    // takes is about a case. Some are spam or a wrong number, some are the firm's own business —
    // the landlord, the bar association, a vendor — and some are a real prospect who never came
    // back. None of them can be filed onto a matter, because there is no matter, and before this
    // column existed they had nowhere to go but the unrouted queue, where they stayed forever. A
    // queue that cannot be emptied is a queue nobody works.
    //
    // So a row has EXACTLY ONE anchor: a matter, a disposition, or neither while nobody has decided.
    // Never both. That pairing, and the vocabulary itself, are enforced in
    // packages/communications/src/validation.ts rather than as CHECKs here: the column is added to a
    // table that already holds rows, and SQLite cannot add a CHECK to one without the destructive
    // table rebuild the expand-contract rule forbids (test/expand-contract.test.ts).
    disposition: text("disposition"),
    // THE NAME THE CALLER GAVE, typed by whoever took the call. A number is usually all a
    // receptionist has, and a name said down the line is the next thing they write on the slip; it
    // is kept apart from counterparty_entity_id because a name somebody heard is not a Directory
    // record somebody chose, and a reader must be able to tell which one they are looking at.
    callerIdName: text("caller_id_name"),
    // WHAT HAPPENED ON THE LINE, which is a different fact from where the record is filed. A call
    // can be answered and filed on a matter, or answered and set aside; a transferred call names
    // the member it went to in member_user_id. Validated in packages/communications/src/validation.ts
    // rather than by a CHECK, for the same expand-contract reason as `disposition`.
    outcome: text("outcome"),
    // Which kind of unwanted call this was, on an outcome of spam only: a sales call, a wrong number
    // and a scam are each worth counting separately when the same number rings again.
    spamKind: text("spam_kind"),
    // The task a message taken on this call became. The message is open exactly while that task is,
    // so nothing here duplicates its state; a plain id on the matter_party precedent, because a task
    // may be on no matter and the two live in different subsystems.
    messageTaskId: text("message_task_id"),
    // The adapter's own id for the message or call. The idempotency key for a redelivered webhook —
    // carriers retry, and a retried delivery must not become a second row. Null on every
    // member-produced row, which is why the unique index below is partial.
    carrierReference: text("carrier_reference"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    // The matter's own section reads (matter, occurred_at DESC, id DESC); SQLite walks an ASC index
    // in reverse, so the ASC composite serves the sort from the index with no temporary B-tree.
    index("communication_matter_occurred_at_id_index").on(
      table.matterId,
      table.occurredAt,
      table.id,
    ),
    // The firm-wide screen's unfiltered read, and the same index the unrouted queue narrows within.
    index("communication_occurred_at_id_index").on(table.occurredAt, table.id),
    // "Everything we have ever said to this person", which is the Directory record's own read.
    index("communication_counterparty_entity_id_index").on(table.counterpartyEntityId),
    index("communication_counterparty_number_index").on(table.counterpartyNumber),
    // The set-aside read. Partial, because the column is null on nearly every row and the only read
    // that names it wants exactly the rows where it is not.
    index("communication_disposition_index")
      .on(table.disposition)
      .where(sql`${table.disposition} IS NOT NULL`),
    // One row per carrier message. Partial, so the member-produced rows that carry no reference are
    // unconstrained — the same shape as matter.matter_number and for the same reason.
    uniqueIndex("communication_carrier_reference_unique_index")
      .on(table.carrierReference)
      .where(sql`${table.carrierReference} IS NOT NULL`),
    // ONE ROW PER DRAWN NUMBER, and this index is the load-bearing backstop on the draw rather than
    // a tidiness constraint. The general warning in @magna-carta/sequence-numbering — that a unique
    // index on a RENDERED number cannot stand in for an allocation table — is about schemes carrying
    // a segment that varies within one counter scope. This scheme carries none: the scope key IS the
    // day, and the day is the whole of the rendered string apart from the counter value, so two
    // draws that observed the same value in the same scope render byte-identical strings and the
    // loser aborts here. Partial, because rows written before the column existed carry none.
    uniqueIndex("communication_reference_number_unique_index")
      .on(table.referenceNumber)
      .where(sql`${table.referenceNumber} IS NOT NULL`),
    check("communication_counterparty_number_check", sql`length(${table.counterpartyNumber}) > 0`),
    // The three closed vocabularies, held at the database and not only at the type checker: a value
    // that reaches a write without appearing here fails in SQLite, so widening one costs a reviewed
    // migration. `mms` is in the set from the start rather than added when picture messages arrive,
    // because a channel a carrier can hand us is a channel the log has to be able to hold.
    check("communication_channel_check", sql`${table.channel} IN ('voice', 'sms', 'mms')`),
    check("communication_direction_check", sql`${table.direction} IN ('inbound', 'outbound')`),
    check("communication_producer_check", sql`${table.producer} IN ('member', 'carrier')`),
    // A duration belongs to a call. A message has no length in seconds, and a row claiming one is a
    // row somebody wrote a voice value into by mistake.
    check(
      "communication_duration_channel_check",
      sql`${table.durationSeconds} IS NULL OR (${table.channel} = 'voice' AND ${table.durationSeconds} >= 0)`,
    ),
    // Text belongs to a message. A voice row's account of itself is `summary`, so a body on a call
    // means the two got crossed.
    check(
      "communication_body_channel_check",
      sql`${table.body} IS NULL OR ${table.channel} IN ('sms', 'mms')`,
    ),
    // Both directions. A member-produced row names the member who typed it and carries no carrier
    // id; a carrier-produced row carries the id and names no author.
    check(
      "communication_producer_shape_check",
      sql`(${table.producer} = 'member') = (${table.loggedByUserId} IS NOT NULL)
        AND (${table.producer} = 'carrier' OR ${table.carrierReference} IS NULL)`,
    ),
  ],
);

// The reference-number sequence for the call and text log, one counter per calendar day. next_value
// is the sanctioned exception to append-only, as it is for matter numbers; the mechanism — ensure
// the row, increment under a guard, retry the loser — lives in packages/sequence-numbering.
//
// A DAY IS THE SCOPE because the number carries the day, and a scope any wider would hand out a
// five-digit tail nobody can read back down a telephone. There is no allocation table beside this
// one, which is the one place this sequence departs from its three siblings: the rendered number
// contains the whole of its scope, so the partial unique index on communication.reference_number
// catches a losing draw exactly as an allocation primary key would. The reasoning is written out
// where that index is declared.
export const communicationNumberCounter = sqliteTable(
  "communication_number_counter",
  {
    scopeKey: text("scope_key").primaryKey(), // the day the call happened, as YYYY-MM-DD
    nextValue: integer("next_value").notNull(),
  },
  (table) => [check("communication_number_counter_next_value_check", sql`${table.nextValue} > 0`)],
);

// What the telephone network said about a number, the one time the firm paid to ask.
//
// A caller-name lookup is a billed query against the carriers' database, so its answer is KEPT: one
// row per number, written when a member presses for the lookup, and read back for free every time
// the same number is typed again. Keyed by the number's two parts — the same pair directory_phone
// indexes — so a lookup and a Directory match ask about one number in one vocabulary.
//
// It is the network's answer and never the firm's: a contact's name lives in the Directory, and this
// row is shown beside it as what the caller ID would display. Every column but the key may be null,
// because "the database holds no name for this number" is a real answer that was paid for.
export const callerIdentity = sqliteTable(
  "caller_identity",
  {
    countryCallingCode: text("country_calling_code").notNull(), // digits only, no leading '+'
    nationalNumber: text("national_number").notNull(), // digits only
    callerName: text("caller_name"),
    // 'mobile' | 'fixed' | 'fixedOrMobile' | 'voip' | 'tollFree' | 'other'; enforced in
    // packages/caller-lookup's CALLER_LINE_TYPES, open at rest so the vocabulary can grow without a
    // rebuild (the directory_phone contact_system precedent).
    lineType: text("line_type"),
    carrierName: text("carrier_name"),
    // Which engine answered, so a row can be told apart from one a different provider gave later.
    source: text("source").notNull(),
    lookedUpByUserId: text("looked_up_by_user_id").notNull().$type<UserId>(),
    lookedUpAt: text("looked_up_at").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.countryCallingCode, table.nationalNumber] }),
    check(
      "caller_identity_number_digits_check",
      sql`length(${table.countryCallingCode}) > 0 AND ${table.countryCallingCode} NOT GLOB '*[^0-9]*' AND length(${table.nationalNumber}) > 0 AND ${table.nationalNumber} NOT GLOB '*[^0-9]*'`,
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
    // WHAT KIND OF DOCUMENT THIS VERSION HOLDS, so no reader has to assume it is a `.docx`.
    // `wordProcessing` is the normalized OOXML package the merge engine walks — run-split placeholders
    // reassembled, blocks and expression sites recorded, a normalizer version stamped. `pdfForm` is a
    // firm-supplied fillable PDF: no normalization pass, no blocks, no expression sites, and a field
    // manifest discovered from the AcroForm field set rather than authored. The two share the
    // catalogue, the version ladder, the ingest gate, the manifest shape, and the binding index; they
    // share no engine, which is why the discriminator is stored rather than sniffed at read time.
    kind: text("kind", { enum: ["wordProcessing", "pdfForm"] })
      .notNull()
      .default("wordProcessing"),
    r2Key: text("r2_key").notNull(),
    sizeBytes: integer("size_bytes"),
    contentSha256: text("content_sha256"),
    storageEncoding: text("storage_encoding").notNull().default("full"),
    storageClass: text("storage_class", {
      enum: ["standard", "infrequent_access"],
    })
      .notNull()
      .default("standard"),
    status: text("status", {
      enum: ["pending", "clean", "quarantined", "abandoned"],
    })
      .notNull()
      .default("pending"),
    scanVerdict: text("scan_verdict", {
      enum: ["unscanned", "clean", "flagged"],
    }),
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
    outcome: text("outcome", {
      enum: ["succeeded", "succeeded_with_absences", "failed"],
    }),
    // An error CODE from a closed set, never a failing value: a merge failure reports which key failed,
    // never what it held.
    failureReason: text("failure_reason"),
    fileId: text("file_id")
      .$type<FileId>()
      .references(() => file.id),
    fileVersionId: text("file_version_id")
      .$type<FileVersionId>()
      .references(() => fileVersion.id),
    // What the job was asked to produce. The merge always emits a word-processing package; `pdf` asks
    // the job to carry that package across the office-suite conversion edge before filing it. Recorded
    // rather than inferred from the filed object, because a job that failed still has to say what it
    // was trying to make, and a caller polling before the document lands needs to know whether what is
    // coming can be sealed.
    outputFormat: text("output_format", { enum: ["docx", "pdf"] })
      .notNull()
      .default("docx"),
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
    intrinsicValueDefault: integer("intrinsic_value_default", {
      mode: "boolean",
    })
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
    numberSource: text("number_source", {
      enum: ["drawn", "manual"],
    }).notNull(),
    name: text("name").notNull(),
    currentLocationId: text("current_location_id")
      .$type<CustodyLocationId>()
      .references(() => custodyLocation.id),
    status: text("status", {
      enum: ["held", "out", "released", "destroyed", "lost"],
    })
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
    // The register list's sort, on every page including keyset pages. Both columns are immutable, so
    // this is written when a packet is created and not by the status and location updates a movement
    // makes.
    index("custody_packet_created_index").on(table.createdAt, table.id),
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
    borrowerKind: text("borrower_kind", {
      enum: ["member", "entity", "external"],
    }),
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
    // The firm-wide calendar window, which reads movements by date with no packet to key on. This
    // ledger grows for as long as the firm holds the property, so a date read with nothing to seek
    // walks more of it every year. The table is append-only, so the index is insert-only.
    index("custody_movement_occurred_index").on(table.occurredAt, table.id),
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
    outcome: text("outcome", {
      enum: ["approved", "refused", "executed", "withdrawn"],
    }),
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
    kind: text("kind", {
      enum: ["sighted", "not_found", "unregistered"],
    }).notNull(),
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
    // Who entered the record, beside who let the money go — the same two facts trust_movement keeps
    // apart, for the same reason: a rule requiring a second person is worth nothing if the record
    // cannot tell them apart. Null only on rows older than the authorization policy; triggers in the
    // migration require both on every new row.
    recordedBy: text("recorded_by").$type<UserId>(),
    // The authorization-policy version governing this transfer: the current version for a transfer
    // composed directly, or the version stamped on the approved request it rides with — which is how
    // an in-flight application keeps the rules it was submitted against. Triggers refuse any other
    // stamp.
    policyId: text("policy_id")
      .$type<TrustAuthorizationPolicyId>()
      .references(() => trustAuthorizationPolicy.id),
    // The earned-fee application request this transfer was approved from, when it came through the
    // authorization queue; null on a transfer the policy allowed to be composed directly.
    approvedRequestId: text("approved_request_id")
      .$type<TrustDisbursementRequestId>()
      .references(() => trustDisbursementRequest.id),
  },
  (table) => [
    // Each entry participates in at most one transfer, on one side: a second row claiming either
    // entry would double-count the movement in every report that joins through this table.
    uniqueIndex("trust_transfer_trust_entry_unique_index").on(table.trustEntryId),
    uniqueIndex("trust_transfer_operating_entry_unique_index").on(table.operatingEntryId),
    // One transfer per approved request, ever — without this a settled request could be named by a
    // second transfer under its old stamp. SQLite UNIQUE permits many NULLs, so directly composed
    // transfers are unaffected.
    uniqueIndex("trust_transfer_approved_request_unique_index").on(table.approvedRequestId),
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
    kind: text("kind", {
      enum: ["deposit", "disbursement", "matter_transfer"],
    }).notNull(),
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

// The firm's disbursement-authorization posture — whether money leaving a client ledger takes a
// second person — one immutable row per version, current = highest version. Three postures: `off`
// (the deciding member may act alone), `threshold` (a second person is required for amounts strictly
// above `threshold_amount_minor`), `always` (a second person is required for every amount). The
// independent `require_authorized_approver` flag adds that whoever lets the money go — the approver,
// or the sole actor when the posture exempts — must hold the `trust:authorize` capability.
//
// NO ROW IS THE SHIPPED DEFAULT, AND THE DEFAULT IS THE STRICT ONE: always two-person, no authority
// requirement — exactly the behavior firms had before this table existed, so a migration never
// silently relaxes anybody's posture. A firm relaxes only by writing a version, which records who
// changed the posture, when, and (against the previous row) from what.
//
// APPEND-ONLY AND DENSELY VERSIONED, enforced by triggers in the migration: a posture change is a
// new version, never an edit, so the history of how a firm's money-movement controls evolved is
// itself an evidentiary record. Requests and transfers stamp the version they were created under,
// which is what lets an in-flight request keep the rules it was submitted against.
export const trustAuthorizationPolicy = sqliteTable(
  "trust_authorization_policy",
  {
    id: text("id").primaryKey().$type<TrustAuthorizationPolicyId>(), // trustAuthorizationPolicy_ handle
    version: integer("version").notNull(),
    policy: text("policy", { enum: ["off", "threshold", "always"] }).notNull(),
    // Set exactly when the posture is `threshold`: amounts strictly above it take a second person,
    // amounts at or below it do not.
    thresholdAmountMinor: integer("threshold_amount_minor"),
    requireAuthorizedApprover: integer("require_authorized_approver").notNull(),
    setBy: text("set_by").notNull().$type<UserId>(),
    setAt: text("set_at").notNull(), // UTC instant
  },
  (table) => [
    uniqueIndex("trust_authorization_policy_version_unique_index").on(table.version),
    check(
      "trust_authorization_policy_policy_check",
      sql`${table.policy} IN ('off', 'threshold', 'always')`,
    ),
    check(
      "trust_authorization_policy_threshold_shape_check",
      sql`(${table.policy} = 'threshold' AND ${table.thresholdAmountMinor} IS NOT NULL AND ${table.thresholdAmountMinor} >= 0) OR (${table.policy} <> 'threshold' AND ${table.thresholdAmountMinor} IS NULL)`,
    ),
    check(
      "trust_authorization_policy_authority_flag_check",
      sql`${table.requireAuthorizedApprover} IN (0, 1)`,
    ),
    check("trust_authorization_policy_version_positive_check", sql`${table.version} > 0`),
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
    // What the approval will post. A `disbursement` posts a trust movement; an
    // `earned_fee_application` posts a trust-to-operating transfer whose invoice particulars live in
    // invoice_trust_application_line — one queue, one decision discipline, two postings.
    kind: text("kind", { enum: ["disbursement", "earned_fee_application"] })
      .notNull()
      .default("disbursement"),
    // The operating leg's ledger-entry description, set exactly on an earned-fee application (a
    // disbursement has no operating leg). Enforced by the kind-shape trigger in the migration.
    operatingDescription: text("operating_description"),
    // The authorization-policy version this request was submitted under — the rules the approver
    // decides by, HOWEVER the firm's posture has changed since. Null only on rows older than the
    // policy table (or in a firm that has never written a version), which is the shipped default:
    // always two-person, no authority requirement. A trigger refuses a new request whose stamp is
    // not the current version, so a caller can never revive a superseded posture.
    policyId: text("policy_id")
      .$type<TrustAuthorizationPolicyId>()
      .references(() => trustAuthorizationPolicy.id),
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
    decision: text("decision", {
      enum: ["approved", "rejected", "withdrawn"],
    }).notNull(),
    decidedBy: text("decided_by").notNull().$type<UserId>(),
    decidedAt: text("decided_at").notNull(), // UTC instant
    // Why the request was refused, in the decider's words. Required on a rejection — a refusal
    // nobody explained is a refusal the submitter cannot answer — and absent on an approval, whose
    // reasoning is the request's own purpose.
    reason: text("reason"),
    // On what footing the approval was given. `second_person` is the rule; `sole_trust_manager`
    // records, on the face of the record, that a second person was required and the firm had nobody
    // else who could approve; `policy_exempt` records that the firm's authorization policy — the
    // version stamped on the request — did not require a second person for this amount, and the
    // submitter acted alone under it.
    authorizationBasis: text("authorization_basis", {
      enum: ["second_person", "sole_trust_manager", "policy_exempt"],
    }),
    // The movement the approval posted, in the same batch as this row. Null on every other decision,
    // which is the whole point: nothing reached the ledger.
    movementId: text("movement_id")
      .$type<TrustMovementId>()
      .references(() => trustMovement.id),
    // The trust-to-operating transfer an approved earned-fee application posted, in the same batch.
    // An approval posts exactly one of the two: a movement for a disbursement request, a transfer
    // for an earned-fee application — which is what lets one queue and one decision discipline
    // govern both ways money leaves a client ledger.
    transferId: text("transfer_id")
      .$type<TrustTransferId>()
      .references(() => trustTransfer.id),
  },
  (table) => [
    uniqueIndex("trust_disbursement_decision_request_unique_index").on(table.requestId),
    uniqueIndex("trust_disbursement_decision_movement_unique_index").on(table.movementId),
    uniqueIndex("trust_disbursement_decision_transfer_unique_index").on(table.transferId),
    check(
      "trust_disbursement_decision_decision_check",
      sql`${table.decision} IN ('approved', 'rejected', 'withdrawn')`,
    ),
    check(
      "trust_disbursement_decision_basis_check",
      sql`${table.authorizationBasis} IS NULL OR ${table.authorizationBasis} IN ('second_person', 'sole_trust_manager', 'policy_exempt')`,
    ),
    // Each outcome's shape stated once, so a decision cannot misdescribe itself: an approval with no
    // posting and no basis, an approval claiming both a movement and a transfer, a rejection that
    // claims to have posted one, or an unexplained refusal.
    check(
      "trust_disbursement_decision_shape_check",
      sql`(${table.decision} = 'approved' AND ${table.authorizationBasis} IS NOT NULL AND ${table.reason} IS NULL AND ((${table.movementId} IS NOT NULL AND ${table.transferId} IS NULL) OR (${table.transferId} IS NOT NULL AND ${table.movementId} IS NULL)))
        OR (${table.decision} = 'rejected' AND ${table.authorizationBasis} IS NULL AND ${table.movementId} IS NULL AND ${table.transferId} IS NULL AND length(${table.reason}) > 0)
        OR (${table.decision} = 'withdrawn' AND ${table.authorizationBasis} IS NULL AND ${table.movementId} IS NULL AND ${table.transferId} IS NULL AND (${table.reason} IS NULL OR length(${table.reason}) > 0))`,
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
    // The firm's own bank-charge cushion in this account as of the period end — zero on every
    // account that never opened the carve-out, and the reason the book side can exceed the client
    // side without that being a disagreement. Deliberately ABSENT from the shape check below: adding
    // it there would rewrite a constraint on a table whose append-only triggers are the guarantee
    // that a closed attestation never moves, and a nullable column read through COALESCE gives the
    // same answer for the rows that predate it without touching those triggers at all.
    frozenFirmFundsMinor: integer("frozen_firm_funds_minor"),
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

// THE BANK-CHARGE CARVE-OUT, AND THE REASON IT IS A SEPARATE TABLE RATHER THAN TWO MORE
// `trust_movement` KINDS.
//
// A bank service charge is the one category of money that legitimately leaves a trust bank account
// without a client-attributable disbursement authorization: the bank takes it, nobody at the firm
// releases it, and no client owes it. The professional-conduct rules answer that by permitting the
// firm to keep a small amount of its OWN money in the account to bear those charges, in the amount
// necessary for that purpose and for no other purpose.
//
// "For no other purpose" is the whole design problem, and the answer here is structural rather than
// procedural: THIS TABLE HAS NO COLUMN IN WHICH A CLIENT OR A MATTER COULD BE NAMED. There is no
// node_id, no matter_id, no client_entity_id, and no payee. The one node these entries can touch is
// the trust account's single `firm_funds` node, which is derived from `trust_account_id` and not
// stated by a caller — so a row of this table cannot express a movement of client money even if
// every check above it were removed. The ordinary `trust_movement` table keeps meaning exactly what
// it meant before ("client money moved"), so no client-ledger read had to learn an exclusion.
//
// Two kinds, and only two. `firm_funds_deposit` puts the firm's own cushion in (bank up, firm-funds
// up); `bank_charge` records the institution taking a service charge out of it (bank down,
// firm-funds down). There is deliberately no kind that pays anybody: a payment out of a trust
// account to a person is a disbursement, and it goes through the disbursement queue like every other
// one.
//
// APPEND-ONLY, enforced by triggers in the migration, on the same reasoning as every other trust
// record: a correction is a reversing entry with its own row.
export const trustFirmFundsMovement = sqliteTable(
  "trust_firm_funds_movement",
  {
    id: text("id").primaryKey().$type<TrustFirmFundsMovementId>(), // trustFirmFundsMovement_ handle
    trustAccountId: text("trust_account_id")
      .notNull()
      .$type<TrustAccountId>()
      .references(() => trustAccount.id),
    kind: text("kind", {
      enum: ["firm_funds_deposit", "bank_charge"],
    }).notNull(),
    amountMinor: integer("amount_minor").notNull(),
    currency: text("currency").notNull(),
    entryId: text("entry_id")
      .notNull()
      .$type<LedgerEntryId>()
      .references(() => ledgerEntry.id),
    // How the money moved, on the same reasoning `trust_movement.method` carries one: a rule engine
    // cannot refuse a method it cannot see. `bank_debit` is the institution helping itself, which is
    // what a service charge IS and what no other movement in the subsystem can claim.
    method: text("method", {
      enum: ["check", "wire", "electronic_transfer", "bank_debit"],
    }).notNull(),
    reference: text("reference"),
    // What the institution called the charge, or what the firm called the top-up. Free text, and the
    // nearest thing this table has to a counterparty — the counterparty of a bank charge is the bank
    // whose account this is, which `trust_account_id` already names.
    description: text("description").notNull(),
    recordedBy: text("recorded_by").notNull().$type<UserId>(),
    effectiveDate: text("effective_date").notNull(), // YYYY-MM-DD civil date
    recordedAt: text("recorded_at").notNull(), // UTC instant
  },
  (table) => [
    // One record per entry, the same rule `trust_movement` holds: a second row would double the item
    // in the trust journal and in the reconciliation's outstanding list.
    uniqueIndex("trust_firm_funds_movement_entry_unique_index").on(table.entryId),
    index("trust_firm_funds_movement_account_effective_date_index").on(
      table.trustAccountId,
      table.effectiveDate,
    ),
    check("trust_firm_funds_movement_amount_positive_check", sql`${table.amountMinor} > 0`),
    check("trust_firm_funds_movement_currency_check", sql`length(${table.currency}) = 3`),
    check(
      "trust_firm_funds_movement_description_nonempty_check",
      sql`length(${table.description}) > 0`,
    ),
    check(
      "trust_firm_funds_movement_kind_check",
      sql`${table.kind} IN ('firm_funds_deposit', 'bank_charge')`,
    ),
    // `bank_debit` is what a service charge is and is refused on a deposit: the firm putting its own
    // cushion in is an act the firm performs, never one the institution performs against it.
    check(
      "trust_firm_funds_movement_shape_check",
      sql`(${table.kind} = 'bank_charge' AND ${table.method} = 'bank_debit')
        OR (${table.kind} = 'firm_funds_deposit' AND ${table.method} <> 'bank_debit')`,
    ),
  ],
);

// UNCLAIMED CLIENT FUNDS — THE FIRM'S DILIGENCE RECORD, AND NOT A SWEEP.
//
// Money sitting on a matter ledger whose owner the firm cannot reach is a continuing safekeeping
// duty: the firm must make reasonable efforts to locate the owner and distribute the funds, and it
// must be able to evidence those efforts afterwards. What the platform can genuinely hold is the
// evidence — attempt by attempt, at the time, in a form nobody can reconstruct two years later.
//
// WHAT IS DELIBERATELY ABSENT IS AS LOAD-BEARING AS WHAT IS HERE. There is no dormancy flag, no
// dormancy date, and no eligibility column anywhere in these three tables. Dormancy is a COMPARISON
// over the movement rows that already exist, made at read time against a window the reader states —
// the same posture the calendar holds for an overdue deadline, and for the same reason: a stored
// flag needs a sweep to maintain, can be stale, and asserts something about the firm's conduct the
// platform is not in a position to assert. The firm may have spoken to the client this morning in a
// way this platform never saw.
//
// And no row in this group moves money. A distribution to a located owner is an ordinary
// disbursement through the ordinary queue; the closure below RECORDS which movement settled the
// review and structurally cannot compose one.
export const trustUnclaimedFundsReview = sqliteTable(
  "trust_unclaimed_funds_review",
  {
    id: text("id").primaryKey().$type<TrustUnclaimedFundsReviewId>(), // trustUnclaimedFundsReview_ handle
    trustAccountId: text("trust_account_id")
      .notNull()
      .$type<TrustAccountId>()
      .references(() => trustAccount.id),
    // The matter leaf under review. A client node or the firm-funds node cannot be reviewed: a
    // roll-up holds no balance, and the firm's own money in the account belongs to the firm.
    nodeId: text("node_id")
      .notNull()
      .$type<TrustLedgerNodeId>()
      .references(() => trustLedgerNode.id),
    // What the reader SAW when they opened the review, recorded as an observation with a timestamp
    // rather than as a fact about the ledger. The ledger keeps moving; these three columns are the
    // reason a person judged the balance dormant, which is exactly what a later reader needs and
    // exactly what a live re-read cannot give them.
    observedBalanceMinor: integer("observed_balance_minor").notNull(),
    currency: text("currency").notNull(),
    // The effective date of the EARLIEST receipt still sitting on this ledger, which is the datum
    // the rules' clocks run from — not the last time anything happened on the matter.
    observedEarliestReceiptDate: text("observed_earliest_receipt_date"),
    observedLastActivityDate: text("observed_last_activity_date"),
    openedBy: text("opened_by").notNull().$type<UserId>(),
    openedAt: text("opened_at").notNull(), // UTC instant
    note: text("note"),
  },
  (table) => [
    index("trust_unclaimed_funds_review_account_index").on(table.trustAccountId, table.openedAt),
    index("trust_unclaimed_funds_review_node_index").on(table.nodeId),
    check(
      "trust_unclaimed_funds_review_balance_positive_check",
      sql`${table.observedBalanceMinor} > 0`,
    ),
    check("trust_unclaimed_funds_review_currency_check", sql`length(${table.currency}) = 3`),
  ],
);

// One locate attempt, recorded when it was made. The channels are the ones the rules enumerate as
// the floor of a reasonable search — regular mail, certified mail, telephone, email — plus the
// record review a firm performs over its own files, plus an escape for anything else a board or a
// court adds later. APPEND-ONLY: an attempt that was made cannot be un-made, and correcting one is a
// new row saying so in its note.
export const trustUnclaimedFundsContactAttempt = sqliteTable(
  "trust_unclaimed_funds_contact_attempt",
  {
    id: text("id").primaryKey().$type<TrustUnclaimedFundsContactAttemptId>(), // trustUnclaimedFundsContactAttempt_ handle
    reviewId: text("review_id")
      .notNull()
      .$type<TrustUnclaimedFundsReviewId>()
      .references(() => trustUnclaimedFundsReview.id),
    channel: text("channel", {
      enum: ["regular_mail", "certified_mail", "telephone", "email", "record_review", "other"],
    }).notNull(),
    attemptedOn: text("attempted_on").notNull(), // YYYY-MM-DD civil date
    // The address, number, or mailbox the attempt actually used — the detail the certification has
    // to reproduce, and personal data about the client, so it is registered as such.
    contactUsed: text("contact_used"),
    outcome: text("outcome", {
      enum: ["no_response", "undeliverable", "reached", "declined", "wrong_contact", "other"],
    }).notNull(),
    note: text("note"),
    recordedBy: text("recorded_by").notNull().$type<UserId>(),
    recordedAt: text("recorded_at").notNull(), // UTC instant
  },
  (table) => [
    index("trust_unclaimed_funds_contact_attempt_review_index").on(
      table.reviewId,
      table.attemptedOn,
    ),
    check(
      "trust_unclaimed_funds_contact_attempt_channel_check",
      sql`${table.channel} IN ('regular_mail', 'certified_mail', 'telephone', 'email', 'record_review', 'other')`,
    ),
    check(
      "trust_unclaimed_funds_contact_attempt_outcome_check",
      sql`${table.outcome} IN ('no_response', 'undeliverable', 'reached', 'declined', 'wrong_contact', 'other')`,
    ),
    // A record review has no contact detail to name; every other channel used one.
    check(
      "trust_unclaimed_funds_contact_attempt_shape_check",
      sql`(${table.channel} = 'record_review' AND ${table.contactUsed} IS NULL)
        OR (${table.channel} <> 'record_review' AND ${table.contactUsed} IS NOT NULL AND length(${table.contactUsed}) > 0)`,
    ),
  ],
);

// How a review ended. A SEPARATE ROW rather than a status column on the review, on the same
// derivation the hold release and the disbursement decision use: a review is open when no closure
// names it, so there is no column anywhere that can disagree with the rows. `UNIQUE` on review_id is
// what makes two concurrent closures produce one.
//
// THE MANUAL-CONFIRMATION GATE LIVES IN THIS TABLE'S SHAPE. `movement_id` points at a
// `trust_movement` that ALREADY EXISTS — a disbursement somebody composed, authorized, and committed
// through the ordinary path. Closing a review can therefore attach money that moved; it can never be
// the thing that moved it. Nothing here sweeps, nothing fires on a timer, and no outcome is computed
// and then acted on.
export const trustUnclaimedFundsReviewClosure = sqliteTable(
  "trust_unclaimed_funds_review_closure",
  {
    id: text("id").primaryKey().$type<TrustUnclaimedFundsReviewClosureId>(), // trustUnclaimedFundsReviewClosure_ handle
    reviewId: text("review_id")
      .notNull()
      .$type<TrustUnclaimedFundsReviewId>()
      .references(() => trustUnclaimedFundsReview.id),
    // `distributed_to_owner`: the search worked and the money went where it belonged.
    // `resolved_without_distribution`: the balance left this ledger some other legitimate way — an
    // earned-fee application, a reallocation, a correction of a receipt that was never the client's.
    // `not_dormant`: the reader was wrong, or the client turned up; the review closes with the money
    // where it was. `search_continues` closes THIS round of diligence without pretending it
    // concluded, which is the honest end of most of them and the one an evidence trail needs.
    outcome: text("outcome", {
      enum: [
        "distributed_to_owner",
        "resolved_without_distribution",
        "not_dormant",
        "search_continues",
      ],
    }).notNull(),
    movementId: text("movement_id")
      .$type<TrustMovementId>()
      .references(() => trustMovement.id),
    closedBy: text("closed_by").notNull().$type<UserId>(),
    closedAt: text("closed_at").notNull(), // UTC instant
    note: text("note"),
  },
  (table) => [
    uniqueIndex("trust_unclaimed_funds_review_closure_review_unique_index").on(table.reviewId),
    check(
      "trust_unclaimed_funds_review_closure_outcome_check",
      sql`${table.outcome} IN ('distributed_to_owner', 'resolved_without_distribution', 'not_dormant', 'search_continues')`,
    ),
    // A distribution names the movement that made it; nothing else may name one. Without this, an
    // outcome of "not dormant" could carry a payment nobody reading the review would expect.
    check(
      "trust_unclaimed_funds_review_closure_shape_check",
      sql`(${table.outcome} = 'distributed_to_owner' AND ${table.movementId} IS NOT NULL)
        OR (${table.outcome} <> 'distributed_to_owner' AND ${table.movementId} IS NULL)`,
    ),
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
    // How a bill spanning several matters is presented, SNAPSHOT at finalize like the letterhead:
    // `per_matter_pages` renders one page per matter plus a summary page, `combined` renders one
    // flowing document. The firm's default lives in the setting table and a later change to it must
    // not silently re-shape a document the firm already gave somebody. Null on drafts and on
    // invoices finalized before the column existed, which the render derivation reads as `combined`.
    renderShape: text("render_shape", {
      enum: ["combined", "per_matter_pages"],
    }),
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
      "invoice_render_shape_check",
      sql`${table.renderShape} IS NULL OR ${table.renderShape} IN ('combined', 'per_matter_pages')`,
    ),
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
    // The fee-agreement version that produced this line, for the lines an arrangement composes — a
    // flat fee or a contingency fee. The line's amount is still its own snapshot; this is the record
    // of WHICH version of the agreement was in force, so an amended agreement never orphans the
    // question of what a finalized bill was computed under. Null on hourly and cost lines.
    billingArrangementId: text("billing_arrangement_id")
      .$type<BillingArrangementId>()
      .references(() => matterBillingArrangement.id),
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
    sourceKind: text("source_kind", {
      enum: ["time_entry", "cost_entry", "fee_entry"],
    }).notNull(),
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
      sql`${table.sourceKind} IN ('time_entry', 'cost_entry', 'fee_entry')`,
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
    // The correction this application came from, for the two kinds a document produces. A credit
    // note may reach several matters of one invoice, so it produces one application per matter, all
    // naming the same note; a client credit is discharged a piece at a time against later invoices,
    // so each discharge is an application naming the credit it drew on.
    creditNoteId: text("credit_note_id")
      .$type<CreditNoteId>()
      .references(() => creditNote.id),
    clientCreditId: text("client_credit_id")
      .$type<ClientCreditId>()
      .references(() => clientCredit.id),
    // The posting this application rode with, recorded on the row that OWNS that posting. A trust
    // transfer's entries are trust's and billing composes none, so it carries no entry; a credit
    // note is one posting across however many per-matter applications it produces, so the entry sits
    // on the note; every other kind is one posting per application and carries it here. The pairing
    // is held by trigger, which is what makes "billing composes no ledger entry for a trust
    // application" a database guarantee rather than a rule a future caller has to remember.
    entryId: text("entry_id")
      .$type<LedgerEntryId>()
      .references(() => ledgerEntry.id),
    // Why the firm gave up a receivable, or unwound an application it had posted. Required on those
    // two kinds by trigger: a write-off with no stated reason is indistinguishable from a mistake,
    // and both are the kind of entry a bar audit asks about.
    reason: text("reason"),
    effectiveDate: text("effective_date").notNull(), // civil date
    appliedBy: text("applied_by").$type<UserId>(),
    appliedAt: text("applied_at").notNull(),
  },
  (table) => [
    uniqueIndex("invoice_application_reverses_unique_index").on(table.reversesApplicationId),
    index("invoice_application_invoice_matter_index").on(table.invoiceId, table.matterId),
    index("invoice_application_matter_index").on(table.matterId),
    index("invoice_application_trust_transfer_index").on(table.trustTransferId),
    index("invoice_application_credit_note_index").on(table.creditNoteId),
    index("invoice_application_client_credit_index").on(table.clientCreditId),
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

// One invoice-and-amount a PENDING earned-fee application proposes to settle — the particulars an
// approving member is approving, which is why they are structured rows rather than prose in the
// request's description. The queue row itself is a trust_disbursement_request with
// kind = 'earned_fee_application' (one approval queue, one decision discipline for every way money
// leaves a client ledger); these lines are billing's side of that request, and the approval
// re-resolves every one of them against the invoices as they stand THEN, exactly as a disbursement
// approval re-reads the available balance.
//
// APPEND-ONLY, enforced by triggers in the migration, with the request they belong to: what was
// proposed is part of the record whether or not it was approved. No status column — the request's
// decision row settles the whole proposal.
export const invoiceTrustApplicationLine = sqliteTable(
  "invoice_trust_application_line",
  {
    id: text("id").primaryKey().$type<InvoiceTrustApplicationLineId>(), // invoiceTrustApplicationLine_ handle
    requestId: text("request_id")
      .notNull()
      .$type<TrustDisbursementRequestId>()
      .references(() => trustDisbursementRequest.id),
    invoiceId: text("invoice_id")
      .notNull()
      .$type<InvoiceId>()
      .references(() => invoice.id),
    amountMinor: integer("amount_minor").notNull(),
    currency: text("currency").notNull(),
  },
  (table) => [
    // One line per invoice per request: a request naming the same invoice twice would make "what is
    // being approved" ambiguous where a single larger line says it plainly.
    uniqueIndex("invoice_trust_application_line_request_invoice_unique_index").on(
      table.requestId,
      table.invoiceId,
    ),
    check("invoice_trust_application_line_amount_positive_check", sql`${table.amountMinor} > 0`),
    check("invoice_trust_application_line_currency_check", sql`length(${table.currency}) = 3`),
  ],
);

// THE CORRECTION AFTER FINALIZATION. A finalized invoice is frozen by trigger and there is no
// un-finalize, so a bill issued in error is answered by a second permanent record: a credit note,
// with its own lines, its own reason, its own effective date, and its own posting. It never edits
// the invoice, and the invoice's `total_minor` never moves — the note lands as an application
// against `applied_minor`, so what the client was originally told stays exactly as it was told.
//
// A credit note may only be raised against a FINALIZED invoice: a draft is a working document and
// the correction for a wrong draft is to edit it. Held by trigger, because a route is one code path
// among several that will reach this table.
export const creditNote = sqliteTable(
  "credit_note",
  {
    id: text("id").primaryKey().$type<CreditNoteId>(), // creditNote_ handle
    invoiceId: text("invoice_id")
      .notNull()
      .$type<InvoiceId>()
      .references(() => invoice.id),
    currency: text("currency").notNull(),
    // Why the bill was wrong, in the firm's own words. Not optional and not a code: a credit note is
    // read years later by somebody reconstructing a fee dispute, and a reason list the platform
    // invented would flatten the one fact only the firm has.
    reason: text("reason").notNull(),
    effectiveDate: text("effective_date").notNull(), // civil PlainDate
    // The one posting a credit note makes, across every matter it touches: contra-revenue debited,
    // the receivable credited by what it actually pays down, and the remainder credited to the
    // client-credit liability. It sits here rather than on the applications because one note is one
    // posting however many matters it reaches — and because a note that pays nothing down (a bill
    // already paid in full) produces no application at all and would otherwise have nowhere to
    // record what it posted.
    entryId: text("entry_id")
      .notNull()
      .$type<LedgerEntryId>()
      .references(() => ledgerEntry.id),
    issuedBy: text("issued_by").$type<UserId>(),
    issuedAt: text("issued_at").notNull(),
  },
  (table) => [
    index("credit_note_invoice_index").on(table.invoiceId),
    uniqueIndex("credit_note_entry_unique_index").on(table.entryId),
    check("credit_note_currency_check", sql`length(${table.currency}) = 3`),
    check("credit_note_reason_nonempty_check", sql`length(trim(${table.reason})) > 0`),
  ],
);

// What the credit note says it is crediting, in presentation order — the mirror of `invoice_line`,
// and read the same way by anybody re-rendering the correction years later.
//
// AMOUNTS ARE POSITIVE HERE, unlike an invoice line. An invoice line may be negative because a
// discount is one line among many on a document whose direction is "you owe us"; a credit note's
// direction is the document's, so a line carries only the magnitude. That is the ledger's own rule —
// direction is data, never a sign — applied one level up.
export const creditNoteLine = sqliteTable(
  "credit_note_line",
  {
    id: text("id").primaryKey().$type<CreditNoteLineId>(), // creditNoteLine_ handle
    creditNoteId: text("credit_note_id")
      .notNull()
      .$type<CreditNoteId>()
      .references(() => creditNote.id),
    lineIndex: integer("line_index").notNull(),
    // Every line names its matter, exactly as an invoice line does: the balance a credit note pays
    // down is a per-(invoice, matter) row, so a line that did not name one could not be applied.
    matterId: text("matter_id")
      .notNull()
      .$type<MatterId>()
      .references(() => matter.id),
    kind: text("kind", {
      enum: ["fee", "cost", "flat_fee", "discount", "adjustment", "interest", "tax"],
    }).notNull(),
    description: text("description").notNull(),
    amountMinor: integer("amount_minor").notNull(),
    currency: text("currency").notNull(),
    // WHICH INVOICE LINE THIS CREDITS, when the firm is crediting a specific charge rather than the
    // bill in general. Optional, and load-bearing where it is present: a fee that was computed from
    // a basis — a contingency share of a recovery — is billed as an offset against what earlier
    // bills already charged, so "what has already been charged" has to mean charged AND NOT SINCE
    // CREDITED. Without this link a credit note could never be attributed to the charge it corrects,
    // and the over-billing report that finds such a charge could never be cleared by the one record
    // that resolves it.
    creditsInvoiceLineId: text("credits_invoice_line_id")
      .$type<InvoiceLineId>()
      .references(() => invoiceLine.id),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    uniqueIndex("credit_note_line_index_unique_index").on(table.creditNoteId, table.lineIndex),
    index("credit_note_line_matter_index").on(table.matterId),
    index("credit_note_line_credits_index").on(table.creditsInvoiceLineId),
    check("credit_note_line_amount_positive_check", sql`${table.amountMinor} > 0`),
    check("credit_note_line_currency_check", sql`length(${table.currency}) = 3`),
    check(
      "credit_note_line_kind_check",
      sql`${table.kind} IN ('fee', 'cost', 'flat_fee', 'discount', 'adjustment', 'interest', 'tax')`,
    ),
  ],
);

// VALUE OWED BACK TO A CLIENT THAT HAS NOT BEEN GIVEN BACK YET, and the honest consequence of the
// balance CHECK. A credit note cannot reduce a matter's balance below what has already been applied
// to it — that would be a negative unpaid receivable — so a note that outruns what is still unpaid
// opens one of these for the excess.
//
// The case that makes this necessary rather than tidy: the firm finalized a bill, took the fee out
// of the client's trust ledger under the earned-fee rule, and only then conceded that part of it was
// not earned. The trust ledger is not rewound — the transfer was valid when it was made, the trust
// entries are append-only, and the client's balance genuinely is lower. What the firm has is the
// client's money in its own operating account, which is a firm-funds question and not an invoicing
// one. The platform records the obligation, makes it un-loseable, and refuses to discharge it on its
// own initiative.
//
// OPEN IS DERIVED, NOT STORED — no status column, on the same reasoning that keeps one off
// `trust_hold`. `amount_minor` is frozen and `discharged_minor` is delta-updated inside a posting
// batch under a bounds CHECK, exactly as `invoice_matter_balance` is and for exactly the same
// reason: D1 has no interactive transactions, so the CHECK is the only mechanism that can abort a
// whole batch when two discharges race for the same remainder.
export const clientCredit = sqliteTable(
  "client_credit",
  {
    id: text("id").primaryKey().$type<ClientCreditId>(), // clientCredit_ handle
    // Whose money it is, resolved from the invoice the credit note corrected — the same Directory
    // handle the invoice carries.
    clientEntityId: text("client_entity_id").notNull(),
    matterId: text("matter_id")
      .notNull()
      .$type<MatterId>()
      .references(() => matter.id),
    creditNoteId: text("credit_note_id")
      .notNull()
      .$type<CreditNoteId>()
      .references(() => creditNote.id),
    amountMinor: integer("amount_minor").notNull(),
    dischargedMinor: integer("discharged_minor").notNull().default(0),
    currency: text("currency").notNull(),
    openedBy: text("opened_by").$type<UserId>(),
    openedAt: text("opened_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    // One credit per (note, matter): a note reaching two matters opens two, and a second row for the
    // same pair would be the same obligation recorded twice.
    uniqueIndex("client_credit_note_matter_unique_index").on(table.creditNoteId, table.matterId),
    index("client_credit_client_index").on(table.clientEntityId),
    index("client_credit_matter_index").on(table.matterId),
    check("client_credit_amount_positive_check", sql`${table.amountMinor} > 0`),
    check("client_credit_currency_check", sql`length(${table.currency}) = 3`),
    check(
      "client_credit_bounds_check",
      sql`${table.dischargedMinor} >= 0 AND ${table.dischargedMinor} <= ${table.amountMinor}`,
    ),
  ],
);

// THE RECORD THAT A BILL WAS GIVEN TO A CLIENT. One append-only row per delivery attempt, so
// "has this bill been given to the client" is a read over rows.
//
// SENT IS DELIBERATELY NOT AN INVOICE STATUS. A bill is delivered possibly several times and possibly
// by several channels, and a re-send is not a change to the financial record; modelling delivery as a
// status would force the finalized invoice row to stay mutable for its least load-bearing field,
// which is the one concession that stops an append-only table being one. A second delivery of the
// same bill is therefore a new row here, never an edit to an existing one.
//
// WHAT THIS IS AND IS NOT. It is a record, not a transmission. Nothing in the platform renders an
// invoice or carries one to a client, and this table does not pretend otherwise: what a firm records
// here is overwhelmingly a delivery it performed itself — handed over at a meeting, posted, emailed
// from the firm's own mailbox, or submitted to the client's own e-billing portal. That is the point
// rather than a shortfall. Several jurisdictions expect a client to have been given a bill before fees
// are taken from trust, and a table that could only hold deliveries the platform performed would
// leave every out-of-band delivery unrecordable — which is the firm that most needs to be able to
// answer the question.
//
// The read this exists for is surfaced, never a gate: the apply-funds path shows whether any delivery
// has been recorded and the firm proceeds knowingly, because a hard gate would be satisfied by firms
// recording deliveries that never happened, which turns a compliance record into a checkbox.
export const invoiceDelivery = sqliteTable(
  "invoice_delivery",
  {
    id: text("id").primaryKey().$type<InvoiceDeliveryId>(), // invoiceDelivery_ handle
    invoiceId: text("invoice_id")
      .notNull()
      .$type<InvoiceId>()
      .references(() => invoice.id),
    // A CLOSED VOCABULARY, closed now rather than later on purpose: SQLite cannot widen a table CHECK
    // without a destructive rebuild, so the ways a bill actually reaches a client are enumerated once.
    // `client_portal` is here with nothing yet able to produce it — the portal is unbuilt — because
    // the alternative is rebuilding a financial-evidence table on the day it lands.
    channel: text("channel", {
      enum: ["email", "post", "hand", "client_portal", "e_billing_gateway"],
    }).notNull(),
    // WHO IT WENT TO, in the firm's own words: an address, a mailbox, a portal account, or the person
    // it was handed to. Free text with no structured subject — the residue class the contact a firm
    // records using to reach a client it holds unclaimed money for sits in. Required and non-empty,
    // because a record whose whole job is to answer "was this given to the client" and which cannot
    // say who received it answers nothing.
    recipientReference: text("recipient_reference").notNull(),
    // WHEN IT HAPPENED, as a civil date, supplied by the firm — not when the row was written. An
    // out-of-band delivery is recorded days later, and a firm that posted a bill last Tuesday knows
    // the date and not the instant; making it supply an instant would have it invent one. The pairing
    // is `credit_note`'s: the business date the firm asserts, plus the provenance stamp below.
    deliveryDate: text("delivery_date").notNull(), // civil PlainDate
    // The thread back to whatever system carried the bill, where one did — a tracking number, a
    // gateway submission id, the message id of a mail sent elsewhere. Absent means nothing carried
    // it, which is the ordinary case for a bill handed over in a meeting.
    externalReference: text("external_reference"),
    // Two values, and the second is why the column exists: a letter comes back, an address is dead, a
    // gateway submission is rejected. A firm that could only record successes would have a delivery
    // history that reads as complete when it is not, and a reminder sent on the strength of it would
    // be a reminder about a bill nobody received.
    outcome: text("outcome", { enum: ["delivered", "failed"] }).notNull(),
    recordedBy: text("recorded_by").$type<UserId>(),
    recordedAt: text("recorded_at").notNull(),
  },
  (table) => [
    index("invoice_delivery_invoice_index").on(table.invoiceId),
    index("invoice_delivery_date_index").on(table.deliveryDate),
    check(
      "invoice_delivery_channel_check",
      sql`${table.channel} IN ('email', 'post', 'hand', 'client_portal', 'e_billing_gateway')`,
    ),
    check(
      "invoice_delivery_recipient_nonempty_check",
      sql`length(trim(${table.recipientReference})) > 0`,
    ),
    check("invoice_delivery_outcome_check", sql`${table.outcome} IN ('delivered', 'failed')`),
    check(
      "invoice_delivery_external_reference_nonempty_check",
      sql`${table.externalReference} IS NULL OR length(trim(${table.externalReference})) > 0`,
    ),
  ],
);

// The fee agreement: how a matter is billed, per matter, versioned append-only. A fee change is a
// NEW version — the old one stays, its valid_to closed by the version that superseded it — because
// an invoice records which version was in force and an edited agreement would rewrite what a
// finalized bill was computed under. Absence of any row means hourly, so matters that predate this
// table need no backfill. The kind-specific columns are shaped by CHECK per kind: a flat fee carries
// its amount, a contingency carries its share and its costs-before-or-after election, a retainer
// carries its target and its floor. The advance-fee deposit destination — trust or operating — is
// RECORDED and never defaulted: jurisdictions genuinely differ on where an advance fee must sit, and
// a wrong silence here states a wrong fact about real client money.
export const matterBillingArrangement = sqliteTable(
  "matter_billing_arrangement",
  {
    id: text("id").primaryKey().$type<BillingArrangementId>(), // billingArrangement_ handle
    matterId: text("matter_id")
      .notNull()
      .$type<MatterId>()
      .references(() => matter.id),
    // Dense per matter, enforced by trigger: "the version in force" is MAX(version) among open rows
    // with no timestamp tie to break, and two members amending concurrently converge on one winner.
    version: integer("version").notNull(),
    kind: text("kind", {
      enum: ["hourly", "flat_fee", "contingency", "retainer"],
    }).notNull(),
    flatFeeAmountMinor: integer("flat_fee_amount_minor"),
    // The share as a dimensionless decimal at the rate scale (3333 = 33.33%), never Money: a share
    // of an unknown future recovery has no currency until it multiplies one.
    contingencyShareE4: integer("contingency_share_e4"),
    // The costs-before-or-after election: `gross_recovery` computes the fee on the recovery before
    // advanced costs come off; `net_after_costs` deducts the matter's advanced (hard) costs first.
    contingencyBasis: text("contingency_basis", {
      enum: ["gross_recovery", "net_after_costs"],
    }),
    retainerTargetMinor: integer("retainer_target_minor"),
    // The replenishment floor — a BUSINESS configuration, emphatically not the trust leaf's
    // min_balance_minor, which is the structural no-negative floor and is never repurposed.
    retainerThresholdMinor: integer("retainer_threshold_minor"),
    advanceDepositDestination: text("advance_deposit_destination", {
      enum: ["trust", "operating"],
    }),
    currency: text("currency").notNull(),
    validFrom: text("valid_from").notNull(), // civil PlainDate
    validTo: text("valid_to"), // null = in force; set once, by the version that superseded it
    // The signed agreement this version rests on — the intake agreement the client signed at
    // opening, or the amendment they signed later — as an ordinary matter file, like the conflicts
    // waiver's evidencing document. A reference the firm can produce on demand rather than a
    // belief that one exists. Nullable: a version may be recorded before the paper is filed, and
    // every version on the books predates the column.
    agreementFileId: text("agreement_file_id")
      .$type<FileId>()
      .references(() => file.id),
    createdAt: text("created_at").notNull(),
    createdBy: text("created_by").$type<UserId>(),
  },
  (table) => [
    uniqueIndex("matter_billing_arrangement_version_unique_index").on(
      table.matterId,
      table.version,
    ),
    uniqueIndex("matter_billing_arrangement_open_unique_index")
      .on(table.matterId)
      .where(sql`${table.validTo} IS NULL`),
    check(
      "matter_billing_arrangement_kind_check",
      sql`${table.kind} IN ('hourly', 'flat_fee', 'contingency', 'retainer')`,
    ),
    check("matter_billing_arrangement_version_positive_check", sql`${table.version} > 0`),
    check("matter_billing_arrangement_currency_check", sql`length(${table.currency}) = 3`),
    // Each kind carries exactly its own fields — a flat-fee row with a contingency share is a row
    // whose meaning nobody can state.
    check(
      "matter_billing_arrangement_kind_shape_check",
      sql`(${table.kind} = 'flat_fee') = (${table.flatFeeAmountMinor} IS NOT NULL)
        AND (${table.kind} = 'contingency') = (${table.contingencyShareE4} IS NOT NULL)
        AND (${table.kind} = 'contingency') = (${table.contingencyBasis} IS NOT NULL)
        AND (${table.kind} = 'retainer') = (${table.retainerTargetMinor} IS NOT NULL)
        AND (${table.kind} = 'retainer') = (${table.retainerThresholdMinor} IS NOT NULL)`,
    ),
    check(
      "matter_billing_arrangement_flat_fee_positive_check",
      sql`${table.flatFeeAmountMinor} IS NULL OR ${table.flatFeeAmountMinor} > 0`,
    ),
    // A share is a fraction of the recovery: above zero, at most the whole of it.
    check(
      "matter_billing_arrangement_share_bounds_check",
      sql`${table.contingencyShareE4} IS NULL OR (${table.contingencyShareE4} > 0 AND ${table.contingencyShareE4} <= 10000)`,
    ),
    check(
      "matter_billing_arrangement_retainer_bounds_check",
      sql`${table.retainerTargetMinor} IS NULL OR (${table.retainerTargetMinor} > 0 AND ${table.retainerThresholdMinor} >= 0 AND ${table.retainerThresholdMinor} <= ${table.retainerTargetMinor})`,
    ),
    check(
      "matter_billing_arrangement_destination_check",
      sql`${table.advanceDepositDestination} IS NULL OR ${table.advanceDepositDestination} IN ('trust', 'operating')`,
    ),
  ],
);

// One recorded recovery on a matter — a settlement, a judgment, an award. The contingency fee is
// computed FROM these at invoice time and is never stored here: what is recorded is the fact of the
// recovery, and the fee is always a derivation of the agreement's share against the recoveries as
// they stand when the bill is composed. Append-only apart from the void transition (a recovery
// entered in error is voided with a reason, never edited or deleted), enforced by triggers in the
// migration.
export const matterRecovery = sqliteTable(
  "matter_recovery",
  {
    id: text("id").primaryKey().$type<MatterRecoveryId>(), // matterRecovery_ handle
    matterId: text("matter_id")
      .notNull()
      .$type<MatterId>()
      .references(() => matter.id),
    amountMinor: integer("amount_minor").notNull(),
    currency: text("currency").notNull(),
    recoveredDate: text("recovered_date").notNull(), // civil PlainDate
    description: text("description").notNull(),
    recordedBy: text("recorded_by").$type<UserId>(),
    recordedAt: text("recorded_at").notNull(),
    voidedAt: text("voided_at"),
    voidedBy: text("voided_by").$type<UserId>(),
    voidReason: text("void_reason"),
  },
  (table) => [
    index("matter_recovery_matter_index").on(table.matterId),
    check("matter_recovery_amount_positive_check", sql`${table.amountMinor} > 0`),
    check("matter_recovery_currency_check", sql`length(${table.currency}) = 3`),
    check("matter_recovery_description_nonempty_check", sql`length(${table.description}) > 0`),
    check(
      "matter_recovery_void_paired_check",
      sql`(${table.voidedAt} IS NULL) = (${table.voidReason} IS NULL)`,
    ),
  ],
);

// A record that a retainer matter's trust balance fell below the arrangement's floor, and by how
// much. The request is the RECORD of the ask — the observed available balance, the shortfall against
// the target, and who raised it — so the replenishment conversation has a row a person can point to
// rather than a number somebody once noticed on a dashboard. It moves no money and writes no trust
// table; the client's deposit arrives through trust's own deposit path, and slice 3·7 wires the
// below-floor alert onto the same topic this emits. Mutable only for its resolution, by trigger; one
// OPEN request per matter by partial unique index.
export const retainerReplenishmentRequest = sqliteTable(
  "retainer_replenishment_request",
  {
    id: text("id").primaryKey().$type<RetainerReplenishmentRequestId>(), // retainerReplenishmentRequest_ handle
    matterId: text("matter_id")
      .notNull()
      .$type<MatterId>()
      .references(() => matter.id),
    // The retainer arrangement version the floor came from — the target and threshold live there.
    arrangementId: text("arrangement_id")
      .notNull()
      .$type<BillingArrangementId>()
      .references(() => matterBillingArrangement.id),
    // The available trust balance OBSERVED when the request was raised — evidence of why, not a live
    // figure. The live balance is trust's to answer.
    observedBalanceMinor: integer("observed_balance_minor").notNull(),
    requestedAmountMinor: integer("requested_amount_minor").notNull(),
    currency: text("currency").notNull(),
    requestedAt: text("requested_at").notNull(),
    requestedBy: text("requested_by").$type<UserId>(),
    resolvedAt: text("resolved_at"),
    resolvedBy: text("resolved_by").$type<UserId>(),
  },
  (table) => [
    uniqueIndex("retainer_replenishment_request_open_unique_index")
      .on(table.matterId)
      .where(sql`${table.resolvedAt} IS NULL`),
    index("retainer_replenishment_request_matter_index").on(table.matterId),
    check(
      "retainer_replenishment_request_amount_positive_check",
      sql`${table.requestedAmountMinor} > 0`,
    ),
    check(
      "retainer_replenishment_request_observed_not_negative_check",
      sql`${table.observedBalanceMinor} >= 0`,
    ),
    check("retainer_replenishment_request_currency_check", sql`length(${table.currency}) = 3`),
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
    category: text("category", {
      enum: ["litigation", "transaction", "firm", "other"],
    })
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
    // Why this setting is no longer happening, when it is not — set by the cancel and continuance
    // paths, optional because an outright cancellation does not always deserve a paragraph. What
    // distinguishes a continuance from a cancellation is not this column but the existence of a
    // successor, which is calendar_event_link's fact.
    statusReason: text("status_reason"),
    // ---- recurrence -------------------------------------------------------------------------
    // A repeating setting is ONE row with a rule, expanded across the window a read asks for. The
    // alternative — a row per occurrence — multiplies a firm's calendar by the length of its
    // longest series before anybody looks at it, and makes "move the series" fifty-two writes.
    //
    // The rule is an RFC 5545 RRULE ("FREQ=WEEKLY;BYDAY=TU;COUNT=12"), null on a one-off. The
    // standard is stored rather than a private shape because it is the one every calendar product
    // reads and writes, and a firm exporting its calendar should not find this product's dialect in
    // it. What the FORM offers is narrower than the standard allows; a rule it cannot present is
    // read, painted and left uneditable rather than silently rewritten.
    recurrenceRule: text("recurrence_rule"),
    // An EXCEPTION: a real event that replaces one occurrence of a series. The parent's expansion
    // skips the date this names, so an occurrence moved, renamed or called off is an ordinary row
    // that happens to know what it replaces — and every read that already understands an event
    // understands it, including the cancelled-and-struck rule.
    recurrenceParentId: text("recurrence_parent_id").$type<MatterEventId>(),
    // The civil date in the parent's series this row stands in for. Set with the parent id and
    // never without it.
    recurrenceOccurrenceOn: text("recurrence_occurrence_on"),
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
    // Where an online setting is JOINED: the meeting's own link, whoever hosts it. A URL rather than
    // a provider and a room number, because every conferencing service the firm might use — and the
    // next one it moves to — expresses a meeting as a link, and a schema that named providers would
    // be a list this repository maintains on their release schedules. Nullable, and null is the
    // ordinary case: most settings are somewhere.
    conferenceUrl: text("conference_url"),
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
    check("matter_event_starts_on_shape_check", civilDateShape(table.startsOn)),
    // The occurrence an exception replaces is a civil date like every other day on a calendar.
    check(
      "matter_event_recurrence_occurrence_on_shape_check",
      civilDateShape(table.recurrenceOccurrenceOn, true),
    ),
    check("matter_event_ends_on_shape_check", civilDateShape(table.endsOn, true)),
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
    participantKind: text("participant_kind", {
      enum: ["member", "entity", "external"],
    }).notNull(),
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
    // predicate rather than by reading every event and discarding most of them. The predicate
    // supplies BOTH columns, so both are indexed and the lookup is a covering seek; keyed on the
    // member first so it also answers "which events is this member on" without an event in hand.
    index("matter_event_participant_member_event_index").on(table.memberUserId, table.eventId),
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
    source: text("source", {
      enum: ["member", "court_order", "statutory_catalog"],
    })
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
    state: text("state", {
      enum: ["open", "satisfied", "vacated", "superseded"],
    })
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
    check("matter_deadline_due_on_shape_check", civilDateShape(table.dueOn)),
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

// A note on a matter: what the firm wrote down about a case that no other record holds.
//
// ONE ROW, edited in place and deleted outright. The first cut of this table held an identity row
// and a chain of revisions, so a correction appended and nothing was ever removed. The owner's
// direction on 2026-09-01 replaced it: a note is edited and deleted like any other record, because
// replacing a note with another note every time somebody fixes a word accumulates without end and
// the chain was never what a firm asked for. What that costs is stated where it belongs, in the
// package's own CLAUDE.md, rather than argued here.
//
// The attachment is a real foreign key to `matter` and not a `subject_kind`/`subject_id` pair. The
// cost of the polymorphic shape is already measured in this schema: `audit_log.subject_id` is
// untyped, holds whatever the writer thought the subject was, and the timeline's read of it needs a
// prefix scan to confine itself to rows whose subject really is a matter.
export const matterNote = sqliteTable(
  "matter_note",
  {
    id: text("id").primaryKey().$type<MatterNoteId>(), // matterNote_ handle
    matterId: text("matter_id")
      .notNull()
      .$type<MatterId>()
      .references(() => matter.id),
    // Who wrote it first, and it never nulls, never repoints, and is not anonymized when they leave.
    // An unattributed record is worth a fraction of an attributed one. That a former member wrote it
    // is a JOIN on member.status at read time, never a column here: a fact that is a join cannot
    // drift from the row it joins.
    authorUserId: text("author_user_id").notNull().$type<UserId>(),
    body: text("body").notNull(),
    // Who last changed the words, where anybody has. Null on a note nobody has edited, which is why
    // it is not simply the author repeated: "nobody has touched this since it was written" and "the
    // author edited their own note" are different facts and the column can say which.
    lastEditedBy: text("last_edited_by").$type<UserId>(),
    // WHEN THE THING HAPPENED, which is not when the note was typed. A note written on Thursday about
    // a call on Tuesday carries both: created_at is the typing, and this is the call. Optional,
    // because plenty of notes record no single moment ("do not call this client before 10am").
    //
    // A civil date and a separate optional wall-clock time, on the calendar's model and for its
    // reasons: "that afternoon, we don't know when" is a real and common answer, and no column
    // stores midnight-local-as-UTC, which is the daylight-saving off-by-one that moves a record by a
    // day when the clocks change.
    occurredOn: text("occurred_on"), // civil date, YYYY-MM-DD
    occurredAtTime: text("occurred_at_time"), // wall clock, HH:MM
    // The zone the wall-clock time above is read in. Required whenever there IS one and meaningless
    // without one — a bare "3pm" on a record somebody reads in another state is not a time.
    timeZone: text("time_zone"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    // The matter's own note list and the federated timeline's read of it. The timeline sorts by when
    // the thing HAPPENED where the note says, falling back to the day it was written, so the index
    // leads with the matter and the fallback date is computed in the read.
    index("matter_note_matter_created_at_id_index").on(table.matterId, table.createdAt, table.id),
    index("matter_note_matter_occurred_on_id_index").on(table.matterId, table.occurredOn, table.id),
    // The firm-wide timeline window, which bounds by date across every matter.
    index("matter_note_created_at_id_index").on(table.createdAt, table.id),
    index("matter_note_author_index").on(table.authorUserId),
    check("matter_note_body_check", sql`length(${table.body}) > 0`),
    check("matter_note_occurred_on_shape_check", civilDateShape(table.occurredOn, true)),
    check(
      "matter_note_occurred_at_time_shape_check",
      sql`${table.occurredAtTime} IS NULL OR ${table.occurredAtTime} GLOB '[0-2][0-9]:[0-5][0-9]'`,
    ),
    // A time with no date is not a moment anybody can place, and a wall clock with no zone is not a
    // time. Both directions of the second one: a zone on a note that names no time says nothing.
    check(
      "matter_note_occurrence_shape_check",
      sql`(${table.occurredAtTime} IS NULL OR ${table.occurredOn} IS NOT NULL)
        AND (${table.occurredAtTime} IS NULL) = (${table.timeZone} IS NULL)`,
    ),
  ],
);

// A file on the matter, linked to a note. Modelled on matter_asset_document, and the reasoning
// carries over unchanged.
//
// BYTES NEVER REACH A NOTE ROUTE. Upload is the File Manager's presigned-upload and quarantine
// chokepoint, and this row links the resulting handle. A letter attached to a note is still in the
// matter's file list, still previewable, still convertible, still under any legal hold, still in
// discovery — it gained an association and lost nothing.
//
// MANY-TO-MANY in both directions. One letter is discussed in the note about the call that preceded
// it and the note about the call that followed; one note about a document review names every file it
// covered. Requiring a file to belong to one note would make a firm choose which note to attach it
// to, which is how a link stops being used.
export const matterNoteDocument = sqliteTable(
  "matter_note_document",
  {
    id: text("id").primaryKey().$type<MatterNoteDocumentId>(), // matterNoteDocument_ handle
    noteId: text("note_id")
      .notNull()
      .$type<MatterNoteId>()
      .references(() => matterNote.id),
    fileId: text("file_id")
      .notNull()
      .$type<FileId>()
      .references(() => file.id),
    linkedAt: text("linked_at").notNull(),
    linkedBy: text("linked_by").$type<UserId>(),
  },
  (table) => [
    index("matter_note_document_note_index").on(table.noteId),
    // The reverse read: which notes discuss this document. Not unique — see the table comment.
    index("matter_note_document_file_index").on(table.fileId),
    // One document rides one note once. A second identical link is a duplicate row a person reads as
    // the same file twice, and detaching one would leave the other behind.
    uniqueIndex("matter_note_document_note_file_unique_index").on(table.noteId, table.fileId),
  ],
);

// THE TASK: one piece of work with somebody's name on it and a state that says whether the firm
// still owes it. Three things distinguish it from the two dated records already here, and all three
// are why it is its own table rather than a column on one of them.
//
// It has an ASSIGNEE and a COMPLETION STATE, which neither a matter_event nor a matter_deadline has.
// And it has no external reality: nobody continues a task, nothing vacates it, and no court knows it
// exists. Modelling one as an event would import the continuance discipline, under which a hearing
// moved from the 3rd to the 17th is two rows because both settings really happened — but a task's
// due date moving is somebody changing their mind, and two rows would put two items on one person's
// list. Modelling one as a deadline would dilute the table whose whole purpose is that a missing
// entry is a malpractice event; a deadline surface that is mostly "call the client back" is a
// deadline surface people stop reading.
//
// MATTER_ID IS NULLABLE, and this is a deliberate departure from firm_event immediately below, which
// took the opposite decision for its own scope. Read both before copying either. The calendar's
// argument was that a null matter puts a does-not-apply branch inside the visibility seam, and that
// dropping a NOT NULL on a shipped table is a rebuild the additive-only lineage forbids. The second
// half does not apply to a table that is nullable from its first migration. The first half is real
// and is answered by confinement rather than by a second table: the branch lives in exactly one
// function, taskVisibilityFragment in packages/tasks/src/task-statements.ts, and every read composes
// it. The reason not to take firm_event's answer is that the two records differ in where they are
// read: a firm event is read on the firm's calendar and a matter event on the matter's, so two
// tables match two surfaces. Tasks have one surface either way — "what is on my plate" spans a
// member's client work and their firm work in one list, and splitting the table would mean unioning
// it back together on the read every member makes most often. magnus_conversation is the precedent
// this follows: an optional matter link on a record whose tenancy root is the firm.
//
// A task with no matter is PRIVATE to its assignee and whoever created it. A task on a matter is
// firm-visible within that matter, screened by the same visible-matter predicate every calendar
// source composes. Those are two rules in one predicate, not two subsystems.
//
// NO OVERDUE COLUMN, and there is deliberately no way to add one here. Overdue is a comparison
// against now, computed where the reader is, through packages/calendar/src/overdue.ts. The argument
// the calendar makes for deadlines is stronger here: tasks are numerous, a nightly per-firm sweep
// over them is exactly the heavy scheduled work that belongs off this platform, and a stored flag is
// stale in precisely the window where it matters.
export const matterTask = sqliteTable(
  "matter_task",
  {
    id: text("id").primaryKey().$type<MatterTaskId>(), // matterTask_ handle
    // Nullable — see the table comment. Not a foreign key we can lean on for tenancy, so every read
    // composes the visibility predicate rather than trusting the column.
    matterId: text("matter_id")
      .$type<MatterId>()
      .references(() => matter.id),
    title: text("title").notNull(),
    body: text("body"),
    // Nullable, and an unassigned task is a real state rather than a defect: a backlog item nobody
    // has picked up, or a plan template whose role resolved to nobody. An unresolved assignment is
    // shown as unassigned and never silently given to the responsible attorney.
    assigneeUserId: text("assignee_user_id").$type<UserId>(),
    // Who put the task there. Never nulls and never repoints — it is half of what makes a matterless
    // task reachable, and an unattributed obligation is worth a fraction of an attributed one.
    createdBy: text("created_by").notNull().$type<UserId>(),
    // A closed platform vocabulary rather than a firm picklist. Four values with an inherent order,
    // so a list sorts by urgency without a join and the notification facts can carry a value their
    // reader knows. There is no separate 'none': `normal` IS the absence of a signal, and two ways to
    // say that is how a filter ends up with a checkbox nobody understands.
    priority: text("priority", { enum: ["low", "normal", "high", "urgent"] })
      .notNull()
      .default("normal"),
    // The deadline's own column shape, and reached through the same resolver
    // (packages/calendar/src/time-zone.ts). A civil date, an optional wall-clock time, and the zone
    // that time is read in. NOT a UTC instant, for the reason the calendar states as an invariant: no
    // column stores midnight-local-as-UTC, which is the daylight-saving off-by-one that moves a dated
    // record by a day when the clocks change. A task due "Friday" that fires Thursday night twice a
    // year is that bug with lower stakes and far higher frequency.
    //
    // All three are optional TOGETHER: a task with no due date is ordinary, not a gap. The zone is
    // required whenever there is a date, because a task due "Friday" for somebody in Reno and
    // somebody in Boston is due at two different moments and the row has to say which.
    dueOn: text("due_on"), // civil date, YYYY-MM-DD
    dueAtTime: text("due_at_time"), // wall clock, HH:MM
    // The ASSIGNEE'S zone, frozen at the write from their office — the discipline
    // firm_resource_booking already uses, so an office zone change never reinterprets an existing
    // row. A task reassigned across offices keeps its zone unless somebody changes the date: silently
    // moving a due date by three hours on a reassignment is worse than a mismatch a person can see.
    timeZone: text("time_zone"),
    // WHETHER THE WORK IS FINISHED. Two live values, `open` and `done`, and it answers only that.
    // Where a task stands WHILE it is open is `progress` below, and the two are not a duplicated
    // fact: this column is what `completed_at`/`completed_by` are paired with by CHECK, and it is
    // what every index and every closed-matter read already leads on.
    //
    // `cancelled` IS RETIRED AND IS NEVER WRITTEN AGAIN. It said the firm decided not to do the
    // work, with a required reason — and in practice nobody reached for it, because deciding not to
    // do something and putting it away are the same gesture to the person doing it. Archiving
    // replaced it (`archived_at` below), and the migration moved every cancelled row across with its
    // reason intact. The VALUE stays in the CHECK because removing it is a table rebuild, and
    // matter_task is a parent: see the archive columns below for why that is not available here.
    state: text("state", { enum: ["open", "done", "cancelled"] })
      .notNull()
      .default("open"),
    // Completion is one-way in the product and reversible in the record. Reopening moves the state
    // back and clears these, and the audit row carries that it happened — a task that was closed and
    // reopened is a fact about how the matter ran.
    completedAt: text("completed_at"), // UTC instant
    completedBy: text("completed_by").$type<UserId>(),
    // Retired with `cancelled` above, and kept for the same reason: dropping a column from a parent
    // table is the rebuild that cannot run. Every row is NULL — the migration emptied the last of
    // them into the archive columns — and nothing reads or writes them.
    cancelledAt: text("cancelled_at"), // UTC instant
    cancelledBy: text("cancelled_by").$type<UserId>(),
    cancellationReason: text("cancellation_reason"),
    // WHERE AN OPEN TASK STANDS: the rung a person moves it along as they work. Four rungs reach the
    // reader — To Do, In Progress, On Hold, Done — and the fourth is `state` above, which is why it
    // is not repeated here. A task that is done has a completion actor and instant to carry; the
    // three rungs below carry nothing but themselves, so they are one column and not four booleans.
    //
    // The rung a task is left on is NOT cleared by completing it. Reopening a finished task puts it
    // back where it was rather than at the start, which is what somebody who ticked the wrong row
    // means by reopening it.
    progress: text("progress", { enum: ["to_do", "in_progress", "on_hold"] })
      .notNull()
      .default("to_do"),
    // PUT AWAY, KEPT. Archiving and deleting are the two ways a task leaves a list and they differ in
    // exactly one thing: a delete takes the data, an archive keeps it. So an archived task is absent
    // from every ordinary read and whole underneath — its documents, its time, its history.
    //
    // It is ORTHOGONAL to the rungs rather than a fifth one: a task is archived FROM wherever it
    // stood, and unarchiving puts it back there. A fifth rung would have made "On Hold, archived" and
    // "archived, was on hold" two different records of the same thing.
    //
    // The reason is OPTIONAL, which is the difference from the cancellation it replaces. That reason
    // was required, and requiring it is why the state went unused: somebody clearing a list of
    // work that is simply not happening is not composing a memo. It carries the reasons the
    // migration brought over from cancelled tasks, so nothing a firm wrote is lost.
    //
    // THESE ARE ADDED COLUMNS RATHER THAN A WIDER `state`, and that is the platform's constraint
    // rather than a modelling choice. Widening a CHECK in SQLite costs a table rebuild, a rebuild
    // drops the table it replaces, and this table has three children plus its own
    // `blocked_by_task_id` — a drop a durable object refuses at the commit, whatever pragma is set.
    // Six mechanisms were probed against real durable-object storage and all six fail
    // (apps/api-worker/test/durable-object-pragma-context.test.ts); the same file proves that an
    // added column may carry its own CHECK, including one naming a second column, which is what the
    // pair below rests on.
    archivedAt: text("archived_at"), // UTC instant
    archivedBy: text("archived_by").$type<UserId>(),
    archiveReason: text("archive_reason"),
    // One predecessor, and it GATES NOTHING. A blocked task renders as blocked and sorts below; it is
    // not refused and completing it out of order is allowed. A firm's real sequence has exceptions
    // constantly, and a checklist that enforces order is a checklist people stop using. Cycles are
    // refused at the write, where the chain is short and the walk is bounded.
    blockedByTaskId: text("blocked_by_task_id").$type<MatterTaskId>(),
    // Both are LINKS and never inputs to a calculation — the rule packages/calendar/CLAUDE.md states
    // for matter_deadline.trigger_event_id, inherited verbatim. `deadline_id` is what lets a firm ask
    // which obligations have no work scheduled against them; neither column moves a date.
    triggerEventId: text("trigger_event_id")
      .$type<MatterEventId>()
      .references(() => matterEvent.id),
    deadlineId: text("deadline_id")
      .$type<MatterDeadlineId>()
      .references(() => matterDeadline.id),
    // WHERE THIS TASK CAME FROM, where a matter plan proposed it and somebody accepted. Provenance
    // and never a live link: nothing resolves these on a read, editing a template does not touch a
    // task already on a matter, and deactivating one does not either. What they buy is the question
    // a firm actually asks — which matters came off the old intake plan — answered by matching a
    // handle rather than by a join that would make a template edit reach into open matters.
    //
    // They carry foreign keys for the same reason trigger_event_id above does: a link that is never
    // an input to a calculation is still a link that should point at something real, and a template
    // soft-deactivates rather than deleting, so nothing dangles.
    planTemplateId: text("plan_template_id")
      .$type<MatterPlanTemplateId>()
      .references(() => matterPlanTemplate.id),
    planTaskTemplateId: text("plan_task_template_id")
      .$type<MatterPlanTaskTemplateId>()
      .references(() => matterPlanTaskTemplate.id),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
    // WHO TOUCHED IT LAST. Null on a row nothing has edited since it was written, and on every row
    // that predates this column — an honest gap rather than a backfilled guess.
    //
    // It exists for the mirror. A system syncing this task both ways has to tell its OWN writes from
    // a person's, or it pushes back everything it just pulled and the two sides oscillate forever.
    // Reading the actor off the audit log would work and would make the cheapest question in the
    // feed ("did I do this?") a second query per row.
    updatedBy: text("updated_by").$type<UserId>(),
    // WHICH OF THE FIRM'S LISTS THIS TASK IS ON, and where it stands on that list's own statuses.
    // Every task is on exactly one list; the columns are nullable only because they were added to a
    // table that already held rows, and the migration that added them put every one of those rows on
    // the firm's first list. The write paths never leave either empty.
    //
    // A status is the firm's own word for where work stands, with a colour and a flow, and it says
    // nothing about whether the work is FINISHED — that is `state`, and completing a task works from
    // any status. `progress` above is retired by these two: it keeps its CHECK because removing a
    // column from this table is the rebuild it cannot take, and nothing writes it any more.
    listId: text("list_id")
      .$type<TaskListId>()
      .references(() => taskList.id),
    statusId: text("status_id")
      .$type<TaskListStatusId>()
      .references(() => taskListStatus.id),
    // A SUB-TASK is a whole task under another one. It shares its parent's list and matter, which the
    // write paths set and move together, and it may have sub-tasks of its own to a bounded depth.
    parentTaskId: text("parent_task_id")
      .$type<MatterTaskId>()
      .references((): AnySQLiteColumn => matterTask.id),
    // When the work can start, as a civil date in the due date's own shape and for the same reason.
    // It carries no zone of its own: it is read in the task's zone when there is one, and a start
    // date is a planning fact rather than a moment anything fires at.
    startsOn: text("starts_on"),
    // Where the work happens: a room, an address, or a meeting link. Free text, because those three
    // have nothing in common but being somewhere to go.
    location: text("location"),
    // A REPEATING TASK: the rule it repeats on, and when the next copy appears. Only the current
    // copy is a row. The next one is written when it is due to appear, so a list never fills with a
    // year of copies and editing the series means editing one row.
    //
    // The rule is an RFC 5545 line in @magna-carta/civil-time's grammar, read FROM THIS COPY ONWARD:
    // its series starts at `recurrence_occurrence_on`, and a `COUNT` says how many copies remain,
    // this one included. Each copy hands the next the same rule with the count one lower, so no copy
    // ever has to walk back to where the series began.
    recurrenceRule: text("recurrence_rule"),
    // `completed`: the next copy is made when this one is marked complete. `scheduled`: it appears on
    // its own start date (its due date when it has none) whether or not this one is done. The firm
    // chooses per task, because both are real ways a firm works.
    recurrenceMode: text("recurrence_mode", {
      enum: ["completed", "scheduled"],
    }),
    // The day of the series this copy stands for. Usually its due date; moving the due date of THIS
    // ONE ONLY leaves it where it was, so the next copy still falls where the rule says. Moving this
    // one AND LATER ONES moves it with the due date, and the series runs on from there.
    recurrenceOccurrenceOn: text("recurrence_occurrence_on"),
    // The copy made from this one, once it exists. Unique, so a completion and the hourly pass
    // racing each other cannot both make the next one.
    recurrenceNextTaskId: text("recurrence_next_task_id").$type<MatterTaskId>(),
  },
  (table) => [
    uniqueIndex("matter_task_recurrence_next_task_unique_index").on(table.recurrenceNextTaskId),
    // The hourly pass's read: the repeating tasks whose next copy does not exist yet.
    index("matter_task_recurrence_mode_index").on(table.recurrenceMode, table.recurrenceNextTaskId),
    check(
      "matter_task_recurrence_shape_check",
      sql`(${table.recurrenceRule} IS NULL) = (${table.recurrenceMode} IS NULL)
        AND (${table.recurrenceRule} IS NULL) = (${table.recurrenceOccurrenceOn} IS NULL)`,
    ),
    check(
      "matter_task_recurrence_mode_check",
      sql`${table.recurrenceMode} IS NULL OR ${table.recurrenceMode} IN ('completed', 'scheduled')`,
    ),
    check(
      "matter_task_recurrence_occurrence_on_shape_check",
      civilDateShape(table.recurrenceOccurrenceOn, true),
    ),
    // The list's own read, and the band a Group By List draws.
    index("matter_task_list_state_index").on(table.listId, table.state),
    index("matter_task_status_index").on(table.statusId),
    // A parent's sub-tasks, read on every row that has any.
    index("matter_task_parent_index").on(table.parentTaskId),
    check("matter_task_starts_on_shape_check", civilDateShape(table.startsOn, true)),
    check("matter_task_parent_self_check", sql`${table.parentTaskId} != ${table.id}`),
    // The provenance read: which matters came off this plan.
    index("matter_task_plan_template_index").on(table.planTemplateId),
    // THE CHANGE FEED. "What moved since I last looked", as a keyset over the pair — the instant
    // alone is not a cursor, because two tasks written in the same millisecond would make a page
    // boundary either skip one or repeat it. The id breaks the tie and the pair is what a caller
    // carries.
    index("matter_task_updated_at_id_index").on(table.updatedAt, table.id),
    // "What is on my plate", which is the read a member makes most often and the one that decides
    // whether this subsystem gets used. Leads with the assignee and the state so the open ones come
    // off the index without a scan.
    index("matter_task_assignee_state_due_on_index").on(
      table.assigneeUserId,
      table.state,
      table.dueOn,
    ),
    // The matter's own task list, and the federated timeline's read of it.
    index("matter_task_matter_due_on_id_index").on(table.matterId, table.dueOn, table.id),
    index("matter_task_matter_created_at_id_index").on(table.matterId, table.createdAt, table.id),
    // The matterless list, which no matter index can serve.
    index("matter_task_created_by_index").on(table.createdBy, table.createdAt),
    index("matter_task_blocked_by_index").on(table.blockedByTaskId),
    index("matter_task_deadline_index").on(table.deadlineId),
    check("matter_task_title_check", sql`length(${table.title}) > 0`),
    check(
      "matter_task_priority_check",
      sql`${table.priority} IN ('low', 'normal', 'high', 'urgent')`,
    ),
    check("matter_task_state_check", sql`${table.state} IN ('open', 'done', 'cancelled')`),
    check(
      "matter_task_progress_check",
      sql`${table.progress} IN ('to_do', 'in_progress', 'on_hold')`,
    ),
    // Archived is an instant and an actor together or neither, and a reason is a thing said ABOUT an
    // archiving — so a reason with no archiving is a row that says why something happened that did
    // not. The reverse is allowed and is the ordinary case: most archivings say nothing.
    //
    // No index is added for it. Every ordinary read gains `archived_at IS NULL`, and the reads that
    // matter already lead on the assignee and the state; whether an archive-aware index earns its
    // write cost is a question for the load-profile harness rather than a guess made here.
    check(
      "matter_task_archive_shape_check",
      sql`(${table.archivedAt} IS NULL) = (${table.archivedBy} IS NULL)
        AND (${table.archivedAt} IS NOT NULL OR ${table.archiveReason} IS NULL)`,
    ),
    check("matter_task_due_on_shape_check", civilDateShape(table.dueOn, true)),
    check(
      "matter_task_due_at_time_shape_check",
      sql`${table.dueAtTime} IS NULL OR ${table.dueAtTime} GLOB '[0-2][0-9]:[0-5][0-9]'`,
    ),
    // A time with no date is not a moment anybody can place, and a date with no zone is not a moment
    // either — the second in both directions, because a zone on a task with no due date says nothing.
    check(
      "matter_task_due_shape_check",
      sql`(${table.dueAtTime} IS NULL OR ${table.dueOn} IS NOT NULL)
        AND (${table.dueOn} IS NULL) = (${table.timeZone} IS NULL)`,
    ),
    // Each terminal state carries its own evidence, and neither carries the other's. A `done` task
    // has a completion actor and instant; a `cancelled` task has both plus the reason; an `open` task
    // has none of it. Held here so a repair script cannot invent a completion nobody performed.
    check(
      "matter_task_completion_shape_check",
      sql`(${table.state} = 'done' AND ${table.completedAt} IS NOT NULL AND ${table.completedBy} IS NOT NULL)
        OR (${table.state} != 'done' AND ${table.completedAt} IS NULL AND ${table.completedBy} IS NULL)`,
    ),
    check(
      "matter_task_cancellation_shape_check",
      sql`(${table.state} = 'cancelled' AND ${table.cancelledAt} IS NOT NULL AND ${table.cancelledBy} IS NOT NULL
          AND ${table.cancellationReason} IS NOT NULL AND length(${table.cancellationReason}) > 0)
        OR (${table.state} != 'cancelled' AND ${table.cancelledAt} IS NULL AND ${table.cancelledBy} IS NULL
          AND ${table.cancellationReason} IS NULL)`,
    ),
    // A task never blocks on itself. The longer chains are walked at the write; this closes the
    // one-hop case at the database, where it costs nothing.
    check("matter_task_blocked_by_self_check", sql`${table.blockedByTaskId} != ${table.id}`),
  ],
);

// A file on the task's matter, linked to a task. Modelled on matter_note_document, whose reasoning
// carries over unchanged: bytes never reach a task route, the link names a handle the File Manager
// already holds, and detaching leaves the document exactly where it lives.
//
// A TASK WITH NO MATTER POINTS AT NO DOCUMENTS, and that is a consequence rather than a rule anybody
// had to invent: every row in `file` carries a NOT NULL matter_id, so there is no such thing as a
// firm-wide file for a matterless task to point at. The write path refuses the link with its own
// code rather than failing a join.
export const matterTaskDocument = sqliteTable(
  "matter_task_document",
  {
    id: text("id").primaryKey().$type<MatterTaskDocumentId>(), // matterTaskDocument_ handle
    taskId: text("task_id")
      .notNull()
      .$type<MatterTaskId>()
      .references(() => matterTask.id),
    fileId: text("file_id")
      .notNull()
      .$type<FileId>()
      .references(() => file.id),
    linkedAt: text("linked_at").notNull(),
    linkedBy: text("linked_by").$type<UserId>(),
  },
  (table) => [
    index("matter_task_document_task_index").on(table.taskId),
    index("matter_task_document_file_index").on(table.fileId),
    // One document rides one task once. A second identical link is a row a person reads as the same
    // file twice, and detaching one would leave the other behind.
    uniqueIndex("matter_task_document_task_file_unique_index").on(table.taskId, table.fileId),
  ],
);

// THE FIRM'S TASK LISTS. A firm keeps several — one for the partners, one for assignments, one per
// kind of case — and every task sits on exactly one. A list has no visibility setting: every member
// sees every task (owner ruling, 2026-11-09), and narrowing the screen to your own work is the
// reader's Me Mode rather than a property of the list.
//
// Exactly one live list is the DEFAULT, where a task lands when nobody picks another; the partial
// unique index holds "at most one" and the write paths hold "at least one". A list is retired rather
// than deleted, because its tasks still point at it.
export const taskList = sqliteTable(
  "task_list",
  {
    id: text("id").primaryKey().$type<TaskListId>(), // taskList_ handle
    name: text("name").notNull(),
    // The order the lists are offered in. Gaps are fine; ties break on the name.
    position: integer("position").notNull().default(0),
    isDefault: integer("is_default", { mode: "boolean" }).notNull().default(false),
    createdAt: text("created_at").notNull(),
    createdBy: text("created_by").$type<UserId>(),
    updatedAt: text("updated_at").notNull(),
    retiredAt: text("retired_at"),
  },
  (table) => [
    uniqueIndex("task_list_name_live_unique_index")
      .on(table.name)
      .where(sql`${table.retiredAt} IS NULL`),
    uniqueIndex("task_list_default_unique_index")
      .on(table.isDefault)
      .where(sql`${table.isDefault} = 1`),
    check("task_list_name_nonempty_check", sql`length(${table.name}) > 0`),
    check(
      "task_list_default_live_check",
      sql`${table.isDefault} = 0 OR ${table.retiredAt} IS NULL`,
    ),
  ],
);

// A LIST'S OWN STATUSES: the firm's words for where work stands, each with a colour, in an order. The
// first by position is where a new task on the list starts. A status says nothing about whether the
// work is finished; completing is separate and works from any status.
//
// The colour is a CLOSED vocabulary the web side maps onto design tokens, so a firm picks a colour
// without picking a value the design system never reviewed. Growing it is a migration on purpose.
export const taskListStatus = sqliteTable(
  "task_list_status",
  {
    id: text("id").primaryKey().$type<TaskListStatusId>(), // taskListStatus_ handle
    listId: text("list_id")
      .notNull()
      .$type<TaskListId>()
      .references(() => taskList.id),
    name: text("name").notNull(),
    colour: text("colour", {
      enum: ["gray", "blue", "orange", "amber", "green", "purple", "red"],
    })
      .notNull()
      .default("gray"),
    position: integer("position").notNull().default(0),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    index("task_list_status_list_index").on(table.listId, table.position),
    uniqueIndex("task_list_status_list_name_unique_index").on(table.listId, table.name),
    check("task_list_status_name_nonempty_check", sql`length(${table.name}) > 0`),
    check(
      "task_list_status_colour_check",
      sql`${table.colour} IN ('gray', 'blue', 'orange', 'amber', 'green', 'purple', 'red')`,
    ),
  ],
);

// THE FLOW: one row per move a list allows, from one of its statuses to another. A move the flow does
// not hold is refused at the write. Completing and reopening are not moves and ignore it.
export const taskListStatusTransition = sqliteTable(
  "task_list_status_transition",
  {
    fromStatusId: text("from_status_id")
      .notNull()
      .$type<TaskListStatusId>()
      .references(() => taskListStatus.id),
    toStatusId: text("to_status_id")
      .notNull()
      .$type<TaskListStatusId>()
      .references(() => taskListStatus.id),
  },
  (table) => [
    primaryKey({ columns: [table.fromStatusId, table.toStatusId] }),
    index("task_list_status_transition_to_index").on(table.toStatusId),
    check(
      "task_list_status_transition_distinct_check",
      sql`${table.fromStatusId} != ${table.toStatusId}`,
    ),
  ],
);

// A TEAM: a named group of members a task can be assigned to as one, so a matter's whole team is one
// click rather than four. Assigning a team assigns whoever is on it when the list is read, so a new
// member of the team sees its work without anybody reassigning anything.
export const taskTeam = sqliteTable(
  "task_team",
  {
    id: text("id").primaryKey().$type<TaskTeamId>(), // taskTeam_ handle
    name: text("name").notNull(),
    createdAt: text("created_at").notNull(),
    createdBy: text("created_by").$type<UserId>(),
    updatedAt: text("updated_at").notNull(),
    retiredAt: text("retired_at"),
  },
  (table) => [
    uniqueIndex("task_team_name_live_unique_index")
      .on(table.name)
      .where(sql`${table.retiredAt} IS NULL`),
    check("task_team_name_nonempty_check", sql`length(${table.name}) > 0`),
  ],
);

export const taskTeamMember = sqliteTable(
  "task_team_member",
  {
    teamId: text("team_id")
      .notNull()
      .$type<TaskTeamId>()
      .references(() => taskTeam.id),
    userId: text("user_id").notNull().$type<UserId>(),
    addedAt: text("added_at").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.teamId, table.userId] }),
    // "Which teams am I on", which Me Mode asks on every read.
    index("task_team_member_user_index").on(table.userId),
  ],
);

// A TASK'S ASSIGNEES: each one a member or a team, never both, in the order they were named. The
// task's own `assignee_user_id` stays the first PERSON here, written in the same batch, because the
// assignment notification, the mirror seam and the "what is on my plate" index all read it.
export const matterTaskAssignee = sqliteTable(
  "matter_task_assignee",
  {
    id: text("id").primaryKey().$type<MatterTaskAssigneeId>(), // matterTaskAssignee_ handle
    taskId: text("task_id")
      .notNull()
      .$type<MatterTaskId>()
      .references(() => matterTask.id),
    userId: text("user_id").$type<UserId>(),
    teamId: text("team_id")
      .$type<TaskTeamId>()
      .references(() => taskTeam.id),
    position: integer("position").notNull().default(0),
    addedAt: text("added_at").notNull(),
    addedBy: text("added_by").$type<UserId>(),
  },
  (table) => [
    index("matter_task_assignee_task_index").on(table.taskId, table.position),
    index("matter_task_assignee_user_index").on(table.userId),
    index("matter_task_assignee_team_index").on(table.teamId),
    uniqueIndex("matter_task_assignee_task_user_unique_index")
      .on(table.taskId, table.userId)
      .where(sql`${table.userId} IS NOT NULL`),
    uniqueIndex("matter_task_assignee_task_team_unique_index")
      .on(table.taskId, table.teamId)
      .where(sql`${table.teamId} IS NOT NULL`),
    check(
      "matter_task_assignee_one_kind_check",
      sql`(${table.userId} IS NULL) != (${table.teamId} IS NULL)`,
    ),
  ],
);

// A TASK'S WATCHERS: members kept informed of the work without doing it, the way a letter is copied.
export const matterTaskWatcher = sqliteTable(
  "matter_task_watcher",
  {
    taskId: text("task_id")
      .notNull()
      .$type<MatterTaskId>()
      .references(() => matterTask.id),
    userId: text("user_id").notNull().$type<UserId>(),
    addedAt: text("added_at").notNull(),
    addedBy: text("added_by").$type<UserId>(),
  },
  (table) => [
    primaryKey({ columns: [table.taskId, table.userId] }),
    index("matter_task_watcher_user_index").on(table.userId),
  ],
);

// A TASK'S CHECKLIST: the small steps inside one piece of work, ticked off as they go. A step that
// deserves its own assignee, dates or status is a sub-task instead.
export const matterTaskChecklistItem = sqliteTable(
  "matter_task_checklist_item",
  {
    id: text("id").primaryKey().$type<MatterTaskChecklistItemId>(), // matterTaskChecklistItem_ handle
    taskId: text("task_id")
      .notNull()
      .$type<MatterTaskId>()
      .references(() => matterTask.id),
    text: text("text").notNull(),
    position: integer("position").notNull().default(0),
    doneAt: text("done_at"),
    doneBy: text("done_by").$type<UserId>(),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    index("matter_task_checklist_item_task_index").on(table.taskId, table.position),
    check("matter_task_checklist_item_text_nonempty_check", sql`length(${table.text}) > 0`),
    check(
      "matter_task_checklist_item_done_shape_check",
      sql`(${table.doneAt} IS NULL) = (${table.doneBy} IS NULL)`,
    ),
  ],
);

// AN ADDRESS A TASK POINTS AT: a court's filing page, a shared folder, a brief somewhere else. Not
// the mirror's identity (that is matter_task_external_link) and not a matter file (that is
// matter_task_document) — just somewhere a person goes to do the work.
export const matterTaskLink = sqliteTable(
  "matter_task_link",
  {
    id: text("id").primaryKey().$type<MatterTaskLinkId>(), // matterTaskLink_ handle
    taskId: text("task_id")
      .notNull()
      .$type<MatterTaskId>()
      .references(() => matterTask.id),
    url: text("url").notNull(),
    label: text("label"),
    position: integer("position").notNull().default(0),
    createdAt: text("created_at").notNull(),
    createdBy: text("created_by").$type<UserId>(),
  },
  (table) => [
    index("matter_task_link_task_index").on(table.taskId, table.position),
    check("matter_task_link_url_nonempty_check", sql`length(${table.url}) > 0`),
  ],
);

// A TASK'S IDENTITY SOMEWHERE ELSE, and the tombstone a deleted task leaves behind. Both exist for
// one reason: this platform is not the only place a firm's work is written down, and an ADDON that
// mirrors tasks to an outside system needs two things the task row alone cannot give it.
//
// THE PLATFORM SHIPS NO ADAPTER and integrates with nothing here. What ships is the seam: `system`
// is open text constrained to a non-empty value — the `directory_edge.edge_type` discipline — so a
// second system is an addon rather than a migration, and nothing in this schema names a vendor.
//
// TWO UNIQUENESS RULES, and they are different claims. One remote object maps to at most one task
// here, or two tasks would fight over the same mirror and each would win half the time. One task
// holds at most one identity per system, or a change here would have two places to go and no way to
// choose. Both are indexes rather than service checks, because a race between two syncs is exactly
// the case a service check loses.
export const matterTaskExternalLink = sqliteTable(
  "matter_task_external_link",
  {
    id: text("id").primaryKey().$type<MatterTaskExternalLinkId>(), // matterTaskExternalLink_ handle
    taskId: text("task_id")
      .notNull()
      .$type<MatterTaskId>()
      .references(() => matterTask.id),
    // The outside system, in whatever the addon calls itself. Never an enum: adding one is the whole
    // point, and an enum would make every new addon a reviewed migration in this file.
    system: text("system").notNull(),
    // The remote's own handle for this thing. Opaque here — this platform never parses it, never
    // orders by it, and never derives anything from its shape.
    externalId: text("external_id").notNull(),
    // Where a person goes to see it over there. Nullable: a system may have no addressable page, and
    // inventing a URL from an id pattern would be this schema guessing at somebody else's routing.
    externalUrl: text("external_url"),
    // What the remote looked like when the two sides last agreed — a vendor's own revision token, an
    // ETag, a timestamp they minted. OPAQUE: stored, handed back, never compared for order or
    // parsed. It is the addon's business what it means; the platform's business is not losing it.
    remoteRevision: text("remote_revision"),
    lastSyncedAt: text("last_synced_at"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
    createdBy: text("created_by").$type<UserId>(),
  },
  (table) => [
    uniqueIndex("matter_task_external_link_system_external_id_unique_index").on(
      table.system,
      table.externalId,
    ),
    uniqueIndex("matter_task_external_link_task_system_unique_index").on(
      table.taskId,
      table.system,
    ),
    index("matter_task_external_link_task_index").on(table.taskId),
    check("matter_task_external_link_system_nonempty_check", sql`length(${table.system}) > 0`),
    check(
      "matter_task_external_link_external_id_nonempty_check",
      sql`length(${table.externalId}) > 0`,
    ),
  ],
);

// The tombstone. A task DELETE removes the row, which is the right behaviour for a record that
// should not exist — and it makes the deletion unobservable to anything that was not watching at the
// time. A mirror that never learns of it keeps the work alive somewhere the firm has stopped
// looking, which is worse than the stale row it was meant to prevent.
//
// It carries IDENTIFIERS AND NOTHING ELSE. No title, no body, no assignee — a tombstone that
// preserved the content would defeat the delete it records. `task_id` is deliberately NOT a foreign
// key: the row it names is gone, which is the entire point.
export const matterTaskDeletion = sqliteTable(
  "matter_task_deletion",
  {
    id: text("id").primaryKey().$type<MatterTaskDeletionId>(), // matterTaskDeletion_ handle
    taskId: text("task_id").notNull().$type<MatterTaskId>(),
    // The matter it was on, or null for the firm's own work. Kept so a mirror scoped to one matter
    // can tell whether a deletion is any of its business without resolving a task that no longer
    // exists.
    matterId: text("matter_id").$type<MatterId>(),
    deletedAt: text("deleted_at").notNull(),
    deletedBy: text("deleted_by").$type<UserId>(),
  },
  (table) => [
    // The same keyset shape the change feed uses for live rows, for the same reason.
    index("matter_task_deletion_deleted_at_id_index").on(table.deletedAt, table.id),
  ],
);

// THE MATTER PLAN: a firm's own statement of the work a kind of matter takes, as a template that
// PROPOSES tasks rather than one that writes them.
//
// THE PLATFORM SHIPS NONE OF THESE, and that is a competitive decision made against the grain. Every
// competitor ships plan libraries and a firm evaluating this platform will notice their absence. A
// plan is a statement about how THIS FIRM practises in THIS jurisdiction, and a platform-shipped plan
// with a missing step, or a step in the wrong order, or a step that is right in Nevada and wrong in
// California, is a malpractice vector carrying the platform's name — and it gets trusted precisely
// because it shipped, which is the calendar's exact argument about computed dates. The migration
// creates these tables and inserts nothing.
//
// A template soft-deactivates and is never deleted, the discipline matter_type and firm_resource
// already use: instantiated tasks carry the template's handle as provenance, and a firm asking which
// matters came off the old intake plan needs the row to still be there.
export const matterPlanTemplate = sqliteTable(
  "matter_plan_template",
  {
    id: text("id").primaryKey().$type<MatterPlanTemplateId>(), // matterPlanTemplate_ handle
    name: text("name").notNull(),
    description: text("description"),
    // Which kind of matter this plan is offered on. NULL means every kind — a firm whose intake steps
    // are the same whatever the matter is should not have to author the plan once per type.
    matterTypeId: text("matter_type_id")
      .$type<MatterTypeId>()
      .references(() => matterType.id),
    active: integer("active").notNull().default(1),
    createdBy: text("created_by").notNull().$type<UserId>(),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    // The read that matters: which plans are offered when a matter of this type opens.
    index("matter_plan_template_matter_type_active_index").on(table.matterTypeId, table.active),
    uniqueIndex("matter_plan_template_name_unique_index").on(table.name),
    check("matter_plan_template_name_nonempty_check", sql`length(${table.name}) > 0`),
    check("matter_plan_template_active_check", sql`${table.active} IN (0, 1)`),
  ],
);

// One task a plan proposes. It carries a due-date ANCHOR rather than a date, and a ROLE rather than a
// member, because both of the alternatives are wrong the moment a template is used twice.
//
// THE ANCHOR VOCABULARY IS DELIBERATELY ALMOST EMPTY: `matter_opened` and `none`, held by a CHECK so
// growing it is a migration somebody reviews. There is no `service_date` anchor, no `filing_date`
// anchor and no trigger-event anchor, because each of those is the FRONT HALF OF A DOCKETING RULE and
// adding one invites the back half — which is the engine packages/calendar has spent a subsystem
// refusing to build, on the reasoning that a computed deadline which is wrong gets trusted precisely
// because it was computed.
//
// What keeps the offset honest is that it is PLAIN CALENDAR-DAY ADDITION: no business days, no
// holiday calendar, no service-method offset. Adding fourteen days to a date is not the arithmetic
// the calendar forbids; deriving a court deadline from a rule is, and this does not do that. The
// visible cost is that a template can propose a task due on a Sunday or on Christmas Day, and that
// cost is exactly why instantiation is propose-and-confirm rather than automatic: a person moves the
// date in a second, and a template cannot know to.
export const matterPlanTaskTemplate = sqliteTable(
  "matter_plan_task_template",
  {
    id: text("id").primaryKey().$type<MatterPlanTaskTemplateId>(), // matterPlanTaskTemplate_ handle
    templateId: text("template_id")
      .notNull()
      .$type<MatterPlanTemplateId>()
      .references(() => matterPlanTemplate.id),
    title: text("title").notNull(),
    body: text("body"),
    priority: text("priority", { enum: ["low", "normal", "high", "urgent"] })
      .notNull()
      .default("normal"),
    // Matched against matter_assignment.assignment_role at instantiation, never against a member. A
    // template that named Sarah would be wrong the moment Sarah's matters were reassigned. An
    // unresolved role leaves the proposed task UNASSIGNED and visibly so — never silently given to
    // the responsible attorney, which would be the platform inventing an obligation for somebody.
    defaultAssigneeRole: text("default_assignee_role"),
    dueAnchor: text("due_anchor", { enum: ["matter_opened", "none"] })
      .notNull()
      .default("none"),
    // Days added to the anchor, plain calendar days. Null exactly when the anchor is `none`.
    offsetDays: integer("offset_days"),
    // One predecessor within the SAME template. Cycles are refused at authoring time, where the graph
    // is small and static rather than at instantiation where a firm would meet the refusal.
    blockedByTemplateTaskId: text("blocked_by_template_task_id").$type<MatterPlanTaskTemplateId>(),
    // The order the authoring surface lists them in and the proposal presents them in. Not unique:
    // reordering a list whose positions must stay distinct means rewriting every row after the one
    // that moved, and the handle is the tiebreak that makes ties harmless.
    position: integer("position").notNull().default(0),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    index("matter_plan_task_template_template_position_index").on(table.templateId, table.position),
    index("matter_plan_task_template_blocked_by_index").on(table.blockedByTemplateTaskId),
    check("matter_plan_task_template_title_check", sql`length(${table.title}) > 0`),
    check(
      "matter_plan_task_template_priority_check",
      sql`${table.priority} IN ('low', 'normal', 'high', 'urgent')`,
    ),
    // The anchor vocabulary, as a CHECK so a third value is a reviewed migration rather than a commit.
    check(
      "matter_plan_task_template_due_anchor_check",
      sql`${table.dueAnchor} IN ('matter_opened', 'none')`,
    ),
    // An offset without an anchor computes nothing; an anchor without an offset is the anchor date
    // itself and would silently mean "+0" rather than saying so.
    check(
      "matter_plan_task_template_offset_shape_check",
      sql`(${table.dueAnchor} = 'none' AND ${table.offsetDays} IS NULL)
        OR (${table.dueAnchor} != 'none' AND ${table.offsetDays} IS NOT NULL)`,
    ),
    // A template task never waits on itself. Longer chains are walked at the write.
    check(
      "matter_plan_task_template_blocked_by_self_check",
      sql`${table.blockedByTemplateTaskId} != ${table.id}`,
    ),
  ],
);

// What the firm schedules for itself: a meeting, an office closure, training, a firm holiday, a
// reservation. Its own table and NOT a nullable matter_id on matter_event, twice over: every read of
// matter_event is "what happened on this case" and the visibility predicate keys off the matter — a
// null matter would put a does-not-apply branch inside the one seam whose value is having no
// branches — and mechanically, dropping a NOT NULL on a shipped SQLite table is a rebuild the
// additive-only lineage forbids. The two tables are the two answers to "whose calendar is this on".
//
// The event SHAPE is matter_event's (civil dates, separate optional times, a required per-row IANA
// zone, the same status vocabulary and record-versus-appearance instants); the scope is the firm's.
// The type catalog is SHARED deliberately: matter_event_type's category column already carries
// 'firm', its rows are vocabulary rather than matter facts, and a second catalog would mean the firm
// curating "Meeting" twice — the table's matter_ name prefix is an accepted naming wart, cheaper
// than a second home for one vocabulary.
//
// `audience` is what makes a firm-wide entry possible without enumerating members: an 'all_members'
// event is on everyone's calendar by construction — a participant list decays with every hire, and a
// firm holiday that silently misses the newest associate is worse than none. A 'participants' event
// is on the calendars of the people listed. There is deliberately no personal-appointment shape
// here: a firm event is readable by every member by construction, and "dentist, Thursday 3pm" has an
// audience of one and a privacy posture the trusted-insider model does not cover.
//
// location_id is a real foreign key where matter_event's location_text is free text, because a firm
// event — unlike a hearing — usually IS at one of the firm's offices; nullable because an offsite
// retreat is real, with location_text beside it for the venue or the detail within an office.
export const firmEvent = sqliteTable(
  "firm_event",
  {
    id: text("id").primaryKey().$type<FirmEventId>(), // firmEvent_ handle
    eventTypeId: text("event_type_id")
      .$type<MatterEventTypeId>()
      .references(() => matterEventType.id),
    title: text("title").notNull(),
    description: text("description"),
    status: text("status", { enum: ["scheduled", "occurred", "cancelled"] })
      .notNull()
      .default("scheduled"),
    // Why this is no longer happening, when it is not. Optional: a cancelled staff meeting does not
    // always deserve a paragraph.
    statusReason: text("status_reason"),
    // ---- recurrence -------------------------------------------------------------------------
    // A repeating setting is ONE row with a rule, expanded across the window a read asks for. The
    // alternative — a row per occurrence — multiplies a firm's calendar by the length of its
    // longest series before anybody looks at it, and makes "move the series" fifty-two writes.
    //
    // The rule is an RFC 5545 RRULE ("FREQ=WEEKLY;BYDAY=TU;COUNT=12"), null on a one-off. The
    // standard is stored rather than a private shape because it is the one every calendar product
    // reads and writes, and a firm exporting its calendar should not find this product's dialect in
    // it. What the FORM offers is narrower than the standard allows; a rule it cannot present is
    // read, painted and left uneditable rather than silently rewritten.
    recurrenceRule: text("recurrence_rule"),
    // An EXCEPTION: a real event that replaces one occurrence of a series. The parent's expansion
    // skips the date this names, so an occurrence moved, renamed or called off is an ordinary row
    // that happens to know what it replaces — and every read that already understands an event
    // understands it, including the cancelled-and-struck rule.
    recurrenceParentId: text("recurrence_parent_id").$type<FirmEventId>(),
    // The civil date in the parent's series this row stands in for. Set with the parent id and
    // never without it.
    recurrenceOccurrenceOn: text("recurrence_occurrence_on"),
    startsOn: text("starts_on").notNull(), // civil date, YYYY-MM-DD
    startsAtTime: text("starts_at_time"), // HH:MM wall clock; null means all day
    endsOn: text("ends_on"),
    endsAtTime: text("ends_at_time"),
    // Required, per row. Defaulted by the interface from the hosting office; a firm retreat in
    // another state overrides it per row, exactly as a hearing in another state's court does.
    timeZone: text("time_zone").notNull(),
    audience: text("audience", { enum: ["all_members", "participants"] })
      .notNull()
      .default("participants"),
    locationId: text("location_id")
      .$type<LocationId>()
      .references(() => location.id),
    locationText: text("location_text"),
    // The same link a matter event carries, for the same reason: a firm meeting is as likely to be
    // held on a call as in a room, and where it is joined is a different fact from where it is.
    conferenceUrl: text("conference_url"),
    recordedAt: text("recorded_at").notNull(),
    recordedBy: text("recorded_by").$type<UserId>(),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    // The firm calendar's date-ranged read: filter, sort, and keyset out of one composite.
    index("firm_event_starts_on_id_index").on(table.startsOn, table.id),
    // "What is still scheduled" — filtered before it is sorted, so the filter column leads.
    index("firm_event_status_starts_on_index").on(table.status, table.startsOn),
    index("firm_event_location_index").on(table.locationId),
    check("firm_event_title_check", sql`length(${table.title}) > 0`),
    check(
      "firm_event_status_check",
      sql`${table.status} IN ('scheduled', 'occurred', 'cancelled')`,
    ),
    check("firm_event_audience_check", sql`${table.audience} IN ('all_members', 'participants')`),
    check("firm_event_time_zone_check", sql`length(${table.timeZone}) > 0`),
    check("firm_event_starts_on_shape_check", civilDateShape(table.startsOn)),
    // The occurrence an exception replaces is a civil date like every other day on a calendar.
    check(
      "firm_event_recurrence_occurrence_on_shape_check",
      civilDateShape(table.recurrenceOccurrenceOn, true),
    ),
    check("firm_event_ends_on_shape_check", civilDateShape(table.endsOn, true)),
    check(
      "firm_event_starts_at_time_shape_check",
      sql`${table.startsAtTime} IS NULL OR ${table.startsAtTime} GLOB '[0-2][0-9]:[0-5][0-9]'`,
    ),
    check(
      "firm_event_ends_at_time_shape_check",
      sql`${table.endsAtTime} IS NULL OR ${table.endsAtTime} GLOB '[0-2][0-9]:[0-5][0-9]'`,
    ),
    check(
      "firm_event_range_check",
      sql`${table.endsOn} IS NULL OR ${table.endsOn} >= ${table.startsOn}`,
    ),
    check(
      "firm_event_end_time_check",
      sql`${table.endsAtTime} IS NULL OR ${table.startsAtTime} IS NOT NULL`,
    ),
  ],
);

// What the firm lets leave for a member's own calendar at a provider, one row per event type and one
// for deadlines. This is the OUTER limit: a member's rule (calendar_sync_rule) can send less than the
// firm allows and never more, and the read that pairs the two is where that holds.
//
// `subject` is the event type's id, or the literal 'deadline' for the one row that stands for every
// deadline. A plain key rather than a nullable event_type_id under a unique index, because SQLite
// treats two NULLs as distinct and a second deadline row would then be storable.
//
// A subject with NO row may leave in full detail. The absence has to mean something, a firm that has
// never opened the page must not find sync silently impossible, and nothing leaves on the strength
// of this table alone: a member's own rule is still required, and those start empty.
export const calendarSyncFirmLimit = sqliteTable(
  "calendar_sync_firm_limit",
  {
    subject: text("subject").primaryKey(),
    eventTypeId: text("event_type_id")
      .$type<MatterEventTypeId>()
      .references(() => matterEventType.id),
    mayLeave: integer("may_leave", { mode: "boolean" }).notNull(),
    // `minimal` sends the matter number and the event type and nothing a client said or did.
    detail: text("detail", { enum: ["full", "minimal"] }).notNull(),
    updatedAt: text("updated_at").notNull(),
    updatedBy: text("updated_by")
      .notNull()
      .$type<UserId>()
      .references(() => member.userId),
  },
  (table) => [
    check(
      "calendar_sync_firm_limit_subject_check",
      sql`(${table.subject} = 'deadline' AND ${table.eventTypeId} IS NULL) OR (${table.eventTypeId} IS NOT NULL AND ${table.subject} = ${table.eventTypeId})`,
    ),
    check("calendar_sync_firm_limit_detail_check", sql`${table.detail} IN ('full', 'minimal')`),
  ],
);

// A member's own choice, per connected account: this event type (or deadlines) goes to that one of
// my calendars at the provider. No row means it is not sent, which is how a type the firm adds later
// starts, and how every type starts on the day an account is connected.
//
// The calendar's name is kept beside its identifier so the settings page can still say where a rule
// points when the provider cannot be reached, or when the member has since deleted that calendar.
//
// `scope` is whose events of that type: `mine` is the ones the member takes part in (for deadlines,
// the ones on a matter they are responsible for), `my_matters` is every one on a matter they are
// assigned to.
export const calendarSyncRule = sqliteTable(
  "calendar_sync_rule",
  {
    connectionId: text("connection_id")
      .notNull()
      .$type<IntegrationConnectionId>()
      .references(() => integrationConnection.id),
    subject: text("subject").notNull(),
    eventTypeId: text("event_type_id")
      .$type<MatterEventTypeId>()
      .references(() => matterEventType.id),
    calendarRemoteId: text("calendar_remote_id").notNull(),
    calendarName: text("calendar_name").notNull(),
    scope: text("scope", { enum: ["mine", "my_matters"] }).notNull(),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.connectionId, table.subject] }),
    check(
      "calendar_sync_rule_subject_check",
      sql`(${table.subject} = 'deadline' AND ${table.eventTypeId} IS NULL) OR (${table.eventTypeId} IS NOT NULL AND ${table.subject} = ${table.eventTypeId})`,
    ),
    check("calendar_sync_rule_scope_check", sql`${table.scope} IN ('mine', 'my_matters')`),
    check("calendar_sync_rule_calendar_check", sql`length(${table.calendarRemoteId}) > 0`),
  ],
);

// One Magna Carta event as it sits in one member's calendar at their provider. The identifier the
// provider gave the copy belongs to the pair of event and account, never to the event: one hearing
// is in several members' calendars under several identifiers, which is why this is a table and not
// a column on the event.
//
// The row is written BEFORE the provider is asked to create the copy, in the `pending` state and
// already holding the `transaction_id` the request will carry. A pass that dies between the request
// and the answer finds the row again and repeats the request under the same identifier, and the
// provider answers with the copy it already made in place of a second one.
//
// `agreed_hash` is a digest of the fields as they were last sent. A pass compares it with a digest
// of the event as it stands and sends only what differs. It is a digest and not the fields because
// a title or a location is the firm's own record of a matter, and this table is not where that is
// kept. `local_id` carries no foreign key because it names a row in one of three tables, chosen by
// `local_kind`.
export const calendarSyncLink = sqliteTable(
  "calendar_sync_link",
  {
    connectionId: text("connection_id")
      .notNull()
      .$type<IntegrationConnectionId>()
      .references(() => integrationConnection.id),
    localKind: text("local_kind", { enum: ["matter_event", "firm_event", "deadline"] }).notNull(),
    localId: text("local_id").notNull(),
    calendarRemoteId: text("calendar_remote_id").notNull(),
    transactionId: text("transaction_id").notNull(),
    remoteEventId: text("remote_event_id"), // null until the provider has answered the create
    remoteVersionTag: text("remote_version_tag"),
    agreedHash: text("agreed_hash").notNull(),
    state: text("state", { enum: ["pending", "synced", "failed"] }).notNull(),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.connectionId, table.localKind, table.localId] }),
    check(
      "calendar_sync_link_local_kind_check",
      sql`${table.localKind} IN ('matter_event', 'firm_event', 'deadline')`,
    ),
    check("calendar_sync_link_state_check", sql`${table.state} IN ('pending', 'synced', 'failed')`),
    check(
      "calendar_sync_link_synced_shape_check",
      sql`${table.state} <> 'synced' OR ${table.remoteEventId} IS NOT NULL`,
    ),
  ],
);

// Who is at a firm meeting: mostly members, sometimes a Directory entity (the bank's relationship
// manager), sometimes an external who belongs in nobody's conflicts corpus (a visiting CLE speaker).
// A second table rather than a nullable firm_event_id on matter_event_participant, because that
// table's event_id is NOT NULL and shipped, and "exactly one of two columns" cannot be retrofitted
// without a rebuild. The duplication is the schema's, not the code's — the participant replace-set
// logic in @magna-carta/calendar is written once and parameterized over the table.
export const firmEventParticipant = sqliteTable(
  "firm_event_participant",
  {
    id: text("id").primaryKey().$type<FirmEventParticipantId>(), // firmEventParticipant_ handle
    firmEventId: text("firm_event_id")
      .notNull()
      .$type<FirmEventId>()
      .references(() => firmEvent.id),
    participantKind: text("participant_kind", {
      enum: ["member", "entity", "external"],
    }).notNull(),
    memberUserId: text("member_user_id")
      .$type<UserId>()
      .references(() => member.userId),
    // A directoryPerson_/directoryOrganization_ handle, by value with no cross-domain foreign key
    // (the matter_event_participant precedent).
    entityId: text("entity_id"),
    participantName: text("participant_name"),
    role: text("role"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    index("firm_event_participant_event_index").on(table.firmEventId),
    // "What is on my calendar" — the member filter, resolved as a predicate in SQL.
    index("firm_event_participant_member_index").on(table.memberUserId),
    check(
      "firm_event_participant_kind_check",
      sql`${table.participantKind} IN ('member', 'entity', 'external')`,
    ),
    check(
      "firm_event_participant_shape_check",
      sql`(${table.participantKind} = 'member' AND ${table.memberUserId} IS NOT NULL)
        OR (${table.participantKind} = 'entity' AND ${table.entityId} IS NOT NULL)
        OR (${table.participantKind} = 'external' AND ${table.participantName} IS NOT NULL)`,
    ),
  ],
);

// A bookable thing the firm owns: a conference room, a pool car, the video rig. Its own table — NOT
// a Directory entity (the Directory is the conflicts corpus, and "Conference Room A" beside opposing
// counsel in the same search index is the forced-judge problem with none of the judge's dignity),
// and NOT a custody_location node (that tree answers "where is the original will"; entangling what
// can be reserved with where things are kept couples two subsystems that change for different
// reasons). Its natural foreign key is `location` — the same office table the custody tree's roots
// bind to, so the two views of the building agree on what an office is without sharing rows.
//
// `kind` is a closed platform enum, not a firm catalog: unlike event types, no
// jurisdiction-specific vocabulary exists here and nothing branches on it beyond grouping and
// iconography (the custody_location.kind discipline); 'other' is the pressure valve. `capacity` is
// nullable and NOTHING enforces it — the platform does not refuse a twelve-person meeting in a
// ten-seat room; capacity renders on the picker so a person can decide.
export const firmResource = sqliteTable(
  "firm_resource",
  {
    id: text("id").primaryKey().$type<FirmResourceId>(), // firmResource_ handle
    name: text("name").notNull(),
    kind: text("kind", {
      enum: ["room", "vehicle", "equipment", "other"],
    }).notNull(),
    // The home office; null for a resource assigned to none.
    locationId: text("location_id")
      .$type<LocationId>()
      .references(() => location.id),
    capacity: integer("capacity"),
    notes: text("notes"),
    // Soft-deactivate, the catalog discipline: a deactivated room keeps its history and takes no
    // new bookings.
    active: integer("active", { mode: "boolean" }).notNull().default(true),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("firm_resource_name_unique_index").on(table.name),
    check("firm_resource_name_check", sql`length(${table.name}) > 0`),
    check(
      "firm_resource_kind_check",
      sql`${table.kind} IN ('room', 'vehicle', 'equipment', 'other')`,
    ),
    check("firm_resource_capacity_check", sql`${table.capacity} IS NULL OR ${table.capacity} > 0`),
  ],
);

// One resource occupied for one event's sake. Its own row because the two facts genuinely diverge:
// one event can occupy several resources, and a booking's window is not always the event's window —
// the room is booked from half past eight for a nine o'clock deposition because somebody has to set
// up. But a booking is NEVER freestanding: every booking belongs to exactly one event (matter or
// firm — the participant-kind exactly-one idiom), because "a room is busy because something is
// happening in it" is the one rule that keeps who-booked-it, who-is-going, cancellation, and the
// calendar's read surfaces from being reinvented per booking. "Book the pool car Friday" with no
// event is a firm event of the seeded Reservation type with the booking attached.
//
// A booking's LIVENESS IS DERIVED from its event, never stored: it blocks the resource if and only
// if its event's status is not 'cancelled'. There is no released flag and no second write when an
// event is cancelled or continued — a fact that is a join cannot drift from the row it joins, and
// releasing is not an action at all.
//
// time_zone is THE RESOURCE'S zone: defaulted from the resource's office (location.time_zone) and
// frozen on the row at the write (the rate-snapshot idiom), so an office zone change never silently
// reinterprets an existing booking.
export const firmResourceBooking = sqliteTable(
  "firm_resource_booking",
  {
    id: text("id").primaryKey().$type<FirmResourceBookingId>(), // firmResourceBooking_ handle
    resourceId: text("resource_id")
      .notNull()
      .$type<FirmResourceId>()
      .references(() => firmResource.id),
    matterEventId: text("matter_event_id")
      .$type<MatterEventId>()
      .references(() => matterEvent.id),
    firmEventId: text("firm_event_id")
      .$type<FirmEventId>()
      .references(() => firmEvent.id),
    // Defaulted from the event at the write, editable per booking (the setup-time case), and never
    // silently re-derived afterward. Null times mean all day (a vehicle taken for the day).
    startsOn: text("starts_on").notNull(),
    startsAtTime: text("starts_at_time"),
    endsOn: text("ends_on"),
    endsAtTime: text("ends_at_time"),
    timeZone: text("time_zone").notNull(),
    recordedAt: text("recorded_at").notNull(),
    recordedBy: text("recorded_by").$type<UserId>(),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    // The availability read's filter, sort, and keyset.
    index("firm_resource_booking_resource_starts_index").on(
      table.resourceId,
      table.startsOn,
      table.id,
    ),
    index("firm_resource_booking_matter_event_index").on(table.matterEventId),
    index("firm_resource_booking_firm_event_index").on(table.firmEventId),
    check(
      "firm_resource_booking_event_shape_check",
      sql`(${table.matterEventId} IS NOT NULL AND ${table.firmEventId} IS NULL)
        OR (${table.matterEventId} IS NULL AND ${table.firmEventId} IS NOT NULL)`,
    ),
    check("firm_resource_booking_time_zone_check", sql`length(${table.timeZone}) > 0`),
    check("firm_resource_booking_starts_on_shape_check", civilDateShape(table.startsOn)),
    check("firm_resource_booking_ends_on_shape_check", civilDateShape(table.endsOn, true)),
    check(
      "firm_resource_booking_starts_at_time_shape_check",
      sql`${table.startsAtTime} IS NULL OR ${table.startsAtTime} GLOB '[0-2][0-9]:[0-5][0-9]'`,
    ),
    check(
      "firm_resource_booking_ends_at_time_shape_check",
      sql`${table.endsAtTime} IS NULL OR ${table.endsAtTime} GLOB '[0-2][0-9]:[0-5][0-9]'`,
    ),
    check(
      "firm_resource_booking_range_check",
      sql`${table.endsOn} IS NULL OR ${table.endsOn} >= ${table.startsOn}`,
    ),
    check(
      "firm_resource_booking_end_time_check",
      sql`${table.endsAtTime} IS NULL OR ${table.startsAtTime} IS NOT NULL`,
    ),
  ],
);

// A typed, directed relation between two events — the calendar linking to itself, so integrity is
// enforceable and is enforced with real foreign keys (events are never hard-deleted, so a link never
// dangles). Four nullable end columns with an exactly-one shape check per end. `kind` is closed and
// small because the engine branches on 'continuance_of' (the chain rules) and on nothing else;
// everything a firm means beyond that goes in the note. 'related' is undirected in meaning though
// stored directed; readers render it symmetrically.
export const calendarEventLink = sqliteTable(
  "calendar_event_link",
  {
    id: text("id").primaryKey().$type<CalendarEventLinkId>(), // calendarEventLink_ handle
    fromMatterEventId: text("from_matter_event_id")
      .$type<MatterEventId>()
      .references(() => matterEvent.id),
    fromFirmEventId: text("from_firm_event_id")
      .$type<FirmEventId>()
      .references(() => firmEvent.id),
    toMatterEventId: text("to_matter_event_id")
      .$type<MatterEventId>()
      .references(() => matterEvent.id),
    toFirmEventId: text("to_firm_event_id")
      .$type<FirmEventId>()
      .references(() => firmEvent.id),
    kind: text("kind", { enum: ["continuance_of", "related"] }).notNull(),
    note: text("note"),
    recordedBy: text("recorded_by").$type<UserId>(),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    // One per end column: "links touching this event", from either side.
    index("calendar_event_link_from_matter_index").on(table.fromMatterEventId),
    index("calendar_event_link_from_firm_index").on(table.fromFirmEventId),
    index("calendar_event_link_to_matter_index").on(table.toMatterEventId),
    index("calendar_event_link_to_firm_index").on(table.toFirmEventId),
    // What makes a continuance chain a CHAIN: at most one predecessor and at most one successor per
    // setting, so a hearing continued three times is a path walkable in both directions and a fork
    // is refused by the database even under racing writes — never by a service invariant somebody
    // forgets. Matter ends only, which the continuance check below already guarantees.
    uniqueIndex("calendar_event_link_continuance_from_unique")
      .on(table.fromMatterEventId)
      .where(sql`${table.kind} = 'continuance_of'`),
    uniqueIndex("calendar_event_link_continuance_to_unique")
      .on(table.toMatterEventId)
      .where(sql`${table.kind} = 'continuance_of'`),
    check("calendar_event_link_kind_check", sql`${table.kind} IN ('continuance_of', 'related')`),
    check(
      "calendar_event_link_from_shape_check",
      sql`(${table.fromMatterEventId} IS NOT NULL AND ${table.fromFirmEventId} IS NULL)
        OR (${table.fromMatterEventId} IS NULL AND ${table.fromFirmEventId} IS NOT NULL)`,
    ),
    check(
      "calendar_event_link_to_shape_check",
      sql`(${table.toMatterEventId} IS NOT NULL AND ${table.toFirmEventId} IS NULL)
        OR (${table.toMatterEventId} IS NULL AND ${table.toFirmEventId} IS NOT NULL)`,
    ),
    check(
      "calendar_event_link_continuance_matter_check",
      sql`${table.kind} <> 'continuance_of' OR (${table.fromMatterEventId} IS NOT NULL AND ${table.toMatterEventId} IS NOT NULL)`,
    ),
  ],
);

// The room a calendar event is held in, when it is held here. A meeting BELONGS TO an event and
// carries nothing of its own: no title, no time, no participant list, because each of those is
// already the event's and a second copy would be a second answer to the same question. Read the
// title and the window through the join; what this row adds is the three facts the event cannot
// supply — that somebody started it, when the first person actually arrived, and when it ended.
//
// Authorization is likewise the event's: a matter event is reachable when the member may see the
// matter, a firm event is firm-visible, and nothing here re-states either rule. That is the whole
// reason the table splits its parent across two nullable columns rather than inventing a shared
// event identity — matter_event and firm_event are separate tables with separate visibility, and a
// column that pointed at "an event" would have to lose one of the two.
//
// Nothing anybody said is stored, here or anywhere: media is routed between browsers and never
// reaches this platform's storage.
export const meeting = sqliteTable(
  "meeting",
  {
    id: text("id").primaryKey().$type<MeetingId>(), // meeting_ handle
    // Which of the two parent tables the row hangs from, stored rather than inferred from which
    // column is filled: a read that has to test two columns to know what it is looking at is a read
    // every caller writes slightly differently.
    eventKind: text("event_kind", { enum: ["matter", "firm"] }).notNull(),
    matterEventId: text("matter_event_id")
      .$type<MatterEventId>()
      .references(() => matterEvent.id),
    firmEventId: text("firm_event_id")
      .$type<FirmEventId>()
      .references(() => firmEvent.id),
    // `scheduled` is a room nobody has walked into yet — the row exists because somebody pressed
    // Start, which is not the same as somebody being in it. `live` is set by the FIRST join rather
    // than by the creation, so a host who starts a meeting and is then called away leaves a record
    // saying exactly that. `ended` is terminal: a meeting that has ended is not restarted, because
    // the attendance rows under it describe one gathering and a second gathering is a second room.
    status: text("status", { enum: ["scheduled", "live", "ended"] })
      .notNull()
      .default("scheduled"),
    // SOUND ALONE, OR SOUND AND PICTURES. An audio call is a first-class kind of meeting rather than
    // a video meeting nobody turned a camera on in: it is chosen at Start and never changed, because
    // the people already in the room agreed to one thing and a medium that could be widened
    // mid-gathering would be a camera switched on for everybody by somebody else's click. Defaulted
    // to `video` so every row that predates the column reads as what it was.
    medium: text("medium", { enum: ["video", "audio"] })
      .notNull()
      .default("video"),
    // WHETHER ARRIVALS WAIT AT A DOOR. One lobby per MEETING and never one per firm: a firm holds
    // several meetings at once, so a firm-level lobby would put the people arriving at a partner's
    // deposition in the same queue as the people arriving at a staff briefing, in front of a host
    // who is in neither.
    //
    // Off by default, because today every participant is a firm member arriving at an event they
    // are on and a lobby on by default would put a colleague in a queue for every ordinary hearing.
    // Unlike the medium beside it this one CHANGES: a medium is what the people in the room agreed
    // to, and a lobby is a standing decision of the host's about who may come in, which has no
    // bearing on what anybody already agreed to. Turning it on mid-meeting is what a host does when
    // the matter turns confidential.
    lobby: text("lobby", { enum: ["off", "on"] })
      .notNull()
      .default("off"),
    createdByUserId: text("created_by_user_id")
      .notNull()
      .$type<UserId>()
      .references(() => member.userId),
    // When the first person actually arrived, which is not when the row was created and not when the
    // event was scheduled for. Null until somebody joins.
    startedAt: text("started_at"), // ISO-8601 instant
    endedAt: text("ended_at"), // ISO-8601 instant
    endedByUserId: text("ended_by_user_id")
      .$type<UserId>()
      .references(() => member.userId),
    // THE DOOR, SHUT. A locked room refuses arrivals at the join path and touches nobody already in
    // it; unlocking is the same act the other way. Shaped exactly like the ended pair above and
    // constrained with it, because half of that pair is a record nobody can question: an instant
    // with no actor cannot be asked who shut the door.
    lockedAt: text("locked_at"), // ISO-8601 instant
    lockedByUserId: text("locked_by_user_id")
      .$type<UserId>()
      .references(() => member.userId),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    // ONE MEETING PER EVENT, held by the database rather than by the create path. Creating a meeting
    // is idempotent — two members pressing Start in the same second must end up in the same room,
    // not in two rooms neither of them can see the other in — and an idempotency that lives only in
    // a read-then-write is an idempotency that loses the race it exists to settle. Partial on each
    // column, because exactly one of the two is filled on any row and a plain unique index over a
    // column that is null on half the table constrains nothing useful.
    uniqueIndex("meeting_matter_event_unique_index")
      .on(table.matterEventId)
      .where(sql`${table.matterEventId} IS NOT NULL`),
    uniqueIndex("meeting_firm_event_unique_index")
      .on(table.firmEventId)
      .where(sql`${table.firmEventId} IS NOT NULL`),
    check("meeting_event_kind_check", sql`${table.eventKind} IN ('matter', 'firm')`),
    check("meeting_status_check", sql`${table.status} IN ('scheduled', 'live', 'ended')`),
    check("meeting_medium_check", sql`${table.medium} IN ('video', 'audio')`),
    check("meeting_lobby_check", sql`${table.lobby} IN ('off', 'on')`),
    // EXACTLY ONE PARENT, AND THE KIND SAYS WHICH. Both halves in one check on purpose: a row with
    // two parents is unreadable, and a row whose kind names the column it did not fill is worse —
    // it reads cleanly and answers the wrong table. The matter_event_participant shape check is the
    // precedent for the form.
    check(
      "meeting_event_shape_check",
      sql`(${table.eventKind} = 'matter' AND ${table.matterEventId} IS NOT NULL AND ${table.firmEventId} IS NULL)
        OR (${table.eventKind} = 'firm' AND ${table.firmEventId} IS NOT NULL AND ${table.matterEventId} IS NULL)`,
    ),
    // A meeting that has ended says who ended it and when, or neither. Half of that pair is a record
    // nobody can act on: an end instant with no actor cannot be questioned, and an actor with no
    // instant cannot be ordered against anything else that happened.
    check(
      "meeting_ended_shape_check",
      sql`(${table.endedAt} IS NULL AND ${table.endedByUserId} IS NULL)
        OR (${table.endedAt} IS NOT NULL AND ${table.endedByUserId} IS NOT NULL)`,
    ),
    // And the same of the lock: who shut the door and when, together or neither.
    check(
      "meeting_locked_shape_check",
      sql`(${table.lockedAt} IS NULL) = (${table.lockedByUserId} IS NULL)`,
    ),
  ],
);

// One person's stay in one room: when they arrived and when they left. A ROW PER STAY, never a flag
// per person — somebody whose connection drops and who dials back in was in the room twice, and a
// record that collapsed the two would say they were present through a gap they were absent for.
// That is also what makes the roster countable: who is in the room right now is the rows whose
// left_at is null, which is a fact about the table rather than a number somebody maintains.
//
// The stay is what the record is FOR. Nothing about the media is kept — no track names, no session
// handles, no bitrate; the signaling state that carries those lives in the room's own transient
// storage and is deleted when the room empties.
export const meetingAttendance = sqliteTable(
  "meeting_attendance",
  {
    id: text("id").primaryKey().$type<MeetingAttendanceId>(), // meetingAttendance_ handle
    meetingId: text("meeting_id")
      .notNull()
      .$type<MeetingId>()
      .references(() => meeting.id),
    userId: text("user_id")
      .notNull()
      .$type<UserId>()
      .references(() => member.userId),
    joinedAt: text("joined_at").notNull(), // ISO-8601 instant
    // Null while the person is still in the room. Ending the meeting closes every open row at one
    // instant, so a member who never pressed Leave still has a left_at rather than a stay that runs
    // forever.
    leftAt: text("left_at"), // ISO-8601 instant
    // HOW THE STAY ENDED, as a queryable column rather than only as a label on the departure audit
    // row. The audit row stays the accountable half — who did it, and when — and this is the half a
    // read can ask a question of: the join path has to refuse a member whose stay was closed
    // `removed`, and a refusal that had to walk a matter's audit log to decide would be a read of
    // the wrong record entirely.
    //
    // NOTHING IS BACKFILLED. A stay closed before this column existed carries null, which means
    // "closed before the record kept the reason" and not "left" — writing 'left' over them would
    // invent a fact about every socket that was ever lost. A stay closed by the meeting ENDING
    // carries null too, deliberately: the meeting row already says the gathering ended, and a fifth
    // value for it would be a second answer to a question the meeting already answers.
    endedReason: text("ended_reason"),
    // A WAITING ARRIVAL IS A STAY FROM THE MOMENT IT REACHES THE DOOR. Holding waiters in the
    // signaling room's own storage and writing the attendance row only on admission was rejected
    // three times over: the socket upgrade's ticket is an open stay and a waiter needs a socket, the
    // room's storage is transient state deleted when the last socket closes, and the record would
    // keep nothing about who waited and was never let in — which is a thing a firm may need to say.
    //
    // `joined_at` above therefore means "when this stay began", at the door or in the room, and
    // `admitted_at` is when the person was actually in it. That is a widening of what the column has
    // meant and it is stated rather than papered over: making `joined_at` nullable is a table
    // rebuild and buys nothing a second column does not, and the attendance read carries all three
    // instants so nothing downstream has to infer anything. Null on both for somebody who never
    // waited, which is every stay that predates the lobby.
    waitingFrom: text("waiting_from"), // ISO-8601 instant
    admittedAt: text("admitted_at"), // ISO-8601 instant
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    // "Was this member in this meeting, and is their stay still open" — the read the join path makes
    // before it opens another row, keyed on the member first so it also answers the leave path.
    index("meeting_attendance_meeting_user_index").on(table.meetingId, table.userId),
    // The roster and the participant count: the open rows of one meeting, filtered before anything
    // is read off them.
    index("meeting_attendance_meeting_left_at_index").on(table.meetingId, table.leftAt),
    // AT MOST ONE OPEN STAY PER MEMBER PER MEETING. The join path reads for an existing open stay
    // and returns it rather than opening a second, which is right and is a round trip early: a
    // double-clicked button opens two joins that both read nothing and both insert. Two open rows
    // for one person are two seats against a room that holds twelve, two tiles for one face, and a
    // leave that closes one of them and leaves the other running forever. Partial on `left_at IS
    // NULL`, because the CLOSED rows are the record and a member who genuinely left and came back
    // must have as many of those as they had stays.
    uniqueIndex("meeting_attendance_open_stay_unique_index")
      .on(table.meetingId, table.userId)
      .where(sql`${table.leftAt} IS NULL`),
    check(
      "meeting_attendance_span_check",
      sql`${table.leftAt} IS NULL OR ${table.leftAt} >= ${table.joinedAt}`,
    ),
    // The departure vocabulary, and the pairing that makes it readable: a reason on a stay that is
    // still open would say how somebody left a room they are sitting in.
    check(
      "meeting_attendance_ended_reason_check",
      sql`${table.endedReason} IS NULL
        OR (${table.leftAt} IS NOT NULL
          AND ${table.endedReason} IN ('left', 'socket-lost', 'removed', 'denied'))`,
    ),
    // WHO IS AT THE DOOR OF ONE MEETING — the lobby list, and the read the admission's own capacity
    // count is taken beside. Partial on the stays that are neither closed nor admitted, which is
    // the only set either question is ever asked of; `waiting_from` is the second column so the
    // list comes back in arrival order without a sort.
    index("meeting_attendance_waiting_index")
      .on(table.meetingId, table.waitingFrom)
      .where(sql`${table.leftAt} IS NULL AND ${table.admittedAt} IS NULL`),
    // Admitted without ever having waited is not a state: the instant a host let somebody in is
    // meaningless for a stay that walked straight into the room, and a row carrying one would make
    // "did this person wait" two different answers depending on which column was read.
    check(
      "meeting_attendance_admission_shape_check",
      sql`${table.admittedAt} IS NULL OR ${table.waitingFrom} IS NOT NULL`,
    ),
  ],
);

// WHO IS RUNNING THIS MEETING — one grant of authority over one room, held as a row and closed
// rather than deleted.
//
// A `host_user_id` column on `meeting` would be smaller and would answer the live question. It would
// answer ONLY the live question: co-hosts are several, so they need rows regardless, and a column
// overwritten on hand-over erases who was running the room before it. What a firm actually asks of a
// meeting record months later is "who was hosting when that happened", which is a question about an
// INTERVAL — so a grant is a row with `granted_at` and `revoked_at`, on the same principle that
// makes attendance a row per stay rather than a flag per person.
//
// THE PERMISSION KEY AND THE GRANT ANSWER DIFFERENT QUESTIONS, which is why this table exists at
// all. `meetings:host` says who a firm lets convene a meeting; it cannot say who is running THIS
// room, because that changes during the meeting — hosting is handed over, co-hosts are named and
// withdrawn, and the member who opened the room may have been called away an hour ago. A key granted
// once and read everywhere has no way to say any of that.
//
// `meeting.created_by_user_id` stays exactly what it is and is deliberately NOT read as the host:
// the two are the same person only until the first hand-over, and a record that conflated them would
// answer "who was running the meeting when she was removed" with the name of somebody who had left.
export const meetingHost = sqliteTable(
  "meeting_host",
  {
    id: text("id").primaryKey().$type<MeetingHostId>(), // meetingHost_ handle
    meetingId: text("meeting_id")
      .notNull()
      .$type<MeetingId>()
      .references(() => meeting.id),
    userId: text("user_id")
      .notNull()
      .$type<UserId>()
      .references(() => member.userId),
    // A co-host holds every act the host does except acting on the host. It is a fact about ONE
    // meeting rather than a standing rank in the firm, which is why it is a row under a meeting and
    // nothing in access control.
    role: text("role", { enum: ["host", "co-host"] }).notNull(),
    // Null for the starter's own grant and for a claim: neither was given by anybody. A claim is
    // audited as a claim for the same reason — nobody handed the room over.
    grantedByUserId: text("granted_by_user_id")
      .$type<UserId>()
      .references(() => member.userId),
    grantedAt: text("granted_at").notNull(), // ISO-8601 instant
    // Null while the grant stands. A grant is CLOSED and never deleted, because the interval is what
    // the record is read for.
    revokedAt: text("revoked_at"), // ISO-8601 instant
    revokedByUserId: text("revoked_by_user_id")
      .$type<UserId>()
      .references(() => member.userId),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    // THE TWO GRANT INVARIANTS, held by the database rather than by the service: one live host per
    // meeting, and one live grant per member per meeting. A hand-over is a read-then-write like
    // every other path here and is blind to the instant it does not span — two members handing the
    // room to two different people at once — so the index is what settles it and the loser's whole
    // batch rolls back, on the precedent of the one-meeting-per-event index. Partial on the open
    // grant, because the CLOSED ones are the record and a member may hold as many of those as the
    // room changed hands.
    uniqueIndex("meeting_host_live_host_unique_index")
      .on(table.meetingId)
      .where(sql`${table.role} = 'host' AND ${table.revokedAt} IS NULL`),
    uniqueIndex("meeting_host_live_grant_unique_index")
      .on(table.meetingId, table.userId)
      .where(sql`${table.revokedAt} IS NULL`),
    // The live grants of one meeting, which is the read every host act makes before it acts.
    index("meeting_host_meeting_revoked_index").on(table.meetingId, table.revokedAt),
    check("meeting_host_role_check", sql`${table.role} IN ('host', 'co-host')`),
    // A withdrawal says who withdrew it and when, or neither — the line meeting_ended_shape_check
    // already sits on.
    check(
      "meeting_host_revoked_shape_check",
      sql`(${table.revokedAt} IS NULL) = (${table.revokedByUserId} IS NULL)`,
    ),
  ],
);

// ONE SIGNED, EXPIRING LINK FOR ONE NAMED GUEST ON ONE MEETING — the durable authority behind a
// bearer token that is never stored.
//
// THE GUEST IS A DIRECTORY ENTITY, never a free address. An invitation names somebody the firm knows
// and the conflicts corpus can see; a record saying "a link went to somebody@example.test" names
// nobody the firm can later identify. The entity is carried BY VALUE with no foreign key, on the
// matter_event_participant precedent, because it is a person or an organization and a column can
// point at one table only.
//
// THE ROW IS THE AUTHORITY AND THE TOKEN IS ONLY WHAT TRAVELS. What is stored is the SHA-256 of the
// token's secret — never the secret, never the token — so a read of this table cannot mint a
// working link, while a revoked row, a rotated `secret_version` or an expired instant refuses a
// perfectly-signed token the moment it changes rather than at the token's own expiry.
//
// THE ADDRESS IS NOT HERE. `directory_email_id` records WHICH contact point the link was sent to;
// the address itself stays the Directory's fact, because a second copy of a client's e-mail address
// is a second thing to protect, redact and keep current.
//
// `invited_name` is the Directory's display name AT MINT, frozen, and it is deliberately a second
// name beside the one the guest types at the door (`meeting_guest_stay.confirmed_name`). The
// difference between the two is the whole of what a forwarded link leaves behind.
//
// Revoked, never deleted: who was invited to a meeting is part of what the record says happened, and
// a deleted row would make a withdrawn invitation indistinguishable from one never sent. The client
// portal's grant model subsumes this table when it lands.
export const meetingGuestInvitation = sqliteTable(
  "meeting_guest_invitation",
  {
    id: text("id").primaryKey().$type<MeetingGuestInvitationId>(), // meetingGuestInvitation_ handle
    meetingId: text("meeting_id")
      .notNull()
      .$type<MeetingId>()
      .references(() => meeting.id),
    entityKind: text("entity_kind", {
      enum: ["person", "organization"],
    }).notNull(),
    // A directoryPerson_/directoryOrganization_ handle, by value with no cross-domain foreign key.
    entityId: text("entity_id").notNull(),
    invitedName: text("invited_name").notNull(),
    // Which contact point the link was sent to, by value. Null only where the mail went to no
    // recorded row, which the service does not do today.
    directoryEmailId: text("directory_email_id"),
    // SHA-256 of the secret, lowercase hex. Never the secret and never the token.
    tokenSecretHash: text("token_secret_hash").notNull(),
    // Incremented by every rotation, so every token of an older version stops verifying at once.
    secretVersion: integer("secret_version").notNull().default(1),
    issuedByUserId: text("issued_by_user_id")
      .notNull()
      .$type<UserId>()
      .references(() => member.userId),
    // An instant, computed once at mint and never re-derived at read time.
    expiresAt: text("expires_at").notNull(), // ISO-8601 instant
    revokedAt: text("revoked_at"), // ISO-8601 instant
    revokedByUserId: text("revoked_by_user_id")
      .$type<UserId>()
      .references(() => member.userId),
    // How many times the link has been spent at the door, bounded so a link forwarded to a crowd
    // cannot be spent without limit while a bad connection's retries still fit comfortably.
    arrivalCount: integer("arrival_count").notNull().default(0),
    lastArrivalAt: text("last_arrival_at"), // ISO-8601 instant
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    // ONE LIVE LINK PER ENTITY PER MEETING. A second mint against the same pair rotates this row
    // rather than creating another: two links for one guest would be two revocations to perform and
    // one to forget. The index's leading column also serves "every invitation on this meeting",
    // which is the only other read this table answers.
    uniqueIndex("meeting_guest_invitation_meeting_entity_unique_index").on(
      table.meetingId,
      table.entityId,
    ),
    check(
      "meeting_guest_invitation_entity_kind_check",
      sql`${table.entityKind} IN ('person', 'organization')`,
    ),
    check("meeting_guest_invitation_invited_name_check", sql`length(${table.invitedName}) > 0`),
    check("meeting_guest_invitation_secret_hash_check", sql`length(${table.tokenSecretHash}) = 64`),
    check("meeting_guest_invitation_secret_version_check", sql`${table.secretVersion} >= 1`),
    check("meeting_guest_invitation_arrival_count_check", sql`${table.arrivalCount} >= 0`),
    // A withdrawal says who withdrew it and when, or neither — the line meeting_host sits on.
    check(
      "meeting_guest_invitation_revoked_shape_check",
      sql`(${table.revokedAt} IS NULL) = (${table.revokedByUserId} IS NULL)`,
    ),
  ],
);

// A GUEST'S STAY IN ONE ROOM — `meeting_attendance`'s shape, for somebody with no user id.
//
// A SECOND TABLE RATHER THAN A NULLABLE COLUMN, and the reason is mechanical. SQLite cannot drop a
// NOT NULL in place, so relaxing `meeting_attendance.user_id` is a table rebuild on a table other
// tables point at — the one thing this schema refuses. Adding a table is free. `joined_at`,
// `waiting_from`, `admitted_at`, `left_at` and `ended_reason` mean here exactly what they mean there,
// which is what lets the two presence predicates compose over both tables without a second
// definition of "in the room" (packages/meetings/src/meeting-statements.ts).
//
// The three differences are the three facts a member's stay has no room for: the invitation it was
// spent from, the name the guest typed at the door, and the absence of a user id. And `waiting_from`
// is NOT NULL, because a guest always waits, whatever the meeting's lobby setting says: the link
// proves possession of a mailbox and nothing more, so it gets a person to the door and a host
// decides the rest.
export const meetingGuestStay = sqliteTable(
  "meeting_guest_stay",
  {
    id: text("id").primaryKey().$type<MeetingGuestStayId>(), // meetingGuestStay_ handle
    meetingId: text("meeting_id")
      .notNull()
      .$type<MeetingId>()
      .references(() => meeting.id),
    invitationId: text("invitation_id")
      .notNull()
      .$type<MeetingGuestInvitationId>()
      .references(() => meetingGuestInvitation.id),
    // What the guest typed at the door: untrusted display text, whitespace-normalized and bounded,
    // and never written over the Directory's name anywhere.
    confirmedName: text("confirmed_name").notNull(),
    joinedAt: text("joined_at").notNull(), // ISO-8601 instant — for a guest, at the door
    waitingFrom: text("waiting_from").notNull(), // ISO-8601 instant — never null, a guest always waits
    admittedAt: text("admitted_at"), // ISO-8601 instant
    admittedByUserId: text("admitted_by_user_id")
      .$type<UserId>()
      .references(() => member.userId),
    leftAt: text("left_at"), // ISO-8601 instant
    endedReason: text("ended_reason"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    // The live count and the roster: the open rows of one meeting.
    index("meeting_guest_stay_meeting_left_at_index").on(table.meetingId, table.leftAt),
    // WHO IS AT THE DOOR, in arrival order, partial on exactly the set the lobby list and the door's
    // own ceiling are asked of — the member table's waiting index, for the second table.
    index("meeting_guest_stay_waiting_index")
      .on(table.meetingId, table.waitingFrom)
      .where(sql`${table.leftAt} IS NULL AND ${table.admittedAt} IS NULL`),
    // ONE OPEN STAY PER INVITATION PER MEETING. A spend of the link while a stay is open returns
    // that stay rather than opening a second, and this is what holds that under a race: two
    // browsers pressing Join on one link at once end with one stay. Partial on the open row,
    // because the closed ones are the record.
    uniqueIndex("meeting_guest_stay_open_stay_unique_index")
      .on(table.meetingId, table.invitationId)
      .where(sql`${table.leftAt} IS NULL`),
    check(
      "meeting_guest_stay_confirmed_name_check",
      sql`length(${table.confirmedName}) > 0 AND length(${table.confirmedName}) <= 80`,
    ),
    // Who let them in and when, together or neither — the lock's line.
    check(
      "meeting_guest_stay_admission_shape_check",
      sql`(${table.admittedAt} IS NULL) = (${table.admittedByUserId} IS NULL)`,
    ),
    check(
      "meeting_guest_stay_span_check",
      sql`${table.leftAt} IS NULL OR ${table.leftAt} >= ${table.joinedAt}`,
    ),
    // The member table's departure vocabulary, and the same pairing: a reason on a stay that is
    // still open would say how somebody left a room they are sitting in.
    check(
      "meeting_guest_stay_ended_reason_check",
      sql`${table.endedReason} IS NULL
        OR (${table.leftAt} IS NOT NULL
          AND ${table.endedReason} IN ('left', 'socket-lost', 'removed', 'denied'))`,
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

// A vehicle's structured attributes, one-to-one on the asset. THE IDENTIFIERS HERE ARE PLAINTEXT AND
// INDEXED, and the line is the same one matter_asset_real_property draws: a vehicle identification
// number is stamped on the title, etched into the windscreen, and readable through the glass from the
// kerb, and a plate number is displayed to the public by law. Neither is a secret, and searching by
// them — "which of these forty estate assets is the truck on the driveway" — is the whole point of the
// column. A full account number is the opposite kind of thing and lives sealed in
// matter_asset_identifier.
export const matterAssetVehicle = sqliteTable(
  "matter_asset_vehicle",
  {
    assetId: text("asset_id")
      .primaryKey()
      .$type<MatterAssetId>()
      .references(() => matterAsset.id),
    make: text("make"),
    model: text("model"),
    modelYear: integer("model_year"),
    vehicleIdentificationNumber: text("vehicle_identification_number"),
    plateNumber: text("plate_number"),
    plateRegion: text("plate_region"),
  },
  (table) => [
    index("matter_asset_vehicle_identification_number_index").on(table.vehicleIdentificationNumber),
    index("matter_asset_vehicle_plate_index").on(table.plateNumber),
    // A year outside this window is a typo, not a vehicle. The floor is before any motor vehicle was
    // registered anywhere and the ceiling is generous enough for a model year that runs ahead of the
    // calendar, so the check catches a transposed digit without ever refusing a real car.
    check(
      "matter_asset_vehicle_model_year_check",
      sql`${table.modelYear} IS NULL OR (${table.modelYear} >= 1885 AND ${table.modelYear} <= 2200)`,
    ),
  ],
);

// A firearm's structured attributes, one-to-one on the asset. THE SERIAL NUMBER IS PLAINTEXT AND
// INDEXED for the same reason a vehicle identification number is: it appears on the bill of sale and
// on every piece of transfer paperwork, it is the identifier a firm searches by, and treating it as a
// secret would break the search while protecting nothing.
//
// `regulated_category` is FREE TEXT A PERSON ASSERTED and is read by nothing. No code classifies an
// item under any regulatory schedule, determines who may receive one, decides whether a transfer needs
// a licensed dealer, checks a prohibited-person status, or computes a deadline: federal and state law
// vary on every one of those points, they vary by the recipient as well as by the item, and a rule
// that is ninety percent right is worse than no rule because it will be trusted. The class registry's
// standing handling note in packages/matter-assets/src/classes.ts says exactly that to a person, and
// nothing branches on it.
export const matterAssetFirearm = sqliteTable(
  "matter_asset_firearm",
  {
    assetId: text("asset_id")
      .primaryKey()
      .$type<MatterAssetId>()
      .references(() => matterAsset.id),
    make: text("make"),
    model: text("model"),
    caliberOrGauge: text("caliber_or_gauge"),
    serialNumber: text("serial_number"),
    regulatedCategory: text("regulated_category"),
  },
  (table) => [index("matter_asset_firearm_serial_index").on(table.serialNumber)],
);

// A business interest's structured attributes, one-to-one on the asset. The company OPTIONALLY IS a
// Directory organization: the firm probably already has it as an entity, and pointing at it brings its
// address, its registered agent, and its relationships for free. Optional, because a client's
// twelve-percent interest in a company the firm has never dealt with does not deserve a Directory row,
// and requiring one would push a firm into creating throwaway entities that then pollute the conflicts
// corpus.
export const matterAssetBusinessInterest = sqliteTable(
  "matter_asset_business_interest",
  {
    assetId: text("asset_id")
      .primaryKey()
      .$type<MatterAssetId>()
      .references(() => matterAsset.id),
    entityName: text("entity_name"),
    // An optional directoryOrganization_ handle, by value with no cross-domain foreign key.
    entityOrganizationId: text("entity_organization_id"),
    jurisdictionOfOrganization: text("jurisdiction_of_organization"),
    // Free text — "limited liability company", "S corporation", "general partnership". Not an enum:
    // entity forms are jurisdiction-specific and unevenly named, and no engine here consumes them.
    entityForm: text("entity_form"),
  },
  (table) => [
    index("matter_asset_business_interest_organization_index").on(table.entityOrganizationId),
  ],
);

// An insurance policy's structured attributes, one-to-one on the asset.
//
// THE FACE AMOUNT IS A TERM OF THE CONTRACT, NOT A VALUATION, which is why it sits here rather than in
// the valuation history. What the policy is WORTH — its cash surrender value — is a valuation row like
// any other, dated and on a stated basis. Collapsing the two would make every term-life policy look
// like a liquid asset worth its death benefit, which is the single most consequential category error
// available in an estate inventory. A schedule reports them in two different columns.
//
// The POLICY NUMBER is not here: a full policy number is a credential-adjacent secret and lives sealed
// in matter_asset_identifier with its last four characters beside it.
export const matterAssetInsurancePolicy = sqliteTable(
  "matter_asset_insurance_policy",
  {
    assetId: text("asset_id")
      .primaryKey()
      .$type<MatterAssetId>()
      .references(() => matterAsset.id),
    carrierName: text("carrier_name"),
    // An optional directoryOrganization_ handle, by value with no cross-domain foreign key.
    carrierOrganizationId: text("carrier_organization_id"),
    faceAmountMinor: integer("face_amount_minor"),
    // The companion currency, named `face_currency` and not `face_amount_currency` because the
    // storage-encoding rule reserves an `amount`-shaped name for the *_minor integer itself — the
    // `declared_value_currency` / `principal_currency` shape, reused.
    faceCurrency: text("face_currency"),
    // Whose life or property the policy covers — a directoryPerson_/directoryOrganization_ handle, by
    // value with no cross-domain foreign key (the matter_party and custody_owner precedent).
    insuredEntityId: text("insured_entity_id"),
  },
  (table) => [
    index("matter_asset_insurance_policy_carrier_index").on(table.carrierOrganizationId),
    index("matter_asset_insurance_policy_insured_index").on(table.insuredEntityId),
    // An amount with no currency cannot be interpreted, and a currency with no amount says nothing.
    check(
      "matter_asset_insurance_policy_face_amount_check",
      sql`(${table.faceAmountMinor} IS NULL) = (${table.faceCurrency} IS NULL)`,
    ),
  ],
);

// Money owed to the estate, one-to-one on the asset. The PRINCIPAL is a term of the obligation and
// sits here; what the receivable is worth today — after a partial repayment, or discounted because the
// debtor cannot pay — is a valuation row, dated and on a stated basis. A rate is rate_e4 and never a
// float, the same encoding the ledger uses.
export const matterAssetReceivable = sqliteTable(
  "matter_asset_receivable",
  {
    assetId: text("asset_id")
      .primaryKey()
      .$type<MatterAssetId>()
      .references(() => matterAsset.id),
    // Who owes it — a directoryPerson_/directoryOrganization_ handle, by value with no cross-domain
    // foreign key.
    debtorEntityId: text("debtor_entity_id"),
    principalAmountMinor: integer("principal_amount_minor"),
    principalCurrency: text("principal_currency"),
    rateE4: integer("rate_e4"),
    maturityOn: text("maturity_on"), // civil date
    // Whether anything secures it, asserted by a person. Nothing derives it from an encumbrance row on
    // some other asset, and nothing infers a priority or a remedy from it.
    secured: integer("secured", { mode: "boolean" }),
  },
  (table) => [
    index("matter_asset_receivable_debtor_index").on(table.debtorEntityId),
    check(
      "matter_asset_receivable_principal_check",
      sql`(${table.principalAmountMinor} IS NULL) = (${table.principalCurrency} IS NULL)`,
    ),
  ],
);

// A digital asset's structured attributes, one-to-one on the asset.
//
// THERE IS NO CREDENTIAL COLUMN HERE AND THERE NEVER WILL BE. No seed phrase, no recovery phrase, no
// private key, no password, no personal identification number — not in plaintext and not sealed. For a
// self-custodied digital asset the seed phrase IS the asset: whoever reads it can take it,
// irreversibly, with no record, and a sealed column is decryptable by any member holding the decrypt
// permission. Storing one would convert a records system into a bearer instrument. The correct home
// for a secret whose disclosure IS a transfer of the asset is a sealed envelope in the custody
// register, where a physical object has a location, a hold, and an append-only record of every hand it
// has passed through. The write path in packages/matter-assets/src/validation.ts refuses a request
// that names one BY NAME, with its own explainable refusal, before anything is written.
//
// `custody_model` records WHO HOLDS IT, which is the fact an administrator actually needs: a custodial
// account is reached by writing to the platform, and a self-custodied wallet is reached only through a
// key the firm must never hold.
export const matterAssetDigitalAsset = sqliteTable(
  "matter_asset_digital_asset",
  {
    assetId: text("asset_id")
      .primaryKey()
      .$type<MatterAssetId>()
      .references(() => matterAsset.id),
    platformName: text("platform_name"),
    // The public handle on the platform, not a login. A username is not a credential.
    accountHandle: text("account_handle"),
    custodyModel: text("custody_model", {
      enum: ["custodial", "selfCustodied", "unknown"],
    }),
  },
  (table) => [
    check(
      "matter_asset_digital_asset_custody_model_check",
      sql`${table.custodyModel} IS NULL OR ${table.custodyModel} IN ('custodial', 'selfCustodied', 'unknown')`,
    ),
  ],
);

// What is secured against an asset. A mortgage, a deed of trust, a lien, a judgment, a security
// interest, a tax lien, a pledge.
//
// AN ENCUMBRANCE'S BALANCE IS A VALUATION ROW — matter_asset_valuation.encumbrance_id, set, means the
// row is that encumbrance's balance as of a date rather than the asset's value as of a date. One
// append-only table, one trigger set, one as-of query shape, and net equity as of any date is one read
// over one table with a sign flip. Two tables differing only in what the number means would have been
// two of everything, and the second one would have drifted.
//
// `holder_name` is free text where no Directory record exists — the custody borrower precedent, and
// for the same reason: writing every lender a firm ever sees into the Directory pollutes the conflicts
// corpus with counterparties nobody is conflicted against.
//
// A released encumbrance keeps its row and gains a date. Nothing disappears, because "was this
// property clear on the date of death" is a question a schedule has to answer years later.
export const matterAssetEncumbrance = sqliteTable(
  "matter_asset_encumbrance",
  {
    id: text("id").primaryKey().$type<MatterAssetEncumbranceId>(), // matterAssetEncumbrance_ handle
    assetId: text("asset_id")
      .notNull()
      .$type<MatterAssetId>()
      .references(() => matterAsset.id),
    kind: text("kind", {
      enum: [
        "mortgage",
        "deedOfTrust",
        "lien",
        "judgment",
        "securityInterest",
        "taxLien",
        "pledge",
        "other",
      ],
    }).notNull(),
    // An optional directoryPerson_/directoryOrganization_ handle, by value with no cross-domain
    // foreign key.
    holderEntityId: text("holder_entity_id"),
    holderName: text("holder_name"),
    recordedReference: text("recorded_reference"),
    releasedOn: text("released_on"), // civil date; null while the charge is in force
    notes: text("notes"),
    createdAt: text("created_at").notNull(),
    createdBy: text("created_by").$type<UserId>(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    // The schedule's read: every unreleased charge on one asset. released_on rides the index so "what
    // is still in force" is a seek rather than a filter over the asset's whole history.
    index("matter_asset_encumbrance_asset_released_index").on(table.assetId, table.releasedOn),
    index("matter_asset_encumbrance_holder_index").on(table.holderEntityId),
    check(
      "matter_asset_encumbrance_kind_check",
      sql`${table.kind} IN ('mortgage', 'deedOfTrust', 'lien', 'judgment', 'securityInterest', 'taxLien', 'pledge', 'other')`,
    ),
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
    // read with a sign flip. `matter_asset_encumbrance` has since landed and this column carries its
    // balances: the asset's own as-of reads filter on `encumbrance_id IS NULL`
    // (packages/matter-assets/src/valuation-statements.ts), and equity is the two sides differenced.
    // Declaring it up front is what avoided rebuilding a table whose triggers have to be dropped.
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
    // The same characteristic read for an ENCUMBRANCE's balance — the one query net equity is. Without
    // it the balance resolution scans the whole valuation history of the firm, which is the table this
    // subsystem expects to grow without bound while the asset table does not.
    index("matter_asset_valuation_encumbrance_as_of_index").on(
      table.encumbranceId,
      table.asOfDate,
      table.recordedAt,
    ),
    index("matter_asset_valuation_corrects_index").on(table.correctsValuationId),
    check("matter_asset_valuation_as_of_shape_check", civilDateShape(table.asOfDate)),
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
    status: text("status", {
      enum: ["pending", "complete", "failed", "refused"],
    }).notNull(),
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

// A matter's file attached to a conversation BY REFERENCE. The row points at the file and copies
// nothing of it: the readable text the model is sent is taken from the file's current clean version
// at the moment a question is asked and is kept nowhere else, so the file subsystem's erasure and
// retention posture is the attachment's too. No handle of its own — the pair is the identity, and a
// retried attach of the same pair is the same attachment.
//
// `text_status` and `text_bytes` record what became of the file's text on the most recent question:
// whether it reached the model whole, was cut to fit the request's budget, or yielded nothing
// readable. Recorded so the surface can say so per file rather than the member wondering whether the
// model saw the document. No member column: only the conversation's author can attach, and the
// conversation row already names them.
export const magnusConversationAttachment = sqliteTable(
  "magnus_conversation_attachment",
  {
    conversationId: text("conversation_id")
      .notNull()
      .$type<MagnusConversationId>()
      .references(() => magnusConversation.id),
    fileId: text("file_id")
      .notNull()
      .$type<FileId>()
      .references(() => file.id),
    attachedAt: text("attached_at").notNull(),
    textStatus: text("text_status", {
      enum: ["pending", "sent", "cut", "unreadable"],
    })
      .notNull()
      .default("pending"),
    textBytes: integer("text_bytes"),
  },
  (table) => [
    primaryKey({ columns: [table.conversationId, table.fileId] }),
    check(
      "magnus_conversation_attachment_text_status_check",
      sql`${table.textStatus} IN ('pending', 'sent', 'cut', 'unreadable')`,
    ),
  ],
);

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
    kind: text("kind", {
      enum: ["person", "organization", "unattributed"],
    }).notNull(),
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
    transcriptScope: text("transcript_scope", {
      enum: ["exclude", "include"],
    }).notNull(),
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
    // WHICH ENGINES READ IT, in the order they ran, comma-joined from the closed vocabulary in
    // packages/search/src/extraction.ts. Extraction is composite — a text layer, a recognizer, and
    // the office container for a format nothing memory-safe parses — and those are three different
    // kinds of evidence. A firm asked how it read a production has to be able to name the engine.
    // Not NOT NULL: a document that never processed has no route, and there is no ALTER TABLE ADD
    // CONSTRAINT in SQLite to say "not null once processed" without rebuilding a shipped table.
    extractionRoute: text("extraction_route"),
    // How many pages came back from recognition rather than from the document's own text layer. The
    // number a reviewer judges the text by: a search hit in recognized text is a machine's reading of
    // a picture of a word, not the word the author typed.
    pagesRecognized: integer("pages_recognized"),
    // Why a document is still pending. An engine that is not deployed is not a verdict on the
    // document, so it parks rather than being recorded `excepted` — and this is what makes the
    // backlog enumerable from the corpus instead of from a queue somebody has to know to look in.
    // Cleared on the next attempt, so it can never be stale.
    processingDeferredReason: text("processing_deferred_reason"),
    // Where the document stands with the SEARCH INDEX, which is a different stage with a different
    // engine and therefore a different answer: `indexed`, `deferred` (the index engine is not
    // deployed), or `failed`. Null until the corpus first asks the index about it.
    //
    // NOT AN EXCEPTION, and deliberately not folded into the two above. The exception vocabulary is a
    // closed list of sentences about what could not be READ, and every one of them is rendered into a
    // report a firm hands to another party; "our own search index has not caught up" is not one of
    // them, and putting it there would put a number in front of a court that a later deploy silently
    // changes. Kept on the row for the same reason processingDeferredReason is: the backlog has to be
    // enumerable from the corpus rather than only from a Durable Object somebody has to know to open.
    indexState: text("index_state"),
    indexDeferredReason: text("index_deferred_reason"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    // The read every future review surface sits on: one review set's documents, newest first, with
    // the filters the reviewer actually uses. review_set_id leads every one of these.
    index("review_document_review_set_sort_index").on(table.reviewSetId, table.sortDate, table.id),
    // What this corpus is still owed by the index, as one indexed read over the review set rather
    // than an anti-join against the split catalog.
    index("review_document_index_state_index").on(table.reviewSetId, table.indexState),
    index("review_document_review_set_load_index").on(table.reviewSetId, table.discoveryLoadId),
    index("review_document_review_set_record_custodian_index").on(
      table.reviewSetId,
      table.recordCustodianId,
    ),
    index("review_document_review_set_state_index").on(table.reviewSetId, table.processingState),
    // THE LIST PAGE, and its three filtered forms. The read is ordered newest-document-first and
    // keyset-paged on (sort_date, id); an index that stopped at the filter column would satisfy the
    // WHERE and leave the ORDER BY to a temporary b-tree over a quarter-million rows on every page.
    // The four narrower indexes above are prefixes of these and now redundant; they stay because
    // dropping one is a rebuild of a table firms have already provisioned.
    index("review_document_review_set_page_index").on(
      table.reviewSetId,
      table.sortDate,
      table.id,
      table.processingState,
    ),
    index("review_document_custodian_page_index").on(
      table.reviewSetId,
      table.recordCustodianId,
      table.sortDate,
      table.id,
    ),
    index("review_document_load_page_index").on(
      table.reviewSetId,
      table.discoveryLoadId,
      table.sortDate,
      table.id,
    ),
    index("review_document_state_page_index").on(
      table.reviewSetId,
      table.processingState,
      table.sortDate,
      table.id,
    ),
    // The dispatch walk: one load's still-unprocessed documents, keyset-paged by id. Leading with the
    // LOAD rather than the review set, which is the one discovery read whose scope is the load — at
    // the ceiling a load is the whole review set, so a review-set-led index narrows nothing and the
    // state filter becomes a scan on every one of the walk's hundreds of turns.
    index("review_document_load_state_index").on(
      table.discoveryLoadId,
      table.processingState,
      table.id,
    ),
    // A family is ONE indexed read.
    index("review_document_family_index").on(
      table.reviewSetId,
      table.familyId,
      table.familySequence,
    ),
    // Exact-duplicate grouping, and the "which custodians held this" answer behind it.
    index("review_document_review_set_dedup_index").on(table.reviewSetId, table.dedupGroupId),
    index("review_document_review_set_sha256_index").on(table.reviewSetId, table.contentSha256),
    // Two PARTIAL unique indexes — one per source column — live only in the migration, because
    // drizzle cannot express a WHERE on a unique index. They are what makes a load structurally
    // idempotent: a version and a message each appear in a review set exactly once, so a redelivered
    // or retried fan-out converges on the rows it already wrote instead of allocating a second set.
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
    // A count of recognized pages is a count. Stated as a column CHECK because that is the one place
    // SQLite accepts a constraint on an ADD COLUMN; the route beside it has no CHECK because its
    // value is an ordered list and a constraint over its combinations would be unreadable.
    check(
      "review_document_pages_recognized_check",
      sql`${table.pagesRecognized} IS NULL OR ${table.pagesRecognized} >= 0`,
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
    // Which load the excepted document arrived in, carried for the same reason the review set is:
    // the exception report a firm hands to opposing counsel is written per load, and reaching the
    // load through the document means joining a quarter-million rows to group a few thousand.
    // Nullable only because SQLite cannot add a NOT NULL column to a table that already exists; the
    // insert statement is the sole writer and always binds it.
    discoveryLoadId: text("discovery_load_id")
      .$type<DiscoveryLoadId>()
      .references(() => discoveryLoad.id),
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
    // The exception report's own walk: one load's exceptions in document order, so the report can be
    // merged against the manifest's document walk in one pass rather than read per document.
    index("review_document_exception_load_index").on(table.discoveryLoadId, table.reviewDocumentId),
    // The whole review set's exceptions, keyset-paged on the (document, exception) PAIR. Several
    // reasons on one document is normal, so a page boundary can fall inside one document and resuming
    // from the document alone would drop the reasons after it.
    index("review_document_exception_review_set_page_index").on(
      table.reviewSetId,
      table.reviewDocumentId,
      table.id,
    ),
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
    // The same read with the order it is served in on the end, so it comes back sorted from the index
    // rather than through a temporary b-tree. The set is small — one document's copies — but the read
    // is on the review surface's per-document panel, so it happens once per document opened.
    index("review_document_occurrence_primary_page_index").on(
      table.reviewSetId,
      table.primaryReviewDocumentId,
      table.duplicateReviewDocumentId,
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

// ---------------------------------------------------------------------------------------------
// Discovery — who may reach a corpus, and what a reviewer decides about a document in it.
//
// TWO IDEAS, ONE MIGRATION, because neither is safe without the other. The access list is the wall:
// holding a discovery permission says a member may review SOMETHING, and this list says WHICH corpora
// — material another party produced may be attorney's-eyes-only under a protective order, and an
// attorneys'-eyes-only production is nothing more than a review set whose list is two people. Coding
// is what a reviewer then does, and every coding read and write sits behind the list.
//
// THE LIST IS FAIL-CLOSED. A review set with no rows is reachable by nobody, not by everybody. The
// alternative — empty meaning open — makes the wall opt-in, so a bug in the seeding path silently
// discloses a corpus instead of silently hiding one, and only one of those two failures is
// recoverable by a person noticing they cannot see something.

// One person's membership of one review set's corpus. Membership is a live list rather than an
// event journal: it answers "who may look right now", and the record of how it came to say that is
// the audit log's, written in the same batch as every grant and revoke.
export const reviewSetAccess = sqliteTable(
  "review_set_access",
  {
    id: text("id").primaryKey().$type<ReviewSetAccessId>(), // reviewSetAccess_ handle
    reviewSetId: text("review_set_id")
      .notNull()
      .$type<ReviewSetId>()
      .references(() => reviewSet.id),
    // Not a foreign key to `member`, matching `review_set.created_by`: the grant is a record that
    // outlives the member row, and a deactivated member is refused at the session rather than by a
    // dangling reference.
    memberUserId: text("member_user_id").notNull().$type<UserId>(),
    grantedBy: text("granted_by").notNull().$type<UserId>(),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    // The predicate every discovery read composes is "does a row exist for this review set and this
    // member", so the unique index that keeps membership single IS the index that answers it.
    uniqueIndex("review_set_access_member_unique_index").on(table.reviewSetId, table.memberUserId),
    // The other direction: which corpora may this member reach. That is the list read, and without
    // this index it is a scan of every grant in the firm.
    index("review_set_access_member_index").on(table.memberUserId, table.reviewSetId),
  ],
);

// One ordered question on the coding panel. Two levels — groups containing tags — with the
// cardinality on the GROUP, because that is what review coding is actually made of: a single-choice
// group is a radio row (Responsiveness), a multi-choice group is a flag set (issue codes), and a flat
// bag is the degenerate case of one multi-choice group. Independent boolean flags cannot express a
// mutually exclusive choice, and a corpus where some documents are both responsive and non-responsive
// is a corpus that cannot be produced from without a cleanup pass. Deeper nesting is refused by
// shape rather than deferred by omission.
export const reviewTagGroup = sqliteTable(
  "review_tag_group",
  {
    id: text("id").primaryKey().$type<ReviewTagGroupId>(), // reviewTagGroup_ handle
    reviewSetId: text("review_set_id")
      .notNull()
      .$type<ReviewSetId>()
      .references(() => reviewSet.id),
    name: text("name").notNull(),
    // A `system` group is seeded at creation and is not deletable, because production logic stands on
    // its existence. It is freely RENAMABLE — nothing ever matches a group by its name.
    kind: text("kind", { enum: ["system", "custom"] }).notNull(),
    cardinality: text("cardinality", { enum: ["single", "multi"] }).notNull(),
    // Whether a document with no answer in this group counts as uncoded. That arithmetic is the whole
    // of progress reporting, and later the staging refusal that keeps an uncoded document out of a
    // production.
    requiredForCompletion: integer("required_for_completion", {
      mode: "boolean",
    })
      .notNull()
      .default(false),
    sortOrder: integer("sort_order").notNull(),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("review_tag_group_review_set_name_unique_index").on(table.reviewSetId, table.name),
    index("review_tag_group_review_set_order_index").on(table.reviewSetId, table.sortOrder),
    check("review_tag_group_kind_check", sql`${table.kind} IN ('system', 'custom')`),
    check("review_tag_group_cardinality_check", sql`${table.cardinality} IN ('single', 'multi')`),
    check("review_tag_group_name_nonempty_check", sql`length(${table.name}) > 0`),
  ],
);

// One answer within a group.
//
// SEMANTICS, NOT NAMES, DRIVE THE MACHINE. Privilege-log generation, production membership, redaction
// checks and completion arithmetic read only `semantic`, so a firm may rename "Privileged" to
// "Withhold — AC privilege" and nothing breaks, because nothing ever matched the string. A custom tag
// carries no semantic and drives no machinery — it filters, groups and exports, which is what custom
// tags are for.
export const reviewTag = sqliteTable(
  "review_tag",
  {
    id: text("id").primaryKey().$type<ReviewTagId>(), // reviewTag_ handle
    reviewTagGroupId: text("review_tag_group_id")
      .notNull()
      .$type<ReviewTagGroupId>()
      .references(() => reviewTagGroup.id),
    // Redundant with the path through the group, and carried for the same reason
    // `review_document_exception` carries it: the review-set-wide tag read must not join to get here.
    reviewSetId: text("review_set_id")
      .notNull()
      .$type<ReviewSetId>()
      .references(() => reviewSet.id),
    name: text("name").notNull(),
    semantic: text("semantic", {
      enum: [
        "responsive",
        "non-responsive",
        "needs-further-review",
        "privileged",
        "privileged-redact",
        "not-privileged",
        "confidential",
      ],
    }),
    // A design-token NAME, never a raw colour value: the coding panel styles through the design
    // system, and a hex string stored here would be an off-token value the UI could not refuse.
    colorToken: text("color_token").notNull(),
    sortOrder: integer("sort_order").notNull(),
    // A tag that has ever been applied is DEACTIVATED, never deleted. Deleting one would orphan the
    // coding history that is the entire point of the journal below.
    active: integer("active", { mode: "boolean" }).notNull().default(true),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("review_tag_group_name_unique_index").on(table.reviewTagGroupId, table.name),
    index("review_tag_review_set_index").on(table.reviewSetId, table.reviewTagGroupId),
    check(
      "review_tag_semantic_check",
      sql`${table.semantic} IS NULL OR ${table.semantic} IN ('responsive', 'non-responsive', 'needs-further-review', 'privileged', 'privileged-redact', 'not-privileged', 'confidential')`,
    ),
    check("review_tag_name_nonempty_check", sql`length(${table.name}) > 0`),
  ],
);

// ONE ROW PER HUMAN ACT of coding, however many documents it touched. Together with the per-document
// rows that point back at it, this answers in indexed reads and without reconstruction: who coded this
// document, as what, when, one at a time or in bulk, under what criteria, and who reversed it. That
// is the record a court asks for when a production is challenged, and it is richer than the generic
// audit row would be — which is why coding does not also write one, since two homes for one fact
// drift.
//
// NOTHING HERE IS CONTENT. Tag names live in the tag table; `criteria` holds field names and
// identifiers, never free text, refused at the service boundary.
export const reviewTagEvent = sqliteTable(
  "review_tag_event",
  {
    id: text("id").primaryKey().$type<ReviewTagEventId>(), // reviewTagEvent_ handle
    reviewSetId: text("review_set_id")
      .notNull()
      .$type<ReviewSetId>()
      .references(() => reviewSet.id),
    kind: text("kind", {
      enum: ["apply", "remove", "bulk-apply", "bulk-remove", "undo"],
    }).notNull(),
    reviewTagId: text("review_tag_id")
      .notNull()
      .$type<ReviewTagId>()
      .references(() => reviewTag.id),
    scope: text("scope", {
      enum: ["document", "family", "selection"],
    }).notNull(),
    documentCount: integer("document_count").notNull().default(0),
    // The filter that drove a bulk selection, as typed — recorded for HUMANS. It is never re-run: the
    // materialized selection below is what executed.
    criteria: text("criteria"),
    // The frozen selection, resolved once at initiation. A bulk operation that re-ran its criteria per
    // chunk would apply a tag to documents the operator never saw, because the corpus moves under a
    // long operation.
    selectionR2Key: text("selection_r2_key"),
    state: text("state", { enum: ["running", "complete", "undone"] })
      .notNull()
      .default("running"),
    reversesEventId: text("reverses_event_id").$type<ReviewTagEventId>(),
    actorUserId: text("actor_user_id").notNull().$type<UserId>(),
    createdAt: text("created_at").notNull(),
    completedAt: text("completed_at"),
  },
  (table) => [
    index("review_tag_event_review_set_created_index").on(
      table.reviewSetId,
      table.createdAt,
      table.id,
    ),
    index("review_tag_event_review_set_actor_index").on(table.reviewSetId, table.actorUserId),
    // At most one undo per event: history never shortens, and a second reversal of the same act would
    // remove rows a first reversal already attributed. Partial, because every non-undo row is NULL
    // here and NULLs do not collide in SQLite's unique indexes anyway — stating it keeps the intent
    // legible and the index narrow.
    uniqueIndex("review_tag_event_reverses_unique_index")
      .on(table.reversesEventId)
      .where(sql`${table.reversesEventId} IS NOT NULL`),
    check(
      "review_tag_event_kind_check",
      sql`${table.kind} IN ('apply', 'remove', 'bulk-apply', 'bulk-remove', 'undo')`,
    ),
    check(
      "review_tag_event_scope_check",
      sql`${table.scope} IN ('document', 'family', 'selection')`,
    ),
    check("review_tag_event_state_check", sql`${table.state} IN ('running', 'complete', 'undone')`),
    check("review_tag_event_document_count_check", sql`${table.documentCount} >= 0`),
    // An undo names what it reverses; nothing else does.
    check(
      "review_tag_event_reverses_check",
      sql`(${table.kind} = 'undo') = (${table.reversesEventId} IS NOT NULL)`,
    ),
  ],
);

// THE UNIT OF TAG STORAGE IS ONE ROW PER (DOCUMENT, TAG) APPLICATION, whatever gesture applied it.
// Applying a tag "to the family" writes a row per family member; a bulk application writes a row per
// selected document. The tempting alternative — a family-level row that members inherit at read time
// — makes production membership a join over inheritance rules executed years after the coding pass,
// which is exactly where an inheritance bug becomes a produced privileged document. The EVENT records
// the gesture; the ROWS record the result, and a production reads rows and only rows.
//
// Rows are never deleted. Removal is a state with an actor and an instant, which is what makes the
// coding history of one document one indexed read years later.
export const reviewDocumentTag = sqliteTable(
  "review_document_tag",
  {
    id: text("id").primaryKey().$type<ReviewDocumentTagId>(), // reviewDocumentTag_ handle
    reviewSetId: text("review_set_id")
      .notNull()
      .$type<ReviewSetId>()
      .references(() => reviewSet.id),
    reviewDocumentId: text("review_document_id")
      .notNull()
      .$type<ReviewDocumentId>()
      .references(() => reviewDocument.id),
    reviewTagId: text("review_tag_id")
      .notNull()
      .$type<ReviewTagId>()
      .references(() => reviewTag.id),
    // Both denormalized from the tag and its group, and load-bearing rather than convenient: they are
    // what make the partial unique index below expressible at all. An index cannot reach through a
    // join, so without these columns the single-choice rule would be a service-layer guard that two
    // concurrent writers could walk straight past.
    reviewTagGroupId: text("review_tag_group_id")
      .notNull()
      .$type<ReviewTagGroupId>()
      .references(() => reviewTagGroup.id),
    singleChoice: integer("single_choice", { mode: "boolean" }).notNull(),
    appliedByEventId: text("applied_by_event_id")
      .notNull()
      .$type<ReviewTagEventId>()
      .references(() => reviewTagEvent.id),
    appliedAt: text("applied_at").notNull(),
    removedByEventId: text("removed_by_event_id").$type<ReviewTagEventId>(),
    removedAt: text("removed_at"),
  },
  (table) => [
    // SINGLE CHOICE IS STRUCTURAL, NOT GUARDED. Changing a single-choice answer is remove-plus-apply
    // in one batch; two concurrent writers cannot leave a document both responsive and non-responsive,
    // because the index refuses the second row.
    uniqueIndex("review_document_tag_single_choice_unique_index")
      .on(table.reviewDocumentId, table.reviewTagGroupId)
      .where(sql`${table.removedAt} IS NULL AND ${table.singleChoice} = 1`),
    // And at most one LIVE row per (document, tag) in any group, so a double-apply converges instead
    // of accumulating rows a later removal would only half-clear.
    uniqueIndex("review_document_tag_live_unique_index")
      .on(table.reviewDocumentId, table.reviewTagId)
      .where(sql`${table.removedAt} IS NULL`),
    // "What is coded on this document" — the read the coding panel makes on every document a reviewer
    // opens, and the one the family-conflict read makes per family member.
    index("review_document_tag_document_index").on(table.reviewDocumentId, table.removedAt),
    // "Which documents carry this tag" — the progress counts, the filters, and later the resolution of
    // a production's membership.
    index("review_document_tag_review_set_tag_index").on(
      table.reviewSetId,
      table.reviewTagId,
      table.removedAt,
    ),
    // What an undo reverses: precisely the rows one event wrote. Indexed because an undo over a
    // ceiling-sized bulk apply is otherwise a full scan of the largest table this slice adds.
    index("review_document_tag_applied_event_index").on(table.appliedByEventId),
    index("review_document_tag_removed_event_index").on(table.removedByEventId),
    // A removal is an instant AND an attribution, or it is neither. Half a removal is a row nobody can
    // explain.
    check(
      "review_document_tag_removal_check",
      sql`(${table.removedAt} IS NULL) = (${table.removedByEventId} IS NULL)`,
    ),
  ],
);

// ---------------------------------------------------------------------------------------------
// Notifications — the delivery half.
//
// A notification is a POINTER, never a record. The thing it points at — the ledger entry, the
// invoice, the quarantined version, the matter's own lifecycle row — is the record, and each of
// those carries its own retention posture set by its own subsystem. That is what makes a retention
// window defensible here and what makes these rows deletable at all: sweeping one destroys no
// evidence, because the audit_log row and the source row it pointed at are still there. Nothing in
// this subsystem is ever the only record of the fact it describes.
//
// THREE LIFETIMES, THREE TABLES. What happened happens once however many people hear about it;
// whether one person has dealt with it is one fact per recipient and the thing the feed sorts and
// counts on; whether a copy left the platform is one fact per recipient per outbound channel, with
// attempts, a failure state, and a retry the other two do not have. One table holding all three
// would be a null-heavy row meaning something different in each of its states.

// What happened. Written ONCE per occurrence, whatever the size of the audience.
//
// The redaction rule is the whole design of this table: it carries identifiers, enum labels,
// integers, and instants, and NO STRING A PERSON TYPED. No matter title, no client name, no
// filename, no email subject line, no deadline description, no free-text note. Three reasons, in
// the order they bind. The row OUTLIVES THE ACCESS CHECK that justified it — it is read next week
// and swept months later, and access can be revoked in between, so a row holding a title holds it
// after the reader stops being entitled to it. A stored title is a STALE title — a matter
// renumbered or an invoice voided leaves every notification about it wrong, and wrong invisibly,
// because the row still looks authoritative. And resolving at read costs nothing, because the feed
// read already joins `matter` to enforce visibility. The reader sees "a deadline you are
// responsible for is due today — matter 8181-3", assembled at read time from the kind plus that
// join, and never a stored sentence naming the motion and the parties.
export const notificationEvent = sqliteTable(
  "notification_event",
  {
    id: text("id").primaryKey().$type<NotificationEventId>(), // notificationEvent_ handle
    // A registry key from @magna-carta/notifications. A WIRE CONTRACT once shipped: it appears in
    // responses and in the feed's `kind` filter.
    kind: text("kind").notNull(),
    // Denormalized from the registry so a category filter and the per-category digest counts are an
    // index walk rather than a code-side join against a table that does not exist.
    category: text("category", {
      enum: [
        "deadlines",
        "calendar",
        "tasks",
        "trust",
        "billing",
        "documents",
        "custody",
        "email",
        "conflicts",
        "jobs",
        "security",
        "system",
      ],
    }).notNull(),
    severity: text("severity", {
      enum: ["informational", "attention", "critical"],
    }).notNull(),
    // The kind of record this points at. Seeded with every subject the inventoried emission points
    // name, not only the ones wired today: this is a SQLite CHECK, and widening one rebuilds a
    // growing table (the same reasoning the channel column below states at length).
    subjectKind: text("subject_kind", {
      enum: [
        "matter",
        "matterEvent",
        "matterDeadline",
        "matterAsset",
        "invoice",
        "ledgerEntry",
        "trustMovement",
        "file",
        "fileVersion",
        "documentCheckout",
        "directoryEntity",
        "location",
        "shipment",
        "emailMessage",
        "emailCaptureAddress",
        "custodyPacket",
        "custodyItem",
        "custodyMovement",
        "conflictsCheck",
        "incident",
        "magnusConversation",
        "reviewSet",
        "discoveryLoad",
        "conversionJob",
        "documentAssembly",
        "bundleBuild",
        "searchIndexJob",
        "recoveryJob",
        "member",
        "matterTask",
      ],
    }).notNull(),
    // The record's own handle. A LINK, never a copy, and deliberately no cross-domain foreign key —
    // the matter_party precedent. The subject is resolved when the member follows the deep link,
    // through the owning subsystem's own access-checked read, so a subject that has since been
    // removed degrades to a dead link rather than to a broken constraint on this table.
    subjectId: text("subject_id").notNull(),
    // THE VISIBILITY ANCHOR, and the single column that makes the wall a join rather than a per-kind
    // rule — the difference between one enforcement point and thirty. Non-null for every
    // matter-rooted kind (the registry declares which, and a fitness test holds the materializers to
    // it); null only for genuinely firm-scoped kinds, which are the ones a matter filter must not
    // hide. Unlike subject_id this IS a foreign key: every read joins it to enforce the wall, and a
    // dangling anchor would be a row the predicate cannot decide about.
    matterId: text("matter_id")
      .$type<MatterId>()
      .references(() => matter.id),
    // When the thing HAPPENED, not when this row was written. The retention sweep and the digest
    // watermark both order on it, so a message that sat in the queue for an hour still ages and
    // digests from the moment it describes.
    occurredAt: text("occurred_at").notNull(),
    // The declared non-privileged slot: canonical JSON whose keys are declared by the registry type
    // and whose values are drawn from a closed grammar — an identifier, an integer, a boolean, an
    // enum label the type itself declares, a canonical instant, or a civil date. A declared string
    // field is a validation failure rather than a review comment, which is what makes the redaction
    // rule above structural instead of aspirational.
    facts: text("facts"),
    // The idempotency floor, and the reason neither production path needs a check-then-insert.
    // Queues are at-least-once and sweeps overlap, so both paths converge here: the insert is
    // attempted and the UNIQUE constraint refuses the duplicate. The event-driven path keys on the
    // originating outbox row id, which is stable across every redelivery of that message; the
    // comparison-driven path keys on a CIVIL DATE, so a condition that is continuously true (a
    // deadline that is overdue) raises once a day rather than once a sweep.
    dedupeKey: text("dedupe_key").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    uniqueIndex("notification_event_dedupe_key_unique_index").on(table.dedupeKey),
    index("notification_event_matter_id_index").on(table.matterId),
    // The retention sweep's own walk: oldest first, bounded, resumable.
    index("notification_event_occurred_at_index").on(table.occurredAt, table.id),
    check(
      "notification_event_category_check",
      sql`${table.category} IN ('deadlines', 'calendar', 'tasks', 'trust', 'billing', 'documents', 'custody', 'email', 'conflicts', 'jobs', 'security', 'system')`,
    ),
    check(
      "notification_event_severity_check",
      sql`${table.severity} IN ('informational', 'attention', 'critical')`,
    ),
    check(
      "notification_event_subject_kind_check",
      sql`${table.subjectKind} IN ('matter', 'matterEvent', 'matterDeadline', 'matterAsset', 'invoice', 'ledgerEntry', 'trustMovement', 'file', 'fileVersion', 'documentCheckout', 'directoryEntity', 'location', 'shipment', 'emailMessage', 'emailCaptureAddress', 'custodyPacket', 'custodyItem', 'custodyMovement', 'conflictsCheck', 'incident', 'magnusConversation', 'reviewSet', 'discoveryLoad', 'conversionJob', 'documentAssembly', 'bundleBuild', 'searchIndexJob', 'recoveryJob', 'member', 'matterTask')`,
    ),
  ],
);

// One person's copy, and the ONLY home of whether they have dealt with it.
//
// Read state belongs to the recipient rather than to a channel: marking an item read in the feed
// must also settle it for a push notification nobody tapped, whenever push arrives. Putting read_at
// on a channel row would make the answer to "has this person dealt with it" depend on which channel
// you ask.
export const notificationRecipient = sqliteTable(
  "notification_recipient",
  {
    id: text("id").primaryKey().$type<NotificationRecipientId>(), // notificationRecipient_ handle
    notificationEventId: text("notification_event_id")
      .notNull()
      .$type<NotificationEventId>()
      .references(() => notificationEvent.id),
    // The same global user_ handle member.user_id carries. Not a foreign key: a row addressed to a
    // person must never be the thing that blocks removing their membership, and the read path never
    // needs the join — every read is scoped to the SESSION's user id, never to a path parameter, so
    // a member cannot reach another member's feed by guessing a handle.
    recipientUserId: text("recipient_user_id").notNull().$type<UserId>(),
    state: text("state", { enum: ["unread", "read", "dismissed"] })
      .notNull()
      .default("unread"),
    readAt: text("read_at"),
    dismissedAt: text("dismissed_at"),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    // A redelivered queue message must not produce a second feed entry, and a partially-failed
    // fan-out that retries must top up the recipients it missed without duplicating the ones it
    // already wrote. Both fall out of this one constraint.
    uniqueIndex("notification_recipient_event_user_unique_index").on(
      table.notificationEventId,
      table.recipientUserId,
    ),
    // TWO indexes, because the feed has two shapes and they cannot share one.
    //
    // The state-filtered read and the unread count lead with (recipient_user_id, state) — two
    // equality columns — and then walk the (created_at, id) keyset pair. That is the calendar's
    // source shape: filter columns first, ordering pair last.
    index("notification_recipient_user_state_created_index").on(
      table.recipientUserId,
      table.state,
      table.createdAt,
      table.id,
    ),
    // The DEFAULT feed — no state filter, which is what the bell opens on — cannot use the index
    // above for ordering: `state` sits between the equality column and the ordering pair, so SQLite
    // answers it by sorting the member's ENTIRE retained history into a temp B-tree. That is
    // correct, invisible, and gets slower every week, which is the worst combination a read can
    // have. This index puts the ordering pair directly after the equality column so the default
    // page is a bounded walk whose cost is the page size rather than the firm's accumulated data.
    // Both plans are pinned by test/read-bounds.test.ts in @magna-carta/notifications.
    index("notification_recipient_user_created_index").on(
      table.recipientUserId,
      table.createdAt,
      table.id,
    ),
    check(
      "notification_recipient_state_check",
      sql`${table.state} IN ('unread', 'read', 'dismissed')`,
    ),
    // A settled row names when it settled, and an unread one cannot claim to have been. The state
    // column and its instant are two spellings of one fact, and a row where they disagree is a feed
    // entry whose badge and whose history contradict each other.
    check(
      "notification_recipient_read_at_check",
      sql`(${table.state} = 'read') = (${table.readAt} IS NOT NULL)`,
    ),
    check(
      "notification_recipient_dismissed_at_check",
      sql`(${table.state} = 'dismissed') = (${table.dismissedAt} IS NOT NULL)`,
    ),
  ],
);

// One attempt to push a copy OUT of the platform. The in-app feed deliberately gets no row here:
// it is not delivered, it is READ — the recipient row's existence IS the delivery, and there is no
// attempt, no transport failure, no retry, and no address to fail against. Inventing a
// permanently-`sent` in-app row to make the schema look symmetric would store a fact no code could
// ever branch on.
export const notificationDelivery = sqliteTable(
  "notification_delivery",
  {
    id: text("id").primaryKey().$type<NotificationDeliveryId>(), // notificationDelivery_ handle
    notificationRecipientId: text("notification_recipient_id")
      .notNull()
      .$type<NotificationRecipientId>()
      .references(() => notificationRecipient.id),
    // Seeded with the full set from the first migration even though only `email` is ever written
    // today. This is a SQLite CHECK: widening one rebuilds the whole table, and by the time a push
    // or SMS channel lands this table grows with every notification the platform has ever mailed. A
    // value nothing writes costs a byte in a constraint; a rebuild costs a migration that copies
    // every row. `in_app` is present for the same reason and is deliberately never written — see
    // the header above.
    channel: text("channel", {
      enum: ["in_app", "email", "push", "sms", "desktop"],
    }).notNull(),
    state: text("state", { enum: ["pending", "sent", "failed", "suppressed"] })
      .notNull()
      .default("pending"),
    attempts: integer("attempts").notNull().default(0),
    // `suppressed` is a real state rather than an absent row, because "we decided not to email you
    // about this" is a fact a support conversation needs and an absent row cannot express. The
    // reason is a CLOSED LABEL and never a sentence — and `not-visible` records that something was
    // withheld without recording what, which is the difference between an audit trail and an
    // existence oracle.
    suppressedReason: text("suppressed_reason", {
      enum: ["preference", "not-visible", "no-address", "policy"],
    }),
    // Which composed summary carried it. Null for a send that was not part of one.
    digestId: text("digest_id").$type<NotificationDigestId>(),
    dispatchedAt: text("dispatched_at"),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    uniqueIndex("notification_delivery_recipient_channel_unique_index").on(
      table.notificationRecipientId,
      table.channel,
    ),
    // A retry pass walks the not-yet-settled rows.
    index("notification_delivery_state_index").on(table.state, table.createdAt, table.id),
    // A suppression must always name its reason, and a settled non-suppressed row must not carry
    // one. A constraint rather than a convention because the reason is what a support conversation
    // reads, and a null one answers nothing.
    check(
      "notification_delivery_suppressed_reason_check",
      sql`(${table.state} = 'suppressed') = (${table.suppressedReason} IS NOT NULL)`,
    ),
    check("notification_delivery_attempts_nonnegative_check", sql`${table.attempts} >= 0`),
    check(
      "notification_delivery_channel_check",
      sql`${table.channel} IN ('in_app', 'email', 'push', 'sms', 'desktop')`,
    ),
    check(
      "notification_delivery_state_check",
      sql`${table.state} IN ('pending', 'sent', 'failed', 'suppressed')`,
    ),
    check(
      "notification_delivery_suppressed_reason_value_check",
      sql`${table.suppressedReason} IS NULL OR ${table.suppressedReason} IN ('preference', 'not-visible', 'no-address', 'policy')`,
    ),
  ],
);

// Where the next composed summary starts, per recipient per cadence.
//
// The watermark is a KEYSET CURSOR — an instant AND the event id that instant belongs to — never a
// bare timestamp. Two events sharing an instant would straddle a bare-timestamp boundary: one is
// carried and the other silently is not, or both are carried twice. The pair is total.
export const notificationDigestRun = sqliteTable(
  "notification_digest_run",
  {
    id: text("id").primaryKey().$type<NotificationDigestId>(), // notificationDigest_ handle
    recipientUserId: text("recipient_user_id").notNull().$type<UserId>(),
    cadence: text("cadence", { enum: ["daily", "weekly"] }).notNull(),
    lastOccurredAt: text("last_occurred_at"),
    lastEventId: text("last_event_id").$type<NotificationEventId>(),
    lastRunAt: text("last_run_at"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("notification_digest_run_user_cadence_unique_index").on(
      table.recipientUserId,
      table.cadence,
    ),
    check("notification_digest_run_cadence_check", sql`${table.cadence} IN ('daily', 'weekly')`),
    // The watermark is a pair or it is nothing. Half a keyset cursor cannot be walked, and a run
    // that stored only the instant would carry or skip every event sharing it.
    check(
      "notification_digest_run_watermark_pair_check",
      sql`(${table.lastOccurredAt} IS NULL) = (${table.lastEventId} IS NULL)`,
    ),
  ],
);

// What the retention sweep took while it was still unread, per member.
//
// This table exists to keep one promise honest. A notification is a pointer and sweeping one
// destroys no evidence — but a member who was away while thirty deadlines aged out of their feed
// would otherwise open the app to a badge of zero, which is a different claim from "there is
// nothing you missed" and not one the platform is in a position to make. So the sweep records what
// it took from each member instead of dropping the fact on the floor, the unread count surfaces it
// beside the live count, and what it points back at — the matter timeline, the deadline itself, the
// audit log — is all still there, because a notification never was the record. Clearing the tally
// is the same act as marking the live feed read: the member saying they have dealt with what they
// missed.
//
// One row per member, updated in place. It is a TALLY, not a copy of anything swept: a count and
// two instants, and nothing about which notifications they were.
export const notificationSweptUnread = sqliteTable(
  "notification_swept_unread",
  {
    recipientUserId: text("recipient_user_id").primaryKey().$type<UserId>(),
    unreadCount: integer("unread_count").notNull().default(0),
    // The oldest occurrence still represented in the tally, so the member is told how far back the
    // gap reaches rather than only how big it is.
    oldestSweptOccurredAt: text("oldest_swept_occurred_at"),
    lastSweptAt: text("last_swept_at").notNull(),
  },
  (table) => [
    check("notification_swept_unread_count_nonnegative_check", sql`${table.unreadCount} >= 0`),
  ],
);

// What a preference stopped from being written, per member per category per civil day.
//
// A preference system's failure mode is SILENCE: a notification that should have reached somebody
// did not, and nothing anywhere records that a choice is the reason. "Nobody was told" and "this
// person asked not to be told" then look identical afterwards, which is the difference between a
// working setting and a delivery bug nobody can find. So a suppressed in-app notification is not an
// absent row — it is an absent FEED row plus a counted one here.
//
// A TALLY and never a copy. It carries a member, a closed category label, a civil date, and a
// count; it carries no event id, no subject, no matter, and no kind. That is deliberate and not
// timidity: a per-item record of what somebody declined to hear would be a second feed, retained on
// its own clock, holding exactly the pointers the member asked not to be given — and it would
// outlive the access check that justified the notification in the first place. The day-grain answers
// what a support conversation actually asks ("did their settings stop anything last Tuesday, and how
// much"), and the source records the suppressed notifications pointed at are all still where they
// were.
//
// Swept on the firm's own retention window beside the notifications themselves, because a tally that
// outlived the rows it describes would be a growing record of one member's settings with nothing
// left to compare it against.
export const notificationInAppSuppression = sqliteTable(
  "notification_in_app_suppression",
  {
    recipientUserId: text("recipient_user_id").notNull().$type<UserId>(),
    category: text("category", {
      enum: [
        "deadlines",
        "calendar",
        "tasks",
        "trust",
        "billing",
        "documents",
        "custody",
        "email",
        "conflicts",
        "jobs",
        "security",
        "system",
      ],
    }).notNull(),
    // The platform's civil day the fan-out ran on. A date rather than an instant because the
    // question is "how much did this stop, and roughly when", and an instant per suppression would
    // be a row per suppression — which is the per-item record this table exists not to be.
    civilDate: text("civil_date").notNull(),
    suppressedCount: integer("suppressed_count").notNull().default(0),
    // WHOSE choice did it. A member who silenced a category and a member whose firm defaulted it off
    // are in different positions, and only the label tells them apart.
    reason: text("reason", {
      enum: ["member-preference", "firm-policy"],
    }).notNull(),
    lastSuppressedAt: text("last_suppressed_at").notNull(),
  },
  (table) => [
    primaryKey({
      columns: [table.recipientUserId, table.category, table.civilDate, table.reason],
    }),
    check(
      "notification_in_app_suppression_count_nonnegative_check",
      sql`${table.suppressedCount} >= 0`,
    ),
    check(
      "notification_in_app_suppression_category_check",
      sql`${table.category} IN ('deadlines', 'calendar', 'tasks', 'trust', 'billing', 'documents', 'custody', 'email', 'conflicts', 'jobs', 'security', 'system')`,
    ),
    check(
      "notification_in_app_suppression_reason_check",
      sql`${table.reason} IN ('member-preference', 'firm-policy')`,
    ),
  ],
);

// ---------------------------------------------------------------------------------------------
// Natural-language document search — the derived feed, its usage meter, and the firm's consent
// record.
//
// The feature copies the extracted text of a firm's working documents into a managed store and a
// managed search index that this platform cannot name, inspect, enumerate, or partition. These three
// tables are the parts of that arrangement the platform DOES own, and each exists because owning it
// is what makes a claim about the feature demonstrable rather than asserted:
//
//   the feed catalog   — what was copied, and what has been deleted. Deletion is planned from this
//                        table and never from a bucket listing, so an object the catalog does not
//                        know about is a detected inconsistency rather than a silent miss.
//   the usage meter    — what the feature cost, counted from calls the platform itself made, with
//                        the one figure it can only estimate kept in its own columns.
//   the acknowledgement— which version of the disclosure the firm accepted, and who accepted it.
//
// The instance record itself is NOT here: it is control-plane, because it names a resource in the
// platform's own account rather than a fact about the firm's matters.

// One row per object written into the feed. `removed_at` rather than a delete, because "this text
// was copied out and has since been deleted" is exactly the question a firm asks on opt-out, and a
// deleted row answers it with silence.
export const aiSearchFeedObject = sqliteTable(
  "ai_search_feed_object",
  {
    fileId: text("file_id")
      .notNull()
      .$type<FileId>()
      .references(() => file.id),
    // The file's version NUMBER, matching how the keyword index catalog names a version — one fed
    // object per committed version, and a re-feed of the same version overwrites its own object.
    version: integer("version").notNull(),
    // The matter as it stood when the object was fed. It is on the row as well as in the object key
    // because a reassignment rewrites both together, and a row whose matter disagreed with its key
    // is the inconsistency reconciliation exists to find.
    matterId: text("matter_id")
      .notNull()
      .$type<MatterId>()
      .references(() => matter.id),
    objectKey: text("object_key").notNull(),
    byteCount: integer("byte_count").notNull(),
    fedAt: text("fed_at").notNull(),
    removedAt: text("removed_at"),
  },
  (table) => [
    // One live object per document version. The write is an upsert on this key, so a retried feed
    // write converges on one row instead of leaving a second.
    primaryKey({ columns: [table.fileId, table.version] }),
    // The two reads that matter: everything fed for a matter (the deletion plan, and the exclusion
    // flag's teardown), and everything fed since an instant (the pending count in the freshness
    // envelope on every answer).
    index("ai_search_feed_object_matter_id_index").on(table.matterId),
    index("ai_search_feed_object_fed_at_index").on(table.fedAt),
    check("ai_search_feed_object_version_positive_check", sql`${table.version} > 0`),
    check("ai_search_feed_object_byte_count_nonnegative_check", sql`${table.byteCount} >= 0`),
  ],
);

// Per-firm usage of the managed search index, on the same civil-day delta-upsert shape as the token
// meter beside it: the rollup rides the same atomic batch as the operation it counts, so a queue
// redelivery no-ops with it rather than double-counting.
//
// AUTHORITATIVE AND ESTIMATED FIGURES ARE IN DIFFERENT COLUMNS and are rendered differently, which
// is the point of the table's shape. Three of these are exact because the platform makes every one
// of the calls and writes every one of the bytes. The ingestion-token figure is not: the service
// returns no ingestion count to the feed writer, so it is derived from fed bytes at a ratio recorded
// beside it. An estimate labelled an estimate is useful; an estimate presented as a meter is a
// future billing dispute.
//
// MANAGED STORAGE IS NOT METERED AND NOT ESTIMATED. No per-instance storage figure is available, so
// there is no column for it and no guess in place of one — the gap is stated in the usage feed
// rather than filled.
export const aiSearchUsageMeter = sqliteTable(
  "ai_search_usage_meter",
  {
    // One row per civil day, and the DAY is the row. This is a tally updated in place by delta,
    // never an event anybody appends, so a separate handle would let two tallies exist for the same
    // day — the one state a meter must never have to reconcile.
    day: text("day").primaryKey(), // YYYY-MM-DD civil date bucket (UTC)
    // Authoritative: one increment per call the platform made.
    semanticQueryCount: integer("semantic_query_count").notNull().default(0),
    // Authoritative, and INCLUDING the weekly keep-alive. The keep-alive is a real query that a real
    // invoice will charge for, so hiding it here would make the meter disagree with the bill.
    fullTextQueryCount: integer("full_text_query_count").notNull().default(0),
    // Authoritative: the byte count of every object the feed writer put, from the bytes it wrote.
    fedBytes: integer("fed_bytes").notNull().default(0),
    // ESTIMATED. Derived from fed_bytes at the ratio in the next column, never observed.
    estimatedIngestionTokens: integer("estimated_ingestion_tokens").notNull().default(0),
    // The bytes-per-token ratio the estimate above was computed at, recorded so a later correction
    // can be applied to historical rows instead of guessing what they assumed.
    estimatedIngestionBytesPerToken: integer("estimated_ingestion_bytes_per_token")
      .notNull()
      .default(0),
  },
  (table) => [
    check(
      "ai_search_usage_meter_semantic_query_count_check",
      sql`${table.semanticQueryCount} >= 0`,
    ),
    check(
      "ai_search_usage_meter_full_text_query_count_check",
      sql`${table.fullTextQueryCount} >= 0`,
    ),
    check("ai_search_usage_meter_fed_bytes_check", sql`${table.fedBytes} >= 0`),
    check(
      "ai_search_usage_meter_estimated_ingestion_tokens_check",
      sql`${table.estimatedIngestionTokens} >= 0`,
    ),
  ],
);

// The firm's acknowledgement of the disclosure, and the only thing that permits the gate to be
// opened. FIRM-LEVEL, not per-member, which is why there is one row rather than one per user: what
// is being consented to is that the firm's privileged material comes to rest in a store outside the
// firm's own, and that is a judgement about the firm's client agreements rather than a fact each
// member needs telling separately.
//
// The version column is the whole point of the table. When the disclosure changes because the
// feature can do something materially new, the stored version stops matching the current one, the
// gate refuses to stay open on the old acceptance, and the firm is asked again. An acknowledgement
// without a version is an acknowledgement of an unknown thing.
export const aiSearchDisclosureAcknowledgement = sqliteTable(
  "ai_search_disclosure_acknowledgement",
  {
    // A fixed literal, because the row is the firm's and the per-firm database IS the firm. A single
    // named key rather than an auto-increment so the write is a plain upsert with no read first.
    scope: text("scope").primaryKey(),
    disclosureVersion: integer("disclosure_version").notNull(),
    // WHO accepted it. An acknowledgement nobody signed is a record of a click, not of a decision.
    acknowledgedBy: text("acknowledged_by")
      .notNull()
      .$type<UserId>()
      .references(() => member.userId),
    acknowledgedAt: text("acknowledged_at").notNull(),
  },
  (table) => [
    check("ai_search_disclosure_acknowledgement_scope_check", sql`${table.scope} = 'firm'`),
  ],
);

// ---------------------------------------------------------------------------------------------
// The record index — the firm's full-text index over the short text held in its own rows: a note,
// a time narrative, what was said on a call, a task, a Magnus conversation.
//
// It is two tables. This one is the ordinary half: one row per indexed record, saying which
// declared source it came from, which row, which matter and where it sorts. The other half is
// `record_text_fts`, a CONTENTLESS full-text table keyed by this table's `id`, which holds the terms
// and none of the text. It is created by the migration and is not declared here, because a virtual
// table is not something this schema language can describe.
//
// NOTHING WRITES THIS TABLE BUT TRIGGERS. Each declared source carries triggers on its own table
// that remove and re-derive the row's entry in the statement that changed the record, so the index
// is never behind and no write path can forget it. The sources, and the triggers rendered from
// them, live in @magna-carta/search (record-index-sources.ts, record-index-schema.ts).
//
// It is a COPY. Every row can be derived again from the record it points at, so a rebuild loses
// nothing — which is also why the columns below carry no foreign keys: the record's own table is
// what holds its matter to account, and a constraint here could only ever refuse a write to a
// record on the index's behalf.
export const recordTextEntry = sqliteTable(
  "record_text_entry",
  {
    // An integer because the full-text table is keyed by row id. Never shown and never a handle: a
    // rebuild assigns new ones.
    id: integer("id").primaryKey(),
    // The declared source's key. Stored, so a key is permanent once a firm's database holds it.
    source: text("source").notNull(),
    // The indexed row's own identifier in its own table.
    recordId: text("record_id").notNull(),
    // What a reader opens where that is not the row itself — the conversation a turn belongs to.
    containerId: text("container_id"),
    // The matter the record is on, as it stood when the entry was last derived. Null for a record
    // on no matter.
    matterId: text("matter_id").$type<MatterId>(),
    // The order a reader expects this source's records in, as text that sorts: a civil date or an
    // instant.
    sortKey: text("sort_key").notNull(),
  },
  (table) => [
    // One entry per record. Also what a count of the index by source reads.
    uniqueIndex("record_text_entry_source_record_unique").on(table.source, table.recordId),
    // What a container's change walks to find every row under it.
    index("record_text_entry_source_container_index").on(table.source, table.containerId),
  ],
);

// The download register — one member's shelf of what the platform produced for them, held for a
// short retention window and then swept. A SHELF, NOT A HISTORY: "what have I ever downloaded" is an
// audit question `audit_log` already answers under a different key, and nothing here is the firm's
// record — filing an export into a matter stays a separate, audited act producing a real document.
//
// The gap it closes: a bulk bundle is addressed by the content hash of its selection and a
// conversion by its job id, both held only in a Durable Object and an R2 object, so a member who
// closed the tab had no way back to an artifact that sat in the bucket, paid for, until its
// lifecycle rule reaped it.
export const downloadItem = sqliteTable(
  "download_item",
  {
    id: text("id").primaryKey().$type<DownloadItemId>(), // downloadItem_ handle
    // WHOSE SHELF. Every read is scoped to this column, never to the firm alone: a colleague's
    // exports are not the reader's business. A bundle is content-addressed and genuinely shared
    // between two members who selected the same files — the artifact is shared, these rows are not.
    memberId: text("member_id")
      .notNull()
      .$type<UserId>()
      .references(() => member.userId),
    // What the reader sees, composed by the producer from what the member asked for. Never a key.
    title: text("title").notNull(),
    // TWO KINDS, and the distinction decides what "download again" does. An `artifact` points at
    // bytes that cannot be re-derived (a bundle of the firm's own files, a conversion result) and
    // re-downloads as a freshly minted presigned GET. A `snapshot` is an export, and stores the
    // tabular DOCUMENT rather than a rendered file — this platform holds that an export is a
    // document and formats are renderers, so one row serves every format and the figures stay frozen
    // at the instant of the export rather than being recomputed into a different answer.
    // THREE KINDS, and the distinction decides what "download again" does — and, for the third, what
    // it is allowed to do at all.
    //   artifact — bytes the platform built that cannot be re-derived (a bundle, a conversion).
    //     `object_key` points at them and a re-download mints a fresh short-TTL presigned GET.
    //   snapshot — an export, stored as the tabular DOCUMENT rather than a rendered file, so one row
    //     serves every format and the figures stay frozen at the instant it was taken.
    //   reference — a file that lives on a MATTER and was never the register's to hold. It carries
    //     no object key, and a re-download resolves through the files route so the matter's own
    //     access check runs again at fetch time.
    //   record — a download that happened and left nothing to come back to: a bundle streamed
    //     inline, whose bytes were assembled for one response and never retained. It is here so the
    //     register can be COMPLETE without lying — the alternative was either omitting those
    //     downloads, which is the gap this work exists to close, or filing them as an artifact
    //     whose object never existed, which would report "expired" for something that was never
    //     stored. A record offers no download, and the screen says so rather than showing a
    //     control that cannot work.
    //
    // THE THIRD KIND EXISTS TO MAKE A MISTAKE UNREPRESENTABLE. An artifact fetch presigns the stored
    // key with no further check, which is right for a frozen bundle the member already had and wrong
    // for a live matter file: a member screened off a matter afterwards would keep a working handle
    // to it. Modelling the file as an artifact would have put that one `if` away from being a
    // standing hole; modelling it as its own kind means the presigning branch cannot be reached with
    // a matter file at all.
    kind: text("kind", {
      enum: ["artifact", "snapshot", "reference", "record"],
    }).notNull(),
    // WHICH PRODUCER made it — or, for `file`, handed it over. `bundle` and `conversion` were named
    // here from the start with no client able to create one, precisely so that naming them later
    // would not cost a rebuild; `file` was not foreseen and did cost one.
    producer: text("producer", {
      enum: ["export", "bundle", "conversion", "file", "discovery"],
    }).notNull(),
    // For an artifact, the producer's own key under the producer's own prefix, which is what keeps
    // this table a catalog rather than a second store. For a snapshot, this register's own object
    // holding the stored document, swept with the row. NULL for a reference, which holds no bytes of
    // its own — the CHECK below is what stops that null reaching the other two kinds.
    objectKey: text("object_key"),
    // The matter file a reference points at. Deliberately NOT a foreign key: a register row is a
    // record of something that happened, and a file deleted afterwards must not be able to block or
    // cascade into the member's own history. An unresolvable id is reported at fetch time as gone,
    // which is the same answer the member would get from the matter.
    subjectFileId: text("subject_file_id"),
    // Bytes where the producer knows them. Null on a snapshot, whose size is a property of a
    // rendering nobody has asked for yet rather than of the row.
    byteSize: integer("byte_size"),
    // WHAT HAS BEEN TAKEN — format tokens, appended to rather than replaced. The half of the ask a
    // plain list does not answer: a member who can see they already took the Word copy is looking at
    // a shelf, and one who cannot is looking at a pile. Empty means built and never fetched, which is
    // a real and visible state.
    // The format this item was MADE for, distinct from the formats it has been taken in: exporting
    // generates onto the shelf rather than downloading, so the member's choice at the export control
    // has to survive until they come back for it. Null on every row written before the column
    // existed, where the format asked for WAS the format taken.
    requestedFormat: text("requested_format"),
    downloadedFormatsJson: text("downloaded_formats_json").notNull().default("[]"),
    createdAt: text("created_at").notNull(),
    // WHEN THE BYTES LET GO — not when the row does. Written by the producer from one constant so a
    // row and the lifecycle rule over its prefix cannot drift into the register outliving the bytes
    // it points at. NULL on a reference, which has no bytes of the register's to release, and null
    // is what keeps the sweep's range scan from ever selecting one.
    //
    // THE ROW OUTLIVES ITS BYTES, on the owner's ruling of 2026-09-16. The bytes are privileged
    // content in a second place and are worth destroying on a schedule; the row is a title, a
    // producer and two instants, and destroying it only loses the member their own history. So the
    // sweep marks `expired` and takes the object, and the row stays.
    expiresAt: text("expires_at"),
    // `building` is why this is a column rather than a derivation: a bundle is enqueued before its
    // bytes exist, and a member watching a large archive build should see it here rather than wonder
    // whether the request was taken. `failed` is terminal and keeps the row so the outcome is learned
    // instead of the row vanishing. `expired` is written by the sweep, but a read that finds the
    // object already gone reports it without waiting for the sweep to catch up.
    state: text("state", {
      enum: ["building", "ready", "failed", "expired"],
    }).notNull(),
  },
  (table) => [
    // The shelf read: one member's rows, newest first, walked by the (created_at, id) pair so the
    // order is total and a page boundary cannot repeat or drop a row sharing an instant with its
    // neighbour.
    index("download_item_member_created_index").on(table.memberId, table.createdAt, table.id),
    // The sweep's read, across the firm rather than one member. Leading with the expiry is what keeps
    // the daily pass a range scan over the tail rather than a walk of every shelf in the firm.
    index("download_item_expiry_index").on(table.expiresAt, table.state),
    check(
      "download_item_kind_check",
      sql`${table.kind} IN ('artifact', 'snapshot', 'reference', 'record')`,
    ),
    check(
      "download_item_producer_check",
      sql`${table.producer} IN ('export', 'bundle', 'conversion', 'file', 'discovery')`,
    ),
    // The two halves of the third kind, stated as constraints rather than trusted to the writers: a
    // reference names a file and holds no key, and everything else holds a key and names no file.
    // A row that got this wrong would either presign nothing or, far worse, presign a matter file.
    check(
      "download_item_reference_shape_check",
      sql`(${table.kind} = 'reference') = (${table.subjectFileId} IS NOT NULL)`,
    ),
    // Only the two kinds that HOLD bytes may name them. A reference points at a matter file and a
    // record at nothing at all, and neither may carry a key — which is what makes it structurally
    // impossible for either to reach the presigning branch an artifact takes.
    check(
      "download_item_object_key_presence_check",
      sql`(${table.kind} IN ('artifact', 'snapshot')) = (${table.objectKey} IS NOT NULL)`,
    ),
    check(
      "download_item_state_check",
      sql`${table.state} IN ('building', 'ready', 'failed', 'expired')`,
    ),
    check("download_item_title_nonempty_check", sql`length(trim(${table.title})) > 0`),
    check(
      "download_item_object_key_nonempty_check",
      sql`${table.objectKey} IS NULL OR length(trim(${table.objectKey})) > 0`,
    ),
    // A snapshot has no byte size and an artifact's is never negative; zero is a real answer (an
    // empty archive) and stays representable.
    check(
      "download_item_byte_size_check",
      sql`${table.byteSize} IS NULL OR ${table.byteSize} >= 0`,
    ),
  ],
);

// THE INTAKE PROCEDURE: what a kind of matter must clear before it opens, as a firm-authored list of
// steps whose answers come from the subsystems that own the facts.
//
// A firm does not take a matter on the strength of a form. Depending on the kind of matter, it runs
// a conflicts check, agrees a fee, sends an engagement letter, takes a retainer, has the client
// answer a questionnaire, verifies who it is dealing with, and records that it did each of those. The
// list differs by practice area and by firm, so the platform ships the SHAPE and the firm writes the
// list: a procedure names a matter type (or none, for every kind), and holds ordered steps. That is
// the matter plan's model, and the two are deliberately different things: a plan proposes the work
// that follows an opening, an intake procedure gates the opening itself.
//
// A STEP HAS A KIND, AND THE KIND DECIDES WHO ANSWERS. A conflicts-check step is answered by the
// conflicts posture; a fee-agreement step by the billing arrangement in force; a document step by an
// assembly of the referenced template landing on the matter; a retainer step by the matter's trust
// position. Those are READS at the moment somebody asks — nothing here caches a subsystem's answer,
// so a step cannot say "done" after the fact it stood on has changed. A kind with no subsystem behind
// it yet (identity verification, a plain acknowledgement) is answered by a member recording that they
// did it, and every kind ALSO accepts a member's record, because a signed letter that came back on
// paper is a fact the platform did not see. The kind vocabulary is a CHECK so a new kind is a reviewed
// migration, and the reader behind each kind is registered by the composition root rather than by
// this table, which is what lets a kind exist ahead of the subsystem that will one day answer it.
//
// THE PLATFORM SEEDS NO PROCEDURE, on the matter plan's argument: a procedure is a statement about
// how THIS firm practises, and one that shipped with a missing step would be trusted precisely
// because it shipped.
//
// A procedure and its steps soft-deactivate and are never deleted: a record on a matter names the
// step it answered, and a firm asking what its old procedure required needs the row to answer.
export const intakeProcedure = sqliteTable(
  "intake_procedure",
  {
    id: text("id").primaryKey().$type<IntakeProcedureId>(), // intakeProcedure_ handle
    name: text("name").notNull(),
    description: text("description"),
    // Which kind of matter this procedure gates. NULL means every kind — a firm whose intake steps
    // are the same whatever the matter is should not have to author the procedure once per type.
    matterTypeId: text("matter_type_id")
      .$type<MatterTypeId>()
      .references(() => matterType.id),
    active: integer("active").notNull().default(1),
    createdBy: text("created_by").notNull().$type<UserId>(),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    // The read that matters: which procedures bind a consultation of this type.
    index("intake_procedure_matter_type_active_index").on(table.matterTypeId, table.active),
    uniqueIndex("intake_procedure_name_unique_index").on(table.name),
    check("intake_procedure_name_nonempty_check", sql`length(${table.name}) > 0`),
    check("intake_procedure_active_check", sql`${table.active} IN (0, 1)`),
  ],
);

// One step of a procedure. `kind` decides which subsystem answers it (the comment above); `required`
// decides whether an unanswered step refuses the opening or merely shows as outstanding; and
// `reference_id` names the thing a kind is about where it is about one — the document template a
// document or engagement-letter step expects assembled, the custom field a questionnaire step
// expects answered. It is an unvalidated handle on purpose: this table does not know what the axis
// on the other side holds, and the reader for the kind resolves it at the moment of reading.
export const intakeProcedureStep = sqliteTable(
  "intake_procedure_step",
  {
    id: text("id").primaryKey().$type<IntakeProcedureStepId>(), // intakeProcedureStep_ handle
    procedureId: text("procedure_id")
      .notNull()
      .$type<IntakeProcedureId>()
      .references(() => intakeProcedure.id),
    kind: text("kind", {
      enum: [
        "conflicts-check",
        "fee-agreement",
        "engagement-letter",
        "document",
        "questionnaire",
        "retainer",
        "identity-verification",
        "acknowledgement",
        "client-forms",
        "payment",
      ],
    }).notNull(),
    title: text("title").notNull(),
    instructions: text("instructions"),
    required: integer("required").notNull().default(1),
    referenceId: text("reference_id"),
    // The order the authoring surface lists them in and the checklist presents them in. Not unique,
    // on the matter plan's reasoning: the handle is the tiebreak that makes ties harmless.
    position: integer("position").notNull().default(0),
    active: integer("active").notNull().default(1),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    index("intake_procedure_step_procedure_position_index").on(table.procedureId, table.position),
    check("intake_procedure_step_title_nonempty_check", sql`length(${table.title}) > 0`),
    // The kind vocabulary, as a CHECK so an eleventh kind is a reviewed migration rather than a
    // commit. client-forms and payment name two steps a receptionist's intake always has — the forms
    // the client fills in online, and the money that changes hands — ahead of the portal and the
    // payments subsystem that will one day answer them; today each is a member's record.
    check(
      "intake_procedure_step_kind_check",
      sql`${table.kind} IN ('conflicts-check', 'fee-agreement', 'engagement-letter', 'document', 'questionnaire', 'retainer', 'identity-verification', 'acknowledgement', 'client-forms', 'payment')`,
    ),
    check("intake_procedure_step_required_check", sql`${table.required} IN (0, 1)`),
    check("intake_procedure_step_active_check", sql`${table.active} IN (0, 1)`),
  ],
);

// A member's answer to one step on one matter: that they completed it, or that they waived it. The
// record is APPEND-AND-FLIP, never edited in place — reopening a step stamps `superseded_at` on the
// live record and the next answer is a new row — so a step that was recorded done, reopened and
// recorded again keeps all three facts, which is the shape an ethics gate's history has to have. The
// partial unique index holds one LIVE record per step per matter; superseded rows are unconstrained.
//
// A waiver carries a rationale and a completion carries an optional note, held by a CHECK: an
// override of a required step that leaves no reason produces a record that looks like compliance,
// which is worse than no record.
//
// The row names the procedure step, never a copy of it: the step is soft-deactivated rather than
// deleted precisely so this reference keeps resolving.
export const matterIntakeStepRecord = sqliteTable(
  "matter_intake_step_record",
  {
    id: text("id").primaryKey().$type<MatterIntakeStepRecordId>(), // matterIntakeStepRecord_ handle
    matterId: text("matter_id")
      .notNull()
      .$type<MatterId>()
      .references(() => matter.id),
    procedureStepId: text("procedure_step_id")
      .notNull()
      .$type<IntakeProcedureStepId>()
      .references(() => intakeProcedureStep.id),
    outcome: text("outcome", { enum: ["completed", "waived"] }).notNull(),
    rationale: text("rationale"),
    note: text("note"),
    recordedBy: text("recorded_by").notNull().$type<UserId>(),
    recordedAt: text("recorded_at").notNull(),
    supersededAt: text("superseded_at"),
    supersededBy: text("superseded_by").$type<UserId>(),
  },
  (table) => [
    uniqueIndex("matter_intake_step_record_live_unique_index")
      .on(table.matterId, table.procedureStepId)
      .where(sql`${table.supersededAt} IS NULL`),
    index("matter_intake_step_record_matter_index").on(table.matterId, table.recordedAt),
    check(
      "matter_intake_step_record_outcome_check",
      sql`${table.outcome} IN ('completed', 'waived')`,
    ),
    check(
      "matter_intake_step_record_waiver_rationale_check",
      sql`${table.outcome} != 'waived' OR (${table.rationale} IS NOT NULL AND length(${table.rationale}) > 0)`,
    ),
  ],
);

// ---------------------------------------------------------------------------------------------
// In-meeting chat — the meeting's first and only stored content.
// ---------------------------------------------------------------------------------------------

// One thing somebody said in a meeting's chat. The owner's ruling of 2026-09-20 is that chat is KEPT
// ON THE RECORD, which makes this the one table in the subsystem that holds content: everything else
// a meeting knows is identifiers and instants, and the audio, the video and the screen share are
// routed between browsers and reach no storage here at all. So this row carries what a filed message
// carries — a retention basis, a personal-data classification, and a way to take something back.
//
// IT HANGS FROM THE STAY, NOT FROM THE MEMBER. The participant pair is who said it at the time, and
// being in the room is what made it sayable: the speaker is reached through their stay, so somebody
// who dropped off and dialled back in has each message attributed to the stay it was actually said
// in. A user column beside it would be a second answer to who spoke, and the two would disagree the
// first time a stay was corrected.
//
// THE STAY IS NAMED BY VALUE, ACROSS TWO TABLES. A member's stay is a `meeting_attendance` row and a
// guest's will be a `meeting_guest_stay` row, because `meeting_attendance.user_id` is NOT NULL and
// SQLite cannot relax that in place — so a foreign key onto `meeting_attendance` here would bar
// every guest from chat, and adding the second kind afterwards is exactly the table rebuild this
// schema refuses on a table anything references. `participant_kind` says which table the handle
// belongs to and `participant_id` carries it with no foreign key: the matter_party / custody_owner
// precedent for a cross-domain handle. `meeting_id` stays a real foreign key — that is what ties the
// message to the record it is part of.
//
// APPEND-ONLY, NEVER EDITED. A message is a thing somebody said; a record that could be rewritten
// afterwards is not a record of the meeting. Removal is not a delete either — it is the
// redacted_at/redacted_by_user_id pair blanking the body, so the file keeps that a message existed,
// when, from which stay, and that somebody took it back.
export const meetingMessage = sqliteTable(
  "meeting_message",
  {
    id: text("id").primaryKey().$type<MeetingMessageId>(), // meetingMessage_ handle
    meetingId: text("meeting_id")
      .notNull()
      .$type<MeetingId>()
      .references(() => meeting.id),
    // Which kind of stay the handle beside it names: a firm member's `meeting_attendance` row, or
    // the `meeting_guest_stay` row an external guest will hold. Only `member` is written today.
    participantKind: text("participant_kind", {
      enum: ["member", "guest"],
    }).notNull(),
    // The stay, which is both who said it and the proof they were in the room when they did. Carried
    // by value, with no foreign key, because the table it belongs to is decided by the column above.
    participantId: text("participant_id").notNull(),
    // THE SERVER'S INSTANT, never the browser's: a transcript ordered by what each person's own
    // clock said is not one ordering, and the disagreement is invisible in the reading.
    sentAt: text("sent_at").notNull(), // ISO-8601 instant
    // What was said, bounded at four thousand characters. Empty exactly when the row is redacted,
    // which is what the pair of checks below says in both directions.
    body: text("body").notNull(),
    redactedAt: text("redacted_at"), // ISO-8601 instant
    redactedByUserId: text("redacted_by_user_id")
      .$type<UserId>()
      .references(() => member.userId),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    // THE READ AND THE KEYSET IN ONE INDEX: one meeting's messages, oldest first, walked by
    // (sent_at, id). The handle is in the index because it is the tiebreak that makes two messages
    // sent in the same millisecond a stable pair rather than a page that repeats one and skips the
    // other.
    index("meeting_message_meeting_sent_index").on(table.meetingId, table.sentAt, table.id),
    // A removal says who removed it and when, or neither. Half of that pair is a record nobody can
    // question — the line meeting_ended_shape_check already sits on.
    check(
      "meeting_message_redaction_shape_check",
      sql`(${table.redactedAt} IS NULL AND ${table.redactedByUserId} IS NULL)
        OR (${table.redactedAt} IS NOT NULL AND ${table.redactedByUserId} IS NOT NULL)`,
    ),
    // WHAT REDACTION MEANS, held by the database rather than by the write path. A redacted row whose
    // body survived would be a removal that removed nothing, and a live row with an empty body would
    // read as a removal that never happened; both are the same check from opposite sides.
    check(
      "meeting_message_redacted_body_check",
      sql`(${table.redactedAt} IS NULL AND length(${table.body}) > 0)
        OR (${table.redactedAt} IS NOT NULL AND length(${table.body}) = 0)`,
    ),
    // The ceiling, as the database's own answer as well as the domain package's. Four thousand
    // characters is a long message and not an essay; a chat that could carry a document would be a
    // filing path nothing in the subsystem scans.
    check("meeting_message_body_length_check", sql`length(${table.body}) <= 4000`),
    // The participant vocabulary, as a CHECK, so a handle that claims a third kind of stay fails at
    // the database rather than only at the type checker.
    check(
      "meeting_message_participant_kind_check",
      sql`${table.participantKind} IN ('member', 'guest')`,
    ),
  ],
);

// ---------------------------------------------------------------------------------------------
// Polls and questions — the meeting's second and third stored content, on chat's own terms.
// ---------------------------------------------------------------------------------------------

// ONE CLOSED QUESTION A HOST ASKED THE ROOM. A poll is on the record from the moment it opens — the
// question, the options, who answered and what — because a host asked and the room answered, which
// is a thing the meeting produced in exactly the sense a chat message is.
//
// THERE IS NO DRAFT. The row exists because somebody was asked, so `opened_at` is NOT NULL and is
// set at insert. A poll authored before the meeting belongs to the event rather than to the room and
// is a different record; a nullable instant here would be a row saying a poll happened when nobody
// was ever asked.
//
// SEVERAL MAY BE OPEN AT ONCE. One at a time would need a partial unique index and would refuse the
// ordinary case of a host stacking two questions at the end of a briefing.
//
// `breakout_id` names the breakout room a poll was asked in, BY VALUE and with no foreign key, and
// is null for a poll asked of the main room — which is every poll today. It is here before the
// breakout table exists because a column added later is free and a CHECK or a foreign key added
// later is a rebuild of a table other tables point at, which this schema refuses.
export const meetingPoll = sqliteTable(
  "meeting_poll",
  {
    id: text("id").primaryKey().$type<MeetingPollId>(), // meetingPoll_ handle
    meetingId: text("meeting_id")
      .notNull()
      .$type<MeetingId>()
      .references(() => meeting.id),
    // Who asked the room — a member holding a live grant at the instant it opened. A host is always a
    // member, so this is a real foreign key where the answering side is a stay by value.
    askedByUserId: text("asked_by_user_id")
      .notNull()
      .$type<UserId>()
      .references(() => member.userId),
    // What the room was asked, bounded at five hundred characters: a question and not a brief.
    question: text("question").notNull(),
    // Whether the answers are kept without the participant. 0 or 1, and the promise it makes is
    // held by the ANSWER table rather than by a read filter — see `meeting_poll_answer`.
    anonymous: integer("anonymous", { mode: "boolean" }).notNull(),
    // How many options one participation may name. One is an ordinary poll; more is "choose up to".
    maxChoices: integer("max_choices").notNull().default(1),
    openedAt: text("opened_at").notNull(), // ISO-8601 instant
    // Closed says who closed it and when, or neither. A closed poll refuses answers.
    closedAt: text("closed_at"), // ISO-8601 instant
    closedByUserId: text("closed_by_user_id")
      .$type<UserId>()
      .references(() => member.userId),
    // The breakout room this was asked in, by value; null for the main room.
    breakoutId: text("breakout_id"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    // THE READ AND THE KEYSET IN ONE INDEX: one meeting's polls walked by (opened_at, id), the
    // handle breaking the tie between two polls opened in the same millisecond.
    index("meeting_poll_meeting_opened_index").on(table.meetingId, table.openedAt, table.id),
    check("meeting_poll_anonymous_check", sql`${table.anonymous} IN (0, 1)`),
    // Between one and the most options a poll may carry, since a participation can name no more
    // options than exist.
    check("meeting_poll_max_choices_check", sql`${table.maxChoices} BETWEEN 1 AND 10`),
    check(
      "meeting_poll_question_length_check",
      sql`length(${table.question}) > 0 AND length(${table.question}) <= 500`,
    ),
    // A close says who closed it and when, or neither — the line meeting_ended_shape_check sits on.
    check(
      "meeting_poll_closed_shape_check",
      sql`(${table.closedAt} IS NULL AND ${table.closedByUserId} IS NULL)
        OR (${table.closedAt} IS NOT NULL AND ${table.closedByUserId} IS NOT NULL)`,
    ),
  ],
);

// ONE CHOICE A POLL OFFERED — a row rather than a JSON array, and that is the decision worth
// defending. An answer must name an option that EXISTS, and a foreign key is the only thing that
// makes an answer to the seventh option of a four-option poll impossible whoever writes it. The tally
// is a left join from options to answers, which returns every option including the ones nobody
// picked, in `position` order. And a label is content the firm put on a screen, registered in the
// personal-data registry as a column a residue report can address, which a blob's insides are not.
//
// The options never change once a poll is open: there is deliberately no update path.
export const meetingPollOption = sqliteTable(
  "meeting_poll_option",
  {
    id: text("id").primaryKey().$type<MeetingPollOptionId>(), // meetingPollOption_ handle
    pollId: text("poll_id")
      .notNull()
      .$type<MeetingPollId>()
      .references(() => meetingPoll.id),
    // 0-based, the order the room sees.
    position: integer("position").notNull(),
    // What the option says, bounded at two hundred characters.
    label: text("label").notNull(),
  },
  (table) => [
    uniqueIndex("meeting_poll_option_poll_position_unique_index").on(table.pollId, table.position),
    // THE TARGET OF THE ANSWER'S COMPOSITE FOREIGN KEY. An answer names its poll and its option as
    // a pair, and this is what the pair references — so an option belonging to ANOTHER poll fails at
    // the database, not only in the service.
    uniqueIndex("meeting_poll_option_poll_id_unique_index").on(table.pollId, table.id),
    check("meeting_poll_option_position_check", sql`${table.position} BETWEEN 0 AND 9`),
    check(
      "meeting_poll_option_label_length_check",
      sql`length(${table.label}) > 0 AND length(${table.label}) <= 200`,
    ),
  ],
);

// THAT A STAY ANSWERED, AND NOTHING ABOUT WHAT. One row per participation, which is the whole
// ballot-stuffing guard: the unique index allows one participation per stay per poll however many
// options `max_choices` lets it name — which is why this is a table of its own rather than a unique
// index on the answers, where a participant choosing three legitimately has three rows.
//
// It is also the ONE HOME OF WHEN a poll was answered, on both kinds of poll. An instant on the
// answer row would re-link it to this row, written in the same batch, and the anonymity split would
// be cosmetic.
//
// The stay is named BY VALUE across three kinds, on meeting_message's precedent: a member's
// `meeting_attendance`, a guest's `meeting_guest_stay`, and an `attendee` — a webinar's audience,
// which a later slice gives a stay table of its own. The third is in the CHECK now because widening
// a CHECK later is a rebuild of a table other tables point at.
export const meetingPollRespondent = sqliteTable(
  "meeting_poll_respondent",
  {
    id: text("id").primaryKey().$type<MeetingPollRespondentId>(), // meetingPollRespondent_ handle
    pollId: text("poll_id")
      .notNull()
      .$type<MeetingPollId>()
      .references(() => meetingPoll.id),
    participantKind: text("participant_kind", {
      enum: ["member", "guest", "attendee"],
    }).notNull(),
    participantId: text("participant_id").notNull(),
    answeredAt: text("answered_at").notNull(), // ISO-8601 instant
  },
  (table) => [
    uniqueIndex("meeting_poll_respondent_participation_unique_index").on(
      table.pollId,
      table.participantKind,
      table.participantId,
    ),
    check(
      "meeting_poll_respondent_participant_kind_check",
      sql`${table.participantKind} IN ('member', 'guest', 'attendee')`,
    ),
  ],
);

// WHAT WAS CHOSEN, AND — ON A POLL THAT DOES NOT SHOW NAMES — NOTHING ABOUT WHO. The tally is a count
// of these rows; who took part is `meeting_poll_respondent`; neither table can answer the other's
// question. The participant pair is null on every row of an anonymous poll and set on every row of
// an attributed one, held together by the CHECK, and there is deliberately no instant here — see the
// respondent table.
//
// The option is named as the PAIR (poll_id, option_id) against the option table's own unique pair,
// so an answer that names another poll's option fails at the foreign key rather than in the service.
export const meetingPollAnswer = sqliteTable(
  "meeting_poll_answer",
  {
    id: text("id").primaryKey().$type<MeetingPollAnswerId>(), // meetingPollAnswer_ handle
    pollId: text("poll_id")
      .notNull()
      .$type<MeetingPollId>()
      .references(() => meetingPoll.id),
    optionId: text("option_id").notNull().$type<MeetingPollOptionId>(),
    participantKind: text("participant_kind", {
      enum: ["member", "guest", "attendee"],
    }),
    participantId: text("participant_id"),
  },
  (table) => [
    foreignKey({
      name: "meeting_poll_answer_option_fk",
      columns: [table.pollId, table.optionId],
      foreignColumns: [meetingPollOption.pollId, meetingPollOption.id],
    }),
    // The tally: one poll's answers grouped by option.
    index("meeting_poll_answer_poll_option_index").on(table.pollId, table.optionId),
    check(
      "meeting_poll_answer_participant_shape_check",
      sql`(${table.participantKind} IS NULL AND ${table.participantId} IS NULL)
        OR (${table.participantKind} IS NOT NULL AND ${table.participantId} IS NOT NULL)`,
    ),
    check(
      "meeting_poll_answer_participant_kind_check",
      sql`${table.participantKind} IS NULL OR ${table.participantKind} IN ('member', 'guest', 'attendee')`,
    ),
  ],
);

// ONE QUESTION SOMEBODY PUT TO THE ROOM — the chat row with two pairs instead of one, on purpose. A
// question is content said in a meeting, so it takes the redaction pair, the blanked body, the
// append-only rule and the two CHECKs that hold them from both sides, word for word from
// `meeting_message`; a second removal mechanism for the same kind of content would be a second answer
// to what taking something back means. The answered pair is the same shape for the same reason — a
// state change with no actor cannot be questioned — and it is a pair rather than a boolean because
// "answered by whom" is what a firm asks of a queue months later.
//
// The asker is a stay by value, across the same three kinds the poll respondent carries, and
// `breakout_id` is the breakout room it was asked in, by value, null for the main room.
export const meetingQuestion = sqliteTable(
  "meeting_question",
  {
    id: text("id").primaryKey().$type<MeetingQuestionId>(), // meetingQuestion_ handle
    meetingId: text("meeting_id")
      .notNull()
      .$type<MeetingId>()
      .references(() => meeting.id),
    participantKind: text("participant_kind", {
      enum: ["member", "guest", "attendee"],
    }).notNull(),
    participantId: text("participant_id").notNull(),
    // What was asked, bounded at a thousand characters. Empty exactly when the row is redacted.
    body: text("body").notNull(),
    askedAt: text("asked_at").notNull(), // ISO-8601 instant, the server's
    answeredAt: text("answered_at"), // ISO-8601 instant
    answeredByUserId: text("answered_by_user_id")
      .$type<UserId>()
      .references(() => member.userId),
    redactedAt: text("redacted_at"), // ISO-8601 instant
    redactedByUserId: text("redacted_by_user_id")
      .$type<UserId>()
      .references(() => member.userId),
    breakoutId: text("breakout_id"),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    // The read and the keyset in one index, on the transcript's own shape: one meeting's questions
    // walked by (asked_at, id). The panel sorts by upvotes in the browser — a cursor over a value
    // that changes while the reader pages repeats rows and skips rows.
    index("meeting_question_meeting_asked_index").on(table.meetingId, table.askedAt, table.id),
    check(
      "meeting_question_answered_shape_check",
      sql`(${table.answeredAt} IS NULL AND ${table.answeredByUserId} IS NULL)
        OR (${table.answeredAt} IS NOT NULL AND ${table.answeredByUserId} IS NOT NULL)`,
    ),
    check(
      "meeting_question_redaction_shape_check",
      sql`(${table.redactedAt} IS NULL AND ${table.redactedByUserId} IS NULL)
        OR (${table.redactedAt} IS NOT NULL AND ${table.redactedByUserId} IS NOT NULL)`,
    ),
    check(
      "meeting_question_redacted_body_check",
      sql`(${table.redactedAt} IS NULL AND length(${table.body}) > 0)
        OR (${table.redactedAt} IS NOT NULL AND length(${table.body}) = 0)`,
    ),
    check("meeting_question_body_length_check", sql`length(${table.body}) <= 1000`),
    check(
      "meeting_question_participant_kind_check",
      sql`${table.participantKind} IN ('member', 'guest', 'attendee')`,
    ),
  ],
);

// ONE STAY'S VOTE FOR A QUESTION — a row rather than a counter, the mirror of the options decision. A
// counter cannot answer "have I already upvoted this", which the panel asks on every paint to draw
// the control and which is the only thing that stops one person pressing it fifty times; the unique
// index is both that guard and that read. Withdrawal deletes the row, because an upvote you cannot
// take back is a vote and not a signal — and the count is computed over the rows, so there is no
// second home for the number to drift from.
export const meetingQuestionUpvote = sqliteTable(
  "meeting_question_upvote",
  {
    id: text("id").primaryKey().$type<MeetingQuestionUpvoteId>(), // meetingQuestionUpvote_ handle
    questionId: text("question_id")
      .notNull()
      .$type<MeetingQuestionId>()
      .references(() => meetingQuestion.id),
    participantKind: text("participant_kind", {
      enum: ["member", "guest", "attendee"],
    }).notNull(),
    participantId: text("participant_id").notNull(),
    upvotedAt: text("upvoted_at").notNull(), // ISO-8601 instant
  },
  (table) => [
    uniqueIndex("meeting_question_upvote_participation_unique_index").on(
      table.questionId,
      table.participantKind,
      table.participantId,
    ),
    check(
      "meeting_question_upvote_participant_kind_check",
      sql`${table.participantKind} IN ('member', 'guest', 'attendee')`,
    ),
  ],
);

// ---------------------------------------------------------------------------------------------
// Meeting recording — the audio a meeting was recorded with, and the record of who was told.
// ---------------------------------------------------------------------------------------------

// ONE RECORDING OF ONE MEETING: from the moment a member pressed Record to the moment it stopped.
// A stop and a second start are two rows, because each began with its own announcement to the room
// and each has its own consent record beneath it.
//
// THE ROW HOLDS NO AUDIO. The bytes are staged per track in the firm's own bucket and later composed
// into one document filed under the matter; this row is identifiers, instants, counts and a state.
// `matter_id` is denormalized from the meeting's event because a recording can only be filed into a
// matter — a firm event has none, so a firm meeting cannot be recorded at all.
//
// THE VOCABULARIES ARE WHOLE FROM THE FIRST MIGRATION. This is a parent table (its tracks and notices
// point at it), and SQLite cannot widen a CHECK on a parent without the rebuild this lineage refuses
// — so every state and every stop reason the later slices write (composing, filed, a sweep's
// abandoned) is in the CHECK now, before anything writes them.
//
// `breakout_id` names the breakout room a recording was made in, BY VALUE with no foreign key, and is
// null for the main room — which is every recording today. On meeting_poll's precedent: a nullable
// column added before its table exists is free, and one added later is not.
export const meetingRecording = sqliteTable(
  "meeting_recording",
  {
    id: text("id").primaryKey().$type<MeetingRecordingId>(), // meetingRecording_ handle
    meetingId: text("meeting_id")
      .notNull()
      .$type<MeetingId>()
      .references(() => meeting.id),
    matterId: text("matter_id")
      .notNull()
      .$type<MatterId>()
      .references(() => matter.id),
    // The breakout room this was recorded in, by value; null for the main room.
    breakoutId: text("breakout_id"),
    state: text("state", {
      enum: ["recording", "composing", "filed", "failed", "abandoned"],
    }).notNull(),
    // Who pressed Record. Always a member: a guest cannot hold the permission it takes.
    startedByUserId: text("started_by_user_id")
      .notNull()
      .$type<UserId>()
      .references(() => member.userId),
    startedAt: text("started_at").notNull(), // ISO-8601 instant
    // Who stopped it — null when nobody did: every track was lost, or a sweep found the recorder gone.
    stoppedByUserId: text("stopped_by_user_id")
      .$type<UserId>()
      .references(() => member.userId),
    stoppedAt: text("stopped_at"), // ISO-8601 instant
    stopReason: text("stop_reason", {
      enum: [
        "member",
        "host",
        "meeting-ended",
        "sink-lost",
        "ceiling",
        "abandoned",
        "start-failed",
      ],
    }),
    // How many tracks the recording held when it stopped, open, closed and lost alike.
    trackCount: integer("track_count").notNull().default(0),
    // What the composite actually contains, which is not the wall-clock span: a recording never claims
    // more than it captured. Null until the recorder has settled its tracks.
    capturedSeconds: integer("captured_seconds"),
    // The filed audio document, once the compose step has filed it.
    fileId: text("file_id")
      .$type<FileId>()
      .references(() => file.id),
    fileVersionId: text("file_version_id")
      .$type<FileVersionId>()
      .references(() => fileVersion.id),
    // The standard pipeline's Error ID when the recording failed — never a message.
    failureErrorId: text("failure_error_id"),
    // THE COMPOSE STEP'S CURSOR, on the recording it is composing. A recording is mixed into one
    // document a bounded window at a time, one queue message per window, so where it has got to has to
    // outlive each invocation. All of it is handles and counts — no audio, no name:
    //   the upload session the composite is written through (by value — the file pipeline's own row
    //   owns the key and the multipart upload, and this only points at it);
    //   how many parts of the composite have uploaded, which is the cursor;
    //   the parts themselves as R2 hands them back (part number and entity tag, as JSON), which
    //   completing the upload needs and the storage binding cannot list;
    //   how many times a stalled compose has been handed on again, which bounds the retries;
    //   and when it last made progress, which is what a stall is measured from.
    composeUploadSessionId: text("compose_upload_session_id"),
    composePartsDone: integer("compose_parts_done").notNull().default(0),
    composeParts: text("compose_parts"),
    composeAttempts: integer("compose_attempts").notNull().default(0),
    composeProgressAt: text("compose_progress_at"), // ISO-8601 instant
    // When the consumer working on the current window CLAIMED it — a lease, released when the window's
    // progress is recorded, so two deliveries of one message never compose one window at once, and a
    // window being composed is never counted as a stall. Null when nobody holds the window.
    composeClaimedAt: text("compose_claimed_at"), // ISO-8601 instant
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    index("meeting_recording_meeting_started_index").on(table.meetingId, table.startedAt, table.id),
    index("meeting_recording_state_index").on(table.state),
    // ONE RUNNING RECORDING PER ROOM, held by the database. Two members pressing Record together
    // both read "nothing running" a round trip before they write; the second insert is what this
    // refuses. Partial on the running state, because the stopped rows are the record and a room may
    // hold as many as it had presses — and on the main room alone, because NULLs are distinct in a
    // unique index, so a breakout's own recordings take an index of their own when breakouts land.
    uniqueIndex("meeting_recording_one_running_unique_index")
      .on(table.meetingId)
      .where(sql`${table.state} = 'recording' AND ${table.breakoutId} IS NULL`),
    check(
      "meeting_recording_state_check",
      sql`${table.state} IN ('recording', 'composing', 'filed', 'failed', 'abandoned')`,
    ),
    check(
      "meeting_recording_stop_reason_check",
      sql`${table.stopReason} IS NULL
        OR ${table.stopReason} IN ('member', 'host', 'meeting-ended', 'sink-lost', 'ceiling', 'abandoned', 'start-failed')`,
    ),
    // RUNNING MEANS NOT STOPPED, in both directions: a running recording carries no stop, and every
    // other state carries the instant and the reason it stopped. Half of that pair is a record nobody
    // can question — the line meeting_ended_shape_check sits on.
    check(
      "meeting_recording_stopped_shape_check",
      sql`(${table.state} = 'recording' AND ${table.stoppedAt} IS NULL AND ${table.stopReason} IS NULL)
        OR (${table.state} <> 'recording' AND ${table.stoppedAt} IS NOT NULL AND ${table.stopReason} IS NOT NULL)`,
    ),
    check("meeting_recording_track_count_check", sql`${table.trackCount} >= 0`),
  ],
);

// ONE PARTICIPANT'S AUDIO INSIDE ONE RECORDING. The track name is the attribution key every later
// transcript line rests on: a speaker is named because their track was theirs, never because a model
// guessed who was talking.
//
// THE STAY IS NAMED BY VALUE, ACROSS THREE KINDS, on meeting_message's precedent: a member's
// `meeting_attendance`, a guest's `meeting_guest_stay`, and a webinar's `attendee` — so a guest or a
// phone caller can have a track as well as a member. `user_id` is the member behind a member's stay
// and null for anybody else.
//
// A TRACK THE RECORDER COULD NOT HOLD IS STILL A ROW. One whose socket never came back, or one past
// the track ceiling, is `lost` with whatever frames it has — zero for the second — because a record
// that silently omitted a speaker is worse than one that says it could not hear them.
export const meetingRecordingTrack = sqliteTable(
  "meeting_recording_track",
  {
    id: text("id").primaryKey().$type<MeetingRecordingTrackId>(), // meetingRecordingTrack_ handle
    recordingId: text("recording_id")
      .notNull()
      .$type<MeetingRecordingId>()
      .references(() => meetingRecording.id),
    participantKind: text("participant_kind", {
      enum: ["member", "guest", "attendee"],
    }).notNull(),
    participantId: text("participant_id").notNull(),
    userId: text("user_id")
      .$type<UserId>()
      .references(() => member.userId),
    // The routing service's name for the track, which is the attribution key.
    trackName: text("track_name").notNull(),
    // The routing service's handle for the adapter that carries it, which is what closing it takes.
    adapterId: text("adapter_id"),
    // The object this track's audio is staged under in the firm's bucket; null once swept.
    stagingKey: text("staging_key"),
    firstFrameAt: text("first_frame_at"), // ISO-8601 instant
    lastFrameAt: text("last_frame_at"), // ISO-8601 instant
    // WHERE EACH STRETCH OF THE STAGED OBJECT BELONGS IN TIME, as JSON: one entry per stretch, naming the
    // staged sample it begins at, the instant that sample was heard, and — for a stretch the participant
    // left at — the staged sample its audio ends at. A participant who leaves and comes back continues in
    // the same object after the silence that closed it, and that silence is not their absence; the
    // compose places each stretch at its own instant rather than reading the object as one run. Null
    // for a track that never carried a frame, and read as one stretch from `first_frame_at` for a row
    // staged before this column existed.
    segments: text("segments"),
    framesReceived: integer("frames_received").notNull().default(0),
    // Frames the sequence numbers say never arrived, each of which became silence of its own length.
    framesDropped: integer("frames_dropped").notNull().default(0),
    state: text("state", { enum: ["open", "closed", "lost"] }).notNull(),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("meeting_recording_track_name_unique_index").on(table.recordingId, table.trackName),
    index("meeting_recording_track_state_index").on(table.recordingId, table.state),
    check("meeting_recording_track_state_check", sql`${table.state} IN ('open', 'closed', 'lost')`),
    check(
      "meeting_recording_track_participant_kind_check",
      sql`${table.participantKind} IN ('member', 'guest', 'attendee')`,
    ),
    check(
      "meeting_recording_track_frames_check",
      sql`${table.framesReceived} >= 0 AND ${table.framesDropped} >= 0`,
    ),
  ],
);

// ONE OCCASION ON WHICH ONE STAY WAS TOLD — the consent record the owner's ruling makes of the
// announcement. What the SERVER announced to whom, not what a browser rendered: a row says that a
// person in the room at an instant had the frame delivered to their socket, for one of three reasons
// — the recording started, it was running when they arrived, or it stopped.
//
// Identifiers and an instant, and nothing about what anybody said. Written in one batch per fan-out,
// never one write per socket. A reconnect is another arrival and another row, correctly: each is a
// separate occasion on which they were told.
//
// The stay is named BY VALUE across three kinds, as the track's is, so a guest who was told is on the
// record exactly as a member is.
export const meetingRecordingNotice = sqliteTable(
  "meeting_recording_notice",
  {
    id: text("id").primaryKey().$type<MeetingRecordingNoticeId>(), // meetingRecordingNotice_ handle
    recordingId: text("recording_id")
      .notNull()
      .$type<MeetingRecordingId>()
      .references(() => meetingRecording.id),
    participantKind: text("participant_kind", {
      enum: ["member", "guest", "attendee"],
    }).notNull(),
    participantId: text("participant_id").notNull(),
    userId: text("user_id")
      .$type<UserId>()
      .references(() => member.userId),
    reason: text("reason", { enum: ["start", "arrival", "stop"] }).notNull(),
    // The instant the room fanned the frame out — the server's, never a browser's.
    deliveredAt: text("delivered_at").notNull(), // ISO-8601 instant
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    // THE READ AND THE KEYSET IN ONE INDEX: one recording's notices, oldest first, walked by
    // (delivered_at, id).
    index("meeting_recording_notice_delivered_index").on(
      table.recordingId,
      table.deliveredAt,
      table.id,
    ),
    check(
      "meeting_recording_notice_reason_check",
      sql`${table.reason} IN ('start', 'arrival', 'stop')`,
    ),
    check(
      "meeting_recording_notice_participant_kind_check",
      sql`${table.participantKind} IN ('member', 'guest', 'attendee')`,
    ),
  ],
);

// THE TRANSCRIPT OF ONE FILED RECORDING: made per track from each track's staged audio — so every line
// is attributed to the person whose microphone it came from, never to a speaker number a model made up —
// and filed beside the audio as a WebVTT document on the same matter.
//
// THE ROW HOLDS NO CONTENT. The words are the segment rows' and the filed document's; this row is
// handles, counts, instants, a state and the cursor of the work that makes it. A transcript is made a
// bounded window at a time on the recording's own queue, so where it has got to has to outlive each
// invocation: the track it is on (an index into the recording's tracks in their stored order), the
// staged sample of that track the next region begins at, how many segments it has written (the source
// of each one's provisional ordinal), the upload session its document is being filed through, how many
// times a stalled transcript has been handed on again, when it last made progress, and when the
// consumer working on it CLAIMED the window — a lease, so two deliveries of one message never send the
// same audio to the model twice.
//
// A PARENT TABLE, so both vocabularies are whole now: `pending` while it is being made, and the two ways
// it settles — `ready` (and then it names its document) or `failed` (and then it carries an Error ID).
// One transcript per recording, held by the database.
//
// `model_id` and `language` are what the model REPORTED, and are null until it has answered: the speech
// model is the platform's, chosen by the catalog, and a row written before the first answer would have
// to name a model it had not yet heard from.
export const meetingTranscript = sqliteTable(
  "meeting_transcript",
  {
    id: text("id").primaryKey().$type<MeetingTranscriptId>(), // meetingTranscript_ handle
    meetingId: text("meeting_id")
      .notNull()
      .$type<MeetingId>()
      .references(() => meeting.id),
    recordingId: text("recording_id")
      .notNull()
      .$type<MeetingRecordingId>()
      .references(() => meetingRecording.id),
    state: text("state", { enum: ["pending", "ready", "failed"] }).notNull(),
    language: text("language"),
    modelId: text("model_id"),
    segmentCount: integer("segment_count"),
    wordCount: integer("word_count"),
    // SUPERSEDED by `transcribed_milliseconds` and no longer written: each piece's seconds were rounded
    // to a whole number before they were added, so every piece under half a second counted as none.
    // Kept where it stands because the table is a parent and dropping a column is a rebuild.
    transcribedSeconds: integer("transcribed_seconds").notNull().default(0),
    // Milliseconds of audio sent to the speech model, which is what the model is billed by, added up
    // exactly piece by piece.
    transcribedMilliseconds: integer("transcribed_milliseconds").notNull().default(0),
    // The filed WebVTT document, once the transcript is ready.
    fileId: text("file_id")
      .$type<FileId>()
      .references(() => file.id),
    fileVersionId: text("file_version_id")
      .$type<FileVersionId>()
      .references(() => fileVersion.id),
    // The standard pipeline's Error ID when the transcript failed — never a message.
    failureErrorId: text("failure_error_id"),
    cursorTrack: integer("cursor_track").notNull().default(0),
    cursorSample: integer("cursor_sample").notNull().default(0),
    segmentsWritten: integer("segments_written").notNull().default(0),
    // The upload session the document is filed through (by value — the file pipeline's own row owns
    // the key), once the filing has begun.
    uploadSessionId: text("upload_session_id"),
    attempts: integer("attempts").notNull().default(0),
    // How many windows in a row met a speech model that refused for now, with no progress between them:
    // the count a transient outage is outlasted by (each retry backs off further), reset by progress.
    modelFailures: integer("model_failures").notNull().default(0),
    progressAt: text("progress_at"), // ISO-8601 instant
    claimedAt: text("claimed_at"), // ISO-8601 instant
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    // ONE TRANSCRIPT PER RECORDING: the compose writes it in the batch that files the recording, and a
    // second filing of one recording is refused by its own guard before it gets here.
    uniqueIndex("meeting_transcript_recording_unique_index").on(table.recordingId),
    index("meeting_transcript_meeting_index").on(table.meetingId),
    index("meeting_transcript_state_index").on(table.state),
    check("meeting_transcript_state_check", sql`${table.state} IN ('pending', 'ready', 'failed')`),
    // A SETTLED TRANSCRIPT SAYS HOW: a ready one names its document, a failed one carries its Error ID.
    check(
      "meeting_transcript_settled_shape_check",
      sql`(${table.state} <> 'ready' OR ${table.fileId} IS NOT NULL)
        AND (${table.state} <> 'failed' OR ${table.failureErrorId} IS NOT NULL)`,
    ),
    check(
      "meeting_transcript_cursor_check",
      sql`${table.cursorTrack} >= 0 AND ${table.cursorSample} >= 0 AND ${table.segmentsWritten} >= 0
        AND ${table.transcribedSeconds} >= 0 AND ${table.attempts} >= 0`,
    ),
    // Carried by the two columns' own ADD in the migration that added them, which is the only way a
    // CHECK lands on a parent table without a rebuild.
    check("meeting_transcript_model_failures_check", sql`${table.modelFailures} >= 0`),
    check(
      "meeting_transcript_transcribed_milliseconds_check",
      sql`${table.transcribedMilliseconds} >= 0`,
    ),
  ],
);

// ONE LINE OF A TRANSCRIPT: a span of one track's speech with what the speech model heard in it, or a
// GAP the transcript says it could not hear — a track that was lost, one the recording's ceiling refused
// to hold, or one whose audio was not there to read. A gap names whose audio is missing when there is
// somebody to name, and nobody when it covers a recording in which nobody could be heard at all.
//
// THE TEXT IS CONTENT: what somebody said in a meeting on a matter. It is never logged, never in an
// audit row and never in an error payload, and it is registered as content in the personal-data
// registry.
//
// THE STAY IS NAMED BY VALUE, as the track's is — a member's attendance or a guest's stay — beside the
// track it came from and the member behind it, so a guest's words are attributed to the guest exactly as
// a member's are to the member. The name is read off the stay when the transcript is read or filed,
// never stored here.
//
// `ordinal` is the line's place in the transcript, chronological from zero once it is ready. While it is
// pending, each line carries a NEGATIVE provisional ordinal in the order it was written — its place
// among the other tracks' lines is not known until every track is done — and the settle renumbers them
// in one statement. Negative and final ordinals can never collide, which is what lets one UPDATE move
// every line to its place under the unique index.
export const meetingTranscriptSegment = sqliteTable(
  "meeting_transcript_segment",
  {
    id: text("id").primaryKey().$type<MeetingTranscriptSegmentId>(), // meetingTranscriptSegment_ handle
    transcriptId: text("transcript_id")
      .notNull()
      .$type<MeetingTranscriptId>()
      .references(() => meetingTranscript.id),
    ordinal: integer("ordinal").notNull(),
    kind: text("kind", { enum: ["speech", "gap"] }).notNull(),
    trackId: text("track_id")
      .$type<MeetingRecordingTrackId>()
      .references(() => meetingRecordingTrack.id),
    participantKind: text("participant_kind", {
      enum: ["member", "guest", "attendee"],
    }),
    participantId: text("participant_id"),
    userId: text("user_id")
      .$type<UserId>()
      .references(() => member.userId),
    // Milliseconds from the recording's start, on the composite's own timeline.
    startedMs: integer("started_ms").notNull(),
    endedMs: integer("ended_ms").notNull(),
    // What was said; empty on a gap.
    text: text("text").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    uniqueIndex("meeting_transcript_segment_ordinal_unique_index").on(
      table.transcriptId,
      table.ordinal,
    ),
    index("meeting_transcript_segment_started_index").on(table.transcriptId, table.startedMs),
    // THE LAST LINE A TRACK WROTE, which is what the next piece of that track is prompted with.
    index("meeting_transcript_segment_track_index").on(table.trackId, table.ordinal),
    check("meeting_transcript_segment_kind_check", sql`${table.kind} IN ('speech', 'gap')`),
    check(
      "meeting_transcript_segment_participant_kind_check",
      sql`${table.participantKind} IS NULL OR ${table.participantKind} IN ('member', 'guest', 'attendee')`,
    ),
    // A STAY IS NAMED WHOLE OR NOT AT ALL, and speech always belongs to somebody.
    check(
      "meeting_transcript_segment_speaker_shape_check",
      sql`(${table.participantKind} IS NULL) = (${table.participantId} IS NULL)
        AND (${table.kind} <> 'speech' OR ${table.participantId} IS NOT NULL)`,
    ),
    check(
      "meeting_transcript_segment_span_check",
      sql`${table.startedMs} >= 0 AND ${table.endedMs} >= ${table.startedMs}`,
    ),
    check(
      "meeting_transcript_segment_gap_text_check",
      sql`${table.kind} <> 'gap' OR ${table.text} = ''`,
    ),
  ],
);

// THE SUMMARY OF ONE READY TRANSCRIPT: a reasoning model's account of what a recorded meeting covered,
// and the things somebody undertook to do in it. It is the platform's CHARACTERIZATION of a privileged
// conversation rather than the thing that happened, so it is kept as rows beside the record it summarizes
// and is never filed into the matter's documents, where it would read as evidence.
//
// THE TEXT IS DERIVED CONTENT AND WORK PRODUCT: never logged, never in an audit row, never in an error
// payload, and registered as content in the personal-data registry. Every other column is a handle, a
// count, an instant, a closed label or the model that wrote it.
//
// A PARENT TABLE (its action items point at it), so both vocabularies are whole now: `pending` while it is
// being written, `ready` (with its text), `failed` (with an Error ID) or `refused` — and then one of the
// three reasons a summary is not written at all: the firm has summaries switched off (`disabled`), the
// firm's model choice would send the conversation to a third-party model it has not allowed
// (`not-eligible`), or the transcript holds no speech (`transcript-empty`). One summary per transcript,
// held by the database; a member's re-run rewrites it in place.
//
// `model_id` and `snapshot_id` are the model the run was sent to and the snapshot it answered with, null
// until a run reaches a model. The token counts are the provider's own usage, added up across every
// call one run makes (a long transcript is summarized a part at a time and then combined), which is also
// what the firm's token meter is written from. `claimed_at` is the lease one consumer holds while it
// writes the summary, so two deliveries of one message never send the transcript to a model twice;
// `model_failures` counts the runs in a row that met a model refusing for now; `model_failure_call` is the
// call of the last such run (counted from zero) at which it was refused, so a call that is refused again
// after every call before it was answered — a model that is up, and an input it will never take — fails
// the summary instead of being retried; and `retry_at` is when the run a refusal put off is due, so a
// member asking for it in between does not start a second chain of attempts beside the scheduled one.
export const meetingSummary = sqliteTable(
  "meeting_summary",
  {
    id: text("id").primaryKey().$type<MeetingSummaryId>(), // meetingSummary_ handle
    meetingId: text("meeting_id")
      .notNull()
      .$type<MeetingId>()
      .references(() => meeting.id),
    recordingId: text("recording_id")
      .notNull()
      .$type<MeetingRecordingId>()
      .references(() => meetingRecording.id),
    transcriptId: text("transcript_id")
      .notNull()
      .$type<MeetingTranscriptId>()
      .references(() => meetingTranscript.id),
    state: text("state", {
      enum: ["pending", "ready", "failed", "refused"],
    }).notNull(),
    modelId: text("model_id"),
    snapshotId: text("snapshot_id"),
    // What the model wrote, once ready. Derived content.
    summaryText: text("summary_text"),
    inputTokens: integer("input_tokens").notNull().default(0),
    outputTokens: integer("output_tokens").notNull().default(0),
    // How many model calls the run made: one for a transcript that fits, more for one summarized a part
    // at a time and combined.
    modelCalls: integer("model_calls").notNull().default(0),
    refusalReason: text("refusal_reason", {
      enum: ["not-eligible", "disabled", "transcript-empty"],
    }),
    // The standard pipeline's Error ID when the summary failed — never a message.
    failureErrorId: text("failure_error_id"),
    modelFailures: integer("model_failures").notNull().default(0),
    // The call, counted from zero, at which the last run the model refused for now was refused; null
    // while no refusal is counted.
    modelFailureCall: integer("model_failure_call"),
    // When the run a refusal put off is due (ISO-8601 instant); null while none is scheduled.
    retryAt: text("retry_at"),
    claimedAt: text("claimed_at"), // ISO-8601 instant
    // The last claim released, retry scheduled or run settled — what a stalled run is measured from.
    progressAt: text("progress_at"), // ISO-8601 instant
    // The member who asked for the run now on the row; null for the run the platform began itself when
    // the transcript became ready.
    requestedByUserId: text("requested_by_user_id")
      .$type<UserId>()
      .references(() => member.userId),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("meeting_summary_transcript_unique_index").on(table.transcriptId),
    index("meeting_summary_meeting_index").on(table.meetingId),
    index("meeting_summary_recording_index").on(table.recordingId),
    index("meeting_summary_state_index").on(table.state),
    check(
      "meeting_summary_state_check",
      sql`${table.state} IN ('pending', 'ready', 'failed', 'refused')`,
    ),
    check(
      "meeting_summary_refusal_reason_check",
      sql`${table.refusalReason} IS NULL OR ${table.refusalReason} IN ('not-eligible', 'disabled', 'transcript-empty')`,
    ),
    // A SETTLED SUMMARY SAYS HOW: a ready one carries its text, a failed one its Error ID, and a refusal
    // — and only a refusal — its reason.
    check(
      "meeting_summary_settled_shape_check",
      sql`(${table.state} <> 'ready' OR ${table.summaryText} IS NOT NULL)
        AND (${table.state} <> 'failed' OR ${table.failureErrorId} IS NOT NULL)
        AND ((${table.state} = 'refused') = (${table.refusalReason} IS NOT NULL))`,
    ),
    check(
      "meeting_summary_counts_check",
      sql`${table.inputTokens} >= 0 AND ${table.outputTokens} >= 0 AND ${table.modelCalls} >= 0
        AND ${table.modelFailures} >= 0`,
    ),
    check(
      "meeting_summary_model_failure_call_check",
      sql`${table.modelFailureCall} IS NULL OR ${table.modelFailureCall} >= 0`,
    ),
  ],
);

// ONE THING A MEETING'S SUMMARY SAYS SOMEBODY UNDERTOOK TO DO, in the order the summary lists them.
//
// THE TEXT IS DERIVED CONTENT, as the summary's is. `owner_user_id` names a member ONLY when the model
// named a participant by exactly the name the transcript knows them by — a summary guessing who owes what
// is worse than one that leaves it open — and `due_on` is a civil date only when the transcript itself
// stated one. `task_id` is the task a member made of it, through the task subsystem's own create path,
// and is set exactly once.
export const meetingSummaryActionItem = sqliteTable(
  "meeting_summary_action_item",
  {
    id: text("id").primaryKey().$type<MeetingSummaryActionItemId>(), // meetingSummaryActionItem_ handle
    summaryId: text("summary_id")
      .notNull()
      .$type<MeetingSummaryId>()
      .references(() => meetingSummary.id),
    ordinal: integer("ordinal").notNull(),
    text: text("text").notNull(),
    ownerUserId: text("owner_user_id")
      .$type<UserId>()
      .references(() => member.userId),
    dueOn: text("due_on"), // civil date, only when the transcript stated one
    taskId: text("task_id")
      .$type<MatterTaskId>()
      .references(() => matterTask.id),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("meeting_summary_action_item_ordinal_unique_index").on(
      table.summaryId,
      table.ordinal,
    ),
    index("meeting_summary_action_item_task_index").on(table.taskId),
    check(
      "meeting_summary_action_item_shape_check",
      sql`${table.ordinal} >= 0 AND length(${table.text}) > 0`,
    ),
    check("meeting_summary_action_item_due_on_shape_check", civilDateShape(table.dueOn, true)),
  ],
);
