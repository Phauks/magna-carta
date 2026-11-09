# Slice 0·6 Implementation Plan — telemetry baseline & platform closeout

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build slice 0·6 — `@magna-carta/telemetry` (the golden-rule-4 single logging path with structural allowlist redaction and one-source correlation/Error IDs), the telemetry middleware + console-ban fitness function, incident intake (`POST /v1/incidents` + Queue seam), Cloudflare Email Service behind the `sendEmail` port, and Renovate + OSV + secret scanning.

**Architecture:** Telemetry is a mostly-pure package: typed allowlist event builders (an undeclared field has no slot to be logged in), a scrubbing-backstop tripwire, `cor_`/`err_` minting via the identifiers package, and a pure `Logger` seam whose Workers adapter is the only legal `console.*` call site (a source-scan fitness function enforces it). A middleware installed before the 0·5 chokepoint mints correlation IDs, logs request events, and converts escaped exceptions into `error.captured` + an RFC 9457 500 carrying the Error ID. Incidents are a contract-pipeline route writing a per-firm row plus an `incident.created` outbox→Queue message no one consumes yet.

**Tech Stack:** `@magna-carta/identifiers` (id minting), Workers Logs + an Analytics Engine dataset binding, Cloudflare Email Service `send_email` binding (public beta — verify the API at build), Renovate, OSV/`pnpm audit` in CI.

**Spec:** [`2026-06-09-slice-0-6-telemetry-baseline-design.md`](2026-06-09-slice-0-6-telemetry-baseline-design.md) (ADR-0074) · **depends on slice 0·5 being merged** (the incidents route rides `defineOpenAPIRoute` + the chokepoint; the problem module delegates `errorId` minting here). The plan merges any time; the build starts after 0·5 lands.

## Decided up front (read before coding)

