# Integration port system — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the pure ports-and-adapters integration framework (`@magna-carta/integrations`) and prove its spine by retrofitting the existing credential-less `parcels` resolver as its first adapter.

**Architecture:** A pure package defines the typed port/adapter/capability contract, the canonical-record + zod boundary, a registry that resolves `{firm, principal, category} → adapter` through injected `ConnectionStore`/`CredentialStore` ports, a typed `Dispatch` result, and the RFC-9457-extended problem + connection-health model. The `parcels` package gains an adapter behind a `ParcelLookupPort`, demonstrating one-port-many-adapters across the credential boundary with zero procurement and zero slice-1·2 dependency.

**Tech Stack:** TypeScript (NodeNext, explicit `.ts` imports), Zod 4 (`catalog:`), Vitest via `vp test`, pnpm workspace. Follows the existing pure-package conventions of `@magna-carta/parcels` and `@magna-carta/access-control`.

**Scope note (refines the design's build/seam split):** This plan delivers the **framework package + the parcels proof adapter** — a complete, self-contained, fully-tested deliverable. The `ConnectionStore` and `CredentialStore` are defined here as **interfaces (ports)**; their concrete backings — the per-firm `integration_connection` D1 table/repository, the slice-1·2 `firm_secret`-backed credential store, the Durable-Object refresh lock, and the worker connection-management/OAuth routes — are built in the **first credentialed-adapter slice** (email/calendar), where they are first exercised (spec §11). Nothing here is blocked on slice 1·2.

Spec: [`2026-06-16-integration-port-system-design.md`](2026-06-16-integration-port-system-design.md) · ADR-0091, ADR-0092.

**Commit policy:** every commit message ends with the repo footer line `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>` (shown in Task 1; apply to every commit). Run the package suite with `pnpm --filter @magna-carta/integrations test` (target one file with `vp test run <path>` from inside the package).

---

## File structure

**New package `packages/integrations/`:**
- `package.json`, `tsconfig.json`, `vitest.config.ts` — scaffold (mirrors `packages/parcels`).
- `src/problem.ts` — `IntegrationProblem` (RFC 9457 + `retryable`/`category`) + `integrationProblem()` constructor.
- `src/canonical.ts` — `CanonicalRecord` base + `canonicalRecordSchema()` zod helper.
- `src/credentials.ts` — `Credential`, `CredentialStore`, `TokenRefresher` interfaces (seams).
- `src/port.ts` — `AdapterScope`, `CredentialRequirement`, `CapabilityDescriptor`, `Adapter`, `AdapterContext`, `supports()`.
- `src/dispatch.ts` — `Dispatch<T>` sum + `ok`/`notConnected`/`capabilityUnsupported`/`adapterError`.
- `src/connection.ts` — `IntegrationConnection`, `ConnectionLookup`, `ConnectionStore`, `ConnectionHealth`, `HealthSignal`, `nextHealth()`.
- `src/registry.ts` — `createIntegrationRegistry()`, `resolve()`, `requireCapability()`.
- `test/*.test.ts` — one suite per module.

**Modified `packages/parcels/`:**
- Create `src/adapter.ts` — `ParcelLookupPort`, `AssessorLink` canonical type + schema, `parcelsDeepLinkAdapter`.
- Modify `package.json` — add `@magna-carta/integrations` + `zod` deps and the `./adapter` export.
- Create `test/adapter.test.ts`.

**Modified `packages/identifiers/`:**
- Modify `src/registry.ts` — add `integrationConnection` prefix.
- Modify `src/types.ts` — add `IntegrationConnectionId` alias.

**Docs:** `ROADMAP.md`, `STATUS.md`, `CHANGELOG.md`, `docs/Magna-Carta-White-Paper.md` (scoping-wording fix), `packages/integrations/CLAUDE.md`.

---

### Task 1: Scaffold the `@magna-carta/integrations` package

**Files:**
- Create: `packages/integrations/package.json`
- Create: `packages/integrations/tsconfig.json`
- Create: `packages/integrations/vitest.config.ts`
- Create: `packages/integrations/src/problem.ts` (placeholder export so the suite has something to import)
- Test: `packages/integrations/test/smoke.test.ts`

- [ ] **Step 1: Create the package manifest**

`packages/integrations/package.json`:
```json
{
  "name": "@magna-carta/integrations",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "sideEffects": false,
  "exports": {
    "./problem": "./src/problem.ts",
    "./canonical": "./src/canonical.ts",
    "./credentials": "./src/credentials.ts",
    "./port": "./src/port.ts",
    "./dispatch": "./src/dispatch.ts",
    "./connection": "./src/connection.ts",
    "./registry": "./src/registry.ts"
  },
  "scripts": {
    "test": "vp test run"
  },
  "dependencies": {
    "zod": "catalog:"
  },
  "devDependencies": {
    "@magna-carta/tsconfig": "workspace:*",
    "@types/node": "catalog:",
    "vitest": "catalog:"
  }
}
```

- [ ] **Step 2: Create the tsconfig and vitest config**

`packages/integrations/tsconfig.json`:
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

`packages/integrations/vitest.config.ts`:
```ts
import { defineConfig } from "vite-plus";

// Pure package: the default node pool, no Cloudflare Workers runtime.
// root is pinned to this package so the repo-root `vp test` resolves this project's tests from here.
export default defineConfig({
  root: import.meta.dirname,
});
```

- [ ] **Step 3: Add a placeholder source export and a smoke test**

`packages/integrations/src/problem.ts`:
```ts
// Placeholder — replaced in Task 2. Lets the workspace resolve the package before the real modules land.
export const INTEGRATIONS_PACKAGE = "@magna-carta/integrations";
```

`packages/integrations/test/smoke.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { INTEGRATIONS_PACKAGE } from "../src/problem.ts";

describe("package", () => {
  it("is wired into the workspace", () => {
    expect(INTEGRATIONS_PACKAGE).toBe("@magna-carta/integrations");
  });
});
```

- [ ] **Step 4: Install and run the smoke test**

Run: `vp install && pnpm --filter @magna-carta/integrations test`
Expected: PASS (1 test).

- [ ] **Step 5: Commit**

```bash
git add packages/integrations pnpm-lock.yaml
git commit -m "$(cat <<'EOF'
feat(integrations): scaffold the integration framework package

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: The integration problem model

**Files:**
- Modify: `packages/integrations/src/problem.ts`
- Test: `packages/integrations/test/problem.test.ts`

- [ ] **Step 1: Write the failing test**

`packages/integrations/test/problem.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { integrationProblem } from "../src/problem.ts";

describe("integrationProblem", () => {
  it("marks transient categories retryable and terminal ones not", () => {
    expect(integrationProblem("rate_limit", 429, "Throttled").retryable).toBe(true);
    expect(integrationProblem("network", 502, "Network error").retryable).toBe(true);
    expect(integrationProblem("upstream", 503, "Upstream down").retryable).toBe(true);
    expect(integrationProblem("auth", 401, "Reauthorize").retryable).toBe(false);
    expect(integrationProblem("validation", 422, "Bad shape").retryable).toBe(false);
  });

  it("derives a category-scoped type URI and carries optional members", () => {
    const problem = integrationProblem("auth", 401, "Reauthorize", {
      detail: "token expired",
      correlationId: "correlation_abc",
    });
    expect(problem.type).toBe("https://magnacarta.esq/problems/integration/auth");
    expect(problem.detail).toBe("token expired");
    expect(problem.correlationId).toBe("correlation_abc");
    expect(problem.status).toBe(401);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `vp test run test/problem.test.ts` (from `packages/integrations`)
Expected: FAIL — `integrationProblem` not exported.

- [ ] **Step 3: Write the implementation**

Replace `packages/integrations/src/problem.ts` entirely:
```ts
// The one integration error taxonomy. Adapters map heterogeneous vendor errors into this shape
// (their job, not the caller's); the framework reads it to drive retry (cross-cutting scaffolding)
// and the connection health state machine. It is the RFC 9457 problem shape the API already speaks,
// extended with `retryable` and `category` — the worker maps it onto its own problem module at the
// HTTP boundary, so this pure package needs no worker dependency.
export type ProblemCategory = "auth" | "rate_limit" | "validation" | "upstream" | "network";

export interface IntegrationProblem {
  readonly type: string;
  readonly title: string;
  readonly status: number;
  readonly detail?: string;
  readonly correlationId?: string;
  readonly retryable: boolean;
  readonly category: ProblemCategory;
}

// Transient categories are safe to retry with backoff; auth/validation are terminal until the
// caller acts (reauthorize / fix the request).
const RETRYABLE_CATEGORIES: ReadonlySet<ProblemCategory> = new Set([
  "rate_limit",
  "upstream",
  "network",
]);

export interface IntegrationProblemOptions {
  readonly detail?: string;
  readonly correlationId?: string;
  readonly type?: string;
}

export function integrationProblem(
  category: ProblemCategory,
  status: number,
  title: string,
  options: IntegrationProblemOptions = {},
): IntegrationProblem {
  return {
    type: options.type ?? `https://magnacarta.esq/problems/integration/${category}`,
    title,
    status,
    detail: options.detail,
    correlationId: options.correlationId,
    category,
    retryable: RETRYABLE_CATEGORIES.has(category),
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `vp test run test/problem.test.ts`
Expected: PASS (2 tests). Then delete the now-obsolete `test/smoke.test.ts` (its placeholder export is gone): `git rm packages/integrations/test/smoke.test.ts`.

- [ ] **Step 5: Commit**

```bash
git add packages/integrations/src/problem.ts packages/integrations/test
git commit -m "$(cat <<'EOF'
feat(integrations): the RFC 9457 integration problem taxonomy

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: The canonical-record contract

**Files:**
- Create: `packages/integrations/src/canonical.ts`
- Test: `packages/integrations/test/canonical.test.ts`

- [ ] **Step 1: Write the failing test**

`packages/integrations/test/canonical.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { canonicalRecordSchema } from "../src/canonical.ts";

const eventSchema = canonicalRecordSchema({ title: z.string() });

describe("canonicalRecordSchema", () => {
  it("requires remoteId and the port's fields, allows an optional raw payload", () => {
    const parsed = eventSchema.parse({ remoteId: "abc", title: "Hearing", raw: { vendor: 1 } });
    expect(parsed.remoteId).toBe("abc");
    expect(parsed.title).toBe("Hearing");
    expect(parsed.raw).toEqual({ vendor: 1 });
  });

  it("rejects a record missing remoteId (the boundary guard)", () => {
    expect(eventSchema.safeParse({ title: "Hearing" }).success).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `vp test run test/canonical.test.ts`
Expected: FAIL — `canonicalRecordSchema` not found.

- [ ] **Step 3: Write the implementation**

`packages/integrations/src/canonical.ts`:
```ts
import { z } from "zod";

// Every canonical record carries the vendor-native id (`remoteId`) plus an opt-in untouched vendor
// payload (`raw`) — normalization never silently destroys data the caller might need. A port builds
// its canonical schema from this base so the boundary is validated (external data is untrusted): an
// adapter that produced a malformed record is rejected here, not let into the domain.
export interface CanonicalRecord {
  readonly remoteId: string;
  readonly raw?: unknown;
}

const BASE_SHAPE = {
  remoteId: z.string().min(1),
  raw: z.unknown().optional(),
};

export function canonicalRecordSchema<Shape extends z.ZodRawShape>(fields: Shape) {
  return z.object({ ...BASE_SHAPE, ...fields });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `vp test run test/canonical.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/integrations/src/canonical.ts packages/integrations/test/canonical.test.ts
git commit -m "$(cat <<'EOF'
feat(integrations): canonical-record base + zod boundary schema

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: Credential and refresh interfaces (seams)

**Files:**
- Create: `packages/integrations/src/credentials.ts`
- Test: `packages/integrations/test/credentials.test.ts`

These are interfaces only — no implementation lands until the first credentialed adapter (spec §11). The test pins their shape via an in-memory fake so later code compiles against a stable contract.

- [ ] **Step 1: Write the failing test**

`packages/integrations/test/credentials.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import type { Credential, CredentialStore } from "../src/credentials.ts";

class InMemoryCredentialStore implements CredentialStore {
  readonly #map = new Map<string, Credential>();
  async get(ref: string): Promise<Credential | null> {
    return this.#map.get(ref) ?? null;
  }
  async put(ref: string, credential: Credential): Promise<void> {
    this.#map.set(ref, credential);
  }
}

describe("CredentialStore contract", () => {
  it("round-trips an oauth credential and returns null when absent", async () => {
    const store = new InMemoryCredentialStore();
    await store.put("ref-1", { kind: "oauth", refreshToken: "r1" });
    expect(await store.get("ref-1")).toEqual({ kind: "oauth", refreshToken: "r1" });
    expect(await store.get("missing")).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `vp test run test/credentials.test.ts`
Expected: FAIL — module `../src/credentials.ts` not found.

- [ ] **Step 3: Write the implementation**

`packages/integrations/src/credentials.ts`:
```ts
// Credential storage and token refresh are framework-owned SEAMS. The real backing is slice 1·2's
// per-firm envelope-encrypted `firm_secret` store (getSecret/putSecret); the real refresher is
// serialized by a Durable-Object-per-credential lock (providers silently rotate refresh tokens, so
// concurrent refreshes race). Both are built with the first credentialed adapter — here we fix only
// the interfaces so the registry and adapters compile against a stable contract.
export interface OAuthCredential {
  readonly kind: "oauth";
  readonly accessToken?: string;
  readonly refreshToken: string;
  readonly expiresAt?: string; // ISO-8601 UTC instant
}

export type Credential = OAuthCredential;

export interface CredentialStore {
  get(credentialRef: string): Promise<Credential | null>;
  put(credentialRef: string, credential: Credential): Promise<void>;
}

export interface TokenRefresher {
  refresh(credential: Credential): Promise<Credential>;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `vp test run test/credentials.test.ts`
Expected: PASS (1 test).

- [ ] **Step 5: Commit**

```bash
git add packages/integrations/src/credentials.ts packages/integrations/test/credentials.test.ts
git commit -m "$(cat <<'EOF'
feat(integrations): credential-store and token-refresher seam interfaces

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: Port, adapter, and capability descriptor

**Files:**
- Create: `packages/integrations/src/port.ts`
- Test: `packages/integrations/test/port.test.ts`

- [ ] **Step 1: Write the failing test**

`packages/integrations/test/port.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { supports, type CapabilityDescriptor } from "../src/port.ts";

const descriptor: CapabilityDescriptor = {
  adapterId: "example",
  category: "example-category",
  credential: { kind: "none" },
  operations: { read: { supported: true }, write: { supported: false } },
  passthroughAvailable: false,
};

describe("supports", () => {
  it("is true only for a declared, supported operation", () => {
    expect(supports(descriptor, "read")).toBe(true);
    expect(supports(descriptor, "write")).toBe(false);
    expect(supports(descriptor, "undeclared")).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `vp test run test/port.test.ts`
Expected: FAIL — `../src/port.ts` not found.

- [ ] **Step 3: Write the implementation**

`packages/integrations/src/port.ts`:
```ts
import type { Credential } from "./credentials.ts";

// A port is a TypeScript interface named in OUR domain vocabulary (defined by the consuming domain
// package, e.g. ParcelLookupPort in @magna-carta/parcels), not a vendor's API. An adapter implements
// one port for one external platform. The descriptor is the adapter's published manifest of what it
// can do, so callers degrade gracefully instead of calling a method that throws.

export type AdapterScope = "firm" | "user";

// Credential-less adapters (e.g. a county deep-link resolver) declare `none`; credentialed adapters
// declare the scope at which a connection is keyed — `user` (each attorney authorizes their own
// account) or `firm` (one connection for the firm). The PORT picks; the framework supports both.
export type CredentialRequirement =
  | { readonly kind: "none" }
  | { readonly kind: "oauth"; readonly scope: AdapterScope };

export interface OperationSupport {
  readonly supported: boolean;
}

export interface CapabilityDescriptor {
  readonly adapterId: string;
  readonly category: string;
  readonly credential: CredentialRequirement;
  readonly operations: Readonly<Record<string, OperationSupport>>;
  readonly passthroughAvailable: boolean;
}

export interface AdapterContext {
  readonly credential?: Credential;
}

export interface Adapter<Port> {
  readonly descriptor: CapabilityDescriptor;
  create(context: AdapterContext): Port;
}

export function supports(descriptor: CapabilityDescriptor, operation: string): boolean {
  return descriptor.operations[operation]?.supported === true;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `vp test run test/port.test.ts`
Expected: PASS (1 test).

- [ ] **Step 5: Commit**

```bash
git add packages/integrations/src/port.ts packages/integrations/test/port.test.ts
git commit -m "$(cat <<'EOF'
feat(integrations): port, adapter, and capability-descriptor contract

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: The dispatch result type

**Files:**
- Create: `packages/integrations/src/dispatch.ts`
- Test: `packages/integrations/test/dispatch.test.ts`

- [ ] **Step 1: Write the failing test**

`packages/integrations/test/dispatch.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { adapterError, capabilityUnsupported, notConnected, ok } from "../src/dispatch.ts";
import { integrationProblem } from "../src/problem.ts";

describe("Dispatch constructors", () => {
  it("wrap success and the three failure reasons", () => {
    expect(ok(42)).toEqual({ ok: true, value: 42 });
    expect(notConnected()).toEqual({ ok: false, reason: "not-connected" });
    expect(capabilityUnsupported()).toEqual({ ok: false, reason: "capability-unsupported" });

    const problem = integrationProblem("upstream", 503, "Down");
    expect(adapterError(problem)).toEqual({ ok: false, reason: "adapter-error", problem });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `vp test run test/dispatch.test.ts`
Expected: FAIL — `../src/dispatch.ts` not found.

- [ ] **Step 3: Write the implementation**

`packages/integrations/src/dispatch.ts`:
```ts
import type { IntegrationProblem } from "./problem.ts";

// A dispatch outcome is a typed sum, never a bare throw. `not-connected` (no usable connection) and
// `capability-unsupported` (the descriptor says no) are first-class so callers branch instead of
// catching; `adapter-error` carries a normalized problem.
export type DispatchFailureReason = "not-connected" | "capability-unsupported" | "adapter-error";

export type Dispatch<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly reason: DispatchFailureReason; readonly problem?: IntegrationProblem };

export function ok<T>(value: T): Dispatch<T> {
  return { ok: true, value };
}

export function notConnected<T = never>(): Dispatch<T> {
  return { ok: false, reason: "not-connected" };
}

export function capabilityUnsupported<T = never>(): Dispatch<T> {
  return { ok: false, reason: "capability-unsupported" };
}

export function adapterError<T = never>(problem: IntegrationProblem): Dispatch<T> {
  return { ok: false, reason: "adapter-error", problem };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `vp test run test/dispatch.test.ts`
Expected: PASS (1 test).

- [ ] **Step 5: Commit**

```bash
git add packages/integrations/src/dispatch.ts packages/integrations/test/dispatch.test.ts
git commit -m "$(cat <<'EOF'
feat(integrations): typed Dispatch result with first-class failure reasons

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 7: Connection model and health state machine

**Files:**
- Create: `packages/integrations/src/connection.ts`
- Test: `packages/integrations/test/connection.test.ts`

- [ ] **Step 1: Write the failing test**

`packages/integrations/test/connection.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { nextHealth } from "../src/connection.ts";

describe("nextHealth", () => {
  it("moves an auth error to needs_reauth and keeps it sticky under transient errors", () => {
    expect(nextHealth("connected", { kind: "error", category: "auth" })).toBe("needs_reauth");
    expect(nextHealth("needs_reauth", { kind: "error", category: "network" })).toBe("needs_reauth");
    expect(nextHealth("needs_reauth", { kind: "circuit-open" })).toBe("needs_reauth");
  });

  it("degrades on transient errors and a circuit open", () => {
    expect(nextHealth("connected", { kind: "error", category: "rate_limit" })).toBe("degraded");
    expect(nextHealth("connected", { kind: "circuit-open" })).toBe("degraded");
  });

  it("clears to connected on success, but disabled is admin-controlled", () => {
    expect(nextHealth("needs_reauth", { kind: "success" })).toBe("connected");
    expect(nextHealth("degraded", { kind: "success" })).toBe("connected");
    expect(nextHealth("connected", { kind: "disable" })).toBe("disabled");
    expect(nextHealth("disabled", { kind: "success" })).toBe("disabled");
    expect(nextHealth("disabled", { kind: "enable" })).toBe("connected");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `vp test run test/connection.test.ts`
Expected: FAIL — `../src/connection.ts` not found.

- [ ] **Step 3: Write the implementation**

`packages/integrations/src/connection.ts`:
```ts
import type { AdapterScope, CapabilityDescriptor } from "./port.ts";
import type { ProblemCategory } from "./problem.ts";

// A connection's health, rendered by the (future) connection-management UI and read by the registry
// to decide whether an adapter is usable.
export type ConnectionHealth = "connected" | "degraded" | "needs_reauth" | "disabled";

export type HealthSignal =
  | { readonly kind: "success" }
  | { readonly kind: "error"; readonly category: ProblemCategory }
  | { readonly kind: "circuit-open" }
  | { readonly kind: "disable" }
  | { readonly kind: "enable" };

// Pure transition. `disabled` is admin-controlled (only an explicit enable leaves it). An auth error
// outranks transient noise: a needs_reauth connection stays needs_reauth until a success clears it.
export function nextHealth(current: ConnectionHealth, signal: HealthSignal): ConnectionHealth {
  if (signal.kind === "disable") return "disabled";
  if (current === "disabled") return signal.kind === "enable" ? "connected" : "disabled";
  if (signal.kind === "enable" || signal.kind === "success") return "connected";
  if (signal.kind === "error" && signal.category === "auth") return "needs_reauth";
  if (current === "needs_reauth") return "needs_reauth";
  return "degraded";
}

// One authorized account (the Nylas Connector/Grant "grant"), recorded per-firm. Refs are plain
// strings here; the worker/data-access layer brands them (Identifier<"integrationConnection">) and
// owns persistence. `capabilitySnapshot` is the descriptor captured at connect time.
export interface IntegrationConnection {
  readonly id: string;
  readonly category: string;
  readonly adapterId: string;
  readonly scope: AdapterScope;
  readonly principalRef: string;
  readonly credentialRef: string;
  readonly status: ConnectionHealth;
  readonly capabilitySnapshot: CapabilityDescriptor;
}

export interface ConnectionLookup {
  readonly firmId: string;
  readonly userId?: string; // present iff the port is user-scoped
  readonly category: string;
}

// A SEAM: the real backing is a per-firm `integration_connection` D1 repository, built with the first
// credentialed adapter. The registry depends only on this interface.
export interface ConnectionStore {
  getConnection(lookup: ConnectionLookup): Promise<IntegrationConnection | null>;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `vp test run test/connection.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/integrations/src/connection.ts packages/integrations/test/connection.test.ts
git commit -m "$(cat <<'EOF'
feat(integrations): connection model + health state machine

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 8: The registry and resolve

**Files:**
- Create: `packages/integrations/src/registry.ts`
- Test: `packages/integrations/test/registry.test.ts`

- [ ] **Step 1: Write the failing test**

`packages/integrations/test/registry.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import type { Credential, CredentialStore } from "../src/credentials.ts";
import type { ConnectionLookup, ConnectionStore, IntegrationConnection } from "../src/connection.ts";
import type { Adapter, CapabilityDescriptor } from "../src/port.ts";
import { createIntegrationRegistry, requireCapability } from "../src/registry.ts";

interface EchoPort {
  echo(): string;
}

function makeAdapter(descriptor: CapabilityDescriptor): Adapter<EchoPort> {
  return { descriptor, create: () => ({ echo: () => descriptor.adapterId }) };
}

const credentialLess: CapabilityDescriptor = {
  adapterId: "free",
  category: "free-category",
  credential: { kind: "none" },
  operations: { echo: { supported: true } },
  passthroughAvailable: false,
};

const credentialed: CapabilityDescriptor = {
  adapterId: "paid",
  category: "paid-category",
  credential: { kind: "oauth", scope: "user" },
  operations: { echo: { supported: true } },
  passthroughAvailable: false,
};

class FakeConnectionStore implements ConnectionStore {
  constructor(private readonly connection: IntegrationConnection | null) {}
  async getConnection(_lookup: ConnectionLookup): Promise<IntegrationConnection | null> {
    return this.connection;
  }
}

class FakeCredentialStore implements CredentialStore {
  constructor(private readonly credential: Credential | null) {}
  async get(_ref: string): Promise<Credential | null> {
    return this.credential;
  }
  async put(): Promise<void> {}
}

const connectedRow: IntegrationConnection = {
  id: "integrationConnection_1",
  category: "paid-category",
  adapterId: "paid",
  scope: "user",
  principalRef: "user_1",
  credentialRef: "ref-1",
  status: "connected",
  capabilitySnapshot: credentialed,
};

describe("createIntegrationRegistry.resolve", () => {
  it("resolves a credential-less adapter with no stores", async () => {
    const registry = createIntegrationRegistry();
    registry.register(makeAdapter(credentialLess));
    const result = await registry.resolve<EchoPort>("free-category", { firmId: "firm_1" });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.port.echo()).toBe("free");
  });

  it("returns not-connected for an unregistered category", async () => {
    const registry = createIntegrationRegistry();
    const result = await registry.resolve<EchoPort>("missing", { firmId: "firm_1" });
    expect(result).toEqual({ ok: false, reason: "not-connected" });
  });

  it("resolves a credentialed adapter when a healthy connection + credential exist", async () => {
    const registry = createIntegrationRegistry({
      connectionStore: new FakeConnectionStore(connectedRow),
      credentialStore: new FakeCredentialStore({ kind: "oauth", refreshToken: "r1" }),
    });
    registry.register(makeAdapter(credentialed));
    const result = await registry.resolve<EchoPort>("paid-category", {
      firmId: "firm_1",
      userId: "user_1",
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.port.echo()).toBe("paid");
  });

  it("returns not-connected when the connection is missing or unusable", async () => {
    const registry = createIntegrationRegistry({
      connectionStore: new FakeConnectionStore(null),
      credentialStore: new FakeCredentialStore({ kind: "oauth", refreshToken: "r1" }),
    });
    registry.register(makeAdapter(credentialed));
    const result = await registry.resolve<EchoPort>("paid-category", {
      firmId: "firm_1",
      userId: "user_1",
    });
    expect(result).toEqual({ ok: false, reason: "not-connected" });
  });
});

describe("requireCapability", () => {
  it("passes a supported operation and rejects an unsupported one", () => {
    const resolved = { port: { echo: () => "x" }, descriptor: credentialLess };
    expect(requireCapability(resolved, "echo").ok).toBe(true);
    expect(requireCapability(resolved, "missing")).toEqual({
      ok: false,
      reason: "capability-unsupported",
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `vp test run test/registry.test.ts`
Expected: FAIL — `../src/registry.ts` not found.

- [ ] **Step 3: Write the implementation**

`packages/integrations/src/registry.ts`:
```ts
import type { ConnectionStore } from "./connection.ts";
import type { CredentialStore } from "./credentials.ts";
import { capabilityUnsupported, notConnected, ok, type Dispatch } from "./dispatch.ts";
import { supports, type Adapter, type CapabilityDescriptor } from "./port.ts";

export interface ResolveContext {
  readonly firmId: string;
  readonly userId?: string;
}

export interface Resolved<Port> {
  readonly port: Port;
  readonly descriptor: CapabilityDescriptor;
}

export interface RegistryStores {
  readonly connectionStore?: ConnectionStore;
  readonly credentialStore?: CredentialStore;
}

export interface IntegrationRegistry {
  register<Port>(adapter: Adapter<Port>): void;
  resolve<Port>(category: string, context: ResolveContext): Promise<Dispatch<Resolved<Port>>>;
}

// One registered first-party adapter per category at launch. Resolution: credential-less adapters
// instantiate directly; credentialed ones require a healthy connection + a loaded credential,
// returning a typed `not-connected` otherwise — never a throw.
export function createIntegrationRegistry(stores: RegistryStores = {}): IntegrationRegistry {
  const adapters = new Map<string, Adapter<unknown>>();

  return {
    register(adapter) {
      adapters.set(adapter.descriptor.category, adapter as Adapter<unknown>);
    },

    async resolve(category, context) {
      const adapter = adapters.get(category) as Adapter<unknown> | undefined;
      if (adapter === undefined) return notConnected();

      const requirement = adapter.descriptor.credential;
      if (requirement.kind === "none") {
        return ok({ port: adapter.create({}), descriptor: adapter.descriptor });
      }

      const { connectionStore, credentialStore } = stores;
      if (connectionStore === undefined || credentialStore === undefined) return notConnected();

      const userId = requirement.scope === "user" ? context.userId : undefined;
      const connection = await connectionStore.getConnection({ firmId: context.firmId, userId, category });
      if (connection === null || connection.status === "disabled" || connection.status === "needs_reauth") {
        return notConnected();
      }

      const credential = await credentialStore.get(connection.credentialRef);
      if (credential === null) return notConnected();

      return ok({ port: adapter.create({ credential }), descriptor: connection.capabilitySnapshot });
    },
  };
}

// The single place the `capability-unsupported` outcome is minted: callers gate an operation by
// name against the resolved descriptor before invoking it.
export function requireCapability<Port>(
  resolved: Resolved<Port>,
  operation: string,
): Dispatch<Resolved<Port>> {
  return supports(resolved.descriptor, operation) ? ok(resolved) : capabilityUnsupported();
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @magna-carta/integrations test`
Expected: PASS (all suites green).

- [ ] **Step 5: Commit**

```bash
git add packages/integrations/src/registry.ts packages/integrations/test/registry.test.ts
git commit -m "$(cat <<'EOF'
feat(integrations): adapter registry, resolve, and capability gate

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 9: Retrofit `parcels` as the first adapter

**Files:**
- Modify: `packages/parcels/package.json` (add deps + export)
- Create: `packages/parcels/src/adapter.ts`
- Test: `packages/parcels/test/adapter.test.ts`

- [ ] **Step 1: Add the dependencies and export**

Edit `packages/parcels/package.json` — add `"./adapter": "./src/adapter.ts"` to `exports`, and add a `dependencies` block (the package currently has none):
```json
  "exports": {
    "./types": "./src/types.ts",
    "./apn": "./src/apn.ts",
    "./platforms": "./src/platforms.ts",
    "./resolve": "./src/resolve.ts",
    "./registry": "./src/registry.ts",
    "./adapter": "./src/adapter.ts",
    "./states/nevada": "./src/states/nevada.ts",
    "./states/arizona": "./src/states/arizona.ts",
    "./states/delaware": "./src/states/delaware.ts",
    "./states/hawaii": "./src/states/hawaii.ts"
  },
  "scripts": {
    "test": "vp test run"
  },
  "dependencies": {
    "@magna-carta/integrations": "workspace:*",
    "zod": "catalog:"
  },
```
Then run `vp install` to link the workspace dependency.

- [ ] **Step 2: Write the failing test**

`packages/parcels/test/adapter.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { supports } from "@magna-carta/integrations/port";
import { assessorLinkSchema, parcelsDeepLinkAdapter } from "../src/adapter.ts";

describe("parcelsDeepLinkAdapter", () => {
  const port = parcelsDeepLinkAdapter.create({});

  it("declares a credential-less descriptor supporting only resolveAssessorUrl", () => {
    expect(parcelsDeepLinkAdapter.descriptor.credential).toEqual({ kind: "none" });
    expect(supports(parcelsDeepLinkAdapter.descriptor, "resolveAssessorUrl")).toBe(true);
    expect(supports(parcelsDeepLinkAdapter.descriptor, "lookupParcel")).toBe(false);
  });

  it("resolves a covered jurisdiction to a validated canonical AssessorLink", () => {
    // Clark County NV (FIPS 32003) ships in the Nevada registry.
    const link = port.resolveAssessorUrl({ jurisdictionId: "32003", apn: "162-35-113-001" });
    expect(link).not.toBeNull();
    if (link !== null) {
      expect(assessorLinkSchema.parse(link)).toEqual(link); // already validated on the way out
      expect(link.remoteId).toBe("32003");
      expect(link.isDeepLink).toBe(true);
      expect(link.url).toContain("16235113001");
    }
  });

  it("returns null for an uncovered jurisdiction (caller falls back to a web search)", () => {
    expect(port.resolveAssessorUrl({ jurisdictionId: "99999" })).toBeNull();
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `vp test run test/adapter.test.ts` (from `packages/parcels`)
Expected: FAIL — `../src/adapter.ts` not found.

- [ ] **Step 4: Write the implementation**

`packages/parcels/src/adapter.ts`:
```ts
import { z } from "zod";
import { canonicalRecordSchema } from "@magna-carta/integrations/canonical";
import type { Adapter } from "@magna-carta/integrations/port";
import { assessorSiteForJurisdiction } from "./registry.ts";
import { assessorUrl } from "./resolve.ts";

// The parcel-lookup category. The credential-less county deep-link resolver is its first adapter;
// future credentialed vendor adapters (Regrid/ATTOM) implement the same port with real API calls and
// per-firm secrets — one port, many adapters across the credential boundary.
export const PARCEL_LOOKUP_CATEGORY = "parcel-lookup";

// Canonical output: the best assessor URL for what the caller knows, plus the jurisdiction it came
// from. `raw` carries the matched assessor-site row (the opt-in untouched payload).
export const assessorLinkSchema = canonicalRecordSchema({
  url: z.string().min(1),
  jurisdictionId: z.string().min(1),
  jurisdictionType: z.string().min(1),
  isDeepLink: z.boolean(),
});

export type AssessorLink = z.infer<typeof assessorLinkSchema>;

export interface ResolveAssessorUrlInput {
  readonly jurisdictionId: string;
  readonly apn?: string;
  readonly year?: number;
}

export interface ParcelLookupPort {
  // Returns the validated canonical link, or null where the jurisdiction is not yet covered (the
  // caller falls back to a plain web search — the resolver's existing semantics).
  resolveAssessorUrl(input: ResolveAssessorUrlInput): AssessorLink | null;
}

export const parcelsDeepLinkAdapter: Adapter<ParcelLookupPort> = {
  descriptor: {
    adapterId: "parcels-county-deep-link",
    category: PARCEL_LOOKUP_CATEGORY,
    credential: { kind: "none" },
    operations: { resolveAssessorUrl: { supported: true } },
    passthroughAvailable: false,
  },
  create() {
    return {
      resolveAssessorUrl({ jurisdictionId, apn, year }) {
        const site = assessorSiteForJurisdiction(jurisdictionId);
        if (site === undefined) return null;
        const url = assessorUrl(site, { apn, year });
        return assessorLinkSchema.parse({
          remoteId: site.jurisdictionId,
          url,
          jurisdictionId: site.jurisdictionId,
          jurisdictionType: site.jurisdictionType,
          isDeepLink: url !== site.searchUrl,
          raw: site,
        });
      },
    };
  },
};
```

- [ ] **Step 5: Run the test to verify it passes, then run both suites**

Run: `pnpm --filter @magna-carta/parcels test && pnpm --filter @magna-carta/integrations test`
Expected: PASS (parcels suite incl. the new adapter tests; integrations suite still green).

> If the Clark County row's `jurisdictionId`/`apn` deep-link assertion does not match the seeded Nevada data, open `packages/parcels/src/states/nevada.ts`, pick any `kind: "template"` or `kind: "platform"` row, and adjust the test's `jurisdictionId`/`apn` and the `url`/`isDeepLink` expectations to that row — the contract under test (validated canonical link vs. null) is unchanged.

- [ ] **Step 6: Commit**

```bash
git add packages/parcels pnpm-lock.yaml
git commit -m "$(cat <<'EOF'
feat(parcels): expose the county deep-link resolver as an integration adapter

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 10: Identifier prefix, quality gate, and docs

**Files:**
- Modify: `packages/identifiers/src/registry.ts`
- Modify: `packages/identifiers/src/types.ts`
- Create: `packages/integrations/CLAUDE.md`
- Modify: `ROADMAP.md`, `STATUS.md`, `CHANGELOG.md`, `docs/Magna-Carta-White-Paper.md`

- [ ] **Step 1: Add the connection handle prefix**

In `packages/identifiers/src/registry.ts`, add to `ENTITY_PREFIXES` (after the `auditLog` entry), with a comment:
```ts
  auditLog: "auditLog",
  // Integration framework: the per-firm authorized-account connection record (the credential ref it
  // points at lives in the slice 1·2 firm_secret store, not here).
  integrationConnection: "integrationConnection",
} as const;
```

In `packages/identifiers/src/types.ts`, add after `AuditLogId`:
```ts
export type IntegrationConnectionId = Identifier<"integrationConnection">;
```

Run: `pnpm --filter @magna-carta/identifiers test`
Expected: PASS (the prefix/alias-sync fitness test stays green).

- [ ] **Step 2: Run the full quality gate**

Run: `pnpm check`
Expected: PASS (fmt + lint + typecheck across the workspace, including the new package). Fix any lint/format findings the gate reports before continuing.

- [ ] **Step 3: Write the package CLAUDE.md**

`packages/integrations/CLAUDE.md`:
```markdown
# @magna-carta/integrations — local notes

The ports-and-adapters foundation every integration plugs into. Pure package — no D1, no Hono, no
`env`; all I/O arrives through injected ports (`ConnectionStore`, `CredentialStore`, `TokenRefresher`).

- A **port** is a TS interface named in our domain vocabulary, defined by the consuming domain
  package (e.g. `ParcelLookupPort` in `@magna-carta/parcels`), never here and never a vendor's shape.
- An **adapter** implements one port; its `CapabilityDescriptor` declares what it supports so callers
  degrade gracefully. Credential-less adapters declare `credential: { kind: "none" }`; credentialed
  ones declare `{ kind: "oauth", scope: "firm" | "user" }` — the port picks the scope.
- Canonical records carry `remoteId` + opt-in `raw`; build the schema with `canonicalRecordSchema`,
  which validates the boundary (external data is untrusted).
- `resolve()` returns a typed `Dispatch` — `not-connected` / `capability-unsupported` / `adapter-error`,
  never a throw. Adapters map vendor errors into `IntegrationProblem` (the `category` drives retry +
  the connection health state machine).

**Seams built with the first credentialed adapter (email/calendar):** the per-firm
`integration_connection` D1 repository, the slice-1·2 `firm_secret`-backed `CredentialStore`, the
Durable-Object refresh lock, and the worker connection-management/OAuth routes. See the design spec:
`docs/specs/2026-06-16-integration-port-system-design.md` (ADR-0091, ADR-0092).
```

- [ ] **Step 4: Update the living docs**

In `ROADMAP.md`, add an entry under **Now** (or a new "Cross-cutting" bullet) recording the integration port system as built; in `STATUS.md`, add a Cross-cutting row: `Integration port system | [-] | [x] | [x] | [x] Opus 4.8 * | [-] | [ ]` with a note pointing at the spec/ADRs and naming the deferred connection-persistence/routes seam. In `CHANGELOG.md` `[Unreleased]`, add under **Added**: "Integration port system (`@magna-carta/integrations`) — the ports-and-adapters foundation (typed ports, capability descriptors, canonical/zod boundary, registry + dispatch, connection health model) with the `parcels` county deep-link resolver as its first adapter (ADR-0091, ADR-0092)."

In `docs/Magna-Carta-White-Paper.md` _Plugin / Add-on system_, correct the blanket "per-firm scoped secrets" wording to note that connection scope is declared per port (`firm` or `user`), per ADR-0092 — a one-line clarification, not a rewrite.

- [ ] **Step 5: Final verification and commit**

Run: `pnpm --filter @magna-carta/integrations test && pnpm --filter @magna-carta/parcels test && pnpm --filter @magna-carta/identifiers test && pnpm check`
Expected: all green.

```bash
git add packages/identifiers packages/integrations/CLAUDE.md ROADMAP.md STATUS.md CHANGELOG.md docs/Magna-Carta-White-Paper.md
git commit -m "$(cat <<'EOF'
docs(integrations): connection handle, package notes, roadmap/status/changelog

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Self-review

**Spec coverage:**
- §1 module placement → Tasks 1–10 (the package; the `data-access` repo + worker routes are the explicitly-deferred seam, scope note).
- §2 port/adapter/capability → Tasks 5 (+ 9 the worked example).
- §3 canonical contract (canonical model, `remoteId`, `raw`, zod, versioning) → Task 3 + Task 9; passthrough tiers are descriptor-flagged (`passthroughAvailable`) here, implemented when a credentialed adapter needs them.
- §4 registry & dispatch → Tasks 6, 8.
- §5 connection model & per-functionality scoping → Task 7 (model + `nextHealth`) + Task 8 (scope-driven resolve) + Task 10 (handle prefix).
- §6 credential store & safety → Task 4 (interfaces); real backing deferred (scope note).
- §7 error & health model → Tasks 2, 7.
- §8 cross-cutting scaffolding → interfaces present; thin/no-op now (the credential-less proof adapter exercises none), heavy impls with the credentialed adapter — consistent with the spec.
- §9 parcels proof adapter → Task 9.
- §10 marketplace seam → documented; no code (correct — the in-process transport is what ships).
- §11 deferred → not built, by design.
- §13 ADRs + docs → ADRs already added; Task 10 does ROADMAP/STATUS/CHANGELOG/white-paper.

**Placeholder scan:** none — every code step is complete; the one conditional note (Task 9 Step 5) is a data-alignment fallback, not a missing implementation.

**Type consistency:** `CapabilityDescriptor`, `Adapter<Port>`, `AdapterContext`, `Dispatch<T>`, `Resolved<Port>`, `ResolveContext`, `RegistryStores`, `ConnectionStore`, `CredentialStore`, `IntegrationConnection`, `ConnectionHealth`, `HealthSignal`, `ProblemCategory`, `IntegrationProblem`, `canonicalRecordSchema`, `supports`, `requireCapability`, `createIntegrationRegistry`, `parcelsDeepLinkAdapter`, `assessorLinkSchema`, `ParcelLookupPort` are used identically across tasks. `resolve` is async everywhere; `nextHealth`/`supports`/`requireCapability` are sync everywhere.
