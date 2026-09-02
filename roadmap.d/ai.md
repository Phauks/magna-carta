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
  evidence: packages/inference/src (port.ts, catalog.ts, gateway.ts, settings.ts) + apps/api-worker/src/inference; status.d marks built done, tests todo.

- id: ai.inference.port
  name: InferencePort operations
  scope: Streaming and durable/Workflow-invocable text generation plus a platform-fixed embedding operation; reasoning model an explicit per-call parameter, embedding model pinned to the Vectorize index.
  status: shipped
  surface: internal
  evidence: packages/inference/src/port.ts; PLATFORM_EMBEDDING_MODEL_ID pinned in catalog.ts.

- id: ai.inference.embedding-pin-window
  name: Embedding pin held open until the first index
  scope: The embedding model is changeable only while no vector index exists, because every stored vector is a function of the model that produced it. The catalog records that state and a fitness scan refuses to let the window close by accident — while the pin reads open, no source file may reach a vector index.
  status: shipped
  surface: internal
  evidence: packages/inference/src/catalog.ts (pinState on the embedding entry) and the source scan in packages/inference/test/fitness-model-pin-rot.test.ts; apps/api-worker/src/search/semantic-search.ts is still engine-not-implemented and no wrangler configuration declares a Vectorize binding.
  awaiting-owner: Which embedding model the first index is built with. The pin is unchangeable once vectors exist, so this is decided before the first one is written, not after.

- id: ai.inference.model-catalog
  name: Curated ZDR-only model catalog
  scope: In-repo data table of allowed models; every reasoning entry zdrEligible, zod-validated at module load; non-ZDR models unrepresentable. Each entry also records the provider's published lifecycle facts (retirement date, successor) under a verification date separate from the confidentiality one, and the FORM the provider publishes its pinned snapshot in, so a snapshot id that contradicts its own form fails at import rather than reaching a provenance record.
  status: shipped
  surface: internal
  evidence: packages/inference/src/catalog.ts with module-load validation, including the snapshotForm refinements; packages/inference/test/catalog.test.ts and packages/inference/test/fitness-catalog.test.ts pin the recorded snapshot ids to the provider's published values.

- id: ai.inference.reasoning-tier
  name: Evergreen reasoning tier
  scope: A platform-maintained tier name (most-capable / balanced) that the firm default and deploy configuration resolve through, so tracking model advancement is a data edit rather than a code change. An override can only ever select a model already curated in the catalog, so non-ZDR models stay unrepresentable.
  status: shipped
  surface: internal
  evidence: packages/inference/src/catalog.ts (tier occupancy validated at module load) and packages/inference/src/reasoning-tier.ts; packages/inference/test/reasoning-tier.test.ts.
  notes: Which model occupies each tier is unchanged from what the platform already ran; moving a tier onto a published successor is an open owner decision.

- id: ai.inference.pin-freshness
  name: Model-pin staleness detection
  scope: A pure pass over the catalog that reports a pin past its published retirement, approaching one, superseded by a newer generation, or overdue for re-verification. Expiry fails the gate; the rest is reported. Cannot detect a successor released since the last check — that gap is bounded by the re-read interval, not closed.
  status: shipped
  surface: internal
  evidence: packages/inference/src/model-pin-freshness.ts; packages/inference/test/model-pin-freshness.test.ts and packages/inference/test/fitness-model-pin-rot.test.ts.

- id: ai.inference.firm-model-selection
  name: Per-firm reasoning-model selection
  scope: Firm's primary reasoning model in the per-firm setting table; schema refined over the ZDR-eligible subset; total reads with safe default derived from the platform tier rather than a literal model id.
  status: shipped
  surface: awaiting-screen
  evidence: packages/inference/src/settings.ts (inference-owned FirmSettingDefinition).

- id: ai.inference.confidentiality
  name: Confidentiality control plane
  scope: Gateway-level ZDR, collectLog false and skipCache true pinned per request, fail-closed pre-dispatch ZDR guard that rejects rather than downgrades.
  status: shipped
  surface: internal
  adrs: ADR-0110
  evidence: packages/inference/src/gateway.ts.
  notes: Cloudflare/Anthropic ZDR procurement artifacts gate the first real AI feature, not this layer.

- id: ai.inference.tenant-isolation
  name: Tenant isolation & metering
  scope: Firm metadata derived server-side (never caller-supplied); authoritative per-request token usage written through the firm-scoped data-access layer as the reconcilable metering record.
  status: shipped
  surface: internal
  adrs: ADR-0113
  evidence: Per-firm token meter feeding the firm-usage diagnostics surface (apps/api-worker/src/routes/firm-usage.ts).

- id: ai.inference.fairness
  name: Multi-tenant fairness
  scope: One shared gateway per environment; queue-dispatched inference off the hot path; firm-scoped spend rule and account credit alarm as real-time guardrails.
  status: partial
  surface: internal
  adrs: ADR-0112
  evidence: Queue dispatch built (apps/api-worker/src/inference); spend rules/alarms are gateway dashboard configuration, not verifiable in-repo.

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
  surface: internal
  evidence: packages/ai-detection (LikelihoodBand core).

