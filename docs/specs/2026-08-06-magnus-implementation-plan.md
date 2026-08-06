# Magnus — the conversational assistant backend — implementation plan

> **For agentic workers:** implement task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
> Each build slice below is sized for one agent batch and leaves `main` shippable on its own.

**Goal:** Build the backend a firm member talks to — the conversation and turn record, the two
fail-closed consent gates, the queue-dispatched path from a submitted turn to a model answer through
the **existing** inference chokepoint, the poll-and-push transport, and the audit and cost records it
leaves behind. **No user interface in this slice.**

**Architecture:** A new pure domain package `@magna-carta/magnus` on the established
structure-versus-access seam (mirrors `@magna-carta/custodian`, `@magna-carta/conflicts`,
`@magna-carta/calendar`): pure TypeScript, no D1 binding, no Hono, no `env`, composing statements into
`composeEffectBatch` and returning typed results rather than throwing. Three new per-firm tables
(`magnus_conversation`, `magnus_turn`, `magnus_member_acknowledgement`), three new per-firm settings,
two new permissions, one new Durable Object, one new queue, and **one additive operation** on the
shipped `InferencePort`. Design spec:
[`docs/specs/2026-08-06-magnus-design.md`](2026-08-06-magnus-design.md).

**Tech stack:** TypeScript (ESM, ES2022), zod 4, Drizzle (schema types only; hand-written raw SQL for
any index or seed migration), Cloudflare D1 (per-firm), Durable Objects (hibernation WebSocket API),
Cloudflare Queues, Hono + `@hono/zod-openapi`, Vitest (+ `@cloudflare/vitest-pool-workers` for the
worker suite), `vp` for test/lint/format.

**Slice 1 is flag-free.** Every owner flag in the design's section 12 has a recommended default that
this plan implements. Nothing here waits on ADR-0109: both consent gates default closed and the default
adapter reaches no provider. **This plan builds the thing that is later switched on; it does not switch
it on.**

## Global constraints

Every task's requirements implicitly include this section.

- **Never build a second model port.** Magnus receives an `InferencePort`. No module outside
  `packages/inference/` references `env.AI`, constructs a gateway options object, or names a provider.
  A fitness test enforces it (task 6).
- **Both consent gates are read before anything is enqueued, and `magnus.enabled` is read again in the
  consumer before the model call.** Both default `false`. A gate that has closed since submission
  produces a `refused` turn, never a silent drop.
- **No turn content leaves the firm database except into the inference request.** Never into a log,
  never into audit metadata, never into a problem `detail`, never into a Durable Object's storage,
  never into a WebSocket frame other than the turn's own state.
- **Full names, no shorthand** (golden rule 12): identifier prefixes spelled out —
  `magnusConversation_`, `magnusTurn_`; "the firm-scoped data-access layer", never an abbreviation;
  `newIdentifier`, never `newId`; `acknowledgement`, never `ack`; `conversation`, never `convo`.
- **No process-artifact references in source, tests, or OpenAPI `description`s** (golden rule 13): no
  ADR numbers, no "spec", no "slice N" except a forward-looking "built in slice N" schedule note.
  Enforced by `pnpm lint:process-refs`.
- **All business data through the firm-scoped data-access layer** (golden rule 3): the route hands the
  package a firm-scoped database; nothing in the package holds a binding or crosses firms.
- **Every mutation composes an `audit_log` row** in the same atomic batch, metadata carrying
  identifiers and closed labels only.
- **Every mutating route is idempotency-keyed** through the chokepoint; the consumer carries its own
  dedup record in the same batch as the metering write.
- **No unbounded read.** The conversation window is capped by turn count and bytes; every list read is
  cursor-paginated with a `LIMIT`.
- **All UI through the design system** does not apply — there is no UI in this slice.
- **TDD:** write the failing test, watch it fail, implement the minimum, watch it pass, commit.
- **Migration ordinals, identifier-registry entries, and ADR numbers reconcile at merge** if a sibling
  slice lands first.

## Commands

