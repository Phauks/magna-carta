# AI & Inference

<!-- Feature ledger fragment. One block per node; flat list; hierarchy encoded in the dotted id. Schema: roadmap.d/README.md -->

<!-- public-group: Assistance and AI -->

- id: ai
  name: AI / inference
  scope: Single credential-less model chokepoint owning confidentiality, tenant isolation, and fairness; AI-text detection; consent gate before any feature sends privileged content to a model.
  status: partial
  slices: ai-inference-foundation, ai-text-detection, magnus
  adrs: ADR-0111
  evidence: packages/inference, packages/ai-detection, and packages/magnus on main; the consent decision is still open, so the assistant ships off by default with an adapter that reaches no provider.

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

- id: ai.inference.embedding-pin-window
  name: Embedding pin held open until the first index
  scope: The embedding model is changeable only while no vector index exists, because every stored vector is a function of the model that produced it. The catalog records that state and a fitness scan refuses to let the window close by accident — while the pin reads open, no source file may reach a vector index.
  status: shipped
  evidence: packages/inference/src/catalog.ts (pinState on the embedding entry) and the source scan in packages/inference/test/fitness-model-pin-rot.test.ts; apps/worker/src/search/semantic-search.ts is still engine-not-implemented and no wrangler configuration declares a Vectorize binding.
  awaiting-owner: Which embedding model the first index is built with. The pin is unchangeable once vectors exist, so this is decided before the first one is written, not after.

- id: ai.inference.model-catalog
  name: Curated ZDR-only model catalog
  scope: In-repo data table of allowed models; every reasoning entry zdrEligible, zod-validated at module load; non-ZDR models unrepresentable. Each entry also records the provider's published lifecycle facts (retirement date, successor) under a verification date separate from the confidentiality one, and the FORM the provider publishes its pinned snapshot in, so a snapshot id that contradicts its own form fails at import rather than reaching a provenance record.
  status: shipped
  evidence: packages/inference/src/catalog.ts with module-load validation, including the snapshotForm refinements; packages/inference/test/catalog.test.ts and packages/inference/test/fitness-catalog.test.ts pin the recorded snapshot ids to the provider's published values.

- id: ai.inference.reasoning-tier
  name: Evergreen reasoning tier
  scope: A platform-maintained tier name (most-capable / balanced) that the firm default and deploy configuration resolve through, so tracking model advancement is a data edit rather than a code change. An override can only ever select a model already curated in the catalog, so non-ZDR models stay unrepresentable.
  status: shipped
  evidence: packages/inference/src/catalog.ts (tier occupancy validated at module load) and packages/inference/src/reasoning-tier.ts; packages/inference/test/reasoning-tier.test.ts.
  notes: Which model occupies each tier is unchanged from what the platform already ran; moving a tier onto a published successor is an open owner decision.

- id: ai.inference.pin-freshness
  name: Model-pin staleness detection
  scope: A pure pass over the catalog that reports a pin past its published retirement, approaching one, superseded by a newer generation, or overdue for re-verification. Expiry fails the gate; the rest is reported. Cannot detect a successor released since the last check — that gap is bounded by the re-read interval, not closed.
  status: shipped
  evidence: packages/inference/src/model-pin-freshness.ts; packages/inference/test/model-pin-freshness.test.ts and packages/inference/test/fitness-model-pin-rot.test.ts.

- id: ai.inference.firm-model-selection
  name: Per-firm reasoning-model selection
  scope: Firm's primary reasoning model in the per-firm setting table; schema refined over the ZDR-eligible subset; total reads with safe default derived from the platform tier rather than a literal model id.
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
  audience: public
  public-name: Client consent for AI
  public-summary: Decide, for each client, whether their information may be sent to an AI model at all — and have that decision enforced rather than remembered.
  awaiting-owner: Whether client consent for AI is taken once in the engagement letter or per matter. No AI feature reaches a client's data until this is settled.

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
  status: partial
  slices: magnus
  adrs: ADR-0109
  spec: docs/specs/2026-08-06-magnus-design.md
  evidence: Magnus is that consumer and its backend is built (packages/magnus + apps/worker/src/magnus). It is off by default and has no interface; production enablement is gated on the consent decision and the ZDR procurement artifacts.

