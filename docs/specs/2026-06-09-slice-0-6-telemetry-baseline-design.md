# Slice 0·6 — telemetry baseline & platform closeout — design

**Status:** Accepted (design) · **Date:** 2026-06-09 · **Owner:** Trevor Goldsmith
**White-paper home:** _Observability and diagnostics_ · _Communications layer_ (email transport)
**ADRs:** ADR-0017 (observability pillar) · ADR-0038 (error-logging method) · **ADR-0074 (telemetry-baseline realization, email provider, dependency automation — this slice's new decision)**

This spec is the implementation-grade design for slice 0·6 ([`ROADMAP.md`](../../ROADMAP.md)). The model — three data classes, redact-by-default, correlation-over-content, user-initiated incidents — is settled in the white paper and [`docs/conventions/error-logging.md`](../conventions/error-logging.md); this spec decides how the **backend** of it is built. The platform runs on a **paid Workers plan** (confirmed by the owner), which this slice is the first to require (Email Service, Workers Logs retention, Logpush).

**Scope decision made during design:** backend + CI only. Moved out, with destinations named: the client-reporter UI (crash screen, "Report a problem" menu item, screenshot capture/redaction) and the diagnostics-level settings UI → the **design-system/auth-UI slice** (nothing exists to attach them to; the breadcrumb-buffer library ships with them, since its only consumers are those surfaces); **visual-regression CI** → the same slice (no meaningful UI to screenshot yet); the **diagnostics agent** (triage → root-cause → draft PR → acknowledge) → its own later work, once incidents actually flow. The roadmap's 0·6 bullet is rewritten to match and the deferred items are attached to the future UI slice's scope.

---

## 1. `@magna-carta/telemetry` — the one logging path (golden rule 4)

A new, mostly-pure package. Dependencies: `@magna-carta/identifiers` only.

- **Allowlist event builders — redaction is structural.** Events are constructed through typed builders whose schemas enumerate exactly the loggable fields (the three-class model: technical metadata always; opaque identifier handles allowed; content fields have no builder slot to exist in). The builder strips unknown keys at runtime and rejects them at the type level — you cannot log a field that was never declared. Event catalog starts small: `request.completed`, `error.captured`, `outbox.swept`, `migration.applied`, `email.sent`, `incident.created` — it grows by adding builders, never by free-form logging.
- **Scrubbing backstop.** One boundary pass over every string field checks for denylisted shapes (email addresses, SSN-like patterns, long digit runs) and replaces matches with `[scrubbed]` while bumping a `telemetry.scrubbed` counter — a tripwire that the allowlist missed something, not the primary defense.
- **Correlation ID (`cor_`) and Error ID (`err_`).** Minted via `@magna-carta/identifiers` (new prefix-registry entries: `correlation → cor`, `error → err`, `incident → inc`). The correlation ID is created per request and rides every event and every problem response; the Error ID is minted when an error is captured and is the public key joining a user-visible failure to its server trace. **The slice 0·5 problem module delegates `errorId` minting here** — one source.
- **`Logger` interface + Workers adapter.** The interface is pure (`log(event)`, `count(metric, dimensions)`); the Workers adapter emits one structured-JSON line per event (Workers Logs captures and persists it) and writes counters to an **Analytics Engine** dataset binding. Test adapter records in memory. The adapter is the **only** place `console.*` may appear (§3 fitness function).

## 2. Worker wiring

- **Telemetry middleware, installed before everything** (incl. the 0·5 chokepoint): mints the correlation ID into the request context, times the request, writes `request.completed` (route template — never raw paths with embedded identifiers — status, duration, correlation ID), and is the final catch: an escaped exception becomes `error.captured` (Error ID, correlation ID, redacted stack header, route) + an RFC 9457 500 problem carrying the Error ID.
- **`wrangler.jsonc`:** observability/logs settings (sampling 100% at current volumes), the Analytics Engine binding (`TELEMETRY` dataset), the Queue binding already present. **Logpush → R2** (the durable telemetry archive ADR-0056's analytics tier later reads) is a **deploy-time runbook step** documented in the conventions — it is account configuration, not code.
- **What gets counted** (Analytics Engine, deliberately minimal): requests by route/status, errors by route/type, scrubber trips, outbox sweep results, email sends by outcome. Dashboards/alerting are consumption, deferred; the data starts accumulating now.

## 3. Fitness functions

- **The console ban:** a source scan asserts `console.log`/`console.error`/`console.warn` appear nowhere in `apps/worker/src` or `packages/*/src` outside the telemetry Workers adapter (and the dev email adapter's documented exception, which logs through an injected sink anyway). Ad-hoc logging fails CI — golden rule 4 made structural.
- **Error-path coverage:** every non-2xx problem response in the emitted OpenAPI document declares the `errorId` field (extends the 0·5 conformance suite).
- The new `incident` table passes the existing schema fitness suite (handle PK, no floats, expand-contract).

## 4. Incident intake — the user-initiated layer, API-only

- **`POST /api/v1/incidents`** through the 0·5 contract pipeline: `operationId: "incidents.report"`, authenticated, `audited: true`, `idempotency: optional`, its own rate bucket (`incident-report`, tight — it accepts user-authored content). Body: `errorIds[]` (validated `err_` handles, may be empty for "nothing crashed but something's wrong"), `breadcrumbs[]` (bounded array of `{ at, action, route }` — identifier-and-action shaped, the client library enforces never-content when it ships), `description` (the user's words — sensitive), `context` (`route`, `appVersion`, client timestamp), and an optional `screenshotKey` seam (schema'd now; capture/upload arrives with the UI slice).
- **Per-firm `incident` table** (per-firm lineage migration): `id` (`inc_`), `error_ids` JSON, `breadcrumbs` JSON, `description` TEXT, `context` JSON, `screenshot_key` nullable, `status` (`open`), `reported_by` (`usr_`), `created_at`. The description sits inside the firm-isolation boundary today; **moving it under `protected()` with access-gated, audited reads is a named seam** for when the crypto module lands (white paper §12.3's access-gating is then structural).
- **Queue seam:** the handler's effect batch includes an outbox row → `incident.created` reaches the Queue. **No consumer is built** — the diagnostics agent subscribes later; the at-least-once plumbing it needs is exercised from day one.
- The white paper's "bug-report Worker" is realized as **this route in the single Worker** (ADR-0069: one deployable owns `/api/*`); recorded as an interpretation in ADR-0074.

## 5. Transactional email — Cloudflare Email Service (ADR-0074)

- **`CloudflareEmailAdapter`** implements the existing `sendEmail` port (slice 0·4) over the native **`send_email` binding** — no API keys or secrets. Production wiring swaps the adapter; dev/test keep the logging adapter. Every send logs `email.sent` (outcome, message class — never body content).
- **Why:** same-vendor custody and ops posture, binding-not-keys, $0.35/1k at trivially small volumes. **Beta caveat recorded:** Email Service is public beta (April 2026); deliverability history is short. Mitigations: correct **DKIM/SPF/Email Routing setup on `magnacarta.esq`** (a documented deploy-time runbook, the actual deliverability lever at these volumes) and the port seam — if it disappoints, swapping to Resend/SES is one adapter. Verify current binding API + limits against the docs at build (golden rule 11).
- Rejected: **Resend** (mature and excellent, but a third-party SaaS receiving names/addresses/reset links — tolerable, not preferred, and a second vendor account); **AWS SES** (cheapest at scale; an entire AWS account + IAM for one function is Phase 0 over-weight).

## 6. Dependency & security automation

- **Renovate**, propose-only (ADR-0058 posture): pnpm-**catalog-aware** (the reason over Dependabot, whose catalog support is weak), `rangeStrategy: pin` matching the repo's exact-pin rule, grouped + weekly-scheduled PRs, lockfile maintenance, the drizzle pin's documented constraint respected via a package rule (stable line, not the 1.0 RC — the catalog comment is the source of truth).
- **OSV / `pnpm audit` CI step:** fails on known-vulnerable dependencies at high severity; advisory below that.
- **GitHub secret scanning** enabled on the repo (settings, not code).
- Rejected: **Dependabot** (catalog support); **auto-merge for patch updates** (every upgrade stays deliberate per the catalog's own rule — revisit when CI depth earns it).

## 7. Testing

- **Unit (`packages/telemetry`):** builders strip/reject undeclared fields; scrubber canary fires on planted shapes and counts trips; correlation/Error ID minting and propagation; the in-memory adapter records faithfully.
- **Integration (Miniflare):** a request produces `request.completed` with a `cor_` id; a thrown handler error produces the 500 problem whose `errorId` matches the `error.captured` event; `POST /v1/incidents` writes the firm-scoped row + outbox row and replays idempotently when a key is supplied; the email adapter sends through a faked binding and logs the outcome.
- **Fitness:** the §3 console ban; the `errorId` coverage sweep; the incident schema checks.
- **CI:** the OSV step proves itself against a known-vulnerable test manifest in a disposable branch (gate proven live, then removed — the 0·5 pattern).

## 8. Out of scope — named seams

Client reporter UI + breadcrumb library + screenshot capture/redaction + diagnostics settings UI and **visual-regression CI** (→ the design-system/auth-UI slice) · the **diagnostics agent** (→ once incidents flow; the Queue message shape is its contract) · `protected()` for incident descriptions (→ crypto-module slice) · the Iceberg analytics tier (ADR-0056 triggers unchanged) · dashboards/alerting on Analytics Engine data · self-hosted Sentry (the white paper's deferred option stands) · Logpush is runbook-documented but its R2 dataset layout is consumed only by the deferred analytics tier.

## 9. Definition of done (golden rule 5)

Code + migrations + tests green, and in the same commits: ADR-0074 in the Decision-Log; `ROADMAP.md` 0·6 status + the UI-slice scope additions; `CHANGELOG.md`; [`docs/conventions/error-logging.md`](../conventions/error-logging.md) updated — backend items moved from "to build" to built, UI items annotated with their destination slice; the deploy-time runbook (Logpush, DKIM/SPF/Email Routing) written into the conventions home it belongs to. No user docs (no user-operable surface yet).