- Package tests: `pnpm --filter @magna-carta/magnus test`
- Inference package tests: `pnpm --filter @magna-carta/inference test`
- Repo tests including the Miniflare worker suite: `pnpm test`
- Scoped gate (inner loop): `pnpm check:scoped` · full gate: `pnpm check`
- Process-reference lint: `pnpm lint:process-refs` · decision lint: `pnpm lint:decisions`
- Per-firm migrations: `pnpm --filter @magna-carta/database run generate-per-firm-migrations`, then
  `refresh-per-firm-snapshot` in the SAME commit as any hand-written migration
- OpenAPI snapshot: `pnpm --filter @magna-carta/worker run emit-openapi`
- Typed client: `pnpm run generate-client`
- Measurement baseline: `pnpm --filter @magna-carta/fixtures run measure`

---

# Build slice 1·1 — The record, the gates, and the port

The walking slice: a member of an enabled firm who has accepted the disclosure starts a conversation
and submits a turn; a stub-backed consumer answers it; the turn, its provenance, its tokens, and its
audit rows are all durable and correct. Nothing reaches a provider.

## Task 1 — Identifiers, permissions, settings, and the package scaffold

- [ ] Add `magnusConversation` and `magnusTurn` to `packages/identifiers/src/registry.ts` with a
      comment explaining what each is, and the matching branded types in `types.ts`. The
      acknowledgement table is keyed by `user_id` and needs no identifier of its own.
