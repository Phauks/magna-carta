# Service Status Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the backend systems for an in-app + public service-status surface — upstream-provider aggregation, exception-based component health, and operator-authored service events — behind an isolated read-only status worker. No UI.

**Architecture:** A pure `@magna-carta/status` package holds the snapshot schema, provider adapters, health derivation, and the audience-scoped merge. The existing app worker owns all writes (a platform-operator-gated route group that authors `status:authored`, plus a cron that probes/polls into `status:derived`), both landing in a new `STATUS_KV` namespace. A new tiny `apps/status-worker` reads that KV, merges, and serves `status.json` publicly — sharing nothing with the app but the KV namespace, so it survives an app/D1 outage.

**Tech Stack:** TypeScript (strict), Cloudflare Workers + Hono (app worker) / plain `ExportedHandler` (status worker), zod, Drizzle (control-plane D1), Cloudflare KV, `@cloudflare/vitest-pool-workers` (Miniflare) for integration tests, Vitest (node pool) for unit tests.

**Design spec:** `docs/specs/2026-07-02-service-status-design.md` (read it first). Extends ADR-0048.

## Global Constraints

- **No emojis** anywhere (code, docs, commits). Lucide icons only if UI ever added.
- **Full names, no shorthand** — `@magna-carta/data-access` not "dal", `newIdentifier()` not `newId()`, "the data-access layer" in prose. Exception: documented storage suffixes and universal terms (`id`, `URL`, `JSON`, `SQL`).
- **No process-doc references in source/tests/OpenAPI strings** — no "ADR-NNNN", "spec", "slice N", "Phase N". State reasoning inline or cite a file path. A _forward-looking_ "built later" schedule note is allowed. CI enforces via `pnpm run lint:process-refs`.
- **Our control-plane tables use ISO-8601 UTC text timestamps** (not epoch-ms — that idiom is Better-Auth-only). No SQL `DEFAULT`; the caller passes the ISO string.
- **Timestamps compared as strings** — fixed-width `Date#toISOString()`; a grant expiring exactly at `now` is already expired (`expires_at !== null && expires_at <= now`).
- **Identifiers are prefixed nanoid handles** (`<prefix>_<token>`), minted via `newIdentifier(type)`; the registry key equals the prefix.
- **OpenAPI is code-as-contract.** Any route change requires, in the same commit: (1) `pnpm --filter @magna-carta/worker run emit-openapi`, (2) `pnpm --filter @magna-carta/api-client run generate`, (3) add the new `operationId`s to the sorted list in `apps/worker/test/conformance.test.ts`. A byte-exact drift test gates all three.
- **Telemetry redaction** — never log secrets, session tokens, or privileged content. Use the allowlisted event helpers from `@magna-carta/telemetry/events`; report failures via `logOperationFailed`.
- **Binding names are the code contract, never environment-scoped names.** New binding: `STATUS_KV`.
- **Generated files are not hand-edited:** `tsconfig.build.json` (run `vp run typecheck-refs`), `openapi/openapi.json` (re-emit), the drizzle migration SQL (generate from schema).
- **Run `pnpm check` and `vp test` before each commit** unless a step says otherwise.

---

## File Structure

**New package `packages/status/`** (pure, DAL-free — package isolation is the confidentiality boundary):

- `src/vocabulary.ts` — status enums + severity ranking.
- `src/schema.ts` — zod schemas + inferred types for derived / authored / published snapshots; KV key constants; empty-doc + parse helpers.
- `src/component-registry.ts` — the static list of our components (core-probe vs engine).
- `src/provider-registry.ts` — the static list of upstream providers (statuspage vs manual).
- `src/statuspage-adapter.ts` — `normalizeStatuspageIndicator` + `pollStatuspageProvider`.
- `src/derive.ts` — `deriveComponents` (exception-based default).
- `src/merge.ts` — `mergeSnapshot` (override-wins, overall rollup, staleness, audience-scoped attribution stripping).
- `src/index.ts` — re-exports.
- `test/*.test.ts` — one per module.
- `package.json`, `tsconfig.json`, `vitest.config.ts`, generated `tsconfig.build.json`.

**New worker `apps/status-worker/`** (isolated read-only public surface):

- `src/index.ts` — `ExportedHandler`: `GET /api/status.json`, `GET /`, KV-failure fallback.
- `wrangler.jsonc`, `package.json`, `tsconfig.json`, `vitest.config.ts`, generated `tsconfig.build.json`.
- `test/status-worker.test.ts` — Miniflare integration.

**Modified `packages/identifiers/`**:

- `src/registry.ts` — add `serviceEvent`, `serviceComponent` prefixes.
- `src/types.ts` — add `ServiceEventId`, `ServiceComponentId` aliases.

**Modified `packages/database/`**:

- `src/control-plane-schema.ts` — add `platform_operator` table.
- `drizzle/control-plane/0005_platform-operator.sql` — generated migration.

**Modified `packages/data-access/`**:

- `src/platform-operator-statements.ts` — select-active (with 2FA join) + insert.
- `package.json` — export the new subpath.

**Modified `packages/access-control/`**:

- `src/platform-operator.ts` — `decidePlatformOperatorAccess` (pure).
- `package.json` — export the new subpath.

**Modified `apps/worker/`**:

- `src/control-plane-migrations.ts` — register `0005`.
- `src/app.ts` — `STATUS_KV` binding on `Bindings`; `platformOperatorUserId` on `AppVariables`; register the new route group.
- `src/routes/platform/platform-operator-guard.ts` — the guard middleware.
- `src/routes/platform/platform-status.ts` — the operator write routes.
- `src/status/derived-snapshot.ts` — the cron builder (probe + poll → `status:derived`).
- `src/scheduled.ts` — call the derived-snapshot builder; `src/index.ts` — cron branch.
- `wrangler.jsonc` — `STATUS_KV` binding + a cron trigger.
- `test/*` — guard, routes, cron integration tests; `conformance.test.ts` operation-list edit.

**Modified monorepo wiring**:

- `vite.config.ts` — add `apps/status-worker/vitest.config.ts` to `test.projects` (it uses the Miniflare pool).
- Root `tsconfig.build.json` — regenerated by `vp run typecheck-refs`.

**Docs**:

- `docs/decisions/pending/service-status.md`, `docs/decisions/pending/platform-operator-principal.md` — ADR fragments.
- `changelog.d/service-status.md` — changelog fragment.
- `ROADMAP.md`, `STATUS.md` — rows.

---

## Task 1: Identifiers for service events and components

**Files:**

- Modify: `packages/identifiers/src/registry.ts`
- Modify: `packages/identifiers/src/types.ts`
- Test: `packages/identifiers/test/registry.test.ts` (existing conformance test covers the new entries)

**Interfaces:**

- Produces: `ServiceEventId = Identifier<"serviceEvent">`, `ServiceComponentId = Identifier<"serviceComponent">`; `newIdentifier("serviceEvent")`, `newIdentifier("serviceComponent")`.

- [ ] **Step 1: Add the prefixes.** In `packages/identifiers/src/registry.ts`, inside the `ENTITY_PREFIXES` object (alongside `supportGrant: "supportGrant"`), add:

```ts
  serviceEvent: "serviceEvent",
  serviceComponent: "serviceComponent",
```

- [ ] **Step 2: Add the branded aliases.** In `packages/identifiers/src/types.ts`, alongside the other `Identifier<...>` aliases, add:

```ts
export type ServiceEventId = Identifier<"serviceEvent">;
export type ServiceComponentId = Identifier<"serviceComponent">;
```

- [ ] **Step 3: Run the identifiers test suite** (the registry conformance test derives from `ENTITY_PREFIXES`, so the new keys are auto-covered — it asserts prefix==key and alphabet).

Run: `pnpm --filter @magna-carta/identifiers test`
Expected: PASS.

- [ ] **Step 4: Commit.**

```bash
git add packages/identifiers/src/registry.ts packages/identifiers/src/types.ts
git commit -m "feat(identifiers): serviceEvent + serviceComponent handles"
```

---

## Task 2: `@magna-carta/status` scaffold + vocabulary + snapshot schema

**Files:**

- Create: `packages/status/package.json`, `packages/status/tsconfig.json`, `packages/status/vitest.config.ts`
- Create: `packages/status/src/vocabulary.ts`, `packages/status/src/schema.ts`, `packages/status/src/index.ts`
- Test: `packages/status/test/schema.test.ts`

**Interfaces:**

- Produces:
  - `ComponentStatus`, `ProviderStatus`, `EventLifecycle`, `EventImpact` (types + `as const` arrays); `statusRank(s: ComponentStatus): number`; `worstStatus(...): ComponentStatus`.
  - `SCHEMA_VERSION = 1`; `STATUS_KV_KEYS = { derived: "status:derived", authored: "status:authored" }`.
  - zod schemas: `derivedSnapshotSchema`, `authoredSnapshotSchema`, `publishedSnapshotSchema` and inferred types `DerivedSnapshot`, `AuthoredSnapshot`, `PublishedSnapshot`, `DerivedComponent`, `Provider`, `ServiceEvent`, `ComponentOverride`.
  - `emptyDerived(now: string): DerivedSnapshot`, `emptyAuthored(now: string): AuthoredSnapshot`.
  - `parseDerived(text: string | null, now: string): DerivedSnapshot`, `parseAuthored(text: string | null, now: string): AuthoredSnapshot` (return an empty doc on `null`/invalid, never throw).

- [ ] **Step 1: Scaffold the package.** Create `packages/status/package.json` (model on `packages/safe-browse/package.json` — subpath exports map to `./src/*.ts`, `version` `0.0.0`, `private`, `type: module`, `sideEffects: false`):

```json
{
  "name": "@magna-carta/status",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "sideEffects": false,
  "exports": {
    "./vocabulary": "./src/vocabulary.ts",
    "./schema": "./src/schema.ts",
    "./component-registry": "./src/component-registry.ts",
    "./provider-registry": "./src/provider-registry.ts",
    "./statuspage-adapter": "./src/statuspage-adapter.ts",
    "./derive": "./src/derive.ts",
    "./merge": "./src/merge.ts",
    ".": "./src/index.ts"
  },
  "scripts": { "test": "vp test run" },
  "dependencies": {
    "@magna-carta/identifiers": "workspace:*",
    "zod": "catalog:"
  },
  "devDependencies": {
    "@magna-carta/tsconfig": "workspace:*",
    "@types/node": "catalog:",
    "vitest": "catalog:"
  }
}
```

Create `packages/status/tsconfig.json`:

```json
{
  "extends": "../tsconfig/base.json",
  "compilerOptions": {
    "lib": ["ES2022"],
    "types": ["node"],
    "allowImportingTsExtensions": true,
    "noEmit": true
  },
  "include": ["src/**/*.ts", "test/**/*.ts"]
}
```

Create `packages/status/vitest.config.ts`:

```ts
import { defineConfig } from "vite-plus";

export default defineConfig({
  root: import.meta.dirname,
});
```

- [ ] **Step 2: Write the vocabulary.** Create `packages/status/src/vocabulary.ts`:

