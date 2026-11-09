# @magna-carta/magnus — CLAUDE.md

**Purpose.** The conversational assistant a firm member talks to: the conversation and turn record,
the disclosure a member accepts, the bounded window a request is built from, and the caps that keep a
turn from being bulk content. Pure TypeScript on the structure-versus-access seam (the
`@magna-carta/conflicts` / `@magna-carta/calendar` shape): no D1 binding, no Hono, no `env`, no
Workers runtime type. It composes statements into `@magna-carta/data-access`'s effect batches and
returns typed results rather than throwing for a business outcome. The routes, the queue consumer, the
push transport, and the composition root live in `apps/api-worker/src/magnus/`.

**White paper:** _AI / inference_, with _Tenancy and data isolation_ and _Observability &
diagnostics_ — [`docs/Magna-Carta-White-Paper.md`](../../docs/Magna-Carta-White-Paper.md).
**Design:** [`docs/specs/2026-08-06-magnus-design.md`](../../docs/specs/2026-08-06-magnus-design.md)
(the backend) and
[`docs/specs/2026-09-07-magnus-interface-design.md`](../../docs/specs/2026-09-07-magnus-interface-design.md)
(the two member-facing surfaces and what makes them two).
**Plan:**
[`docs/specs/2026-08-06-magnus-implementation-plan.md`](../../docs/specs/2026-08-06-magnus-implementation-plan.md).
**Decisions:** the [Decision Log](../../docs/Decision-Log.md) — the assistant's own flag ratifications
(who holds `magnus:converse`, the context-grant shape, and the work-product retention class) are
registered there; this file states what they mean for the code, not where they were decided.

## Key files / entry points

- `src/types.ts` — the domain vocabulary as closed unions: `ConversationState`, `TurnSpeaker`
  (`member` | `magnus` — there is deliberately no third speaker), `TurnStatus`, and
  `TurnFailureLabel`, the closed label set a settled turn may carry
- `src/settings.ts` — `magnus.enabled` (boolean, default **false**) and `magnus.dailyTurnCeiling`
  (integer, default 500). There is **no model setting here**: the firm's shipped
  `inference.primaryReasoningModel` is what the assistant reads, and the firm chooses it on its AI
  settings screen
- `src/limits.ts` also carries the attachment caps: ten files per conversation, 64 KiB of attachment
  text per request, a 25 MiB source file; `cutToByteLength` cuts on a character boundary
- `src/statements.ts` — the fourth table is `magnus_conversation_attachment`; `listConversations`
  takes the sort and returns each row's sort key so the route can mint the next cursor
- `src/disclosure.ts` — `MAGNUS_DISCLOSURE_VERSION`, the constant a member's stored acknowledgement is
  compared against
- `src/limits.ts` — `MEMBER_TURN_MAX_BYTES` / `MAGNUS_TURN_MAX_BYTES` and the UTF-8 byte measure
- `src/system-prompt.ts` — the platform-authored instruction, a constant
- `src/window.ts` — `buildConversationWindow`: at most 20 turns and 128 KiB, whichever binds first,
  always ending on the newest member turn, reporting whether it truncated
- `src/statements.ts` — the SQL builders and bounded reads for the three tables; every read is
  `LIMIT`ed and every list read is cursor-paginated
- `src/audit.ts` — the nine audit builders and the shared write context
- `src/conversation.ts` / `src/turn.ts` — lifecycle and turn composition as `EffectWrite`s

## Invariants that apply here

- **No second model port, ever.** This package never imports a binding, never constructs a gateway
  options object, and never names a provider or a model. The single seam is
  `@magna-carta/inference`'s `InferencePort`, and the assistant's one addition to it is the
  `generateConversation` operation. The confidentiality guarantees the platform makes about model
  traffic are four literal fields on one object in one function in
  [`../inference/src/gateway.ts`](../inference/src/gateway.ts); their strength comes entirely from
  there being exactly one place they are set, and a second place would fail silently. Enforced by the
  source scan in `test/one-model-port.test.ts`.
- **The Durable Object holds no conversation content.** `MagnusConversation`
  (`apps/api-worker/src/magnus/magnus-conversation.ts`) writes nothing to its own storage. It reads a
  turn's state back from the firm's database and pushes it, so exactly one copy of a transcript
  exists. That is what makes the retention posture enforceable rather than aspirational, and it is why
  a conversation-persisting agent framework was unusable here: such a framework writes history into
  the agent's own storage with no way to redirect it, which would put a second copy of privileged
  content somewhere the firm's erasure, backup, and export posture does not reach.
