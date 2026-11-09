# Firm usage worker route Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Expose the per-firm usage snapshot over HTTP — `GET /api/v1/firm-usage` through the slice 0·5 chokepoint, composing the existing domain reads into a `FirmUsageResponse`, gated by `tools:firmUsage` — and seed that permission onto the Owner/Admin role so firm administrators can reach it in production.

**Architecture:** A per-firm data migration seeds `tools:firmUsage` onto the Owner/Admin role. A new route module composes the six domain reads over the resolved firm database; the composition root registers it; the route-conformance fitness gains the `tools` → `firm` binding; the OpenAPI snapshot + generated client are re-emitted; a Miniflare integration test proves real role-based access end to end. Realizes the deferred worker-route seam of ADR-0103. Still headless: no UI.

**Tech Stack:** TypeScript, Hono + `@hono/zod-openapi`, the chokepoint, drizzle-kit (custom migration), Vitest + `cloudflare:test` (Miniflare), Vite+ (`vp`).

## Global Constraints

- **Route through the chokepoint, code-as-contract:** a `RouteMeta` + `defineOpenAPIRoute`, registered with `chokepointMiddleware`; no inline session/firm/RBAC checks in the handler. Mirror `apps/worker/src/routes/session/me.ts`.
- **Conformance binding:** a route naming a `tools:` permission requires `tools: "firm"` in `RESOURCE_BY_PERMISSION_NAMESPACE` (`apps/worker/test/conformance.test.ts`); the route's `resource` is `"firm"`.
- **Drift gates:** after wiring, run `pnpm --filter @magna-carta/worker run emit-openapi` and `pnpm run generate-client`, and commit the regenerated `apps/worker/openapi/openapi.json` + `packages/api-client`.
- **Migration discipline:** per-firm migrations are journal-driven (`drizzle/per-firm/meta/_journal.json` + `<tag>.sql`); seeding `role_permission` is a DATA migration, created via `drizzle-kit generate --custom` (which produces the empty migration + journal entry + snapshot), then the INSERT is hand-written. The Owner/Admin role is `role_Gw-zKO8hOHQuNv2bWokMp`; the seeded `role_permission.id` must be a valid `rolePermission_` handle. The seed-fitness test requires every seeded permission to be in the registry (`tools:firmUsage` is).
- **No process references** in source/tests (golden rule 13); **full names** (golden rule 12).
- **Commit hygiene:** shared branch — stage only each task's named files; never `git add -A`/`-a`.

---

### Task 1: Seed tools:firmUsage onto the Owner/Admin role

**Files:**

- Create: `packages/database/drizzle/per-firm/0006_seed-tools-firm-usage.sql`
- Modify (drizzle-kit writes these): `packages/database/drizzle/per-firm/meta/_journal.json`, `packages/database/drizzle/per-firm/meta/0006_snapshot.json`
- Test: `packages/database/test/generated-migrations.test.ts` (add a 0006 seed assertion)

**Interfaces:**

- Produces: per-firm migration `0006_seed-tools-firm-usage` granting `tools:firmUsage` to `role_Gw-zKO8hOHQuNv2bWokMp` (Owner/Admin) — applied by `applyPerFirmMigrations`, so the route's integration test (Task 2) sees an Owner member holding the permission.

- [ ] **Step 1: Write the failing test**

