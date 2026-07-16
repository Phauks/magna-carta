# AI & Inference

<!-- Feature ledger fragment. One block per node; flat list; hierarchy encoded in the dotted id. Schema: roadmap.d/README.md -->

- id: ai
  name: AI / inference
  scope: Single credential-less model chokepoint owning confidentiality, tenant isolation, and fairness; AI-text detection; consent gate before any feature sends privileged content to a model.
  status: partial
  slices: ai-inference-foundation, ai-text-detection
  adrs: ADR-0111
  evidence: packages/inference and packages/ai-detection on main; consent decision open; no concrete AI feature built.

- id: ai.inference
  name: Inference chokepoint (@magna-carta/inference)
  scope: Every AI feature reaches the model through one pure package; no feature talks to the gateway directly.
  status: shipped
  slices: ai-inference-foundation
  adrs: ADR-0111
  spec: docs/specs/2026-06-17-ai-inference-foundation-design.md
  evidence: packages/inference/src (port.ts, catalog.ts, gateway.ts, settings.ts) + apps/worker/src/inference; status.d marks built done, tests todo.

- id: ai.inference.port
  name: InferencePort operations
  scope: Streaming and durable/Workflow-invocable text generation plus a platform-fixed embedding operation; reasoning model an explicit per-call parameter, embedding model pinned to the Vectorize index.
  status: shipped
  evidence: packages/inference/src/port.ts; PLATFORM_EMBEDDING_MODEL_ID pinned in catalog.ts.

- id: ai.inference.model-catalog
  name: Curated ZDR-only model catalog
  scope: In-repo data table of allowed models; every reasoning entry zdrEligible, zod-validated at module load; non-ZDR models unrepresentable.
  status: shipped
  evidence: packages/inference/src/catalog.ts with module-load validation.

- id: ai.inference.firm-model-selection
  name: Per-firm reasoning-model selection
  scope: Firm's primary reasoning model in the per-firm setting table; schema refined over the ZDR-eligible subset; total reads with safe default.
  status: shipped
  evidence: packages/inference/src/settings.ts (inference-owned FirmSettingDefinition).

- id: ai.inference.confidentiality
  name: Confidentiality control plane
  scope: Gateway-level ZDR, collectLog false and skipCache true pinned per request, fail-closed pre-dispatch ZDR guard that rejects rather than downgrades.
  status: shipped
  adrs: ADR-0110
  evidence: packages/inference/src/gateway.ts.
  notes: Cloudflare/Anthropic ZDR procurement artifacts gate the first real AI feature, not this layer.

- id: ai.inference.tenant-isolation
  name: Tenant isolation & metering
  scope: Firm metadata derived server-side (never caller-supplied); authoritative per-request token usage written through the firm-scoped data-access layer as the reconcilable metering record.
  status: shipped
  adrs: ADR-0113
  evidence: Per-firm token meter feeding the firm-usage diagnostics surface (apps/worker/src/routes/firm-usage.ts).

- id: ai.inference.fairness
  name: Multi-tenant fairness
  scope: One shared gateway per environment; queue-dispatched inference off the hot path; firm-scoped spend rule and account credit alarm as real-time guardrails.
  status: partial
  adrs: ADR-0112
  evidence: Queue dispatch built (apps/worker/src/inference); spend rules/alarms are gateway dashboard configuration, not verifiable in-repo.

- id: ai.inference.byok
  name: BYOK credentialed adapter
  scope: Per-firm bring-your-own-key adapter using the integration ConnectionStore/CredentialStore lifecycle; Unified-Billing-to-BYOK crossover as config.
  status: deferred
  evidence: Deferred until a firm attestation requires it or the shared rate cap is measured-binding (status.d/ai-inference-foundation.md).

- id: ai.consent
  name: Client-consent model
  scope: Owner decision on whether privileged matter content may reach third-party frontier models and under what consent; required before the first AI feature ships.
  status: researching
  adrs: ADR-0109
  evidence: ADR-0109 recorded as Proposed (open owner decision); strictest-firm fallback is the on-Cloudflare Workers-AI path via model-slot selection.

- id: ai.text-detection
  name: AI-text detection
  scope: Vendor-agnostic detection core (signal-not-proof, LikelihoodBand) with pluggable vendor adapters and per-firm consent.
  status: partial
  slices: ai-text-detection
  adrs: ADR-0163
  spec: docs/specs/2026-06-28-ai-text-detection-design.md
  evidence: packages/ai-detection + detect endpoint on main; UI and extensions deferred.

- id: ai.text-detection.core
  name: Detection core
  scope: Vendor-agnostic model: likelihood bands, never a verdict.
  status: shipped
  evidence: packages/ai-detection (LikelihoodBand core).

- id: ai.text-detection.pangram-adapter
  name: Pangram vendor adapter
  scope: Platform-managed adapter (one platform key, credential none), per-firm consent setting enforced at the chokepoint, paste-text endpoint, per-firm usage metering.
  status: shipped
  evidence: POST /api/v1/ai-detection/detect (apps/worker/src/routes/ai-detection.ts), ai_detection_usage metering; changelog.d/ai-detection-pangram.md + pangram-endpoint.md.

- id: ai.text-detection.ui
  name: Detection UI
  scope: In-app surface for running and reading detections.
  status: not-started
  evidence: Deferred in status.d/ai-text-detection.md; no page in apps/web.

- id: ai.text-detection.extensions
  name: Detection extensions
  scope: BYO-key, billing pass-through, document text-extraction input, bulk endpoint, matter-action integration.
  status: deferred
  evidence: Explicitly listed as deferred in status.d/ai-text-detection.md.

- id: ai.first-feature
  name: First concrete AI feature
  scope: Drafting / retrieval-augmented assistance / discovery AI review — the named consumer owning its spec, consent UI, and per-matter enforcement.
  status: not-started
  adrs: ADR-0109
  evidence: No feature spec or code; gated on the consent decision and ZDR procurement artifacts.

- id: ai.consumer-seams
  name: Downstream consumer seams
  scope: Document automation generation, discovery semantic search / RAG over Vectorize, and search query expansion referencing the inference chokepoint.
  status: not-started
  evidence: Named seams only; no Vectorize index or semantic-search code consuming packages/inference.