- **A member cannot occupy the system role.** The platform-authored prompt travels on
  `ConversationInput.systemPrompt`, a field structurally separate from the message array. There is no
  path from a member's text into it, and the role vocabulary (`member` | `assistant`) has no system
  member for one to be mapped onto.
- **Nothing about a conversation is ever logged.** Not the prompt, not the completion, not an upstream
  body — not into the diagnostics pipeline, not into audit metadata, not into a problem `detail`, not
  into a queue or outbox payload, and not into a Durable Object's storage. A consumer failure logs the
  turn identifier, the correlation identifier, and the problem category, and nothing else. The audit
  builders here are structurally content-free: every input type is identifiers, numbers, and closed
  labels, so a caller who wanted to log what somebody typed would have to change a signature.
  Standard: [`docs/conventions/error-logging.md`](../../docs/conventions/error-logging.md).
- **Gateway Guardrails must never be enabled on the inference gateway.** They intercept and evaluate
  both prompts and responses and produce logs of user prompts and model responses — a retention
  surface introduced through a dashboard toggle, entirely outside the code that makes the platform's
  confidentiality posture fail closed. A fitness function cannot prevent a dashboard toggle, so the
  prohibition is written into the deploy runbook's gateway-configuration step
  ([`docs/conventions/operations.md`](../../docs/conventions/operations.md)) and here. Gateway log
  collection likewise stays off, which is why the gateway dashboard shows nothing for this traffic
  **by design**: everything the firm or the platform needs to know about assistant spend comes from
  the in-repo record — the per-turn provenance columns and the shipped `token_usage_meter`.
- **Both consent gates fail closed and are read in one place.** `resolveMagnusConsent` /
  `resolveMagnusFirmGates` (`apps/api-worker/src/magnus/consent.ts`) is the only reader of
  `magnus.enabled` and `inference.aiProcessingEligibility`, so submission and execution can never
  disagree about whether the assistant is on. The consumer re-reads the firm gates before the model
  call; a gate that closed in between produces a `refused` turn with the `not-eligible` label, never a
  silent drop.
- **Turn content stays in D1 because the caps make it not-bulk.** The caps in `src/limits.ts` are not
  a tuning knob — they are what keeps the "a turn is not bulk content" claim true, and therefore what
  lets a transcript be a row rather than an R2 object with a pointer. The R2 escalation is a named
  seam and is not built.
- **A transcript is the firm's WORK PRODUCT: protected, deletable, archivable.** That is the settled
  class, and it is narrower than "kept like correspondence" in the way that matters — a member's
  exploratory question is the firm's own thinking, not a communication with anybody. Practically:
  protected (author and named-permission holders only, never the client portal), deletable by its
  author with the deletion audited, and archivable rather than only alive-or-gone, which is why the
  conversation carries a lifecycle state from day one.
- **Discoverable like email, but never swept in silently.** Transcripts are discoverable material, so
  any surface that searches or collects across the firm's records must let the firm say whether
  transcripts are in scope — an explicit include-or-exclude, not a default either way. That control
  belongs to the discovery surface and lands with it; nothing in this package or in
  `apps/api-worker/src/magnus/` exposes transcripts to a cross-record search today, and nothing here
  should start doing so without that control existing.
- **Retention is not optional.** There is no per-conversation off-the-record mode, and there will not
  be one: the question "why was that one off the record" is worse than any answer. Deletion is the
  erasure instrument for the free text inside turns — which no structured registry can reach column by
  column — and it is deletion of the whole conversation, not a per-turn redaction.

## Dependencies & contracts

- Depends on `@magna-carta/data-access` (effect batches, the audit builder, cursor pagination, the
  firm-setting accessor), `@magna-carta/identifiers`, and `zod`. Nothing else.
- Consumed by `apps/api-worker/src/http/routes/magnus/magnus.ts` (the surface), `apps/api-worker/src/magnus/` (consent,
  the queue consumer, the push object), and `apps/api-worker/src/background/costs/recoverable-charge-consumer.ts`
  (the outbox topic hand-off).
- Produces statements; the caller commits them. This package holds no database handle and crosses no
  firm.

## Gotchas

- **The window read is bounded, and "truncated" is not inferable from the rows alone.** A turn with
  no content — the pending answer the job is settling, an earlier failed one — takes a row out of the
  bounded read without taking a window slot, so a window that fits its caps exactly can still have
  dropped older turns. The consumer reads with headroom and tells `buildConversationWindow` when its
  own read filled up (`readWasCapped`); that flag is the only place the fact is knowable, and
  dropping it makes truncation silent again. Do not replace the bounded read with a whole-conversation
  one to avoid the problem.