```ts
// The component/provider status vocabulary mirrors public status pages so a status reads as
// familiar. "operational" is the resting default; a component only leaves it on positive
// evidence of a problem (an operator, a telemetry error signal, or a failed probe).
export const COMPONENT_STATUS = [
  "operational",
  "maintenance",
  "degraded",
  "partial_outage",
  "major_outage",
] as const;
export type ComponentStatus = (typeof COMPONENT_STATUS)[number];

// A provider row can additionally be "status_unavailable" when the provider's OWN status feed is
// unreachable — an honest fetch failure about their feed, not a verdict about our components.
export const PROVIDER_STATUS = [...COMPONENT_STATUS, "status_unavailable"] as const;
export type ProviderStatus = (typeof PROVIDER_STATUS)[number];

export const EVENT_LIFECYCLE = ["investigating", "identified", "monitoring", "resolved"] as const;
export type EventLifecycle = (typeof EVENT_LIFECYCLE)[number];

export const EVENT_IMPACT = ["minor", "major", "critical", "maintenance"] as const;
export type EventImpact = (typeof EVENT_IMPACT)[number];

// Severity ordering for the overall rollup: higher = worse. "status_unavailable" is deliberately
// absent — an unreachable provider feed must never worsen the overall rollup.
const RANK: Record<ComponentStatus, number> = {
  operational: 0,
  maintenance: 1,
  degraded: 2,
  partial_outage: 3,
  major_outage: 4,
};

export function statusRank(status: ComponentStatus): number {
  return RANK[status];
}

export function worstStatus(statuses: readonly ComponentStatus[]): ComponentStatus {
  return statuses.reduce<ComponentStatus>(
    (worst, s) => (statusRank(s) > statusRank(worst) ? s : worst),
    "operational",
  );
}

// An event's impact contributes to the overall rollup via this mapping while the event is active.
export function impactAsStatus(impact: EventImpact): ComponentStatus {
  switch (impact) {
    case "minor":
      return "degraded";
    case "major":
      return "partial_outage";
    case "critical":
      return "major_outage";
    case "maintenance":
      return "maintenance";
  }
}
```

- [ ] **Step 3: Write the failing schema test.** Create `packages/status/test/schema.test.ts`:

```ts
import { expect, test } from "vitest";
import { emptyAuthored, emptyDerived, parseAuthored, parseDerived } from "../src/schema.ts";

const NOW = "2026-07-02T00:00:00.000Z";

test("empty docs carry the schema version and are valid", () => {
  expect(emptyDerived(NOW)).toMatchObject({ schemaVersion: 1, components: [], providers: [] });
  expect(emptyAuthored(NOW)).toMatchObject({ schemaVersion: 1, events: [], overrides: [] });
});

test("parse returns an empty doc for null or garbage, never throws", () => {
  expect(parseDerived(null, NOW)).toEqual(emptyDerived(NOW));
  expect(parseDerived("{not json", NOW)).toEqual(emptyDerived(NOW));
  expect(parseAuthored('{"schemaVersion":999}', NOW)).toEqual(emptyAuthored(NOW));
});

test("parse round-trips a valid derived doc", () => {
  const doc = {
    schemaVersion: 1,
    generatedAt: NOW,
    components: [
      {
        id: "worker",
        name: "API",
        group: "Core",
        status: "operational",
        source: "probe",
        lastChange: NOW,
      },
    ],
    providers: [],
  };
  expect(parseDerived(JSON.stringify(doc), NOW)).toEqual(doc);
});
```

- [ ] **Step 4: Run it to confirm it fails.**

Run: `pnpm --filter @magna-carta/status test`
Expected: FAIL ("Cannot find module ../src/schema.ts").

- [ ] **Step 5: Write the schema.** Create `packages/status/src/schema.ts`:

```ts
import { z } from "zod";
import { COMPONENT_STATUS, EVENT_IMPACT, EVENT_LIFECYCLE, PROVIDER_STATUS } from "./vocabulary.ts";

export const SCHEMA_VERSION = 1 as const;

// The two writers own separate KV keys; the read path merges them, so neither clobbers the other.
export const STATUS_KV_KEYS = {
  derived: "status:derived",
  authored: "status:authored",
} as const;

const componentStatusEnum = z.enum(COMPONENT_STATUS);
const providerStatusEnum = z.enum(PROVIDER_STATUS);
const lifecycleEnum = z.enum(EVENT_LIFECYCLE);
const impactEnum = z.enum(EVENT_IMPACT);

// --- derived (cron-owned) ---
export const derivedComponentSchema = z.object({
  id: z.string(),
  name: z.string(),
  group: z.string(),
  status: componentStatusEnum,
  source: z.enum(["probe", "telemetry"]),
  lastChange: z.string(),
  note: z.string().optional(),
});
export const providerSchema = z.object({
  id: z.string(),
  name: z.string(),
  status: providerStatusEnum,
  upstreamUrl: z.string(),
  fetchedAt: z.string(),
  reachable: z.boolean(),
});
export const derivedSnapshotSchema = z.object({
  schemaVersion: z.literal(SCHEMA_VERSION),
  generatedAt: z.string(),
  components: z.array(derivedComponentSchema),
  providers: z.array(providerSchema),
});

// --- authored (operator-owned) ---
export const eventUpdateSchema = z.object({
  at: z.string(),
  lifecycle: lifecycleEnum,
  body: z.string(),
  authorUserId: z.string(),
});
export const serviceEventSchema = z.object({
  id: z.string(),
  title: z.string(),
  impact: impactEnum,
  lifecycle: lifecycleEnum,
  affectedComponentIds: z.array(z.string()),
  authorUserId: z.string(),
  startedAt: z.string(),
  resolvedAt: z.string().nullable(),
  updates: z.array(eventUpdateSchema),
});
export const componentOverrideSchema = z.object({
  componentId: z.string(),
  status: componentStatusEnum,
  note: z.string(),
  setAt: z.string(),
  authorUserId: z.string(),
});
export const authoredSnapshotSchema = z.object({
  schemaVersion: z.literal(SCHEMA_VERSION),
  updatedAt: z.string(),
  events: z.array(serviceEventSchema),
  overrides: z.array(componentOverrideSchema),
});

// --- published (merge output; author identity stripped for the public audience) ---
export const publishedComponentSchema = z.object({
  id: z.string(),
  name: z.string(),
  group: z.string(),
  status: componentStatusEnum,
  note: z.string().optional(),
});
export const publishedEventUpdateSchema = z.object({
  at: z.string(),
  lifecycle: lifecycleEnum,
  body: z.string(),
  authorUserId: z.string().optional(),
});
export const publishedEventSchema = z.object({
  id: z.string(),
  title: z.string(),
  impact: impactEnum,
  lifecycle: lifecycleEnum,
  affectedComponentIds: z.array(z.string()),
  authorUserId: z.string().optional(),
  startedAt: z.string(),
  resolvedAt: z.string().nullable(),
  updates: z.array(publishedEventUpdateSchema),
});
export const publishedSnapshotSchema = z.object({
  schemaVersion: z.literal(SCHEMA_VERSION),
  generatedAt: z.string(),
  overall: componentStatusEnum,
  components: z.array(publishedComponentSchema),
  providers: z.array(providerSchema),
  events: z.array(publishedEventSchema),
  stale: z.boolean(),
});

export type DerivedComponent = z.infer<typeof derivedComponentSchema>;
export type Provider = z.infer<typeof providerSchema>;
export type DerivedSnapshot = z.infer<typeof derivedSnapshotSchema>;
export type EventUpdate = z.infer<typeof eventUpdateSchema>;
export type ServiceEvent = z.infer<typeof serviceEventSchema>;
export type ComponentOverride = z.infer<typeof componentOverrideSchema>;
export type AuthoredSnapshot = z.infer<typeof authoredSnapshotSchema>;
export type PublishedSnapshot = z.infer<typeof publishedSnapshotSchema>;

export function emptyDerived(now: string): DerivedSnapshot {
  return { schemaVersion: SCHEMA_VERSION, generatedAt: now, components: [], providers: [] };
}
export function emptyAuthored(now: string): AuthoredSnapshot {
  return { schemaVersion: SCHEMA_VERSION, updatedAt: now, events: [], overrides: [] };
}

// A corrupt or absent KV value must degrade to an empty doc, never a thrown 500 on the read path.
export function parseDerived(text: string | null, now: string): DerivedSnapshot {
  if (text === null) return emptyDerived(now);
  try {
    const parsed = derivedSnapshotSchema.safeParse(JSON.parse(text));
    return parsed.success ? parsed.data : emptyDerived(now);
  } catch {
    return emptyDerived(now);
  }
}
export function parseAuthored(text: string | null, now: string): AuthoredSnapshot {
  if (text === null) return emptyAuthored(now);
  try {
    const parsed = authoredSnapshotSchema.safeParse(JSON.parse(text));
    return parsed.success ? parsed.data : emptyAuthored(now);
  } catch {
    return emptyAuthored(now);
  }
}
```

Create `packages/status/src/index.ts`:

```ts
export * from "./vocabulary.ts";
export * from "./schema.ts";
```

- [ ] **Step 6: Run the test to confirm it passes.**

Run: `pnpm --filter @magna-carta/status test`
Expected: PASS.

- [ ] **Step 7: Register the package in the typecheck graph and typecheck.**

Run: `node tooling/tsconfig-refs/index.mjs` (generates `packages/status/tsconfig.build.json` and appends it to the root refs), then `pnpm check`.
Expected: PASS (fmt/lint/typecheck clean).

- [ ] **Step 8: Commit.**

```bash
git add packages/status vite.config.ts tsconfig.build.json pnpm-lock.yaml
git commit -m "feat(status): package scaffold + snapshot vocabulary and schema"
```

---

## Task 3: Provider registry + Statuspage adapter (signal A)

**Files:**

- Create: `packages/status/src/provider-registry.ts`, `packages/status/src/statuspage-adapter.ts`
- Test: `packages/status/test/statuspage-adapter.test.ts`

**Interfaces:**

- Consumes: `Provider`, `ProviderStatus` from `./schema.ts` / `./vocabulary.ts`.
- Produces:
  - `ProviderDefinition = { id: string; name: string; kind: "statuspage" | "manual"; url?: string }`; `PROVIDER_REGISTRY: readonly ProviderDefinition[]`.
  - `normalizeStatuspageIndicator(indicator: string): ComponentStatus`.
  - `pollStatuspageProvider(def, fetchImpl: typeof fetch, now: string): Promise<Provider>` — resolves to a `Provider` row; on any fetch/parse failure resolves to a `status_unavailable`, `reachable: false` row (never rejects).
  - `pollProviders(fetchImpl, now): Promise<Provider[]>` — polls every `statuspage` provider; omits `manual` ones (no feed and no operator-set path yet — a documented v1 boundary).

- [ ] **Step 1: Write the failing test.** Create `packages/status/test/statuspage-adapter.test.ts`:

```ts
import { expect, test } from "vitest";
import { normalizeStatuspageIndicator, pollStatuspageProvider } from "../src/statuspage-adapter.ts";

const NOW = "2026-07-02T00:00:00.000Z";
const DEF = {
  id: "cloudflare",
  name: "Cloudflare",
  kind: "statuspage" as const,
  url: "https://x/api/v2/summary.json",
};

test("normalizes every Statuspage indicator", () => {
  expect(normalizeStatuspageIndicator("none")).toBe("operational");
  expect(normalizeStatuspageIndicator("minor")).toBe("degraded");
  expect(normalizeStatuspageIndicator("major")).toBe("partial_outage");
  expect(normalizeStatuspageIndicator("critical")).toBe("major_outage");
  expect(normalizeStatuspageIndicator("gibberish")).toBe("degraded");
});

test("polls a summary.json into a Provider row", async () => {
  const fetchImpl = (async () =>
    new Response(JSON.stringify({ status: { indicator: "minor" } }), {
      status: 200,
    })) as unknown as typeof fetch;
  const row = await pollStatuspageProvider(DEF, fetchImpl, NOW);
  expect(row).toMatchObject({
    id: "cloudflare",
    status: "degraded",
    reachable: true,
    fetchedAt: NOW,
  });
});

test("an unreachable feed yields status_unavailable, never throws", async () => {
  const fetchImpl = (async () => {
    throw new Error("network down");
  }) as unknown as typeof fetch;
  const row = await pollStatuspageProvider(DEF, fetchImpl, NOW);
  expect(row).toMatchObject({ id: "cloudflare", status: "status_unavailable", reachable: false });
});
```

- [ ] **Step 2: Run it to confirm it fails.**

Run: `pnpm --filter @magna-carta/status test statuspage-adapter`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement the registry.** Create `packages/status/src/provider-registry.ts`:

