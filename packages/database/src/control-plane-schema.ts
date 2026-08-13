import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";
import type {
  AccountId,
  AuthAuditId,
  CommunityCommentId,
  CommunityFlagId,
  CommunityModerationActionId,
  CommunityPostId,
  CommunityProfileId,
  CommunityVoteId,
  FirmId,
  IdempotencyRecordId,
  InvitationId,
  OutboxId,
  PlatformStaffId,
  RegistrationId,
  SessionId,
  SupportGrantId,
  TwoFactorId,
  UserId,
  VerificationId,
} from "@magna-carta/identifiers/types";
import type { DataRegion } from "./data-region.ts";

// CONTROL-PLANE LINEAGE. The firm registry: one row per tenant firm, in the single control-plane D1.
// This file is the source of truth drizzle-kit generates control-plane migrations from — schema changes
// happen HERE, never by hand-editing SQL.
export const firm = sqliteTable("firm", {
  // The firm_ handle is both primary key and public id.
  id: text("id").primaryKey().$type<FirmId>(),
  // UNIQUE: the firm name is the provisioner's RESUME IDENTITY — a crashed
  // provisioning run re-invoked with the same name must find its own partial row, and firm ids
  // are CSPRNG handles minted per attempt, so the name is the only stable client-supplied handle.
  //
  // For the PLATFORM-ADMIN door this is still the human name the operator typed. For SELF-SERVE
  // registration it is a platform-generated handle (the registration's own id), never anything the
  // stranger chose: a globally UNIQUE human name would refuse the second firm called Smith Law,
  // would let anyone probe for the existence of a named firm by trying to register it, and would
  // make squatting a real firm's name cost one email address. The human name lives in
  // `display_name` beside it, where nothing is unique.
  name: text("name").notNull().unique(),
  // The firm's human-facing name. Null means "the operator-typed `name` above is the display name",
  // which is what every platform-provisioned row is — so this column needs no backfill.
  displayName: text("display_name"),
  // vestigial: per-firm DB is the firmId-addressed FirmDatabase DO; drop in a later control-plane migration
  databaseIdentifier: text("database_identifier").unique(),
  // vestigial: the FirmDatabase DO self-migrates on first access; drop in a later control-plane migration
  perFirmSchemaVersion: text("per_firm_schema_version"),
  // Provisioning lifecycle: the provisioner writes 'provisioning' first and flips to 'active' once
  // the firm's resources exist. The DEFAULT keeps pre-lifecycle rows valid (expand-contract).
  status: text("status").notNull().default("active"),
  // The firm's release channel — which behavior is lit for this tenant. stable (default) is the
  // vetted line; beta is firm-admin opt-in; alpha is a platform-only grant. Channels gate behavior
  // through feature flags, never schema. DEFAULT keeps pre-channel rows valid (expand-contract).
  releaseChannel: text("release_channel").notNull().default("stable"),
  // The per-firm R2 bucket backing this firm. Null = the bucket has not been provisioned yet.
  // UNIQUE: an R2 object-create event names only its bucket, and the ingest consumer turns that name
  // back into a firm with `WHERE bucket_name = ?`. Two firms sharing a name would make that lookup
  // ambiguous — a firm's uploads could be ingested into another firm's per-firm database. The
  // provisioner already mints a deterministic per-firm name; the constraint is what makes the
  // one-name-one-firm assumption the read depends on true. SQLite treats NULLs as distinct, so
  // any number of not-yet-provisioned firms coexist.
  bucketName: text("bucket_name").unique(),
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
  // Firm policy: when true, a PRIVILEGED support grant is created in 'requested' state and needs an
  // admin co-sign before it becomes redeemable. Default false — self-scoping already bounds a
  // privileged session to the requester's own access, so co-sign is opt-in hardening. Promoted into
  // the declarative settings registry later; an interim control-plane column keeps grant creation a
  // single control-plane read.
  supportRequiresCosign: integer("support_requires_cosign", { mode: "boolean" })
    .notNull()
    .default(false),
  // The firm's data-residency region — where its per-firm storage physically lives. `us` (default)
  // is North-America placement; `eu` pins storage to Cloudflare's EU jurisdiction. Immutable after
  // provisioning (a jurisdiction-bound Durable Object id differs from the bare id, so a region change
  // would orphan the firm's data). DEFAULT keeps pre-region rows valid (expand-contract).
  dataRegion: text("data_region").notNull().default("us").$type<DataRegion>(),
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
    // The twoFactor plugin's brute-force lockout pair: a running count of failed TOTP verifications and,
    // once the count crosses the plugin's threshold, the instant the factor is locked until. Better Auth
    // manages both (input: false); the count defaults to 0, lockedUntil is null until a lockout fires.
    failedVerificationCount: integer("failed_verification_count").notNull().default(0),
    lockedUntil: integer("locked_until", { mode: "timestamp_ms" }),
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

// A self-serve registration in flight: what a stranger asked for, before anything they asked for
// exists. Deliberately its OWN table rather than an unverified `user` + `firm` pair, and that is the
// primary anti-abuse control on the open endpoint — a spam run costs exactly one row and touches no
// bucket, no Durable Object, no key mint, and no cron enumeration. It also keeps the `user` table
// free of rows nobody proved control of, so an unconfirmed registration can never collide with a
// later real invitation for the same address.
//
// Nothing here is a secret in the clear: `confirmation_hash` is the SHA-256 of the emailed
// confirmation token, so the control plane cannot hand anyone a working link even if read whole.
export const registration = sqliteTable(
  "registration",
  {
    id: text("id").primaryKey().$type<RegistrationId>(), // registration_ handle
    // Which of the three doors the visitor chose. Only `foundFirm` provisions anything; the other
    // two are recorded so the rate of each is measurable and so a confirmation cannot be replayed
    // against a different door than the one it was issued for.
    role: text("role", { enum: ["foundFirm", "firmMember", "clientOfFirm"] }).notNull(),
    email: text("email").notNull(),
    displayName: text("display_name").notNull(),
    // The firm name the visitor typed, for the `foundFirm` door. It becomes `firm.display_name`,
    // never `firm.name` — see the note on that column.
    firmDisplayName: text("firm_display_name"),
    confirmationHash: text("confirmation_hash").notNull(),
    status: text("status", { enum: ["pending", "confirmed", "expired", "superseded"] }).notNull(),
    expiresAt: text("expires_at").notNull(), // ISO-8601 instant
    confirmedAt: text("confirmed_at"), // ISO-8601 instant; null until the token is presented
    // The firm this registration provisioned, written at confirmation. Not a foreign key: the row
    // is the record of the request and must outlive whatever it created.
    firmId: text("firm_id").$type<FirmId>(),
    createdAt: text("created_at").notNull(), // ISO-8601 instant
  },
  (table) => [
    // The confirmation token is looked up BY ITS HASH and by nothing else, so the index that makes
    // that read a point lookup is also what keeps the read from ever needing the email.
    uniqueIndex("registration_confirmation_hash_unique").on(table.confirmationHash),
    index("registration_email_index").on(table.email),
    index("registration_created_at_index").on(table.createdAt),
  ],
);

// An invitation into a firm — the firm-member door and the client-portal door share one row shape
// because they are redeemed identically and differ only in what the redeemer becomes.
//
// THREE FACTS, ONE STORED VERIFIER. Redemption asks for the code, the last name and the date of
// birth, and the row stores `verifier_hash` = SHA-256 over all three together. There is no column
// holding the last name and none holding the date of birth, so there is no field to compare
// separately and therefore no way for the redemption path to know WHICH of the three was wrong —
// the neutral failure message is a structural property of the schema, not a discipline the handler
// has to keep. (`code_hash` is separate only so a redemption attempt can be counted against the
// invitation it was aimed at; it never decides the outcome on its own.)
export const invitation = sqliteTable(
  "invitation",
  {
    id: text("id").primaryKey().$type<InvitationId>(), // invitation_ handle
    firmId: text("firm_id")
      .notNull()
      .$type<FirmId>()
      .references(() => firm.id),
    // `firmMember` becomes a user of the firm; `clientOfFirm` becomes a portal client of it.
    kind: text("kind", { enum: ["firmMember", "clientOfFirm"] }).notNull(),
    email: text("email").notNull(),
    displayName: text("display_name").notNull(),
    codeHash: text("code_hash").notNull(),
    verifierHash: text("verifier_hash").notNull(),
    status: text("status", { enum: ["pending", "redeemed", "revoked"] }).notNull(),
    // The per-invitation attempt ladder. An IP-keyed limit alone cannot stop a patient attacker
    // walking a date of birth from many addresses, so the budget is also spent per invitation.
    attemptCount: integer("attempt_count").notNull().default(0),
    lockedUntil: text("locked_until"), // ISO-8601 instant; null while attempts remain
    expiresAt: text("expires_at").notNull(), // ISO-8601 instant
    redeemedAt: text("redeemed_at"), // ISO-8601 instant
    redeemedUserId: text("redeemed_user_id").$type<UserId>(),
    invitedByUserId: text("invited_by_user_id").notNull().$type<UserId>(),
    createdAt: text("created_at").notNull(), // ISO-8601 instant
  },
  (table) => [
    uniqueIndex("invitation_code_hash_unique").on(table.codeHash),
    index("invitation_firm_id_index").on(table.firmId),
    index("invitation_email_index").on(table.email),
  ],
);

// Platform support staff — named human (later: agent) principals who redeem support grants. Separate
// from firm `user` (every user belongs to exactly one firm; staff belong to none). Self-service staff
// login + MFA is built later; until then rows are seeded and the redeem route is platform-admin-gated.
export const platformStaff = sqliteTable("platform_staff", {
  id: text("id").primaryKey().$type<PlatformStaffId>(), // platformStaff_ handle
  email: text("email").notNull().unique(),
  displayName: text("display_name").notNull(),
  // 'support' may redeem diagnostic grants; 'support_lead' additionally may redeem privileged grants.
  role: text("role", { enum: ["support", "support_lead"] }).notNull(),
  status: text("status", { enum: ["active", "disabled"] })
    .notNull()
    .default("active"),
  createdAt: text("created_at").notNull(), // ISO-8601 instant
});

// Support grant — one row per firm member's request for help-desk access. The request IS the consent;
// there is no staff-initiated path. A grant is redeemable only while status='active' AND now<=expires_at.
export const supportGrant = sqliteTable(
  "support_grant",
  {
    id: text("id").primaryKey().$type<SupportGrantId>(), // supportGrant_ handle
    firmId: text("firm_id")
      .notNull()
      .$type<FirmId>()
      .references(() => firm.id),
    // The firm member who requested help — the consent anchor and the privileged-tier authority source.
    requestedByUserId: text("requested_by_user_id").notNull().$type<UserId>(),
    tier: text("tier", { enum: ["diagnostic", "privileged"] }).notNull(),
    scope: text("scope", { enum: ["self"] })
      .notNull()
      .default("self"),
    status: text("status", {
      enum: ["requested", "active", "revoked", "expired", "closed"],
    }).notNull(),
    reason: text("reason"), // non-privileged free text
    // The staff principal that redeemed the grant (null until first redeemed).
    principalId: text("principal_id").$type<PlatformStaffId>(),
    requiresCosign: integer("requires_cosign", { mode: "boolean" }).notNull().default(false),
    cosignedByUserId: text("cosigned_by_user_id").$type<UserId>(),
    expiresAt: text("expires_at").notNull(), // ISO-8601 instant; hard time-box
    createdAt: text("created_at").notNull(), // ISO-8601 instant
  },
  (table) => [index("support_grant_firm_id_index").on(table.firmId)],
);

// A platform operator: an elevated Better Auth user who may author global service status. A
// distinct platform axis from per-firm RBAC and from platform_staff (the reach-into-a-firm
// support identity). Seeded by hand until a self-service management surface exists; expires_at
// mirrors direct_grant time-boxing (NULL = standing).
export const platformOperator = sqliteTable("platform_operator", {
  userId: text("user_id")
    .primaryKey()
    .$type<UserId>()
    .references(() => user.id),
  grantedAt: text("granted_at").notNull(),
  grantedByUserId: text("granted_by").notNull().$type<UserId>(),
  expiresAt: text("expires_at"),
  note: text("note"),
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

// The control-plane token -> firm routing index for the forward/CC capture zone. The Email Worker
// (apps/email-worker) receives mail on a SINGLE zone-level catch-all (`*@in.magnacarta.esq`) — the only
// catch-all shape Cloudflare Email Routing supports — and holds no per-firm database handle, so it
// resolves the local-part token to a firm HERE, then hands the token to the capture consumer, which
// resolves it to a candidate matter against that firm's own email_capture_address store. Minted and
// revoked alongside the per-firm email_capture_address row under emails:manageCaptureAddresses; the token
// is opaque and server-minted, never client-derived. A revoked token stops routing the instant `active`
// flips false, with no per-firm read.
export const emailCaptureRoute = sqliteTable(
  "email_capture_route",
  {
    // The opaque routing token IS the identity of a route: the Email Worker looks a route up by the local
    // part it parsed, and rotation revokes this row and inserts a fresh token. A natural-key PK, the same
    // idiom as `setting` keyed by its key — no separate handle would earn its keep here.
    token: text("token").primaryKey(),
    firmId: text("firm_id")
      .notNull()
      .$type<FirmId>()
      .references(() => firm.id),
    active: integer("active", { mode: "boolean" }).notNull().default(true),
    createdAt: text("created_at").notNull(), // ISO-8601 instant
    revokedAt: text("revoked_at"), // ISO-8601 instant; null while the token still routes
  },
  (table) => [index("email_capture_route_firm_id_index").on(table.firmId)],
);

// THE COMMUNITY BOARD — the platform's one deliberately cross-firm surface.
//
// Every other table in this repository is either per-firm (physically isolated, one database per
// tenant) or platform machinery nobody outside the platform reads. These tables are neither: a post
// written by a member of one firm is read by members of every other firm and by the public, and a
// vote total is an aggregate over all of them. They live in the control plane because that is the
// platform-level lineage and because a write has to be joined to the `user` and `firm` rows above to
// know whether the author may post at all; there is no per-firm database in the picture, and the
// worker that serves this board (apps/community-worker) binds no per-firm resource, so a firm's own
// matters, ledgers, and documents are unreachable from the board rather than merely un-queried.
//
// TWO RULES BIND EVERY COLUMN BELOW, and they are why the shape looks the way it does:
//
//   1. `firm_id` is written on every authored row and RENDERED NOWHERE. It exists so a request can
//      be ranked by how many DISTINCT firms want it (rather than by how many seats one firm has),
//      so writes can be rate-limited per firm, and so a report threshold can be bounded per firm.
//      It is captured at write time on purpose: firm membership changes, so it cannot be recovered
//      later from the author's account. The read projections in @magna-carta/community have no
//      field for it, which is what stops a handler leaking it by forgetting.
//   2. Nothing here may carry firm business data. There is no matter, client, ledger, document, or
//      per-firm identifier of any kind on this board, and the detector that looks for such content
//      in a post body works on FORMAT alone — it never consults a firm's own records, because
//      reaching into the author's Directory to check a name would be exactly the cross-firm read
//      this surface is built to avoid.

// One account's board identity — deliberately a record of its own rather than columns on `user`.
// The name shown on the board is never the account's own `name` column: a member may carry a
// board pseudonym without renaming themselves everywhere else, and the account name can be
// corrected without silently changing what every historical post is signed with. `id` is also the
// author reference a reader sees, so the account's `user` handle never reaches a public read.
export const communityProfile = sqliteTable(
  "community_profile",
  {
    id: text("id").primaryKey().$type<CommunityProfileId>(), // communityProfile_ handle
    userId: text("user_id")
      .notNull()
      .$type<UserId>()
      .references(() => user.id, { onDelete: "cascade" }),
    // The firm the account belonged to when the profile was created. Held for moderation; never
    // rendered. A post captures its own firm again at write time, because this one can go stale.
    firmId: text("firm_id")
      .notNull()
      .$type<FirmId>()
      .references(() => firm.id),
    displayName: text("display_name").notNull(),
    // Whether the display name is a self-chosen handle rather than the member's real name. Recorded
    // because the choice is made once at the ACCOUNT level and never per post — a per-post choice
    // would make non-disclosure itself a signal, since a reader could ask why this one was hidden.
    isPseudonym: integer("is_pseudonym", { mode: "boolean" }).notNull().default(false),
    // 'none' for an ordinary member; 'staff' for the platform's own people. The badge is what
    // supplies credibility that a display name cannot, and it is the only anti-impersonation
    // control on the board — display names are not unique, and making them unique would leak
    // which names are already taken.
    badge: text("badge", { enum: ["none", "staff"] })
      .notNull()
      .default("none"),
    // A brand-new profile's first post and first comment are held for review; after one approval the
    // account writes freely. Null means nothing has been approved yet.
    firstWriteApprovedAt: text("first_write_approved_at"), // ISO-8601 instant
    // Set when an operator bars the account from writing. A barred account can still read; the board
    // is public to read, so removing read access would achieve nothing.
    writeBarredAt: text("write_barred_at"), // ISO-8601 instant
    createdAt: text("created_at").notNull(), // ISO-8601 instant
    updatedAt: text("updated_at").notNull(), // ISO-8601 instant
  },
  (table) => [
    // One board identity per account: the profile is looked up by the session's user on every write.
    uniqueIndex("community_profile_user_id_unique").on(table.userId),
    index("community_profile_firm_id_index").on(table.firmId),
  ],
);

// One post: a request ("the product should do X") or a question ("how do I do X"). One board, two
// kinds, because a question that turns out to be a missing capability is converted to a request in
// one action and carries its thread with it — which it could not do across two tables.
export const communityPost = sqliteTable(
  "community_post",
  {
    id: text("id").primaryKey().$type<CommunityPostId>(), // communityPost_ handle
    // The human-facing number in the post's permanent URL, drawn from the counter pair below rather
    // than from a row count. A row identifier in a public URL would publish how much traffic the
    // board has, and a URL cannot be changed once it is in someone's bookmarks.
    number: integer("number").notNull(),
    slug: text("slug").notNull(),
    kind: text("kind", { enum: ["request", "question"] }).notNull(),
    // A product area, always. There is deliberately no general category and no off-topic category:
    // the composer refuses a post without one, so every author is asked which part of the software
    // this is about before they write a word. That question is the board's primary confidentiality
    // control, because a practice-advice question has nowhere to go. The closed set lives in
    // packages/community/src/categories.ts.
    category: text("category").notNull(),
    title: text("title").notNull(),
    // The body has exactly ONE home, which is what makes an author's delete a single write that
    // completes instantly rather than an erasure spread across caches and copies. Nothing else in
    // this schema stores post prose, and there is no edit-history table: a member who edits an
    // over-identifying post must not leave the original readable behind them.
    body: text("body").notNull(),
    authorProfileId: text("author_profile_id")
      .notNull()
      .$type<CommunityProfileId>()
      .references(() => communityProfile.id),
    // The account and the firm AS AT the write. Deliberately not foreign keys and deliberately
    // denormalized: both are the facts moderation and ranking need about the moment of authorship,
    // and membership changes would silently rewrite history if they were followed live.
    authorUserId: text("author_user_id").notNull().$type<UserId>(),
    authorFirmId: text("author_firm_id").notNull().$type<FirmId>(),
    // The request pipeline. NULL is the whole meaning of "this is a question": a question has no
    // roadmap position, so this is an absent field rather than a nullable one waiting to be filled.
    // A write of a status onto a question is refused in the data-access layer.
    //
    // There is NO target-date column, and its absence is deliberate rather than an omission: the
    // cheapest thing to build is the thing not built, and a nullable date column gets populated,
    // after which it is a promise to a customer.
    status: text("status", {
      enum: [
        "future",
        "planned",
        "building_now",
        "beta",
        "completed",
        "not_on_the_roadmap",
        "duplicate",
      ],
    }),
    // Declining is never a bare status: a reason from the closed set plus prose is required, because
    // a status used to close a conversation rather than to describe reality teaches readers to
    // distrust every other status on the board.
    declineReason: text("decline_reason", {
      enum: [
        "out_of_scope",
        "conflicts_with_confidentiality",
        "already_possible",
        "too_few_firms_affected",
        "superseded_by_other_work",
      ],
    }),
    declineNote: text("decline_note"),
    // Set with status 'duplicate'. The merge carries this post's votes to the target.
    duplicateOfPostId: text("duplicate_of_post_id").$type<CommunityPostId>(),
    // The accepted answer on a question, which floats to the top of its category.
    acceptedCommentId: text("accepted_comment_id").$type<CommunityCommentId>(),
    // Denormalized counters. voteCount is every upvote; distinctFirmVoteCount is how many separate
    // firms are represented in them, which is the number ranking actually uses — one firm with forty
    // seats must not outrank forty firms with one apiece. Both are maintained in the same batch as
    // the vote row, whose unique constraint is the real guard.
    voteCount: integer("vote_count").notNull().default(0),
    distinctFirmVoteCount: integer("distinct_firm_vote_count").notNull().default(0),
    commentCount: integer("comment_count").notNull().default(0),
    // What a reader may see. 'pending_first_write_review' holds a brand-new account's first post
    // until a human approves it. 'hidden' is the remove-first posture: a post suspected of carrying
    // client detail is hidden the instant it is suspected and restored if the review clears it,
    // because the two errors are not symmetric — a false positive costs a member a wait, and a false
    // negative is a permanent disclosure of a client relationship. 'deleted_by_author' and 'removed'
    // are terminal.
    visibility: text("visibility", {
      enum: ["pending_first_write_review", "published", "hidden", "removed", "deleted_by_author"],
    })
      .notNull()
      .default("pending_first_write_review"),
    hiddenReason: text("hidden_reason", {
      enum: ["confidentiality_report", "confidentiality_detector", "spam_reports", "operator"],
    }),
    createdAt: text("created_at").notNull(), // ISO-8601 instant
    updatedAt: text("updated_at").notNull(), // ISO-8601 instant
    // The last vote or comment. Drives the twelve-month auto-archive, which archives and never
    // deletes.
    lastActivityAt: text("last_activity_at").notNull(), // ISO-8601 instant
    archivedAt: text("archived_at"), // ISO-8601 instant
  },
  (table) => [
    // The number is the public URL, so it is unique by construction as well as by the allocation row.
    uniqueIndex("community_post_number_unique").on(table.number),
    // The board's own list read: a category page, newest or most-wanted first, published only.
    index("community_post_category_index").on(table.category, table.visibility, table.status),
    index("community_post_kind_created_at_index").on(table.kind, table.createdAt),
    index("community_post_last_activity_index").on(table.lastActivityAt),
    // "What has this member written" — the author's own view, and the moderation sweep over an
    // account whose first post was just refused.
    index("community_post_author_profile_index").on(table.authorProfileId),
    index("community_post_status_index").on(table.status),
  ],
);

// One account's single upvote of one post. Upvote only: there is no downvote, because a board where
// a request can be voted down measures argument rather than demand.
export const communityVote = sqliteTable(
  "community_vote",
  {
    id: text("id").primaryKey().$type<CommunityVoteId>(), // communityVote_ handle
    postId: text("post_id")
      .notNull()
      .$type<CommunityPostId>()
      .references(() => communityPost.id, { onDelete: "cascade" }),
    profileId: text("profile_id")
      .notNull()
      .$type<CommunityProfileId>()
      .references(() => communityProfile.id),
    // As at the vote, for the same reason the post captures them: this is the pair the ranking and
    // the moderation record need, and neither survives a membership change if followed live.
    userId: text("user_id").notNull().$type<UserId>(),
    firmId: text("firm_id").notNull().$type<FirmId>(),
    createdAt: text("created_at").notNull(), // ISO-8601 instant
  },
  (table) => [
    // The whole of vote correctness: one account, one vote, enforced by the database rather than by
    // a read-then-write in a handler. A losing concurrent insert aborts its own batch.
    uniqueIndex("community_vote_post_user_unique").on(table.postId, table.userId),
    // The distinct-firm recount reads exactly this pair; it never reads who voted.
    index("community_vote_post_firm_index").on(table.postId, table.firmId),
    index("community_vote_profile_index").on(table.profileId),
  ],
);

// One reply on a post. On a question these are the answers, and they are what gets voted on rather
// than the question itself.
export const communityComment = sqliteTable(
  "community_comment",
  {
    id: text("id").primaryKey().$type<CommunityCommentId>(), // communityComment_ handle
    postId: text("post_id")
      .notNull()
      .$type<CommunityPostId>()
      .references(() => communityPost.id, { onDelete: "cascade" }),
    authorProfileId: text("author_profile_id")
      .notNull()
      .$type<CommunityProfileId>()
      .references(() => communityProfile.id),
    authorUserId: text("author_user_id").notNull().$type<UserId>(),
    authorFirmId: text("author_firm_id").notNull().$type<FirmId>(),
    // One home, same rule as the post body, for the same reason: an author's delete is one write.
    body: text("body").notNull(),
    // An official reply from the platform, rendered distinctly. Set by the route from the operator
    // record, never by the author.
    isOperatorResponse: integer("is_operator_response", { mode: "boolean" })
      .notNull()
      .default(false),
    visibility: text("visibility", {
      enum: ["pending_first_write_review", "published", "hidden", "removed", "deleted_by_author"],
    })
      .notNull()
      .default("pending_first_write_review"),
    hiddenReason: text("hidden_reason", {
      enum: ["confidentiality_report", "confidentiality_detector", "spam_reports", "operator"],
    }),
    createdAt: text("created_at").notNull(), // ISO-8601 instant
    updatedAt: text("updated_at").notNull(), // ISO-8601 instant
  },
  (table) => [
    index("community_comment_post_index").on(table.postId, table.visibility, table.createdAt),
    index("community_comment_author_profile_index").on(table.authorProfileId),
  ],
);

// One reader's report about one post or comment.
//
// THE TWO REASONS ARE NOT THE SAME MECHANISM, and that asymmetry is the point of the table. A spam
// or abuse report needs several, from several different firms, before it hides anything — which
// bounds report abuse using the firm identifier the ranking already carries. A CONFIDENTIALITY
// report hides the subject on the first one, from anybody signed in, because waiting for a second
// reader to agree that a post names a client is waiting for the disclosure to be read twice.
export const communityFlag = sqliteTable(
  "community_flag",
  {
    id: text("id").primaryKey().$type<CommunityFlagId>(), // communityFlag_ handle
    subjectKind: text("subject_kind", { enum: ["post", "comment"] }).notNull(),
    // The post or comment handle. Deliberately not a foreign key: one column cannot reference two
    // tables, and the report must outlive a subject that gets removed.
    subjectId: text("subject_id").notNull(),
    reason: text("reason", { enum: ["confidentiality", "spam", "abuse"] }).notNull(),
    note: text("note"),
    reporterUserId: text("reporter_user_id").notNull().$type<UserId>(),
    reporterFirmId: text("reporter_firm_id").notNull().$type<FirmId>(),
    status: text("status", { enum: ["open", "upheld", "cleared"] })
      .notNull()
      .default("open"),
    createdAt: text("created_at").notNull(), // ISO-8601 instant
    resolvedAt: text("resolved_at"), // ISO-8601 instant
    resolvedByUserId: text("resolved_by_user_id").$type<UserId>(),
  },
  (table) => [
    // One report per reader per subject. Without this a single account could manufacture the
    // distinct-firm threshold by reporting the same post repeatedly.
    uniqueIndex("community_flag_subject_reporter_unique").on(table.subjectId, table.reporterUserId),
    index("community_flag_subject_index").on(table.subjectId, table.status),
    index("community_flag_status_created_at_index").on(table.status, table.createdAt),
  ],
);

// The append-only record of what was done to a post or a comment. Every hide, restore, removal,
// status change, conversion and merge lands here, including the ones no human performed: an
// automatic hide raised by the format detector has a null actor, which is exactly how the record
// distinguishes "the platform hid this at 3am" from "the owner hid this at 9am".
export const communityModerationAction = sqliteTable(
  "community_moderation_action",
  {
    id: text("id").primaryKey().$type<CommunityModerationActionId>(), // communityModerationAction_ handle
    subjectKind: text("subject_kind", { enum: ["post", "comment"] }).notNull(),
    subjectId: text("subject_id").notNull(),
    action: text("action", {
      enum: [
        "approved_first_write",
        "hidden",
        "restored",
        "removed",
        "status_changed",
        "converted_to_request",
        "merged_as_duplicate",
        "archived",
        "write_barred",
      ],
    }).notNull(),
    // Null when the platform acted on its own — the format detector's automatic hide, or the
    // scheduled archive sweep.
    actorUserId: text("actor_user_id").$type<UserId>(),
    // Non-privileged: an enum-shaped label and the operator's own prose. Never the subject's body.
    reason: text("reason"),
    note: text("note"),
    createdAt: text("created_at").notNull(), // ISO-8601 instant
  },
  (table) => [
    index("community_moderation_action_subject_index").on(table.subjectId, table.createdAt),
    index("community_moderation_action_created_at_index").on(table.createdAt),
  ],
);

// The post-number sequence. Two tables rather than one because the guarded increment is not the
// guard: a zero-row UPDATE is not an error in SQLite, so two concurrent drawers would both commit
// believing they hold the same value. The allocation row's primary key is what aborts the loser's
// batch and sends it back to re-read the advanced counter. Shape and statements:
// packages/sequence-numbering/src/counter-statements.ts.
export const communityPostNumberCounter = sqliteTable("community_post_number_counter", {
  scopeKey: text("scope_key").primaryKey(),
  nextValue: integer("next_value").notNull(),
});

export const communityPostNumberAllocation = sqliteTable(
  "community_post_number_allocation",
  {
    scopeKey: text("scope_key").notNull(),
    drawnValue: integer("drawn_value").notNull(),
    postId: text("post_id")
      .notNull()
      .$type<CommunityPostId>()
      .references(() => communityPost.id, { onDelete: "cascade" }),
    allocatedAt: text("allocated_at").notNull(), // ISO-8601 instant
  },
  (table) => [
    // The composite primary key IS the concurrency control described above.
    uniqueIndex("community_post_number_allocation_pk").on(table.scopeKey, table.drawnValue),
  ],
);