- **The sequence is read then raced.** `readNextSequence` is a read immediately before composing the
  turn pair; the `UNIQUE (conversation_id, sequence)` index is what actually arbitrates two concurrent
  submissions. A loser's whole batch fails rather than silently reordering the record — that is the
  intended behaviour, not a gap.
- **The push transport is a sibling of `JobProgressSockets`, not a reuse of it.** That helper's
  attachment carries the firm R2 bucket a signed artifact URL is minted against and closes a socket
  whose attachment lacks one — a confidentiality guard for the two surfaces that hand out signed URLs.
  A conversation has no artifact to sign, so relaxing that check to share the class would weaken it
  for both. The **frames** stay in the one home
  (`apps/api-worker/src/progress/job-progress-protocol.ts`); only the attachment differs.
- **Both surfaces exist now: the member's and the firm's.** A member reaches the assistant from the
  sidebar destination and from a matter's own section, and accepts the disclosure there. A firm opens
  the two consent settings at **Settings · AI** — `apps/web/src/routes/(app)/settings/ai`
  over `GET`/`PATCH /api/v1/firm/ai/settings` (`apps/api-worker/src/http/routes/firm/firm-ai-settings.ts`), behind
  `firm:manageAiSettings`, which is Admin alone by seed and is deliberately NOT `magnus:converse`:
  asking the assistant a question is ordinary work, deciding for the whole firm that privileged content
  may leave for a third-party provider is not. That route is the only writer of the pair
  `consent.ts` reads, and its own test asserts the seam — a screen that wrote settings the resolver did
  not read would look like it worked and do nothing. **Off by default is still the shipped state**; what
  changed is that a firm can now turn it on rather than needing the settings write path.

- **The firm's screen states the model AND selects it, without collapsing the two postures.** It
  reports `inference.primaryReasoningModel` with its pinned snapshot and the two confidentiality facts,
  and offers the catalog's reasoning entries as the roster. An unconfigured firm follows the platform's
  reasoning tier and moves forward with it, while a firm holding a model id keeps that choice until it
  chooses again ([`../inference/src/settings.ts`](../inference/src/settings.ts) says why that asymmetry
  is deliberate) — so choosing "the platform's current model" DELETES the firm's row rather than
  writing today's default, and the route reports `selection` from the row's existence. The composer
  names the answering model, read from the same setting the consumer reads.
- **A conversation is kept on a matter after the fact, and moving it is an access decision.**
  `PATCH .../conversations/{id}/matter` is allowed to whoever can READ the conversation (the author,
  or `magnus:readAllConversations`) onto a matter the firm still writes to; a closed matter and the
  platform's own matters are refused; the audit row names both matters. The conversation's attachments
  go with the move, because each is one of the OLD matter's files.
- **Attachments are references, and the text is read fresh on every question.** `magnus_conversation_attachment`
  keys on (conversation, file) and copies nothing. The consumer reads each file's current clean version
  from the firm's bucket, takes its text through the platform's one extraction port
  (`apps/api-worker/src/magnus/attachment-text.ts`; plain text directly), and `buildConversationWindow`
  lays it ahead of the newest member turn under a heading naming the file within
  `ATTACHMENT_TEXT_MAX_BYTES`, cutting and marking the cut. The row records `sent | cut | unreadable |
  pending`. A stored extraction would be a second copy of privileged content outside the file's own
  erasure path; the per-question extraction is the cost paid to keep exactly one. Because what Magnus
  can SEE changed, `MAGNUS_DISCLOSURE_VERSION` is 2, and the disclosure statement and the system prompt
  describe the same thing.
- **The listing's order is the server's, one SQL key per order.** `listConversations` takes
  `sort: date | name | matter`; the name and matter orders page on the shared composite cursor with a
  mixed-direction keyset spelled out in `statements.ts` (the group key ascends, the instant beneath it
  descends). A page is never re-ordered by a client.
- **The interface polls the turn; it does not hold the socket.** The events route exists and is
  correct, and the surface deliberately reads `GET .../turns/{turnId}` instead, because the two
  return identical state and a socket buys nothing until a frame can carry a partial answer. Token
  streaming is what makes the socket worth the second transport, and it changes the consumer and the
  frame set rather than the screen.
