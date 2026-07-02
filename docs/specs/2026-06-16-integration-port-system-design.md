# Integration port system — design

**Status:** Accepted (design) · **Date:** 2026-06-16 · **Owner:** Trevor Goldsmith
**White-paper home:** _Plugin / Add-on system_ (and _Integrations_)
**Research input:** five-stream subagent research, 2026-06-16 (unified-API platform patterns · calendar/email provider primitives · sync/webhook mechanics · OAuth + scope-review gates · hexagonal multi-tenant patterns) — synthesized inline; not a standing research doc.
**ADRs:** ADR-0015 (uniform plugin model — **this concretizes it**) · **ADR-0091 (port-system architecture & contract — new)** · **ADR-0092 (connection model, per-functionality scoping & credential seam — new)** · builds on ADR-0026/0084 (encryption + the `firm_secret` credential store) · ADR-0003 (tenancy) · ADR-0022 (code-as-contract) · ADR-0039 (compute placement) · ADR-0068 (access control).

This is the implementation-grade design for the **integration port system** — the ports-and-adapters foundation every integration plugs into. ADR-0015 fixed the posture (uniform plugin model, Worker-per-integration behind typed ports, per-firm scoped secrets); this spec fixes the framework's modules, contracts, data model, and seams below that decision, and proves the spine with a credential-less first adapter. **Backend only; no UI.**

It deliberately does **not** build a credentialed live adapter. The framing (owner, 2026-06-16): integrations _now_ are **first-party features Magna Carta builds that reach out to external platforms**, not outside vendors providing services and not actors bringing their own credentialed services in — those are designed-for seams (§10), not built. The first credentialed adapter (email/calendar) is designed at the seam level here and built in its own later slice, gated on slice 1·2 and a provider compliance review (§11).

**Build gates:** none hard. The framework is pure library + data-model code with no dependency on unlanded slices. The credential store is a **seam** (§6) whose real backing is slice 1·2's `firm_secret` store (ADR-0084) — so _live credentialed_ adapters gate on 1·2, but the framework and its credential-less proof adapter do not.

---

## 1. Module placement

One new package plus thin wiring, on the ADR-0071 structure-vs-access seam:

- **`@magna-carta/integrations`** — new pure package. Defines what a **port**, an **adapter**, a **capability descriptor**, and a **connection** are; the canonical-record base + zod boundary contract; the registry + dispatch resolver; the error/health model; and the cross-cutting interfaces (credential store, token refresher, retry/rate-limit/redaction). No D1, no Hono, no `env` — all I/O arrives through injected ports. Dependencies: `@magna-carta/identifiers` (handles) and the RFC 9457 problem module already in `@magna-carta/api-client`.
- **`packages/data-access`** — gains the `integration_connection` repository (the per-firm connection records, §5) behind the firm-scoped gate (golden rule 3), and recognizes the `CredentialStore` interface as fulfilled by the slice 1·2 `getSecret`/`putSecret` store (§6).
- **`apps/worker`** — composition root: registers the first-party adapters into the registry at startup, mounts connection-management routes through the slice 0·5 chokepoint, and (later) the OAuth-callback + webhook ingress for credentialed adapters.
- **`@magna-carta/parcels`** — gains an adapter module depending on `@magna-carta/integrations` (§9); its pure resolver logic is unchanged.

Direction: `integrations` ← `data-access`/`parcels`/adapters; `worker` wires them. Adapters depend inward on the port, never the reverse (dependency inversion).

## 2. Core concepts — port, adapter, capability

- A **port** is a TypeScript interface named in _our_ domain vocabulary, not a vendor's — e.g. `ParcelLookupPort`, later `CalendarPort`. It names the operations the application needs (`resolveAssessorUrl`, `lookupParcel`, …). Core code depends only on the port; it never imports a vendor adapter.
- An **adapter** implements one port for one external platform (or, for credential-less cases, computes locally). Adapters are first-party code modules now; the marketplace seam (§10) lets future untrusted adapters move out-of-process without changing the port.
- A **capability descriptor** is the adapter's published manifest: `{ adapterId, category, scope: 'firm' | 'user', operations: Record<OperationName, { supported: boolean; requiredFields?; }>, passthroughAvailable: boolean }`. Not every adapter supports every operation (a county deep-link resolver has no full-data lookup; one calendar API lacks free/busy), so callers consult the descriptor and **degrade gracefully** rather than calling a method that throws. The descriptor is the capability source of truth, snapshotted onto the connection (§5).

