# Firm usage worker route Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Expose the per-firm usage snapshot over HTTP — a read-only `GET /api/v1/firm-usage` through the slice 0·5 chokepoint that composes the existing domain reads (`@magna-carta/file-manager` storage + counts, `@magna-carta/matters` matter counts, `@magna-carta/locations` location count) into a `FirmUsageResponse`, gated by `tools:firmUsage`.

**Architecture:** A new route module (`apps/worker/src/routes/firm-usage.ts`) defines the zod response schema, the `RouteMeta`, the route, a thin composer over the six domain reads, and the registration; the composition root registers it; the route-conformance fitness gains the `tools` → `firm` resource binding; the committed OpenAPI snapshot and the generated API client are re-emitted; a Miniflare integration test proves auth + composition end to end. Realizes the deferred worker-route seam of ADR-0103 — no new ADR. Still headless: no UI.

**Tech Stack:** TypeScript, Hono + `@hono/zod-openapi`, the chokepoint (`defineOpenAPIRoute` + `chokepointMiddleware`), Vitest + `cloudflare:test` (Miniflare), Vite+ (`vp`).

## Global Constraints

- **Route through the chokepoint, code-as-contract:** the route is a `RouteMeta` + `defineOpenAPIRoute`, registered with `chokepointMiddleware(chokepoint, route)` — the single enforcement point. No inline session/firm/RBAC checks in the handler (the chokepoint owns them). Mirror `apps/worker/src/routes/me.ts`.
- **Conformance binding:** a route naming a `tools:` permission requires `tools: "firm"` in `RESOURCE_BY_PERMISSION_NAMESPACE` (`apps/worker/test/conformance.test.ts`); the route's `resource` must be `"firm"`. Each namespace maps to exactly one resource — add a row, never delete the check.
- **Drift gates:** adding a route changes the committed contract. After wiring, run `pnpm --filter @magna-carta/worker run emit-openapi` (re-emits `apps/worker/openapi/openapi.json`) and `pnpm run generate-client` (re-emits `packages/api-client`), and commit the regenerated artifacts — the snapshot byte-exact test and the client-drift gate fail otherwise.
- **Production role-seeding stays deferred** (ADR-0103 / ADR-0097): no role is granted `tools:firmUsage` here. The route is reachable only by a principal holding that permission; the integration test grants it via a `direct_grant` row (test-only). Mark this deferral in the docs task.
- **No process references** in source/tests (no `ADR-NNNN`/"spec"/"slice N"; golden rule 13). **Full names** (golden rule 12).
- **Read route:** `audited: false`, `idempotency: "optional"`, `permission: "tools:firmUsage"` — a GET naming a permission is permitted (precedent: `downloads.ts`). The handler reads `requireChokepointFirmContext(c).firmDatabase`.

---

### Task 1: GET /api/v1/firm-usage

**Files:**
- Create: `apps/worker/src/routes/firm-usage.ts`
- Modify: `apps/worker/src/app.ts` (import + register the route alongside `registerMeRoute`)
- Modify: `apps/worker/test/conformance.test.ts` (add `tools: "firm"` to `RESOURCE_BY_PERMISSION_NAMESPACE`)
- Create: `apps/worker/test/firm-usage.test.ts`
- Regenerate (committed): `apps/worker/openapi/openapi.json`, and the `packages/api-client` generated files.

**Interfaces:**
- Consumes: `readStorageUsage`, `readFileCount`, `readCleanVersionCount`, `readFolderCount` from `@magna-carta/file-manager/usage`; `readMatterCounts` from `@magna-carta/matters/queries`; `readLocationCount` from `@magna-carta/locations/statements`; the chokepoint helpers from `me.ts`'s imports; `tools:firmUsage` (registered).
- Produces: operation `firmUsage.get` at `GET /api/v1/firm-usage`; the `FirmUsageResponse` schema `{ storage: { totalBytes, totalObjects, byStorageClass: { standard: {bytes,objects}, infrequent_access: {bytes,objects} } }, counts: { matters: { total, prospective, open, closed }, files, fileVersions, folders, locations } }`.

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
  await applyPerFirmMigrations(env.DB_FIRM_POOL_1);
  poolFirmId = (await seedFirm({ name: "Usage Test Firm", databaseIdentifier: "DB_FIRM_POOL_1" }))
    .firmId;
});

