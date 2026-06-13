# API contract & route conventions — design

**Status:** Accepted (design) · **Date:** 2026-06-04 · **Owner:** Trevor Goldsmith
**White-paper home:** _Delivery model and application architecture_ (the API surface) · _Authentication, access control & encryption_ (the enforcement chokepoint)
**ADRs:** ADR-0066 (API-definition library) · ADR-0067 (route-metadata model + enforcement chokepoint) — resolving the Phase-0 library spike named in ADR-0022.

This spec is the implementation-grade detail for the platform's API contract layer: the library that defines endpoints, how routes are authored and composed, the per-route **metadata model** that turns every cross-cutting concern into a property of the path, the standard response conventions (errors, pagination, auth surfaces, versioning), and the contract/codegen/CI pipeline. It does not restate the rationale already in the white paper and the ADRs above — it specifies models, interfaces, flows, and the test plan.

It is foundational and expensive to retrofit, so it is built in **Phase 0** alongside the firm-scoped DAL, the ledger core, and the foundational data conventions (ADR-0061–0065). It deliberately stops at one seam: the `permission` and `resource` route-metadata fields exist here, but their _meaning_ — the per-subsystem permission registry, roles-as-data, and effective-permission resolution — is owned by the **access-control model** (ADR-0068; white paper _Authentication, access control & encryption_). Ethical-wall content-screening and the `portal` external-principal model are **deferred** (named seams, ADR-0068) and attach to the resolver when built.

---

## 1. Library & stack decision (ADR-0066)

| Concern                   | Decision                                                                                                                                                                   |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| API-definition library    | **`@hono/zod-openapi`** — `OpenAPIHono` extends `Hono` (no adapter), first-party Hono                                                                                      |
| Schema                    | **Zod 4** (required by `@hono/zod-openapi` ≥ 1.0)                                                                                                                          |
| Spec                      | **OpenAPI 3.1** via `app.doc31()` / `getOpenAPI31Document()`                                                                                                               |
| First-party typed client  | **Spec-first codegen** — **Hey API** (`@hey-api/openapi-ts`) generates the typed client + **Svelte Query v6** hooks from the emitted spec. **No `hc` RPC client** is built |
| Non-TS / third-party SDKs | `openapi-generator` (or Speakeasy) from the same emitted spec                                                                                                              |
| Internal plugin ↔ core    | **Service bindings (native Worker RPC)** — separate from this public surface (white paper _Plugin / Add-on system_)                                                        |

**Why no `hc`.** Hono's RPC client types the frontend by inferring one combined `AppType` over the whole route surface; on a large API that inference makes `tsc`/IDE progressively slower (Hono documents this). Generating the client from the emitted spec sidesteps it entirely — per-route handler typing stays (cheap), but no whole-app union is ever computed. The spec becomes the genuine single source of truth, which the client portal and third-party plugin consumers need regardless. Rejected alternatives (oRPC — bus factor/young v1; ts-rest — dormant, 3.0-only, no Hono/Svelte; chanfana — spec-only and its D1 auto-CRUD bypasses the firm-scoped DAL) are recorded in ADR-0066. The emitted spec is portable, so the library is not a one-way door.

---

## 2. Endpoint definition & module structure