## 3. The canonical contract

The industry-convergent shape (Merge / Apideck / Nylas / Cronofy / Paragon / Finch), adapted to the house code-as-contract style (ADR-0022):

- **Canonical model per category.** Each port defines a normalized record shape in our vocabulary. Adapters map their vendor's payload into it; core stays vendor-agnostic, so swapping adapters is invisible upstream.
- **`remoteId` + opt-in `raw`.** Every canonical record carries the vendor-native id (`remoteId`) and an **opt-in untouched payload** field (`raw`), requested explicitly. Normalization never silently destroys data the caller might need.
- **zod-validated boundary.** Each port ships a zod schema for its canonical records; adapter outputs are validated into the canonical shape at the boundary. External data is untrusted (a drifting or hostile API must not feed malformed data into the domain) — this is the same trust-boundary validation `data-access` already does, not a new paradigm. The zod schema _is_ the canonical model.
- **Two passthrough tiers** for the long tail: a write-side field-extension on canonical calls, and a full vendor-native **proxy** call — both gated by the descriptor's `passthroughAvailable`. Passthrough is the escape hatch, never the spine.
- **Additive-only versioning.** One long-lived major per port; new fields/operations are additive, new models ship behind a beta flag. A breaking change is a new port version, announced — never a silent shape change.

## 4. Registry & dispatch

- **Registry.** `category → registered adapters (by id)`. First-party adapters self-register at worker startup with their descriptor. Resolution is `resolve({ firm, principal, category })`: look up the firm's (and, for user-scoped ports, the user's) `integration_connection` for that category, load credentials through the credential store, instantiate the adapter with an injected credential accessor, and return it. Credential-less adapters resolve with no connection lookup.
- **Dispatch result is a typed sum, never a bare throw:**
  ```
  type Dispatch<T> =
    | { ok: true;  value: T }
    | { ok: false; reason: 'not-connected' | 'capability-unsupported' | 'adapter-error'; problem?: Problem }
  ```
  `not-connected` (no active connection) and `capability-unsupported` (descriptor says no) are first-class outcomes so callers branch instead of catching. `adapter-error` carries a normalized problem (§7).

## 5. Connection model & per-functionality scoping

Connection identity splits in two (the Nylas Connector/Grant pattern):

- **Provider-config** — the adapter's app-level registration (OAuth client id/secret, base URLs). First-party, one per adapter, **not** per-firm; stored as Worker secrets / config, never in per-firm D1.
- **Grant / connection** — one authorized account, per-firm, recorded in the per-firm `integration_connection` table (handle `integrationConnection_…` — full-word prefix per golden rule 12): `{ id, category, adapter_id, scope, principal_ref, credential_ref, status, capability_snapshot, created/updated, audit }`.