- [ ] Register two permissions: `magnus:converse` (use Magnus in this firm) and
      `magnus:readAllConversations` (read another member's conversation). Both `resource: "firm"`.
- [ ] Create `packages/magnus/` — `package.json`, `tsconfig.json`, `tsconfig.build.json`,
      `vitest.config.ts`, `CLAUDE.md` — matching `packages/conflicts/` exactly. No dependency on
      `@magna-carta/database`, Hono, or `@cloudflare/workers-types`.
- [ ] `packages/magnus/src/settings.ts` — three `FirmSettingDefinition`s:
      `magnus.enabled` (boolean, default `false`), `magnus.dailyTurnCeiling` (integer, default `500`,
      schema `z.number().int().min(0).max(100000)`), and `magnus.retainTranscripts` **is not built** —
      retention is not optional (design section 4.1).
- [ ] `packages/magnus/src/disclosure.ts` — `MAGNUS_DISCLOSURE_VERSION` as an exported integer
      constant, starting at `1`, with a comment stating that it is bumped whenever what Magnus can see
      or do changes, which re-prompts every member.

**Requirements:** the settings module imports `reasoningModelIds` from nothing — Magnus declares **no**
model setting; it reads the shipped `inference.primaryReasoningModel`.
**Test:** settings read total with the safe default on a missing row; an out-of-range ceiling is
rejected at the write path; the disclosure version is a positive integer.

## Task 2 — The additive `InferencePort` operation

- [ ] `packages/inference/src/port.ts` — add `ConversationRole`, `ConversationMessage`,
      `ConversationInput`, and `generateConversation(input): Promise<Dispatch<GenerateResult>>` to
      `InferencePort`. Roles are `"member" | "assistant"` — the platform's vocabulary, never a
      vendor's. `systemPrompt` is a separate required field, never a message.
- [ ] `packages/inference/src/gateway.ts` — implement `generateConversation` on the gateway port. It
      reuses `resolveZdrEntry`, `gatewayOptions`, `extractUsage`, `responseText`, and `gatewayFailure`
      **unchanged**. The only new code is the request-body translation.
- [ ] Update `packages/inference/CLAUDE.md` to name the new operation and its role vocabulary.

**Requirements:** the fail-closed ZDR guard runs before dispatch on this operation exactly as it does
on the others — a non-eligible model returns the same non-retryable `validation` problem and the
binding is never called. No caching, no logging, no metadata change: `gatewayOptions()` is called
identically.
**Test:** a non-ZDR model id returns the caller-safe problem and the binding records zero calls; a
successful call returns text, usage, and the pinned snapshot; a thrown binding error maps to the
caller-safe `upstream` problem with no upstream body in `detail`; an empty message array is rejected.

## Task 3 — The stub `InferencePort`

- [ ] `packages/inference/src/stub.ts` — `createStubInferencePort()`, a complete deterministic
      `InferencePort`: every operation returns a fixed transformation of its input with a fixed
      snapshot id (`"stub"`) and deterministic non-zero usage counts. No network, no binding, no
      randomness, no clock.

**Requirements:** it lives in `@magna-carta/inference`, not in Magnus — it is a general implementation
every future AI feature reuses. `generateConversation` echoes a marker plus the last member message so
a test can assert the window actually reached it. It never throws.
**Test:** identical input yields byte-identical output across calls; usage is non-zero so a metering
test is meaningful; the ZDR guard is **not** applied (the stub reaches no provider, so refusing there
would test nothing and would hide a real guard failure in the gateway port).

## Task 4 — Schema and the erasure registry

- [ ] Add `magnusConversation`, `magnusTurn`, `magnusMemberAcknowledgement` to
      `packages/database/src/per-firm-schema.ts` per the design's section 4.2 tables. Indexes:
      `magnus_conversation (created_by, created_at)`, `magnus_conversation (matter_id)`,
      `UNIQUE (conversation_id, sequence)` on `magnus_turn`, and `magnus_turn (created_at)` for the
      ceiling count.
- [ ] Generate the per-firm migration and refresh the snapshot in the same commit.
- [ ] Register all three in `packages/data-access/src/pii-registry.ts`:
      `magnus_conversation` on `created_by` → `pseudonymize-keep`; `magnus_turn` → delete with parent;
      `magnus_member_acknowledgement` on `user_id` → delete. Add the comment stating that free text
      inside a turn is out of the structured registry's scope and that conversation-level deletion is
      the instrument, mirroring the existing `audit_log` metadata note.

**Requirements:** `content` is `TEXT` and nullable (a pending Magnus turn has none). `status` and
`speaker` and `failure_label` are constrained enums. `model_id`/`snapshot_id`/`input_tokens`/
`output_tokens` are nullable and set only on a completed Magnus turn.
**Test:** the schema-name-sync fitness test passes; the "every table is classified" registry test
passes; a turn cannot be inserted twice at the same sequence.

## Task 5 — The domain package

- [ ] `packages/magnus/src/conversation.ts` — start, rename, archive, delete a conversation as
      statement compositions.
- [ ] `packages/magnus/src/turn.ts` — compose the member turn + pending Magnus turn pair with the next
      sequence; complete, fail, or refuse a Magnus turn.
- [ ] `packages/magnus/src/window.ts` — `buildConversationWindow(turns)`: at most the last **20** turns
      and at most **128 KiB** of content, whichever binds first, always ending on the newest member
      turn, returning `{ messages, truncated }`.
- [ ] `packages/magnus/src/limits.ts` — `MEMBER_TURN_MAX_BYTES = 16384`,
      `MAGNUS_TURN_MAX_BYTES = 65536`, with comments explaining that the caps are what keep turn
      content out of R2 rather than a tuning knob.
- [ ] `packages/magnus/src/system-prompt.ts` — the platform-authored system prompt as a constant. It
      states that Magnus is an assistant inside a legal practice-management platform, that it has no
      access to the firm's files or data, that it must not present itself as giving legal advice, and
      that it must say when it does not know.

**Requirements:** every function is pure and returns statements or values; nothing reads a clock,
generates an identifier without an injected random source, or throws for a business outcome.
**Test:** the window truncates on the turn cap and on the byte cap independently and always ends on a
member turn; an over-cap member turn is refused with `too-large`; `truncated` is `true` exactly when
content was dropped; the sequence increments monotonically across interleaved speakers.

## Task 6 — Fitness functions

- [ ] A source-scan test asserting **no module outside `packages/inference/` references `env.AI`,
      `AiBinding`, `GatewayOptions`, or `gatewayOptions(`**.
- [ ] A test asserting `packages/magnus/` has no dependency on `@cloudflare/workers-types`, Hono, or
      any D1 binding type.
- [ ] A test asserting no Magnus audit event's metadata builder can receive a turn's `content` field
      (structural: the metadata builders accept a typed identifier-only input).

---

# Build slice 1·2 — The path: routes, queue, audit, metering

## Task 7 — The consent gate and the acknowledgement

- [ ] `apps/worker/src/magnus/consent.ts` — `resolveMagnusConsent(firmDatabase, userId)` returning a
      closed union: `open`, `firm-ineligible` (`inference.aiProcessingEligibility` closed),
      `feature-disabled` (`magnus.enabled` closed), or `acknowledgement-required` (absent or a stale
      `disclosure_version`).
- [ ] `POST /api/v1/magnus/acknowledgement` — records the current disclosure version for the calling
      member. Idempotent; re-accepting the same version is a no-op that still returns 200.
- [ ] `GET /api/v1/magnus/availability` — returns the resolved consent state and, when open, the
      current disclosure version and the firm's remaining daily turn allowance. This is what a client
      calls before showing an input box.

**Requirements:** one resolver, used by the routes **and** the queue consumer, so submission and
execution can never disagree about whether Magnus is on. A closed gate is a `403` with a problem type
naming which gate, except `acknowledgement-required`, which is `409`.
**Test:** each of the four states; the resolver is the only place either setting is read.

## Task 8 — Conversation and turn routes

- [ ] `POST /api/v1/magnus/conversations` — start. `201`.
- [ ] `GET /api/v1/magnus/conversations` — the caller's conversations, cursor-paginated.
- [ ] `GET /api/v1/magnus/conversations/{conversationId}` — with its turns, cursor-paginated.
- [ ] `PATCH /api/v1/magnus/conversations/{conversationId}` — rename (member-supplied title only).
- [ ] `DELETE /api/v1/magnus/conversations/{conversationId}` — audited delete.
- [ ] `POST /api/v1/magnus/conversations/{conversationId}/turns` — submit. The full gate chain from the
      design's section 6.1, then one effect batch (member turn, pending Magnus turn, audit row, outbox
      message), then `202 { conversationId, memberTurnId, magnusTurnId, status }`.
