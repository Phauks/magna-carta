# API conventions

**Status:** Active — toolchain decided (ADR-0066/ADR-0067) and **empirically validated** by the Phase 0 spike (2026-06-09, `apps/worker/test/api-contract-spike.test.ts`). The full pipeline is built in slice 0·5 ([`ROADMAP.md`](../../ROADMAP.md)).

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

## Still to land (slice 0·5)

The CI spec toolchain (Spectral custom ruleset, Prism mocks, oasdiff breaking-change gate, SDK generation as a build artifact), the chokepoint middleware itself, the standard problem-type registry, and how Better Auth routes mount / requests carry firm context (with slice 0·4). Design for all of it: the [API contract spec](../specs/2026-06-04-api-contract-design.md).
