# AI inference foundation — design

**Status:** Accepted (design) · **Date:** 2026-06-17 · **Owner:** Trevor Goldsmith
**White-paper home:** a single _AI / inference_ home (described once); the consumer topics _Document Automation_, _Discovery_, and _Search_ reference it by topic name.
**Research input:** the adversarial multi-lens review, 2026-06-17 ([`docs/research/2026-06-17-ai-inference-foundation-review.md`](../research/2026-06-17-ai-inference-foundation-review.md)) — six lenses (architecture, privilege/confidentiality, tenancy, security, cost/lock-in, scalability), each finding assessed against the live Cloudflare docs and the `@magna-carta/integrations` code; the load-bearing findings independently verified (several cost/metering/lock-in findings remain credible-but-unverified, flagged where they bind). This spec implements that review's verdict; it does not relitigate it.
**ADRs:** ADR-0104 (placement — new) · ADR-0105 (credential & confidentiality posture — new) · ADR-0106 (tenant-isolation hard constraints — new) · ADR-0107 (multi-tenant fairness/availability — new) · ADR-0108 (client-consent model for third-party-frontier processing — **Proposed; owner decision pending**) · builds on ADR-0091/0092 (the integration port system — reused at type level only), ADR-0003 (tenancy), ADR-0017/0038 (error logging / redaction), ADR-0039 (compute placement), ADR-0083 (load-profile accretion), ADR-0097/0103 (the Tools area + firm-usage diagnostics), and the slice-1·1 `setting` table + `FirmSettingDefinition` accessor.

This is the implementation-grade design for the **AI inference foundation** — the single credential-less chokepoint every future AI feature reaches the model through. It owns the `InferencePort` domain interface (streaming + a durable Workflow-invocable path), the platform-fixed embedding operation, the curated ZDR-eligible model catalog, the per-firm reasoning-model selection, and the AI-Gateway-backed implementation that pins the confidentiality and tenant-isolation control plane. Backend plumbing only; no UI, no first AI feature. The first concrete feature (drafting / discovery / retrieval-augmented assistance) is the named consumer of these seams and lands in its own later slice, which also owns the consent UI.

**Build gates.** The package core — the `InferencePort`, the catalog, the per-firm model-selection setting, and the AI-Gateway-backed implementation — depends only on surfaces present on every active branch: the type-level `Dispatch` + problem taxonomy from `@magna-carta/integrations` (the `dispatch`/`problem` modules predate the `apiKey` credential and exist everywhere) and the slice-1·1 `setting` table + `FirmSettingDefinition` accessor. Two real cross-branch gates remain, because the dependencies are currently split across unmerged branches: (1) the tools-catalog row (§1) and the firm-usage-diagnostics metering feed (§8) live in the Tools area + firm-usage diagnostics work (ADR-0097/0103), which today is on the `parcels-states-batch-2` lineage and **not yet on `main`** — so this slice is sequenced to branch off `main` once that work lands; (2) the deferred BYOK adapter (§13) additionally needs the `apiKey` credential + connection store from the integration-platform work (on `main`/integration-platform, not the tools lineage) — but that is the later BYOK slice, not this plumbing slice. The diligence gate (the Cloudflare↔Anthropic procurement artifacts, §6) gates the _first real AI feature_, not this slice, and is named here so procurement starts in parallel.

---

## 1. Module placement

One new pure package, a one-row tools-catalog entry, and a thin worker wiring point. This is the review's one reversal: inference is not a registered integration adapter at launch — it is a standalone library that reuses the framework only at the type level, exactly as `@magna-carta/property-links` is a standalone resolver and `packages/shipping` consumes integration types without touching the registry.