- [ ] `GET /api/v1/magnus/conversations/{conversationId}/turns/{turnId}` — the poll.

**Requirements:** every route through `defineOpenAPIRoute` with full `RouteMeta`; the submit route is
`idempotency: required`, `audited: true`, `permission: "magnus:converse"`. A conversation is addressed
by the **session** firm; the administrative read (`magnus:readAllConversations`) is a separate branch
that writes its own audit row. The daily ceiling is checked before the batch and returns `429` naming
the ceiling. Re-emit the OpenAPI snapshot and regenerate the client in the same commit.
**Test:** the conformance suite passes for every new operation; a member cannot read another member's
conversation without the administrative permission; an administrative read writes an audit row; a
replayed idempotency key returns the first result and creates no second turn; an over-cap body is
`422`; a closed gate never enqueues.

## Task 9 — The queue consumer

- [ ] Declare the `MAGNUS` queue (producer + consumer) in `wrangler.jsonc` with a dead-letter queue,
      and route it in `src/index.ts`.
- [ ] `apps/worker/src/magnus/magnus-consumer.ts` — per the design's section 6.1: re-read the gate,
      `firmRateGate(firmId)`, resolve the firm's reasoning model via the shipped `resolveReasoningModel`,
      load and window the prior turns, call `generateConversation`, then one effect batch (turn
      completion, `tokenUsageCommitStatements`, dedup record namespaced `magnus:<turnId>`, audit row),
      then broadcast.
- [ ] `apps/worker/src/magnus/inference-port-binding.ts` — `resolveMagnusInferencePort(env)`: the
      gateway port when the `AI` binding **and** the enabling configuration are present, the stub port
      otherwise. Absence resolves to the stub, matching `resolveScanPort` / `resolveEnginePort` /
      `resolveFlagEvaluator`.

**Requirements:** a turn already `complete` returns before the model call (the re-bill stop). A
retryable problem throws so the queue redelivers; a terminal problem writes a `failed`/`refused` turn
with its closed label and acks — a retry loop cannot fix a ZDR refusal. A failure logs the turn
identifier and the problem category through the standard telemetry pipeline and **never** the prompt,
the completion, or an upstream body.
**Test:** a redelivery neither re-calls the port nor double-meters; a retryable problem retries and
dead-letters at max attempts; a terminal problem acks with a labelled turn; a gate closed between
submission and execution yields a `refused` turn; the meter row matches the response usage exactly.

