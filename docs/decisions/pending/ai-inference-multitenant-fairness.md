---
slug: ai-inference-multitenant-fairness
status: Accepted
date: 2026-06-19
area: AI / Inference
summary: "Multi-tenant fairness and availability: one gateway per environment, off-hot-path Queue dispatch required, a single firm-scoped spend rule, account-level credit alarm, a named BYOK/Enterprise scaling switch point, and the `firmRateGate` per-firm back-pressure seam built now with the token-bucket machinery deferred until measured."
---

**Multi-tenant fairness and availability: one gateway per environment, off-hot-path Queue dispatch required, a single firm-scoped spend rule, account-level credit alarm, a named BYOK/Enterprise scaling switch point, and the `firmRateGate` per-firm back-pressure seam built now with the token-bucket machinery deferred until measured.**

**Context:** Gateway-per-firm is foreclosed by the 20-gateways-per-account cap (paid plan), so all firms share one gateway and thus the 200 req/60s Unified-Billing per-gateway rate cap and an account-wide credit pool (noisy-neighbour / denial-of-budget risk). A single firm spending the shared gateway budget starves all others synchronously on the request path. Per-firm spend-limit rules are foreclosed by the 20-rule-per-gateway cap.

**Decision:** (1) Off-hot-path Queue dispatch is a hard requirement — framed for per-firm back-pressure and fairness, not merely performance: inference calls dispatch through a Queue so a single firm cannot exhaust the gateway cap or the credit pool synchronously. (2) A single firm-scoped spend rule keyed to the `firm_id` metadata dimension (not one rule per firm) is the real-time per-firm guardrail. (3) An account-level credit alarm fires below exhaustion. (4) Named scaling switch point: when firm count grows, either per-firm BYOK (rate-exempt) or an Enterprise rate lift is the designed-out path — the decision point is named now so it is not discovered under load. (5) The `firmRateGate(firm_id)` hook is built as a pass-through no-op at launch, sited between Queue dequeue and `env.AI.run` — a per-firm limiter (a Durable Object per firm or a token bucket behind that hook) drops in without touching `InferencePort` or any call site; only the hook body changes. The per-firm token-bucket machinery is deferred until load is measured (golden rule 10).

**Consequences:** the fairness seam is built before it is needed; the gateway cap never becomes a synchronous firm-blocking incident; the BYOK switch point is a documented config change, not a code change. Builds on **ADR-ai-inference-tenant-isolation** (tenant-isolation, derived `firm_id` metadata), **ADR-0039** (compute placement, off-hot-path), **ADR-0083** (measure before machinery). Spec: [`docs/specs/2026-06-17-ai-inference-foundation-design.md`](../specs/2026-06-17-ai-inference-foundation-design.md).
