# Support Access Framework — Implementation Plan (backend rails)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the backend rails that let a firm member request time-boxed, audited help-desk access to their firm's instance, redeemed by a named platform-staff principal, with two scopes (diagnostic system-state vs. privileged self-scoped content) enforced through the existing chokepoint.

**Architecture:** Support is **pull, not push** — a firm member's request mints a `support_grant` row; a named `platform_staff` principal redeems an _active_ grant for a short-lived HMAC-signed **support-session token**. Presenting that token resolves to a `SessionContext` the chokepoint already understands (firm from the grant, never the URL), with the permission set computed by tier: `diagnostic` → a fixed `diagnostics:*` allow-list (no decrypt keys → privileged content unreachable by construction); `privileged` → exactly the requester's own effective permissions (no firm-level escalation). Decryption stays server-side; an expired or revoked grant fails the per-request live check → ordinary 401.

**Tech Stack:** TypeScript, Cloudflare Workers + Hono + `@hono/zod-openapi`, Drizzle (control-plane + per-firm D1), Better Auth (control-plane), Web Crypto HMAC-SHA256, Vitest + `@cloudflare/vitest-pool-workers` (Miniflare).

**Design spec:** `docs/specs/2026-06-25-support-access-framework-design.md` (read it before starting).

## Global Constraints

- **Spell names out in full** (golden rule 12): `@magna-carta/identifiers`, `newIdentifier`, "the data-access layer". No shorthand.
- **No process-doc references in source/tests/strings** (golden rule 13): no `ADR-NNNN`, no "spec §N", no "Plan/Task N" in code, comments, or OpenAPI `description`s. State reasoning inline or cite a file by path. A forward-looking "built later" schedule reference is the only allowed exception.
- **Every `/api/v1` route goes through the chokepoint** via `defineOpenAPIRoute` + a full `RouteMeta`; a route with no meta or an unregistered permission throws at startup.
- **Changing any route re-emits the contract in the same commit:** `pnpm --filter @magna-carta/worker run emit-openapi` then `pnpm --filter @magna-carta/api-client run generate`. A byte-exact test gates drift.
- **Control-plane tables use ISO-8601 UTC text timestamps** (house convention); epoch-ms is scoped to the five Better Auth tables only.
- **Audit metadata is ids + non-privileged enums ONLY** — `insertAuthAuditStatement` runs `refuseUnredactedMetadata`; never log privileged content.
- **Quality gate before every commit:** `pnpm check` (fmt + lint + typecheck + svelte-check) must pass. Run `vp check` for fast iteration; the process-ref lint (`pnpm run lint:process-refs`) is part of it.
- **Test runner gotcha:** the Miniflare suite can OOM under heavy load; keep new test files focused. Container bindings do not run under the pool (not relevant here).
- **Staff authentication (self-service login + MFA) is OUT OF SCOPE for this plan** — a named follow-on. Here the staff principal is a seeded `platform_staff` row, and the redeem endpoint is gated by the existing `platformAdminGuard` (the platform-admin key) with the named principal validated against `platform_staff`. UI, notification transport, and AI-agent principals are likewise deferred named seams.

---

## File Structure

**New files:**

- `packages/data-access/src/support-access-statements.ts` — control-plane prepared-statement builders for `platform_staff` + `support_grant`.
- `apps/worker/src/support/grant-lifecycle.ts` — pure lifecycle types, window constants, and state helpers.
- `apps/worker/src/support/support-session-token.ts` — mint/verify the HMAC support-session bearer token.
- `apps/worker/src/support/tier-permissions.ts` — `DIAGNOSTIC_PERMISSIONS` + `resolveSupportPermissions`.
- `apps/worker/src/support/resolve-support-session.ts` — header token → live grant check → `SessionContext`.
- `apps/worker/src/support/support-audit.ts` — `writeSupportAudit` helper.
- `apps/worker/src/routes/support/support-grants.ts` — request / list / cosign / revoke routes.
- `apps/worker/src/routes/support/support-sessions.ts` — staff redeem route (mints the token).
- `apps/worker/src/routes/support/support-diagnostics.ts` — diagnostic overview read route.
- `packages/database/drizzle/control-plane/0003_support-access.sql` — generated control-plane migration.
- `packages/database/drizzle/per-firm/00NN_support-access-permissions.sql` — hand-authored role-seed migration.
- Test files alongside each (paths given per task).

**Modified files:**

- `packages/identifiers/src/types.ts`, `packages/identifiers/src/registry.ts` — two new id types.
- `packages/database/src/control-plane-schema.ts` — two tables + one firm column.
- `packages/access-control/src/registry.ts` — `support:*` + `diagnostics:*` permission keys.
- `apps/worker/src/chokepoint/chokepoint.ts` — `ResolvedSession.support` + `loadPermissions` signature.
- `apps/worker/src/chokepoint/ports.ts` — support-aware `resolveSession` + `loadPermissions` wiring.
- `apps/worker/src/session-context.ts` — `SessionContext.support`.
- `apps/worker/src/app.ts` — register the three new route modules.
- `apps/worker/test/support/apply-control-plane-migrations.ts` — import the new control-plane migration.
- `apps/worker/src/per-firm-migrations.ts` — register the new per-firm migration.

---

## Task 1: Branded identifiers for staff and grants

**Files:**

- Modify: `packages/identifiers/src/types.ts`
- Modify: `packages/identifiers/src/registry.ts`
- Test: `packages/identifiers/test/registry.test.ts` (or the existing identifiers test file — add a case)

**Interfaces:**

- Produces: `PlatformStaffId`, `SupportGrantId` (branded id types); the registry keys `"platformStaff"` and `"supportGrant"` usable with `newIdentifier(...)` / `assertIdentifier(...)`.

- [ ] **Step 1: Write the failing test**

In `packages/identifiers/test/registry.test.ts`, add:

```typescript
import { describe, expect, it } from "vitest";
import { newIdentifier } from "../src/generate.ts";
import { isIdentifier } from "../src/validate.ts";

describe("support-access identifiers", () => {
  it("mints and validates platformStaff and supportGrant handles", () => {
    const staffId = newIdentifier("platformStaff");
    const grantId = newIdentifier("supportGrant");
    expect(staffId.startsWith("platformStaff_")).toBe(true);
    expect(grantId.startsWith("supportGrant_")).toBe(true);
    expect(isIdentifier(staffId, "platformStaff")).toBe(true);
    expect(isIdentifier(grantId, "supportGrant")).toBe(true);
    // cross-type rejection
    expect(isIdentifier(staffId, "supportGrant")).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @magna-carta/identifiers test -- registry`
Expected: FAIL — `"platformStaff"` is not a registered entity type (type error / runtime undefined prefix).

- [ ] **Step 3: Add the registry entries**

In `packages/identifiers/src/registry.ts`, add two entries to the `ENTITY_PREFIXES` object (alphabetical-ish, beside related platform entries):

```typescript
  platformStaff: "platformStaff",
  supportGrant: "supportGrant",
```

- [ ] **Step 4: Add the type aliases**

In `packages/identifiers/src/types.ts`, add beside the other aliases:

```typescript
export type PlatformStaffId = Identifier<"platformStaff">;
export type SupportGrantId = Identifier<"supportGrant">;
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter @magna-carta/identifiers test -- registry`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/identifiers/src/types.ts packages/identifiers/src/registry.ts packages/identifiers/test/registry.test.ts
git commit -m "feat(identifiers): add platformStaff + supportGrant id types"
```

---

## Task 2: Control-plane schema — platform_staff, support_grant, firm policy column

**Files:**

- Modify: `packages/database/src/control-plane-schema.ts`
- Create: `packages/database/drizzle/control-plane/0003_support-access.sql` (generated)
- Modify: `packages/database/drizzle/control-plane/meta/_journal.json` (generated)
- Modify: `apps/worker/test/support/apply-control-plane-migrations.ts`

**Interfaces:**

- Produces: control-plane tables `platform_staff` and `support_grant`, and a `firm.support_requires_cosign` column. Column/table names consumed by Task 3's statements.

- [ ] **Step 1: Add the schema definitions**

In `packages/database/src/control-plane-schema.ts`, add the new id types to the existing import block:

```typescript
  PlatformStaffId,
  SupportGrantId,
```

Add a `support_requires_cosign` column to the existing `firm` table (after `rootKeyVersion`, before `createdAt`):

```typescript
  // Firm policy: when true, a PRIVILEGED support grant is created in 'requested' state and needs an
  // admin co-sign before it becomes redeemable. Default false — self-scoping already bounds a
  // privileged session to the requester's own access, so co-sign is opt-in hardening. Promoted into
  // the declarative settings registry later; an interim control-plane column keeps grant creation a
  // single control-plane read.
  supportRequiresCosign: integer("support_requires_cosign", { mode: "boolean" }).notNull().default(false),
```

Append the two new tables after `authAudit`:

```typescript
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
```

- [ ] **Step 2: Generate the control-plane migration**

Run: `pnpm --filter @magna-carta/database exec drizzle-kit generate --config=drizzle-control-plane.config.ts --name=support-access`
Expected: creates `packages/database/drizzle/control-plane/0003_support-access.sql` (CREATE TABLE `platform_staff`, CREATE TABLE `support_grant`, ALTER TABLE `firm` ADD `support_requires_cosign`, plus the unique/index statements) and appends an `idx: 3, tag: "0003_support-access"` entry to `meta/_journal.json`.

Verify the file exists and contains both `CREATE TABLE` statements:
Run: `git -C C:/dev/magna-carta-worktrees/support-access-framework status --porcelain packages/database/drizzle/control-plane/`

- [ ] **Step 3: Register the migration in the test applier**

In `apps/worker/test/support/apply-control-plane-migrations.ts`, add the import (use the exact generated tag from Step 2):

```typescript
import supportAccessSql from "@magna-carta/database/drizzle/control-plane/0003_support-access.sql";
```

Add the map entry to the `migrationsFromJournal` call:

```typescript
    "0003_support-access": supportAccessSql,
```

- [ ] **Step 4: Run the database + schema-conformance tests**

Run: `pnpm --filter @magna-carta/database test`
Expected: PASS — including `packages/database/test/control-plane-schema.test.ts` and `generated-migrations.test.ts` (the schema now matches the generated migration). If a conformance test enumerates control-plane tables, it should already read the schema dynamically; if it hard-codes a table list, add `platform_staff` and `support_grant` there.

- [ ] **Step 5: Commit**

```bash
git add packages/database/src/control-plane-schema.ts packages/database/drizzle/control-plane apps/worker/test/support/apply-control-plane-migrations.ts
git commit -m "feat(database): control-plane platform_staff + support_grant tables, firm cosign policy"
```

---

## Task 3: Control-plane data-access statements

**Files:**

- Create: `packages/data-access/src/support-access-statements.ts`
- Test: `packages/data-access/test/support-access-statements.test.ts`

**Interfaces:**

- Consumes: `SqlDatabase`, `SqlStatement` from `./idempotency-statements.ts`; `PlatformStaffId`, `SupportGrantId`, `FirmId`, `UserId` from `@magna-carta/identifiers/types`.
- Produces:
  - `PLATFORM_STAFF_TABLE`, `SUPPORT_GRANT_TABLE` (string consts)
  - `SupportGrantRow` (snake_case read shape), `PlatformStaffRow`
  - `insertPlatformStaffStatement(db, input)`, `selectPlatformStaffStatement(db, id)`
  - `insertSupportGrantStatement(db, input)`, `selectSupportGrantStatement(db, id)`, `selectFirmSupportGrantsStatement(db, firmId)`
  - `redeemSupportGrantStatement(db, { id, principalId })`, `cosignSupportGrantStatement(db, { id, cosignedByUserId })`, `revokeSupportGrantStatement(db, { id })`

- [ ] **Step 1: Write the failing test**

Create `packages/data-access/test/support-access-statements.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import {
  PLATFORM_STAFF_TABLE,
  SUPPORT_GRANT_TABLE,
  cosignSupportGrantStatement,
  insertPlatformStaffStatement,
  insertSupportGrantStatement,
  redeemSupportGrantStatement,
  revokeSupportGrantStatement,
  selectFirmSupportGrantsStatement,
  selectSupportGrantStatement,
} from "../src/support-access-statements.ts";
import type { SqlDatabase, SqlStatement } from "../src/idempotency-statements.ts";

