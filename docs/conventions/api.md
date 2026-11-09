# API conventions

**Status:** Active — toolchain decided (ADR-0066/ADR-0067), **empirically validated** by the Phase 0 spike (2026-06-09; its emission guards retained as `apps/api-worker/test/openapi-emission.test.ts`), and **built** in slice 0·5 ([`ROADMAP.md`](../../ROADMAP.md)): the chokepoint, the committed OpenAPI snapshot, the conformance fitness suite, the CI contract gates, and the generated client are all live. The operational surface is documented below.

**Scope (single home for):** how HTTP APIs are defined, evolved, and consumed — the contract toolchain, versioning, error shape, and internal vs. public calls. The implementation-grade design (route-metadata model, chokepoint order, auth surfaces, pagination, CI pipeline) lives in the spec: [`docs/specs/2026-06-04-api-contract-design.md`](../specs/2026-06-04-api-contract-design.md) — this file states the working rules and what the spike verified, and does not restate that design.

## The rules

- **Code-as-contract.** Every endpoint is defined once as a `createRoute({ method, path, request, responses })` block with Zod 4 schemas for inputs and **every** response status; the handler typechecks against it; the OpenAPI 3.1 document is emitted from code (`getOpenAPI31Document` / `doc31`). No hand-maintained YAML, ever.
- **Library:** `@hono/zod-openapi` (`OpenAPIHono` extends `Hono`) — ADR-0066. tRPC and GraphQL rejected (ADR-0022); oRPC, ts-rest, chanfana rejected (ADR-0066).
- **Clients are generated from the emitted spec** (Hey API → typed client + TanStack Svelte Query options; `openapi-generator`/Speakeasy for non-TS SDKs). **Never** Hono's `hc` RPC inference (ADR-0066 — whole-app type inference degrades `tsc` as routes grow).
- **Every route declares `RouteMeta`** (`operationId`, `surface`, `authenticated`, `permission`, `resource`, `audited`, `idempotency`, `rateLimit`, `tags`), emitted as `x-mc-*` extensions and enforced by the one chokepoint middleware + CI fitness functions (ADR-0067; spec, route-metadata model).
- **Every DELETE declares `reversal`** — what putting the operation back MEANS, as one of `inverse` / `compensating` / `none` — an arm earns its place by changing what a SURFACE does, so there are three: offer the way back and call the named route, do not offer one because the act stands and a new record offsets it, or do not offer one and here is why (`src/http/contracts/reversal.ts`). `defineOpenAPIRoute` refuses an undeclared DELETE at registration; the conformance suite checks over the emitted document that a named operation exists and mutates. Emitted as `x-mc-reversal`, so a surface RENDERS the recoverability sentence rather than restating it in a dialog. The gate is DELETE-only for now — deletion is where the question is asked most — and widening it to the other mutating methods is deliberate work, not a backlog item to forget.
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
4. The emission-contract guard suite stays in the tree (`apps/api-worker/test/openapi-emission.test.ts`) — a library bump that breaks any emission claim fails the build. (Originally the Phase 0 spike's suite; retained as a permanent guard after the throwaway spike app was removed.)

## Pipeline operations (slice 0·5, built)

**The committed snapshot is the source of truth — never hand-edit it.** `apps/api-worker/openapi/openapi.json` is generated; CI re-derives it and fails on any drift. To change the contract, change the routes, then regenerate.

| Command                                                                   | What it does                                                                                                                                                                     |
| ------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm --filter @magna-carta/api-worker run emit-openapi`                  | Re-emit the snapshot (`apps/api-worker/openapi/openapi.json`) — run after any route change.                                                                                      |
| `pnpm run generate-client`                                                | Regenerate the committed Hey API + Svelte Query client (`packages/api-client/src`) from the snapshot.                                                                            |
| `pnpm dlx @stoplight/prism-cli mock apps/api-worker/openapi/openapi.json` | Serve a mock backend from the snapshot, on demand. Prism is not a dependency: nothing in the repository runs it, and its Postman-collection layer carried an unfixable advisory. |

The snapshot is built through a programmatic Vite SSR pipeline (`apps/api-worker/scripts/emit-openapi.mts`), not plain Node: the worker route graph is bundler-targeted (extensionless imports, `.sql` text modules, attribute-less `.json`) and never loads under plain Node ESM. The document's root `tags` are derived from the operations in a shared emit helper used by both the snapshot and the live `/api/openapi.json` route, so the two never diverge (a test asserts the running Worker serves the committed document).

**Contract gates** (the `contracts` dimension of `pnpm gate`, `tooling/gate/index.mjs`): snapshot drift (`emit-openapi` + `git diff --exit-code`), generated-client drift (`generate-client` + `git diff`), and the Spectral hygiene lint (`--fail-severity warn`). A drifted file is left regenerated in the working tree, so the fix is to review and commit it. oasdiff breaking-change detection (vs. the base branch's committed snapshot, `fail-on ERR`) is a review-time check, not a gate step; see `docs/conventions/operations.md`.

- **`PUBLIC_ALLOW_LIST` policy.** A route may declare `authenticated: false` only if it has an entry (with a justification) in the allow-list in `test/conformance.test.ts`; the §3.5 fitness function fails CI otherwise — no route is silently public. `firms.provision` is `surface: "public"` + `authenticated: true` (the platform-admin-key exception), so it needs no allow-list entry.
- **Permission-namespace binding.** The conformance suite binds a route's permission namespace to its `x-mc-resource` (the subsystem the permission governs), not the operationId tag — route modules `members`/`firms` both belong to the `firm` subsystem. Holds under the registry's `<subsystem>:<action>` convention; a future permission whose subsystem diverges from its resource must revisit it.
- **Rate-limiter limitation.** The Phase 0 limiter is per-isolate in-memory (resets on eviction, not shared across isolates) behind the `RateLimiter` seam; a distributed Durable-Objects/KV adapter fits the same async interface without a breaking change. The chokepoint position and the 429 problem shape are the contract locked now.
- **Problem-type registry.** `apps/api-worker/src/http/contracts/problem-types.ts` — `problemType(key)` → `https://api.magnacarta.esq/problems/<key>`; an unknown key is a compile error. The committed slugs are the public contract URIs (the snapshot locks them): `validation`, `unauthenticated`, `permission-denied`, `not-found`, `idempotency-key-missing`/`-conflict`/`-fingerprint-mismatch`, `rate-limited`, `conflict`, `email-in-use`.
- **`defaultHook` reflection posture.** `defaultHook` reflects a Zod `issue.message` into `errors[].detail` on a 422, so **no secret-bearing field may be validated through the body/query/header validators** — a future secret-bearing schema field could leak its value back to the caller on a validation failure. Validate secrets out of band.

## Push progress over WebSocket

A long-running job may expose a **subscribe** endpoint beside its poll endpoint. The subscribe
endpoint is a normal `defineOpenAPIRoute` registration — same chokepoint, same `RouteMeta`, same
capability as the poll it sits beside — that declares `101` and upgrades to a WebSocket the job's
Durable Object pushes state down. The rules:

- **The poll endpoint always stays**, and both transports resolve the job through **one shared
  function**, returning the same object. A fallback that is a second implementation is not a fallback.
- **The pushed payload is the poll body verbatim.** A `state` frame is
  `{ "type": "state", "protocolVersion": N, "state": <the poll body> }`, so a client can treat a
  pushed frame and a polled body interchangeably.
- **Client frames:** `{"type":"ping"}` (keepalive) and `{"type":"resync"}` (re-send current state,
  the frame to use after a reconnect). The ping/pong pair is registered with the runtime's WebSocket
  auto-response and is matched **byte-for-byte**, so those exact strings answer without waking a
  hibernating object; a differently-formatted ping is still answered, just not for free. An
  unrecognised frame is answered `{ "type": "refused", "reason": <label> }` and the socket stays open.
- **A terminal state is pushed once and the socket closes** (normal close, code 1000).
- **A plain request to a subscribe endpoint is `426`** with the `websocket-upgrade-required` problem
  type, whose `detail` names the poll endpoint.
- WebSocket framing is outside OpenAPI's model, so the frame contract is documented in the route's
  `description` and in `apps/api-worker/src/progress/job-progress-protocol.ts` — that module is the one
  home for it. Bump `JOB_PROGRESS_PROTOCOL_VERSION` on any incompatible frame change.

Implementations: `downloads.bundleEvents` and `conversions.events`.

Spectral's `operation-success-response` only recognises 2xx/3xx as success and its per-operation
`overrides` do not take effect for that rule (6.16), so it is **off in `.spectral.yaml` and
re-implemented as a conformance fitness function** — which also proves the stronger property that an
operation declaring `101` does not also claim a 2xx.

**Build-forced tooling deviations** (ADR-0066 amendment, 2026-06-13): the generated client is excluded from the formatter (its bytes are the generator's) and from lint (its barrel/codegen idioms trip our rules) — so its "compiles" gate is a dedicated `tsc -p` (`@magna-carta/api-client` `typecheck`, wired into the root `check`), which type-checks every generated file. Spectral 6.16/nimma crashes traversing this 3.1 document (it dereferences the contract's `null`-valued `x-mc-permission` extensions), so `.spectral.yaml` disables `duplicated-entry-in-enum` (our enums are trivial single-value literals — near-zero loss).

## Where a contract shape lives

A route module is glue: it declares its routes, names the permission and the meta the chokepoint enforces, and hands the request to the domain package. The **body shapes** a route declares — what a request carries and what a response returns — belong to the domain, so they live in the domain package as plain zod, in `packages/<domain>/src/contract.ts` (or a `contract/` directory when one file would be the calendar), exported with their inferred types. The route module imports them and composes `defineOpenAPIRoute` over them. **Path and query parameters may stay with the route:** they are addressing, not domain shape.

Two rules keep the boundary clean. **Packages export plain zod and name their components with zod's own metadata.** A component's name is `.meta({ id: "Name" })` on the schema in the package — plain zod, no Hono-family dependency — and the contract emitter reads that id as the component name, exactly as it reads the worker's `.openapi("Name")`: the two produce byte-identical components, proved when the calendar moved. Naming in the package, on the instance, is what keeps a composition a ``: a package shape that embeds another package shape (`z.array(EventBooking)`) references the named instance, where a name applied later in the route would produce a new instance and inline the embedded shape. Field-level metadata (`.openapi({ description })`) is never used in a package; `.describe()`is the plain-zod form if one is ever needed. The helpers a shape needs are package-side too:`identifierField`in`@magna-carta/identifiers/field`, `paginated`, `capped`and`cursorQuery`in`@magna-carta/data-access/pagination-contract`; the worker's `contracts/common.ts` keeps only the header fragment and the path-parameter builder, which is HTTP addressing. **The web keeps reading the generated client** (ADR-0066); the package schema serves the worker and the package's own tests, which is what lets a domain test assert that a service's result satisfies its own response contract without booting the worker.

Held by `apps/api-worker/test/route-shape-ratchet.test.ts`: a route module over the line cap or the inline-shape cap (`z.object(` constructions) is one whose bodies belong here, and the ledger of today's offenders in that file only shrinks. Design: [`../specs/2026-09-18-api-worker-domain-modules-design.md`](../specs/2026-09-18-api-worker-domain-modules-design.md).
