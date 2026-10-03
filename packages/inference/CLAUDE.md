# @magna-carta/inference — local notes

The single credential-less chokepoint every AI feature reaches a model through. Pure package — no D1, no
Hono, no `env` in the contract surface; the implementation receives the authenticated `AI` binding and
the firm-scoped read result as injected parameters.

- `InferencePort` (`src/port.ts`) names four operation families: text generation (buffered / streaming /
  durable Workflow-invocable), buffered generation over a multi-turn CONVERSATION, the
  platform-FIXED embedding op, and the platform-FIXED speech-to-text op (`transcribe`). The reasoning
  model id is an explicit per-call parameter (read per call site through the firm-scoped data-access
  layer), never on a connection or context. The embedding and transcription ops take NO
  firm-selectable model argument — per-firm variation is unrepresentable in the signature (an
  embedding swap would invalidate the Vectorize index; a transcript's fidelity is a property of the
  record, not a firm preference).
- The catalog (`src/catalog.ts`) is the curated source of truth: every entry carries `zdrEligible` /
  `noTrainingEligible` / `verifiedOn` and a pinned `snapshotId`. Validated at module load — a malformed
  entry, or a non-ZDR reasoning entry, fails loud at import. `claude-fable-5` is excluded (it mandates
  retention; non-ZDR). `PLATFORM_EMBEDDING_MODEL_ID` is the one place to confirm the embedding model
  against the live Vectorize index version before merge.
- **A model id is a perishable fact, and this package is where that is admitted.** Providers ship
  successors and retire predecessors on their own schedule and tell this repository nothing, so every
  entry carries **two** verification dates and the provider's own published lifecycle facts:
  `verifiedOn` (the confidentiality facts — ZDR and no-training) and `availabilityVerifiedOn` (the
  lifecycle facts — still published, still active, retirement date). They are separate on purpose: they
  come from different provider pages and go stale independently, and one date would let the cheap
  lifecycle check silently refresh the confidentiality claim nobody re-read. `retirementNotBefore` and
  `supersededBy` record what the provider publishes. **Nothing resolves a model through `supersededBy`**
  — a successor is not in the catalog, so it has no verified facts, and moving onto it is a decision
  rather than a derivation.
- **`snapshotId` is the provider's published pin, verbatim, and `snapshotForm` says which form that is.**
  The value is written into every per-request provenance record — the record that answers which exact
  model produced an output, on transcripts that are firm work product and discoverable — so a
  plausible-looking wrong id is worse than an empty field: absence prompts a question, a fabricated
  snapshot answers it falsely. It stays REQUIRED even for models the provider names without a date,
  because on its newer models the undated id **is** the pinned snapshot rather than a pointer to one;
  recording absence there would assert no snapshot exists when one does. `snapshotForm` is
  `provider-dated` (the undated name is an alias, so the date is the pin), `provider-dateless`
  (`snapshotId` equals `referenceId`), or `platform-composed` (the embedding entry alone, binding the
  model to its index generation). **It is recorded, not derived, and that is the point** — whether a
  provider issues a dated id for a given model exists nowhere in this repository, so without the
  declaration a fabricated suffix is indistinguishable from a real one. `catalogEntrySchema` refuses an
  id that contradicts its form **at module load, not in the freshness pass**: such an id is wrong when
  written rather than wrong as of a date, so it must fail at import for every consumer instead of waiting
  for a gate to run. What genuinely decays — whether the recorded form is still what the provider
  publishes — is read off the same page as the lifecycle facts, dated by `availabilityVerifiedOn`, and
  reported with them.
- **Reasoning tiers are the evergreen name; the catalog says who occupies one.** `ReasoningTier`
  (`most-capable` / `balanced`) is what configuration and the firm default refer to; which curated model
  fills a tier is data. The provider publishes no evergreen alias of its own — every id it publishes is
  a pinned snapshot — so an evergreen name exists only because the platform maintains one. Module-load
  validation gives every tier exactly one occupant, which is what makes `reasoningModelForTier` total.
- `src/reasoning-tier.ts` lets deploy configuration re-point a tier without a build. **It can only ever
  select an entry already in the catalog**, and that limit is the design rather than a gap: a deploy-time
  string cannot carry a human's finding that a model is ZDR-eligible, so adding a model still costs a
  code change and a re-verification while choosing among verified models does not. Every rejection falls
  back to the catalog occupant and is reported, never swallowed.
- `src/model-pin-freshness.ts` is the pass that makes rot **noticed**. Pure — `today` is a parameter, not
  a clock read — and it reads only dates a calendar can settle. Two severities: `expired` (past a
  published retirement, or unread past the hard interval) fails the gate in
  `test/fitness-model-pin-rot.test.ts`; `due` (a successor exists, a retirement approaches, a fact is
  overdue for re-reading) is reported and does not, because a decision that belongs to a person should
  not present itself as a broken build. **What it cannot see:** a successor released since the last time
  somebody looked. Supersession is not derivable from in-repo data, and a gate-time call to the
  provider's models endpoint would need network and credentials in CI — so the gap is _bounded_ by the
  re-read interval rather than closed.