## Task 10 — Audit events

- [ ] Compose the seven events from the design's section 8.2, each in the same batch as the mutation it
      records, metadata carrying identifiers, the disclosure version, the closed failure label, and the
      model and snapshot ids — nothing else.

**Test:** `refuseUnredactedMetadata` is exercised on every builder; a test asserts that no builder's
input type can carry `content`.

---

# Build slice 1·3 — Push transport

## Task 11 — The conversation Durable Object

- [ ] `apps/worker/src/magnus/magnus-conversation.ts` — a `MagnusConversation` Durable Object keyed
      `firmId:conversationId`, using the shipped `JobProgressSockets` helper and frame contract.
      Exported from `src/index.ts`; declared in `wrangler.jsonc` with a migration ledger entry.
- [ ] `GET /api/v1/magnus/conversations/{conversationId}/events` — the subscribe route: `101`, same
      `RouteMeta` and permission as the poll beside it, `426` with the `websocket-upgrade-required`
      problem when called without an upgrade.
- [ ] `apps/worker/src/magnus/turn-progress.ts` — the **one shared resolver** both the poll route and
      the socket call, returning the identical body.

**Requirements:** **the Durable Object stores no conversation content** — it reads turn state from the
firm database and pushes it. Nothing about a subscription lives on a class property (hibernation
discards them). The object is addressed by the session firm id, never a path value. Every state
transition in the consumer ends in a broadcast. A terminal state is pushed once and the socket closes
normally.
**Test:** a subscriber receives current state on connect and the transition when the consumer
completes; `resync` re-sends; a byte-exact ping is auto-answered; an oversized or binary frame is
refused and the socket stays open; a firm cannot address another firm's conversation object; the
pushed `state` is byte-identical to the poll body.

## Task 12 — Documentation and operations

- [ ] `packages/magnus/CLAUDE.md` and `apps/worker/src/magnus/` notes: the two gates, the no-second-port
      rule, the content-never-logged rule, the caps.
- [ ] `docs/user/` — the firm-administrator enablement guide and the member guide, carrying the
      disclosure content the design's section 5.3 fixes. No internal architecture.
- [ ] `docs/conventions/operations.md` — add to the gateway-configuration step: **Guardrails must
      remain disabled on this gateway** (they log prompts and responses), and log collection stays off,
      so the gateway dashboard shows nothing for this traffic by design.
- [ ] `roadmap.d/ai.md` — update `ai.first-feature` and add the Magnus nodes.
- [ ] `status.d/magnus.md` — the slice's own status fragment. Never `STATUS.md` directly.
- [ ] Load-profile fixtures: a firm with conversations at realistic depth, and a measurement run.

---

# Later slices — named, not planned

| Slice | What it adds                                                                              | Blocked on                                                  |
| ----- | ----------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| 1·4   | Token streaming: delta frames, a protocol version bump, partial-content semantics         | Nothing structural — design section 7.5                     |
| 1·5   | The user interface                                                                        | The design-system chat surface                              |
| 2·1   | Explicit per-conversation context grants — the member attaches a named document or matter | Owner flag F3                                               |
| 2·2   | Retrieval behind `MagnusContextPort`                                                      | The parallel Cloudflare AI Search assessment; owner flag F3 |
| 3·1   | Tools and actions, propose-and-approve only                                               | An explicit owner decision; design section 10.2             |

## Verification before merge

- [ ] `pnpm check` and `pnpm test` green
- [ ] `pnpm lint:process-refs` and `pnpm lint:decisions` green
- [ ] OpenAPI snapshot and generated client regenerated, no drift
- [ ] The per-firm migration snapshot refreshed in the same commit as the migration
- [ ] **The default configuration reaches no provider** — asserted by a test, not by inspection
- [ ] **Both consent gates default closed** — asserted by a test
- [ ] No turn content appears in any log, audit row, or problem detail — asserted by a test
