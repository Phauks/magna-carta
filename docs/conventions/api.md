# API conventions

**Status:** Active — toolchain decided (ADR-0066/ADR-0067), **empirically validated** by the Phase 0 spike (2026-06-09, `apps/worker/test/api-contract-spike.test.ts`), and **built** in slice 0·5 ([`ROADMAP.md`](../../ROADMAP.md)): the chokepoint, the committed OpenAPI snapshot, the conformance fitness suite, the CI contract gates, and the generated client are all live. The operational surface is documented below.

**Scope (single home for):** how HTTP APIs are defined, evolved, and consumed — the contract toolchain, versioning, error shape, and internal vs. public calls. The implementation-grade design (route-metadata model, chokepoint order, auth surfaces, pagination, CI pipeline) lives in the spec: [`docs/specs/2026-06-04-api-contract-design.md`](../specs/2026-06-04-api-contract-design.md) — this file states the working rules and what the spike verified, and does not restate that design.

## The rules

- **Code-as-contract.** Every endpoint is defined once as a `createRoute({ method, path, request, responses })` block with Zod 4 schemas for inputs and **every** response status; the handler typechecks against it; the OpenAPI 3.1 document is emitted from code (`getOpenAPI31Document` / `doc31`). No hand-maintained YAML, ever.
- **Library:** `@hono/zod-openapi` (`OpenAPIHono` extends `Hono`) — ADR-0066. tRPC and GraphQL rejected (ADR-0022); oRPC, ts-rest, chanfana rejected (ADR-0066).
- **Clients are generated from the emitted spec** (Hey API → typed client + TanStack Svelte Query options; `openapi-generator`/Speakeasy for non-TS SDKs). **Never** Hono's `hc` RPC inference (ADR-0066 — whole-app type inference degrades `tsc` as routes grow).
- **Every route declares `RouteMeta`** (`operationId`, `surface`, `authenticated`, `permission`, `resource`, `audited`, `idempotency`, `rateLimit`, `tags`), emitted as `x-mc-*` extensions and enforced by the one chokepoint middleware + CI fitness functions (ADR-0067; spec, route-metadata model).
- **Set the OpenAPI-native `operationId` too** — generators key SDK method names off it (spike finding; see below).
- **Errors are RFC 9457 Problem Details** (`application/problem+json`) with the observability `errorId` (ADR-0017/0038); Zod validation failures map to `422 + errors[]` via the app-level `defaultHook`.
- **Reusable schemas get registered names** (`.openapi("Name")`) so the spec emits `$ref`s, not inline copies; shared fragments (pagination envelope, the problem schema, common params) live in `contracts/common`.
- **Pagination is cursor-based, never offset**; list responses are the uniform `{ data, nextCursor }` envelope (spec, pagination).
- **Versioning:** URL-path `/v1`; additive changes only within a version; oasdiff gates breaking changes in CI (spec, versioning).
- **Internal plugin ↔ core calls use service bindings** (native Worker RPC) — never the public HTTP surface.

## Verified toolchain (Phase 0 spike, 2026-06-09)

