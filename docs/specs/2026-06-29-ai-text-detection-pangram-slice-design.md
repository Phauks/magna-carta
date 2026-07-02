# AI-Text Detection — Pangram first-vendor slice (design)

**Status:** Accepted (design) · **Date:** 2026-06-29 · **Owner:** Trevor Goldsmith
**Builds on:** the AI-Text Detection vendor-agnostic core (`docs/specs/2026-06-28-ai-text-detection-design.md`; `@magna-carta/ai-detection`) · the integration ports-and-adapters foundation (`packages/integrations`) · the AI-inference platform-managed/confidentiality posture (`@magna-carta/inference`; ADR-0109/0110) · the slice-0·5 API chokepoint.
**ADRs (new, to record):**

- **ADR-CCCC** — Pangram first-vendor adapter: platform-managed credential (single platform key, `credential: none`, NOT the per-firm credentialed-adapter infrastructure), chokepoint-enforced firm consent, dedicated per-firm `ai_detection_usage` metering (word-native), BYO-key deferred as a separate adapter seam.

This slice makes the AI-Text Detection tool **actually work** by wiring **Pangram** behind the existing `AiTextDetectionPort`. It is **backend-only** (no UI — gated on the 0·7 design-system shell) and **paste-text-only** (document text-extraction is a later seam). The vendor-agnostic core (port, `DetectionReport`, normalizer, consent types, `ai-detection` category, deferred adapter) already exists and merged; this slice adds the concrete Pangram adapter, the firm consent setting, per-firm metering, and the worker route.

---

## 0. Settled decisions (not re-litigated)

- **Vendor: Pangram.** Best independent accuracy, zero-retention enterprise, detects Claude.
- **Platform-managed credential.** We hold ONE Pangram key (a Cloudflare secret); we expose detection to all firms and meter per firm ourselves. NOT BYO-key (deferred seam, §7). NOT firm-billed-passthrough in this slice (a future hook reads the usage table, §4).
- **Signal, not proof** — the core already enforces this structurally; this slice does not weaken it.
- **Consent enforcement = chokepoint** (owner 2026-06-29): the worker route is the single gate; no type-level consent witness this slice.
- **Metering home = a dedicated word-native `ai_detection_usage` per-firm table** (owner-approved analysis): Pangram bills by words not tokens (so the inference token meter is the wrong shape), and Tools detection is matter-less (so the matter-costs system is the wrong home). Dedicated table serves cost-visibility + fair-use + firm-usage diagnostics now, with a clean billing seam later.

## 1. Module placement

- **`@magna-carta/ai-detection`** (pure package — extend):
  - `src/adapters/pangram.ts` — the platform-managed Pangram adapter. Implements `AiTextDetectionPort`; `create()` closes over an injected `HttpClient` (the `@magna-carta/integrations/http` transport seam) + the platform API key + base URL. `detect()` builds the Pangram request, calls the injected client, maps the response → `RawDetection`, and runs it through `normalize()`. Vendor/transport errors → `IntegrationProblem` via `adapterError(...)` — caller-safe `detail` only, **never** echoing the analyzed text. Stays pure: the network call is the injected client's job; the adapter imports only the `HttpClient` interface type.
  - `src/settings.ts` — the firm consent setting (`FirmSettingDefinition`), mirroring `@magna-carta/inference/settings`.
  - `src/pangram-response.ts` (or inline in the adapter) — the zod schema + types for Pangram's `predict` response (the untrusted boundary is validated before mapping).
  - `test/pangram.test.ts`, `test/settings.test.ts`, purity-allowlist update.
- **`@magna-carta/data-access`** — the firm-scoped metering write (`recordAiDetectionUsage`) and the consent-setting read (reuse the generic firm-setting accessor).
- **`@magna-carta/database`** — migration: the per-firm `ai_detection_usage` table + the `tools:aiTextDetection` role seed.
- **`apps/worker`** — the `POST /api/v1/ai-detection/detect` route (through the chokepoint), the adapter construction + key/HttpClient injection, the OpenAPI contract entry + regenerated client, and the `PANGRAM_API_KEY` secret binding.

## 2. The Pangram adapter

**Credential model.** The adapter's `CapabilityDescriptor` declares `credential: { kind: "none" }` — there is no _per-firm_ credential, so the registry resolves it `ok` for every firm and the heavy credentialed-adapter infrastructure (the `firm_secret` `CredentialStore`, the connection D1 repo, the refresh lock) is **not** built here. The platform key is injected at construction in the worker (the inference precedent: a platform-managed secret, not a firm connection). When the key is absent (dev/test), the worker wires the existing deferred adapter instead, which returns `capability-unsupported`.

**Request.** Pangram's `predict` takes the text (+ a `public_dashboard_link: false` flag — never create a public link for privileged content). Confirm the exact REST endpoint path + auth header scheme with Pangram (the Python SDK wraps `PANGRAM_API_KEY`); the adapter takes a configurable base URL + key so go-live config is a binding, not a code change. Build/test behind the injected `HttpClient` with a recorded response fixture.

**Response → `RawDetection` mapping** (validated by a zod schema at the boundary first):