describe("GET /api/v1/firm-usage", () => {
  it("answers an unauthenticated request with a 401 problem", async () => {
    const response = await SELF.fetch("https://example.com/api/v1/firm-usage");
    expect(response.status).toBe(401);
    expect(response.headers.get("content-type")).toContain("application/problem+json");
  });

  it("answers 403 for an authenticated member lacking tools:firmUsage", async () => {
    const { userId } = await seedCredentialedUser("usage-noperm@example.com", {
      userName: "No Perm",
      firmId: poolFirmId,
    });
    await mirrorMemberWithOwnerRole(userId, "No Perm"); // owner role does NOT include tools:firmUsage
    const cookie = await signInForSessionCookie("usage-noperm@example.com");
    const response = await SELF.fetch("https://example.com/api/v1/firm-usage", {
      headers: { cookie },
    });
    expect(response.status).toBe(403);
    expect(response.headers.get("content-type")).toContain("application/problem+json");
  });

  it("returns the composed snapshot for a member holding tools:firmUsage", async () => {
    const { userId } = await seedCredentialedUser("usage-ok@example.com", {
      userName: "Usage OK",
      firmId: poolFirmId,
    });
    await mirrorMemberWithOwnerRole(userId, "Usage OK");
    const t = "2026-01-01T00:00:00.000Z";
    // Test-only grant — production role-seeding of tools:firmUsage is deferred.
    await env.DB_FIRM_POOL_1.prepare(
      "INSERT INTO direct_grant (id, member_user_id, permission, expires_at, granted_by, created_at) VALUES ('grant_usage', ?1, 'tools:firmUsage', NULL, ?1, ?2)",
    )
      .bind(userId, t)
      .run();
    // Seed a little usage: 1000 bytes / 1 object, one open matter, one location.
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
Expected: FAIL — the route does not exist (404 instead of 401/200; the OpenAPI assertion finds no operation).

- [ ] **Step 3: Write the route module**

`apps/worker/src/routes/firm-usage.ts`:

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
// handler composes the per-domain reads over the resolved firm database. No matter-scoped resource —
// the whole firm's usage, so the tenancy resource is the firm.
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

// Compose the per-domain reads over the firm database into the snapshot. Each read queries only its
// own domain's tables; this is the one place they assemble.
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

(If TypeScript objects to `firmContext.firmDatabase` as the `SqlDatabase` argument, note that `me.ts` passes the same handle to `loadEffectivePermissions`; align the type the same way that call does.)

- [ ] **Step 4: Register the route in the composition root**

In `apps/worker/src/app.ts`, add the import beside the other route imports:

```ts
import { registerFirmUsageRoute } from "./routes/firm-usage.ts";
```

and the registration immediately after `registerMeRoute(app, chokepoint);`:

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
Expected: `apps/worker/openapi/openapi.json` now contains the `/api/v1/firm-usage` operation and the `FirmUsageResponse` component; `packages/api-client` regenerates with the new operation. These regenerated files are committed in Step 8.

- [ ] **Step 7: Run the worker suite to verify green**

Run: `pnpm --filter @magna-carta/worker test`
Expected: PASS — the new `firm-usage.test.ts` (401 / 403 / 200 / OpenAPI emission), the conformance suite (the `tools` → `firm` binding now satisfied), and the OpenAPI snapshot byte-exact + served-document tests (re-emitted in Step 6).

- [ ] **Step 8: Commit**

```bash
git add apps/worker/src/routes/firm-usage.ts apps/worker/src/app.ts apps/worker/test/conformance.test.ts apps/worker/test/firm-usage.test.ts apps/worker/openapi/openapi.json packages/api-client
git commit -m "feat(worker): GET /api/v1/firm-usage — the per-firm usage snapshot route"
```

---

### Task 2: Update living docs

**Files:**
- Modify: `CHANGELOG.md`, `ROADMAP.md`, `STATUS.md`, `packages/tools/CLAUDE.md`

- [ ] **Step 1: CHANGELOG entry**

In `CHANGELOG.md` under `### Added`: `GET /api/v1/firm-usage` — the read-only per-firm usage snapshot route through the 0·5 chokepoint, composing the file-manager storage/counts, matter counts, and location count into a `FirmUsageResponse`, gated by `tools:firmUsage` (the `tools` → `firm` conformance binding added). OpenAPI snapshot + generated client re-emitted. Realizes the deferred worker-route seam of ADR-0103. **Production role-seeding of `tools:firmUsage` remains deferred** (no role holds it yet; reachable only by a direct grant) and the **UI** is still pending the design-system shell.

- [ ] **Step 2: ROADMAP**

In `ROADMAP.md`, in the Tools area bullet, update the firm-usage note: the worker route is now built (the reads are exposed at `GET /api/v1/firm-usage`); the per-firm compute/activity Cloudflare-analytics seam, production role-seeding, and the UI remain deferred.

- [ ] **Step 3: STATUS**

In `STATUS.md`, under the Tools-area row, note the firm-usage route is built + tested (role-seeding + UI pending).

- [ ] **Step 4: tools CLAUDE.md**

In `packages/tools/CLAUDE.md`, update the firm-usage sentence: its reads are now exposed via `GET /api/v1/firm-usage`; only production role-seeding of `tools:firmUsage` and the UI remain pending.

- [ ] **Step 5: Commit**

```bash
git add CHANGELOG.md ROADMAP.md STATUS.md packages/tools/CLAUDE.md
git commit -m "docs(tools): record the GET /api/v1/firm-usage route (role-seeding + UI still deferred)"
```

---

## Self-Review

**1. Spec coverage** (the deferred worker-route seam from `docs/specs/2026-06-17-firm-usage-diagnostics-design.md` §4):
- The firm-scoped `GET /api/v1/firm-usage` through the chokepoint, composing the snapshot → Task 1 (route + composer).
- The `tools` → tenancy-resource conformance entry the design flagged → Task 1 Step 5 (`tools: "firm"`).
- Read-shaped, gated by `tools:firmUsage`, audited:false → Task 1 route meta.
- Production role-seeding deferred; UI deferred → not built; recorded in Task 2.

**2. Placeholder scan:** every code/test step shows complete code; commands state expected output; no TBD. Clean.

**3. Type consistency:** `FirmUsageResponse` shape (storage{totalBytes,totalObjects,byStorageClass{standard,infrequent_access}{bytes,objects}}, counts{matters{total,prospective,open,closed},files,fileVersions,folders,locations}) matches the composer's return (`{ storage, counts: { matters, files, fileVersions, folders, locations } }`) and the integration test's expected JSON, byte-for-byte. The composer reads — `readStorageUsage`/`readFileCount`/`readCleanVersionCount`/`readFolderCount`/`readMatterCounts`/`readLocationCount` — match the functions built and exported by the prior firm-usage feature. `operationId` `firmUsage.get`, `permission` `tools:firmUsage`, `resource` `firm` are identical across the route meta, the conformance binding, and the OpenAPI-emission test assertion. Consistent.
