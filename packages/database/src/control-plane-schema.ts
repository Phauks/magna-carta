import { check, index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";
import type {
  AccountId,
  AuthAuditId,
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
  // The name as it is printed and sorted. Better Auth writes and reads this column, so it stays
  // required — but where the parts below are present it is RENDERED from them rather than typed,
  // and the two are written in one statement so they cannot drift.
  name: text("name").notNull(),
  // The parts a person's name is actually made of, mirroring directory_person's five columns
  // because a member is a person and the platform should not hold two answers to what one is.
  // All nullable: a row written before a person said what their parts are keeps exactly the name
  // it had, and nothing is split on a guess. `name_prefix` and `name_suffix` hold a LINE rather
  // than one word — "III, Esq." is one person's suffix — because several honorifics is ordinary.
  namePrefix: text("name_prefix"),
  nameGiven: text("name_given"),
  nameMiddle: text("name_middle"),
  nameFamily: text("name_family"),
  nameSuffix: text("name_suffix"),
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
  // OUR additional field: the one tenant firm this person belongs to — NULL while they belong to
  // none. An account is created before it has a firm (the joining surface makes a person first and
  // resolves what they are afterwards), so "no firm yet" has to be representable; NULL is the
  // honest representation, and it is the one that fails CLOSED. A surface that forgets to ask
  // resolves no firm and answers the reserved cross-firm 404 rather than resolving somebody else's
  // firm — see the firmless-session admission in apps/api-worker/src/http/chokepoint/chokepoint.ts.
  firmId: text("firm_id")
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
    // `account` is the door the joining surface sends today — it registers a PERSON, and which firm
    // they belong to is settled afterwards, signed in. The other three are the superseded role fork,
    // kept so a registration started before the reflow still completes.
    role: text("role", { enum: ["account", "foundFirm", "firmMember", "clientOfFirm"] }).notNull(),
    email: text("email").notNull(),
    displayName: text("display_name").notNull(),
    // The two parts the joining screen already asks for separately. Carried through so an account
    // created from today has real name parts from its first moment; nullable, so a registration in
    // flight across the deploy still confirms on its display name alone.
    nameGiven: text("name_given"),
    nameFamily: text("name_family"),
    // The password the visitor CHOSE, in Better Auth's own scrypt format — a verifier, never a
    // password. Spending the confirmation token moves it onto the credential `account` row the same
    // batch creates, which is what lets somebody sign in with the password they picked instead of
    // being sent a second mail to set one. Null only for a registration written before the column
    // existed, which confirms the account-less way it was started under.
    credentialHash: text("credential_hash"),
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

// The platform's own catalog of which firms have a managed natural-language search instance.
//
// CONTROL-PLANE, and one row per firm, because the instance is a resource in the platform's account
// rather than a fact about the firm's matters — and because this row, not the service, is the
// authority on what exists. Nothing ever calls the service's list operation to learn which firms
// have instances, for the same reason the keyword index keeps a split catalog rather than listing a
// bucket prefix: asking the service makes it the authority on a fact the platform owns, and makes an
// outage indistinguishable from a firm having no instance.
export const aiSearchInstance = sqliteTable(
  "ai_search_instance",
  {
    // One instance per firm, so the firm IS the key. A natural-key primary key, the same idiom as the
    // capture-route row above — a separate handle would earn nothing.
    firmId: text("firm_id")
      .primaryKey()
      .$type<FirmId>()
      .references(() => firm.id),
    // The derived, opaque name. Derived rather than minted so a repeated create converges on the
    // same instance and a crashed provisioning step is restartable rather than leaky; opaque because
    // instance names appear in account-level surfaces that are not partitioned per firm, so the name
    // must carry no firm name, no client name, and no human-readable text.
    instanceName: text("instance_name").notNull(),
    // Whatever identifier the service returned, recorded verbatim and never parsed for meaning. Null
    // until a create has succeeded.
    instanceIdentifier: text("instance_identifier"),
    // Which generation of the fixed configuration this instance was created under. An instance whose
    // generation is behind is identifiable from this row alone — which matters because the metadata
    // schema is part of that configuration and changing it re-indexes every document in the instance.
    configurationGeneration: integer("configuration_generation").notNull(),
    // provisioning | ready | tearing-down | absent. `absent` is a RECORDED state rather than a
    // missing row: a firm that opted out and was torn down is a different fact from a firm that never
    // opted in, and only the recorded state tells them apart afterwards.
    state: text("state", {
      enum: ["provisioning", "ready", "tearing-down", "absent"],
    }).notNull(),
    // What the service said when asked to delete the instance, kept as-is. The platform can
    // demonstrate deletion of the text it wrote into storage it owns; deletion of the managed index
    // is a request whose completeness it cannot demonstrate, so the response is recorded and nothing
    // is concluded from it.
    teardownResponse: text("teardown_response"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    // The weekly keep-alive sweep walks every `ready` instance and nothing else.
    index("ai_search_instance_state_index").on(table.state),
    uniqueIndex("ai_search_instance_instance_name_unique_index").on(table.instanceName),
    check(
      "ai_search_instance_state_check",
      sql`${table.state} IN ('provisioning', 'ready', 'tearing-down', 'absent')`,
    ),
  ],
);
