# @magna-carta/inference — local notes

The single credential-less chokepoint every AI feature reaches a model through. Pure package — no D1, no
Hono, no `env` in the contract surface; the implementation receives the authenticated `AI` binding and
the firm-scoped read result as injected parameters.

- `InferencePort` (`src/port.ts`) names two operation families: text generation (buffered / streaming /
  durable Workflow-invocable) and the platform-FIXED embedding op. The reasoning model id is an explicit
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

Reuse of `@magna-carta/integrations` is type-level only: the `Dispatch` sum and the problem taxonomy.
No registry / connection / credential machinery is touched.

**Deferred seam (the BYOK credentialed adapter):** a later slice registers a genuinely-credentialed
framework adapter (the one place the framework's connection/credential lifecycle applies) for firms that
require their own provider key — built when a firm attestation requires it or the shared rate cap is
measured-binding. Not built here.