- id: ai.text-detection.pangram-adapter
  name: Pangram vendor adapter
  scope: Platform-managed adapter (one platform key, credential none), per-firm consent setting enforced at the chokepoint, paste-text endpoint, per-firm usage metering.
  status: shipped
  surface: awaiting-screen
  evidence: POST /api/v1/ai-detection/detect (apps/api-worker/src/routes/ai-detection.ts) over packages/ai-detection/src/adapters, with the manifest, the per-firm consent setting (consent.ts, settings.ts) and the ai_detection_usage metering table.

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
  surface: awaiting-screen
  slices: magnus
  adrs: ADR-0109
  spec: docs/specs/2026-08-06-magnus-design.md
  evidence: Magnus is that consumer and its backend is built (packages/magnus + apps/api-worker/src/magnus). It is off by default and has no interface; production enablement is gated on the consent decision and the ZDR procurement artifacts.

- id: ai.magnus
  name: Magnus — the conversational assistant
  scope: The assistant a firm member talks to — the conversation and turn record, two fail-closed consent gates, the queue-dispatched path to an answer through the one inference chokepoint, and the poll-and-push transport.
  status: partial
  slices: magnus
  adrs: ADR-0109, ADR-0111, ADR-0112, ADR-0113
  spec: docs/specs/2026-08-06-magnus-design.md
  evidence: packages/magnus + apps/api-worker/src/magnus + apps/api-worker/src/routes/magnus.ts; three per-firm tables in the 20260806T050000 migration. Backend only; the interface and token streaming are later slices.
  audience: public
  public-name: Magnus, the in-app assistant
  public-summary: Ask a question about your matters in plain language and get an answer, with nothing you ask retained by the model provider.

- id: ai.magnus.record
  name: Transcript as firm work product
  scope: Conversations and turns in per-firm D1 through the firm-scoped data-access layer — protected, deletable, archivable. Author-and-administrator visible, never client-visible, member-deletable with the deletion audited and registered in the erasure registry. Discoverable like email, so any search or collection surface reaching transcripts must carry an explicit include-or-exclude control.
  status: shipped
  surface: internal
  evidence: magnus_conversation / magnus_turn / magnus_member_acknowledgement; PII-registry entries naming conversation-level deletion as the instrument for in-turn free text. The include-or-exclude control belongs to the discovery surface and is not built here; nothing exposes transcripts to a cross-record search today.

- id: ai.magnus.consent
  name: Two fail-closed consent gates
  scope: The firm's general AI-processing setting plus a feature-specific one, both default closed, read in one resolver, re-read by the consumer before the model call so a gate closing stops queued work.
  status: shipped
  surface: internal
  evidence: apps/api-worker/src/magnus/consent.ts; magnus.enabled and inference.aiProcessingEligibility both default false; every route refuses by a named problem type.

- id: ai.magnus.port-reuse
  name: One model port, one additive operation
  scope: No second model port — the assistant consumes the shipped InferencePort and adds generateConversation, with a platform-vocabulary role set and a structurally separate system prompt.
  status: shipped
  surface: internal
  adrs: ADR-0111
  evidence: packages/inference/src/port.ts + gateway.ts; the no-second-port source scan in packages/magnus/test/one-model-port.test.ts.

- id: ai.magnus.stub-adapter
  name: Deterministic stub InferencePort
  scope: A complete, network-free implementation of the port that every AI feature inherits; the composition root resolves to it whenever the binding or the enabling configuration is absent.
  status: shipped
  surface: internal
  evidence: packages/inference/src/stub.ts; apps/api-worker/src/magnus/inference-port-binding.ts (absence resolves to the stub, the resolveScanPort shape).

- id: ai.magnus.streaming
  name: Token streaming
  scope: Delta frames on the push-progress protocol, a protocol version bump, and partial-content semantics for a stream that dies mid-answer.
  status: not-started
  evidence: Deliberately deferred; the record, gates, metering, audit, ceiling, and socket lifecycle are already shaped so adding it changes the consumer and the frame set only.

- id: ai.magnus.interface
  name: Assistant interface
  scope: The in-app chat surface, the firm-administrator enablement screen, and the member disclosure.
  status: not-started
  evidence: No surface in apps/web; gated on the design-system chat surface. The backend is off by default and UI-less. Two places are reserved for it and both are stubs: the always-reachable sidebar destination (apps/web/src/lib/navigation/destinations.ts) and a "magnus" slug at stage soon in the matter section registry (apps/web/src/lib/matters/sections.ts), which is where a conversation already scoped to one matter will live.

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

