---
slug: ai-inference-foundation-placement
status: Accepted
date: 2026-06-19
area: AI / Inference
summary: "`@magna-carta/inference` is a standalone pure package, not a registered integration adapter — the integration framework is reused at the type level only (`Dispatch` sum + problem taxonomy), and the BYOK credentialed adapter is a named later slice."
---

**`@magna-carta/inference` is a standalone pure package, not a registered integration adapter — the integration framework is reused at the type level only (`Dispatch` sum + problem taxonomy), and the BYOK credentialed adapter is a named later slice.**

**Context:** the integration port system (ADR-0091/0092) provides typed ports and adapters for outward-reaching integrations; the question was whether inference should register as one. The model slot (`InferencePort` operation parameter) and the authenticated `AI` binding (no per-firm credential at launch) do not fit the `AdapterContext`/`IntegrationConnection` seam — neither has a non-credential config seam — and the framework's buffered `HttpClient`/`Dispatch<T>` cannot carry streaming or durable runs. `@magna-carta/government-links` is the established precedent: a standalone library that reuses integration types without touching the registry.

**Decision:** `@magna-carta/inference` is a pure package (no D1, no Hono, no `env` in the contract surface) that imports only `import type { Dispatch }` + value constructors `ok`/`adapterError` + the problem taxonomy from `@magna-carta/integrations` — zero registry/connection/credential machinery. The reasoning model id is an explicit operation parameter, not a connection property. `InferencePort` carries the confidentiality/tenancy guarantees as provider-neutral concepts; the interface never names gateway specifics. Gateway lock-in is recorded as an accepted tradeoff: model-swap is cheap (the OpenAI-compatible endpoint); gateway-exit is not. The BYOK credentialed adapter — the one place the framework's `ConnectionStore`/`CredentialStore`/`needs_reauth` lifecycle actually applies — is a named deferred seam, built when a firm attestation requires it or the shared rate cap is measured-binding.

**Considered & rejected:** a registered `Adapter<InferencePort>` now (the framework's transport cannot stream; the model slot is an operation parameter, not a connection property; credential-less launch does not need the registry lifecycle).

**Consequences:** `@magna-carta/inference` builds now with no cross-branch dependencies on unmerged integration-platform work; the worker is the composition root (reads the firm's model through the firm-scoped data-access layer, constructs the port, dispatches via Queue); `createIntegrationRegistry().register(...)` is never called for inference at launch. Builds on **ADR-0091/0092** (integration framework, type-level reuse only), **ADR-0003** (tenancy), **ADR-0039** (compute placement). Spec: [`docs/specs/2026-06-17-ai-inference-foundation-design.md`](../specs/2026-06-17-ai-inference-foundation-design.md).