- **`@magna-carta/inference`** — new pure package. Owns the `InferencePort` interface (§2), the durable-run contract (§2), the platform-fixed embedding operation (§3), the curated model catalog + its module-load validation (§4), the inference-owned `FirmSettingDefinition` for the reasoning slot (§5), and the AI-Gateway-backed implementation that reaches the model only through the authenticated Worker AI binding (§6). No D1, no Hono, no `env` in the contract surface; the implementation receives the `AI` binding and the firm-scoped read result as injected parameters. **Dependencies:** `@magna-carta/integrations` (`workspace:*`, type-level reuse only), `@magna-carta/identifiers` (firm/run handles), and `zod` (catalog + setting-schema validation). It is `"type":"module"`, `"sideEffects":false`, subpath exports per source file (no barrel) — the house package shape.
- **Type-level reuse of `@magna-carta/integrations` (the whole reuse surface).** Pure port signatures import only the `Dispatch` type: `import type { Dispatch } from "@magna-carta/integrations/dispatch";` — a true `import type`, the form the shipping implementation plan uses (note `packages/shipping/src/canonical.ts` imports a _value_, `canonicalRecordSchema`, so it is not the type-only exemplar). The implementation additionally imports the value constructors `import { ok, adapterError } from "@magna-carta/integrations/dispatch";` and the problem taxonomy `import { integrationProblem } from "@magna-carta/integrations/problem";` plus `import type { IntegrationProblem, ProblemCategory } from "@magna-carta/integrations/problem";`. These specifiers pull in zero registry / connection / credential machinery — `registry.ts` imports `dispatch.ts`/`problem.ts`, never the reverse. `@magna-carta/integrations/canonical` is intentionally unused: there is no vendor record to normalize.
- **`@magna-carta/tools`** — gains one catalog row in `src/catalog.ts`, `backing: { kind: "library" }` (like `property-listing-links` and `firm-usage`, not `{ kind: "integration", category }` like `shipping`). It is a library because at launch there is no per-firm connection or credential whose state the shell would reflect. The row's `permission` field is resolved at module load by `assertPermission("tools:...")` imported from `@magna-carta/access-control/registry` (mirroring `packages/tools/src/catalog.ts` line 1) — an unregistered key fails loud at import. The catalog stores only the manifest; it never touches the inference implementation.
- **`apps/worker`** — composition root for the inference _call site_, not a registry registration. Where a future AI feature needs inference, the worker: (a) reads the firm's selected reasoning model through the firm-scoped data-access layer (§5), (b) constructs the AI-Gateway-backed `InferencePort` implementation with the authenticated `AI` binding (§6), (c) dispatches the call off the hot path via a Queue (§9), and (d) writes the authoritative token-usage record through the firm-scoped data-access layer (§8). The worker does not call `createIntegrationRegistry().register(...)` for inference at launch — that call exists only in the deferred BYOK slice (§13).

Direction: `inference` ← worker call sites and the future feature packages; `inference` depends inward on the `Dispatch`/problem _types_ only, never on the integration registry. The registry dependency appears solely in the BYOK adapter module, built later.

## 2. Core concept — `InferencePort` (streaming + durable)

`InferencePort` is a TypeScript interface in _our_ domain vocabulary, not a vendor's and not the gateway's. It names exactly two operation families: a text-generation operation with two result shapes, and the platform-fixed embedding operation (§3). Every operation returns a typed `Dispatch` — the implementation maps a model/provider/gateway failure into a first-class failure via the `adapterError(...)` constructor (yielding `reason: "adapter-error"` carrying an `IntegrationProblem`), never a bare throw (the `category` drives retry and surfacing; `detail` is caller-safe text only — never a spliced upstream body, golden rule 4).

The review verified that the framework's `Dispatch`/`HttpClient` cannot carry streaming or durable runs (`HttpResponse` exposes only `json()`; `Dispatch<T>` is one buffered value). So inference does not reuse the `http.ts` transport seam; the implementation goes direct to the AI binding (`env.AI.run(model, input, { gateway: { id } })`), and the port exposes both result shapes the framework lacks:

- **Streaming generation** — returns a token stream (an async iterator of text deltas) for interactive drafting where first-token latency matters. The streaming path keeps response-scanning DLP off (§10) — buffering the full response to scan it would defeat streaming (golden rule 10).
- **Durable generation** — a Cloudflare-Workflow-invocable path for long or agentic runs (multi-step discovery, retrieval-augmented assistance) where a single request would exceed Worker limits or needs durable resumption. The contract is shaped so a Workflow step calls one `InferencePort` operation per step and the run state lives in the Workflow, not the port.

Both shapes carry the same control-plane guarantees as provider-neutral concepts the implementation satisfies (§12): ZDR, no-payload-logging, the per-firm spend cap, and per-firm metering are `InferencePort`-level concerns — the interface never mentions `cf-aig-*` headers. The reasoning **model id is an explicit operation parameter** (read per call site through the firm-scoped data-access layer, §5); it is not carried on an `AdapterContext`/`IntegrationConnection` (neither has a non-credential config seam — the verified reason inference is standalone).

