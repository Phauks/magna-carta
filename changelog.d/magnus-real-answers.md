---
category: Fixed
audience: public
---

**Magnus's model switch is in the deploy configuration.** `MAGNUS_INFERENCE_ADAPTER` is `gateway` in `apps/api-worker/wrangler.jsonc` and `stub` in `.dev.vars`; `resolveMagnusInferencePort` returns no port for any other value, and the consumer settles such a question as `model-unavailable` and reports it, instead of answering with the stub. Decision: `docs/decisions/pending/magnus-answers-through-the-gateway-by-deploy-configuration.md`.

## Public

**Magnus gives real answers.** Production had been answering every question with test text ("[stub inference] ..."), because the switch that connects Magnus to its model was missing from the deploy configuration. The switch is now part of every deploy, and a deployment without it says the question was not answered instead of giving made-up text.