In `packages/database/test/generated-migrations.test.ts`, add (mirroring the existing per-migration parse tests; reuse the file's `loadLineage`, `parseSingleRowInsert`, and `isIdentifier` imports):

```ts
it("per-firm 0006 seeds tools:firmUsage onto the Owner/Admin role only", async () => {
  const migrations = await loadLineage("per-firm");
  const migration = migrations.find((m) => m.tag === "0006_seed-tools-firm-usage");
  expect(migration, "0006_seed-tools-firm-usage missing from the per-firm lineage").toBeDefined();
  const seeds = (migration?.statements ?? [])
    .filter((statement) => statement.includes("INSERT INTO `role_permission`"))
    .map(parseSingleRowInsert);
  expect(seeds).toHaveLength(1);
  expect(seeds[0]?.permission).toBe("tools:firmUsage");
  expect(seeds[0]?.role_id).toBe("role_Gw-zKO8hOHQuNv2bWokMp"); // the Owner/Admin role (0002)
  expect(isIdentifier(seeds[0]?.id, "rolePermission")).toBe(true);
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @magna-carta/database test -- generated-migrations`
Expected: FAIL — no `0006_seed-tools-firm-usage` in the lineage (`toBeDefined` fails).

- [ ] **Step 3: Generate the empty custom migration**

Run: `pnpm --filter @magna-carta/database exec drizzle-kit generate --config=drizzle-per-firm.config.ts --custom --name=seed-tools-firm-usage`
Expected: creates `drizzle/per-firm/0006_seed-tools-firm-usage.sql` (empty), appends `{ idx: 6, tag: "0006_seed-tools-firm-usage", … }` to `meta/_journal.json`, and writes `meta/0006_snapshot.json`. (If the tool prompts, accept the custom/empty migration.)

- [ ] **Step 4: Write the seed INSERT**

Put this in `packages/database/drizzle/per-firm/0006_seed-tools-firm-usage.sql`:

```sql
-- Seed tools:firmUsage onto the Owner/Admin role so firm administrators can read the firm usage
-- snapshot (GET /api/v1/firm-usage). The other default roles start without it.
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_Ku9Tn3aWx7Lp0qRsVbE2c', 'role_Gw-zKO8hOHQuNv2bWokMp', 'tools:firmUsage');
```

(`rolePermission_Ku9Tn3aWx7Lp0qRsVbE2c` is a fixed, valid `rolePermission_` handle — 21-char URL-safe token. The Step-1 test's `isIdentifier` check confirms the format; if it fails, replace the token with a freshly minted 21-char URL-safe one and keep the `rolePermission_` prefix.)

- [ ] **Step 5: Run the database suite green**

Run: `pnpm --filter @magna-carta/database test`
Expected: PASS — the new 0006 test, the seed-fitness test (every seeded permission is registered; `tools:firmUsage` is), and the migration-runner tests.

- [ ] **Step 6: Commit**

```bash
git add packages/database/drizzle/per-firm/0006_seed-tools-firm-usage.sql packages/database/drizzle/per-firm/meta/_journal.json packages/database/drizzle/per-firm/meta/0006_snapshot.json packages/database/test/generated-migrations.test.ts
git commit -m "feat(database): seed tools:firmUsage onto the Owner/Admin role (per-firm 0006)"
```

---

### Task 2: GET /api/v1/firm-usage

**Files:**

- Create: `apps/worker/src/routes/firm/firm-usage.ts`
- Modify: `apps/worker/src/app.ts` (import + register beside `registerMeRoute`)
- Modify: `apps/worker/test/conformance.test.ts` (add `tools: "firm"` to `RESOURCE_BY_PERMISSION_NAMESPACE`)
- Create: `apps/worker/test/firm-usage.test.ts`
- Regenerate (committed): `apps/worker/openapi/openapi.json`, `packages/api-client`.

**Interfaces:**

- Consumes: `readStorageUsage`/`readFileCount`/`readCleanVersionCount`/`readFolderCount` (`@magna-carta/file-manager/usage`), `readMatterCounts` (`@magna-carta/matters/queries`), `readLocationCount` (`@magna-carta/locations/statements`); the Owner/Admin role holds `tools:firmUsage` (Task 1).
- Produces: operation `firmUsage.get` at `GET /api/v1/firm-usage` returning `FirmUsageResponse` `{ storage: { totalBytes, totalObjects, byStorageClass: { standard: {bytes,objects}, infrequent_access: {bytes,objects} } }, counts: { matters: { total, prospective, open, closed }, files, fileVersions, folders, locations } }`.

- [ ] **Step 1: Write the failing integration test**

`apps/worker/test/firm-usage.test.ts`:

```ts
import { env, SELF } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import type { FirmId } from "@magna-carta/identifiers/types";
import { applyControlPlaneMigrations } from "./support/apply-control-plane-migrations.ts";
import { applyPerFirmMigrations } from "./support/apply-per-firm-migrations.ts";
import {
  mirrorMemberWithOwnerRole,
  seedCredentialedUser,
  seedFirm,
  signInForSessionCookie,
} from "./support/test-auth.ts";

let poolFirmId: FirmId;

beforeAll(async () => {
  await applyControlPlaneMigrations(env.DB_CONTROL);
  await applyPerFirmMigrations(env.DB_FIRM_POOL_1); // full lineage incl. 0006 (Owner/Admin gets tools:firmUsage)
  poolFirmId = (await seedFirm({ name: "Usage Test Firm", databaseIdentifier: "DB_FIRM_POOL_1" }))
    .firmId;
});

describe("GET /api/v1/firm-usage", () => {
  it("answers an unauthenticated request with a 401 problem", async () => {
    const response = await SELF.fetch("https://example.com/api/v1/firm-usage");
    expect(response.status).toBe(401);
    expect(response.headers.get("content-type")).toContain("application/problem+json");
  });

  it("answers 403 for an authenticated member without tools:firmUsage", async () => {
    // Never mirrored into a role → present (not deactivated) but holds no permission → 403, not 404.
    await seedCredentialedUser("usage-noperm@example.com", {
      userName: "No Perm",
      firmId: poolFirmId,
    });
    const cookie = await signInForSessionCookie("usage-noperm@example.com");
    const response = await SELF.fetch("https://example.com/api/v1/firm-usage", {
      headers: { cookie },
    });
    expect(response.status).toBe(403);
    expect(response.headers.get("content-type")).toContain("application/problem+json");
  });

  it("returns the composed snapshot for an Owner/Admin member", async () => {
    const { userId } = await seedCredentialedUser("usage-ok@example.com", {
      userName: "Usage OK",
      firmId: poolFirmId,
    });
    await mirrorMemberWithOwnerRole(userId, "Usage OK"); // Owner/Admin carries tools:firmUsage (0006)
    const t = "2026-01-01T00:00:00.000Z";
    await env.DB_FIRM_POOL_1.prepare(
      "INSERT INTO storage_meter (storage_class, artifact_role, prefix, bytes, object_count) VALUES ('standard','original','files',1000,1)",
    ).run();
    await env.DB_FIRM_POOL_1.prepare(
      "INSERT INTO matter (id, title, description, status, matter_type_id, location_id, responsible_member_id, client_display_name, client_code, matter_number, numbered_at, opened_at, closed_at, created_at, updated_at) VALUES ('matter_u','M',NULL,'open',NULL,NULL,?1,NULL,NULL,NULL,NULL,NULL,NULL,?2,?2)",
    )
      .bind(userId, t)
      .run();
    await env.DB_FIRM_POOL_1.prepare(
      "INSERT INTO location (id, name, status, jurisdiction, number_code, address_block, footer, remit_to, created_at, updated_at) VALUES ('loc_u','HQ','active',NULL,NULL,NULL,NULL,NULL,?1,?1)",
    )
      .bind(t)
      .run();

    const cookie = await signInForSessionCookie("usage-ok@example.com");
    const response = await SELF.fetch("https://example.com/api/v1/firm-usage", {
      headers: { cookie },
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      storage: {
        totalBytes: 1000,
        totalObjects: 1,
        byStorageClass: {
          standard: { bytes: 1000, objects: 1 },
          infrequent_access: { bytes: 0, objects: 0 },
        },
      },
      counts: {
        matters: { total: 1, prospective: 0, open: 1, closed: 0 },
        files: 0,
        fileVersions: 0,
        folders: 0,
        locations: 1,
      },
    });
  });

  it("emits the route into the OpenAPI document with operationId and x-mc metadata", async () => {
    const response = await SELF.fetch("https://example.com/api/openapi.json");
    const document = (await response.json()) as {
      paths: Record<string, { get?: Record<string, unknown> }>;
    };
    const operation = document.paths["/api/v1/firm-usage"]?.get;
    expect(operation?.["operationId"]).toBe("firmUsage.get");
    expect(operation).toMatchObject({
      "x-mc-operationId": "firmUsage.get",
      "x-mc-surface": "app",
      "x-mc-authenticated": true,
      "x-mc-permission": "tools:firmUsage",
      "x-mc-resource": "firm",
      "x-mc-audited": false,
    });
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @magna-carta/worker test -- firm-usage`
Expected: FAIL — the route does not exist (the OpenAPI assertion finds no operation; the GETs 404).

- [ ] **Step 3: Write the route module**

`apps/worker/src/routes/firm/firm-usage.ts`:

```ts
import { z, type OpenAPIHono } from "@hono/zod-openapi";
import type { SqlDatabase } from "@magna-carta/data-access/idempotency-statements";
import {
  readCleanVersionCount,
  readFileCount,
  readFolderCount,
  readStorageUsage,
} from "@magna-carta/file-manager/usage";
import { readLocationCount } from "@magna-carta/locations/statements";
import { readMatterCounts } from "@magna-carta/matters/queries";
import type { Bindings } from "../app.ts";
import type { Chokepoint } from "../chokepoint/chokepoint.ts";
import { requireChokepointFirmContext } from "../chokepoint/context-accessors.ts";
import type { AppVariables } from "../chokepoint/ports.ts";
import { chokepointMiddleware } from "../chokepoint/register.ts";
import { Problem } from "../contracts/problem.ts";
import { defineOpenAPIRoute, type RouteMeta } from "../contracts/route-meta.ts";

const ClassTotals = z.object({ bytes: z.number(), objects: z.number() });

const FirmUsageResponse = z
  .object({
    storage: z.object({
      totalBytes: z.number(),
      totalObjects: z.number(),
      byStorageClass: z.object({ standard: ClassTotals, infrequent_access: ClassTotals }),
    }),
    counts: z.object({
      matters: z.object({
        total: z.number(),
        prospective: z.number(),
        open: z.number(),
        closed: z.number(),
      }),
      files: z.number(),
      fileVersions: z.number(),
      folders: z.number(),
      locations: z.number(),
    }),
  })
  .openapi("FirmUsageResponse");

// Read-only, per-firm. The chokepoint resolves the session + firm and enforces tools:firmUsage; the
// handler composes the per-domain reads over the resolved firm database. The tenancy resource is the
// firm — the whole firm's usage, not a matter-scoped object.
export const firmUsageMeta: RouteMeta = {
  operationId: "firmUsage.get",
  surface: "app",
  authenticated: true,
  permission: "tools:firmUsage",
  resource: "firm",
  audited: false,
  idempotency: "optional",
  rateLimit: "default",
};

export const firmUsageRoute = defineOpenAPIRoute(firmUsageMeta, {
  method: "get",
  path: "/api/v1/firm-usage",
  description:
    "The firm's own usage: storage consumed (by class) and entity counts (matters by status, files, versions, folders, locations).",
  responses: {
    200: {
      description: "The firm usage snapshot",
      content: { "application/json": { schema: FirmUsageResponse } },
    },
    401: {
      description: "No valid session",
      content: { "application/problem+json": { schema: Problem } },
    },
    403: {
      description: "Authenticated, but the member lacks tools:firmUsage",
      content: { "application/problem+json": { schema: Problem } },
    },
    404: {
      description: "The session's firm is not reachable, or the member is deactivated (absent)",
      content: { "application/problem+json": { schema: Problem } },
    },
    429: {
      description: "Rate limit exceeded",
      content: { "application/problem+json": { schema: Problem } },
    },
  },
});

// Compose the per-domain reads over the firm database. Each read queries only its own domain's tables;
// this is the one place they assemble.
async function readFirmUsage(database: SqlDatabase) {
  const [storage, files, fileVersions, folders, matters, locations] = await Promise.all([
    readStorageUsage(database),
    readFileCount(database),
    readCleanVersionCount(database),
    readFolderCount(database),
    readMatterCounts(database),
    readLocationCount(database),
  ]);
  return { storage, counts: { matters, files, fileVersions, folders, locations } };
}

export function registerFirmUsageRoute(
  app: OpenAPIHono<{ Bindings: Bindings; Variables: AppVariables }>,
  chokepoint: Chokepoint,
): void {
  app.openapi(
    { ...firmUsageRoute, middleware: chokepointMiddleware(chokepoint, firmUsageRoute) },
    async (c) => {
      const firmContext = requireChokepointFirmContext(c);
      const usage = await readFirmUsage(firmContext.firmDatabase);
      return c.json(usage, 200);
    },
  );
}
```

(If TypeScript objects to `firmContext.firmDatabase` as the `SqlDatabase` argument, align it the way `me.ts` does when it passes the same handle to `loadEffectivePermissions`.)

- [ ] **Step 4: Register the route**

In `apps/worker/src/app.ts`, add beside the other route imports:

```ts
import { registerFirmUsageRoute } from "./routes/firm/firm-usage.ts";
```

and immediately after `registerMeRoute(app, chokepoint);`:

```ts
registerFirmUsageRoute(app, chokepoint);
```

- [ ] **Step 5: Add the conformance resource binding**

In `apps/worker/test/conformance.test.ts`, add the `tools` row to `RESOURCE_BY_PERMISSION_NAMESPACE`:

```ts
const RESOURCE_BY_PERMISSION_NAMESPACE: Record<string, string> = {
  firm: "firm",
  matters: "matter",
  locations: "location",
  files: "matter",
  tools: "firm",
};
```

- [ ] **Step 6: Re-emit the OpenAPI snapshot and the client**

Run: `pnpm --filter @magna-carta/worker run emit-openapi`
Then: `pnpm run generate-client`
Expected: `apps/worker/openapi/openapi.json` gains the `/api/v1/firm-usage` operation + `FirmUsageResponse` component; `packages/api-client` regenerates.

- [ ] **Step 7: Run the worker suite green**

Run: `pnpm --filter @magna-carta/worker test`
Expected: PASS — `firm-usage.test.ts` (401 / 403 / 200 / OpenAPI emission), the conformance suite, and the OpenAPI snapshot byte-exact + served-document tests.

- [ ] **Step 8: Commit**

```bash
git add apps/worker/src/routes/firm/firm-usage.ts apps/worker/src/app.ts apps/worker/test/conformance.test.ts apps/worker/test/firm-usage.test.ts apps/worker/openapi/openapi.json packages/api-client
git commit -m "feat(worker): GET /api/v1/firm-usage — the per-firm usage snapshot route"
```

---

### Task 3: Update living docs

**Files:**

- Modify: `CHANGELOG.md`, `ROADMAP.md`, `STATUS.md`, `packages/tools/CLAUDE.md`

- [ ] **Step 1: CHANGELOG entry**

In `CHANGELOG.md` under `### Added`: `GET /api/v1/firm-usage` — the read-only per-firm usage snapshot route through the 0·5 chokepoint, composing the file-manager storage/counts, matter counts, and location count into a `FirmUsageResponse`, gated by `tools:firmUsage` (the `tools` → `firm` conformance binding added; OpenAPI snapshot + generated client re-emitted). `tools:firmUsage` is **seeded onto the Owner/Admin role** (per-firm migration 0006), so firm administrators can reach it; the other default roles do not hold it. Realizes the deferred worker-route seam of ADR-0103. The **UI** is still pending the design-system shell; per-firm compute/activity (Cloudflare Analytics API) remains a deferred seam.

- [ ] **Step 2: ROADMAP**

In `ROADMAP.md`, in the Tools area bullet, update the firm-usage note: the worker route is built (`GET /api/v1/firm-usage`) and `tools:firmUsage` is seeded to Owner/Admin; the compute/activity Cloudflare seam and the UI remain deferred.

- [ ] **Step 3: STATUS**

In `STATUS.md`, under the Tools-area row, note the firm-usage route is built + tested and the permission is seeded to Owner/Admin (UI pending).

- [ ] **Step 4: tools CLAUDE.md**

In `packages/tools/CLAUDE.md`, update the firm-usage sentence: the reads are exposed via `GET /api/v1/firm-usage`, `tools:firmUsage` is seeded to the Owner/Admin role, and only the UI remains pending.

- [ ] **Step 5: Commit**

```bash
git add CHANGELOG.md ROADMAP.md STATUS.md packages/tools/CLAUDE.md
git commit -m "docs(tools): record the firm-usage route + Owner/Admin role-seeding"
```

---

## Self-Review

**1. Spec coverage** (the deferred worker-route seam from the firm-usage design §4, plus the owner-chosen Owner/Admin seeding):

- The firm-scoped `GET /api/v1/firm-usage` composing the snapshot → Task 2.
- The `tools` → `firm` conformance entry the design flagged → Task 2 Step 5.
- `tools:firmUsage` reachable in production → Task 1 (seeded onto Owner/Admin); the integration test exercises real role-based access (Owner → 200, never-mirrored → 403).
- UI + compute/activity deferred → not built; recorded in Task 3.

**2. Placeholder scan:** every code/test step shows complete code; commands state expected output; the one literal handle is flagged as replaceable if `isIdentifier` rejects it. No TBD.

**3. Type consistency:** `FirmUsageResponse` shape matches the composer return and the integration test's expected JSON byte-for-byte. The six composer reads match the functions exported by the prior firm-usage feature. `firmUsage.get` / `tools:firmUsage` / `resource: "firm"` are identical across the route meta, the conformance binding, and the OpenAPI-emission assertion. The Owner/Admin role id `role_Gw-zKO8hOHQuNv2bWokMp` matches between Task 1's seed, Task 1's test, and the 0002 role seed it references.