The authoritative per-request token usage is read from the inference _response_ (the provider usage object) at the implementation boundary and returned to the call site alongside the result, so the worker can write the metering record (§8) without the gateway logs ever being the billing source.

## 3. The platform-fixed embedding operation

A separate embedding operation whose model is a platform-**fixed constant**, pinned to the Vectorize index version (a firm-swappable embedding model would invalidate the index and force a full reindex). The binding requirement, type-enforced: per-firm embedding variation must be unrepresentable in the signature — the embedding operation takes no firm-selectable model argument. There is no enum, no setting, no parameter through which a firm could choose an embedding model; the model is a module constant the operation closes over, versioned alongside the index. Whether this is a distinct `EmbeddingPort` or a no-model-arg method on the one port is an implementation detail; the invariant is the absence of the argument. The embedding model id is recorded in the catalog (§4) as a platform-fixed entry for auditability, but it is not selectable.

## 4. The curated model catalog

An in-repo, `ToolManifest`-style data table — the single curated source of truth for which models exist, what they retain, and which slot they may fill. Eligibility is verified data, never a hardcoded constant relied on blindly: model ids and retention/ZDR facts are re-checked against the Anthropic reference per release.

Each entry shape:

- `slot` — `"reasoning" | "utility" | "embedding"` (the slot the model may fill).
- `modelId` — the **gateway-routable, provider-prefixed** id passed to `env.AI.run` (e.g. `anthropic/claude-opus-4-8`, `openai/gpt-4.1-mini`); a bare id would not route through the gateway binding.
- `snapshotId` — the pinned model snapshot id in effect, so a run is reproducible and the snapshot can be persisted per run.
- `referenceId` — the bare first-party Anthropic id (e.g. `claude-opus-4-8`) used when verifying ZDR/retention against the Anthropic reference.
- `zdrEligible: boolean` — explicit; true only when the provider supports Zero-Data-Retention for this model under the gateway.
- `noTrainingEligible: boolean` — explicit; the provider will not train on the data.
- `verifiedOn` — ISO date the entry was last verified against the Anthropic reference.

The catalog carries a catalog version + effective-date at the table level — the hook a future eval harness attaches to (deferred; nothing to evaluate yet).

**Contents (launch):**

- **Reasoning slot:** default `anthropic/claude-opus-4-8`. The catalog may list additional reasoning models, but every reasoning entry must be `zdrEligible: true`. `claude-fable-5` is **excluded** — it mandates 30-day retention and returns a hard error under ZDR, so it is not ZDR-eligible and never enters the reasoning slot.
- **Utility slot:** platform-fixed (a small/fast model for non-reasoning utility paths), `zdrEligible: true`.
- **Embedding slot:** platform-fixed, pinned to the Vectorize index version (§3).