- **The embedding pin is `open`, and the gate keeps that honest.** Every stored vector is a function of
  the model that produced it, so the pin is free to move only while no index exists and costs a full
  re-embedding of every corpus afterwards. No mechanism makes a frozen pin cheaply changeable and none
  here pretends to. What the fitness scan does is refuse to let the window close by accident: while
  `pinState` reads `open`, no source file may reach a vector index (comments stripped first, so the
  deferred semantic-search module's descriptions of the unwritten adapter do not count). The first code
  that writes a vector fails that test, and clearing it means setting `pinState` to `frozen` — a line
  whose only honest author is whoever has actually decided which model the index is built with.
- The setting (`src/settings.ts`) stores the firm's primary reasoning model in the per-firm `setting`
  table via a `FirmSettingDefinition`; the schema is a refinement over the ZDR-eligible reasoning subset,
  so an off-catalog/non-ZDR id is rejected at the write path. Reads stay total (default on missing/invalid).
  The **default is derived from the platform tier**, never written here as a literal — so moving the
  platform forward never edits this file. A firm that has explicitly chosen keeps its choice: that
  selection is a decision about its own confidential content, and silently re-pointing it because the
  platform default moved would override that decision without telling anyone. **The firm chooses on
  its AI settings screen** (`apps/api-worker/src/routes/firm-ai-settings.ts`), from `reasoningEntries()`;
  "the platform's current model" is the ABSENCE of a row (the route deletes it), so the two postures
  never convert into each other by a dropdown press. **No runtime source lists models**: neither the
  Workers AI binding nor the AI Gateway REST API enumerates them, and a list that did could not carry
  the verified facts, so the roster is this catalog and the screen states `CATALOG_VERSION` and
  `CATALOG_EFFECTIVE_DATE` beside it.
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
  are the shipped ones, unchanged. An empty message array is refused before dispatch. The translation
  knows two providers: a third-party model takes the instruction on its own top-level field, and a model
  hosted on Cloudflare (`isOnCloudflareModel` — the `@cf/` prefix the binding itself routes on) takes it
  as the first message in the `system` role its chat schema defines, still written from the port's
  `systemPrompt` and never from a member message. An optional `maximumOutputTokens` is sent as
  `max_tokens` on both, because Workers AI answers 256 tokens unless told otherwise.
- **Every reasoning entry states its context window** (`contextWindowTokens`, and `maximumOutputTokens`
  where the provider publishes one), read off the provider's own model page and cited beside the entry;
  module-load validation refuses a reasoning entry without one, because a caller that sends a whole
  document (a meeting's transcript) has to know when to cut it. **Exactly one reasoning entry is hosted
  on Cloudflare** (`onCloudflareReasoningEntry`, today `@cf/meta/llama-4-scout-17b-16e-instruct`), with
  no tier: it is what a feature that must not send content to a third party unbidden runs on by default
  (the meeting summary), and a firm may select it like any other entry.
- `transcribe` (`src/port.ts`, implemented in `src/gateway.ts`) closes over the catalog's single
  `transcription` entry (`PLATFORM_TRANSCRIPTION_MODEL_ID`, `@cf/openai/whisper-large-v3-turbo` on
  Workers AI; module-load validation requires exactly one, as for embedding). It takes a complete WAV
  (mono, 16-bit PCM, 16 kHz), a firm id, an optional BCP-47 language hint, and an optional
  `initialPrompt` (the previous chunk's tail), and returns text, the reported language, segment
  timings in seconds within THAT audio, `audioSeconds` (what transcription is metered on), and the
  model id. The request and response field names are Cloudflare's published schemas, cited by URL in
  `gateway.ts` beside the adapter — re-read them there, not from memory. Three pins with reasons:
  `task: "transcribe"` (never `translate`; a record says what was said in the language it was said),
  `vad_filter: false` (the caller sends speech spans, and segment offsets must be offsets into the
  audio sent), and only the BCP-47 primary subtag is sent as `language` (the model takes bare codes).
  It sends the same `gatewayOptions()` with `slot: "transcription"`, maps a thrown binding error to the
  same retryable `upstream` problem, and refuses empty audio before dispatch as `validation`. Missing
  segment timings yield an empty list, never an invented span; `audioSeconds` falls back from the
  provider's `transcription_info.duration` to the WAV header (`src/wav-duration.ts`).
- `createStubInferencePort()` (`src/stub.ts`) is a COMPLETE, deterministic implementation of the port
  that reaches no provider: no network, no binding, no randomness, no clock, fixed snapshot id
  `"stub"`, deterministic non-zero usage. It is not a test double for one feature — every AI feature
  the platform builds gets it, and every composition root resolves to it when its binding or its
  enabling configuration is absent (the `resolveScanPort` / `resolveEnginePort` /
  `resolveFlagEvaluator` shape). A misconfigured environment therefore produces obviously-fake
  answers, never real spend on a path nobody intended. The ZDR guard is deliberately NOT applied in
  the stub: it reaches no provider, so refusing there would test nothing and would hide a real failure
  of the gateway port's own fail-closed check. Its `transcribe` returns one segment spanning the
  WAV's playing time, text `[stub inference] <n> bytes of audio`, the language hint echoed (or null),
  and model id `"stub"`, so a consumer test can predict the transcript from the bytes it sent.

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
