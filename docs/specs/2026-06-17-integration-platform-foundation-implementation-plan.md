# Integration Platform Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Decouple integrations ("plugins") from the platform core so each one self-describes via a declarative `IntegrationManifest` and the worker mounts them from a registry, rather than the core hand-wiring every plugin.

**Architecture:** A pure `IntegrationManifest` type lives in `@magna-carta/integrations`; each domain package (shipping, parcels, property-links) exports its manifest. The worker holds a plugin registry (`apps/worker/src/plugins/`) that pairs each manifest with its worker bindings (route registration + adapter construction) and a uniform `PluginRuntime` dependency seam. `app.ts` mounts plugin routes in one loop through the unchanged ADR-0067 chokepoint; the per-request integration registry is built from the plugin list. Shipping is migrated onto this model as the proof.

**Tech Stack:** TypeScript (ESM, `.ts` imports), zod, Hono + `@hono/zod-openapi`, Vitest + `cloudflare:test` (Miniflare). Builds on `@magna-carta/integrations`, `@magna-carta/shipping`, `@magna-carta/parcels`, `@magna-carta/property-links`.

**Spec:** `docs/specs/2026-06-17-integration-platform-foundation-design.md`.

## Global Constraints

- Full names, no shorthand (golden rule 12): `PluginRuntime` not `PluginDeps`, `buildIntegrationRegistry` not `buildRegistry`.
- No process-artifact references in source/tests (golden rule 13); forward-looking "Spec 2 / the C seam" schedule notes are allowed. Enforced by `pnpm run lint:process-refs`.
- The chokepoint stays the single enforcement point (ADR-0067): every plugin route registers through `chokepointMiddleware`. No route may bypass it.
- A Credential is a secret (golden rule 4): never logged/serialized onto an observable path.
- `pnpm check` + `pnpm run lint:process-refs` green before every commit.
- Co-author trailer on every commit: `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.

---

## File Structure

**New `packages/integrations/`:** `src/manifest.ts` (the pure `IntegrationManifest` type); export added to `package.json`.
**New `packages/shipping/`:** `src/manifest.ts` (shipping's manifest); export added.
**New `packages/parcels/`:** `src/manifest.ts`; export added.
**New `packages/property-links/`:** `src/manifest.ts`; export added.
**New `apps/worker/`:** `src/plugins/runtime.ts` (`PluginRuntime` + builder), `src/plugins/registry.ts` (`WorkerPlugin` type, the `workerPlugins` index, `listManifests`, `buildIntegrationRegistry`), `src/plugins/shipping-plugin.ts` (binds shipping manifest + routes + adapter); tests `test/plugins/registry.test.ts`, `test/plugins/manifest-fitness.test.ts`.
**Modified `apps/worker/`:** `src/http/app.ts` (mount loop; drop shipping special-casing), `src/http/routes/communications/shipping.ts` (`ShippingRouteDeps` → `PluginRuntime`; `buildShippingRegistry` → `buildIntegrationRegistry`), `src/index.ts` (drop the shipping option), regenerated `openapi/openapi.json`; **deleted** `src/shipping/registry.ts` (generalized into `plugins/registry.ts`).
**Modified `packages/api-client/`:** regenerated client (routes byte-identical).
**Modified docs:** `docs/Decision-Log.md` (two ADRs), `docs/Magna-Carta-White-Paper.md` (Plugin/Add-on system), `STATUS.md`, `ROADMAP.md`, `CHANGELOG.md`.

---

## Task 1: The pure `IntegrationManifest` type

**Files:** Create `packages/integrations/src/manifest.ts`; modify `packages/integrations/package.json`. Test: `packages/integrations/test/manifest.test.ts`.

**Interfaces:**

- Produces: `IntegrationManifest` (the declarative contract) and `isWellFormedManifest(m): string[]` (returns a list of problems; empty = valid). Consumed by Tasks 2–7.

- [ ] **Step 1: Write the failing test**

```typescript
// packages/integrations/test/manifest.test.ts
import { describe, expect, it } from "vitest";
import { isWellFormedManifest, type IntegrationManifest } from "../src/manifest.ts";

const base: IntegrationManifest = {
  id: "easypost",
  category: "shipping",
  displayName: "EasyPost",
  summary: "Buy postage and track mail.",
  credential: { kind: "apiKey", scope: "firm" },
  capability: {
    adapterId: "easypost",
    category: "shipping",
    credential: { kind: "apiKey", scope: "firm" },
    operations: { buyLabel: { supported: true } },
    passthroughAvailable: false,
  },
  permission: "shipping:manage",
  defaultEnablement: "off",
};

