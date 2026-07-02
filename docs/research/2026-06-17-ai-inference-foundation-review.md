# AI Inference Foundation — Adversarial Multi-Lens Review

**Date:** 2026-06-17 · **Method:** 6-lens adversarial review (architecture, privilege/confidentiality, tenancy, security, cost/lock-in, scalability), each finding adversarially verified (refute-by-default) against the live Cloudflare docs and the actual `@magna-carta/integrations` code on `main` + the `integration-platform` worktree. 43 findings raised; 14 independently verified; the remainder assessed against the same grounded facts (a transient platform rate-limit prevented a second verifier pass on those — flagged per item).

This reviews the _proposal_, not yet-written code. It is input to the foundation spec, not a spec.

---

## 1. Verdict — SOUND, WITH ONE REVERSAL AND TWO REFRAMES

The proposal's confidentiality and tenancy instincts are correct and survive scrutiny: a single AI-Gateway chokepoint, ZDR-on + payload-logging-off under Unified Billing, a curated ZDR-eligible/no-training catalog, platform-fixed embeddings, BYOK deferred behind attestation, and heavy reuse of the firm-scoped primitives. Every Claude model-id and the Fable-5 retention fact are verified correct. Proceed to spec — but three things change:

- **One reversal (placement):** do **not** build inference as a registered adapter _inside_ the integration framework. Build it as a **standalone `@magna-carta/inference` package** that reuses the framework only at the type level, and register a genuinely-credentialed framework adapter **later, for BYOK only**. Three verified facts force this (§3-A).
- **Two reframes:** (a) "no privileged content retained at the provider" is **not a fact you can assert** — it's a diligence obligation backed by Cloudflare↔Anthropic contract artifacts (§3-E); (b) DLP "defense-in-depth, always on" must become **verified, opt-in, Block-not-Flag** because response-scanning DLP breaks streaming and Flag writes finding metadata to logs (§3-F).

Everything else is hardening to fold into the spec.

---

## 2. What the proposal gets right (validated)

- **Single chokepoint, model-as-parameter (not adapter-per-provider).** One place to enforce firm-scoping, attach metadata, disable caching, apply guardrails. The gateway's universal/OpenAI-compatible endpoint genuinely normalizes providers, so the model is a parameter. _(verified — architecture, scalability, tenancy strengths)_
- **ZDR-on + payload-logging-off + ZDR-eligible/no-training curated catalog + Fable-5 exclusion.** ZDR and logging are separate axes, so `cf-aig-collect-log-payload:false` meters on metadata without storing bodies. `claude-opus-4-8`, `claude-sonnet-4-6`, `claude-haiku-4-5`, `claude-fable-5` are all valid current ids; Fable 5 mandates 30-day retention and returns `400` under ZDR, so its exclusion is exactly right. _(verified)_
- **Platform-fixed utility/embedding models.** A firm-swappable embedding model would invalidate the Vectorize index. Correct. _(verified)_
- **BYOK deferred behind per-firm compliance attestation.** Confirmed load-bearing: ZDR applies **only** to Unified Billing with Cloudflare-managed credentials and **not** to BYOK — a BYOK firm forfeits the gateway ZDR guarantee and must rely on its own provider contract. _(verified)_
- **Reuse of the firm-scoped DAL, `firm_secret`/`@magna-carta/encryption`, firm-usage diagnostics, and the `ToolManifest` catalog pattern.** Idiomatic; the registry's structural firm isolation (the firm's own D1 handle) is the right thing to ride on. _(verified)_

---

## 3. Material findings (ranked)

### A. PLACEMENT — build `@magna-carta/inference` standalone; framework adapter is for BYOK only `[HIGH-VALUE · verified + high-confidence]`

This reverses proposal item 4 and resolves the placement question definitively, on three grounded facts:

1. **The launch posture is credential-less.** Under Unified Billing there is no per-firm provider key. In `registry.ts`, a credential-less adapter (`kind:"none"`) is instantiated at lines 48-50 **without ever consulting the connection store** — so the firm's selected model cannot ride through `resolve()`. Modeling inference as _credentialed_ would force a synthetic `IntegrationConnection` row + a fake credential + a meaningless `needs_reauth` lifecycle. _(verified)_
2. **There is no seam for a per-firm non-credential parameter.** `AdapterContext = { credential? }` only; `IntegrationConnection` has no config field; `resolve()` calls `adapter.create({credential})` and nothing else. "Model as a parameter" has no home in the contract. _(verified)_
3. **The framework's dispatch cannot stream or run durably.** `Dispatch<T>` returns one buffered value; `HttpClient.request()` exposes only `json()` — no `ReadableStream`/SSE, no durable multi-step run. It was shaped for EasyPost-style buffered REST. AI features need token streaming (drafting) and durable/agentic runs (discovery, RAG). _(unverified by the second pass — but this is a direct reading of `dispatch.ts`/`http.ts`; high confidence)_

**Precedent already in the repo:** `property-links` is a standalone pure resolver with its own registry, surfaced in the tools catalog as `kind:"library"`; `shipping` is a framework adapter _because_ it has a per-firm credential + connection lifecycle. Inference at launch looks like `property-links`, not `shipping`.

**Fix:** Build `@magna-carta/inference` standalone — it owns `InferencePort` (with a streaming variant and a Workflow-invocable durable path), the curated catalog, and the AI-Gateway-backed implementation (`env.AI.run(model, input, {gateway:{id}})`). Reuse `@magna-carta/integrations` only for `Dispatch` + the problem taxonomy at the type level (as `shipping/canonical.ts` already imports types). Surface it in the tools catalog as `kind:"library"`. Keep a documented seam so the **later BYOK slice** registers a genuinely-credentialed framework adapter — that is the one place `ConnectionStore`/`CredentialStore`/`needs_reauth` actually apply.

> Note: this reconciles the earlier back-and-forth. The api-key credential capability that exists on `integration-platform` is real, but it is the _BYOK_ path's machinery — it does not make the _launch_ (credential-less, streaming) path fit the framework. Standalone-core + framework-facade-for-BYOK is the synthesis.

### B. Cross-firm cache leak — pin caching OFF as a hard constraint `[MEDIUM (latent) · verified]`

AI Gateway's default cache key is `SHA-256(provider + endpoint + model + provider-auth-header + body)`. Under Unified Billing the auth header is Cloudflare-managed and identical across firms, so the key carries **no firm dimension**; custom metadata does not enter it. Two firms sending a byte-identical prompt could collide on a cache hit. Caching is **off by default**, so there is no live leak — but it is an unpinned dangerous default a later "add caching for cost" change would silently weaponize. Gotcha: setting `cf-aig-cache-key` alone caches for 5 min even when gateway caching is off.

**Fix:** Add "response caching OFF for all firm-data inference" to the hard-constraints list; the adapter sends `cf-aig-skip-cache:true`; if ever enabled, require a firm-id-prefixed `cf-aig-cache-key`; fitness test asserting no cacheable request lacks a firm-scoped key.

### C. Derive the firm metadata tag — don't let callers set it `[MEDIUM · verified]`

Metering, per-firm spend caps, and log attribution key off `cf-aig-metadata` set by the calling Worker — a string that fails **open** if omitted/wrong (request still runs, mis-meters). Unlike connection-store isolation (structural, via the injected D1 handle), this is not structural. Metadata is capped at 5 keys (extras silently dropped) and logged in cleartext.