```ts
// The upstream providers this platform depends on. "statuspage" providers publish an Atlassian
// Statuspage summary.json we poll and normalize; "manual" providers have no consumable feed and
// are omitted until an operator-set path exists (a v1 boundary — see pollProviders).
export interface ProviderDefinition {
  id: string;
  name: string;
  kind: "statuspage" | "manual";
  url?: string;
}

export const PROVIDER_REGISTRY: readonly ProviderDefinition[] = [
  {
    id: "cloudflare",
    name: "Cloudflare",
    kind: "statuspage",
    url: "https://www.cloudflarestatus.com/api/v2/summary.json",
  },
  {
    id: "github",
    name: "GitHub",
    kind: "statuspage",
    url: "https://www.githubstatus.com/api/v2/summary.json",
  },
  // No consumable public feed today; carried as a placeholder, not emitted until an operator-set
  // provider-status path is built.
  { id: "helcim", name: "Helcim (payments)", kind: "manual" },
  { id: "pangram", name: "Pangram (AI-text detection)", kind: "manual" },
];
```

- [ ] **Step 4: Implement the adapter.** Create `packages/status/src/statuspage-adapter.ts`:

```ts
import type { ComponentStatus } from "./vocabulary.ts";
import type { Provider } from "./schema.ts";
import { PROVIDER_REGISTRY, type ProviderDefinition } from "./provider-registry.ts";

// Atlassian Statuspage summary.json exposes status.indicator ∈ none|minor|major|critical.
export function normalizeStatuspageIndicator(indicator: string): ComponentStatus {
  switch (indicator) {
    case "none":
      return "operational";
    case "minor":
      return "degraded";
    case "major":
      return "partial_outage";
    case "critical":
      return "major_outage";
    default:
      return "degraded";
  }
}

export async function pollStatuspageProvider(
  def: ProviderDefinition,
  fetchImpl: typeof fetch,
  now: string,
): Promise<Provider> {
  const url = def.url ?? "";
  const unavailable: Provider = {
    id: def.id,
    name: def.name,
    status: "status_unavailable",
    upstreamUrl: url,
    fetchedAt: now,
    reachable: false,
  };
  try {
    const response = await fetchImpl(url, { method: "GET" });
    if (!response.ok) return unavailable;
    const body = (await response.json()) as { status?: { indicator?: string } };
    const indicator = body.status?.indicator;
    if (typeof indicator !== "string") return unavailable;
    return {
      id: def.id,
      name: def.name,
      status: normalizeStatuspageIndicator(indicator),
      upstreamUrl: url,
      fetchedAt: now,
      reachable: true,
    };
  } catch {
    return unavailable;
  }
}

export async function pollProviders(fetchImpl: typeof fetch, now: string): Promise<Provider[]> {
  const statuspage = PROVIDER_REGISTRY.filter((p) => p.kind === "statuspage");
  return Promise.all(statuspage.map((def) => pollStatuspageProvider(def, fetchImpl, now)));
}
```

- [ ] **Step 5: Run the test to confirm it passes.**

Run: `pnpm --filter @magna-carta/status test statuspage-adapter`
Expected: PASS.

- [ ] **Step 6: Commit.**

```bash
git add packages/status/src/provider-registry.ts packages/status/src/statuspage-adapter.ts packages/status/test/statuspage-adapter.test.ts
git commit -m "feat(status): upstream provider registry + Statuspage adapter"
```

---

## Task 4: Component registry + exception-based health derivation (signal B)

**Files:**

- Create: `packages/status/src/component-registry.ts`, `packages/status/src/derive.ts`
- Test: `packages/status/test/derive.test.ts`

**Interfaces:**

- Consumes: `DerivedComponent` from `./schema.ts`.
- Produces:
  - `ComponentKind = "core-probe" | "engine"`; `ComponentDefinition = { id; name; group; kind: ComponentKind }`; `COMPONENT_REGISTRY: readonly ComponentDefinition[]`.
  - `ProbeOutcome = { ok: boolean }`; `TelemetrySignal = { errorRatePerMinute: number; sampleCount: number }`.
  - `deriveComponents(input: { now; probes: Record<string, ProbeOutcome>; signals: Record<string, TelemetrySignal>; degradedThreshold: number; outageThreshold: number }): DerivedComponent[]`.

- [ ] **Step 1: Write the failing test.** Create `packages/status/test/derive.test.ts`:

```ts
import { expect, test } from "vitest";
import { deriveComponents } from "../src/derive.ts";

const NOW = "2026-07-02T00:00:00.000Z";
const base = { now: NOW, probes: {}, signals: {}, degradedThreshold: 0.1, outageThreshold: 1 };

function byId(components: ReturnType<typeof deriveComponents>, id: string) {
  return components.find((c) => c.id === id);
}

test("an idle engine defaults to operational (never unknown)", () => {
  const out = deriveComponents(base);
  const collabora = byId(out, "collabora");
  expect(collabora?.status).toBe("operational");
  expect(collabora?.source).toBe("telemetry");
});

test("a failed core probe flips that component to major_outage", () => {
  const out = deriveComponents({ ...base, probes: { "control-plane-database": { ok: false } } });
  expect(byId(out, "control-plane-database")?.status).toBe("major_outage");
  // A passing probe elsewhere stays operational.
  const out2 = deriveComponents({ ...base, probes: { "control-plane-database": { ok: true } } });
  expect(byId(out2, "control-plane-database")?.status).toBe("operational");
});

test("engine telemetry error signal degrades then outages by threshold", () => {
  const degraded = deriveComponents({
    ...base,
    signals: { collabora: { errorRatePerMinute: 0.5, sampleCount: 20 } },
  });
  expect(byId(degraded, "collabora")?.status).toBe("degraded");
  const outage = deriveComponents({
    ...base,
    signals: { collabora: { errorRatePerMinute: 5, sampleCount: 20 } },
  });
  expect(byId(outage, "collabora")?.status).toBe("partial_outage");
});
```

- [ ] **Step 2: Run it to confirm it fails.**

Run: `pnpm --filter @magna-carta/status test derive`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement the component registry.** Create `packages/status/src/component-registry.ts`:

```ts
// Our components. "core-probe" primitives are cheap and always warm, so the cron actively probes
// them and a probe failure is positive evidence. "engine" components are scale-to-zero containers
// we never boot just to check — their health comes only from telemetry error signal or an operator.
export type ComponentKind = "core-probe" | "engine";
export interface ComponentDefinition {
  id: string;
  name: string;
  group: string;
  kind: ComponentKind;
}

export const COMPONENT_REGISTRY: readonly ComponentDefinition[] = [
  { id: "api", name: "Application API", group: "Core", kind: "core-probe" },
  {
    id: "control-plane-database",
    name: "Control-plane database",
    group: "Core",
    kind: "core-probe",
  },
  { id: "object-storage", name: "Object storage", group: "Core", kind: "core-probe" },
  { id: "status-store", name: "Status store", group: "Core", kind: "core-probe" },
  { id: "collabora", name: "Document editing", group: "Engines", kind: "engine" },
  { id: "libreoffice", name: "Document conversion", group: "Engines", kind: "engine" },
  { id: "tantivy", name: "Search indexing", group: "Engines", kind: "engine" },
  { id: "ocr", name: "OCR", group: "Engines", kind: "engine" },
  { id: "scan", name: "Malware scanning", group: "Engines", kind: "engine" },
];
```

- [ ] **Step 4: Implement the derivation.** Create `packages/status/src/derive.ts`:

```ts
import type { ComponentStatus } from "./vocabulary.ts";
import type { DerivedComponent } from "./schema.ts";
import { COMPONENT_REGISTRY } from "./component-registry.ts";

export interface ProbeOutcome {
  ok: boolean;
}
export interface TelemetrySignal {
  errorRatePerMinute: number;
  sampleCount: number;
}

export interface DeriveInput {
  now: string;
  // core-probe components, by component id
  probes: Record<string, ProbeOutcome>;
  // engine components, by component id (absent or sampleCount 0 => idle => operational)
  signals: Record<string, TelemetrySignal>;
  degradedThreshold: number;
  outageThreshold: number;
}

// The default resting state is operational; a component leaves it only on positive evidence.
export function deriveComponents(input: DeriveInput): DerivedComponent[] {
  return COMPONENT_REGISTRY.map((def) => {
    if (def.kind === "core-probe") {
      const probe = input.probes[def.id];
      const status: ComponentStatus = probe && !probe.ok ? "major_outage" : "operational";
      return {
        id: def.id,
        name: def.name,
        group: def.group,
        status,
        source: "probe",
        lastChange: input.now,
      };
    }
    const signal = input.signals[def.id];
    let status: ComponentStatus = "operational";
    if (signal && signal.sampleCount > 0) {
      if (signal.errorRatePerMinute >= input.outageThreshold) status = "partial_outage";
      else if (signal.errorRatePerMinute >= input.degradedThreshold) status = "degraded";
    }
    return {
      id: def.id,
      name: def.name,
      group: def.group,
      status,
      source: "telemetry",
      lastChange: input.now,
    };
  });
}
```

- [ ] **Step 5: Run the test to confirm it passes.**

Run: `pnpm --filter @magna-carta/status test derive`
Expected: PASS.

- [ ] **Step 6: Commit.**

```bash
git add packages/status/src/component-registry.ts packages/status/src/derive.ts packages/status/test/derive.test.ts
git commit -m "feat(status): component registry + exception-based health derivation"
```

---

## Task 5: `mergeSnapshot` — override-wins, overall rollup, staleness, audience-scoped attribution

**Files:**

- Create: `packages/status/src/merge.ts`
- Modify: `packages/status/src/index.ts` (re-export merge + registries + derive)
- Test: `packages/status/test/merge.test.ts`

**Interfaces:**

- Consumes: `DerivedSnapshot`, `AuthoredSnapshot`, `PublishedSnapshot` from `./schema.ts`; `worstStatus`, `impactAsStatus` from `./vocabulary.ts`.
- Produces: `mergeSnapshot(derived, authored, opts: { audience: "public" | "internal"; now: string; stalenessThresholdMs: number }): PublishedSnapshot`.

- [ ] **Step 1: Write the failing test.** Create `packages/status/test/merge.test.ts`:

```ts
import { expect, test } from "vitest";
import { mergeSnapshot } from "../src/merge.ts";
import type { AuthoredSnapshot, DerivedSnapshot } from "../src/schema.ts";

const NOW = "2026-07-02T00:10:00.000Z";
const derived: DerivedSnapshot = {
  schemaVersion: 1,
  generatedAt: "2026-07-02T00:09:00.000Z",
  components: [
    {
      id: "api",
      name: "API",
      group: "Core",
      status: "operational",
      source: "probe",
      lastChange: NOW,
    },
    {
      id: "ocr",
      name: "OCR",
      group: "Engines",
      status: "operational",
      source: "telemetry",
      lastChange: NOW,
    },
  ],
  providers: [
    {
      id: "cloudflare",
      name: "Cloudflare",
      status: "operational",
      upstreamUrl: "u",
      fetchedAt: NOW,
      reachable: true,
    },
    {
      id: "github",
      name: "GitHub",
      status: "status_unavailable",
      upstreamUrl: "u",
      fetchedAt: NOW,
      reachable: false,
    },
  ],
};
const authored: AuthoredSnapshot = {
  schemaVersion: 1,
  updatedAt: NOW,
  events: [
    {
      id: "serviceEvent_1",
      title: "OCR slow",
      impact: "minor",
      lifecycle: "investigating",
      affectedComponentIds: ["ocr"],
      authorUserId: "usr_op",
      startedAt: NOW,
      resolvedAt: null,
      updates: [{ at: NOW, lifecycle: "investigating", body: "looking", authorUserId: "usr_op" }],
    },
  ],
  overrides: [
    { componentId: "ocr", status: "degraded", note: "manual", setAt: NOW, authorUserId: "usr_op" },
  ],
};

test("an operator override wins over the derived component status", () => {
  const pub = mergeSnapshot(derived, authored, {
    audience: "internal",
    now: NOW,
    stalenessThresholdMs: 600000,
  });
  expect(pub.components.find((c) => c.id === "ocr")?.status).toBe("degraded");
});

test("overall reflects the worst component + active event impact, ignoring status_unavailable providers", () => {
  const pub = mergeSnapshot(derived, authored, {
    audience: "internal",
    now: NOW,
    stalenessThresholdMs: 600000,
  });
  // ocr override degraded + event impact minor->degraded => overall degraded (github unavailable ignored).
  expect(pub.overall).toBe("degraded");
});

test("public audience strips every authorUserId; internal keeps it", () => {
  const pub = mergeSnapshot(derived, authored, {
    audience: "public",
    now: NOW,
    stalenessThresholdMs: 600000,
  });
  expect(pub.events[0]?.authorUserId).toBeUndefined();
  expect(pub.events[0]?.updates[0]?.authorUserId).toBeUndefined();
  const internal = mergeSnapshot(derived, authored, {
    audience: "internal",
    now: NOW,
    stalenessThresholdMs: 600000,
  });
  expect(internal.events[0]?.authorUserId).toBe("usr_op");
});

test("stale is set when generatedAt is older than the threshold", () => {
  const old = { ...derived, generatedAt: "2026-07-02T00:00:00.000Z" };
  const pub = mergeSnapshot(old, authored, {
    audience: "public",
    now: NOW,
    stalenessThresholdMs: 300000,
  });
  expect(pub.stale).toBe(true);
});
```