**Module-load validation.** The catalog is validated by a standalone zod `safeParse`/`parse` at module load (distinct from the tools catalog's `assertPermission` check, which validates permission-registry keys, not model data) — a malformed entry fails loud at import, not at first inference. The validation enforces: every entry has all required fields; every `reasoning` entry is `zdrEligible: true`; exactly one `embedding` entry exists and it is platform-fixed.

**Invariant fitness test (§15):** only `zdrEligible: true` entries are selectable for the reasoning slot, and a ZDR-requested call that receives a non-ZDR fallback is a hard error (the fail-closed guard, §6).

## 5. Per-firm model selection

One configurable **primary reasoning model** slot now; the data model is multi-slot-capable but ships one (additional slots are a later seam). The review resolved the proposal's either/or decisively: store the selection in the slice-1·1 per-firm `setting` table via an inference-owned `FirmSettingDefinition`, read it through the firm-scoped data-access layer at the call site, and pass the model id as an `InferencePort` operation parameter. Do not extend `IntegrationConnection` / `AdapterContext`.

- The definition (`@magna-carta/inference`, exported for the worker to read/write): `{ key: "inference.primaryReasoningModel", schema, defaultValue: "anthropic/claude-opus-4-8" }` — a `FirmSettingDefinition<string>` from `@magna-carta/data-access` (`setting-statements`), mirroring the `matters/src/settings.ts` precedent.
- The `schema` is an enum/refinement over the curated ZDR-eligible reasoning subset of the catalog (§4). Because `writeFirmSettingStatement` validates with `schema.parse` (fails loud) at write time, an off-catalog or non-ZDR-eligible model id is rejected at the write path — the existing setting write-time validation becomes the enforcement point, no new machinery.
- Read is total: `readFirmSetting` returns the default on a missing row, unparseable JSON, or a schema-invalid stored value — a bad write never bricks a read, and a firm that never configured the setting still gets the safe default. The call site reads it through the firm-scoped data-access layer (the firm's own D1 handle) and passes the result to the operation.

The setting key is tracked against the per-firm schema by the existing schema-name-sync fitness; the `setting` table is the slice-1·1 minimal store.

## 6. Launch credential & confidentiality posture

**Credential-less at the per-firm level.** Under AI Gateway Unified Billing, credentials are Cloudflare-managed — there is no per-firm provider key at launch. The implementation reaches the gateway only via the authenticated Worker `AI` binding (pre-authenticated within the account); no raw `cf-aig-authorization` token appears in any firm-reachable config. Gateway-level auth is on — an unauthenticated multi-tenant gateway billing shared Unified-Billing credits is an open door to log-quota exhaustion and unauthorized spend.

**Confidentiality control plane (pinned on every request):**

The implementation reaches the gateway through the Worker `AI` binding (`env.AI.run(model, input, { gateway: … })`), so the control plane is pinned via the binding's `gateway` options — not the REST `cf-aig-*` headers (the binding does not consume them).

- ZDR on for Anthropic/OpenAI — set as the **gateway-level** `zdr` configuration (the binding exposes no per-request ZDR option), and enforced per request by the catalog restricting to ZDR-eligible models plus the fail-closed guard below.
- Request logging off — `collectLog: false`. The binding's `collectLog` is **all-or-nothing**; there is no payload-only middle ground (the REST `cf-aig-collect-log-payload` toggle is not available on the binding path), so it is set off outright — no prompt/response body is ever logged. Metering never depends on logs: the authoritative per-request token usage is read from the inference _response_ (§8). (ZDR and logging are independent axes.)

**ZDR is a diligence obligation, not an asserted fact.** Under Unified Billing the Anthropic account is Cloudflare's, not the firm's; the firm has no direct DPA or ZDR letter and relies on Cloudflare's gateway flag propagating Cloudflare's commercial ZDR posture — which silently falls back to non-ZDR per provider if a provider doesn't support it. Even under ZDR, Anthropic retains User-Safety classifier results to enforce usage policy. ABA Rule 1.6(c)/Comment 8 is a reasonable-efforts process standard — satisfiable by diligence, not by asserting an unevidenced fact. Therefore:

1. **Procurement artifacts as a recorded diligence gate:** obtain in writing (a) Cloudflare's confirmation that Unified-Billing ZDR for Anthropic/OpenAI is contractually backed and the platform is a covered beneficiary; and (b) the AI Gateway + Workers AI DPA and subprocessor list. ADR-0105 cites these artifacts and gates the first real AI feature on them (not this plumbing slice).
2. **A fail-closed per-request ZDR guard (built now).** Before dispatch, the implementation asserts the selected model/provider is `zdrEligible` in the catalog; on any response signal of a non-ZDR fallback, it rejects (returns an `adapter-error` `IntegrationProblem`) — it never silently downgrades. This is the runtime enforcement of the catalog invariant (§4).
3. **Residual-retention disclosure:** the firm-facing disclosure acknowledges Anthropic's residual classifier retention even under ZDR — privilege never rides on an unevidenced "no retention" claim.

## 7. Tenant isolation — caching off (hard constraint)

**Response caching is off for all firm-data inference.** AI Gateway's default cache key is `SHA-256(provider + endpoint + model + provider-auth-header + body)`; under Unified Billing the auth header is Cloudflare-managed and identical across firms, so the default key carries no firm dimension — two firms sending a byte-identical prompt could collide on a cache hit. Caching is off by default, so there is no live leak, but it is an unpinned dangerous default a later "add caching for cost" change would silently weaponize.

- The implementation pins `skipCache: true` in the binding `gateway` options on every request.
- If caching is ever enabled for a non-privileged utility path, it requires a custom `cf-aig-cache-key` whose first component is the firm id (a firm-id-prefixed key). Note the gotcha: setting `cf-aig-cache-key` alone caches for ~5 minutes even when gateway caching is off — so the firm-scoped key is mandatory wherever a cache key appears at all.
- **Fitness test (§15):** no inference request is dispatched cacheable without a firm-scoped cache key.

## 8. Tenant isolation — derived firm metadata + authoritative metering

**Firm metadata is derived, never caller-supplied.** Metering, the per-firm spend rule, and attribution key off the gateway request metadata (the binding `gateway.metadata` map), a value that fails open if omitted/wrong (the request still runs, mis-metered) — unlike the structural connection-store isolation, this is not structural unless we make it so. The implementation derives `firm_id` from the firm-scoped call context and sets the binding `gateway.metadata` map internally; callers may not supply it. Metadata is capped at 5 keys (extras silently dropped) and logged in cleartext, so the keys are opaque ids only (`firm_id`, `slot`, `env`, a future `matter_id`) — never client/matter text. The redundant `model` tag is dropped (model is already a native gateway log/spend dimension). **Fitness test (§15):** every dispatched request carries a derived, non-empty `firm_id` and ≤5 keys.

**The authoritative metering record (ADR-0106).** Gateway spend limits are best-effort/eventually-consistent and gateway log storage is capped with drop-on-full — so billing never derives from gateway logs. The implementation captures per-request token usage from the inference _response_ (the provider usage object) at the boundary and the worker writes it through the firm-scoped data-access layer as the authoritative, durable, firm-isolated, reconcilable metering record. It feeds the firm-usage diagnostics surface (the existing ADR-0103 snapshot — each domain owns the read of its own tables). The gateway metadata plus a single spend-limit rule scoped to the `firm_id` custom-metadata dimension (our label: "firm-scoped spend rule") are a real-time guardrail only, never the billing source. (Logpush is set up before any log-derived number is trusted, but the response-captured record is authoritative regardless.)

## 9. Tenant fairness & availability

**One AI Gateway per environment.** Gateway-per-firm is foreclosed by the **20-gateways-per-account cap (paid plan; 10 on free)**, so all firms share one gateway per environment and thus the 200 req/60s Unified-Billing per-gateway cap and an account-wide credit pool (noisy-neighbour / denial-of-budget risk).

- **Off-hot-path Queue dispatch is a hard requirement** — framed for per-firm back-pressure and fairness against the shared cap, not merely perf (golden rule 10). Inference calls dispatch through a Queue so a single firm cannot starve the gateway cap or the credit pool synchronously on the request path.
- A single spend-limit rule scoped to the `firm_id` custom-metadata dimension is the real-time per-firm guardrail (not per-firm rules — the 20-rule-per-gateway cap forecloses one rule per firm).
- Account-level credit alarm fires below exhaustion.
- **Named scaling switch point:** when firm count grows, either per-firm BYOK (rate-exempt — §13) or an Enterprise rate lift. The decision point is named now so it is not discovered under load.
- **Per-firm token-bucket seam built now; machinery deferred until load is measured** (golden rule 10). The seam is concrete: the Queue consumer derives `firm_id` from the firm-scoped job context and routes the call through a single `firmRateGate(firm_id)` hook — a pass-through no-op at launch — sited between the Queue dequeue and the `env.AI.run` call. A per-firm limiter (a Durable Object per firm, or a token bucket behind that hook) drops in there later without touching the `InferencePort` contract or any call site; only the hook body changes.

## 10. DLP / guardrails posture

Verified, opt-in defense-in-depth — not always-on (the review's second reframe). Response-scanning DLP buffers the full provider response before returning it, defeating streaming (golden rule 10); native DLP on Flag writes finding metadata (action, matched policy/profile/entry ids) to logs — a log row for exactly the sensitive requests.

- **Prefer Block over Flag for hard-stops** — Block stops the request; Flag logs-and-passes, writing finding metadata.
- DLP `Check = Request-only` on any streaming path (response-scanning DLP breaks streaming), or split a separate gateway by workload class (streaming vs async/batch).
- Verify the exact log payload a Flag match writes with `cf-aig-collect-log-payload: false` before relying on payload-off — an experiment capturing the actual log entry, not an assumption.
- Never enable the Cloudflare One full-prompt-logging product on this path (it is the separate raw-payload-logging product and must stay off).

## 11. Per-matter AI-governance seam + the consent open decision

The foundation needs a policy axis for "may this matter's content go to a third-party frontier model at all?" The single chokepoint is the cheap, correct place to seam it.

- A firm-default **"AI processing eligibility" setting** (reuse `FirmSettingDefinition`, §5) the implementation consults before any third-party-frontier egress. Per-matter granularity, enforcement, content redaction/minimization, and the consent UI are deferred to the first concrete AI feature (which owns the caller). The redaction stub is dropped as premature — features _need_ the content.
- The "on-Cloudflare-only / Workers-AI-only" mode is inherent, not separate machinery — it is a model-slot selection through the same gateway (the strictest firms default to the Workers-AI path).

**Open decision (ADR-0108) — the client-consent model.** ABA Formal Op. 512 / Rule 1.6 make third-party-AI disclosure a confidentiality decision. _Whether_ privileged matter content may go to a third-party frontier model, and _under what consent_ (an engagement-letter blanket consent vs per-matter consent), is an explicit owner decision, not settled here. **Recommendation:** yes — but only under ZDR, gated by the firm-level (later per-matter) eligibility setting above plus a recorded consent decision; the strictest firms default to the on-Cloudflare Workers-AI path; privilege must never ride on an implicit default. Record the chosen model as ADR-0108 before the first feature ships.

## 12. Portability & lock-in

The privilege/cost control plane (`cf-aig-zdr`, payload-off, metadata, spend-limits, the BYOK keystore) is AI-Gateway-proprietary; the OpenAI-compatible endpoint makes model-swap cheap but gateway-exit it does not.

- `InferencePort` carries the control-plane guarantees as provider-neutral concepts the implementation satisfies — ZDR, no-payload-log, per-firm spend cap, per-firm metering are interface-level concerns (today realized via `cf-aig-*` headers); the interface never names gateway specifics.
- A documented gateway-exit runbook accompanies the package.
- Lock-in is recorded as an accepted ADR tradeoff (ADR-0104) — exit is not implied to be free; the model-swap-cheap / gateway-exit-not-cheap asymmetry is stated plainly.

## 13. Deferred — the BYOK credentialed adapter

Built only when a firm attestation requires it or the shared rate cap is measured-binding (§9). It is the one place the integration framework's `ConnectionStore`/`CredentialStore`/`needs_reauth` lifecycle actually applies, so at that point it registers a genuinely-credentialed framework adapter:

- An `Adapter<InferencePort>` (from `@magna-carta/integrations/port`) with a module-const `CapabilityDescriptor` whose `category` field is literally `"inference"` (the registry derives the registration key from the descriptor) and which declares `credential: { kind: "apiKey", scope: "firm" }`, plus a `create(context: AdapterContext): InferencePort` that validates `context.credential` — registered via `createIntegrationRegistry().register(adapter)` (one adapter per category), shipping an `IntegrationManifest` that passes `isWellFormedManifest`. `createEasyPostAdapter` + `shippingManifest` are the exact working exemplars.
- Keys live in Cloudflare Secrets Store via AI Gateway BYOK / Store Keys, referenced by name via `cf-aig-authorization` — not a `firm_secret`-backed `ApiKeyCredential`. The key does not live in `firm_secret`; the framework's `CredentialStore` here references the stored-key alias, it does not hold the raw provider key.
- **No cryptographic per-firm key isolation.** Single-account BYOK does not give per-firm key isolation — account-scoped Run tokens reach every gateway and every stored key. Only Worker-binding-mediated, server-derived alias selection bounds which key a firm's request uses; true cryptographic isolation requires a separate Cloudflare account, which the one-account topology forecloses. This caveat goes in the attestation language so a firm is never told BYOK gives isolation it cannot.
- A BYOK firm forfeits the gateway ZDR guarantee (ZDR applies only to Unified Billing with Cloudflare-managed credentials) and relies on its own provider contract — the reason BYOK gates on a per-firm compliance attestation.

## 14. Cost

Unified Billing passes provider rates through with no markup but adds a flat 5% credit-purchase fee and offers no committed-use/volume discounts (those are forfeited vs a direct platform contract). Keep Unified Billing for launch/pilot/low-volume; model the BYOK-at-volume crossover (a platform-level direct contract via BYOK Store Keys); ensure the Unified-Billing↔BYOK switch is a per-firm config, not a code change — the same portability seam (§12) that keeps the cost decision reversible.

## 15. Testing

- **Unit (`@magna-carta/inference`):** the `InferencePort` contract including the **streaming** result shape and the typed `Dispatch` outcomes (`ok(...)` and `adapterError(...)` yielding `reason: "adapter-error"` with a normalized `IntegrationProblem`); the catalog invariants (every reasoning entry `zdrEligible: true`; exactly one platform-fixed embedding entry; module-load schema validation fails loud on a malformed entry); the setting enum validation (an off-catalog or non-ZDR model id is rejected at the write path by `schema.parse`; `readFirmSetting` returns the default on missing/invalid); and the **fail-closed ZDR guard** (a non-ZDR model is rejected, never downgraded). The embedding signature is tested to expose no firm-selectable model argument (the type-level invariant).
- **Fitness functions:** caching-off (no cacheable request without a firm-scoped cache key); derived-firm-metadata (every request carries a derived non-empty `firm_id`, ≤5 keys, no `model` tag); catalog `zdrEligible` invariant; and the existing `lint:process-refs` source scan (proposed source + consumer-facing strings carry no process-doc citations — golden rule 13).
- **Worker integration (Miniflare):** the AI-Gateway-backed implementation through the slice-0·5 chokepoint; firm isolation of the metering record and the setting (a record/setting never resolves across firms — the firm's own D1 handle). Data is write-path fixtures, never raw inserts.
- **Load-profile note (accretion rule, ADR-0083):** the pure package adds negligible per-firm data; the authoritative token-usage table joins the load-profile harness when the first AI feature lands (it is volume-shaped only once a feature drives traffic) — named now, built then.

## 16. Decisions recorded & docs to update

New ADRs (Decision Log):

- **ADR-0104** (Accepted) — placement: standalone `@magna-carta/inference`, AI-Gateway-backed, integration framework reused at type level; BYOK as a later credentialed adapter; lock-in accepted tradeoff.
- **ADR-0105** (Accepted) — credential & confidentiality posture: Unified Billing + ZDR-on + payload-off; ZDR as a diligence obligation backed by named Cloudflare/Anthropic artifacts; the fail-closed ZDR guard.
- **ADR-0106** (Accepted) — tenant-isolation hard constraints: caching disabled for firm-data inference, firm metadata derived not supplied, authenticated gateway, authoritative response-token metering in the firm-scoped data-access layer.
- **ADR-0107** (Accepted) — multi-tenant fairness/availability: one gateway per environment, off-hot-path Queue dispatch required, a single firm-scoped spend rule, credit alarm, named BYOK/Enterprise scaling switch point.
- **ADR-0108** (**Proposed — owner decision pending**) — client-consent model for third-party-frontier processing: the §11 recommendation is recorded, the choice is not yet made. The Decision Log entry is created in an open/proposed state, not Accepted.

On build (same commit as the work, golden rule 5): a new slice row in [`ROADMAP.md`](../../ROADMAP.md) + [`STATUS.md`](../../STATUS.md); one white-paper home describing the AI inference foundation (the shared model chokepoint), with the _Document Automation_ / _Discovery_ / _Search_ topics referencing it by topic name (one home per fact, golden rule 9); the recurring 5% Unified-Billing credit fee and the gateway/Workers-AI line in [`docs/operating-costs.md`](../operating-costs.md); and [`CHANGELOG.md`](../../CHANGELOG.md). **No tools-catalog row and no seeded `tools:inference` permission this slice** — those belong with the first AI feature that has a real user surface (the Tools sidebar is for tools a user opens; this foundation ships no UI). **Exactly one new per-firm migration: `0014_inference-token-usage`** (the `token_usage_meter` `CREATE TABLE`; no seed migration). **No `docs/user/` change this slice** — there is no user-facing surface yet; the consent UI and its user help land with the first AI feature. The procurement diligence artifacts (§6) are recorded against ADR-0105 and gate the first real AI feature, not this plumbing slice.