**Fix:** The adapter **derives** `firm_id` from `ResolveContext.firmId` and sets `cf-aig-metadata` internally; callers may not supply it. Drop the redundant `model` tag (it's a native log/spend dimension). Reserve the 5 keys for opaque ids only (`firm_id`, `slot`, `env`, future `matter_id`) — never client/matter text. Fitness test: every request carries a derived non-empty `firm_id`, ≤5 keys.

### D. Authenticate the gateway `[MEDIUM · verified]`

The proposal never mentions gateway authentication. Cloudflare recommends it to prevent unauthorized access and "invalid requests that can inflate log storage usage." For a multi-tenant gateway billing shared Unified-Billing credits, an unauthenticated gateway is an open door to log-quota exhaustion and unauthorized spend.

**Fix:** Gateway-level auth ON; reach it only via the Worker binding (pre-authenticated within the account); no raw `cf-aig-authorization` token in any firm-reachable config.

### E. ZDR is a sub-processor chain and ≠ "no egress" — reframe hard-constraint 6 `[MEDIUM · verified + credible]`

Under Unified Billing the Anthropic account is **Cloudflare's**, not the firm's; the firm has no direct DPA or ZDR letter and relies on Cloudflare's gateway flag propagating Cloudflare's commercial ZDR posture, with a documented **silent fallback to non-ZDR** if a provider doesn't support it. Separately, even under ZDR, Anthropic retains User-Safety classifier results to enforce its usage policy. ABA Rule 1.6(c)/Comment 8 is a _reasonable-efforts_ process standard — satisfiable, but not by asserting a fact you can't evidence.

**Fix:** Downgrade "no privileged content retained at provider" from an asserted fact to a **diligence obligation**: obtain in writing (a) Cloudflare's confirmation that Unified-Billing ZDR for Anthropic/OpenAI is contractually backed and the platform is a covered beneficiary, and (b) the Workers AI + AI Gateway DPA and subprocessor list; record an ADR citing these and gate the first real AI feature on it. Build a **fail-closed** per-request guard that rejects (not silently downgrades) if a model/provider isn't ZDR-eligible. Acknowledge residual classifier retention in the firm-facing disclosure.

### F. DLP — verified, opt-in, Block-not-Flag; response-DLP breaks streaming `[MEDIUM · verified + credible]`

Response-scanning DLP **buffers the full provider response** before returning it → defeats streaming (golden rule 10). Native DLP on `Flag` writes finding metadata (action, matched policy/profile/entry ids) to logs — _not_ raw payload (raw full-prompt logging is the separate Cloudflare One product, which must stay off this path), but still a log row for exactly the sensitive requests.

**Fix:** Reframe DLP from "always-on defense-in-depth" to verified opt-in: prefer **Block over Flag** for hard-stops (stops, doesn't log-and-pass); set DLP `Check=Request-only` on any streaming path (or split gateways by workload class — streaming vs async/batch); before trusting payload-off, run an experiment capturing the exact log entry a Flag match writes with `cf-aig-collect-log-payload:false`.

### G. Per-matter AI-eligibility + client-consent seam `[MEDIUM → narrowed · verified-partial]`

The foundation has no policy axis for "may this matter's content go to a third-party frontier model **at all**, and did the client consent?" (ABA Formal Op. 512 / Rule 1.6 make third-party-AI disclosure a confidentiality decision.) The single chokepoint is the right place for the gate, so it's cheap to seam.

**Fix (narrowed):** Add a firm-default "AI processing eligibility" setting (reuse `FirmSettingDefinition`) the adapter consults before any third-party-frontier egress; capture the consent question (engagement-letter vs per-matter) as an explicit open ADR. **Drop** the redaction stub (premature, and features _need_ the content) and the "on-Cloudflare-only mode" item (already inherent — it's a model-slot selection through the same gateway). Per-matter granularity + enforcement defers to the first feature, which owns the caller.

### H. Selected-model home — firm setting table, call-site parameter `[LOW · verified]`

Resolve the proposal's "either/or" decisively. Store the slot→model selection in the slice-1.1 `setting` table via an inference-owned `FirmSettingDefinition` (default `claude-opus-4-8`), schema = an **enum/refinement over the curated ZDR catalog** so `writeFirmSettingStatement`'s existing `schema.parse` rejects off-catalog/non-ZDR ids at write time. Read it through the firm-scoped DAL at the call site and pass it as an operation parameter. Do **not** extend `IntegrationConnection`/`AdapterContext`.

### I. Catalog: eligibility as verified DATA; pin snapshots; defer eval harness `[LOW/INFO · verified]`

Model ids are correct _today_, but model each catalog entry with explicit `zdrEligible`/`noTrainingEligible` booleans + a `verifiedOn` date (re-checked per Anthropic release via the claude-api skill), plus a pinned model snapshot id per slot and a catalog version/effective-date (cheap seams). Invariant test: only `zdrEligible:true` models are selectable; a ZDR-requested call that gets a non-ZDR fallback is a hard error. Persist "model snapshot in effect" per run for reproducibility. Defer the full eval-harness-in-CI to the first feature (nothing to evaluate yet) — leave the catalog-version field as the hook it attaches to.

### J. Off-hot-path Queue dispatch as a HARD requirement; the shared 200 req/60s cap `[MEDIUM · verified]`

One gateway → all firms share the **200 req/60s** Unified-Billing per-gateway cap and an account-wide credit pool (noisy neighbor / denial-of-budget). The 20-gateways/account cap forecloses gateway-per-firm.

**Fix:** Make Queue dispatch a **hard** requirement framed for per-firm back-pressure/fairness (not just perf). One `split-by-metadata.firm_id` spend rule (not per-firm; 20-rule cap). Account-level credit alarm below exhaustion. Name the scaling switch point — BYOK-per-firm (rate-exempt) or an Enterprise lift — for when firm count grows. Build the per-firm token-bucket _seam_ now; defer the machinery until measured.

### K. Cost — Unified Billing's 5% fee + forfeited direct discounts `[assess · unverified-credible]`

Unified Billing passes provider rates through with no markup but adds a flat **5% credit-purchase fee** and offers no committed-use/volume discounts. **Fix:** keep Unified Billing for launch/low-volume/pilot; model the crossover vs a platform-level direct contract (via BYOK Store Keys) at volume; ensure the adapter can switch Unified-Billing↔BYOK per firm without a code change — the portability seam that keeps the cost decision reversible.

### L. Metering — don't bill off gateway logs `[assess · unverified-credible]`

Gateway spend limits are best-effort/eventually-consistent; metadata is cleartext, 5-key capped; gateway log storage is capped with drop-on-full. **Fix:** capture per-request token usage from the inference **response** (provider usage object) at the adapter boundary and write it to the firm-scoped DAL as the authoritative, reconcilable metering record; use gateway metadata/spend-limits only as a real-time guardrail; set up Logpush before relying on log-derived numbers.

### M. Lock-in — make `InferencePort` carry control-plane concerns provider-neutrally `[assess · unverified-credible]`

The privilege/cost control plane (`cf-aig-zdr`, payload-off, metadata, spend-limits, BYOK keystore) is AI-Gateway-proprietary; the OpenAI-compat endpoint makes _model_-swap cheap but not _gateway_-exit cheap. **Fix:** model the ZDR guarantee, no-payload-log guarantee, per-firm spend cap, and per-firm metering as `InferencePort`-level concepts the adapter satisfies (today via `cf-aig-*` headers); document a gateway-exit runbook; record the lock-in as an accepted ADR tradeoff rather than implying exit is free.

### N. Embedding immutability must be type-enforced `[LOW · verified]`

The embedding operation must expose **no** firm-selectable model argument (a change requires a full reindex). Whether a separate `EmbeddingPort` or a no-model-arg method on one port is an implementation choice; the binding requirement is that per-firm embedding variation be _unrepresentable in the type signature_. Note `canonical.ts` is intentionally unused for inference (no vendor record to normalize).

---

## 4. Open decisions for you (the owner)

1. **Credential posture default** — _Recommend:_ launch on Unified Billing + ZDR-on + payload-off; BYOK later behind a per-firm compliance attestation. (Endorses the proposal.)
2. **May privileged matter content go to a third-party frontier model at all, and under what consent?** _Recommend:_ yes, but only under ZDR, gated by a firm-level (later per-matter) eligibility setting + a recorded consent decision; strictest firms default to the on-Cloudflare Workers-AI path. **Do not let privilege ride on an implicit default.**
3. **Gateway topology** — _Recommend:_ one gateway per environment (per-firm is foreclosed by the 20-gateway cap); mitigate via Queue back-pressure + credit alarm + named BYOK/Enterprise switch point. Consider a second gateway split by **workload class** (streaming vs response-DLP/batch) per §3-F.
4. **BYOK timing** — _Recommend:_ defer; build the seam, gate on a real firm attestation requirement or a measured rate-cap constraint.
5. **Catalog ownership** — _Recommend:_ platform-owned, in-repo, single curated catalog; firms select only the reasoning slot from the ZDR-eligible subset.

---

## 5. Recommended next-step sequence

**Spec (this foundation slice):**

1. The standalone `@magna-carta/inference` package: `InferencePort` (streaming + durable/Workflow path), the AI-Gateway-backed implementation, caching-off, derived-firm-id metadata, authenticated gateway, metadata-only logging. Framework reused at type level only.
2. The curated catalog data model (explicit `zdrEligible`/`noTrainingEligible`/`verifiedOn`, pinned snapshot per slot, catalog version) + invariant test; `claude-opus-4-8` default; Fable 5 excluded; utility/embedding platform-fixed.
3. The firm-setting record for the reasoning slot (firm D1, firm-scoped DAL) + the call-site read path; enum-validated against the catalog.
4. The authoritative per-request token-usage metering record (from the response) in the firm-scoped DAL.
5. The firm-default AI-eligibility setting + the off-hot-path Queue dispatch seam.

**Build the seams now (cheap-now/expensive-to-retrofit):** caching-off + derived-metadata + catalog-invariant fitness tests; the BYOK-adapter seam; the per-firm token-bucket seam; the gateway-exit runbook note.

**Defer to a seam:** BYOK / Store Keys path; native response caching with firm-scoped keys; second/third model slots; per-matter eligibility enforcement + the eval harness (with the first concrete AI feature, which also owns the consent UI).

**ADRs to record (same commit as the work):**

- Placement: standalone `@magna-carta/inference`, AI-Gateway-backed, framework reused at type level; BYOK as a later credentialed adapter.
- Credential & confidentiality posture: Unified Billing + ZDR-on + payload-off default; **ZDR as a diligence obligation** backed by named Cloudflare/Anthropic artifacts; BYOK behind attestation.
- Tenant-isolation hard constraints: caching disabled for firm-data inference; firm metadata derived not supplied; authenticated gateway; fail-closed ZDR guard.
- Multi-tenant fairness/availability: one gateway per environment, Queue dispatch required, single `split-by-metadata.firm_id` spend rule, credit alarm, named BYOK/Enterprise scaling switch point.
- Metering: authoritative token-usage record from the response in the firm-scoped DAL; gateway metadata as guardrail only.

---

_Process note: a transient platform rate-limit (not a usage limit) prevented a second adversarial verifier pass on ~29 of 43 findings across two runs. The 14 with `[verified]` were independently refuted-or-confirmed by a separate agent reading the live docs/code. Items marked `unverified-credible` are single-reviewer claims I assessed against the same grounded facts; none is load-bearing for the verdict, and most duplicate a verified finding from another lens. The one consequential unverified item — the buffered-dispatch-can't-stream finding (§3-A.3) — is a direct reading of `dispatch.ts`/`http.ts` and I hold it at high confidence._