- id: ai.natural-language-search
  name: Natural-language document search
  scope: A retrieval-only question-and-answer search over a firm's own committed working documents, on a Cloudflare AI Search instance per firm fed by a derived text feed. Passages with their citations, never composed prose; matter-scoped, with the metadata filter treated as a recall optimization and read-time re-authorization through the firm-scoped data-access layer as the boundary.
  status: partial
  slices: natural-language-document-search
  adrs: ADR-0003, ADR-0110, ADR-0111, ADR-0255
  spec: docs/specs/2026-08-06-ai-search-integration-design.md
  evidence: packages/search/src/natural-language-enablement.ts is the one write path (the gate, the disclosure acknowledgement, the matter exclusion); packages/search/src/natural-language-feed.ts and apps/api-worker/src/search/natural-language-feed-writer.ts are the feed; apps/api-worker/src/search/natural-language-lifecycle.ts is provisioning, teardown and deletion. Three per-firm tables and one control-plane table in packages/database/drizzle/per-firm/20260816T152756_natural-language-search.sql and packages/database/drizzle/control-plane/20260816T152908_natural-language-search-instance.sql. Off for every firm and no instance exists — apps/api-worker/test/natural-language-gates-closed.test.ts asserts a firm with no setting row produces no feed object, no instance, and an instance-not-provisioned outcome from the production resolver. The retrieval adapter and route are deliberately unbuilt.
  audience: public
  public-name: Ask a question of a matter's documents
  public-summary: Ask an ordinary question about a matter and get back the passages of your own documents that answer it, each with its source.
  notes: The route is blocked on the ethical-wall filter experiment's E1 and E2 — the protocol is built and sensitivity-proven, and the live run against a fenced account has not been executed.

- id: ai.natural-language-search.consent
  name: Consent gate and versioned disclosure
  scope: A firm setting defaulting off, openable only against a current-version firm-level disclosure acknowledgement recorded with its acceptor, plus a per-matter exclusion that deletes the matter's existing feed objects rather than only stopping new ones.
  status: shipped
  surface: awaiting-screen
  evidence: packages/search/src/natural-language-settings.ts, packages/search/src/natural-language-disclosure.ts and packages/search/src/natural-language-enablement.ts; the ai_search_disclosure_acknowledgement table. The write path returns a typed refusal for an absent or stale acknowledgement and packages/search/test/natural-language-enablement.test.ts drives both. Enablement gates on the disclosure alone, per the owner's override of the general-availability flag.

- id: ai.natural-language-search.feed
  name: The derived text feed and its catalog
  scope: The only thing that can reach the managed index — extracted text of committed file versions, written by the existing search index job as a second consumer of the extraction already computed there, catalogued per object so deletion is demonstrable and freshness computable.
  status: shipped
  surface: internal
  evidence: packages/search/src/natural-language-feed.ts + apps/api-worker/src/search/natural-language-feed-writer.ts; the ai_search_feed_object table. A fitness test asserts exactly one emitted object class and that no reserved class is reachable; a worker test asserts the extraction runs exactly once per version.

- id: ai.natural-language-search.lifecycle
  name: Instance lifecycle, deletion, and the meter
  scope: One instance per firm under a derived opaque name and a single versioned configuration constant; queue-dispatched provisioning and teardown; catalog-driven deletion reconciled against the bucket; a weekly keep-alive inside the inactivity-pause window; a usage meter keeping authoritative counts structurally apart from the one estimated figure.
  status: shipped
  surface: internal
  evidence: apps/api-worker/src/search/natural-language-lifecycle.ts, apps/api-worker/src/search/natural-language-keep-alive.ts and apps/api-worker/src/search/natural-language-binding.ts; packages/search/src/natural-language-instance.ts, packages/search/src/natural-language-provisioning.ts and packages/search/src/natural-language-instance-statements.ts; the control-plane ai_search_instance table and the per-firm ai_search_usage_meter. Managed storage is recorded as a named unmetered gap rather than estimated. Both bindings are declared and commented out in apps/api-worker/wrangler.jsonc.

- id: ai.natural-language-search.retrieval
  name: Matter-scoped retrieval and read-time re-authorization
  scope: The one query shape — a matter and an object class, both server-derived — with every returned pointer re-resolved through the firm-scoped data-access layer before any text is returned, a freshness envelope on every response, and dropped hits raised on the error pipeline but never counted to the caller.
  status: partial
  surface: awaiting-screen
  spec: docs/specs/2026-08-06-ai-search-integration-design.md
  evidence: The port, its typed outcomes and its not-configured default resolution are built (packages/search/src/natural-language-port.ts) and reached through apps/api-worker/src/search/natural-language-binding.ts; the adapter, the filter builder and the route are not. The construction protocol and its sensitivity proof are runnable in packages/search/test/natural-language-filter-wall/.
  notes: Blocked on observing the managed index's filter semantics against a real instance — a filter that fails open, or is accepted and silently ignored, cannot bear even the recall-optimization weight the design assigns it.

- id: ai.consumer-seams
  name: Downstream consumer seams
  scope: Document automation generation, discovery semantic search / RAG over Vectorize, and search query expansion referencing the inference chokepoint.
  status: not-started
  evidence: Named seams only; no Vectorize index or semantic-search code consuming packages/inference.