| Tool                      | Version verified | Result                                                                                                                                                |
| ------------------------- | ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@hono/zod-openapi`       | 1.4.0 (catalog)  | 3.1 emission, `$ref` components via `.openapi("Name")`, `x-mc-*` extension passthrough, `defaultHook` → RFC 9457 — all pass (9 spike tests)           |
| zod                       | 4.4.3 (catalog)  | Discriminated unions, branded strings, `z.iso.datetime()` all emit correct JSON Schema (brands erase to `string` — correct for opaque handles)        |
| `@hey-api/openapi-ts`     | 0.98.2           | Typed client + `@tanstack/svelte-query` `queryOptions`/query-key factories generate and match the contract; clients are bundled (no separate package) |
| `@stoplight/spectral-cli` | 6.x              | Parses + lints the emitted 3.1 document; default `spectral:oas` ruleset                                                                               |
| oasdiff                   | (docs verified)  | OpenAPI 3.1 supported across `diff`/`breaking`/`changelog` (beta) — adopt in the slice 0·5 CI gate                                                    |

**Spike findings that bind the slice 0·5 build:**

1. **`operationId` must be set natively, not only as `x-mc-operationId`** — Hey API falls back to path-derived names (`getApiV1Matters`) otherwise. Derive the OpenAPI `operationId` from `RouteMeta.operationId` at route-registration time so SDK methods get stable domain names.
2. **Spectral's default ruleset flags missing `servers`, `info.contact`/`description`, `operation-description`/`tags`** — the slice 0·5 emission config populates these; the custom ruleset then adds the `x-mc-*` conformance assertions (spec, fitness functions).
3. **Hey API config:** plain-object config file (`openapi-ts.config.mjs`); importing `defineConfig` from `@hey-api/openapi-ts` fails under its jiti config loader (`ERR_PACKAGE_PATH_NOT_EXPORTED`).
4. The spike's guard suite stays in the tree (`apps/worker/test/api-contract-spike.test.ts`) — a library bump that breaks any emission claim fails the build.

## Pipeline operations (slice 0·5, built)

**The committed snapshot is the source of truth — never hand-edit it.** `apps/worker/openapi/openapi.json` is generated; CI re-derives it and fails on any drift. To change the contract, change the routes, then regenerate.

| Command                                                                  | What it does                                                                                                      |
| ------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------- |
| `pnpm --filter @magna-carta/worker run emit-openapi`                     | Re-emit the snapshot (`apps/worker/openapi/openapi.json`) — run after any route change.                           |
| `pnpm run generate-client`                                               | Regenerate the committed Hey API + Svelte Query client (`packages/api-client/src`) from the snapshot.             |
| `pnpm --filter @magna-carta/worker exec prism mock openapi/openapi.json` | Serve a mock backend from the snapshot (frontend/plugin consumers mock from the snapshot, not a running backend). |

The snapshot is built through a programmatic Vite SSR pipeline (`apps/worker/scripts/emit-openapi.mts`), not plain Node: the worker route graph is bundler-targeted (extensionless imports, `.sql` text modules, attribute-less `.json`) and never loads under plain Node ESM. The document's root `tags` are derived from the operations in a shared emit helper used by both the snapshot and the live `/api/openapi.json` route, so the two never diverge (a test asserts the running Worker serves the committed document).

**CI contract gates** (`.github/workflows/ci.yml`, all under `pnpm check` or dedicated steps): snapshot drift (`emit-openapi` + `git diff --exit-code`), generated-client drift (`generate-client` + `git diff`), Spectral hygiene lint (`--fail-severity warn`), oasdiff breaking-change (PR-only, vs the base branch's committed snapshot, `fail-on ERR`, `review: false` so the contract never leaves CI; skipped on first introduction when the base has no snapshot), and a Prism mock smoke (`curl /api/v1/me` → 2xx).

- **`PUBLIC_ALLOW_LIST` policy.** A route may declare `authenticated: false` only if it has an entry (with a justification) in the allow-list in `test/conformance.test.ts`; the §3.5 fitness function fails CI otherwise — no route is silently public. `firms.provision` is `surface: "public"` + `authenticated: true` (the platform-admin-key exception), so it needs no allow-list entry.
- **Permission-namespace binding.** The conformance suite binds a route's permission namespace to its `x-mc-resource` (the subsystem the permission governs), not the operationId tag — route modules `members`/`firms` both belong to the `firm` subsystem. Holds under the registry's `<subsystem>:<action>` convention; a future permission whose subsystem diverges from its resource must revisit it.
- **Rate-limiter limitation.** The Phase 0 limiter is per-isolate in-memory (resets on eviction, not shared across isolates) behind the `RateLimiter` seam; a distributed Durable-Objects/KV adapter fits the same async interface without a breaking change. The chokepoint position and the 429 problem shape are the contract locked now.
- **Problem-type registry.** `apps/worker/src/contracts/problem-types.ts` — `problemType(key)` → `https://api.magnacarta.esq/problems/<key>`; an unknown key is a compile error. The committed slugs are the public contract URIs (the snapshot locks them): `validation`, `unauthenticated`, `permission-denied`, `not-found`, `idempotency-key-missing`/`-conflict`/`-fingerprint-mismatch`, `rate-limited`, `conflict`, `email-in-use`.
- **`defaultHook` reflection posture.** `defaultHook` reflects a Zod `issue.message` into `errors[].detail` on a 422, so **no secret-bearing field may be validated through the body/query/header validators** — a future secret-bearing schema field could leak its value back to the caller on a validation failure. Validate secrets out of band.

**Build-forced tooling deviations** (ADR-0066 amendment, 2026-06-13): the generated client is excluded from the formatter (its bytes are the generator's) and from lint (its barrel/codegen idioms trip our rules) — so its "compiles" gate is a dedicated `tsc -p` (`@magna-carta/api-client` `typecheck`, wired into the root `check`), which type-checks every generated file. Spectral 6.16/nimma crashes traversing this 3.1 document (it dereferences the contract's `null`-valued `x-mc-permission` extensions), so `.spectral.yaml` disables `duplicated-entry-in-enum` (our enums are trivial single-value literals — near-zero loss).