- id: ai.magnus
  name: Magnus — the conversational assistant
  scope: The assistant a firm member talks to — the conversation and turn record, two fail-closed consent gates, the queue-dispatched path to an answer through the one inference chokepoint, and the poll-and-push transport.
  status: partial
  slices: magnus
  adrs: ADR-0109, ADR-0111, ADR-0112, ADR-0113
  spec: docs/specs/2026-08-06-magnus-design.md
  evidence: packages/magnus + apps/worker/src/magnus + apps/worker/src/routes/magnus.ts; three per-firm tables in the 20260806T050000 migration. Backend only; the interface and token streaming are later slices.
  audience: public
  public-name: Magnus, the in-app assistant
  public-summary: Ask a question about your matters in plain language and get an answer, with nothing you ask retained by the model provider.

- id: ai.magnus.record
  name: Transcript as firm work product
  scope: Conversations and turns in per-firm D1 through the firm-scoped data-access layer — protected, deletable, archivable. Author-and-administrator visible, never client-visible, member-deletable with the deletion audited and registered in the erasure registry. Discoverable like email, so any search or collection surface reaching transcripts must carry an explicit include-or-exclude control.
  status: shipped
  evidence: magnus_conversation / magnus_turn / magnus_member_acknowledgement; PII-registry entries naming conversation-level deletion as the instrument for in-turn free text. The include-or-exclude control belongs to the discovery surface and is not built here; nothing exposes transcripts to a cross-record search today.

- id: ai.magnus.consent
  name: Two fail-closed consent gates
  scope: The firm's general AI-processing setting plus a feature-specific one, both default closed, read in one resolver, re-read by the consumer before the model call so a gate closing stops queued work.
  status: shipped
  evidence: apps/worker/src/magnus/consent.ts; magnus.enabled and inference.aiProcessingEligibility both default false; every route refuses by a named problem type.

- id: ai.magnus.port-reuse
  name: One model port, one additive operation
  scope: No second model port — the assistant consumes the shipped InferencePort and adds generateConversation, with a platform-vocabulary role set and a structurally separate system prompt.
  status: shipped
  adrs: ADR-0111
  evidence: packages/inference/src/port.ts + gateway.ts; the no-second-port source scan in packages/magnus/test/one-model-port.test.ts.

- id: ai.magnus.stub-adapter
  name: Deterministic stub InferencePort
  scope: A complete, network-free implementation of the port that every AI feature inherits; the composition root resolves to it whenever the binding or the enabling configuration is absent.
  status: shipped
  evidence: packages/inference/src/stub.ts; apps/worker/src/magnus/inference-port-binding.ts (absence resolves to the stub, the resolveScanPort shape).

- id: ai.magnus.streaming
  name: Token streaming
  scope: Delta frames on the push-progress protocol, a protocol version bump, and partial-content semantics for a stream that dies mid-answer.
  status: not-started
  evidence: Deliberately deferred; the record, gates, metering, audit, ceiling, and socket lifecycle are already shaped so adding it changes the consumer and the frame set only.

- id: ai.magnus.interface
  name: Assistant interface
  scope: The in-app chat surface, the firm-administrator enablement screen, and the member disclosure.
  status: not-started
  evidence: No surface in apps/web; gated on the design-system chat surface. The backend is off by default and UI-less.

- id: ai.magnus.context
  name: Explicit per-conversation context grants
  scope: What the assistant can see beyond what the member typed. The shape is settled — the member attaches a named document or matter and can see exactly what was attached; implicit firm-wide retrieval is not on this path and would need a consent decision of its own.
  status: not-started
  evidence: The seam is named and deliberately empty in slice 1 — nothing reads a document, matter, calendar, or directory entry today. The grant shape is the ratified answer for the next slice, not a proposal.

- id: ai.magnus.actions
  name: Tools and actions
  scope: Propose-and-approve only, where a tool proposes, a member approves, and the approval is the audited act.
  status: deferred
  evidence: A position rather than a deferral for now — the assistant answers and its answer is text no other subsystem reads. Requires an explicit owner decision.

- id: ai.consumer-seams
  name: Downstream consumer seams
  scope: Document automation generation, discovery semantic search / RAG over Vectorize, and search query expansion referencing the inference chokepoint.
  status: not-started
  evidence: Named seams only; no Vectorize index or semantic-search code consuming packages/inference.