**Scope is declared by the port, not chosen globally** (correcting the white paper's blanket "per-firm scoped secrets"): a port declares `scope: 'firm' | 'user'`. A user-scoped port (calendar/email — each attorney authorizes their own account, also the right answer for ethical walls) keys the connection on `{ firmId, userId }`; a firm-scoped port (e.g. firm accounting — one connection for the firm) keys on `{ firmId }`. The framework supports both; the port picks.

**Connection health state machine:** `connected | degraded | needs_reauth | disabled`. Driven from dispatch outcomes (§7) — a `401`/`invalid_grant` class moves a connection to `needs_reauth`; an open circuit breaker moves it to `degraded`. The state and the capability snapshot are what the (future) connection-management UI renders.

## 6. Credential store & safety

- **Credential store is a seam.** The framework defines `CredentialStore` (`get/put/delete(credentialRef)`); the **real backing is slice 1·2's per-firm `firm_secret` store** (`getSecret`/`putSecret`, envelope-encrypted, `firm:manageSecrets`-gated — ADR-0084 already names "plugin credentials" as an encrypted-unindexed protected payload). So the framework ships against the interface now; live credentialed adapters wait for 1·2. Because the proof adapter (§9) is credential-less, **no secret is ever stored at framework-build time** — there is no plaintext-credential window to get wrong.
- **Per-firm isolation.** Every credential lives in the per-firm D1 through the firm-scoped data-access layer; nothing crosses firms (golden rule 3 / ADR-0003).
- **Framework owns token refresh, not adapters.** Both major providers silently rotate refresh tokens, so concurrent refreshes race and can revoke each other. Refresh is serialized by a **Durable Object per credential** (single-writer lock); the newest refresh token returned on every exchange is persisted. Access tokens stay in memory; only refresh tokens are at rest (encrypted). `invalid_grant` / re-consent is surfaced as `needs_reauth` after one retry — never a silent retry loop. This machinery is **designed here, built with the first credentialed adapter** (§11).
- **Egress control seam.** Adapter outbound traffic is the natural place to later interpose per-adapter egress allowlists (Workers for Platforms Outbound Workers, §10).

## 7. Error & health model

Extend the existing RFC 9457 problem module (no new error system): canonical problems gain extension members `retryable: boolean`, `category: 'auth' | 'rate_limit' | 'validation' | 'upstream' | 'network'`, and the existing `correlationId`. **Adapters map heterogeneous vendor errors into this one taxonomy** — that is the adapter's job, not the caller's. The framework reads the taxonomy to drive retry (§8) and the connection health state machine (§5). Secrets are redacted by default in every adapter log line (golden rule 4 / ADR-0017).

## 8. Cross-cutting scaffolding (framework-owned)

So adapters can't each reinvent them inconsistently, the framework owns — behind interfaces — retry/backoff (honoring `Retry-After`, jitter), circuit breaking, idempotency keys, rate-limit budgeting (per-principal concurrency caps), and secret redaction. Implementations are **thin now** (the proof adapter makes no network calls and exercises none of them) behind the same interfaces the heavy versions will use. Adapter invocation is **async-capable from day one** (golden rule 10 / ADR-0039): the dispatch contract permits offloading a call to a Queue/Container without a contract change, which the sync engine (§11) will need.

## 9. Proof adapter — `parcels` retrofit

The framework's spine is proven by a **credential-less** adapter, with zero procurement and zero 1·2 dependency: re-express the existing parcels resolver as the first adapter behind a `ParcelLookupPort`.

This is well-motivated, not artificial: the same port will later carry **credentialed vendor adapters** (Regrid/ATTOM — see [`docs/research/property-data-integrations.md`](../research/property-data-integrations.md)) that implement richer operations with real API calls and per-firm secrets. So `ParcelLookupPort` demonstrates the system's whole point — **one port, multiple adapters across the credential boundary** — from the first commit:

- `ParcelLookupPort` declares operations `resolveAssessorUrl` (today's deep-link resolver) and the future `lookupParcel` / `lookupByAddress` (full dossier).
- The **parcels adapter** declares only `resolveAssessorUrl` in its capability descriptor; `scope` is irrelevant (credential-less). Its canonical output (the resolved URL + the county `AssessorSite` it came from) flows through the zod boundary; `raw` carries the matched site row.
- A caller asks the registry for the firm's parcel-lookup adapter, checks the descriptor, and gets a typed `capability-unsupported` for `lookupParcel` until a vendor adapter is connected.

This exercises registry, dispatch, descriptors, the canonical/`raw`/zod contract, and the typed `Dispatch` outcomes end-to-end. It does **not** exercise credentials, refresh, sync, or retry — those are designed as seams here and first exercised by the calendar adapter (§11), stated plainly rather than faked.

## 10. Marketplace seam

First-party adapters are in-process modules behind the port (cheapest at launch — one deploy, one scaffold; only first-party adapters exist now). The documented escalation, taken when an untrusted third-party adapter or the marketplace actually arrives, is **in-process module → service-binding / Worker-to-Worker RPC → Workers for Platforms** (a dispatch Worker routing to isolated per-vendor User Workers, each with scoped bindings, with **Outbound Workers** enforcing egress/credential injection). The port contract does not change across these steps; only the transport behind the registry does. Pure credential-less utilities stay shared libraries unless/until they need a port (the white paper's "pure utilities are libraries, not plugins" line).

## 11. Deferred — the first credentialed adapter (email/calendar)

Designed at the seam level here; built in its own later slice. Deferred contents and their gates:

- **Live OAuth 2.0 + PKCE flows**, per-user-default with optional per-firm admin-consent (Google domain-wide / Microsoft tenant admin-consent), refresh-token rotation, incremental re-consent. _Gated on slice 1·2_ (credential storage) and the **provider compliance review** below.
- **The full canonical calendar/email schemas** — the research-catalogued field set and lossy-mapping risks: recurrence canonicalized to RFC 5545 RRULE (Microsoft Graph's structured `patternedRecurrence` is lossy), `iCalUID`/`seriesMasterId` series identity, dual wall-time+TZID/UTC time storage, attendee/RSVP, free/busy, attachments; email threaded on `References`/`In-Reply-To` + `Message-ID` dedup (not the provider conversation id), label-vs-folder.
- **The generic sync engine** the framework will provide (per-resource cursor + push-subscription state machine; cursor-driven incremental loop with full-resync recovery on token invalidation; a push receiver that treats every notification as "something changed, go pull"; subscription-renewal cron; idempotent reconciliation by `(provider, externalId, etag)` with tombstones) plus the **webhook ingress** (Google watch channels — header-only, ~7-day, recreate-to-renew; Microsoft Graph subscriptions — validation handshake, `clientState` verification, 3-second ack, PATCH renewal, lifecycle notifications).
- **Procurement / compliance gate (not engineering):** Google Gmail/Calendar are **restricted scopes** → OAuth verification + an annual **CASA** security assessment (weeks of lead time, recurring cost); Microsoft needs publisher verification + an admin-consent flow. Like the legal-research adapters (ADR-0015), _building_ the adapter and _shipping_ it are separated by this review — name it early so it starts in parallel.

## 12. Testing

- **`@magna-carta/integrations` unit suite:** the canonical/zod boundary (valid maps through, malformed is refused), descriptor-driven capability gating, the `Dispatch` outcomes (`not-connected` / `capability-unsupported` / `adapter-error`), registry resolution for both `firm`- and `user`-scoped ports, and the health state-machine transitions from each error category.
- **Parcels adapter:** the existing resolver tests stand; new tests prove it behind the port (descriptor honesty — declares only what it supports; canonical+`raw` output; `capability-unsupported` for unimplemented operations).
- **Worker integration (Miniflare):** startup adapter registration, the `integration_connection` repository through the firm-scoped gate (tenant isolation — a connection never resolves across firms), and the connection-management routes through the 0·5 chokepoint (audited mutations).
- **Fitness:** a source scan that no adapter is imported by core code outside the registry (dependency-inversion guard), and that every registered adapter ships a descriptor.
- Data is write-path fixtures, never raw inserts (ADR-0034).

## 13. Decisions recorded & docs to update

New ADRs (Decision Log): **ADR-0091** (port-system architecture & contract) and **ADR-0092** (connection model, per-functionality scoping & credential seam — corrects the white paper's "per-firm scoped secrets" wording). Both concretize **ADR-0015**.

On build: a new slice row in [`ROADMAP.md`](../../ROADMAP.md) + [`STATUS.md`](../../STATUS.md), the white-paper _Plugin / Add-on system_ scoping-wording correction, and `CHANGELOG.md` — same commit as the work (golden rule 5). The load-profile accretion rule (ADR-0083) binds the connection table's volume-shaped reads when the credentialed adapter lands (the framework alone adds negligible per-firm data).
