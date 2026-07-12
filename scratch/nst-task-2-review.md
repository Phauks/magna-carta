# Task 2 review — GET /api/v1/tools/connection

Commit reviewed: fb6ed3e "feat(tools): connection route reporting the edge's view of the caller"

## Spec compliance: PASS

Matches Task 2 and Global Constraints in
`docs/specs/2026-07-09-network-speed-test-implementation-plan.md`, and the design spec's own
"connection route" section (`docs/specs/2026-07-09-network-speed-test-design.md:126-158`), verbatim:

- Files created/modified exactly as listed: `apps/worker/src/routes/tools-connection.ts`,
  `apps/worker/src/app.ts` (one import + one registration line), `apps/worker/openapi/openapi.json`
  and `packages/api-client/**` regenerated (already independently verified byte-equal — not
  re-checked here), `apps/worker/test/tools-connection.test.ts`.
- Route metadata (`tools-connection.ts:21-29`) matches the design spec's explicit prescription and
  the `firm-usage.ts` house pattern field-for-field: `surface: "app"`, `authenticated: true`,
  `permission: "tools:speedTest"`, `resource: "firm"`, `audited: false`, `idempotency: "optional"`,
  `rateLimit: "default"`.
- `tools:speedTest` already existed in `packages/access-control/src/registry.ts:48` — no
  registry change needed or made, matching the report's claim.
- Registered inside `app.ts`'s "/api/v1 routes, each composed through the chokepoint" block
  (`app.ts:355-358`), immediately after `registerFirmUsageRoute` — rides the one chokepoint, no
  bypass. Satisfies the global constraint that every registered route rides the chokepoint.
- Response shape, description text, and 401/403/429 problem responses match the plan verbatim.
- No process-doc references anywhere in `tools-connection.ts` or its OpenAPI `description` strings
  (checked all four: 200/401/403/429) — golden rule 13 honored.
- Full names, no shorthand, no emojis — honored.
- Nothing over-built: no extra fields, no persistence, no extra permission/route beyond the one
  Task 2 specifies.

No missing pieces, nothing extra beyond scope.

## Code quality: Changes-needed

### Important — test coverage gap vs. the house pattern (`firm-usage.test.ts`)

`apps/worker/test/tools-connection.test.ts` has 2 tests: unauthenticated → 401, and path present in
the emitted contract. That matches the _plan's_ literal Step 1 test file, but the house pattern this
route is explicitly told to follow — `apps/worker/test/firm-usage.test.ts:21-108`, for the
identically-shaped route — exercises four cases: 401 unauthenticated, **403 for an authenticated
member without the permission**, **200 with the actual response shape for a member who holds it**,
and an OpenAPI `x-mc-*` metadata match. None of the latter three exist for `tools-connection`.

Consequence: the route's actual authorization gate (`permission: "tools:speedTest"`) and its actual
handler output (the `ip`/`asn`/`asOrganization`/`colo`/`country` shape) are asserted only by
declaration, never exercised. A typo in the permission string, a member seeded without the
capability, or a bug in the handler's field mapping would all pass this test file untouched — the
same class of regression `firm-usage.test.ts` exists to catch on its sibling route.

Recommend adding, mirroring `firm-usage.test.ts`:

- an authenticated-but-unpermitted member → expect 403 + `application/problem+json`
- an authenticated member holding `tools:speedTest` → expect 200 and assert the response shape
- optionally, the `x-mc-*` metadata match on the emitted operation (`tools-connection.ts` /
  `apps/worker/test/tools-connection.test.ts`)

Also minor: the 401 test doesn't assert `content-type: application/problem+json` the way
`firm-usage.test.ts:25` does.

### Minor — schema doesn't disclose its degraded-value sentinels

`tools-connection.ts:194-200`: `ip`, `asn`, `asOrganization`, `colo`, `country` are all modeled as
plain non-optional `z.string()`/`z.number()`, but the handler (`tools-connection.ts:251-259`)
substitutes `""` / `0` when `request.cf` is undefined (confirmed: this is the local-Miniflare-only
case, since Cloudflare's edge always populates `cf` in production — the design intent is
legitimate). The schema and the OpenAPI `description` never state that an empty string or `asn: 0`
can mean "not available in this runtime" rather than a real value — a generated-client consumer has
no way to distinguish AS0 (reserved, never a real answer) from "unknown" without reading the
handler. Not dishonest given production always populates these fields, but a one-line note (either a
per-field `.describe()` or a sentence in the route description) would make the degradation an
explicit part of the contract rather than an implementation detail a reader has to discover.

### Confirmed clean (no issues found)

- **Privacy**: no logging, telemetry, or audit write of the IP anywhere in the route — the handler
  only returns it in the response body. `audited: false` is defensible: this is a diagnostic
  reflection of the caller's own connection facts, not a mutation or access to another party's data,
  consistent with the `firm-usage.ts` precedent (also `audited: false` for a read-only diagnostic).
- **No database, no work**: the handler imports no data-access module; it reads only
  `c.req.header("CF-Connecting-IP")` and `c.req.raw.cf`. Its round trip is chokepoint overhead +
  edge dispatch only, which is exactly what the probe is meant to measure.
- Route registration confirmed inside the chokepoint-composed block — nothing reachable skips the
  seam.
- Descriptions read as consumer-facing prose, no process-doc references.

## Bottom line

Spec-compliant and privacy-safe as built, but ship it with the missing 403/200 test cases (and
ideally the metadata assertion) that the house pattern already established on the sibling route —
without them, the permission gate and handler output are unverified by anything but inspection.