- **Define once.** Each endpoint is a `createRoute({ method, path, request, responses })` block with Zod 4 schemas for inputs and **every** response status. The handler is typechecked against that contract.
- **Per-subsystem modules.** One route module per domain area (`matters`, `time`, `trust`, `billing`, `conflicts`, `discovery`, …), each exporting its routes and registered via the 1.3.0 `app.openapiRoutes([...] as const)` batch API. Modules compose into a root `OpenAPIHono` mounted under `/v1`. Keeps files focused and avoids one monolithic app object.
- **Verbosity mitigations** (the known cost of `createRoute`): `defineOpenAPIRoute()` for explicitly-typed route+handler bundles; shared Zod schema fragments (pagination envelope, the problem schema, common params) in a `contracts/common` module; reusable component schemas via Zod 4 `.meta({ id })` so the spec emits `$ref`s, not inlined duplicates.
- **`as const` discipline** on inline middleware arrays and route batches for correct context inference; header schema keys lowercase; `request.body.required: true` where a body is mandatory (per the library's documented gotchas).

---

## 3. The route-metadata model (ADR-0067) — the enforcement seam

The centrepiece. Every route carries machine-readable **metadata** so each cross-cutting concern is a property of the traversed path, enforced at one chokepoint and provable in CI — never per-handler discipline (the failure mode ADR-0051 forbids).

**The filter for what belongs here:** a field is metadata only if the **chokepoint middleware**, a **fitness function**, or **codegen** consumes it. Anything else is a comment, not metadata.

### 3.1 Core fields (defined and enforced now)

```ts
interface RouteMeta {
  operationId: string; // 'subsystem.action', e.g. 'trust.disburse' — stable SDK method name + oasdiff key
  surface: "app" | "public" | "portal"; // selects the auth model (§6)
  authenticated: boolean; // default true; public routes (login, health) opt out explicitly
  permission: Permission | null; // capability required (ADR-0068 registry); null only for unauthenticated routes
  resource: "matter" | "firm" | "location" | "directoryEntity" | "portalShare";
  // resource kind; reserved seam for the deferred ethical-wall overlay (ADR-0068)
  audited: boolean; // writes an immutable audit entry (ADR-0017/0038)
  idempotency: "required" | "optional"; // ADR-0063 — required on money/trust/payment/outbound-comms
  rateLimit: RateLimitBucket; // named policy bucket
  tags: string[]; // OpenAPI tags — docs + SDK module grouping (default: the module name)
  deprecated?: boolean; // OpenAPI-native; emits a sunset header
}
```

### 3.2 Reserved seams (field reserved, not yet populated/enforced — "design for the superset")

| Field                      | Future consumer                                                                                                                 |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `cache`                    | edge/KV caching + the generated client's TanStack-Query staleness defaults (reference data: court-rule sets, format registries) |
| `planTier` / `featureFlag` | route availability gating once multi-firm (single firm today)                                                                   |
| `metered`                  | future usage-based billing metering                                                                                             |

### 3.3 Deliberately _out_ (owned by a better-placed chokepoint)

- **PII / sensitive fields** → the `protected()` field type (ADR-0026, audited decrypt). A route does not re-declare it.
- **Async external effects** → the outbox write-path chokepoint + boundary fitness function (ADR-0064).
- **Notification raises** → co-located with the audit/write seam (ADR-0059), not route-declared.
- **CSRF** → derived from `surface` (`app` = cookie + CSRF), not its own field.

### 3.4 The chokepoint middleware (order is the contract)

One shared middleware reads `RouteMeta` and runs, in order:

1. **Resolve session → firm** (control-plane session → the one `firm_id`; ADR-0003). The firm comes from the session, never the URL.
2. **Authn** — if `authenticated` and no valid session → **401** (`/login?return=…` for the app surface).
3. **RBAC permission** — does the member's effective set (roles ∪ direct grants) include `permission`? A **cross-firm** resource is absent from the firm's DB → **404** (ADR-0052 — never an existence oracle). Within the firm, a visible resource the member can't act on → **403 + request access** (ADR-0068; insiders see everything, so within-firm denials are 403, not 404). _(Model: ADR-0068. **Ethical-wall content-screening is a deferred overlay** that will attach here when built; `resource` is its reserved seam. Location is a filter, not a gate.)_
4. **Idempotency** — if `idempotency: 'required'`, apply the `Idempotency-Key` middleware (ADR-0063).
5. **Rate-limit** — apply the named bucket.
6. **Dispatch** the handler. `audited` writes and outbox enqueues ride the DAL write underneath (ADR-0017/0064), inside the same transaction.

### 3.5 Conformance fitness functions (ADR-0051, robust tier)

The metadata is emitted into the spec as `x-mc-*` extensions, so CI asserts **structurally over the emitted contract** (not source text):

- every **authenticated mutating** route (POST/PUT/PATCH/DELETE) is `audited: true` **and** names a non-null `permission`; the only mutating routes allowed to be unauthenticated are explicit allow-listed public endpoints (e.g. intake-form submission), which still set `audited: true`;
- every named `permission` **exists in the permission registry** and its namespace matches the route's module (the per-subsystem registry of ADR-0068);
- every **money/trust/payment/outbound-comms** route declares `idempotency: 'required'`;
- no route is silently public — `authenticated: false` requires an explicit allow-list entry with a justification;
- `surface` is internally consistent (an `app` route never token-auths; a `public` route never sets a cookie);
- every route has a unique `operationId` matching `^[a-z][a-zA-Z0-9]*\.[a-z][a-zA-Z0-9]*$`.

The route table is thus a **registry** (registry-first): introspectable, uniform, and the single place the API's security posture is visible.

---

## 4. Error model

**RFC 9457 Problem Details** (`application/problem+json`), one shape platform-wide, extended with the observability **Error ID**:

```jsonc
{
  "type": "https://api.magnacarta.esq/problems/insufficient-trust-balance",
  "title": "Insufficient trust balance",
  "status": 422,
  "detail": "Disbursement exceeds the matter's available trust funds.",
  "errorId": "err_V1StGXR8_Z5jdHi6B-myT", // correlation ID (ADR-0017/0038); shown to the user, maps to the redacted log
  "instance": "/v1/matters/8181-3/trust/disbursements",
  "errors": [
    // field-level, for 422 validation failures
    { "path": "amount", "code": "exceeds_available", "detail": "…" },
  ],
}
```

- **`type` URIs are a registry** (registry-first); each problem type has a stable URI and a docs page.
- **404 = cross-firm only** (ADR-0052/ADR-0068): another firm's resource returns a plain `404`; a within-firm action-denial returns **403 + request-access** (§3.4), since insiders can see all firm resources.
- **Validation** errors (Zod) map to `422` with the `errors[]` array; the generated client surfaces `errorId` on a failed optimistic mutation (ADR-0054).
- A **dev-only response-validation middleware** parses outgoing payloads against the route's response schema to catch handler/contract divergence before it reaches a client.

---

## 5. Pagination, filtering, sorting

- **Cursor-based**, never offset (offset double-shows/skips rows under concurrent writes): list responses return `{ data: [...], nextCursor: string | null }`. The cursor is opaque (reveals nothing — consistent with the opaque-handle philosophy, ADR-0062) and stable under inserts.
- **Filters, sort, search text, and cursor live in the query string** (ephemeral refinement, ADR-0052); the path stays the addressable state.
- A shared `paginated(itemSchema)` Zod helper emits a uniform list envelope component across every list endpoint.

---

## 6. Auth surfaces

| Surface  | Host                                      | Auth                                           | CSRF                                | CORS                    |
| -------- | ----------------------------------------- | ---------------------------------------------- | ----------------------------------- | ----------------------- |
| `app`    | `app.magnacarta.esq` → same-origin `/api` | **Cookie** (httpOnly/Secure/SameSite)          | **Required** (token)                | same-origin only        |
| `public` | `api.magnacarta.esq/v1`                   | **Bearer token**                               | none (no cookies → no CSRF surface) | registered origins only |
| `portal` | `portal.magnacarta.esq`                   | external-principal session (assurance-checked) | required                            | same-origin only        |

The `surface` route-metadata field selects the model; a fitness function asserts no route mixes them. The `portal` external-principal assurance model is owned by the _Client portal_ (white paper §19); its enforcement detail is deferred (ADR-0068). Better Auth mounts as HTTP routes on the `app` surface (ADR-0004).

---

## 7. Versioning

- **URL-path versioning** — `/v1` (and `api.magnacarta.esq/v1`), matching the reserved-route namespace (ADR-0052).
- **Additive changes ship within `v1`.** **oasdiff** fails CI on any breaking change to an existing version; a breaking change requires a new major path (`/v2`), with `v1` maintained through a deprecation window (the `deprecated` metadata + sunset headers).

---

## 8. Contract & codegen pipeline (CI)

1. **Emit** — CI builds the app and writes the OpenAPI 3.1 document (`getOpenAPI31Document`).
2. **Snapshot + validate** — the emitted spec is snapshotted and diffed; a route changing shape without a spec change fails review (code-as-contract enforcement). Complex Zod (discriminated unions, recursive, branded) is spot-checked because JSON-Schema emission can be imperfect.
3. **Lint** — **Spectral** (custom ruleset incl. the `x-mc-*` metadata assertions of §3.5).
4. **Mock** — **Prism** serves the spec so frontend/plugins/third parties build ahead of the backend.
5. **Breaking-change gate** — **oasdiff** (`breaking`) against the previous spec; aware of its 3.1 `$dynamicRef`/`components.pathItems` gaps when designing schemas.
6. **Generate clients** — **Hey API** → first-party typed client + Svelte Query v6 hooks (+ Zod schemas); **openapi-generator**/Speakeasy → non-TS third-party/mobile SDKs.

---

## 9. Test plan

- **Unit** — each route module's schemas validate representative valid/invalid payloads (load-profile fixtures, ADR-0034); the `money`/`Temporal`/id types round-trip through request/response schemas correctly.
- **Conformance (fitness functions)** — §3.5 assertions run over the emitted spec; a deliberately-misconfigured route (mutating but unaudited; permission not in the registry; public without allow-list) must fail CI in the test suite.
- **Integration** — the chokepoint middleware enforces the §3.4 order: a logged-out request → 401; another firm's resource → 404; a within-firm action-denial → 403 + request-access (ADR-0068); a required-idempotency route replays on a duplicate key (ADR-0063).
- **Contract** — Prism mock conformance; oasdiff catches an intentional breaking change; the generated Svelte Query client compiles and type-checks against a sample call (and `tsc` time stays flat as routes are added — the no-`hc` guarantee).
- **Error model** — RFC 9457 shape + `errorId` present on every error path; the dev response-validator catches an intentional handler/contract divergence.

---

## 10. Open items / handoff

- **`permission` / `resource` semantics live in the access-control model** (ADR-0068, white-paper _Authentication, access control & encryption_): the per-subsystem permission registry the conformance test cross-checks, roles-as-data + default roles, effective permissions = roles ∪ direct grants, and the access-request flow. This spec guarantees the seam exists and is enforced; ADR-0068 defines what flows through it. **Ethical-wall content-screening and the `portal` external-principal model are deferred** (named seams, ADR-0068) and attach to the resolver when built.
- **Inbound large-file uploads** (white paper _Needs development_) ride a separate path (direct-to-R2 presigned PUT / multipart, bytes out of the Worker), so they are deliberately not normal `createRoute` body routes; the route only authorizes + records metadata. Tracked in its own follow-up.
- **Reserved seams** (`cache`, `planTier`, `metered`) are populated when their owning feature is built.
- **Per-firm rate-limit policy** values are deferred to the build (the convention binds now; the numbers arrive with the code — the same intentional seam as the foundational conventions).