- [ ] **Step 2: Run it to confirm it fails.**

Run: `pnpm --filter @magna-carta/status test merge`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement the merge.** Create `packages/status/src/merge.ts`:

```ts
import type { AuthoredSnapshot, DerivedSnapshot, PublishedSnapshot } from "./schema.ts";
import { SCHEMA_VERSION } from "./schema.ts";
import { type ComponentStatus, impactAsStatus, worstStatus } from "./vocabulary.ts";

export interface MergeOptions {
  audience: "public" | "internal";
  now: string;
  stalenessThresholdMs: number;
}

export function mergeSnapshot(
  derived: DerivedSnapshot,
  authored: AuthoredSnapshot,
  opts: MergeOptions,
): PublishedSnapshot {
  const overrideByComponent = new Map(authored.overrides.map((o) => [o.componentId, o]));

  const components = derived.components.map((component) => {
    const override = overrideByComponent.get(component.id);
    const status = override ? override.status : component.status;
    const note = override ? override.note : component.note;
    return { id: component.id, name: component.name, group: component.group, status, note };
  });

  const activeEvents = authored.events.filter((e) => e.lifecycle !== "resolved");

  // Overall = worst of component statuses + active-event impacts. Providers that are merely
  // status_unavailable never worsen it (their feed is down, not our platform).
  const overallInputs: ComponentStatus[] = [
    ...components.map((c) => c.status),
    ...derived.providers
      .filter((p) => p.status !== "status_unavailable")
      .map((p) => p.status as ComponentStatus),
    ...activeEvents.map((e) => impactAsStatus(e.impact)),
  ];
  const overall = worstStatus(overallInputs);

  const stripped = opts.audience === "public";
  const events = authored.events.map((event) => ({
    id: event.id,
    title: event.title,
    impact: event.impact,
    lifecycle: event.lifecycle,
    affectedComponentIds: event.affectedComponentIds,
    ...(stripped ? {} : { authorUserId: event.authorUserId }),
    startedAt: event.startedAt,
    resolvedAt: event.resolvedAt,
    updates: event.updates.map((u) => ({
      at: u.at,
      lifecycle: u.lifecycle,
      body: u.body,
      ...(stripped ? {} : { authorUserId: u.authorUserId }),
    })),
  }));

  const ageMs = Date.parse(opts.now) - Date.parse(derived.generatedAt);
  const stale = Number.isFinite(ageMs) && ageMs > opts.stalenessThresholdMs;

  return {
    schemaVersion: SCHEMA_VERSION,
    generatedAt: derived.generatedAt,
    overall,
    components,
    providers: derived.providers,
    events,
    stale,
  };
}
```

Update `packages/status/src/index.ts`:

```ts
export * from "./vocabulary.ts";
export * from "./schema.ts";
export * from "./component-registry.ts";
export * from "./provider-registry.ts";
export * from "./statuspage-adapter.ts";
export * from "./derive.ts";
export * from "./merge.ts";
```

- [ ] **Step 4: Run the test to confirm it passes.**

Run: `pnpm --filter @magna-carta/status test merge`
Expected: PASS.

- [ ] **Step 5: Typecheck and commit.**

Run: `pnpm check`. Expected: PASS.

```bash
git add packages/status/src/merge.ts packages/status/src/index.ts packages/status/test/merge.test.ts
git commit -m "feat(status): audience-scoped merge with overall rollup and staleness"
```

---

## Task 6: `platform_operator` control-plane table + migration

**Files:**

- Modify: `packages/database/src/control-plane-schema.ts`
- Create (generated): `packages/database/drizzle/control-plane/0005_platform-operator.sql`
- Modify: `packages/database/drizzle/control-plane/meta/_journal.json` + snapshot (generated)
- Modify: `apps/worker/src/control-plane-migrations.ts`
- Test: `packages/database/test/generated-migrations.test.ts` (existing; must stay green), `apps/worker/test/control-plane-migrations.test.ts` (existing; must stay green)

**Interfaces:**

- Produces: `platformOperator` drizzle table; SQL table `platform_operator (user_id TEXT PK, granted_at TEXT NOT NULL, granted_by TEXT NOT NULL, expires_at TEXT, note TEXT)`.

- [ ] **Step 1: Add the table to the schema.** In `packages/database/src/control-plane-schema.ts`, in the "our control-plane tables" region (after `supportGrant`), add — mirroring the `supportGrant` idiom (text columns, ISO-8601 timestamps, branded ids). Ensure `UserId` is already imported from `@magna-carta/identifiers/types` (it is):

```ts
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
```

- [ ] **Step 2: Generate the migration.**

Run: `pnpm --filter @magna-carta/database run generate-control-plane-migrations`
Expected: a new `packages/database/drizzle/control-plane/0005_*.sql` plus updated `meta/_journal.json` and a new `meta/0005_snapshot.json`.