// A recording fake: captures the SQL + bound args so we assert on the built statement.
function recorder(): { db: SqlDatabase; calls: { sql: string; args: unknown[] }[] } {
  const calls: { sql: string; args: unknown[] }[] = [];
  const db: SqlDatabase = {
    prepare(sql: string): SqlStatement {
      const call = { sql, args: [] as unknown[] };
      const stmt: SqlStatement = {
        sql,
        bind(...values: unknown[]) {
          call.args = values;
          calls.push(call);
          return stmt;
        },
        async run() {
          return { meta: { changes: 1 } };
        },
        async all<T = Record<string, unknown>>() {
          return { results: [] as T[] };
        },
      };
      return stmt;
    },
  };
  return { db, calls };
}

describe("support-access statements", () => {
  it("inserts a platform staff row with positional bindings", () => {
    const { db, calls } = recorder();
    insertPlatformStaffStatement(db, {
      id: "platformStaff_abc",
      email: "dana@example.com",
      displayName: "Dana",
      role: "support",
      now: "2026-06-26T00:00:00.000Z",
    } as never);
    expect(calls[0]?.sql).toContain(PLATFORM_STAFF_TABLE);
    expect(calls[0]?.args).toEqual([
      "platformStaff_abc",
      "dana@example.com",
      "Dana",
      "support",
      "2026-06-26T00:00:00.000Z",
    ]);
  });

  it("inserts a support grant row", () => {
    const { db, calls } = recorder();
    insertSupportGrantStatement(db, {
      id: "supportGrant_1",
      firmId: "firm_1",
      requestedByUserId: "user_1",
      tier: "diagnostic",
      status: "active",
      reason: "page errors",
      requiresCosign: false,
      expiresAt: "2026-06-26T02:00:00.000Z",
      now: "2026-06-26T00:00:00.000Z",
    } as never);
    expect(calls[0]?.sql).toContain(SUPPORT_GRANT_TABLE);
    expect(calls[0]?.args[0]).toBe("supportGrant_1");
    expect(calls[0]?.args).toContain("diagnostic");
  });

  it("redeem sets principal only when grant is active", () => {
    const { db, calls } = recorder();
    redeemSupportGrantStatement(db, {
      id: "supportGrant_1",
      principalId: "platformStaff_abc",
    } as never);
    expect(calls[0]?.sql).toContain("status = 'active'");
    expect(calls[0]?.args).toEqual(["platformStaff_abc", "supportGrant_1"]);
  });

  it("cosign flips requested → active", () => {
    const { db, calls } = recorder();
    cosignSupportGrantStatement(db, {
      id: "supportGrant_1",
      cosignedByUserId: "user_admin",
    } as never);
    expect(calls[0]?.sql).toContain("'requested'");
    expect(calls[0]?.sql).toContain("'active'");
  });

  it("revoke guards against terminal states", () => {
    const { db, calls } = recorder();
    revokeSupportGrantStatement(db, { id: "supportGrant_1" } as never);
    expect(calls[0]?.sql).toContain("'revoked'");
    expect(calls[0]?.sql).toContain("status = 'active'");
  });

  it("select-by-id and select-firm-grants build statements", () => {
    const { db, calls } = recorder();
    selectSupportGrantStatement(db, "supportGrant_1" as never);
    selectFirmSupportGrantsStatement(db, "firm_1" as never);
    expect(calls[0]?.args).toEqual(["supportGrant_1"]);
    expect(calls[1]?.args).toEqual(["firm_1"]);
    expect(calls[1]?.sql).toContain("ORDER BY");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @magna-carta/data-access test -- support-access`
Expected: FAIL — module `../src/support-access-statements.ts` not found.

- [ ] **Step 3: Implement the statements**

Create `packages/data-access/src/support-access-statements.ts`:

```typescript
import type {
  FirmId,
  PlatformStaffId,
  SupportGrantId,
  UserId,
} from "@magna-carta/identifiers/types";
import type { SqlDatabase, SqlStatement } from "./idempotency-statements.ts";

// Control-plane table names. Tracked against @magna-carta/database's control-plane schema.
export const PLATFORM_STAFF_TABLE = "platform_staff";
export const SUPPORT_GRANT_TABLE = "support_grant";

export type SupportGrantTier = "diagnostic" | "privileged";
export type SupportGrantStatus = "requested" | "active" | "revoked" | "expired" | "closed";

// Read shape: snake_case as stored in D1 (callers map to camelCase at the edge).
export interface SupportGrantRow {
  readonly id: SupportGrantId;
  readonly firm_id: FirmId;
  readonly requested_by_user_id: UserId;
  readonly tier: SupportGrantTier;
  readonly scope: "self";
  readonly status: SupportGrantStatus;
  readonly reason: string | null;
  readonly principal_id: PlatformStaffId | null;
  readonly requires_cosign: number; // SQLite boolean (0/1)
  readonly cosigned_by_user_id: UserId | null;
  readonly expires_at: string;
  readonly created_at: string;
}

export interface PlatformStaffRow {
  readonly id: PlatformStaffId;
  readonly email: string;
  readonly display_name: string;
  readonly role: "support" | "support_lead";
  readonly status: "active" | "disabled";
  readonly created_at: string;
}

export interface InsertPlatformStaffInput {
  readonly id: PlatformStaffId;
  readonly email: string;
  readonly displayName: string;
  readonly role: "support" | "support_lead";
  readonly now: string;
}

export function insertPlatformStaffStatement(
  database: SqlDatabase,
  input: InsertPlatformStaffInput,
): SqlStatement {
  return database
    .prepare(
      `INSERT INTO ${PLATFORM_STAFF_TABLE} (id, email, display_name, role, status, created_at) VALUES (?1, ?2, ?3, ?4, 'active', ?5) ON CONFLICT DO NOTHING`,
    )
    .bind(input.id, input.email, input.displayName, input.role, input.now);
}

export function selectPlatformStaffStatement(
  database: SqlDatabase,
  staffId: PlatformStaffId,
): SqlStatement {
  return database
    .prepare(
      `SELECT id, email, display_name, role, status, created_at FROM ${PLATFORM_STAFF_TABLE} WHERE id = ?1`,
    )
    .bind(staffId);
}

export interface InsertSupportGrantInput {
  readonly id: SupportGrantId;
  readonly firmId: FirmId;
  readonly requestedByUserId: UserId;
  readonly tier: SupportGrantTier;
  readonly status: SupportGrantStatus;
  readonly reason: string | null;
  readonly requiresCosign: boolean;
  readonly expiresAt: string;
  readonly now: string;
}

export function insertSupportGrantStatement(
  database: SqlDatabase,
  input: InsertSupportGrantInput,
): SqlStatement {
  return database
    .prepare(
      `INSERT INTO ${SUPPORT_GRANT_TABLE} (id, firm_id, requested_by_user_id, tier, scope, status, reason, requires_cosign, expires_at, created_at) VALUES (?1, ?2, ?3, ?4, 'self', ?5, ?6, ?7, ?8, ?9)`,
    )
    .bind(
      input.id,
      input.firmId,
      input.requestedByUserId,
      input.tier,
      input.status,
      input.reason,
      input.requiresCosign ? 1 : 0,
      input.expiresAt,
      input.now,
    );
}

export function selectSupportGrantStatement(
  database: SqlDatabase,
  grantId: SupportGrantId,
): SqlStatement {
  return database
    .prepare(
      `SELECT id, firm_id, requested_by_user_id, tier, scope, status, reason, principal_id, requires_cosign, cosigned_by_user_id, expires_at, created_at FROM ${SUPPORT_GRANT_TABLE} WHERE id = ?1`,
    )
    .bind(grantId);
}

export function selectFirmSupportGrantsStatement(
  database: SqlDatabase,
  firmId: FirmId,
): SqlStatement {
  return database
    .prepare(
      `SELECT id, firm_id, requested_by_user_id, tier, scope, status, reason, principal_id, requires_cosign, cosigned_by_user_id, expires_at, created_at FROM ${SUPPORT_GRANT_TABLE} WHERE firm_id = ?1 ORDER BY created_at DESC`,
    )
    .bind(firmId);
}

// Redeem: stamp the principal, but only on an active grant (the WHERE guard makes a wrong-state redeem
// a no-op the caller detects via changes === 0).
export function redeemSupportGrantStatement(
  database: SqlDatabase,
  input: { readonly id: SupportGrantId; readonly principalId: PlatformStaffId },
): SqlStatement {
  return database
    .prepare(
      `UPDATE ${SUPPORT_GRANT_TABLE} SET principal_id = ?1 WHERE id = ?2 AND status = 'active'`,
    )
    .bind(input.principalId, input.id);
}

// Cosign: requested → active, recording the approving admin. Guarded to the requested state.
export function cosignSupportGrantStatement(
  database: SqlDatabase,
  input: { readonly id: SupportGrantId; readonly cosignedByUserId: UserId },
): SqlStatement {
  return database
    .prepare(
      `UPDATE ${SUPPORT_GRANT_TABLE} SET status = 'active', cosigned_by_user_id = ?1 WHERE id = ?2 AND status = 'requested' AND requires_cosign = 1`,
    )
    .bind(input.cosignedByUserId, input.id);
}

// Revoke: → revoked, only from a live (requested/active) state — never resurrect a terminal grant.
export function revokeSupportGrantStatement(
  database: SqlDatabase,
  input: { readonly id: SupportGrantId },
): SqlStatement {
  return database
    .prepare(
      `UPDATE ${SUPPORT_GRANT_TABLE} SET status = 'revoked' WHERE id = ?1 AND (status = 'active' OR status = 'requested')`,
    )
    .bind(input.id);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @magna-carta/data-access test -- support-access`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/data-access/src/support-access-statements.ts packages/data-access/test/support-access-statements.test.ts
git commit -m "feat(data-access): control-plane statements for platform_staff + support_grant"
```

---

## Task 4: Grant lifecycle pure logic

**Files:**

- Create: `apps/worker/src/support/grant-lifecycle.ts`
- Test: `apps/worker/src/support/grant-lifecycle.test.ts`

**Interfaces:**

- Consumes: `SupportGrantRow`, `SupportGrantTier`, `SupportGrantStatus` from `@magna-carta/data-access/support-access-statements`.
- Produces:
  - `GRANT_WINDOW_SECONDS: Record<SupportGrantTier, number>` (`diagnostic: 7200`, `privileged: 3600`)
  - `initialGrantStatus(requiresCosign: boolean): SupportGrantStatus`
  - `computeExpiresAt(tier, nowIso): string`
  - `supportGrantUsable(row: Pick<SupportGrantRow, "status" | "expires_at">, nowIso: string): boolean`

- [ ] **Step 1: Write the failing test**

Create `apps/worker/src/support/grant-lifecycle.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import {
  GRANT_WINDOW_SECONDS,
  computeExpiresAt,
  initialGrantStatus,
  supportGrantUsable,
} from "./grant-lifecycle.ts";

describe("grant lifecycle", () => {
  it("requires-cosign starts 'requested', otherwise 'active'", () => {
    expect(initialGrantStatus(true)).toBe("requested");
    expect(initialGrantStatus(false)).toBe("active");
  });

  it("computes expiry from the tier window", () => {
    const now = "2026-06-26T00:00:00.000Z";
    expect(computeExpiresAt("diagnostic", now)).toBe("2026-06-26T02:00:00.000Z");
    expect(computeExpiresAt("privileged", now)).toBe("2026-06-26T01:00:00.000Z");
    expect(GRANT_WINDOW_SECONDS.diagnostic).toBe(7200);
  });

  it("usable only when active and unexpired", () => {
    const now = "2026-06-26T00:30:00.000Z";
    expect(
      supportGrantUsable({ status: "active", expires_at: "2026-06-26T01:00:00.000Z" }, now),
    ).toBe(true);
    expect(
      supportGrantUsable({ status: "active", expires_at: "2026-06-26T00:00:00.000Z" }, now),
    ).toBe(false); // expired
    expect(
      supportGrantUsable({ status: "revoked", expires_at: "2026-06-26T01:00:00.000Z" }, now),
    ).toBe(false);
    expect(
      supportGrantUsable({ status: "requested", expires_at: "2026-06-26T01:00:00.000Z" }, now),
    ).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @magna-carta/worker test -- grant-lifecycle`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the lifecycle helpers**

Create `apps/worker/src/support/grant-lifecycle.ts`:

```typescript
import type {
  SupportGrantRow,
  SupportGrantStatus,
  SupportGrantTier,
} from "@magna-carta/data-access/support-access-statements";

// Total exposure window measured from the request instant. Diagnostic is roomier (no privileged
// content at stake); privileged is tighter. The staff must redeem — and an admin must co-sign, when
// required — before this elapses.
export const GRANT_WINDOW_SECONDS: Record<SupportGrantTier, number> = {
  diagnostic: 7200,
  privileged: 3600,
};

// A grant needing co-sign is born 'requested' and only becomes redeemable once an admin approves;
// otherwise the request itself opens the redeemable window.
export function initialGrantStatus(requiresCosign: boolean): SupportGrantStatus {
  return requiresCosign ? "requested" : "active";
}

export function computeExpiresAt(tier: SupportGrantTier, nowIso: string): string {
  return new Date(Date.parse(nowIso) + GRANT_WINDOW_SECONDS[tier] * 1000).toISOString();
}

// The single per-request gate the support session resolution leans on: a grant is usable only while
// it is active AND inside its time-box. Revocation (status flip) and expiry both fail this check, so
// access dies on the next request without any token revocation list.
export function supportGrantUsable(
  row: Pick<SupportGrantRow, "status" | "expires_at">,
  nowIso: string,
): boolean {
  return row.status === "active" && Date.parse(row.expires_at) > Date.parse(nowIso);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @magna-carta/worker test -- grant-lifecycle`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/worker/src/support/grant-lifecycle.ts apps/worker/src/support/grant-lifecycle.test.ts
git commit -m "feat(support): grant lifecycle window + usability helpers"
```

---

## Task 5: Support-session token (mint + verify)

**Files:**

- Create: `apps/worker/src/support/support-session-token.ts`
- Test: `apps/worker/src/support/support-session-token.test.ts`

**Interfaces:**

- Consumes: `constantTimeStringEquals` from `../constant-time.ts`; id types from `@magna-carta/identifiers/types`.
- Produces:
  - `SupportSessionTokenPayload { grantId, principalId, firmId, requesterUserId, tier, exp }`
  - `mintSupportSessionToken(secret, payload): Promise<string>`
  - `verifySupportSessionToken(secret, token, nowSeconds): Promise<SupportSessionTokenPayload | null>`

This mirrors `apps/worker/src/files/preview-token.ts` (the established cookieless HMAC token). Returns `null` for any failure — never throws.

- [ ] **Step 1: Write the failing test**

Create `apps/worker/src/support/support-session-token.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import {
  mintSupportSessionToken,
  verifySupportSessionToken,
  type SupportSessionTokenPayload,
} from "./support-session-token.ts";

const SECRET = "test-secret-value";
const payload: SupportSessionTokenPayload = {
  grantId: "supportGrant_1" as never,
  principalId: "platformStaff_1" as never,
  firmId: "firm_1" as never,
  requesterUserId: "user_1" as never,
  tier: "diagnostic",
  exp: 2_000_000_000,
};

describe("support-session token", () => {
  it("round-trips a valid token", async () => {
    const token = await mintSupportSessionToken(SECRET, payload);
    const verified = await verifySupportSessionToken(SECRET, token, 1_000_000_000);
    expect(verified).toEqual(payload);
  });

  it("rejects an expired token", async () => {
    const token = await mintSupportSessionToken(SECRET, payload);
    expect(await verifySupportSessionToken(SECRET, token, 2_000_000_001)).toBeNull();
  });

  it("rejects a wrong-secret signature", async () => {
    const token = await mintSupportSessionToken(SECRET, payload);
    expect(await verifySupportSessionToken("other-secret", token, 1_000_000_000)).toBeNull();
  });

  it("rejects a tampered body", async () => {
    const token = await mintSupportSessionToken(SECRET, payload);
    const tampered = `x${token}`;
    expect(await verifySupportSessionToken(SECRET, tampered, 1_000_000_000)).toBeNull();
  });

  it("rejects a malformed token", async () => {
    expect(await verifySupportSessionToken(SECRET, "no-dot", 1_000_000_000)).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @magna-carta/worker test -- support-session-token`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the token**

Create `apps/worker/src/support/support-session-token.ts`:

```typescript
import type {
  FirmId,
  PlatformStaffId,
  SupportGrantId,
  UserId,
} from "@magna-carta/identifiers/types";
import type { SupportGrantTier } from "@magna-carta/data-access/support-access-statements";
import { constantTimeStringEquals } from "../constant-time.ts";

// The bearer proof a staff principal presents after redeeming a grant. It is signed proof of "this
// principal redeemed this grant for this firm"; the live grant row (checked on every request) remains
// the source of truth for revocation and expiry. exp mirrors the grant's time-box.
export interface SupportSessionTokenPayload {
  readonly grantId: SupportGrantId;
  readonly principalId: PlatformStaffId;
  readonly firmId: FirmId;
  readonly requesterUserId: UserId;
  readonly tier: SupportGrantTier;
  readonly exp: number; // unix seconds
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function base64UrlEncode(bytes: ArrayBuffer | Uint8Array): string {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let binary = "";
  for (const byte of view) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64UrlDecodeToBytes(value: string): Uint8Array | null {
  try {
    const padded = value.replace(/-/g, "+").replace(/_/g, "/");
    const binary = atob(padded);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    return bytes;
  } catch {
    return null;
  }
}

async function signSegment(secret: string, segment: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(segment));
  return base64UrlEncode(signature);
}

export async function mintSupportSessionToken(
  secret: string,
  payload: SupportSessionTokenPayload,
): Promise<string> {
  const body = base64UrlEncode(encoder.encode(JSON.stringify(payload)));
  const signature = await signSegment(secret, body);
  return `${body}.${signature}`;
}

export async function verifySupportSessionToken(
  secret: string,
  token: string,
  nowSeconds: number,
): Promise<SupportSessionTokenPayload | null> {
  const dot = token.indexOf(".");
  if (dot <= 0 || dot === token.length - 1) return null;
  const body = token.slice(0, dot);
  const presentedSignature = token.slice(dot + 1);
  const recomputedSignature = await signSegment(secret, body);
  if (!(await constantTimeStringEquals(presentedSignature, recomputedSignature))) return null;
  const bytes = base64UrlDecodeToBytes(body);
  if (bytes === null) return null;
  let payload: SupportSessionTokenPayload;
  try {
    payload = JSON.parse(decoder.decode(bytes)) as SupportSessionTokenPayload;
  } catch {
    return null;
  }
  if (typeof payload.exp !== "number" || payload.exp < nowSeconds) return null;
  return payload;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @magna-carta/worker test -- support-session-token`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/worker/src/support/support-session-token.ts apps/worker/src/support/support-session-token.test.ts
git commit -m "feat(support): HMAC support-session bearer token mint/verify"
```

---

## Task 6: Permission registry keys + tier→permissions resolver

**Files:**

- Modify: `packages/access-control/src/registry.ts`
- Create: `apps/worker/src/support/tier-permissions.ts`
- Test: `apps/worker/src/support/tier-permissions.test.ts`
- Test (registry): `packages/access-control/test/registry.test.ts` (add a case if the file exists; otherwise fold the assertion into the tier-permissions test which imports the registry)

**Interfaces:**

- Consumes: `permissionsForNamespace`, `Permission` from `@magna-carta/access-control/registry`; `loadEffectivePermissions` from `../session-context.ts`; `SqlDatabase` from `@magna-carta/data-access/idempotency-statements`.
- Produces:
  - New registry keys: `support:request`, `support:cosign`, `support:manage`, `support:mintSession`, `diagnostics:overview`.
  - `DIAGNOSTIC_PERMISSIONS: ReadonlySet<Permission>` = all `diagnostics:*` keys.
  - `resolveSupportPermissions(tier, firmDatabase, requesterUserId): Promise<ReadonlySet<Permission>>`

- [ ] **Step 1: Add the permission keys**

In `packages/access-control/src/registry.ts`, append to the `PERMISSIONS` array (new namespaced block before the closing `] as const;`):

```typescript
  // Support access — a firm member requests time-boxed help-desk access; admins co-sign/manage it.
  "support:request", // request a support session (seeded to EVERY default role — any member may ask)
  "support:cosign", // co-sign a privileged support grant when firm policy requires it (admin)
  "support:manage", // revoke/oversee the firm's support grants (admin)
  "support:mintSession", // platform-level: redeem a grant for a session token (never seeded to a firm role)
  // Diagnostics — the read-only system-state surface a DIAGNOSTIC support session is scoped to. These
  // keys carry NO decrypt capability, so privileged content stays unreachable from a diagnostic session.
  // Never seeded to a firm role — granted only by holding a diagnostic support session.
  "diagnostics:overview", // firm system-state overview (status, schema version, member count, storage)
```

- [ ] **Step 2: Write the failing test**

Create `apps/worker/src/support/tier-permissions.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { DIAGNOSTIC_PERMISSIONS, resolveSupportPermissions } from "./tier-permissions.ts";

describe("tier permissions", () => {
  it("DIAGNOSTIC_PERMISSIONS is exactly the diagnostics namespace", () => {
    expect(DIAGNOSTIC_PERMISSIONS.has("diagnostics:overview" as never)).toBe(true);
    expect(DIAGNOSTIC_PERMISSIONS.has("support:request" as never)).toBe(false);
    expect(DIAGNOSTIC_PERMISSIONS.has("matters:create" as never)).toBe(false);
  });

  it("diagnostic tier returns the fixed diagnostics set without touching the firm DB", async () => {
    // A throwing fake proves the diagnostic branch never queries the DB.
    const throwingDb = {
      prepare() {
        throw new Error("diagnostic tier must not query the firm DB");
      },
    } as never;
    const set = await resolveSupportPermissions("diagnostic", throwingDb, "user_1" as never);
    expect(set).toBe(DIAGNOSTIC_PERMISSIONS);
  });

  it("privileged tier resolves against the requester's firm DB (queries member permissions)", async () => {
    // Privileged delegates to loadEffectivePermissions, which runs selectMemberPermissionsStatements
    // against the firm DB. Rather than spy on a named ESM import (which can fail to intercept), assert
    // the resolver QUERIES the provided database — a recording fake proves the firm-DB path is taken.
    const queried: string[] = [];
    const fakeDb = {
      prepare(sql: string) {
        queried.push(sql);
        return {
          bind() {
            return this;
          },
          async all() {
            return { results: [] as { permission: string }[] };
          },
        };
      },
    } as never;
    const set = await resolveSupportPermissions("privileged", fakeDb, "user_1" as never);
    expect(set).toBeInstanceOf(Set);
    expect(queried.some((sql) => sql.includes("permission"))).toBe(true);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm --filter @magna-carta/worker test -- tier-permissions`
Expected: FAIL — module not found.

- [ ] **Step 4: Implement the resolver**

Create `apps/worker/src/support/tier-permissions.ts`:

```typescript
import { type Permission, permissionsForNamespace } from "@magna-carta/access-control/registry";
import type { SqlDatabase } from "@magna-carta/data-access/idempotency-statements";
import type { SupportGrantTier } from "@magna-carta/data-access/support-access-statements";
import type { UserId } from "@magna-carta/identifiers/types";
import { loadEffectivePermissions } from "../session-context.ts";

// The whole diagnostics namespace — the fixed allow-list a diagnostic support session carries. It holds
// no view*/decrypt key, so the audited-decrypt gates never open from a diagnostic session.
export const DIAGNOSTIC_PERMISSIONS: ReadonlySet<Permission> = new Set(
  permissionsForNamespace("diagnostics"),
);

// Tier → permission set. Diagnostic is the fixed allow-list; privileged is EXACTLY the requester's own
// effective permissions (resolved against their firm) — no firm-level escalation, the user sharing
// their own view. Authority is keyed to the requester's id; the staff principal is recorded in audit.
export function resolveSupportPermissions(
  tier: SupportGrantTier,
  firmDatabase: SqlDatabase,
  requesterUserId: UserId,
): Promise<ReadonlySet<Permission>> | ReadonlySet<Permission> {
  return tier === "diagnostic"
    ? DIAGNOSTIC_PERMISSIONS
    : loadEffectivePermissions(firmDatabase, requesterUserId);
}
```

> Note: `resolveSupportPermissions` returns either a `Promise` (privileged) or the set directly (diagnostic); callers `await` it (awaiting a non-promise is a no-op). The Task 9 wiring awaits it.

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter @magna-carta/worker test -- tier-permissions`
Expected: PASS.

- [ ] **Step 6: Run the access-control registry fitness test**

Run: `pnpm --filter @magna-carta/access-control test`
Expected: PASS — the registry's internal cross-checks accept the new keys.

- [ ] **Step 7: Commit**

```bash
git add packages/access-control/src/registry.ts apps/worker/src/support/tier-permissions.ts apps/worker/src/support/tier-permissions.test.ts
git commit -m "feat(support): support:* + diagnostics:* permissions and tier resolver"
```

---

## Task 7: Per-firm migration — seed support permissions to roles

**Files:**

- Read first: `packages/database/test/generated-migrations.test.ts`, `apps/worker/src/per-firm-migrations.ts`, `packages/database/drizzle/per-firm/meta/_journal.json`, `packages/database/drizzle/per-firm/0002_member-rbac.sql`.
- Create: `packages/database/drizzle/per-firm/00NN_support-access-permissions.sql` (NN = next index)
- Modify: `packages/database/drizzle/per-firm/meta/_journal.json`
- Modify: `apps/worker/src/per-firm-migrations.ts`

**Interfaces:**

- Produces: `support:request` seeded to all five default roles; `support:cosign` + `support:manage` seeded to the Owner/Admin role. `support:mintSession` and `diagnostics:overview` are deliberately NOT seeded.

This is a **data-only** migration (INSERTs, no schema change) — `drizzle-kit generate` produces nothing for it, so it is hand-authored and hand-registered, exactly like the seeded role rows in `0002_member-rbac.sql`.

- [ ] **Step 1: Determine the next index and confirm the seeding mechanism**

Open `packages/database/drizzle/per-firm/meta/_journal.json`; find the highest `idx` (call it `L`) and the highest `NNNN_` tag. The new migration is `idx = L + 1`, file `0(L+1, zero-padded to 4)_support-access-permissions.sql`.
Open `apps/worker/src/per-firm-migrations.ts` and note the existing pattern (each migration is imported as `<name>Sql` and added to a `migrationsFromJournal({...})` map keyed by exact tag).
Open `packages/database/test/generated-migrations.test.ts` — confirm the permission-union test (`"every role_permission/direct_grant permission seeded by ANY committed migration is registered"`) and that it tolerates data-only INSERT migrations (it parses INSERT targets, not schema).

- [ ] **Step 2: Write the migration SQL**

Create `packages/database/drizzle/per-firm/00NN_support-access-permissions.sql` (substitute the real `NN`). The `role_` ids are the fixed default-role handles seeded in `0002_member-rbac.sql`; the `rolePermission_` ids are readable 21-character literals (matching the byte-for-byte-literal convention):

```sql
-- Seed support-access permissions onto the seeded default roles. support:request goes to EVERY role
-- (any member may ask for help); support:cosign + support:manage go to Owner/Admin only. The
-- diagnostics:* keys and support:mintSession are deliberately NOT seeded — diagnostics is granted only
-- by holding a diagnostic support session, and mintSession is platform-level. rolePermission_ handles
-- are committed literals so every firm's defaults match byte-for-byte.
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES
	('rolePermission_supRequestOwnerAdmin0', 'role_Gw-zKO8hOHQuNv2bWokMp', 'support:request'),
	('rolePermission_supRequestAttorney000', 'role_gEyJ_YqL1_RI_yDqSa28Y', 'support:request'),
	('rolePermission_supRequestParalegal00', 'role_917LCQyRKP50Z9bW89vXl', 'support:request'),
	('rolePermission_supRequestBilling0000', 'role_hwwC1D98d8Lazc_asL6vO', 'support:request'),
	('rolePermission_supRequestReadonly000', 'role_WojF9F7kksBEftsmZGNhb', 'support:request'),
	('rolePermission_supCosignOwnerAdmin00', 'role_Gw-zKO8hOHQuNv2bWokMp', 'support:cosign'),
	('rolePermission_supManageOwnerAdmin00', 'role_Gw-zKO8hOHQuNv2bWokMp', 'support:manage');
```

> Each `rolePermission_` token is exactly 21 base64url characters (matching the handle pattern). If the identifiers handle pattern rejects any token at test time, mint replacements with `newIdentifier("rolePermission")` and substitute them.

- [ ] **Step 3: Add the journal entry**

In `packages/database/drizzle/per-firm/meta/_journal.json`, append an entry to `entries` (use `idx = L + 1`, a `when` value strictly greater than the previous entry's, `version: "6"` to match siblings):

```json
    {
      "idx": <L+1>,
      "version": "6",
      "when": <previous-when + 1>,
      "tag": "00NN_support-access-permissions",
      "breakpoints": true
    }
```

- [ ] **Step 4: Register the migration in the worker loader**

In `apps/worker/src/per-firm-migrations.ts`, add the import (matching the file's existing style) and the map entry keyed by the exact tag:

```typescript
import supportAccessPermissionsSql from "@magna-carta/database/drizzle/per-firm/00NN_support-access-permissions.sql";
```

```typescript
    "00NN_support-access-permissions": supportAccessPermissionsSql,
```

- [ ] **Step 5: Run the database tests (permission-union gate)**

Run: `pnpm --filter @magna-carta/database test`
Expected: PASS — the permission-union test confirms every seeded permission is registered. If it reports an unregistered permission, you missed adding a key in Task 6.

- [ ] **Step 6: Commit**

```bash
git add packages/database/drizzle/per-firm apps/worker/src/per-firm-migrations.ts
git commit -m "feat(database): seed support:* permissions onto default firm roles"
```

---

## Task 8: Support-session resolution (header token → SessionContext)

**Files:**

- Modify: `apps/worker/src/session-context.ts` (extend `SessionContext`)
- Modify: `apps/worker/src/chokepoint/chokepoint.ts` (extend `ResolvedSession`)
- Create: `apps/worker/src/support/resolve-support-session.ts`
- Test: `apps/worker/test/resolve-support-session.test.ts`

**Interfaces:**

- Consumes: `verifySupportSessionToken`, `supportGrantUsable`, `selectSupportGrantStatement`, `SupportGrantRow`; `Bindings` from `../app.ts`; `assertIdentifier`.
- Produces:
  - `SupportPrincipal { grantId: SupportGrantId; principalId: PlatformStaffId; tier: SupportGrantTier }`
  - `SessionContext.support?: SupportPrincipal` and `ResolvedSession.support?: SupportPrincipal`
  - `resolveSupportSession(env: Bindings, c: Context, nowSeconds: number): Promise<SessionContext | null>` — reads the `X-Support-Session` header.

- [ ] **Step 1: Extend the session shapes**

In `apps/worker/src/session-context.ts`, add the support type and field:

```typescript
import type { PlatformStaffId, SupportGrantId } from "@magna-carta/identifiers/types";
import type { SupportGrantTier } from "@magna-carta/data-access/support-access-statements";

// A support principal riding the session: a named staff (later: agent) identity acting under a firm's
// time-boxed grant. Present only on support-session requests; absent for ordinary firm-member sessions.
export interface SupportPrincipal {
  readonly grantId: SupportGrantId;
  readonly principalId: PlatformStaffId;
  readonly tier: SupportGrantTier;
}

export interface SessionContext {
  readonly userId: UserId;
  readonly firmId: FirmId;
  readonly support?: SupportPrincipal;
}
```

In `apps/worker/src/chokepoint/chokepoint.ts`, mirror the optional field on `ResolvedSession` (keep it structurally compatible with `SessionContext`):

```typescript
export interface ResolvedSession {
  readonly userId: UserId;
  readonly firmId: FirmId;
  // Present when the principal is a support session (a staff identity under a firm grant). The
  // chokepoint threads it to loadPermissions to choose the tier-scoped permission set.
  readonly support?: {
    readonly grantId: import("@magna-carta/identifiers/types").SupportGrantId;
    readonly principalId: import("@magna-carta/identifiers/types").PlatformStaffId;
    readonly tier: import("@magna-carta/data-access/support-access-statements").SupportGrantTier;
  };
}
```

- [ ] **Step 2: Write the failing test**

Create `apps/worker/test/resolve-support-session.test.ts`:

```typescript
import { env } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import { newIdentifier } from "@magna-carta/identifiers";
import { applyControlPlaneMigrations } from "./support/apply-control-plane-migrations.ts";
import { seedFirm } from "./support/test-auth.ts";
import { resolveSupportSession } from "../src/support/resolve-support-session.ts";
import { mintSupportSessionToken } from "../src/support/support-session-token.ts";
import {
  insertSupportGrantStatement,
  redeemSupportGrantStatement,
} from "@magna-carta/data-access/support-access-statements";

beforeAll(async () => {
  await applyControlPlaneMigrations(env.DB_CONTROL);
});

function ctxWith(token: string | undefined): {
  req: { header: (n: string) => string | undefined };
  env: typeof env;
} {
  return {
    env,
    req: { header: (name: string) => (name === "X-Support-Session" ? token : undefined) },
  } as never;
}

async function seedActiveGrant(tier: "diagnostic" | "privileged") {
  const { firmId } = await seedFirm();
  const requesterUserId = newIdentifier("user");
  const grantId = newIdentifier("supportGrant");
  const principalId = newIdentifier("platformStaff");
  const now = new Date();
  const nowIso = now.toISOString();
  const expiresAt = new Date(now.getTime() + 3_600_000).toISOString();
  await insertSupportGrantStatement(env.DB_CONTROL as never, {
    id: grantId,
    firmId,
    requestedByUserId: requesterUserId,
    tier,
    status: "active",
    reason: null,
    requiresCosign: false,
    expiresAt,
    now: nowIso,
  }).run();
  await redeemSupportGrantStatement(env.DB_CONTROL as never, { id: grantId, principalId }).run();
  const token = await mintSupportSessionToken(env.AUTH_SECRET, {
    grantId,
    principalId,
    firmId,
    requesterUserId,
    tier,
    exp: Math.floor(Date.parse(expiresAt) / 1000),
  });
  return { firmId, requesterUserId, grantId, principalId, token, expiresAt };
}

describe("resolveSupportSession", () => {
  it("returns null with no header", async () => {
    const nowSeconds = Math.floor(Date.now() / 1000);
    expect(await resolveSupportSession(env, ctxWith(undefined) as never, nowSeconds)).toBeNull();
  });

  it("resolves an active grant to a support session (firm + requester from the grant row)", async () => {
    const seed = await seedActiveGrant("diagnostic");
    const nowSeconds = Math.floor(Date.now() / 1000);
    const session = await resolveSupportSession(env, ctxWith(seed.token) as never, nowSeconds);
    expect(session?.firmId).toBe(seed.firmId);
    expect(session?.userId).toBe(seed.requesterUserId);
    expect(session?.support?.tier).toBe("diagnostic");
    expect(session?.support?.principalId).toBe(seed.principalId);
  });

  it("rejects a token whose grant was revoked (live check)", async () => {
    const seed = await seedActiveGrant("diagnostic");
    await env.DB_CONTROL.prepare("UPDATE support_grant SET status = 'revoked' WHERE id = ?1")
      .bind(seed.grantId)
      .run();
    const nowSeconds = Math.floor(Date.now() / 1000);
    expect(await resolveSupportSession(env, ctxWith(seed.token) as never, nowSeconds)).toBeNull();
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm --filter @magna-carta/worker test -- resolve-support-session`
Expected: FAIL — module not found.

- [ ] **Step 4: Implement the resolver**

Create `apps/worker/src/support/resolve-support-session.ts`:

```typescript
import type { Context } from "hono";
import { assertIdentifier } from "@magna-carta/identifiers/validate";
import {
  selectSupportGrantStatement,
  type SupportGrantRow,
} from "@magna-carta/data-access/support-access-statements";
import type { Bindings } from "../app.ts";
import type { SessionContext } from "../session-context.ts";
import { supportGrantUsable } from "./grant-lifecycle.ts";
import { verifySupportSessionToken } from "./support-session-token.ts";

// Resolve a support-session principal from the X-Support-Session header, or null. The token is only the
// bearer proof; the live grant row is the source of truth — firm, requester, and tier come from the row
// (defense in depth), and a revoked/expired grant fails supportGrantUsable so access dies immediately.
export async function resolveSupportSession(
  env: Bindings,
  c: Context,
  nowSeconds: number,
): Promise<SessionContext | null> {
  const header = c.req.header("X-Support-Session");
  if (header === undefined || header === "") return null;
  const payload = await verifySupportSessionToken(env.AUTH_SECRET, header, nowSeconds);
  if (payload === null) return null;

  const result = await selectSupportGrantStatement(
    env.DB_CONTROL,
    payload.grantId,
  ).all<SupportGrantRow>();
  const grant = result.results[0];
  if (grant === undefined) return null;
  const nowIso = new Date(nowSeconds * 1000).toISOString();
  if (!supportGrantUsable(grant, nowIso)) return null;

  return {
    userId: assertIdentifier(grant.requested_by_user_id, "user"),
    firmId: assertIdentifier(grant.firm_id, "firm"),
    support: {
      grantId: assertIdentifier(grant.id, "supportGrant"),
      principalId: assertIdentifier(payload.principalId, "platformStaff"),
      tier: grant.tier,
    },
  };
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter @magna-carta/worker test -- resolve-support-session`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/worker/src/session-context.ts apps/worker/src/chokepoint/chokepoint.ts apps/worker/src/support/resolve-support-session.ts apps/worker/test/resolve-support-session.test.ts
git commit -m "feat(support): resolve support-session principal from signed token + live grant"
```

---

## Task 9: Thread support resolution + tier permissions through the chokepoint

**Files:**

- Modify: `apps/worker/src/chokepoint/chokepoint.ts` (the `loadPermissions` port signature + call site)
- Modify: `apps/worker/src/chokepoint/ports.ts` (support-aware `resolveSession`, `loadPermissions` wiring)
- Test: covered by existing chokepoint/auth regression tests + Task 14's end-to-end enforcement test.

**Interfaces:**

- Consumes: `resolveSupportSession` (Task 8), `resolveSupportPermissions` (Task 6), `resolveSession`/`loadEffectivePermissions` (existing).
- Produces: the chokepoint now (a) accepts a support-session principal via the `X-Support-Session` header and (b) computes the permission set by tier.

- [ ] **Step 1: Change the `loadPermissions` port signature**

In `apps/worker/src/chokepoint/chokepoint.ts`, change the port interface member (around the `ChokepointPorts` definition) from:

```typescript
loadPermissions: (firmContext: FirmContext, userId: UserId) => Promise<ReadonlySet<Permission>>;
```

to:

```typescript
loadPermissions: (firmContext: FirmContext, session: ResolvedSession) =>
  Promise<ReadonlySet<Permission>>;
```

And change the single call site (the RBAC step) from:

```typescript
const permissions = await ports.loadPermissions(firmContext, session.userId);
```

to:

```typescript
const permissions = await ports.loadPermissions(firmContext, session);
```

(`UserId` may become an unused import in this file — remove it if the linter flags it.)

- [ ] **Step 2: Make `resolveSession` support-aware in the port wiring**

In `apps/worker/src/chokepoint/ports.ts`, update the `resolveSession` port factory so it tries the support header first, then falls back to the Better Auth cookie. Locate the existing `resolveSession` wiring (it currently delegates to `session-context.resolveSession(authForEnv(env), c)`), and replace its body with:

```typescript
import { resolveSupportSession } from "../support/resolve-support-session.ts";
// ...
return async (c: Context): Promise<ResolvedSession | null> => {
  const env = (c as Context<{ Bindings: Bindings }>).env;
  const support = await resolveSupportSession(env, c, Math.floor(Date.now() / 1000));
  if (support !== null) return support;
  return resolveSession(authForEnv(env), c);
};
```

(Keep the existing `resolveSession`/`authForEnv` imports; add the `resolveSupportSession` import.)

- [ ] **Step 3: Make `loadPermissions` branch by tier**

In `apps/worker/src/chokepoint/ports.ts`, update `makeLoadPermissions` from:

```typescript
function makeLoadPermissions(): (
  firmContext: FirmContext,
  userId: ResolvedSession["userId"],
) => Promise<ReadonlySet<Permission>> {
  return (firmContext, userId) => loadEffectivePermissions(firmContext.firmDatabase, userId);
}
```

to:

```typescript
import { resolveSupportPermissions } from "../support/tier-permissions.ts";
// ...
function makeLoadPermissions(): (
  firmContext: FirmContext,
  session: ResolvedSession,
) => Promise<ReadonlySet<Permission>> {
  return async (firmContext, session) =>
    session.support === undefined
      ? loadEffectivePermissions(firmContext.firmDatabase, session.userId)
      : resolveSupportPermissions(session.support.tier, firmContext.firmDatabase, session.userId);
}
```

Update the wiring line `loadPermissions: makeLoadPermissions(),` if the property assignment's inferred type needs no change (it does not — only the function shape changed).

- [ ] **Step 4: Run the chokepoint + auth regression suites**

Run: `pnpm --filter @magna-carta/worker test -- chokepoint`
Run: `pnpm --filter @magna-carta/worker test -- auth`
Expected: PASS — ordinary firm-member sessions are unaffected (the `support === undefined` branch is the existing behavior). If a chokepoint unit test constructs `ports.loadPermissions` directly with a `userId`, update it to pass a `session` object `{ userId, firmId }`.

- [ ] **Step 5: Typecheck**

Run: `pnpm --filter @magna-carta/worker exec tsc --noEmit` (or `vp check`)
Expected: no type errors.

- [ ] **Step 6: Commit**

```bash
git add apps/worker/src/chokepoint/chokepoint.ts apps/worker/src/chokepoint/ports.ts
git commit -m "feat(support): chokepoint accepts support sessions and scopes permissions by tier"
```

---

## Task 10: Support audit helper

**Files:**

- Create: `apps/worker/src/support/support-audit.ts`
- Test: `apps/worker/test/support-audit.test.ts`

**Interfaces:**

- Consumes: `insertAuthAuditStatement` from `@magna-carta/data-access/auth-audit-statements`; `newIdentifier`.
- Produces: `writeSupportAudit(controlDb, { event, requesterUserId, metadata, now }): Promise<void>` — writes one `auth_audit` row. `metadata` carries ids/enums only (incl. `principalId` when a staff principal acted).

- [ ] **Step 1: Write the failing test**

Create `apps/worker/test/support-audit.test.ts`:

```typescript
import { env } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import { newIdentifier } from "@magna-carta/identifiers";
import { applyControlPlaneMigrations } from "./support/apply-control-plane-migrations.ts";
import { writeSupportAudit } from "../src/support/support-audit.ts";

beforeAll(async () => {
  await applyControlPlaneMigrations(env.DB_CONTROL);
});

describe("writeSupportAudit", () => {
  it("writes an auth_audit row with principal in metadata", async () => {
    const requesterUserId = newIdentifier("user");
    const grantId = newIdentifier("supportGrant");
    const principalId = newIdentifier("platformStaff");
    await writeSupportAudit(env.DB_CONTROL, {
      event: "support.grant.redeemed",
      requesterUserId,
      metadata: { grantId, principalId, tier: "diagnostic" },
      now: new Date().toISOString(),
    });
    const rows = await env.DB_CONTROL.prepare(
      "SELECT event, user_id, metadata FROM auth_audit WHERE user_id = ?1",
    )
      .bind(requesterUserId)
      .all<{ event: string; user_id: string; metadata: string }>();
    expect(rows.results[0]?.event).toBe("support.grant.redeemed");
    expect(JSON.parse(rows.results[0]?.metadata ?? "{}").principalId).toBe(principalId);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @magna-carta/worker test -- support-audit`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the helper**

Create `apps/worker/src/support/support-audit.ts`:

```typescript
import { newIdentifier } from "@magna-carta/identifiers";
import type { UserId } from "@magna-carta/identifiers/types";
import { insertAuthAuditStatement } from "@magna-carta/data-access/auth-audit-statements";
import type { SqlDatabase } from "@magna-carta/data-access/idempotency-statements";

// One audit row per support-grant lifecycle transition or session redemption. user_id is the requesting
// firm member (the consent anchor); the acting staff principal id rides in metadata. Metadata is ids +
// enums only — insertAuthAuditStatement runs the redaction guard.
export async function writeSupportAudit(
  controlDatabase: SqlDatabase,
  input: {
    readonly event: string;
    readonly requesterUserId: UserId;
    readonly metadata: Record<string, string>;
    readonly now: string;
  },
): Promise<void> {
  await insertAuthAuditStatement(controlDatabase, {
    id: newIdentifier("authAudit"),
    event: input.event,
    userId: input.requesterUserId,
    metadata: input.metadata,
    now: input.now,
  }).run();
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @magna-carta/worker test -- support-audit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/worker/src/support/support-audit.ts apps/worker/test/support-audit.test.ts
git commit -m "feat(support): support audit helper over the auth_audit lineage"
```

---

## Task 11: Grant request + list routes

**Files:**

- Create: `apps/worker/src/routes/support/support-grants.ts` (request + list; cosign/revoke added in Task 12)
- Modify: `apps/worker/src/app.ts` (register the route module)
- Test: `apps/worker/test/support-grants.test.ts`

**Interfaces:**

- Consumes: chokepoint accessors (`requireChokepointUserId`, `requireChokepointFirmId`), `defineOpenAPIRoute`, `chokepointMiddleware`, `problemJson`, the support-access statements, `writeSupportAudit`, `initialGrantStatus`/`computeExpiresAt`.
- Produces: `registerSupportGrantsRoutes(app, chokepoint)`; routes `POST /api/v1/support/grants`, `GET /api/v1/support/grants`.

- [ ] **Step 1: Write the failing test**

Create `apps/worker/test/support-grants.test.ts`:

```typescript
import { env, SELF } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import { applyControlPlaneMigrations } from "./support/apply-control-plane-migrations.ts";
import { applyPerFirmMigrations } from "./support/apply-per-firm-migrations.ts";
import { seedCredentialedUser, signInForSessionCookie } from "./support/test-auth.ts";

beforeAll(async () => {
  await applyControlPlaneMigrations(env.DB_CONTROL);
  await applyPerFirmMigrations(env.DB_FIRM_POOL_1);
});

// Helper: seed a member whose firm DB is POOL_1 and who holds a seeded role (so support:request resolves).
// Reuse the project's member-seeding helper that assigns a default role; if seedCredentialedUser does not
// assign a role + map the firm to POOL_1, follow members.test.ts's fuller seeding helper.

describe("support grants", () => {
  it("a firm member requests a diagnostic grant (201, active)", async () => {
    const {} = await seedCredentialedUser("req-diag@example.com", {
      firmDatabaseIdentifier: "DB_FIRM_POOL_1",
    });
    const cookie = await signInForSessionCookie("req-diag@example.com");
    const res = await SELF.fetch("https://example.com/api/v1/support/grants", {
      method: "POST",
      headers: { "content-type": "application/json", origin: "https://example.com", cookie },
      body: JSON.stringify({ tier: "diagnostic", reason: "page errors" }),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { id: string; status: string; tier: string };
    expect(body.status).toBe("active");
    expect(body.tier).toBe("diagnostic");
    expect(body.id.startsWith("supportGrant_")).toBe(true);
  });

  it("lists the firm's grants", async () => {
    const cookie = await signInForSessionCookie("req-diag@example.com");
    const res = await SELF.fetch("https://example.com/api/v1/support/grants", {
      headers: { origin: "https://example.com", cookie },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { grants: { id: string }[] };
    expect(body.grants.length).toBeGreaterThanOrEqual(1);
  });
});
```

> If `seedCredentialedUser` does not seed a default role membership or bind the firm to `DB_FIRM_POOL_1`, mirror the fuller seeding used in `apps/worker/test/members.test.ts` (which provisions a firm against a pool DB and assigns the Owner/Admin role). The key requirement: the member must resolve `support:request` (seeded to every role in Task 7).

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @magna-carta/worker test -- support-grants`
Expected: FAIL — route not registered (404) / module not found.

- [ ] **Step 3: Implement the request + list routes**

Create `apps/worker/src/routes/support/support-grants.ts`:

```typescript
import { z } from "@hono/zod-openapi";
import type { OpenAPIHono } from "@hono/zod-openapi";
import { newIdentifier } from "@magna-carta/identifiers";
import {
  insertSupportGrantStatement,
  selectFirmSupportGrantsStatement,
  type SupportGrantRow,
} from "@magna-carta/data-access/support-access-statements";
import type { Bindings } from "../app.ts";
import type { AppVariables } from "../chokepoint/ports.ts";
import type { Chokepoint } from "../chokepoint/chokepoint.ts";
import { chokepointMiddleware } from "../chokepoint/register.ts";
import {
  requireChokepointFirmId,
  requireChokepointUserId,
} from "../chokepoint/context-accessors.ts";
import { defineOpenAPIRoute, type RouteMeta } from "../contracts/route-meta.ts";
import { computeExpiresAt, initialGrantStatus } from "../support/grant-lifecycle.ts";
import { writeSupportAudit } from "../support/support-audit.ts";

const RequestGrantBody = z
  .object({
    tier: z.enum(["diagnostic", "privileged"]),
    reason: z.string().max(500).optional(),
  })
  .openapi("RequestSupportGrant");

const GrantSummary = z
  .object({
    id: z.string(),
    tier: z.enum(["diagnostic", "privileged"]),
    status: z.enum(["requested", "active", "revoked", "expired", "closed"]),
    requestedByUserId: z.string(),
    principalId: z.string().nullable(),
    requiresCosign: z.boolean(),
    expiresAt: z.string(),
    createdAt: z.string(),
  })
  .openapi("SupportGrantSummary");

export const requestGrantMeta: RouteMeta = {
  operationId: "support.grants.request",
  surface: "app",
  authenticated: true,
  permission: "support:request",
  resource: "firm",
  audited: true,
  idempotency: "optional",
  rateLimit: "default",
};

export const requestGrantRoute = defineOpenAPIRoute(requestGrantMeta, {
  method: "post",
  path: "/api/v1/support/grants",
  description:
    "A firm member requests time-boxed help-desk access to their firm. The request is the consent.",
  request: {
    body: { content: { "application/json": { schema: RequestGrantBody } }, required: true },
  },
  responses: {
    201: {
      description: "The created grant",
      content: { "application/json": { schema: GrantSummary } },
    },
    401: { description: "No valid session" },
    403: { description: "The session member lacks support:request" },
    404: { description: "The session's firm is not reachable" },
    422: { description: "The body failed validation" },
    429: { description: "Rate limit exceeded" },
  },
});

export const listGrantsMeta: RouteMeta = {
  operationId: "support.grants.list",
  surface: "app",
  authenticated: true,
  permission: null, // any authenticated member sees their firm's support grants (the transparency surface)
  resource: "firm",
  audited: false,
  idempotency: "optional",
  rateLimit: "default",
};

export const listGrantsRoute = defineOpenAPIRoute(listGrantsMeta, {
  method: "get",
  path: "/api/v1/support/grants",
  description:
    "The firm's support grants — who requested help, the scope, status, and the staff principal.",
  responses: {
    200: {
      description: "The firm's support grants, newest first",
      content: { "application/json": { schema: z.object({ grants: z.array(GrantSummary) }) } },
    },
    401: { description: "No valid session" },
    404: { description: "The session's firm is not reachable" },
    429: { description: "Rate limit exceeded" },
  },
});

function toSummary(row: SupportGrantRow) {
  return {
    id: row.id,
    tier: row.tier,
    status: row.status,
    requestedByUserId: row.requested_by_user_id,
    principalId: row.principal_id,
    requiresCosign: row.requires_cosign === 1,
    expiresAt: row.expires_at,
    createdAt: row.created_at,
  };
}

export function registerSupportGrantsRoutes(
  app: OpenAPIHono<{ Bindings: Bindings; Variables: AppVariables }>,
  chokepoint: Chokepoint,
): void {
  app.openapi(
    { ...requestGrantRoute, middleware: chokepointMiddleware(chokepoint, requestGrantRoute) },
    async (c) => {
      const requesterUserId = requireChokepointUserId(c);
      const firmId = requireChokepointFirmId(c);
      const { tier, reason } = c.req.valid("json");

      // Privileged requests honor the firm's co-sign policy; diagnostic never needs co-sign.
      const firmRow = await c.env.DB_CONTROL.prepare(
        "SELECT support_requires_cosign FROM firm WHERE id = ?1",
      )
        .bind(firmId)
        .first<{ support_requires_cosign: number }>();
      const requiresCosign = tier === "privileged" && (firmRow?.support_requires_cosign ?? 0) === 1;
      const status = initialGrantStatus(requiresCosign);

      const grantId = newIdentifier("supportGrant");
      const now = new Date().toISOString();
      const expiresAt = computeExpiresAt(tier, now);

      await insertSupportGrantStatement(c.env.DB_CONTROL, {
        id: grantId,
        firmId,
        requestedByUserId: requesterUserId,
        tier,
        status,
        reason: reason ?? null,
        requiresCosign,
        expiresAt,
        now,
      }).run();

      await writeSupportAudit(c.env.DB_CONTROL, {
        event: "support.grant.requested",
        requesterUserId,
        metadata: { grantId, firmId, tier, requiresCosign: String(requiresCosign) },
        now,
      });

      return c.json(
        {
          id: grantId,
          tier,
          status,
          requestedByUserId: requesterUserId,
          principalId: null,
          requiresCosign,
          expiresAt,
          createdAt: now,
        },
        201,
      );
    },
  );

  app.openapi(
    { ...listGrantsRoute, middleware: chokepointMiddleware(chokepoint, listGrantsRoute) },
    async (c) => {
      const firmId = requireChokepointFirmId(c);
      const result = await selectFirmSupportGrantsStatement(
        c.env.DB_CONTROL,
        firmId,
      ).all<SupportGrantRow>();
      return c.json({ grants: result.results.map(toSummary) }, 200);
    },
  );
}
```

- [ ] **Step 4: Register the routes**

In `apps/worker/src/app.ts`, add the import and call alongside the other `register…Route(app, chokepoint)` calls:

```typescript
import { registerSupportGrantsRoutes } from "./routes/support/support-grants.ts";
// ... within createApp, with the other registrations:
registerSupportGrantsRoutes(app, chokepoint);
```

- [ ] **Step 5: Re-emit the OpenAPI contract + regenerate the client**

Run: `pnpm --filter @magna-carta/worker run emit-openapi`
Run: `pnpm --filter @magna-carta/api-client run generate`
If the API conformance suite maintains a "not-vacuous operation list", add `support.grants.request` and `support.grants.list` to it (check `apps/worker/test` for the conformance test that lists operations).

- [ ] **Step 6: Run test to verify it passes**

Run: `pnpm --filter @magna-carta/worker test -- support-grants`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/worker/src/routes/support/support-grants.ts apps/worker/src/app.ts apps/worker/openapi/openapi.json packages/api-client apps/worker/test/support-grants.test.ts
git commit -m "feat(support): request + list support-grant routes"
```

---

## Task 12: Cosign + revoke routes

**Files:**

- Modify: `apps/worker/src/routes/support/support-grants.ts` (add cosign + revoke)
- Test: `apps/worker/test/support-grants-manage.test.ts`

**Interfaces:**

- Consumes: `cosignSupportGrantStatement`, `revokeSupportGrantStatement`, `selectSupportGrantStatement`.
- Produces: routes `POST /api/v1/support/grants/{grantId}/cosign`, `POST /api/v1/support/grants/{grantId}/revoke`, registered by the existing `registerSupportGrantsRoutes`.

- [ ] **Step 1: Write the failing test**

Create `apps/worker/test/support-grants-manage.test.ts`:

```typescript
import { env, SELF } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import { newIdentifier } from "@magna-carta/identifiers";
import { applyControlPlaneMigrations } from "./support/apply-control-plane-migrations.ts";
import { applyPerFirmMigrations } from "./support/apply-per-firm-migrations.ts";
import { seedCredentialedUser, signInForSessionCookie } from "./support/test-auth.ts";
import { insertSupportGrantStatement } from "@magna-carta/data-access/support-access-statements";

beforeAll(async () => {
  await applyControlPlaneMigrations(env.DB_CONTROL);
  await applyPerFirmMigrations(env.DB_FIRM_POOL_1);
});

describe("support grant management", () => {
  it("an admin revokes an active grant (200, revoked)", async () => {
    // Seed an Owner/Admin member (holds support:manage). Mirror members.test.ts seeding to assign the role.
    const { userId, firmId } = await seedCredentialedUser("mgr@example.com", {
      firmDatabaseIdentifier: "DB_FIRM_POOL_1",
    });
    const grantId = newIdentifier("supportGrant");
    const now = new Date().toISOString();
    await insertSupportGrantStatement(env.DB_CONTROL as never, {
      id: grantId,
      firmId,
      requestedByUserId: userId,
      tier: "diagnostic",
      status: "active",
      reason: null,
      requiresCosign: false,
      expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
      now,
    }).run();
    const cookie = await signInForSessionCookie("mgr@example.com");
    const res = await SELF.fetch(`https://example.com/api/v1/support/grants/${grantId}/revoke`, {
      method: "POST",
      headers: { origin: "https://example.com", cookie, "content-type": "application/json" },
      body: "{}",
    });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { status: string }).status).toBe("revoked");
  });

  it("revoke of another firm's grant is 404", async () => {
    const cookie = await signInForSessionCookie("mgr@example.com");
    const res = await SELF.fetch(
      `https://example.com/api/v1/support/grants/${newIdentifier("supportGrant")}/revoke`,
      {
        method: "POST",
        headers: { origin: "https://example.com", cookie, "content-type": "application/json" },
        body: "{}",
      },
    );
    expect(res.status).toBe(404);
  });
});
```

> The admin seeding must assign the Owner/Admin role so `support:manage`/`support:cosign` resolve. Follow `members.test.ts`'s role assignment.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @magna-carta/worker test -- support-grants-manage`
Expected: FAIL — routes not registered (404 for the cosign/revoke paths, but the "another firm" case may already 404; the active-revoke case will 404 until implemented).

- [ ] **Step 3: Implement cosign + revoke**

In `apps/worker/src/routes/support/support-grants.ts`, add the imports:

```typescript
import {
  cosignSupportGrantStatement,
  revokeSupportGrantStatement,
  selectSupportGrantStatement,
} from "@magna-carta/data-access/support-access-statements";
import { problemJson } from "../contracts/problem.ts";
```

Add the metas + routes (after the list route definition):

```typescript
const GrantStatusResult = z
  .object({ id: z.string(), status: z.string() })
  .openapi("SupportGrantStatusResult");

export const cosignGrantMeta: RouteMeta = {
  operationId: "support.grants.cosign",
  surface: "app",
  authenticated: true,
  permission: "support:cosign",
  resource: "firm",
  audited: true,
  idempotency: "optional",
  rateLimit: "default",
};

export const cosignGrantRoute = defineOpenAPIRoute(cosignGrantMeta, {
  method: "post",
  path: "/api/v1/support/grants/{grantId}/cosign",
  description: "An admin co-signs a privileged support grant that firm policy held for approval.",
  request: { params: z.object({ grantId: z.string() }) },
  responses: {
    200: {
      description: "The grant after co-sign",
      content: { "application/json": { schema: GrantStatusResult } },
    },
    401: { description: "No valid session" },
    403: { description: "The session member lacks support:cosign" },
    404: { description: "No such grant in this firm, or it is not awaiting co-sign" },
    429: { description: "Rate limit exceeded" },
  },
});

export const revokeGrantMeta: RouteMeta = {
  operationId: "support.grants.revoke",
  surface: "app",
  authenticated: true,
  permission: "support:manage",
  resource: "firm",
  audited: true,
  idempotency: "optional",
  rateLimit: "default",
};

export const revokeGrantRoute = defineOpenAPIRoute(revokeGrantMeta, {
  method: "post",
  path: "/api/v1/support/grants/{grantId}/revoke",
  description:
    "An admin revokes a support grant; in-flight support access ends on the next request.",
  request: { params: z.object({ grantId: z.string() }) },
  responses: {
    200: {
      description: "The grant after revoke",
      content: { "application/json": { schema: GrantStatusResult } },
    },
    401: { description: "No valid session" },
    403: { description: "The session member lacks support:manage" },
    404: { description: "No such grant in this firm, or it is already terminal" },
    429: { description: "Rate limit exceeded" },
  },
});
```

Inside `registerSupportGrantsRoutes`, add the two handlers. Both load the grant, enforce the firm match (a firm can only manage its own grants — a mismatch is a 404, never an existence oracle), apply the guarded UPDATE, and audit:

```typescript
app.openapi(
  { ...cosignGrantRoute, middleware: chokepointMiddleware(chokepoint, cosignGrantRoute) },
  async (c) => {
    const firmId = requireChokepointFirmId(c);
    const cosignedByUserId = requireChokepointUserId(c);
    const grantId = c.req.valid("param").grantId as never;
    const row = (
      await selectSupportGrantStatement(c.env.DB_CONTROL, grantId).all<SupportGrantRow>()
    ).results[0];
    if (row === undefined || row.firm_id !== firmId) {
      return problemJson(c, { type: "not-found", status: 404, title: "Not found" });
    }
    const update = await cosignSupportGrantStatement(c.env.DB_CONTROL, {
      id: grantId,
      cosignedByUserId,
    }).run();
    if (update.meta.changes === 0) {
      return problemJson(c, { type: "not-found", status: 404, title: "Not awaiting co-sign" });
    }
    const now = new Date().toISOString();
    await writeSupportAudit(c.env.DB_CONTROL, {
      event: "support.grant.cosigned",
      requesterUserId: row.requested_by_user_id,
      metadata: { grantId, firmId, cosignedByUserId },
      now,
    });
    return c.json({ id: grantId, status: "active" }, 200);
  },
);

app.openapi(
  { ...revokeGrantRoute, middleware: chokepointMiddleware(chokepoint, revokeGrantRoute) },
  async (c) => {
    const firmId = requireChokepointFirmId(c);
    const actingUserId = requireChokepointUserId(c);
    const grantId = c.req.valid("param").grantId as never;
    const row = (
      await selectSupportGrantStatement(c.env.DB_CONTROL, grantId).all<SupportGrantRow>()
    ).results[0];
    if (row === undefined || row.firm_id !== firmId) {
      return problemJson(c, { type: "not-found", status: 404, title: "Not found" });
    }
    const update = await revokeSupportGrantStatement(c.env.DB_CONTROL, { id: grantId }).run();
    if (update.meta.changes === 0) {
      return problemJson(c, { type: "not-found", status: 404, title: "Already terminal" });
    }
    const now = new Date().toISOString();
    await writeSupportAudit(c.env.DB_CONTROL, {
      event: "support.grant.revoked",
      requesterUserId: row.requested_by_user_id,
      metadata: { grantId, firmId, revokedByUserId: actingUserId },
      now,
    });
    return c.json({ id: grantId, status: "revoked" }, 200);
  },
);
```

- [ ] **Step 4: Re-emit contract + regenerate client**

Run: `pnpm --filter @magna-carta/worker run emit-openapi`
Run: `pnpm --filter @magna-carta/api-client run generate`
Add `support.grants.cosign` and `support.grants.revoke` to the conformance operation list if one exists.

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter @magna-carta/worker test -- support-grants-manage`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/worker/src/routes/support/support-grants.ts apps/worker/openapi/openapi.json packages/api-client apps/worker/test/support-grants-manage.test.ts
git commit -m "feat(support): co-sign + revoke support-grant routes"
```

---

## Task 13: Staff redeem route (mint the support-session token)

**Files:**

- Create: `apps/worker/src/routes/support/support-sessions.ts`
- Modify: `apps/worker/src/app.ts` (register)
- Test: `apps/worker/test/support-sessions.test.ts`

**Interfaces:**

- Consumes: `platformAdminGuard` (re-exported from `./firms.ts`), `selectSupportGrantStatement`, `selectPlatformStaffStatement`, `redeemSupportGrantStatement`, `supportGrantUsable`, `mintSupportSessionToken`, `writeSupportAudit`.
- Produces: `registerSupportSessionsRoute(app, chokepoint)`; route `POST /api/v1/support/sessions` (public surface, platform-admin-gated interim).

- [ ] **Step 1: Write the failing test**

Create `apps/worker/test/support-sessions.test.ts`:

```typescript
import { env, SELF } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import { newIdentifier } from "@magna-carta/identifiers";
import { applyControlPlaneMigrations } from "./support/apply-control-plane-migrations.ts";
import { seedFirm } from "./support/test-auth.ts";
import {
  insertPlatformStaffStatement,
  insertSupportGrantStatement,
} from "@magna-carta/data-access/support-access-statements";

beforeAll(async () => {
  await applyControlPlaneMigrations(env.DB_CONTROL);
});

async function seedStaff(role: "support" | "support_lead") {
  const id = newIdentifier("platformStaff");
  await insertPlatformStaffStatement(env.DB_CONTROL as never, {
    id,
    email: `${id}@staff.example`,
    displayName: "Staff",
    role,
    now: new Date().toISOString(),
  }).run();
  return id;
}

async function seedActiveGrant(tier: "diagnostic" | "privileged") {
  const { firmId } = await seedFirm();
  const grantId = newIdentifier("supportGrant");
  await insertSupportGrantStatement(env.DB_CONTROL as never, {
    id: grantId,
    firmId,
    requestedByUserId: newIdentifier("user"),
    tier,
    status: "active",
    reason: null,
    requiresCosign: false,
    expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
    now: new Date().toISOString(),
  }).run();
  return grantId;
}

function redeem(body: unknown, withKey = true) {
  return SELF.fetch("https://example.com/api/v1/support/sessions", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "Idempotency-Key": crypto.randomUUID(),
      ...(withKey ? { "X-Platform-Admin-Key": "test-key-placeholder" } : {}),
    },
    body: JSON.stringify(body),
  });
}

describe("staff redeem", () => {
  it("mints a token for a support principal on a diagnostic grant", async () => {
    const principalId = await seedStaff("support");
    const grantId = await seedActiveGrant("diagnostic");
    const res = await redeem({ grantId, principalId });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { token: string; tier: string };
    expect(body.tier).toBe("diagnostic");
    expect(body.token.includes(".")).toBe(true);
  });

  it("rejects a privileged grant for a non-lead principal (403)", async () => {
    const principalId = await seedStaff("support");
    const grantId = await seedActiveGrant("privileged");
    const res = await redeem({ grantId, principalId });
    expect(res.status).toBe(403);
  });

  it("requires the platform-admin key (401 without it)", async () => {
    const principalId = await seedStaff("support");
    const grantId = await seedActiveGrant("diagnostic");
    const res = await redeem({ grantId, principalId }, false);
    expect(res.status).toBe(401);
  });
});
```

> `"test-key-placeholder"` is the platform-admin key the test wrangler config sets for `PLATFORM_ADMIN_KEY` (confirm the value in `apps/worker/wrangler.jsonc` / the test vars; `auth-provisioning-e2e.test.ts` uses the same).

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @magna-carta/worker test -- support-sessions`
Expected: FAIL — route not registered.

- [ ] **Step 3: Implement the redeem route**

Create `apps/worker/src/routes/support/support-sessions.ts`:

```typescript
import { z } from "@hono/zod-openapi";
import type { OpenAPIHono } from "@hono/zod-openapi";
import type { MiddlewareHandler } from "hono";
import {
  redeemSupportGrantStatement,
  selectPlatformStaffStatement,
  selectSupportGrantStatement,
  type PlatformStaffRow,
  type SupportGrantRow,
} from "@magna-carta/data-access/support-access-statements";
import type { Bindings } from "../app.ts";
import type { AppVariables } from "../chokepoint/ports.ts";
import type { Chokepoint } from "../chokepoint/chokepoint.ts";
import { chokepointMiddleware } from "../chokepoint/register.ts";
import { defineOpenAPIRoute, type RouteMeta } from "../contracts/route-meta.ts";
import { problemJson } from "../contracts/problem.ts";
import { platformAdminGuard } from "./firms.ts";
import { supportGrantUsable } from "../support/grant-lifecycle.ts";
import { mintSupportSessionToken } from "../support/support-session-token.ts";
import { writeSupportAudit } from "../support/support-audit.ts";

const RedeemBody = z
  .object({ grantId: z.string(), principalId: z.string() })
  .openapi("RedeemSupportSession");

const RedeemResult = z
  .object({
    token: z.string(),
    tier: z.enum(["diagnostic", "privileged"]),
    firmId: z.string(),
    expiresAt: z.string(),
  })
  .openapi("SupportSessionMinted");

export const redeemSessionMeta: RouteMeta = {
  operationId: "support.sessions.redeem",
  surface: "public", // platform-staff side: no firm session. Interim guard is the platform-admin key.
  authenticated: true,
  permission: "support:mintSession",
  resource: "firm",
  audited: true,
  idempotency: "required",
  rateLimit: "auth",
};

export const redeemSessionRoute = defineOpenAPIRoute(redeemSessionMeta, {
  method: "post",
  path: "/api/v1/support/sessions",
  description:
    "A platform-staff principal redeems an active grant for a short-lived support-session token.",
  request: { body: { content: { "application/json": { schema: RedeemBody } }, required: true } },
  responses: {
    201: {
      description: "The minted support-session token",
      content: { "application/json": { schema: RedeemResult } },
    },
    400: { description: "Missing Idempotency-Key" },
    401: { description: "Missing or invalid platform-admin key" },
    403: { description: "Principal may not redeem this tier" },
    404: { description: "No redeemable grant, or unknown/disabled principal" },
    422: { description: "The body failed validation" },
    429: { description: "Rate limit exceeded" },
  },
});

export function registerSupportSessionsRoute(
  app: OpenAPIHono<{ Bindings: Bindings; Variables: AppVariables }>,
  chokepoint: Chokepoint,
): void {
  app.openapi(
    {
      ...redeemSessionRoute,
      middleware: chokepointMiddleware(chokepoint, redeemSessionRoute, [
        platformAdminGuard as MiddlewareHandler,
      ]),
    },
    async (c) => {
      const { grantId, principalId } = c.req.valid("json");
      const now = new Date().toISOString();
      const nowSeconds = Math.floor(Date.parse(now) / 1000);

      const grant = (
        await selectSupportGrantStatement(c.env.DB_CONTROL, grantId as never).all<SupportGrantRow>()
      ).results[0];
      if (grant === undefined || !supportGrantUsable(grant, now)) {
        return problemJson(c, { type: "not-found", status: 404, title: "No redeemable grant" });
      }

      const principal = (
        await selectPlatformStaffStatement(
          c.env.DB_CONTROL,
          principalId as never,
        ).all<PlatformStaffRow>()
      ).results[0];
      if (principal === undefined || principal.status !== "active") {
        return problemJson(c, { type: "not-found", status: 404, title: "Unknown principal" });
      }
      if (grant.tier === "privileged" && principal.role !== "support_lead") {
        return problemJson(c, {
          type: "permission-denied",
          status: 403,
          title: "Principal may not redeem a privileged grant",
        });
      }

      await redeemSupportGrantStatement(c.env.DB_CONTROL, {
        id: grant.id,
        principalId: principal.id,
      }).run();

      const token = await mintSupportSessionToken(c.env.AUTH_SECRET, {
        grantId: grant.id,
        principalId: principal.id,
        firmId: grant.firm_id,
        requesterUserId: grant.requested_by_user_id,
        tier: grant.tier,
        exp: Math.floor(Date.parse(grant.expires_at) / 1000),
      });

      await writeSupportAudit(c.env.DB_CONTROL, {
        event: "support.grant.redeemed",
        requesterUserId: grant.requested_by_user_id,
        metadata: {
          grantId: grant.id,
          principalId: principal.id,
          firmId: grant.firm_id,
          tier: grant.tier,
        },
        now,
      });

      return c.json(
        { token, tier: grant.tier, firmId: grant.firm_id, expiresAt: grant.expires_at },
        201,
      );
    },
  );
}
```

> `nowSeconds` is computed for parity with the token's `exp`; the grant-usable check uses the ISO `now`.

- [ ] **Step 4: Register the route**

In `apps/worker/src/app.ts`:

```typescript
import { registerSupportSessionsRoute } from "./routes/support/support-sessions.ts";
// ... within createApp:
registerSupportSessionsRoute(app, chokepoint);
```

- [ ] **Step 5: Re-emit contract + regenerate client**

Run: `pnpm --filter @magna-carta/worker run emit-openapi`
Run: `pnpm --filter @magna-carta/api-client run generate`
Add `support.sessions.redeem` to the conformance operation list if one exists.

- [ ] **Step 6: Run test to verify it passes**

Run: `pnpm --filter @magna-carta/worker test -- support-sessions`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/worker/src/routes/support/support-sessions.ts apps/worker/src/app.ts apps/worker/openapi/openapi.json packages/api-client apps/worker/test/support-sessions.test.ts
git commit -m "feat(support): staff redeem route mints a support-session token"
```

---

## Task 14: Diagnostics overview route + end-to-end enforcement

**Files:**

- Create: `apps/worker/src/routes/support/support-diagnostics.ts`
- Modify: `apps/worker/src/app.ts` (register)
- Test: `apps/worker/test/support-diagnostics.e2e.test.ts`

**Interfaces:**

- Produces: `registerSupportDiagnosticsRoute(app, chokepoint)`; route `GET /api/v1/support/diagnostics/overview` gated by `diagnostics:overview`.

This task proves the rails end-to-end: a normal member is denied the diagnostic surface (403), a diagnostic support session is allowed (200), and a revoked grant's token is denied.

- [ ] **Step 1: Write the failing test**

Create `apps/worker/test/support-diagnostics.e2e.test.ts`:

```typescript
import { env, SELF } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import { applyControlPlaneMigrations } from "./support/apply-control-plane-migrations.ts";
import { applyPerFirmMigrations } from "./support/apply-per-firm-migrations.ts";
import { seedCredentialedUser, signInForSessionCookie } from "./support/test-auth.ts";

beforeAll(async () => {
  await applyControlPlaneMigrations(env.DB_CONTROL);
  await applyPerFirmMigrations(env.DB_FIRM_POOL_1);
});

const DIAG = "https://example.com/api/v1/support/diagnostics/overview";

async function openDiagnosticSession(cookie: string): Promise<string> {
  // 1) member requests a diagnostic grant
  const reqRes = await SELF.fetch("https://example.com/api/v1/support/grants", {
    method: "POST",
    headers: { "content-type": "application/json", origin: "https://example.com", cookie },
    body: JSON.stringify({ tier: "diagnostic", reason: "diagnose" }),
  });
  const grant = (await reqRes.json()) as { id: string };
  // 2) seed a staff principal and redeem (platform-admin gated)
  const principalId = `platformStaff_${crypto.randomUUID().replace(/-/g, "").slice(0, 21)}`;
  await env.DB_CONTROL.prepare(
    "INSERT INTO platform_staff (id, email, display_name, role, status, created_at) VALUES (?1, ?2, 'S', 'support', 'active', ?3)",
  )
    .bind(principalId, `${principalId}@staff.example`, new Date().toISOString())
    .run();
  const redeemRes = await SELF.fetch("https://example.com/api/v1/support/sessions", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "Idempotency-Key": crypto.randomUUID(),
      "X-Platform-Admin-Key": "test-key-placeholder",
    },
    body: JSON.stringify({ grantId: grant.id, principalId }),
  });
  return ((await redeemRes.json()) as { token: string }).token;
}

describe("diagnostic support session enforcement", () => {
  it("a normal member is denied the diagnostic surface (403)", async () => {
    await seedCredentialedUser("diag-member@example.com", {
      firmDatabaseIdentifier: "DB_FIRM_POOL_1",
    });
    const cookie = await signInForSessionCookie("diag-member@example.com");
    const res = await SELF.fetch(DIAG, { headers: { origin: "https://example.com", cookie } });
    expect(res.status).toBe(403);
  });

  it("a diagnostic support session is allowed (200)", async () => {
    const cookie = await signInForSessionCookie("diag-member@example.com");
    const token = await openDiagnosticSession(cookie);
    const res = await SELF.fetch(DIAG, { headers: { "X-Support-Session": token } });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { firmStatus: string };
    expect(typeof body.firmStatus).toBe("string");
  });

  it("a revoked grant's token is denied (401)", async () => {
    const cookie = await signInForSessionCookie("diag-member@example.com");
    const token = await openDiagnosticSession(cookie);
    // revoke every active grant for the firm
    await env.DB_CONTROL.prepare(
      "UPDATE support_grant SET status = 'revoked' WHERE status = 'active'",
    ).run();
    const res = await SELF.fetch(DIAG, { headers: { "X-Support-Session": token } });
    expect(res.status).toBe(401);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @magna-carta/worker test -- support-diagnostics`
Expected: FAIL — route not registered (404 instead of 200/403).

- [ ] **Step 3: Implement the diagnostic overview route**

Create `apps/worker/src/routes/support/support-diagnostics.ts`:

```typescript
import { z } from "@hono/zod-openapi";
import type { OpenAPIHono } from "@hono/zod-openapi";
import type { Bindings } from "../app.ts";
import type { AppVariables } from "../chokepoint/ports.ts";
import type { Chokepoint } from "../chokepoint/chokepoint.ts";
import { chokepointMiddleware } from "../chokepoint/register.ts";
import {
  requireChokepointFirmContext,
  requireChokepointFirmId,
} from "../chokepoint/context-accessors.ts";
import { defineOpenAPIRoute, type RouteMeta } from "../contracts/route-meta.ts";

const Overview = z
  .object({
    firmId: z.string(),
    firmStatus: z.string(),
    perFirmSchemaVersion: z.string().nullable(),
    bucketProvisioned: z.boolean(),
    activeMemberCount: z.number().int(),
  })
  .openapi("SupportDiagnosticOverview");

export const diagnosticOverviewMeta: RouteMeta = {
  operationId: "support.diagnostics.overview",
  surface: "app",
  authenticated: true,
  permission: "diagnostics:overview", // never seeded to a firm role — only a diagnostic support session holds it
  resource: "firm",
  audited: false,
  idempotency: "optional",
  rateLimit: "default",
};

export const diagnosticOverviewRoute = defineOpenAPIRoute(diagnosticOverviewMeta, {
  method: "get",
  path: "/api/v1/support/diagnostics/overview",
  description:
    "Non-privileged firm system state for help-desk diagnosis: status, schema version, storage, member count.",
  responses: {
    200: {
      description: "The firm system-state overview",
      content: { "application/json": { schema: Overview } },
    },
    401: { description: "No valid session" },
    403: { description: "The principal lacks diagnostics:overview" },
    404: { description: "The firm is not reachable" },
    429: { description: "Rate limit exceeded" },
  },
});

export function registerSupportDiagnosticsRoute(
  app: OpenAPIHono<{ Bindings: Bindings; Variables: AppVariables }>,
  chokepoint: Chokepoint,
): void {
  app.openapi(
    {
      ...diagnosticOverviewRoute,
      middleware: chokepointMiddleware(chokepoint, diagnosticOverviewRoute),
    },
    async (c) => {
      const firmId = requireChokepointFirmId(c);
      const { firmDatabase, bucketName } = requireChokepointFirmContext(c);
      const firmRow = await c.env.DB_CONTROL.prepare(
        "SELECT status, per_firm_schema_version FROM firm WHERE id = ?1",
      )
        .bind(firmId)
        .first<{ status: string; per_firm_schema_version: string | null }>();
      const memberCount = await firmDatabase
        .prepare("SELECT COUNT(*) AS n FROM member WHERE status = 'active'")
        .first<{ n: number }>();
      return c.json(
        {
          firmId,
          firmStatus: firmRow?.status ?? "unknown",
          perFirmSchemaVersion: firmRow?.per_firm_schema_version ?? null,
          bucketProvisioned: bucketName !== null,
          activeMemberCount: memberCount?.n ?? 0,
        },
        200,
      );
    },
  );
}
```

- [ ] **Step 4: Register the route**

In `apps/worker/src/app.ts`:

```typescript
import { registerSupportDiagnosticsRoute } from "./routes/support/support-diagnostics.ts";
// ... within createApp:
registerSupportDiagnosticsRoute(app, chokepoint);
```

- [ ] **Step 5: Re-emit contract + regenerate client**

Run: `pnpm --filter @magna-carta/worker run emit-openapi`
Run: `pnpm --filter @magna-carta/api-client run generate`
Add `support.diagnostics.overview` to the conformance operation list if one exists.

- [ ] **Step 6: Run test to verify it passes**

Run: `pnpm --filter @magna-carta/worker test -- support-diagnostics`
Expected: PASS — proves: normal member 403, diagnostic session 200, revoked token 401.

- [ ] **Step 7: Run the full worker suite + quality gate**

Run: `pnpm --filter @magna-carta/worker test`
Run: `pnpm check`
Expected: PASS (watch for the Miniflare OOM gotcha — re-run the worker suite alone if the combined run is memory-heavy).

- [ ] **Step 8: Commit**

```bash
git add apps/worker/src/routes/support/support-diagnostics.ts apps/worker/src/app.ts apps/worker/openapi/openapi.json packages/api-client apps/worker/test/support-diagnostics.e2e.test.ts
git commit -m "feat(support): diagnostic overview route + end-to-end tier enforcement"
```

---

## Task 15: Documentation, decision record, and status

**Files:**

- Create: `docs/decisions/pending/support-access-framework.md` (ADR fragment)
- Create: `changelog.d/support-access-framework.md` (changelog fragment)
- Modify: `STATUS.md` (the support-access slice row — your own row only)
- Modify: `ROADMAP.md` (note the backend rails landed; UI/notification/staff-auth/agent seams deferred)
- Modify: `docs/active-work/support-access-framework.md` (flip status to built-pending-review)

**Interfaces:** none (docs).

- [ ] **Step 1: Sync main and check for cross-cutting overlap**

Run: `git -C C:/dev/magna-carta-worktrees/support-access-framework fetch && vp run worktrees`
Expected: review other in-flight streams before editing `STATUS.md` / `ROADMAP.md`. If `main` has advanced materially, merge it into this branch before editing shared files.

- [ ] **Step 2: Write the ADR fragment**

Create `docs/decisions/pending/support-access-framework.md` following the existing fragments in `docs/decisions/pending/` (copy the frontmatter shape from a sibling). Record the decision: pull-not-push support access; named `platform_staff` principal redeems a time-boxed `support_grant`; diagnostic vs. privileged-self-scoped tiers enforced through the chokepoint; the safe-Sense-1 "temporary grant, not handed-over crypto key" choice; staff-auth/UI/notification/agent deferred. Reference files by path, not section numbers.

- [ ] **Step 3: Write the changelog fragment**

Create `changelog.d/support-access-framework.md` matching the format of existing entries in `changelog.d/` (one concise user-facing line under the right category, e.g. "Added — Support access framework (backend rails): firms can grant time-boxed, audited help-desk access").

- [ ] **Step 4: Update STATUS.md and ROADMAP.md**

In `STATUS.md`, add/update only the support-access slice row (spec → plan → built → tested as appropriate). In `ROADMAP.md`, note the backend rails landed and the deferred seams (staff self-service auth + MFA, UI/support console + privileged view-as, notification transport, AI-agent principals, settings-registry promotion of the co-sign policy, per-request fine-grained audit).

- [ ] **Step 5: Update the active-work note**

In `docs/active-work/support-access-framework.md`, change `status: designing` to `status: built — pending review`.

- [ ] **Step 6: Run the docs/process lint + quality gate**

Run: `pnpm run lint:process-refs`
Run: `pnpm check`
Expected: PASS (no `ADR-NNNN`/section refs leaked into source; everything formats and typechecks).

- [ ] **Step 7: Commit**

```bash
git add docs/decisions/pending/support-access-framework.md changelog.d/support-access-framework.md STATUS.md ROADMAP.md docs/active-work/support-access-framework.md
git commit -m "docs(support-access): ADR + changelog fragments, status, roadmap"
```

---

## Final verification (after all tasks)

- [ ] Run the full worker suite: `pnpm --filter @magna-carta/worker test`
- [ ] Run the database suite (migrations + permission union): `pnpm --filter @magna-carta/database test`
- [ ] Run the quality gate: `pnpm check`
- [ ] Validate the deploy doesn't break: `pnpm --filter @magna-carta/worker exec wrangler deploy --dry-run`
- [ ] Confirm the OpenAPI snapshot + generated client are committed and the byte-exact drift test passes.
- [ ] Then run the end-of-build pre-merge adversarial review (see `docs/conventions/testing.md`) before any merge.

## Deferred (named seams — not in this plan)

- **Staff self-service authentication + MFA** — replaces the interim platform-admin-key gate on the redeem route with a real per-person staff login (a second Better Auth instance over `platform_staff`, or an equivalent credential+TOTP flow). The redeem route already validates the named principal against `platform_staff`; this swaps how the staff caller is authenticated.
- **UI** — the platform-side support console (diagnostic) and the privileged view-as render path.
- **Notification transport** — in-app + email admin notifications on grant request/redeem (wired with the notifications subsystem).
- **AI-agent principals** — the `agent` principal variant + its tighter scope policy (the principal abstraction already reserves it).
- **Co-sign policy in the settings registry** — promote `firm.support_requires_cosign` into the declarative per-firm settings registry so admins toggle it from settings UI.
- **Per-request fine-grained audit** — a row per support-context request (interim: redemption + lifecycle are audited, and per-request access is observable via telemetry).
