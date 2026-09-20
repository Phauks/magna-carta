# Slice 0·4 Implementation Plan — auth, RBAC skeleton & firm provisioning

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build slice 0·4 — Better Auth on control-plane D1 (email/password + TOTP, invitation-only), the per-firm `member` mirror synced through a control-plane outbox, the RBAC skeleton (`@magna-carta/access-control`), and the seamed firm-provisioning flow — backend + API only.

**Architecture:** Better Auth mounts in `apps/worker` against control-plane D1 via the Drizzle adapter, with our Drizzle schema as the source of truth (our migrations, never Better Auth's). Every user creation flows through our endpoints (no open signup), so the control-plane gains the `outbox`/`idempotency_key` pair and user+outbox commit in one batch; the relay applies `member` rows to per-firm D1. Provisioning is an idempotent, resumable orchestration behind a `FirmResourceProvider` port. RBAC is a pure package (registry + resolver) consumed by handlers now and the ADR-0067 chokepoint in slice 0·5.

**Tech Stack:** better-auth (catalog-pinned), drizzle-orm (becomes a **runtime** dep of `apps/worker` — the adapter needs it; the data-access raw-SQL discipline is unchanged), `@magna-carta/{identifiers,database,data-access}`, hono + `@hono/zod-openapi`, `otpauth` (dev, TOTP test codes), Miniflare via `@cloudflare/vitest-pool-workers`.

**Spec:** [`2026-06-09-slice-0-4-auth-rbac-provisioning-design.md`](2026-06-09-slice-0-4-auth-rbac-provisioning-design.md) · ADR-0073 (ADR-0004, ADR-0068, ADR-0062–0065 upstream).

## Decided up front (read before coding)

1. **Pin better-auth exact in the catalog** (latest stable at build; check `npm view better-auth version`). Better Auth now also ships a native D1 dialect — we still use **`drizzleAdapter`** because our snake_case control-plane schema is the source of truth and the adapter maps Better Auth's camelCase fields onto it; the native dialect would expect default column names. `drizzleAdapter(db, { provider: "sqlite", transaction: false })` — D1 has no interactive transactions.
2. **Better Auth never runs migrations.** `npx @better-auth/cli generate` output is _reference material_ for Task 4's schema; a **schema-sync fitness test** (Task 8) asserts the mounted config initializes against our schema. On a better-auth version bump, that test is the tripwire.
3. **Better Auth-owned tables keep Better Auth's expected storage** (epoch-integer timestamps), as library internals. _Our_ tables (`auth_audit`, RBAC, firm columns) follow house conventions (ISO-8601 UTC text, ADR-0055). This is a deliberate, documented exception, scoped to the library's own tables.
4. **All Better Auth model ids are our handles** via `advanced.database.generateId: ({ model }) => newIdentifier(modelToEntity[model])` — new prefix-registry entries: `session→ses`, `account→acc`, `verification→ver`, `twoFactor→twf` (plus `role→rol`, `rolePermission→rpm`, `memberRole→mrl`, `grant→gnt`, `authAudit→aud`). `user→usr` and `firm→frm` exist.
5. **Junction tables get handle primary keys** (`rpm_`/`mrl_`) + a UNIQUE composite — the 0·2 fitness function requires TEXT identifier-handle PKs on _every_ table; relaxing it for junctions is worse than two small id columns.
6. **Invite/owner user creation is a direct INSERT in the effect batch** (user row + outbox row, one `composeEffectBatch` commit — the spec §6 atomicity), _not_ a Better Auth API call. The invitee activates via the password-reset flow. **Verify at build:** `auth.api.requestPasswordReset` → reset must work for a user with no credential `account` row (it creates one on reset). **Fallback if it does not:** the admin plugin's `auth.api.createUser` (creates user + credential account; temp random password), with the outbox row enqueued in a separate idempotent write and the §6 reconciliation backstop covering the gap — record whichever path lands as an ADR-0073 amendment.
7. **`emailAndPassword.disableSignUp: true`** — Better Auth's signup returns its `SIGNUP_DISABLED` error; an integration test asserts the route 4xxes.
8. **TOTP seeds:** the twoFactor plugin encrypts secrets/backup codes with the auth `secret` (verified against current docs) — accepted per spec §2; the `protected()` upgrade is a named later seam. Worker secrets this slice: `AUTH_SECRET`, `PLATFORM_ADMIN_KEY`, `CLOUDFLARE_API_TOKEN` (REST adapter only) — local values in `.dev.vars`, test values via Miniflare bindings.
9. **2FA login shape:** `signInEmail` for a 2FA-enabled user returns `twoFactorRedirect: true` (no full session); `POST /api/auth/two-factor/verify-totp` with the device cookie completes it. Tests generate codes with `otpauth`'s `TOTP` class from the enroll secret.
10. **Audit events ride available hooks:** `databaseHooks.session.create.after` → `login.success`; our endpoints write `firm.provisioned` / `member.invited`; twoFactor enable + password reset hook names **verified at build** (the `auth_audit` table + `writeAuthAudit` statement builder are the stable contract; exact hook wiring may shrink/grow).
11. **Relay wiring (closes the 0·2 deferral):** the worker cron sweeps the control-plane outbox with a publisher map that _directly invokes_ the member-provision consumer (no Queue hop for control-plane messages — the consumer is local and idempotent), sweeps each **active** firm's outbox publishing to `env.QUEUE`, and runs the idempotency TTL purge on every database. Consumers dedup on outbox `id` (at-least-once).
12. **Dev resource pool:** Miniflare cannot create D1/R2 at runtime. `wrangler.jsonc` pre-declares a pool (`DB_FIRM_POOL_1`, `DB_FIRM_POOL_2`); the dev `FirmResourceProvider` claims the next unclaimed pool binding (claimed = some firm row's `database_identifier` equals it); the **binding resolver** maps `database_identifier → D1Database` from `env` in dev and is the same seam the REST adapter's deploy-time bindings use later. R2 in dev: bucket _name_ recorded (`magna-carta-firm-<id>`), all dev firms share the one local `R2` binding.
13. **`firm` table gains `status` + `bucket_name`** (provisioning state + the recorded R2 bucket) — both nullable-safe for the existing row-shape; expand-contract clean.

## File structure

```
packages/access-control/
  package.json · tsconfig.json · vitest.config.ts
  src/registry.ts                  # Permission brand + PERMISSIONS registry + isPermission/assertPermission
  src/resolver.ts                  # effectivePermissions(roleGrants, directGrants, now)
  test/registry.test.ts · resolver.test.ts
packages/identifiers/src/prefix-registry.ts          # MODIFY: new entries (decided #4)
packages/database/src/control-plane-schema.ts        # MODIFY: user/session/account/verification/two_factor,
                                                     #   auth_audit, outbox, idempotency_key, firm.status/bucket_name
packages/database/src/per-firm-schema.ts             # MODIFY: member, role, role_permission, member_role, direct_grant
packages/database/drizzle/{control-plane,per-firm}/  # generated migrations (+ per-firm role seed SQL)
packages/data-access/src/member-statements.ts        # member/member_role upsert builders (consumer side)
packages/data-access/src/auth-audit-statements.ts    # writeAuthAudit insert builder
apps/worker/src/auth.ts                              # createAuth(env) — Better Auth config (one home)
apps/worker/src/email-port.ts                        # SendEmail port + dev logging adapter
apps/worker/src/session-context.ts                   # resolveSession middleware -> { userId, firmId }
apps/worker/src/firm-binding-resolver.ts             # database_identifier -> D1Database (dev map; deploy seam)
apps/worker/src/firm-resource-provider.ts            # port + dev pool adapter + Cloudflare REST adapter
apps/worker/src/firm-provisioner.ts                  # the resumable orchestration
apps/worker/src/member-provision-consumer.ts         # outbox consumer: member + role rows into per-firm D1
apps/worker/src/routes/{firms,members,me}.ts         # createRoute contracts + handlers
apps/worker/src/scheduled.ts                         # cron: relay sweeps + TTL purge
apps/worker/src/{app,index}.ts                       # MODIFY: mount auth, routes, scheduled handler
apps/worker/wrangler.jsonc                           # MODIFY: firm DB pool, crons, vars
apps/worker/test/…                                   # per task below
```

---

### Task 1: Dependencies, prefixes, scaffold

- [ ] Catalog (`pnpm-workspace.yaml`): add `better-auth: <exact latest>`, `otpauth: <exact latest>`. `apps/worker` deps: `better-auth: catalog:`, `drizzle-orm: catalog:` (runtime — decided #1), `@magna-carta/identifiers|database|data-access|access-control: workspace:*`; devDeps `otpauth: catalog:`.
- [ ] `packages/identifiers/src/prefix-registry.ts`: add `session: "ses"`, `account: "acc"`, `verification: "ver"`, `twoFactor: "twf"`, `role: "rol"`, `rolePermission: "rpm"`, `memberRole: "mrl"`, `grant: "gnt"`, `authAudit: "aud"` (follow the file's existing entry shape; its tests enumerate the registry — extend them).
- [ ] Scaffold `packages/access-control` mirroring `packages/database` configs; exports map `./registry` and `./resolver`; deps: `@magna-carta/identifiers: workspace:*` only.
- [ ] `vp install`; `vp test` (identifiers tests green); commit `chore(access-control): scaffold package + auth prefixes + better-auth pins`.

### Task 2: Permission registry (`packages/access-control/src/registry.ts`)

TDD. Tests: `isPermission("firm:manageMembers")` true; unknown key / bad shape false; `assertPermission` narrows or throws; `permissionsForNamespace("firm")` returns exactly the firm keys; the branded type rejects raw strings at compile time (negative-compile assertion file, same pattern as identifiers).

```ts
declare const PermissionBrand: unique symbol;
export type Permission = string & { readonly [PermissionBrand]: true };

// The platform permission registry (ADR-0068): one namespace per subsystem, `<subsystem>:<action>`.
// Grows one block per subsystem slice; the fitness tests cross-check every referenced key against this.
export const PERMISSIONS = [
  "firm:manageMembers", // invite/deactivate members, assign roles
  "firm:provision", // reserved: platform-level firm creation (guarded by secret this slice)
] as const;

export type KnownPermission = (typeof PERMISSIONS)[number];
const permissionSet: ReadonlySet<string> = new Set(PERMISSIONS);

export function isPermission(value: string): value is Permission {
  return permissionSet.has(value);
}
export function assertPermission(value: string): Permission {
  if (!isPermission(value)) throw new Error(`Unknown permission: ${value}`);
  return value;
}
export function permissionsForNamespace(namespace: string): readonly Permission[] {
  return PERMISSIONS.filter((key) => key.startsWith(`${namespace}:`)) as unknown as Permission[];
}
```

Commit `feat(access-control): permission registry + branded Permission type`.

### Task 3: Effective-permissions resolver (`packages/access-control/src/resolver.ts`)

TDD. Pure function over rows (no D1):

```ts
export interface RolePermissionRow {
  readonly permission: string;
}
export interface DirectGrantRow {
  readonly permission: string;
  readonly expires_at: string | null; // ISO-8601 UTC instant or null = no expiry
}
// effective = (permissions of held roles) UNION (unexpired direct grants) — ADR-0068.
// Unknown keys are filtered out, not thrown: a registry that shrank must not brick login.
export function effectivePermissions(
  rolePermissions: readonly RolePermissionRow[],
  directGrants: readonly DirectGrantRow[],
  now: string,
): ReadonlySet<Permission> { … }
```

Tests: union of both sources; duplicate keys collapse; grant with `expires_at` in the past excluded, future/null included (boundary: `expires_at === now` is expired); unknown permission strings dropped silently; empty inputs → empty set. Commit `feat(access-control): effective-permissions resolver`.

### Task 4: Control-plane schema + migration (`packages/database`)

- [ ] Extend `src/control-plane-schema.ts`: Better Auth tables — run `npx @better-auth/cli generate` against a scratch config (emailAndPassword + twoFactor + the `firmId` additional field) and transcribe into our Drizzle schema (snake*case columns, epoch-integer timestamps per decided #3): `user` (+ `firm_id` referencing `firm.id`, `two_factor_enabled`), `session`, `account`, `verification`, `two_factor`. Then our tables: `auth_audit` (`id` aud* PK, `event`, `user_id` nullable, `metadata` JSON text — redacted, no privileged content, `created_at` ISO text), `outbox` + `idempotency_key` (copy the per-firm definitions verbatim — same shapes, ADR-0063/0064), and on `firm`: `status` text notNull default `'active'` (existing row stays valid; provisioner writes `'provisioning'` first) + `bucket_name` text nullable.
- [ ] `pnpm --filter @magna-carta/database exec drizzle-kit generate --config drizzle-control-plane.config.ts` → migration `0001_*`; expand-contract guard passes (purely additive).
- [ ] Extend the schema fitness tests (identifier-handle TEXT PKs — Better Auth tables pass via decided #4; the epoch-timestamp exception of decided #3 needs the no-float/integer-column assertions scoped to _our_ lineage tables, adjust the test's table list accordingly).
- [ ] `vp test` green; commit `feat(database): control-plane auth schema — better-auth tables, auth_audit, outbox + idempotency, firm status`.

### Task 5: Per-firm RBAC schema + seeded roles (`packages/database`)

- [ ] Extend `src/per-firm-schema.ts`:

```ts
export const member = sqliteTable("member", {
  userId: text("user_id").primaryKey().$type<UserId>(), // the global join key (white paper)
  displayName: text("display_name").notNull(),
  status: text("status").notNull().default("active"), // active | deactivated
  createdAt: text("created_at").notNull(),
});
export const role = sqliteTable("role", {
  id: text("id").primaryKey().$type<RoleId>(),
  name: text("name").notNull().unique(),
  createdAt: text("created_at").notNull(),
});
export const rolePermission = sqliteTable(
  "role_permission",
  {
    id: text("id").primaryKey().$type<RolePermissionId>(),
    roleId: text("role_id")
      .notNull()
      .references(() => role.id),
    permission: text("permission").notNull(),
  },
  (table) => [unique().on(table.roleId, table.permission)],
);
export const memberRole = sqliteTable(
  "member_role",
  {
    id: text("id").primaryKey().$type<MemberRoleId>(),
    memberUserId: text("member_user_id")
      .notNull()
      .references(() => member.userId),
    roleId: text("role_id")
      .notNull()
      .references(() => role.id),
  },
  (table) => [unique().on(table.memberUserId, table.roleId)],
);
export const directGrant = sqliteTable("direct_grant", {
  id: text("id").primaryKey().$type<GrantId>(),
  memberUserId: text("member_user_id")
    .notNull()
    .references(() => member.userId),
  permission: text("permission").notNull(),
  expiresAt: text("expires_at"), // null = no expiry
  grantedBy: text("granted_by").notNull().$type<UserId>(),
  createdAt: text("created_at").notNull(),
});
```

- [ ] Generate per-firm migration `0001_*`; append the **role seed** to the generated SQL (deterministic ids so every firm's defaults match — literal `rol_` handles minted once and committed): five INSERTs (Owner/Admin, Attorney, Paralegal, Billing, Read-only) + `role_permission` rows granting `firm:manageMembers` to Owner/Admin only (the registry is tiny; sets grow per subsystem).
- [ ] Fitness test additions: every `role_permission.permission` / `direct_grant.permission` value in seed SQL ∈ `PERMISSIONS` (parse the migration file; `@magna-carta/access-control` becomes a devDep of database for this test only); auth tables (`user`, `session`, …) exist **only** in the control-plane lineage (assert per-firm schema exports don't include them).
- [ ] `vp test` green; commit `feat(database): per-firm RBAC schema — member mirror, roles-as-data, seeded defaults`.

### Task 6: Data-access statement builders

TDD against the existing `stub-d1` + real-SQLite (`node:sqlite`) patterns already in `packages/data-access/test/`.

- [ ] `src/member-statements.ts`: `insertMemberStatement(db, { userId, displayName, now })` and `assignRoleStatement(db, { id, memberUserId, roleId })` — both `INSERT … ON CONFLICT DO NOTHING` (the outbox consumer is at-least-once; replays must no-op), plus `selectMemberPermissionsStatements(db, userId)` returning the two reads (role permissions via join; unexpired-filterable grants) the `/v1/me` handler and future chokepoint feed to the resolver.
- [ ] `src/auth-audit-statements.ts`: `insertAuthAuditStatement(db, { id, event, userId, metadata, now })` — `metadata` is `canonicalJsonStringify`-ed, callers pass only redacted fields (the builder is dumb; redaction discipline lives at call sites and the test asserts the builder never stringifies a `password` key — a canary, not a guarantee).
- [ ] Extend `schema-name-sync.test.ts` to cover the new tables' names from `getTableConfig`.
- [ ] `vp test` green; commit `feat(data-access): member-mirror + auth-audit statement builders`.

### Task 7: Email port (`apps/worker/src/email-port.ts`)

```ts
export interface SendEmail {
  (message: { to: string; subject: string; text: string }): Promise<void>;
}
// Dev adapter: logs the message (verification/reset links land in the terminal). Slice 0·6
// swaps in real transactional email behind the same signature.
export function createLoggingEmailAdapter(log: (line: string) => void = console.log): SendEmail { … }
```

One small test (captures via injected `log`). Commit `feat(worker): sendEmail port + dev logging adapter`.

### Task 8: Better Auth instance + mount (`apps/worker/src/auth.ts`)

- [ ] Config (the one home for the integration shape):

```ts
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { twoFactor } from "better-auth/plugins";
import { drizzle } from "drizzle-orm/d1";
import * as controlPlaneSchema from "@magna-carta/database/control-plane-schema";
import { newIdentifier } from "@magna-carta/identifiers/identifier";

const modelToEntity = {
  user: "user", session: "session", account: "account",
  verification: "verification", twoFactor: "twoFactor",
} as const;

export function createAuth(env: Bindings, sendEmail: SendEmail) {
  const db = drizzle(env.DB_CONTROL, { schema: controlPlaneSchema });
  return betterAuth({
    secret: env.AUTH_SECRET,
    database: drizzleAdapter(db, { provider: "sqlite", transaction: false }),
    emailAndPassword: {
      enabled: true,
      disableSignUp: true, // invitation-only (spec §1)
      requireEmailVerification: true,
      sendResetPassword: async ({ user, url }) =>
        sendEmail({ to: user.email, subject: "Set your Magna Carta password", text: url }),
    },
    emailVerification: {
      sendVerificationEmail: async ({ user, url }) =>
        sendEmail({ to: user.email, subject: "Verify your email", text: url }),
    },
    user: { additionalFields: { firmId: { type: "string", required: true, input: false } } },
    advanced: { database: { generateId: ({ model }) => newIdentifier(modelToEntity[model] ?? "verification") } },
    databaseHooks: {
      session: { create: { after: /* writeAuthAudit login.success — Task 13 wires the builder */ } },
    },
    plugins: [twoFactor()],
  });
}
```

(Exact option paths verified against the pinned version's docs at build — decided #2's sync test is the tripwire.)

- [ ] Mount in `src/app.ts`: `app.on(["GET", "POST"], "/api/auth/*", (c) => auth.handler(c.req.raw))` with one lazily-created instance per request env.
- [ ] **Schema-sync fitness test:** construct `createAuth` against a Miniflare-migrated control-plane D1 and run a representative call (`auth.api.getSession` with no cookie) — a missing/mismatched column throws here, not in production.
- [ ] Integration tests (Miniflare): public signup → 4xx `SIGNUP_DISABLED`; seeded user (direct INSERT of user+account with a password hashed via better-auth's exported hasher — or via the activation flow once Task 11 lands; keep this test minimal: signup-blocked + session-null) .
- [ ] `vp test` green; commit `feat(worker): mount better-auth on control-plane D1 — invitation-only, usr_ handles`.

### Task 9: TOTP integration (`apps/worker/test/totp.test.ts`)

- [ ] With a credentialed user (helper from Task 8/11): `POST /api/auth/two-factor/enable` (password) → extract secret from `totpURI`; `new OTPAuth.TOTP({ secret }).generate()` → `POST /api/auth/two-factor/verify-totp` → enabled; fresh `signInEmail` now returns `twoFactorRedirect: true` and **no** session cookie; verify-totp with a generated code completes login; a wrong code 4xxes.
- [ ] Assert the stored `two_factor.secret` is **not** the raw base32 secret (encrypted at rest with `AUTH_SECRET` — decided #8).
- [ ] Commit `test(worker): TOTP enroll + 2FA login end-to-end`.

### Task 10: Session context + `GET /v1/me`

- [ ] `src/session-context.ts`: `resolveSession(auth, c)` → `{ userId, firmId } | null` from `auth.api.getSession({ headers })`; null → RFC 9457 401 problem (api.md shape). This is the chokepoint's first link (spec §7) — a plain function used by handlers, not yet a global middleware.
- [ ] `src/firm-binding-resolver.ts`: `resolveFirmDatabase(env, databaseIdentifier)` — dev: lookup table `{ DB_FIRM_POOL_1: env.DB_FIRM_POOL_1, … }`; unknown id → null (→ 404 path).
- [ ] `src/routes/session/me.ts`: `createRoute` GET `/api/v1/me` (`x-mc-*` metadata + native `operationId: "me.get"` — the spike finding), handler: resolveSession → firm row (registry) → member permission reads (Task 6) → `effectivePermissions` → `{ user, firm: { id, name }, permissions: [...] }`.
- [ ] Integration tests: no cookie → 401 problem+json; logged-in user → firm + permissions include the role seeds; a user whose firm row is missing/foreign → 404 (cross-firm reserve, ADR-0052).
- [ ] Commit `feat(worker): resolveSession + GET /v1/me with effective permissions`.

### Task 11: Invite endpoint (`src/routes/session/members.ts`)

- [ ] **Build-time verification step (decided #6):** confirm password-reset works for a user row with no credential account on the pinned version (write the failing/passing integration test first — it decides the path). Path A (expected): direct-insert. Path B (fallback): admin plugin `createUser` + separate outbox enqueue. Record the landed path as an ADR-0073 amendment in Task 15. The rest of this task assumes Path A.
- [ ] `POST /api/v1/members` (`operationId: "members.invite"`, `idempotency: required`, `audited`): resolveSession → require `firm:manageMembers` (via Task 10's permission reads + `effectivePermissions`; lacking → 403 problem) → `runIdempotentEffect` against **control-plane** D1 composing: user INSERT (usr\_ handle, email, name, `firm_id`, unverified), outbox row `member.provision` `{ userId, firmId, displayName, roleName: null }`, `auth_audit` `member.invited` — one batch → then `auth.api.requestPasswordReset` (the activation email through the port).
- [ ] Tests: duplicate email → 422 problem (UNIQUE on `user.email` — surfaced via the conflict-replay path); missing permission → 403; idempotency replay returns the stored response with `Idempotency-Replayed: true`; the outbox row exists after success.
- [ ] Commit `feat(worker): invitation-only member creation through the idempotent effect path`.

### Task 12: FirmResourceProvider + FirmProvisioner

- [ ] `src/firm-resource-provider.ts`:

```ts
export interface FirmResourceProvider {
  createDatabase(firmId: FirmId): Promise<{ databaseIdentifier: string }>;
  createBucket(firmId: FirmId): Promise<{ bucketName: string }>;
}
```

Dev adapter: claims the next pool binding not present in any firm row (query injected, pure logic tested with stubs); exhausted pool → explicit error. REST adapter: `POST /client/v4/accounts/{accountId}/d1/database` and `POST /client/v4/accounts/{accountId}/r2/buckets` with `Authorization: Bearer ${env.CLOUDFLARE_API_TOKEN}` (injectable `fetch`; tests stub success/HTTP-error/already-exists — already-exists is **success** for idempotent resume).

- [ ] `src/firm-provisioner.ts` — the resumable orchestration (spec §5): each step guarded by the firm row's current state (`status`, `database_identifier`, `per_firm_schema_version`, `bucket_name`, owner-outbox-row existence), re-invoke no-ops completed steps. Steps: insert `provisioning` row → createDatabase → migrate via the existing fleet/migration runner (binding resolver supplies the handle) → createBucket → owner user + outbox + audit (the Task 11 effect batch, role `Owner/Admin`) → `status='active'`.
- [ ] Unit tests against fake ports: happy path; crash-after-each-step then resume (assert each prior step not re-executed — fake ports count calls); double full-invoke is a no-op returning the existing firm.
- [ ] `POST /api/v1/firms` (`operationId: "firms.provision"`, `idempotency: required`, `audited`): guarded by constant-time compare of `X-Platform-Admin-Key` against `env.PLATFORM_ADMIN_KEY` (no session — the platform-admin principal model is a named seam); body `{ name, owner: { email, name } }`.
- [ ] Integration (Miniflare): provision → firm `active` with pool binding claimed, per-firm DB migrated to head (mirror column matches), owner outbox row present; wrong admin key → 401 problem.
- [ ] Commit `feat(worker): firm provisioning — resumable orchestration behind the resource-provider port`.

### Task 13: Outbox consumer + cron wiring (`src/member-provision-consumer.ts`, `src/scheduled.ts`)

- [ ] Consumer: for a `member.provision` message — resolve firm binding → batch `[insertMember (ON CONFLICT DO NOTHING), assignRole if roleName (resolve seeded role id by name)]`. Unknown firm/binding → throw (relay increments attempts → dead-letter at max).
- [ ] `src/scheduled.ts`: `runScheduledSweep(env)` — control-plane `sweepOutbox` with publisher = the consumer map (`member.provision` → direct invoke, decided #11); per-firm sweep over `active` firms publishing to `env.QUEUE`; `purgeExpiredIdempotencyRecords` on control-plane + each firm DB. Wire `scheduled` in `src/index.ts`; add `triggers.crons: ["*/5 * * * *"]` + the pool bindings + `vars` to `wrangler.jsonc` (and the Miniflare config in `vitest.config.ts`).
- [ ] Wire the `databaseHooks` audit writes left pending in Task 8 (login.success; twoFactor-enabled and reset hooks as the pinned version exposes them — decided #10).
- [ ] Integration: invite (Task 11) → run `runScheduledSweep` → member row + role exist in the firm DB; re-run sweep → no duplicates; reconciliation query (users with no member row) returns empty; a poisoned message dead-letters after max attempts.
- [ ] Commit `feat(worker): member-provision consumer + cron relay/TTL wiring (closes the 0·2 deferral)`.

### Task 14: End-to-end + conformance fitness

- [ ] `apps/worker/test/auth-provisioning-e2e.test.ts`: provision firm A and firm B → owner A activates (reset link from the captured email port → set password → verify) → login → optional TOTP enable → `GET /v1/me` shows firm A + Owner/Admin permissions → invite a Paralegal → sweep → invitee row in firm A only; firm B's database has no trace (isolation assert).
- [ ] Fitness: the emitted OpenAPI document (now containing `/v1/*`) — every mutating `/v1` route carries `x-mc-audited: true`, non-null `x-mc-idempotency`, and a registry-known `x-mc-permission` or the documented platform-admin exception (the spike's conformance-sweep pattern, now over real routes); no operation resembling public signup outside `/api/auth/*`.
- [ ] Full `vp test` + `pnpm check` green; commit `test(worker): slice 0·4 end-to-end + route conformance fitness`.

### Task 15: Docs + closeout (golden rule 5 — same PR)

- [ ] `ROADMAP.md`: move slice 0·4 into **Now** during the build / **Recently shipped** on completion (per its conventions); note the closed 0·2 cron-wiring deferral.
- [ ] `CHANGELOG.md`: the slice entry (follow the 0·2 package entries' density).
- [ ] `docs/Decision-Log.md`: ADR-0073 amendments if Task 11's verification chose Path B or hook wiring (Task 8/13) deviated.
- [ ] `docs/conventions/security.md` (or the conventions home that exists for auth): record the operational facts — invitation-only, the three Worker secrets, the dev email stub, the binding-pool dev model, TOTP seed handling. No user docs yet (no UI — spec §10).
- [ ] `pnpm check`; commit `docs: slice 0·4 roadmap/changelog/conventions closeout`.

## Self-review (spec coverage)

§1 invitation-only → Tasks 8 (disableSignUp) + 11 · §2 integration shape → Tasks 1, 8, 9 (TOTP), 13 (audit hooks) · §3 schemas → Tasks 4, 5 · §4 access-control → Tasks 2, 3 (+ fitness in 5, 14) · §5 provisioning → Task 12 · §6 outbox sync + cron → Tasks 11, 13 · §7 API surface → Tasks 10, 11, 12, 14 (conformance) · §8 testing → distributed per task + Task 14 e2e · §9 out-of-scope honored (no passkey/SMS/UI/chokepoint tasks) · §10 definition of done → Task 15.
