---
slug: magnus-answers-through-the-gateway-by-deploy-configuration
status: Accepted
area: AI / Inference
date: 2026-11-14
summary: "The deploy switch that lets Magnus reach a model, MAGNUS_INFERENCE_ADAPTER, is set to gateway in the committed wrangler.jsonc, and the stub is chosen only by name in .dev.vars for the local run and the test pool. Any other value selects no port, and the question is settled as unanswered with the misconfiguration reported, instead of answered by the stub. The owner chose this on 2026-11-14 after production answered every question with the stub."
---

**Magnus answers through the gateway by deploy configuration, and never by stub in a deployment.**

**Context:** The switch was absent from the deploy configuration by design, so that turning the assistant on was a deliberate act outside the code, and its absence selected the deterministic stub. The owner was using Magnus in production and every answer read "[stub inference] ...". A value set in the dashboard does not fix that durably, because each deploy from `main` replaces the Worker's variables with the committed ones.

**Decision.** The owner chose on 2026-11-14 to turn real answers on in code. `apps/api-worker/wrangler.jsonc` sets `MAGNUS_INFERENCE_ADAPTER` to `gateway`, and `.dev.vars` sets `stub`. `resolveMagnusInferencePort` returns a port only for those two exact values. For anything else the consumer settles the question as `model-unavailable` and reports the misconfiguration through the standard pipeline.

**Consequences.** Each firm still sends nothing until its own two consent settings are open, so what the switch changes is only whether a firm that opened them gets real answers. The gateway `magna-carta-inference` must exist with the models' provider reachable, and its dashboard settings (section 17 of the deploy runbook) stay the operator's responsibility. This replaces the part of ADR-0451 that described the switch as absent by default.