- `fraction_ai` → `score` (0..1, proportion AI-generated).
- per-window `confidence` (aggregated/min) → `vendorConfidence`.
- `version` / `stage` → `vendorModel` / `vendorVersion` (provenance).
- `windows[]` `{ start_index, end_index, ai_assistance_score }` → `segments` (CONFIRM whether Pangram indices are character or token/word offsets; if token/word, map to character offsets or document the unit — `SegmentScore` is character-based).
- `fraction_ai_assisted > 0` → set `signals.paraphraseSuspected = true` (Pangram's "AI-assisted" ≈ humanized/edited — feeds the core's paraphrase caveat).
- `egressedTo: "pangram"` passed into `normalize()` (egress provenance is required by the core).

The adapter returns `ok(normalize(input, raw, { adapterId: "pangram", detectedAt, egressedTo: "pangram" }))`. `detectedAt` is passed in (no `Date.now()` in the pure core — the worker supplies the timestamp).

## 3. Firm consent setting (chokepoint-enforced)

`src/settings.ts` exports `externalDetectionEnabledDefinition: FirmSettingDefinition<boolean>` — key `aiDetection.externalDetectionEnabled`, `defaultValue: false` (off — privilege never egresses on an implicit yes). Reads stay total (missing row = false). The route reads it before any Pangram call; if false, the route returns a typed problem (422/forbidden) and never constructs/calls the adapter — the chokepoint is the single enforcement point. (Purity note: importing the `FirmSettingDefinition` type from `@magna-carta/data-access/setting-statements` is a type-only import of a pure-data definition — the same tradeoff `@magna-carta/inference` makes; add it to the purity allowlist with a comment.)

## 4. Per-firm metering — `ai_detection_usage`

A dedicated per-firm table (the per-firm SQLite Durable Object). Indicative columns:
`id` (branded), `requested_by` (user id), `word_count` (int), `mode` (`'realtime' | 'bulk'`), `cost_minor` (derived: `word_count / 1000 * rate`, stored in minor units; rate is a documented constant per mode), `adapter_id` (`'pangram'`), `vendor_version` (nullable, provenance), `result_band` (nullable, for analytics), `matter_id` (nullable — the matter-action seam), `created_at`.

The route records one row per successful detection through a firm-scoped data-access write (`recordAiDetectionUsage`), off the hot path (`ctx.waitUntil` or post-response), firm-isolated like the inference metering. This is the authoritative per-firm usage record; a future billing decision (absorb vs. pass-through via `@magna-carta/costs`) reads from it — not built here. Word count is computed once (server-side) and is the billing-relevant unit.

## 5. Worker route

`POST /api/v1/ai-detection/detect` via `defineOpenAPIRoute` through the slice-0·5 chokepoint (tenancy → authn → RBAC → idempotency → rate-limit). Gated by `tools:aiTextDetection`. Body: `{ text: string; languageHint?: string; matterId?: string }`. Flow: read firm consent setting → if off, typed problem; if on, construct the Pangram adapter (inject `env.PANGRAM_API_KEY` + `HttpClient`) → `detect()` → on `ok`, record usage + return the `DetectionReport`; map adapter `Dispatch` failures (`capability-unsupported` → 422 "detection not available"; `adapter-error` → mapped problem, no upstream body leak). Idempotency via the chokepoint. The OpenAPI snapshot + the generated client are regenerated (contract is code-as-contract).

## 6. Permission & role-seeding

`tools:aiTextDetection` is already registered. A per-firm migration seeds it to the appropriate default roles (follow the existing Tools-utility seeds; update the all-role seed-union test accordingly — a known gotcha).

## 7. Out of scope (designed-in seams)

BYO-key (a separate `credential: { kind: "apiKey", scope: "firm" }` Pangram adapter that triggers building the `firm_secret` credential store + connection repo — built only if Pangram licensing forbids platform-managed) · billing/pass-through via `@magna-carta/costs` (the usage table is the seam) · document text-extraction (paste-text only here) · the UI widget + consent-gate UI (0·7) · the matter-action consumer (`matter_id` column is its seam) · bulk-mode endpoint (realtime first; bulk is the same adapter against the bulk endpoint) · the type-level consent witness (chokepoint is sufficient for v1).

## 8. Testing

- **Pangram adapter** — against a mocked `HttpClient` with recorded Pangram fixtures: a clean-AI response → `band: "likely"`; a humanized (`fraction_ai_assisted`) response → paraphrase caveat → `inconclusive`; a transport/5xx → `adapter-error` with no text in `detail`; a malformed response → validation error (not a throw). Response-schema validation at the boundary.
- **Consent setting** — default false; the route refuses when off (integration test) and proceeds when on.
- **Metering** — one `ai_detection_usage` row per successful detection; word count + derived cost correct; firm-isolated.
- **Route** — chokepoint integration (permission denied without `tools:aiTextDetection`; idempotent; problem mapping for the failure reasons).
- **Purity** — the extended allowlist still rejects a disallowed import.
- End-of-build **7-angle adversarial review**.

## 9. Build gotchas (carry-forward)

- Migration slot: take the next free per-firm migration number on `main` at build time; main's drizzle snapshot chain has been fragile across recent merges — re-baseline carefully.
- Seed-union test: adding the role seed updates the all-role union test.
- Contract regen: regenerate the OpenAPI snapshot + Hey API/Svelte-Query client; the byte-exact drift test will fail otherwise.
- Confirm with Pangram (call 2026-06-29): exact REST endpoint + auth header, `windows` index unit (char vs token), multi-tenant/OEM licensing (decides whether platform-managed stays the default or BYO-key is forced), ZDR-as-default contractual.