1. **Event field values are flat primitives** (`string | number | boolean | null`) — no nested objects in telemetry events, so the allowlist is airtight (nothing to recurse into) and Analytics Engine/Logpush consumers stay simple. A builder needing structure is a design smell; add explicit fields.
2. **Route templates, never raw paths.** Request events log the matched route pattern (`/api/v1/matters/:id`-style from Hono's `c.req.routePath`), not the concrete URL — concrete paths can embed matter numbers (ADR-0052 makes some URLs semantic).
3. **The scrubber is a tripwire, not a guarantee.** It replaces matches with `[scrubbed]` and bumps `telemetry.scrubbed`; a non-zero counter in tests fails the suite (a planted leak must be caught), but the allowlist is the defense.
4. **`console.*` allow-list for the fitness scan:** exactly `packages/telemetry/src/workers-logger.ts`. The 0·4 dev email adapter logs through an injected sink (already compliant); `scripts/` and `test/` directories are out of scope for the scan (tooling may print).
5. **Analytics Engine writes are fire-and-forget** (`writeDataPoint` is sync, non-blocking, no await) — golden rule 10; a missing binding in dev/test degrades to the in-memory adapter, never throws.
6. **Email Service API shape is verify-at-build** (public beta): the plan assumes a `send_email` binding accepting an `EmailMessage` (mimetext-constructed or the beta's simplified send — check `developers.cloudflare.com/email-service` Workers API at build). The adapter's _test seam_ is ours either way: `CloudflareEmailAdapter` takes the binding as a constructor arg and tests fake it. Deviations → ADR-0074 amendment.
7. **From-address config:** `EMAIL_FROM` (e.g. `no-reply@magnacarta.esq`) as a wrangler `var`, not code — the DKIM/SPF/Email Routing runbook (Task 11) owns the domain side.
8. **OSV gate = `pnpm audit --audit-level high` in CI** (registry advisories; zero extra tooling) with the `osv-scanner` action noted as the upgrade path if audit coverage disappoints. Advisory-level findings don't fail the build; high+ do.
9. **Renovate is propose-only and pin-true:** `rangeStrategy: pin`, weekly schedule, grouped non-major updates, a package rule holding drizzle below 1.0 (the catalog comment's constraint, now machine-enforced), no auto-merge. Onboarding PR reviewed like any other.
10. **The incident `description` is stored plaintext inside the firm boundary** (per spec §4); the `protected()` migration is a named seam — do not improvise encryption here.
11. **New prefix-registry entries:** `correlation → cor`, `error → err`, `incident → inc` (skip any 0·4/0·5 already added — check first).
12. **`incident.created` has no consumer.** The relay will sweep it to the Queue (0·4's wiring); the Queue consumer map gains no entry. A test asserts the message reaches the Queue and is _not_ dead-lettered by mere non-consumption (Queues hold messages; dead-letter is attempts-driven on failure, not absence of a subscriber).

## File structure

```
packages/telemetry/
  package.json · tsconfig.json · vitest.config.ts
  src/event.ts             # TelemetryEvent type + defineEvent (allowlist builder factory)
  src/events.ts            # the event catalog: request.completed, error.captured, outbox.swept,
                           #   migration.applied, email.sent, incident.created, telemetry.scrubbed
  src/scrub.ts             # scrubStrings(event) backstop + pattern table
  src/ids.ts               # newCorrelationId() / newErrorId() (identifiers wrappers)
  src/logger.ts            # Logger interface + createMemoryLogger()
  src/workers-logger.ts    # createWorkersLogger(analyticsEngine?) — the ONE console.* site
  test/…                   # event, scrub, ids, logger tests + the console-ban source scan lives in worker
packages/identifiers/src/prefix-registry.ts   # MODIFY: cor/err/inc entries (decided #11)
packages/database/src/per-firm-schema.ts      # MODIFY: incident table
packages/database/drizzle/per-firm/           # new migration
apps/worker/src/telemetry-middleware.ts       # correlation mint + request event + escaped-exception capture
apps/worker/src/routes/platform/incidents.ts           # POST /v1/incidents (contract pipeline)
apps/worker/src/email-cloudflare.ts           # CloudflareEmailAdapter (sendEmail port impl)
apps/worker/src/app.ts                        # MODIFY: install telemetry middleware first; wire logger
apps/worker/src/contracts/problem.ts          # MODIFY (0·5 file): errorId minted via @magna-carta/telemetry
apps/worker/wrangler.jsonc                    # MODIFY: observability config, TELEMETRY AE binding, send_email, EMAIL_FROM
apps/worker/test/…                            # middleware, incidents, email, console-ban fitness, e2e
renovate.json · .github/workflows/ci.yml      # MODIFY: audit step
docs/conventions/operations.md                # NEW: the deploy-time runbook home (Logpush, DKIM/SPF/Email Routing)
```

---

### Task 1: Scaffold + prefixes

- [ ] Scaffold `packages/telemetry` mirroring `packages/access-control` configs; exports map one entry per `src/` module; dependency `@magna-carta/identifiers: workspace:*` only. Add `correlation → cor`, `error → err`, `incident → inc` to the prefix registry (+ its enumeration tests) if 0·4/0·5 did not.
- [ ] `vp install`; `vp test`; commit `chore(telemetry): scaffold package + telemetry prefixes`.

### Task 2: Event model + allowlist builders (`src/event.ts`, `src/events.ts`)

TDD. The structural-redaction core:

```ts
export type FieldValue = string | number | boolean | null;
export interface TelemetryEvent {
  readonly name: string;
  readonly at: string; // ISO-8601 UTC instant (ADR-0055)
  readonly correlationId: string;
  readonly fields: Readonly<Record<string, FieldValue>>;
}
// defineEvent: the allowlist IS the builder. Unknown keys are rejected at the type level
// (exact object type) and stripped at runtime (defense against `as any` call sites).
export function defineEvent<const Keys extends readonly string[]>(name: string, allowedKeys: Keys) {
  const allowed = new Set<string>(allowedKeys);
  return function build(
    context: { correlationId: string; now: string },
    fields: { [K in Keys[number]]: FieldValue },
  ): TelemetryEvent {
    const kept: Record<string, FieldValue> = {};
    for (const [key, value] of Object.entries(fields as Record<string, FieldValue>)) {
      if (allowed.has(key)) kept[key] = value;
    }
    return { name, at: context.now, correlationId: context.correlationId, fields: kept };
  };
}
```

`events.ts` — the catalog (spec §1): `requestCompleted` (`route`, `method`, `status`, `durationMs`), `errorCaptured` (`errorId`, `route`, `method`, `errorName`, `messageHead`), `outboxSwept` (`database`, `dispatched`, `failed`, `deadLettered`), `migrationApplied` (`database`, `tag`), `emailSent` (`messageClass`, `outcome`), `incidentCreated` (`incidentId`, `errorIdCount`), `telemetryScrubbed` (`eventName`, `field`). Tests: declared fields pass through; an undeclared key (forced via cast) is stripped; a nested object is a compile error (negative-compile file); the catalog names are unique. Commit `feat(telemetry): allowlist event builders — redaction structural`.

### Task 3: Scrubbing backstop (`src/scrub.ts`)

TDD. `scrubStrings(event): { event; trips: Array<{ field: string }> }` — applies the pattern table (email addresses `[\w.+-]+@[\w-]+\.[\w.-]+`, SSN shapes `\b\d{3}-\d{2}-\d{4}\b`, digit runs `\b\d{9,}\b`) to every string field, replaces matches with `[scrubbed]`, returns trips so the logger can count them. Tests: planted email/SSN/account-number scrubbed + tripped; clean events untouched with zero trips; `errorId`/`correlationId`-shaped values (letters+digits) do **not** trip the digit-run pattern. Commit `feat(telemetry): scrubbing backstop with trip reporting`.

### Task 4: IDs + Logger + adapters (`src/ids.ts`, `src/logger.ts`, `src/workers-logger.ts`)

TDD. `newCorrelationId()` / `newErrorId()` wrap `newIdentifier("correlation" | "error")`.

```ts
export interface Logger {
  log(event: TelemetryEvent): void;
  count(metric: string, dimensions?: Record<string, string>, value?: number): void;
}
export function createMemoryLogger(): Logger & { events: TelemetryEvent[]; counts: … } { … }
// workers-logger.ts — THE one legal console.* site (fitness-scanned). Scrubs, logs JSON,
// mirrors counters to Analytics Engine when a dataset binding is supplied (fire-and-forget).
export function createWorkersLogger(analyticsEngine?: AnalyticsEngineDataset): Logger { … }
```

The workers logger runs `scrubStrings` on every event, emits `console.log(JSON.stringify(event))`, `count`s scrub trips, and calls `analyticsEngine?.writeDataPoint({ blobs: [metric, …dimensionValues], doubles: [value ?? 1], indexes: [metric] })` without awaiting (decided #5). Tests: memory logger records; workers logger scrubs before emit (spy on an injected console-like sink — make the sink injectable with the real `console` default, keeping the fitness rule honest); AE absence doesn't throw. Commit `feat(telemetry): Logger seam — memory + Workers adapters`.

### Task 5: Incident schema (`packages/database`)

- [ ] Per-firm lineage addition:

```ts
export const incident = sqliteTable("incident", {
  id: text("id").primaryKey().$type<IncidentId>(),
  errorIds: text("error_ids").notNull(), // JSON array of err_ handles (may be empty)
  breadcrumbs: text("breadcrumbs").notNull(), // JSON array of { at, action, route } — redacted by construction
  description: text("description").notNull(), // user-authored; firm boundary now, protected() later (decided #10)
  context: text("context").notNull(), // JSON { route, appVersion, clientAt }
  screenshotKey: text("screenshot_key"), // R2 seam; populated by the UI slice
  status: text("status").notNull().default("open"),
  reportedBy: text("reported_by").notNull().$type<UserId>(),
  createdAt: text("created_at").notNull(),
});
```

- [ ] Generate the per-firm migration; expand-contract guard + schema fitness suite pass (handle PK — `inc_`).
- [ ] Commit `feat(database): per-firm incident table`.

### Task 6: Telemetry middleware (`apps/worker/src/telemetry-middleware.ts`) + wiring

- [ ] TDD (Miniflare). The middleware (installed **first**, before the 0·5 chokepoint, in `app.ts`): mint `cor_` → `c.set("correlationId", …)`; `await next()` in try/catch; on normal completion log `requestCompleted` (route template per decided #2, method, status, duration via injected clock); on escaped exception mint `err_`, log `errorCaptured` (`messageHead` = first 120 chars of `error.message` — the scrubber backstops it), and return the RFC 9457 500 problem with that `errorId`.
- [ ] **Modify the 0·5 problem module:** `problemJson` mints `errorId` via `@magna-carta/telemetry`'s `newErrorId()` (delete its local minting) and reads the request's correlation ID into the problem's `correlationId` extension field.
- [ ] `wrangler.jsonc`: `observability: { enabled: true, head_sampling_rate: 1 }`, the `TELEMETRY` Analytics Engine binding (+ vitest Miniflare config), worker constructs `createWorkersLogger(env.TELEMETRY)` once per request env.
- [ ] Tests: a request yields `requestCompleted` with a `cor_` id and the route template (not the raw path — assert on a parameterized route); a throwing test route yields a 500 problem whose `errorId` equals the `errorCaptured` event's; chokepoint problems carry the same correlation ID.
- [ ] Commit `feat(worker): telemetry middleware — correlation, request events, escaped-exception capture`.

### Task 7: Console-ban + coverage fitness functions

- [ ] `apps/worker/test/console-ban.test.ts`: walk `apps/worker/src` and every `packages/*/src` (Node `fs` via the test runner is fine — it runs in the Vitest node context for source scans; if the workers pool forbids `fs`, place the scan in `packages/telemetry/test` which runs plain Vitest), regex `\bconsole\.(log|error|warn|info|debug)\(`, assert the only hit is `packages/telemetry/src/workers-logger.ts` (decided #4). A planted violation in a fixture string proves the scan sees content, not filenames.
- [ ] Extend the 0·5 conformance suite: every non-2xx response schema in the emitted OpenAPI document includes the `errorId` property (spec §3).
- [ ] Commit `test: console-ban + errorId-coverage fitness functions (golden rule 4 structural)`.

### Task 8: Incident intake (`apps/worker/src/routes/platform/incidents.ts`)

- [ ] `defineOpenAPIRoute` — `operationId: "incidents.report"`, `surface: "app"`, `authenticated: true`, `permission: null`… **no**: the fitness rules require a permission on mutating authenticated routes — add `incident:report` to the access-control registry (every member may hold it via all five seeded roles; extend the seed migration in this slice's migration or grant via a role update migration). `audited: true`, `idempotency: "optional"`, `rateLimit: "incident-report"` (add the bucket: 5/300s).
- [ ] Body schema: `errorIds` (array of validated `err_` handles, max 10, may be empty), `breadcrumbs` (max 50 of `{ at, action, route }`, each string length-capped), `description` (1–5000 chars), `context` (`route`, `appVersion`, `clientAt`). Handler: effect batch via the firm-scoped path → `[incident INSERT, outbox incident.created]`; logs `incidentCreated`; 201 returns `{ id, status }`.
- [ ] Tests: happy path writes the row + outbox message and the relay sweep delivers `incident.created` to the Queue without dead-lettering (decided #12); unauthenticated → 401; over-cap breadcrumbs → 422 problem; rate bucket trips → 429; snapshot + conformance suites pass with the new route (re-emit the OpenAPI snapshot).
- [ ] Commit `feat(worker): incident intake — POST /v1/incidents + incident.created queue seam`.

### Task 9: Cloudflare Email Service adapter (`apps/worker/src/email-cloudflare.ts`)

- [ ] **Build-time verification step (decided #6):** read the current Email Service Workers-binding docs; pin the message-construction shape (beta simplified send vs `EmailMessage` + mimetext — if mimetext, add it to the catalog).
- [ ] `createCloudflareEmailAdapter(binding, from: string): SendEmail` — constructs and sends; logs `emailSent` (`messageClass` from a caller-supplied tag — extend the `SendEmail` port's message with an optional `messageClass` if 0·4 didn't include one — and `outcome: "sent" | "failed"`); a send failure logs and **rethrows** (callers like password-reset decide their own fallback; silent email loss is the one unacceptable outcome).
- [ ] `wrangler.jsonc`: `send_email` binding + `EMAIL_FROM` var; production wiring selects this adapter, dev/test keep the logging adapter (env-driven in `app.ts`).
- [ ] Tests: fake binding receives to/from/subject/body; failure path logs `outcome: "failed"` and rethrows; the adapter never logs body content (assert the event fields).
- [ ] Commit `feat(worker): Cloudflare Email Service adapter behind the sendEmail port`.

### Task 10: Renovate + audit gate

- [ ] `renovate.json` at repo root:

```json
{
  "$schema": "https://docs.renovatebot.com/renovate-schema.json",
  "extends": ["config:recommended"],
  "rangeStrategy": "pin",
  "schedule": ["before 9am on monday"],
  "prHourlyLimit": 0,
  "packageRules": [
    { "groupName": "non-major dependencies", "matchUpdateTypes": ["minor", "patch"] },
    {
      "matchPackageNames": ["drizzle-orm", "drizzle-kit"],
      "allowedVersions": "<1.0.0",
      "description": "Stable line only — the migration-journal format changes in the 1.0 RC (see pnpm-workspace.yaml catalog comment)"
    }
  ]
}
```

Enable the Renovate GitHub App on the repo (user/dashboard step — note it in the PR); review the onboarding PR like any other.

- [ ] CI: add an audit step after install — `pnpm audit --audit-level high` (decided #8). Prove the gate shape locally (`pnpm audit --audit-level high; echo $?`); GitHub **secret scanning** enabled in repo settings (user/dashboard step, noted in the PR).
- [ ] Commit `ci: renovate (pin, weekly, drizzle<1.0 rule) + dependency audit gate`.

### Task 11: Deploy runbook (`docs/conventions/operations.md`)

New conventions home for deploy-time, non-code platform configuration (one home per fact; CLAUDE.md's docs table gains the row in Task 12): **Logpush → R2** for Workers Logs (paid plan; dataset path layout; the ADR-0056 analytics tier reads this later), **Email Routing + DKIM/SPF on `magnacarta.esq`** (the deliverability lever; exact DNS records as the dashboard issues them), the `send_email` binding's destination-address verification requirement (beta constraint — verify at build), and the existing known manual step (new firm D1 binding = config commit + deploy, from ADR-0073). Written as numbered runbooks an operator can follow. Commit `docs(conventions): operations runbook — logpush, email DNS, binding steps`.

### Task 12: E2E + docs closeout (golden rule 5 — same PR)

- [ ] E2E test: a request through a real route logs `requestCompleted`; a forced handler error surfaces a 500 problem whose Error ID joins the `errorCaptured` event **and** can be quoted in a `POST /v1/incidents` body that lands a firm-scoped row + queue message — the full correlation story (white paper §12.1) in one test.
- [ ] Full `vp test` + `pnpm check` green.
- [ ] Docs in the same commits: [`docs/conventions/error-logging.md`](../conventions/error-logging.md) — backend "to build" items marked built, UI items annotated with their destination slice; CLAUDE.md docs table + `docs/conventions/` README row for `operations.md`; `ROADMAP.md` (0·6 → shipped; Phase 0 backend closeout noted; the design-system/auth-UI slice's inherited scope listed under Next/Backlog); `CHANGELOG.md` entry (0·2-entry density); ADR-0074 amendments if the Email Service API or audit tooling deviated.
- [ ] Commit `docs: slice 0·6 closeout — conventions, roadmap, changelog`.

## Self-review (spec coverage)

Spec §1 (telemetry package) → Tasks 1–4 · §2 (worker wiring, counters, Logpush-as-runbook) → Tasks 6, 11 · §3 (fitness functions) → Task 7 (+ schema checks in Task 5) · §4 (incident intake, Queue seam, one-Worker realization) → Tasks 5, 8 · §5 (email) → Task 9 (+ runbook Task 11) · §6 (Renovate/OSV/secret scanning) → Task 10 · §7 (testing) → distributed + Task 12 e2e · §8 (out-of-scope seams) → honored, no tasks · §9 (definition of done) → Task 12. Note: Task 8 adds `incident:report` to the permission registry — a small, deliberate widening of spec §4 (the conformance fitness rules from 0·5 require mutating authenticated routes to name a permission; "null permission" would need an allow-list exception, and a real permission is more honest).
