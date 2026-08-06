# @magna-carta/inference — local notes

The single credential-less chokepoint every AI feature reaches a model through. Pure package — no D1, no
Hono, no `env` in the contract surface; the implementation receives the authenticated `AI` binding and
the firm-scoped read result as injected parameters.

- `InferencePort` (`src/port.ts`) names three operation families: text generation (buffered / streaming /
  durable Workflow-invocable), buffered generation over a multi-turn CONVERSATION, and the
  platform-FIXED embedding op. The reasoning model id is an explicit
  per-call parameter (read per call site through the firm-scoped data-access layer), never on a
  connection or context. The embedding op takes NO firm-selectable model argument — per-firm embedding
  variation is unrepresentable in the signature (a swap would invalidate the Vectorize index).
- The catalog (`src/catalog.ts`) is the curated source of truth: every entry carries `zdrEligible` /
  `noTrainingEligible` / `verifiedOn` and a pinned `snapshotId`. Validated at module load — a malformed
  entry, or a non-ZDR reasoning entry, fails loud at import. `claude-fable-5` is excluded (it mandates
  retention; non-ZDR). `PLATFORM_EMBEDDING_MODEL_ID` is the one place to confirm the embedding model
  against the live Vectorize index version before merge.
- The setting (`src/settings.ts`) stores the firm's primary reasoning model in the per-firm `setting`
  table via a `FirmSettingDefinition`; the schema is a refinement over the ZDR-eligible reasoning subset,
  so an off-catalog/non-ZDR id is rejected at the write path. Reads stay total (default on missing/invalid).
- The implementation (`src/gateway.ts`) reaches the model only through the authenticated `AI` binding
  (`env.AI.run(model, input, { gateway })`). The control plane is the binding's documented `gateway`
  options object — `skipCache: true` (caching off), `collectLog: false` (logging off — the binding's
  toggle is all-or-nothing, no payload-only option, so no prompt/response body is logged), and derived
  firm metadata (`firm_id` opaque, <=5 keys, no model tag). NOT `cf-aig-*` string headers (the REST
  surface the binding does not read). The fail-closed ZDR guard runs before dispatch and returns a
  NON-retryable (`validation`) problem on a miss. `problem.detail` is caller-safe text only — never a
  spliced upstream body. Authoritative token usage is read from the RESPONSE usage object, never the logs.

- `generateConversation` (`src/port.ts`, implemented in `src/gateway.ts`) takes a `ConversationInput`:
  a message array whose roles are OUR vocabulary (`member` | `assistant`, never a vendor's), plus a
  SEPARATE required `systemPrompt` field. The separation is structural, not stylistic: keeping the
  platform-authored instruction out of the message array means a member can never occupy the system
  role by typing, and a reviewer can see at a glance which bytes are platform text and which are firm
  content. `GenerateResult` is unchanged, so metering, provenance, and the `Dispatch` error taxonomy
  all apply with no second shape. The adapter's only new code is the provider request-body
  translation; the ZDR guard, `gatewayOptions()`, `extractUsage`, `responseText`, and `gatewayFailure`
  are the shipped ones, unchanged. An empty message array is refused before dispatch.
- `createStubInferencePort()` (`src/stub.ts`) is a COMPLETE, deterministic implementation of the port
  that reaches no provider: no network, no binding, no randomness, no clock, fixed snapshot id
  `"stub"`, deterministic non-zero usage. It is not a test double for one feature — every AI feature
  the platform builds gets it, and every composition root resolves to it when its binding or its
  enabling configuration is absent (the `resolveScanPort` / `resolveEnginePort` /
  `resolveFlagEvaluator` shape). A misconfigured environment therefore produces obviously-fake
  answers, never real spend on a path nobody intended. The ZDR guard is deliberately NOT applied in
  the stub: it reaches no provider, so refusing there would test nothing and would hide a real failure
  of the gateway port's own fail-closed check.

**Gateway Guardrails must never be enabled on this gateway.** They intercept and evaluate both
prompts and responses and produce logs of user prompts and model responses — a retention surface
introduced through a dashboard toggle, entirely outside the code that makes the confidentiality
posture fail closed. They also solve a problem this product does not have: guardrails moderate for
harmful content, while a legal assistant's failure mode is being confidently wrong, which no
hazard-category classifier detects. A fitness function cannot prevent a dashboard toggle, so the
prohibition is recorded here and in the deploy runbook's gateway-configuration step
([`docs/conventions/operations.md`](../../docs/conventions/operations.md)).

Reuse of `@magna-carta/integrations` is type-level only: the `Dispatch` sum and the problem taxonomy.
No registry / connection / credential machinery is touched.

**Deferred seam (the BYOK credentialed adapter):** a later slice registers a genuinely-credentialed
framework adapter (the one place the framework's connection/credential lifecycle applies) for firms that
require their own provider key — built when a firm attestation requires it or the shared rate cap is
measured-binding. Not built here.