- [ ] **Step 3: Rename the migration to a meaningful tag** (the repo renames drizzle's random slugs). Rename the generated `0005_*.sql` file to `0005_platform-operator.sql`, and in `meta/_journal.json` change that entry's `tag` to `0005_platform-operator`. Confirm the SQL is:

```sql
CREATE TABLE `platform_operator` (
	`user_id` text PRIMARY KEY NOT NULL,
	`granted_at` text NOT NULL,
	`granted_by` text NOT NULL,
	`expires_at` text,
	`note` text,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action
);
```

- [ ] **Step 4: Register the migration in the runtime loader.** In `apps/worker/src/control-plane-migrations.ts`, add the import and the map entry:

```ts
import platformOperatorSql from "@magna-carta/database/drizzle/control-plane/0005_platform-operator.sql";
```

and inside the object passed to `migrationsFromJournal`:

```ts
    "0005_platform-operator": platformOperatorSql,
```

- [ ] **Step 5: Run the migration + schema tests.**

Run: `pnpm --filter @magna-carta/database test && pnpm --filter @magna-carta/worker test control-plane-migrations`
Expected: PASS (the journal-vs-disk walk and the Miniflare apply both green; loader carries every journal tag).

- [ ] **Step 6: Commit.**

```bash
git add packages/database/src/control-plane-schema.ts packages/database/drizzle/control-plane apps/worker/src/control-plane-migrations.ts
git commit -m "feat(database): platform_operator control-plane table + migration 0005"
```

---

## Task 7: `platform_operator` data-access statements

**Files:**

- Create: `packages/data-access/src/platform-operator-statements.ts`
- Modify: `packages/data-access/package.json` (add the export)
- Test: `packages/data-access/test/platform-operator-statements.test.ts`

**Interfaces:**

- Consumes: `SqlDatabase`, `SqlStatement` from `./idempotency-statements.ts`; `UserId` from `@magna-carta/identifiers/types`.
- Produces:
  - `PLATFORM_OPERATOR_TABLE = "platform_operator"`.
  - `PlatformOperatorAccessRow = { user_id: string; two_factor_enabled: number }`.
  - `selectActivePlatformOperatorStatement(db, userId, nowIso): SqlStatement` — joins `user` to surface the acting user's 2FA state; filters to unexpired grants.
  - `insertPlatformOperatorStatement(db, { userId, grantedByUserId, grantedAt, expiresAt, note }): SqlStatement` — `ON CONFLICT DO NOTHING` (idempotent seed).

- [ ] **Step 1: Verify the 2FA column name.** Confirm the SQL column for Better Auth's 2FA flag in `packages/database/src/control-plane-schema.ts` (the `user` table). It is `two_factor_enabled` (field `twoFactorEnabled`). If the emitted SQL uses a different column name, use that name in Step 3.

Run: `grep -n "two_factor\|twoFactorEnabled" packages/database/src/control-plane-schema.ts`
Expected: shows the `twoFactorEnabled` field mapped to `two_factor_enabled`.

- [ ] **Step 2: Write the failing test.** Create `packages/data-access/test/platform-operator-statements.test.ts`:

```ts
import { expect, test } from "vitest";
import {
  insertPlatformOperatorStatement,
  selectActivePlatformOperatorStatement,
} from "../src/platform-operator-statements.ts";

function fakeDb() {
  const calls: { sql: string; bound: unknown[] }[] = [];
  const db = {
    prepare(sql: string) {
      const record = { sql, bound: [] as unknown[] };
      calls.push(record);
      const stmt = {
        bind(...values: unknown[]) {
          record.bound = values;
          return stmt;
        },
        async run() {
          return { meta: { changes: 1 } };
        },
        async all<T>() {
          return { results: [] as T[] };
        },
      };
      return stmt;
    },
  };
  return { db, calls };
}

test("select filters unexpired operators and joins the user 2FA flag", () => {
  const { db, calls } = fakeDb();
  selectActivePlatformOperatorStatement(db as never, "usr_1" as never, "2026-07-02T00:00:00.000Z");
  expect(calls[0]?.sql).toContain("platform_operator");
  expect(calls[0]?.sql).toContain("two_factor_enabled");
  expect(calls[0]?.sql).toContain("expires_at IS NULL OR");
  expect(calls[0]?.bound).toEqual(["usr_1", "2026-07-02T00:00:00.000Z"]);
});

test("insert is idempotent (ON CONFLICT DO NOTHING) and binds all columns", () => {
  const { db, calls } = fakeDb();
  insertPlatformOperatorStatement(db as never, {
    userId: "usr_1" as never,
    grantedByUserId: "usr_2" as never,
    grantedAt: "2026-07-02T00:00:00.000Z",
    expiresAt: null,
    note: "bootstrap",
  });
  expect(calls[0]?.sql).toContain("ON CONFLICT DO NOTHING");
  expect(calls[0]?.bound).toEqual([
    "usr_1",
    "2026-07-02T00:00:00.000Z",
    "usr_2",
    null,
    "bootstrap",
  ]);
});
```

- [ ] **Step 3: Implement the statements.** Create `packages/data-access/src/platform-operator-statements.ts`:

```ts
import type { UserId } from "@magna-carta/identifiers/types";
import type { SqlDatabase, SqlStatement } from "./idempotency-statements.ts";

export const PLATFORM_OPERATOR_TABLE = "platform_operator";

export interface PlatformOperatorAccessRow {
  user_id: string;
  two_factor_enabled: number;
}

// "user" is a SQL keyword, so it is quoted. The join surfaces the acting user's 2FA state so the
// guard can require it (a platform-trust identity should not rest on a password alone).
export function selectActivePlatformOperatorStatement(
  database: SqlDatabase,
  userId: UserId,
  nowIso: string,
): SqlStatement {
  return database
    .prepare(
      `SELECT po.user_id AS user_id, u.two_factor_enabled AS two_factor_enabled ` +
        `FROM ${PLATFORM_OPERATOR_TABLE} po JOIN "user" u ON u.id = po.user_id ` +
        `WHERE po.user_id = ?1 AND (po.expires_at IS NULL OR po.expires_at > ?2) LIMIT 1`,
    )
    .bind(userId, nowIso);
}

export function insertPlatformOperatorStatement(
  database: SqlDatabase,
  values: {
    userId: UserId;
    grantedByUserId: UserId;
    grantedAt: string;
    expiresAt: string | null;
    note: string | null;
  },
): SqlStatement {
  return database
    .prepare(
      `INSERT INTO ${PLATFORM_OPERATOR_TABLE} (user_id, granted_at, granted_by, expires_at, note) ` +
        `VALUES (?1, ?2, ?3, ?4, ?5) ON CONFLICT DO NOTHING`,
    )
    .bind(values.userId, values.grantedAt, values.grantedByUserId, values.expiresAt, values.note);
}
```

- [ ] **Step 4: Export the subpath.** In `packages/data-access/package.json`, add to `exports`:

```json
    "./platform-operator-statements": "./src/platform-operator-statements.ts",
```

- [ ] **Step 5: Run the test to confirm it passes.**

Run: `pnpm --filter @magna-carta/data-access test platform-operator-statements`
Expected: PASS.

- [ ] **Step 6: Commit.**

```bash
git add packages/data-access/src/platform-operator-statements.ts packages/data-access/package.json packages/data-access/test/platform-operator-statements.test.ts
git commit -m "feat(data-access): platform_operator select (with 2FA) + idempotent insert"
```

---

## Task 8: `platformOperatorGuard` — pure decision + middleware

**Files:**

- Create: `packages/access-control/src/platform-operator.ts`
- Modify: `packages/access-control/package.json` (export)
- Create: `apps/worker/src/routes/platform/platform-operator-guard.ts`
- Modify: `apps/worker/src/chokepoint/ports.ts` (add `platformOperatorUserId` to `AppVariables`)
- Test: `packages/access-control/test/platform-operator.test.ts`, `apps/worker/test/platform-operator-guard.test.ts`

**Interfaces:**

- Produces:
  - `decidePlatformOperatorAccess(row: PlatformOperatorAccessRow | undefined): { allow: true } | { allow: false; reason: "not-operator" | "mfa-required" }`.
  - `platformOperatorGuard: MiddlewareHandler` — resolves the Better Auth session; 401 if none; queries the operator row; 403 (`not-operator` or `mfa-required`); on allow sets `c.set("platformOperatorUserId", userId)`.
- Consumes: `selectActivePlatformOperatorStatement`, `PlatformOperatorAccessRow` (Task 7); `resolveSession` + `authForEnv` (existing session plumbing); `problemJson`, telemetry `authDenied`/`newErrorId` (existing).

- [ ] **Step 1: Write the failing pure-decision test.** Create `packages/access-control/test/platform-operator.test.ts`:

```ts
import { expect, test } from "vitest";
import { decidePlatformOperatorAccess } from "../src/platform-operator.ts";

test("no row => not an operator", () => {
  expect(decidePlatformOperatorAccess(undefined)).toEqual({ allow: false, reason: "not-operator" });
});

test("operator without 2FA => mfa-required", () => {
  expect(decidePlatformOperatorAccess({ user_id: "usr_1", two_factor_enabled: 0 })).toEqual({
    allow: false,
    reason: "mfa-required",
  });
});

test("operator with 2FA => allow", () => {
  expect(decidePlatformOperatorAccess({ user_id: "usr_1", two_factor_enabled: 1 })).toEqual({
    allow: true,
  });
});
```

- [ ] **Step 2: Run it to confirm it fails.**

Run: `pnpm --filter @magna-carta/access-control test platform-operator`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement the pure decision.** Create `packages/access-control/src/platform-operator.ts`:

```ts
import type { PlatformOperatorAccessRow } from "@magna-carta/data-access/platform-operator-statements";

export type PlatformOperatorDecision =
  | { allow: true }
  | { allow: false; reason: "not-operator" | "mfa-required" };

// Authorize a platform-operator action. Membership must exist AND the acting account must have
// two-factor enabled — a platform-trust identity should not rest on a password alone.
export function decidePlatformOperatorAccess(
  row: PlatformOperatorAccessRow | undefined,
): PlatformOperatorDecision {
  if (row === undefined) return { allow: false, reason: "not-operator" };
  if (!row.two_factor_enabled) return { allow: false, reason: "mfa-required" };
  return { allow: true };
}
```

Add `@magna-carta/data-access` as a dependency of `packages/access-control` (it currently depends only on `@magna-carta/identifiers`): in `packages/access-control/package.json` add `"@magna-carta/data-access": "workspace:*"` to `dependencies`, and add the export:

```json
    "./platform-operator": "./src/platform-operator.ts",
```

- [ ] **Step 4: Run the pure test to confirm it passes.**

Run: `pnpm --filter @magna-carta/access-control test platform-operator`
Expected: PASS.

- [ ] **Step 5: Add the context variable.** In `apps/worker/src/chokepoint/ports.ts`, on the `AppVariables` type (alongside `logger?` / `correlationId?`), add:

```ts
  platformOperatorUserId?: import("@magna-carta/identifiers/types").UserId;
```

- [ ] **Step 6: Implement the middleware.** Create `apps/worker/src/routes/platform/platform-operator-guard.ts`. (Import `resolveSession` from `../session-context.ts` and `authForEnv` from the same module `ports.ts` imports it from — confirm with `grep -n "authForEnv" apps/worker/src/chokepoint/ports.ts apps/worker/src/app.ts`.)

```ts
import type { MiddlewareHandler } from "hono";
import { decidePlatformOperatorAccess } from "@magna-carta/access-control/platform-operator";
import {
  selectActivePlatformOperatorStatement,
  type PlatformOperatorAccessRow,
} from "@magna-carta/data-access/platform-operator-statements";
import { authDenied } from "@magna-carta/telemetry/events";
import { newErrorId } from "@magna-carta/telemetry/ids";
import type { Bindings } from "../app.ts";
import type { AppVariables } from "../chokepoint/ports.ts";
import { resolveSession } from "../session-context.ts";
import { authForEnv } from "../app.ts";
import { problemJson } from "../contracts/problem.ts";

type GuardEnv = { Bindings: Bindings; Variables: AppVariables };

// A platform-level guard for global-operator actions. Runs as route-specific middleware on a
// surface: "public" route (so the per-firm chokepoint does not try to resolve a firm), resolving
// the Better Auth session itself and authorizing the platform_operator principal.
export const platformOperatorGuard: MiddlewareHandler<GuardEnv> = async (c, next) => {
  const session = await resolveSession(authForEnv(c.env), c);
  const correlationId = c.get("correlationId") ?? "";
  if (session === null) {
    const errorId = newErrorId();
    c.get("logger")?.log(
      authDenied(
        { correlationId, now: new Date().toISOString() },
        { cause: "missing-header", route: c.req.routePath, errorId },
      ),
    );
    return problemJson(c, {
      type: "unauthenticated",
      title: "Authentication required",
      status: 401,
      detail: "Sign in to call this endpoint.",
      errorId,
    });
  }
  const nowIso = new Date().toISOString();
  const row = (
    await selectActivePlatformOperatorStatement(
      c.env.DB_CONTROL,
      session.userId,
      nowIso,
    ).all<PlatformOperatorAccessRow>()
  ).results[0];
  const decision = decidePlatformOperatorAccess(row);
  if (!decision.allow) {
    const errorId = newErrorId();
    c.get("logger")?.log(
      authDenied(
        { correlationId, now: nowIso },
        { cause: "mismatch", route: c.req.routePath, errorId },
      ),
    );
    const detail =
      decision.reason === "mfa-required"
        ? "Enable two-factor authentication to perform platform-operator actions."
        : "This account is not a platform operator.";
    return problemJson(c, {
      type: "permission-denied",
      title: "Forbidden",
      status: 403,
      detail,
      errorId,
    });
  }
  c.set("platformOperatorUserId", session.userId);
  await next();
};
```

If `authForEnv` is not exported from `app.ts`, export it (add `export` to its declaration) — it is already constructed there for the chokepoint ports.

- [ ] **Step 7: Write the guard integration test.** Create `apps/worker/test/platform-operator-guard.test.ts`. This drives the guard through a throwaway route with Miniflare, exercising 401 (no session) and 403 (`not-operator`) — the paths reachable without minting a real Better Auth session. (The allow + `mfa-required` paths are covered end-to-end in Task 9's route tests once a seeded operator + session helper exists; the pure decision is already unit-tested in Step 1.)

```ts
import { env, SELF } from "cloudflare:test";
import { beforeAll, expect, test } from "vitest";
import { applyControlPlaneMigrations } from "./support/apply-control-plane-migrations.ts";

beforeAll(async () => {
  await applyControlPlaneMigrations(env.DB_CONTROL);
});

test("unauthenticated request to a platform-status route is 401", async () => {
  const response = await SELF.fetch("https://example.com/api/v1/platform/status/events", {
    method: "POST",
    headers: { "content-type": "application/json", "Idempotency-Key": "k1" },
    body: JSON.stringify({ title: "x", impact: "minor", affectedComponentIds: [] }),
  });
  expect(response.status).toBe(401);
});
```

(The full 403/allow coverage lands in Task 9 once the route exists; this asserts the guard is wired and fails closed.)

- [ ] **Step 8: Typecheck. (Route wiring happens in Task 9, so the 401 test runs there.)**

Run: `pnpm check`
Expected: PASS. Commit.

```bash
git add packages/access-control apps/worker/src/routes/platform/platform-operator-guard.ts apps/worker/src/chokepoint/ports.ts apps/worker/test/platform-operator-guard.test.ts
git commit -m "feat(access-control): platform-operator decision + guard middleware"
```

---

## Task 9: Platform-status write routes — event lifecycle

**Files:**

- Create: `apps/worker/src/status/authored-store.ts` (KV read-modify-write of `status:authored`)
- Create: `apps/worker/src/routes/platform/platform-status.ts` (declare / update / resolve endpoints)
- Modify: `apps/worker/src/app.ts` (register the route group; `STATUS_KV` binding — added fully in Task 11, but declare the type here)
- Modify: `apps/worker/test/conformance.test.ts` (add operationIds)
- Test: `apps/worker/test/platform-status-events.test.ts`

**Interfaces:**

- Consumes: `parseAuthored`, `authoredSnapshotSchema`, `STATUS_KV_KEYS`, `ServiceEvent` from `@magna-carta/status`; `newIdentifier` from `@magna-carta/identifiers/generate`; `platformOperatorGuard` (Task 8); `chokepointMiddleware`, `defineOpenAPIRoute`, `requireChokepointIdempotency` (existing).
- Produces: route group registered by `registerPlatformStatusRoute(app, chokepoint)`; operationIds `platformStatus.declareEvent`, `platformStatus.postUpdate`, `platformStatus.resolveEvent`. Authored-store helpers `readAuthored(kv, now)`, `mutateAuthored(kv, now, fn)`.

- [ ] **Step 1: Declare `STATUS_KV` on `Bindings`.** In `apps/worker/src/app.ts`, in the `Bindings` type, add:

```ts
STATUS_KV: KVNamespace;
```

- [ ] **Step 2: Write the authored-store helper.** Create `apps/worker/src/status/authored-store.ts`:

```ts
import { type AuthoredSnapshot, parseAuthored, STATUS_KV_KEYS } from "@magna-carta/status";

export async function readAuthored(kv: KVNamespace, now: string): Promise<AuthoredSnapshot> {
  return parseAuthored(await kv.get(STATUS_KV_KEYS.authored), now);
}

// Read-modify-write the operator-owned doc. The cron owns a DIFFERENT key (status:derived), so
// there is no cross-writer race; concurrent operator writes are rare (single small operator team)
// and last-write-wins on this one key is acceptable for v1.
export async function mutateAuthored(
  kv: KVNamespace,
  now: string,
  mutate: (current: AuthoredSnapshot) => AuthoredSnapshot,
): Promise<AuthoredSnapshot> {
  const current = await readAuthored(kv, now);
  const next = { ...mutate(current), updatedAt: now };
  await kv.put(STATUS_KV_KEYS.authored, JSON.stringify(next));
  return next;
}
```

- [ ] **Step 3: Write the failing route test.** Create `apps/worker/test/platform-status-events.test.ts`. It seeds a `platform_operator` row with 2FA and exercises declare→update→resolve. (Reuse the test's session-mint helper if one exists; otherwise this test seeds the operator and asserts the 403 `not-operator`/`mfa-required` and the authored-store shape directly by unit-driving `mutateAuthored`. Prefer the end-to-end path if `apps/worker/test/support` provides a session helper — `grep -rl "createSession\|signIn\|sessionCookie" apps/worker/test/support`.)

```ts
import { env } from "cloudflare:test";
import { beforeEach, expect, test } from "vitest";
import { STATUS_KV_KEYS } from "@magna-carta/status";
import { mutateAuthored, readAuthored } from "../src/status/authored-store.ts";

const NOW = "2026-07-02T00:00:00.000Z";

beforeEach(async () => {
  await env.STATUS_KV.delete(STATUS_KV_KEYS.authored);
});

test("mutateAuthored appends an event and stamps updatedAt", async () => {
  const doc = await mutateAuthored(env.STATUS_KV, NOW, (current) => ({
    ...current,
    events: [
      ...current.events,
      {
        id: "serviceEvent_1",
        title: "Editing degraded",
        impact: "major",
        lifecycle: "investigating",
        affectedComponentIds: ["collabora"],
        authorUserId: "usr_op",
        startedAt: NOW,
        resolvedAt: null,
        updates: [
          { at: NOW, lifecycle: "investigating", body: "Investigating.", authorUserId: "usr_op" },
        ],
      },
    ],
  }));
  expect(doc.events).toHaveLength(1);
  const reread = await readAuthored(env.STATUS_KV, NOW);
  expect(reread.events[0]?.title).toBe("Editing degraded");
});
```

(Ensure `apps/status-worker`/`apps/worker` wrangler binds `STATUS_KV` for this test — Task 11 adds it to `apps/worker/wrangler.jsonc`; if running this task before Task 11, add the `kv_namespaces` block to `apps/worker/wrangler.jsonc` now — see Task 11 Step 1.)

- [ ] **Step 4: Run it to confirm it fails.**

Run: `pnpm --filter @magna-carta/worker test platform-status-events`
Expected: FAIL (authored-store module or STATUS_KV binding missing).

- [ ] **Step 5: Implement the routes.** Create `apps/worker/src/routes/platform/platform-status.ts`. Define three endpoints; all `surface: "public"`, `authenticated: true`, `permission: "firm:provision"` (nominal — public routes skip RBAC but the mutating-method guard requires a non-null permission), `idempotency: "optional"`, `rateLimit: "auth"`, guarded by `platformOperatorGuard`. The author is `c.get("platformOperatorUserId")`.

```ts
import { z, type OpenAPIHono } from "@hono/zod-openapi";
import type { MiddlewareHandler } from "hono";
import { newIdentifier } from "@magna-carta/identifiers/generate";
import type { Bindings } from "../app.ts";
import type { AppVariables } from "../chokepoint/ports.ts";
import type { Chokepoint } from "../chokepoint/chokepoint.ts";
import { chokepointMiddleware } from "../chokepoint/register.ts";
import { requireChokepointUserIdOptional } from "../chokepoint/context-accessors.ts";
import { defineOpenAPIRoute, type RouteMeta } from "../contracts/route-meta.ts";
import { Problem, problemJson } from "../contracts/problem.ts";
import { platformOperatorGuard } from "./platform-operator-guard.ts";
import { mutateAuthored } from "../status/authored-store.ts";

const EVENT_IMPACT = ["minor", "major", "critical", "maintenance"] as const;
const LIFECYCLE = ["investigating", "identified", "monitoring", "resolved"] as const;

const DeclareBody = z
  .object({
    title: z.string().min(1),
    impact: z.enum(EVENT_IMPACT),
    affectedComponentIds: z.array(z.string()),
    body: z.string().min(1),
  })
  .openapi("DeclareServiceEvent");

const UpdateBody = z
  .object({ eventId: z.string(), lifecycle: z.enum(LIFECYCLE), body: z.string().min(1) })
  .openapi("PostServiceEventUpdate");

const EventResult = z.object({ eventId: z.string() }).openapi("ServiceEventResult");

const commonMeta = {
  surface: "public",
  authenticated: true,
  permission: "firm:provision",
  resource: "firm",
  audited: true,
  idempotency: "optional",
  rateLimit: "auth",
} satisfies Omit<RouteMeta, "operationId">;

export const declareEventMeta: RouteMeta = {
  ...commonMeta,
  operationId: "platformStatus.declareEvent",
};
export const postUpdateMeta: RouteMeta = {
  ...commonMeta,
  operationId: "platformStatus.postUpdate",
};
export const resolveEventMeta: RouteMeta = {
  ...commonMeta,
  operationId: "platformStatus.resolveEvent",
};

export const declareEventRoute = defineOpenAPIRoute(declareEventMeta, {
  method: "post",
  path: "/api/v1/platform/status/events",
  description:
    "A platform operator declares a service event (a disruption) with an opening update.",
  request: { body: { content: { "application/json": { schema: DeclareBody } }, required: true } },
  responses: {
    201: {
      description: "The declared event id",
      content: { "application/json": { schema: EventResult } },
    },
    401: {
      description: "Not signed in",
      content: { "application/problem+json": { schema: Problem } },
    },
    403: {
      description: "Not a platform operator, or 2FA not enabled",
      content: { "application/problem+json": { schema: Problem } },
    },
    422: {
      description: "Invalid body",
      content: { "application/problem+json": { schema: Problem } },
    },
    429: {
      description: "Rate limit exceeded",
      content: { "application/problem+json": { schema: Problem } },
    },
  },
});

export const postUpdateRoute = defineOpenAPIRoute(postUpdateMeta, {
  method: "post",
  path: "/api/v1/platform/status/events/updates",
  description: "A platform operator posts a rolling update to an existing service event.",
  request: { body: { content: { "application/json": { schema: UpdateBody } }, required: true } },
  responses: {
    200: {
      description: "The updated event id",
      content: { "application/json": { schema: EventResult } },
    },
    401: {
      description: "Not signed in",
      content: { "application/problem+json": { schema: Problem } },
    },
    403: {
      description: "Not a platform operator, or 2FA not enabled",
      content: { "application/problem+json": { schema: Problem } },
    },
    404: {
      description: "No such event",
      content: { "application/problem+json": { schema: Problem } },
    },
    422: {
      description: "Invalid body",
      content: { "application/problem+json": { schema: Problem } },
    },
    429: {
      description: "Rate limit exceeded",
      content: { "application/problem+json": { schema: Problem } },
    },
  },
});

export const resolveEventRoute = defineOpenAPIRoute(resolveEventMeta, {
  method: "post",
  path: "/api/v1/platform/status/events/resolve",
  description:
    "A platform operator resolves a service event (marks it resolved with a final update).",
  request: { body: { content: { "application/json": { schema: UpdateBody } }, required: true } },
  responses: {
    200: {
      description: "The resolved event id",
      content: { "application/json": { schema: EventResult } },
    },
    401: {
      description: "Not signed in",
      content: { "application/problem+json": { schema: Problem } },
    },
    403: {
      description: "Not a platform operator, or 2FA not enabled",
      content: { "application/problem+json": { schema: Problem } },
    },
    404: {
      description: "No such event",
      content: { "application/problem+json": { schema: Problem } },
    },
    422: {
      description: "Invalid body",
      content: { "application/problem+json": { schema: Problem } },
    },
    429: {
      description: "Rate limit exceeded",
      content: { "application/problem+json": { schema: Problem } },
    },
  },
});

export function registerPlatformStatusRoute(
  app: OpenAPIHono<{ Bindings: Bindings; Variables: AppVariables }>,
  chokepoint: Chokepoint,
): void {
  app.openapi(
    {
      ...declareEventRoute,
      middleware: chokepointMiddleware(chokepoint, declareEventRoute, [
        platformOperatorGuard as MiddlewareHandler,
      ]),
    },
    async (c) => {
      const { title, impact, affectedComponentIds, body } = c.req.valid("json");
      const author = requireChokepointUserIdOptional(c) ?? c.get("platformOperatorUserId");
      const now = new Date().toISOString();
      const eventId = newIdentifier("serviceEvent");
      await mutateAuthored(c.env.STATUS_KV, now, (current) => ({
        ...current,
        events: [
          ...current.events,
          {
            id: eventId,
            title,
            impact,
            lifecycle: "investigating",
            affectedComponentIds,
            authorUserId: author ?? "",
            startedAt: now,
            resolvedAt: null,
            updates: [{ at: now, lifecycle: "investigating", body, authorUserId: author ?? "" }],
          },
        ],
      }));
      return c.json({ eventId }, 201);
    },
  );

  const appendUpdate =
    (resolve: boolean) => async (c: Parameters<Parameters<typeof app.openapi>[1]>[0]) => {
      const { eventId, lifecycle, body } = c.req.valid("json") as z.infer<typeof UpdateBody>;
      const author = c.get("platformOperatorUserId") ?? "";
      const now = new Date().toISOString();
      let found = false;
      await mutateAuthored(c.env.STATUS_KV, now, (current) => ({
        ...current,
        events: current.events.map((event) => {
          if (event.id !== eventId) return event;
          found = true;
          const nextLifecycle = resolve ? "resolved" : lifecycle;
          return {
            ...event,
            lifecycle: nextLifecycle,
            resolvedAt: resolve ? now : event.resolvedAt,
            updates: [
              ...event.updates,
              { at: now, lifecycle: nextLifecycle, body, authorUserId: author },
            ],
          };
        }),
      }));
      if (!found) return problemJson(c, { type: "not-found", title: "No such event", status: 404 });
      return c.json({ eventId }, 200);
    };

  app.openapi(
    {
      ...postUpdateRoute,
      middleware: chokepointMiddleware(chokepoint, postUpdateRoute, [
        platformOperatorGuard as MiddlewareHandler,
      ]),
    },
    appendUpdate(false),
  );
  app.openapi(
    {
      ...resolveEventRoute,
      middleware: chokepointMiddleware(chokepoint, resolveEventRoute, [
        platformOperatorGuard as MiddlewareHandler,
      ]),
    },
    appendUpdate(true),
  );
}
```

(If `requireChokepointUserIdOptional` does not exist, use only `c.get("platformOperatorUserId")` for the author — confirm with `grep -n "Optional" apps/worker/src/chokepoint/context-accessors.ts`.)

- [ ] **Step 6: Register the route group.** In `apps/worker/src/app.ts`, in the `/api/v1` registration block (near `registerPlatformReleaseChannelRoute(app, chokepoint)`), add:

```ts
registerPlatformStatusRoute(app, chokepoint);
```

and import it at the top:

```ts
import { registerPlatformStatusRoute } from "./routes/platform/platform-status.ts";
```

- [ ] **Step 7: Run the route + guard tests.**

Run: `pnpm --filter @magna-carta/worker test platform-status-events platform-operator-guard`
Expected: PASS (authored-store round-trips; the 401 guard test from Task 8 now has a real route to hit).

- [ ] **Step 8: Regenerate the OpenAPI contract (the three-part rule).**

Run:

```bash
pnpm --filter @magna-carta/worker run emit-openapi
pnpm --filter @magna-carta/api-client run generate
```

Then add the three operationIds to the sorted `expect(ids).toEqual([...])` list in `apps/worker/test/conformance.test.ts`: `"platformStatus.declareEvent"`, `"platformStatus.postUpdate"`, `"platformStatus.resolveEvent"`.

Run: `pnpm --filter @magna-carta/worker test conformance`
Expected: PASS (byte-exact snapshot + non-vacuous list agree).

- [ ] **Step 9: Full check + commit.**

Run: `pnpm check`. Expected: PASS.

```bash
git add apps/worker/src/status/authored-store.ts apps/worker/src/routes/platform/platform-status.ts apps/worker/src/app.ts apps/worker/openapi/openapi.json packages/api-client/src apps/worker/test/conformance.test.ts apps/worker/test/platform-status-events.test.ts
git commit -m "feat(worker): platform-status event routes (declare/update/resolve)"
```

---

## Task 10: Platform-status write routes — component override + maintenance

**Files:**

- Modify: `apps/worker/src/routes/platform/platform-status.ts` (add two endpoints)
- Modify: `apps/worker/test/conformance.test.ts` (two operationIds)
- Test: `apps/worker/test/platform-status-overrides.test.ts`

**Interfaces:**

- Produces: operationIds `platformStatus.setComponentOverride`, `platformStatus.clearComponentOverride`. Body: `{ componentId, status, note }` for set; `{ componentId }` for clear.

- [ ] **Step 1: Write the failing test.** Create `apps/worker/test/platform-status-overrides.test.ts`:

```ts
import { env } from "cloudflare:test";
import { beforeEach, expect, test } from "vitest";
import { STATUS_KV_KEYS } from "@magna-carta/status";
import { mutateAuthored, readAuthored } from "../src/status/authored-store.ts";

const NOW = "2026-07-02T00:00:00.000Z";
beforeEach(async () => env.STATUS_KV.delete(STATUS_KV_KEYS.authored));

test("an override is stored then cleared", async () => {
  await mutateAuthored(env.STATUS_KV, NOW, (c) => ({
    ...c,
    overrides: [
      { componentId: "scan", status: "degraded", note: "slow", setAt: NOW, authorUserId: "usr_op" },
    ],
  }));
  expect((await readAuthored(env.STATUS_KV, NOW)).overrides).toHaveLength(1);
  await mutateAuthored(env.STATUS_KV, NOW, (c) => ({
    ...c,
    overrides: c.overrides.filter((o) => o.componentId !== "scan"),
  }));
  expect((await readAuthored(env.STATUS_KV, NOW)).overrides).toHaveLength(0);
});
```

- [ ] **Step 2: Run it to confirm it fails, then implement the endpoints** in `apps/worker/src/routes/platform/platform-status.ts`, mirroring the event endpoints: `setComponentOverride` (`POST /api/v1/platform/status/overrides`, upsert an override by `componentId`, `status` from the component-status enum, `note`) and `clearComponentOverride` (`POST /api/v1/platform/status/overrides/clear`, filter it out). Both guarded by `platformOperatorGuard`, author from `c.get("platformOperatorUserId")`. Use `maintenance` status for a maintenance window (no separate schedule model in v1 — an operator sets a `maintenance` override, documented as the v1 shape).

- [ ] **Step 3: Run the test; regenerate OpenAPI (emit + client) and add the two operationIds to `conformance.test.ts`.**

Run: `pnpm --filter @magna-carta/worker run emit-openapi && pnpm --filter @magna-carta/api-client run generate && pnpm --filter @magna-carta/worker test conformance platform-status-overrides`
Expected: PASS.

- [ ] **Step 4: `pnpm check` + commit.**

```bash
git add apps/worker/src/routes/platform/platform-status.ts apps/worker/openapi/openapi.json packages/api-client/src apps/worker/test/conformance.test.ts apps/worker/test/platform-status-overrides.test.ts
git commit -m "feat(worker): platform-status component override + maintenance routes"
```

---

## Task 11: Derived-snapshot cron + `STATUS_KV` wiring

**Files:**

- Modify: `apps/worker/wrangler.jsonc` (`kv_namespaces` + a cron trigger)
- Create: `apps/worker/src/status/derived-snapshot.ts` (probe core + poll providers → write `status:derived`)
- Modify: `apps/worker/src/scheduled.ts` (call the builder) and `apps/worker/src/index.ts` (cron branch)
- Test: `apps/worker/test/derived-snapshot.test.ts`

**Interfaces:**

- Consumes: `deriveComponents`, `pollProviders`, `emptyDerived`, `STATUS_KV_KEYS`, `COMPONENT_REGISTRY` from `@magna-carta/status`; the scheduled-pass logger pattern.
- Produces: `buildAndStoreDerivedSnapshot(env, now, fetchImpl?): Promise<DerivedSnapshot>` — runs cheap core probes, polls providers, derives, writes `status:derived`.

- [ ] **Step 1: Bind `STATUS_KV` and add the cron.** In `apps/worker/wrangler.jsonc`, add a top-level `kv_namespaces` array (the first KV binding in the repo; the `id` is created via `wrangler kv namespace create magna-carta-production-status` or the dashboard — use a placeholder id in the file and record the real one at deploy time):

```jsonc
  "kv_namespaces": [
    { "binding": "STATUS_KV", "id": "<status-kv-namespace-id>" }
  ],
```

and add a status cron to the existing `triggers.crons` array (keep the existing entries):

```jsonc
  "triggers": { "crons": ["*/5 * * * *", "0 3 * * *", "*/10 * * * *"] },
```

- [ ] **Step 2: Write the failing test.** Create `apps/worker/test/derived-snapshot.test.ts`:

```ts
import { env } from "cloudflare:test";
import { expect, test } from "vitest";
import { STATUS_KV_KEYS } from "@magna-carta/status";
import { buildAndStoreDerivedSnapshot } from "../src/status/derived-snapshot.ts";

test("the cron builder writes a derived snapshot with components and providers", async () => {
  const fetchImpl = (async () =>
    new Response(JSON.stringify({ status: { indicator: "none" } }), {
      status: 200,
    })) as unknown as typeof fetch;
  const snapshot = await buildAndStoreDerivedSnapshot(env, "2026-07-02T00:00:00.000Z", fetchImpl);
  expect(snapshot.components.length).toBeGreaterThan(0);
  expect(snapshot.providers.some((p) => p.id === "cloudflare")).toBe(true);
  const stored = JSON.parse((await env.STATUS_KV.get(STATUS_KV_KEYS.derived)) ?? "null");
  expect(stored.schemaVersion).toBe(1);
});
```

- [ ] **Step 3: Run it to confirm it fails.**

Run: `pnpm --filter @magna-carta/worker test derived-snapshot`
Expected: FAIL (module not found).

- [ ] **Step 4: Implement the builder.** Create `apps/worker/src/status/derived-snapshot.ts`:

```ts
import {
  COMPONENT_REGISTRY,
  type DerivedSnapshot,
  deriveComponents,
  emptyDerived,
  pollProviders,
  type ProbeOutcome,
  SCHEMA_VERSION,
  STATUS_KV_KEYS,
} from "@magna-carta/status";
import type { Bindings } from "../app.ts";

// Probe only the cheap, always-warm core primitives; never boot a container to check it.
async function probeCore(env: Bindings): Promise<Record<string, ProbeOutcome>> {
  const probes: Record<string, ProbeOutcome> = {};
  probes["api"] = { ok: true }; // reached only if this worker is running
  probes["control-plane-database"] = {
    ok: await tryOk(() => env.DB_CONTROL.prepare("SELECT 1").first()),
  };
  probes["object-storage"] = { ok: await tryOk(() => env.R2.head("__status_probe__")) }; // head of a missing key still proves reachability (resolves, not throws)
  probes["status-store"] = { ok: await tryOk(() => env.STATUS_KV.get("__status_probe__")) };
  return probes;
}

async function tryOk(op: () => Promise<unknown>): Promise<boolean> {
  try {
    await op();
    return true;
  } catch {
    return false;
  }
}

export async function buildAndStoreDerivedSnapshot(
  env: Bindings,
  now: string,
  fetchImpl: typeof fetch = fetch,
): Promise<DerivedSnapshot> {
  const probes = await probeCore(env);
  const providers = await pollProviders(fetchImpl, now);
  const components = deriveComponents({
    now,
    probes,
    signals: {}, // telemetry-derived engine health is a conservative v1: no signal => operational
    degradedThreshold: 0.1,
    outageThreshold: 1,
  });
  const snapshot: DerivedSnapshot = {
    schemaVersion: SCHEMA_VERSION,
    generatedAt: now,
    components,
    providers,
  };
  // Guard against a partial build clobbering a good snapshot with nothing.
  const safe = components.length > 0 ? snapshot : emptyDerived(now);
  await env.STATUS_KV.put(STATUS_KV_KEYS.derived, JSON.stringify(safe));
  return safe;
}
```

(Confirm `env.R2.head` on a missing key resolves to `null` rather than throwing under Miniflare; if it throws, treat a thrown NotFound as `ok: true` — reachability, not presence, is the signal. Adjust `tryOk` usage accordingly with `grep`-verified behavior.)

- [ ] **Step 5: Wire it into the scheduled pass.** In `apps/worker/src/scheduled.ts`, add a new exported pass mirroring `runStorageReconciliation` (build one logger + one correlationId, wrap in try/`logOperationFailed`):

```ts
export async function runStatusSnapshot(env: Bindings): Promise<void> {
  const logger = createWorkersLogger(env.TELEMETRY);
  const correlationId = newCorrelationId();
  try {
    const snapshot = await buildAndStoreDerivedSnapshot(env, new Date().toISOString());
    logger.count("status.snapshot.components", {}, snapshot.components.length);
  } catch (caught) {
    logOperationFailed(logger, "cron:status-snapshot", caught, correlationId);
  }
}
```

(Add the `buildAndStoreDerivedSnapshot` import at the top of `scheduled.ts`.)

- [ ] **Step 6: Route the cron.** In `apps/worker/src/index.ts`, in the `scheduled` dispatch, add a branch for `"*/10 * * * *"` that calls `runStatusSnapshot(env)` inside `executionContext.waitUntil(...)` with the same `.catch(logOperationFailed(...))` shape as the existing branches.

- [ ] **Step 7: Run the test + full check.**

Run: `pnpm --filter @magna-carta/worker test derived-snapshot && pnpm check`
Expected: PASS.

- [ ] **Step 8: Commit.**

```bash
git add apps/worker/wrangler.jsonc apps/worker/src/status/derived-snapshot.ts apps/worker/src/scheduled.ts apps/worker/src/index.ts apps/worker/test/derived-snapshot.test.ts
git commit -m "feat(worker): derived-status cron (probe core + poll providers) + STATUS_KV"
```

---

## Task 12: `apps/status-worker` — isolated read-only public surface

**Files:**

- Create: `apps/status-worker/package.json`, `wrangler.jsonc`, `tsconfig.json`, `vitest.config.ts`, `src/index.ts`
- Create: `apps/status-worker/test/status-worker.test.ts`
- Modify: `vite.config.ts` (add the Miniflare project)
- Modify: root `tsconfig.build.json` (regenerated)

**Interfaces:**

- Consumes: `parseDerived`, `parseAuthored`, `mergeSnapshot`, `STATUS_KV_KEYS` from `@magna-carta/status`.
- Produces: a deployable worker serving `GET /api/status.json` (merged **public** snapshot) and `GET /` (placeholder page), reading only `STATUS_KV`.

- [ ] **Step 1: Scaffold.** Create `apps/status-worker/package.json` (model on `apps/scan-worker/package.json`):

```json
{
  "name": "@magna-carta/status-worker",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "sideEffects": false,
  "scripts": {
    "build": "wrangler deploy --dry-run --outdir dist",
    "dev": "wrangler dev",
    "deploy": "wrangler deploy",
    "test": "vp test run"
  },
  "dependencies": {
    "@magna-carta/status": "workspace:*"
  },
  "devDependencies": {
    "@cloudflare/vitest-pool-workers": "catalog:",
    "@cloudflare/workers-types": "catalog:",
    "@magna-carta/tsconfig": "workspace:*",
    "vite-plus": "catalog:",
    "vitest": "catalog:",
    "wrangler": "catalog:"
  }
}
```

Create `apps/status-worker/tsconfig.json`:

```json
{
  "extends": "../../packages/tsconfig/worker.json",
  "include": ["src/**/*.ts", "test/**/*.ts"]
}
```

Create `apps/status-worker/wrangler.jsonc` (public worker; binds ONLY `STATUS_KV` — no D1/R2/app binding; that isolation is the whole point):

```jsonc
{
  "name": "magna-carta-status",
  "main": "./src/index.ts",
  "compatibility_date": "2026-06-05",
  "compatibility_flags": ["nodejs_compat"],
  "workers_dev": true,
  "preview_urls": false,
  "kv_namespaces": [{ "binding": "STATUS_KV", "id": "<status-kv-namespace-id>" }],
  "observability": { "enabled": true, "head_sampling_rate": 1 },
}
```

Create `apps/status-worker/vitest.config.ts` (Miniflare pool, binds from wrangler):

```ts
import { cloudflareTest } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vite-plus";

export default defineConfig({
  root: import.meta.dirname,
  plugins: [
    cloudflareTest({
      wrangler: { configPath: `${import.meta.dirname}/wrangler.jsonc` },
      remoteBindings: false,
    }),
  ],
});
```

- [ ] **Step 2: Register the Miniflare project.** In root `vite.config.ts`, add `"apps/status-worker/vitest.config.ts"` to the `test.projects` array (it uses the Cloudflare pool, so it must be listed like `apps/worker`).

- [ ] **Step 3: Write the failing test.** Create `apps/status-worker/test/status-worker.test.ts`:

```ts
import { env, SELF } from "cloudflare:test";
import { beforeEach, expect, test } from "vitest";
import { STATUS_KV_KEYS } from "@magna-carta/status";

const NOW = "2026-07-02T00:00:00.000Z";

beforeEach(async () => {
  await env.STATUS_KV.delete(STATUS_KV_KEYS.derived);
  await env.STATUS_KV.delete(STATUS_KV_KEYS.authored);
});

test("status.json is unauthenticated and merges both keys into a public snapshot", async () => {
  await env.STATUS_KV.put(
    STATUS_KV_KEYS.derived,
    JSON.stringify({
      schemaVersion: 1,
      generatedAt: NOW,
      components: [
        {
          id: "api",
          name: "API",
          group: "Core",
          status: "operational",
          source: "probe",
          lastChange: NOW,
        },
      ],
      providers: [],
    }),
  );
  await env.STATUS_KV.put(
    STATUS_KV_KEYS.authored,
    JSON.stringify({
      schemaVersion: 1,
      updatedAt: NOW,
      events: [
        {
          id: "serviceEvent_1",
          title: "x",
          impact: "minor",
          lifecycle: "investigating",
          affectedComponentIds: [],
          authorUserId: "usr_secret",
          startedAt: NOW,
          resolvedAt: null,
          updates: [{ at: NOW, lifecycle: "investigating", body: "y", authorUserId: "usr_secret" }],
        },
      ],
      overrides: [],
    }),
  );
  const response = await SELF.fetch("https://status.example.com/api/status.json");
  expect(response.status).toBe(200);
  const body = await response.json();
  expect(body.overall).toBeDefined();
  // The public feed must NEVER carry an operator identity.
  expect(JSON.stringify(body)).not.toContain("usr_secret");
});

test("an empty store still serves a valid operational snapshot (no 500)", async () => {
  const response = await SELF.fetch("https://status.example.com/api/status.json");
  expect(response.status).toBe(200);
  expect((await response.json()).overall).toBe("operational");
});

test("isolation: the worker binds only STATUS_KV, never the app D1 / R2 / per-firm bindings", () => {
  // Fate-isolation is the whole point — a leaked app/D1 binding would let the status page share
  // the app's failure modes. Miniflare exposes exactly the wrangler-declared bindings on env.
  expect((env as Record<string, unknown>).STATUS_KV).toBeDefined();
  expect((env as Record<string, unknown>).DB_CONTROL).toBeUndefined();
  expect((env as Record<string, unknown>).R2).toBeUndefined();
});
```

- [ ] **Step 4: Run it to confirm it fails.**

Run: `pnpm --filter @magna-carta/status-worker test`
Expected: FAIL (no `src/index.ts`).

- [ ] **Step 5: Implement the worker.** Create `apps/status-worker/src/index.ts`:

```ts
import { mergeSnapshot, parseAuthored, parseDerived, STATUS_KV_KEYS } from "@magna-carta/status";

export type Bindings = {
  STATUS_KV: KVNamespace;
};

const STALENESS_THRESHOLD_MS = 20 * 60 * 1000; // 20 min: twice the 10-min derived cron cadence

async function publicSnapshotJson(env: Bindings): Promise<Response> {
  const now = new Date().toISOString();
  const [derivedText, authoredText] = await Promise.all([
    env.STATUS_KV.get(STATUS_KV_KEYS.derived),
    env.STATUS_KV.get(STATUS_KV_KEYS.authored),
  ]);
  const published = mergeSnapshot(
    parseDerived(derivedText, now),
    parseAuthored(authoredText, now),
    {
      audience: "public",
      now,
      stalenessThresholdMs: STALENESS_THRESHOLD_MS,
    },
  );
  return Response.json(published, {
    headers: { "cache-control": "public, max-age=30", "x-robots-tag": "all" },
  });
}

const FALLBACK_HTML =
  "<!doctype html><meta charset=utf-8><title>Service status</title>" +
  "<p>The status system is temporarily unavailable. See the Cloudflare status page at " +
  '<a href="https://www.cloudflarestatus.com/">cloudflarestatus.com</a>.</p>';

export default {
  async fetch(request: Request, env: Bindings): Promise<Response> {
    const url = new URL(request.url);
    if (request.method !== "GET") return new Response("Method Not Allowed", { status: 405 });
    try {
      if (url.pathname === "/api/status.json") return await publicSnapshotJson(env);
      if (url.pathname === "/" || url.pathname === "") {
        // HTML page is deferred; serve the machine feed's summary as a minimal placeholder.
        const json = await (await publicSnapshotJson(env)).json();
        return new Response(
          `<!doctype html><meta charset=utf-8><title>Service status</title><pre>${JSON.stringify(json, null, 2)}</pre>`,
          { headers: { "content-type": "text/html; charset=utf-8" } },
        );
      }
      return new Response("Not Found", { status: 404 });
    } catch {
      // Never surface a 500 on the public status path.
      return new Response(FALLBACK_HTML, {
        status: 200,
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    }
  },
} satisfies ExportedHandler<Bindings>;
```

- [ ] **Step 6: Run the test; register the typecheck refs; full check.**

Run: `pnpm --filter @magna-carta/status-worker test`
Expected: PASS.

Run: `node tooling/tsconfig-refs/index.mjs && pnpm check`
Expected: PASS.

- [ ] **Step 7: Commit.**

```bash
git add apps/status-worker vite.config.ts tsconfig.build.json pnpm-lock.yaml
git commit -m "feat(status-worker): isolated read-only public status surface"
```

---

## Task 13: Documentation — ADR fragments, changelog, ROADMAP/STATUS

**Files:**

- Create: `docs/decisions/pending/service-status.md`
- Create: `docs/decisions/pending/platform-operator-principal.md`
- Create: `changelog.d/service-status.md`
- Modify: `ROADMAP.md`, `STATUS.md`
- Create: `apps/status-worker/CLAUDE.md` (local invariant)

- [ ] **Step 1: Write the two ADR fragments** in `docs/decisions/pending/` (match the frontmatter shape of an existing file in that folder — e.g. `docs/decisions/pending/noindex-private-surfaces.md`; the register number is assigned on `main` at build time, so the fragment carries a slug, not a number).
  - `service-status.md` — decision: an in-app + public service-status surface extends ADR-0048, adding a component matrix, upstream-provider aggregation via a Statuspage adapter, an exception-based (default-operational) health model, an isolated read-only status worker, and the first `STATUS_KV` namespace; two writers on separate KV keys merged at read time; audience-scoped attribution.
  - `platform-operator-principal.md` — decision: the first platform-level (global, cross-firm) authorization axis — a `platform_operator` allow-list on elevated Better Auth users with MFA required and time-boxed grants — introduced because a shared secret cannot attribute a repeated human action and `platform_staff` is the narrow reach-into-a-firm identity (no global session by design). Names migrating firm-provisioning onto it as a later cleanup.

- [ ] **Step 2: Write the changelog fragment** `changelog.d/service-status.md` (match the format of an existing entry, e.g. `changelog.d/slice-2-1-scan-engine.md`): a user-facing note that a service-status system now aggregates Cloudflare and third-party provider status and lets operators post service events, with a public status feed that stays up during an outage.

- [ ] **Step 3: Add the ROADMAP + STATUS rows.** In `ROADMAP.md`, add a shipped/next line for Service Status under the appropriate section. In `STATUS.md`, add a row for the slice at the reached stage (spec + plan + built + tested; no UI). Edit only the new rows (append-don't-collide).

- [ ] **Step 4: Write the area CLAUDE.md** `apps/status-worker/CLAUDE.md` (use `docs/conventions/area-claude-template.md`), capturing the load-bearing local invariant: **the status worker must never gain an app, D1, or per-firm binding — its fate-isolation from the app is the entire point; it may bind only `STATUS_KV`.** Note it is a separate deployable with its own Workers Build (not in `build-all`).

- [ ] **Step 5: Commit.**

```bash
git add docs/decisions/pending/service-status.md docs/decisions/pending/platform-operator-principal.md changelog.d/service-status.md ROADMAP.md STATUS.md apps/status-worker/CLAUDE.md
git commit -m "docs(status): ADR fragments, changelog, roadmap/status, area invariants"
```

---

## Task 14: Full-suite verification

- [ ] **Step 1: Run the whole gate.**

Run: `pnpm check && vp test`
Expected: PASS across fmt/lint/typecheck, svelte-check, and all unit + Miniflare integration tests.

- [ ] **Step 2: Dry-run both worker deploys** (validates the new KV binding + the second deployable without pushing).

Run:

```bash
pnpm --filter @magna-carta/worker exec wrangler deploy --dry-run
pnpm --filter @magna-carta/status-worker exec wrangler deploy --dry-run
```

Expected: both succeed (bindings resolve).

- [ ] **Step 3: Record the deploy-activation steps** (do not perform them here) in `docs/active-work/service-status.md`: create the `STATUS_KV` namespace (`wrangler kv namespace create magna-carta-production-status`) and paste the real id into both `wrangler.jsonc` files; create the `apps/status-worker` Workers Build connection + its `status.<domain>` route; seed the first `platform_operator` row by hand against control-plane D1 for the operating owner (`INSERT INTO platform_operator ...`), and confirm that user has 2FA enabled.

---

## Deploy-activation checklist (post-merge, not part of the TDD tasks)

1. `wrangler kv namespace create magna-carta-production-status` → put the id in `apps/worker/wrangler.jsonc` and `apps/status-worker/wrangler.jsonc`.
2. Create the `apps/status-worker` Workers Build connection; bind the `status.<domain>` custom domain/route.
3. Seed the bootstrap `platform_operator` row (operating owner's `user.id`); verify their account has 2FA enabled.
4. Confirm the `*/10` cron is publishing `status:derived` (check the snapshot in KV / the status worker feed).