describe("IntegrationManifest", () => {
  it("accepts a well-formed manifest", () => {
    expect(isWellFormedManifest(base)).toEqual([]);
  });

  it("flags an empty id and a credential/capability category mismatch", () => {
    const bad = { ...base, id: "", capability: { ...base.capability, category: "other" } };
    const problems = isWellFormedManifest(bad);
    expect(problems.some((p) => p.includes("id"))).toBe(true);
    expect(problems.some((p) => p.includes("category"))).toBe(true);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @magna-carta/integrations exec vp test run test/manifest.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the type + validator**

```typescript
// packages/integrations/src/manifest.ts
import type { CapabilityDescriptor, CredentialRequirement } from "./port.ts";

// A plugin's self-description: pure data (no D1, no Hono, no env), so the core reads it to build the
// catalog and route mount, and the future per-Worker transport (the C seam) ships it unchanged. The
// worker pairs it with its route-registration + adapter binding (apps/worker/src/plugins). The
// marketplace fields (defaultEnablement, connectSchema, settingsSchema) are declared here so the
// contract is whole; the core leaves them dormant until the marketplace slice consumes them.
export interface IntegrationManifest {
  readonly id: string; // stable adapter id, e.g. "easypost"
  readonly category: string; // port category, e.g. "shipping"
  readonly displayName: string;
  readonly summary: string;
  readonly vendorUrl?: string;
  readonly credential: CredentialRequirement;
  readonly capability: CapabilityDescriptor;
  // Operational permission key (a key in @magna-carta/access-control's registry); null for
  // credential-less integrations with no protected operations.
  readonly permission: string | null;
  readonly defaultEnablement: "on" | "off";
  // Validated at the boundary by the marketplace slice; typed as unknown here so this pure package
  // takes no zod dependency in its contract surface.
  readonly connectSchema?: unknown;
  readonly settingsSchema?: unknown;
}

// Structural checks the fitness test runs over every registered manifest. Returns a list of
// human-readable problems (empty = well-formed). Cross-registry checks (permission exists,
// id uniqueness across the set) live in the worker fitness test, which can see those registries.
export function isWellFormedManifest(manifest: IntegrationManifest): string[] {
  const problems: string[] = [];
  if (manifest.id.trim() === "") problems.push("id must be non-empty");
  if (manifest.category.trim() === "") problems.push("category must be non-empty");
  if (manifest.capability.category !== manifest.category) {
    problems.push(
      `capability.category "${manifest.capability.category}" must equal category "${manifest.category}"`,
    );
  }
  if (manifest.capability.credential.kind !== manifest.credential.kind) {
    problems.push("capability.credential.kind must equal credential.kind");
  }
  return problems;
}
```

- [ ] **Step 4: Add the export**

In `packages/integrations/package.json` `exports`, add: `"./manifest": "./src/manifest.ts"`.

- [ ] **Step 5: Run + commit**

Run: `pnpm --filter @magna-carta/integrations exec vp test run && pnpm check`
Expected: PASS.

```bash
git add packages/integrations/src/manifest.ts packages/integrations/package.json packages/integrations/test/manifest.test.ts
git commit -m "feat(integrations): IntegrationManifest contract + well-formedness check

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 2: Worker `PluginRuntime` + plugin registry scaffold

**Files:** Create `apps/worker/src/plugins/runtime.ts`, `apps/worker/src/plugins/registry.ts`. Test: `apps/worker/test/plugins/registry.test.ts`.

**Interfaces:**

- Consumes: `IntegrationManifest` (Task 1); `SecretStore` (`@magna-carta/data-access/firm-secret-credential-store`); `HttpClient` (`@magna-carta/shipping/easypost/http`); `createIntegrationRegistry`/`IntegrationRegistry` (`@magna-carta/integrations/registry`); `createConnectionStore`, `createFirmSecretCredentialStore` (data-access); `SqlDatabase` (data-access).
- Produces:
  - `interface PluginRuntime { readonly httpClient: HttpClient; readonly secretStoreForFirm: (firmDatabase: unknown) => SecretStore; }`
  - `interface WorkerPlugin { readonly manifest: IntegrationManifest; registerRoutes?(app: PluginApp, chokepoint: Chokepoint, runtime: PluginRuntime): void; registerAdapter?(registry: IntegrationRegistry, runtime: PluginRuntime): void; }`
  - `const workerPlugins: readonly WorkerPlugin[]` (the index — empty in this task; populated in Tasks 4 & 6)
  - `function listManifests(): readonly IntegrationManifest[]`
  - `function buildIntegrationRegistry(firmDatabase: SqlDatabase, runtime: PluginRuntime): IntegrationRegistry`

- [ ] **Step 1: Write the failing test**

```typescript
// apps/worker/test/plugins/registry.test.ts
import { describe, expect, it } from "vitest";
import { listManifests } from "../../src/plugins/registry.ts";

describe("plugin registry", () => {
  it("starts empty until plugins are registered", () => {
    // Scaffold task: the index is empty here; later tasks add shipping/parcels/property-links.
    expect(Array.isArray(listManifests())).toBe(true);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @magna-carta/worker exec vp test run test/plugins/registry.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write `runtime.ts`**

```typescript
// apps/worker/src/plugins/runtime.ts
import type { SecretStore } from "@magna-carta/data-access/firm-secret-credential-store";
import type { HttpClient } from "@magna-carta/shipping/easypost/http";

// The uniform, app-level dependency seam every plugin's routes/adapters code against — built once in
// createApp from env, overridable in tests. This is the exact boundary the future per-Worker
// transport (the C seam) replaces with RPC: in-process it is direct, in C it crosses a binding.
export interface PluginRuntime {
  readonly httpClient: HttpClient;
  // The slice-1·2 firm_secret store, per firm database. Production passes the real store; until the
  // marketplace wires the live credential read it is the throwing seam; tests inject a fake.
  readonly secretStoreForFirm: (firmDatabase: unknown) => SecretStore;
}
```

- [ ] **Step 4: Write `registry.ts`**

```typescript
// apps/worker/src/plugins/registry.ts
import { createFirmSecretCredentialStore } from "@magna-carta/data-access/firm-secret-credential-store";
import type { SqlDatabase } from "@magna-carta/data-access/idempotency-statements";
import { createConnectionStore } from "@magna-carta/data-access/integration-connection-store";
import type { IntegrationManifest } from "@magna-carta/integrations/manifest";
import {
  createIntegrationRegistry,
  type IntegrationRegistry,
} from "@magna-carta/integrations/registry";
import type { OpenAPIHono } from "@hono/zod-openapi";
import type { Bindings } from "../app.ts";
import type { Chokepoint } from "../chokepoint/chokepoint.ts";
import type { AppVariables } from "../chokepoint/ports.ts";
import type { PluginRuntime } from "./runtime.ts";

type PluginApp = OpenAPIHono<{ Bindings: Bindings; Variables: AppVariables }>;

// A worker's binding of a pure manifest to its worker-coupled wiring: the Hono route registration
// and the per-request adapter construction. The manifest is reusable/transport-agnostic; this pairs
// it with the in-process worker. Adding a plugin = author its manifest + one WorkerPlugin entry here.
export interface WorkerPlugin {
  readonly manifest: IntegrationManifest;
  registerRoutes?(app: PluginApp, chokepoint: Chokepoint, runtime: PluginRuntime): void;
  registerAdapter?(registry: IntegrationRegistry, runtime: PluginRuntime): void;
}

// THE single place the worker learns a plugin exists. Populated in Task 4 (shipping) and Task 6
// (parcels, property-links).
export const workerPlugins: readonly WorkerPlugin[] = [];

export function listManifests(): readonly IntegrationManifest[] {
  return workerPlugins.map((plugin) => plugin.manifest);
}

// One integration registry per request, over the firm's D1 (ConnectionStore) + its firm_secret
// CredentialStore, with every plugin's adapter registered. Replaces the shipping-specific builder.
export function buildIntegrationRegistry(
  firmDatabase: SqlDatabase,
  runtime: PluginRuntime,
): IntegrationRegistry {
  const registry = createIntegrationRegistry({
    connectionStore: createConnectionStore(firmDatabase),
    credentialStore: createFirmSecretCredentialStore(runtime.secretStoreForFirm(firmDatabase)),
  });
  for (const plugin of workerPlugins) plugin.registerAdapter?.(registry, runtime);
  return registry;
}
```

- [ ] **Step 5: Run + commit**

Run: `pnpm --filter @magna-carta/worker exec vp test run test/plugins/registry.test.ts && pnpm check`
Expected: PASS.

```bash
git add apps/worker/src/plugins/ apps/worker/test/plugins/registry.test.ts
git commit -m "feat(worker): plugin runtime seam + manifest-driven plugin registry scaffold

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 3: Shipping's manifest

**Files:** Create `packages/shipping/src/manifest.ts`; modify `packages/shipping/package.json`. Test: `packages/shipping/test/manifest.test.ts`.

**Interfaces:**

- Consumes: `IntegrationManifest` (Task 1); the EasyPost descriptor (`createEasyPostAdapter(...).descriptor`).
- Produces: `shippingManifest: IntegrationManifest`.

- [ ] **Step 1: Write the failing test**

```typescript
// packages/shipping/test/manifest.test.ts
import { describe, expect, it } from "vitest";
import { isWellFormedManifest } from "@magna-carta/integrations/manifest";
import { shippingManifest } from "../src/manifest.ts";

describe("shippingManifest", () => {
  it("is a well-formed firm-scoped apiKey shipping manifest", () => {
    expect(isWellFormedManifest(shippingManifest)).toEqual([]);
    expect(shippingManifest.category).toBe("shipping");
    expect(shippingManifest.credential).toEqual({ kind: "apiKey", scope: "firm" });
    expect(shippingManifest.permission).toBe("shipping:manage");
    expect(shippingManifest.defaultEnablement).toBe("off");
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @magna-carta/shipping exec vp test run test/manifest.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the manifest**

```typescript
// packages/shipping/src/manifest.ts
import type { IntegrationManifest } from "@magna-carta/integrations/manifest";
import { z } from "zod";
import { createEasyPostAdapter } from "./easypost/adapter.ts";
import { fetchHttpClient } from "./easypost/http.ts";

// EasyPost is the firm's postage account: one apiKey credential per firm. The capability descriptor
// is the adapter's own (built with a throwaway client — descriptor construction makes no network
// call). connectSchema/settingsSchema are consumed by the marketplace slice.
export const shippingManifest: IntegrationManifest = {
  id: "easypost",
  category: "shipping",
  displayName: "EasyPost",
  summary: "Buy USPS/UPS/FedEx postage and certified mail, print labels, and track shipments.",
  vendorUrl: "https://www.easypost.com",
  credential: { kind: "apiKey", scope: "firm" },
  capability: createEasyPostAdapter({ http: fetchHttpClient() }).descriptor,
  permission: "shipping:manage",
  defaultEnablement: "off",
  connectSchema: z.object({ apiKey: z.string().min(1) }),
  settingsSchema: z.object({
    defaultLabelFormat: z.enum(["PDF", "ZPL", "PNG"]).optional(),
  }),
};
```

- [ ] **Step 4: Add the export**

In `packages/shipping/package.json` `exports`, add: `"./manifest": "./src/manifest.ts"`.

- [ ] **Step 5: Run + commit**

Run: `pnpm --filter @magna-carta/shipping exec vp test run && pnpm check`
Expected: PASS.

```bash
git add packages/shipping/src/manifest.ts packages/shipping/package.json packages/shipping/test/manifest.test.ts
git commit -m "feat(shipping): export the EasyPost integration manifest

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 4: Bind shipping as a WorkerPlugin; generalize the routes' registry

**Files:** Create `apps/worker/src/plugins/shipping-plugin.ts`; modify `apps/worker/src/routes/communications/shipping.ts`, `apps/worker/src/plugins/registry.ts`; delete `apps/worker/src/shipping/registry.ts`.

**Interfaces:**

- Consumes: `shippingManifest` (Task 3); `registerShippingRoutes` (existing, signature `(app, chokepoint, deps)`); `buildIntegrationRegistry` (Task 2); `PluginRuntime` (Task 2); `createEasyPostAdapter` (`@magna-carta/shipping/easypost`).
- Produces: `shippingPlugin: WorkerPlugin`, added to `workerPlugins`.

- [ ] **Step 1: Generalize `routes/communications/shipping.ts` to `PluginRuntime` + the shared registry**

In `apps/worker/src/routes/communications/shipping.ts`: replace the `ShippingRouteDeps` interface with an import of `PluginRuntime`, and rename the `deps` parameter accordingly. Change the four `buildShippingRegistry(firm.firmDatabase, deps.secretStoreForFirm(firm.firmDatabase), deps.httpClient)` call sites to `buildIntegrationRegistry(firm.firmDatabase, runtime)`. Update imports:

```typescript
// remove: import { buildShippingRegistry } from "../shipping/registry.ts";
// remove: the local ShippingRouteDeps interface
import { buildIntegrationRegistry } from "../plugins/registry.ts";
import type { PluginRuntime } from "../plugins/runtime.ts";
```

Change the signature:

```typescript
export function registerShippingRoutes(
  app: ShippingApp,
  chokepoint: Chokepoint,
  runtime: PluginRuntime,
): void {
```

Each `buildShippingRegistry(...)` call becomes:

```typescript
const registry = buildIntegrationRegistry(firm.firmDatabase, runtime);
```

And the connect route's `const secrets = deps.secretStoreForFirm(firm.firmDatabase);` becomes `const secrets = runtime.secretStoreForFirm(firm.firmDatabase);`, and `deps.httpClient` in the descriptor line becomes `runtime.httpClient`.

- [ ] **Step 2: Delete the shipping-specific registry**

```bash
git rm apps/worker/src/shipping/registry.ts
```

- [ ] **Step 3: Write the WorkerPlugin binding**

```typescript
// apps/worker/src/plugins/shipping-plugin.ts
import { shippingManifest } from "@magna-carta/shipping/manifest";
import { createEasyPostAdapter } from "@magna-carta/shipping/easypost";
import { registerShippingRoutes } from "../routes/communications/shipping.ts";
import type { WorkerPlugin } from "./registry.ts";

export const shippingPlugin: WorkerPlugin = {
  manifest: shippingManifest,
  registerRoutes: (app, chokepoint, runtime) => registerShippingRoutes(app, chokepoint, runtime),
  registerAdapter: (registry, runtime) =>
    registry.register(createEasyPostAdapter({ http: runtime.httpClient })),
};
```

- [ ] **Step 4: Add it to the index**

In `apps/worker/src/plugins/registry.ts`, import and list it:

```typescript
import { shippingPlugin } from "./shipping-plugin.ts";
export const workerPlugins: readonly WorkerPlugin[] = [shippingPlugin];
```

> Note: `registry.ts` now imports `shipping-plugin.ts`, which imports `routes/communications/shipping.ts` — a one-directional plugin→routes dependency. No cycle (routes no longer import the registry's `workerPlugins`, only `buildIntegrationRegistry`).

- [ ] **Step 5: Typecheck**

Run: `pnpm check`
Expected: PASS (app.ts still references the old wiring — fixed in Task 5; if app.ts breaks here, proceed to Task 5 in the same commit).

> Because `app.ts` still calls `registerShippingRoutes(app, chokepoint, options.shipping ?? …)` with the old `ShippingRouteDeps` shape, Tasks 4 and 5 land together. Do Step 6 of Task 5 (the app.ts loop) before committing if `pnpm check` fails here.

- [ ] **Step 6: Commit (with Task 5)** — see Task 5.

---

## Task 5: Mount plugins from the registry in `app.ts`

**Files:** Modify `apps/worker/src/app.ts`, `apps/worker/src/index.ts`. Regenerate `apps/worker/openapi/openapi.json` + `packages/api-client`.

**Interfaces:**

- Consumes: `workerPlugins` / `listManifests` is not needed here; the mount uses `workerPlugins`. `PluginRuntime` (Task 2); `firmSecretStoreNotYetAvailable` (`./shipping/secret-store.ts`); `fetchHttpClient`.

- [ ] **Step 1: Replace the shipping wiring with the mount loop**

In `apps/worker/src/app.ts`:

Remove these imports:

```typescript
import { registerShippingRoutes } from "./routes/communications/shipping.ts";
import { fetchHttpClient } from "@magna-carta/shipping/easypost/http";
```

Add:

```typescript
import { workerPlugins } from "./plugins/registry.ts";
import type { PluginRuntime } from "./plugins/runtime.ts";
import { fetchHttpClient } from "@magna-carta/shipping/easypost/http";
```

(`firmSecretStoreNotYetAvailable` import stays.)

Replace the `CreateAppOptions.shipping?` field with a single runtime override:

```typescript
  // Overrides the plugin runtime for tests (a fake EasyPost http client + an in-memory secret store).
  pluginRuntime?: Partial<PluginRuntime>;
```

Replace the shipping registration block with the runtime build + mount loop (place where `registerShippingRoutes(...)` was):

```typescript
// The plugin runtime: production defaults (a fetch-backed http client; the firm_secret store seam
// that throws until the marketplace wires the live credential read), overridable in tests.
const pluginRuntime: PluginRuntime = {
  httpClient: options.pluginRuntime?.httpClient ?? fetchHttpClient(),
  secretStoreForFirm: options.pluginRuntime?.secretStoreForFirm ?? firmSecretStoreNotYetAvailable,
};
// Plugins mount from the registry — the core names no plugin. Each registers through the chokepoint.
for (const plugin of workerPlugins) plugin.registerRoutes?.(app, chokepoint, pluginRuntime);
```

- [ ] **Step 2: Update `index.ts`**

In `apps/worker/src/index.ts`, the production `createApp()` call takes no plugin options (the runtime defaults are inside `createApp`). If it currently passes `shipping: …`, change to `createApp()`. Remove now-unused imports (`fetchHttpClient`, `firmSecretStoreNotYetAvailable`) from `index.ts` if present.

- [ ] **Step 3: Update the shipping e2e's injection**

In `apps/worker/test/shipping-e2e.test.ts`, change the app construction from `createApp({ shipping: { secretStoreForFirm: () => secrets, httpClient: fakeEasyPost() } })` to:

```typescript
const app = createApp({
  pluginRuntime: { secretStoreForFirm: () => secrets, httpClient: fakeEasyPost() },
});
```

- [ ] **Step 4: Run the shipping e2e (regression proof)**

Run: `pnpm --filter @magna-carta/worker exec vp test run test/shipping-e2e.test.ts`
Expected: PASS — the full connect→create→rate→purchase→label→tracking journey, now mounted via the registry.

- [ ] **Step 5: Regenerate the contract + client**

Run:

```
pnpm --filter @magna-carta/worker run emit-openapi
pnpm --filter @magna-carta/api-client run generate
```

Expected: the OpenAPI snapshot diff shows **no operation changes** (routes are byte-identical; only mounting changed). If operations changed, a route was dropped — stop and fix.

- [ ] **Step 6: Typecheck + commit (Tasks 4 + 5 together)**

Run: `pnpm check && pnpm run lint:process-refs`
Expected: PASS.

```bash
git add apps/worker/src/plugins/ apps/worker/src/routes/communications/shipping.ts apps/worker/src/app.ts apps/worker/src/index.ts apps/worker/openapi/openapi.json packages/api-client/ apps/worker/test/shipping-e2e.test.ts
git rm apps/worker/src/shipping/registry.ts
git commit -m "refactor(worker): mount plugins from the manifest registry; shipping is the first

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 6: parcels + property-links manifests (catalog-only)

**Files:** Create `packages/parcels/src/manifest.ts`, `packages/property-links/src/manifest.ts`; modify both `package.json`s and `apps/worker/src/plugins/registry.ts`. Tests: `packages/parcels/test/manifest.test.ts`, `packages/property-links/test/manifest.test.ts`.

**Interfaces:**

- Consumes: `IntegrationManifest` (Task 1), `isWellFormedManifest`.
- Produces: `parcelsManifest`, `propertyLinksManifest`; both added to a `parcelsPlugin`/`propertyLinksPlugin` `WorkerPlugin` (manifest-only — no routes, no adapter) and listed in `workerPlugins`.

- [ ] **Step 1: Write the failing tests**

```typescript
// packages/parcels/test/manifest.test.ts
import { describe, expect, it } from "vitest";
import { isWellFormedManifest } from "@magna-carta/integrations/manifest";
import { parcelsManifest } from "../src/manifest.ts";

describe("parcelsManifest", () => {
  it("is a well-formed credential-less, default-on manifest", () => {
    expect(isWellFormedManifest(parcelsManifest)).toEqual([]);
    expect(parcelsManifest.credential).toEqual({ kind: "none" });
    expect(parcelsManifest.permission).toBeNull();
    expect(parcelsManifest.defaultEnablement).toBe("on");
  });
});
```

(Mirror for `property-links`.)

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm --filter @magna-carta/parcels exec vp test run test/manifest.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the manifests**

```typescript
// packages/parcels/src/manifest.ts
import type { IntegrationManifest } from "@magna-carta/integrations/manifest";

// Credential-less county-assessor deep-link resolver: always available, no account. Catalog-only —
// no routes, no adapter registration; surfaced inside features, toggleable per firm by the marketplace.
export const parcelsManifest: IntegrationManifest = {
  id: "parcels",
  category: "parcels",
  displayName: "County parcel lookup",
  summary: "Deep-links to the official county assessor record for a parcel/APN.",
  credential: { kind: "none" },
  capability: {
    adapterId: "parcels",
    category: "parcels",
    credential: { kind: "none" },
    operations: { assessorLink: { supported: true } },
    passthroughAvailable: false,
  },
  permission: null,
  defaultEnablement: "on",
};
```

```typescript
// packages/property-links/src/manifest.ts
import type { IntegrationManifest } from "@magna-carta/integrations/manifest";

export const propertyLinksManifest: IntegrationManifest = {
  id: "property-links",
  category: "property-links",
  displayName: "Property links",
  summary: "One-click links to view a property on Zillow, Redfin, Google Maps, and Realtor.com.",
  credential: { kind: "none" },
  capability: {
    adapterId: "property-links",
    category: "property-links",
    credential: { kind: "none" },
    operations: { resolveLinks: { supported: true } },
    passthroughAvailable: false,
  },
  permission: null,
  defaultEnablement: "on",
};
```

- [ ] **Step 4: Add exports + register**

Add `"./manifest": "./src/manifest.ts"` to both `package.json` `exports`. In `apps/worker/src/plugins/registry.ts`:

```typescript
import { parcelsManifest } from "@magna-carta/parcels/manifest";
import { propertyLinksManifest } from "@magna-carta/property-links/manifest";
// ...
export const workerPlugins: readonly WorkerPlugin[] = [
  shippingPlugin,
  { manifest: parcelsManifest },
  { manifest: propertyLinksManifest },
];
```

> Add `@magna-carta/parcels` and `@magna-carta/property-links` to `apps/worker/package.json` dependencies if absent; run `pnpm install`.

- [ ] **Step 5: Run + commit**

Run: `pnpm --filter @magna-carta/parcels exec vp test run && pnpm --filter @magna-carta/property-links exec vp test run && pnpm check`
Expected: PASS.

```bash
git add packages/parcels/ packages/property-links/ apps/worker/src/plugins/registry.ts apps/worker/package.json pnpm-lock.yaml
git commit -m "feat(integrations): parcels + property-links manifests (catalog-only)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 7: Manifest + decoupling fitness test

**Files:** Create `apps/worker/test/plugins/manifest-fitness.test.ts`.

**Interfaces:**

- Consumes: `listManifests` (Task 2), `isWellFormedManifest` (Task 1), `PERMISSIONS`/`isPermission` (`@magna-carta/access-control/registry`).

- [ ] **Step 1: Write the test**

```typescript
// apps/worker/test/plugins/manifest-fitness.test.ts
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { isPermission } from "@magna-carta/access-control/registry";
import { isWellFormedManifest } from "@magna-carta/integrations/manifest";
import { listManifests } from "../../src/plugins/registry.ts";

describe("plugin manifest fitness", () => {
  const manifests = listManifests();

  it("registers at least the three built integrations", () => {
    expect(manifests.map((m) => m.id).sort()).toEqual(
      ["easypost", "parcels", "property-links"].sort(),
    );
  });

  it("every manifest is structurally well-formed", () => {
    for (const manifest of manifests) {
      expect(isWellFormedManifest(manifest), manifest.id).toEqual([]);
    }
  });

  it("ids and categories are unique across the registry", () => {
    expect(new Set(manifests.map((m) => m.id)).size).toBe(manifests.length);
    expect(new Set(manifests.map((m) => m.category)).size).toBe(manifests.length);
  });

  it("every declared permission exists in the access-control registry", () => {
    for (const manifest of manifests) {
      if (manifest.permission !== null) {
        expect(isPermission(manifest.permission), manifest.permission).toBe(true);
      }
    }
  });

  it("app.ts names no individual plugin route module (decoupling guard)", () => {
    const appSource = readFileSync(new URL("../../src/app.ts", import.meta.url), "utf8");
    expect(appSource).not.toContain("routes/shipping");
    expect(appSource).not.toContain("registerShippingRoutes");
  });
});
```

- [ ] **Step 2: Run + commit**

Run: `pnpm --filter @magna-carta/worker exec vp test run test/plugins/manifest-fitness.test.ts`
Expected: PASS.

```bash
git add apps/worker/test/plugins/manifest-fitness.test.ts
git commit -m "test(worker): manifest well-formedness + app.ts decoupling fitness guard

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 8: ADRs, docs, and final gate

**Files:** `docs/Decision-Log.md`, `docs/Magna-Carta-White-Paper.md`, `STATUS.md`, `ROADMAP.md`, `CHANGELOG.md`.

- [ ] **Step 1: Record the two ADRs** in `docs/Decision-Log.md` (next free numbers): (1) **integration-platform decoupling** — the `IntegrationManifest` contract, the worker plugin registry, manifest-driven mounting, and the intrinsic-vs-accidental coupling boundary; (2) **the C-transition seam** — the in-process → service-binding → Workers-for-Platforms progression under one manifest, `PluginRuntime` as the boundary, the hard problems C must solve (per-firm D1 across Workers, credential custody, distributed migration ownership, chokepoint-across-boundary, aggregated contract), what stays platform-owned (tenancy, chokepoint, migration lineage, encryption custody), and the trigger (first untrusted/third-party or independent-deploy plugin). Follow the existing ADR entry format.

- [ ] **Step 2: Update the white paper** — rewrite the _Plugin / Add-on system_ section's mechanics around the manifest model (each integration self-describes; the core enumerates; first-party in-process now, the transport progression as the marketplace seam). No process-doc citations in the prose beyond ADR references (docs may cite ADRs).

- [ ] **Step 3: Update STATUS / ROADMAP / CHANGELOG** — a new "Integration platform foundation" row/entry: built, Load profile `[-]` (no per-firm data surface — structural refactor), the manifest model + shipping migrated as proof + parcels/property-links manifests, the marketplace (Spec 2) and the C seam noted as follow-ons.

- [ ] **Step 4: Final full gate**

Run:

```
pnpm check && pnpm run lint:process-refs && \
pnpm --filter @magna-carta/integrations exec vp test run && \
pnpm --filter @magna-carta/shipping exec vp test run && \
pnpm --filter @magna-carta/parcels exec vp test run && \
pnpm --filter @magna-carta/property-links exec vp test run && \
pnpm --filter @magna-carta/worker exec vp test run
```

Expected: all green; `lint:process-refs` clean.

- [ ] **Step 5: Validate the worker deploy contract**

Run: `pnpm --filter @magna-carta/worker exec wrangler deploy --dry-run` (build the SPA first if `apps/web/build` is absent).
Expected: succeeds; the OpenAPI document is unchanged in operations.

- [ ] **Step 6: Commit**

```bash
git add docs/Decision-Log.md docs/Magna-Carta-White-Paper.md STATUS.md ROADMAP.md CHANGELOG.md
git commit -m "docs(integrations): platform decoupling + C-seam ADRs, white paper, status

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Self-Review

**Spec coverage:** manifest contract (Task 1) ✓; central registry + `PluginRuntime` (Task 2) ✓; manifest-driven mounting through the chokepoint (Task 5) ✓; per-request registry generalization (Tasks 2,4) ✓; shipping migrated as proof (Tasks 3–5) ✓; parcels/property-links manifests (Task 6) ✓; intrinsic-vs-accidental boundary (kept: migrations/permissions/identifiers stay core-side; nothing moves them) ✓; well-formedness + decoupling fitness (Task 7) ✓; load profile `[-]` (Task 8) ✓; ADRs incl. the C seam + white paper + living docs (Task 8) ✓.

**Placeholder scan:** no TBD/TODO; every code step carries full code; commands have expected output.

**Type consistency:** `IntegrationManifest` fields (Task 1) used identically in Tasks 3,6,7. `PluginRuntime { httpClient, secretStoreForFirm }` (Task 2) consumed in Tasks 4,5. `buildIntegrationRegistry(firmDatabase, runtime)` (Task 2) called in Task 4. `WorkerPlugin`/`workerPlugins` (Task 2) extended in Tasks 4,6. `registerShippingRoutes(app, chokepoint, runtime)` new signature (Task 4) matched by the `WorkerPlugin.registerRoutes` type (Task 2) and the app.ts loop (Task 5).

**Build note:** Tasks 4 and 5 share one commit (the `routes/communications/shipping.ts` signature change breaks `app.ts` until the loop replaces the old call) — flagged in both tasks.
