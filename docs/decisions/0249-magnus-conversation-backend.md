---
number: 249
slug: magnus-conversation-backend
status: Proposed
date: 2026-08-06
area: AI / Inference
summary: "Magnus — the assistant a firm member talks to — is built as the FIRST CONSUMER of the existing inference chokepoint and gets NO PORT OF ITS OWN: a MagnusModelPort is refused because the confidentiality guarantees are four literal fields in one function, and a second port is a second place they can silently be wrong (caching on, logging on, firm metadata caller-supplied). The single change to the shipped package is ONE ADDITIVE operation, generateConversation, taking a platform-vocabulary message array plus a structurally separate platform-authored systemPrompt — flattening a transcript into the existing prompt string is refused because it destroys the role boundary and puts provider formatting in the caller. A TRANSCRIPT IS A FIRM RECORD: per-firm D1 through the firm-scoped data-access layer, retained like correspondence, author-and-administrator visible, never client-visible, member-deletable with an audited delete, registered in the PII registry with conversation-level deletion as the erasure instrument and free text inside a turn explicitly out of the structured registry's scope — and there is deliberately NO per-conversation off-the-record mode, because the question why was that one off the record is worse than any answer. Turn content stays in D1 under HARD CAPS (16 KiB member, 64 KiB Magnus) that are what make the not-bulk claim true rather than a tuning knob, and the conversation window sent to the model is capped at 20 turns / 128 KiB with truncation SURFACED to the member, because silent truncation produces a confident answer built on a premise the member believes was in scope. Consent is THREE LAYERS, all fail-closed: the shipped inference.aiProcessingEligibility gate inherited not re-asked, a NEW magnus.enabled feature gate re-read in the consumer so a firm switching it off stops in-flight turns, and a magnus:converse RBAC permission plus a VERSIONED per-member disclosure acknowledgement — a per-member on/off setting is refused as a second authorization mechanism the chokepoint does not know about. Transport reuses the shipped push-progress hibernation WebSocket rather than server-sent events, because ADR-0112 REQUIRES off-hot-path queue dispatch, and the Durable Object holds NO conversation content — it reads turn state from the firm database and pushes it, which is exactly the constraint that made AIChatAgent unusable. Gateway logging stays fully off, so the AI Gateway dashboard shows NOTHING for Magnus by design and the in-repo token_usage_meter is the only cost record; the metadata-only middle ground is a cf-aig-* header the binding does not read, and GUARDRAILS MUST NEVER BE ENABLED because they log user prompts and model responses — a retention surface behind a dashboard toggle, outside everything the code makes fail closed. Magnus starts with NO platform context and NO tools: retrieval attaches at a MagnusContextPort whose only implementation returns nothing, because the disclosure what you type is what is sent is one a firm can actually evaluate and what our retrieval layer happened to select is not."
---

**Magnus consumes the existing inference chokepoint rather than getting a port of its own; its
transcript is a firm record in per-firm D1; consent is three fail-closed layers; and it starts with no
context and no tools.**

**Context:** The owner asked on 2026-08-06 for "whatever backend we need for Magnus, the AI the user
can talk to," specifying "routing it through an AI GATEWAY seam," and separately that AI features "will
need to be opt-in." Half of that ask is already built and ratified: `@magna-carta/inference` is the
single credential-less chokepoint (ADR-0111) with caching off, logging off, derived firm metadata
(ADR-0113), a fail-closed zero-data-retention guard (ADR-0110), and required off-hot-path queue
dispatch (ADR-0112). The other half — a conversation — exists nowhere: no table, no route, no record of
who asked what. ADR-0109, the client-consent decision, is still Proposed.

**Decision:**

1. **No second port.** Magnus consumes `InferencePort`. A `MagnusModelPort` is refused because the
   confidentiality guarantees are not policy — they are four literal fields on one object in one
   function, and their strength comes entirely from there being exactly one place they are set. The
   failure mode of a second place is silent: nothing breaks when `skipCache` is wrong, the answers just
   start coming from a cache whose key carries no firm dimension. Enforced structurally: no module
   outside `packages/inference/` may reference `env.AI` or construct gateway options.

2. **One additive operation, `generateConversation`**, taking `{ modelId, firmId, systemPrompt,
   messages }` where a message is `{ role: "member" | "assistant", content }` — the platform's
   vocabulary, mapped to the provider's shape inside the adapter beside the existing three-shape
   response parser. `systemPrompt` is structurally separate because it is the only part of the request
   the firm did not author, so a member cannot occupy the system role by typing. Flattening the
   transcript into the existing `prompt: string` is refused: it destroys the role boundary that stops a
   model being steered by its own prior output, and puts provider formatting in the caller. A
   polymorphic `prompt` is refused: every implementation and every double would handle both shapes
   across three operations.

3. **A transcript is a firm record.** Per-firm D1 through the firm-scoped data-access layer, retained
   like correspondence, visible to its author and to administrators holding a separate
   `magnus:readAllConversations` permission, never visible to clients, member-deletable with an audited
   delete, registered in the PII registry (`created_by` pseudonymize-keep; turns delete with parent).
   Free text inside a turn is explicitly outside the structured registry's scope — the same honest
   posture the registry already takes for audit metadata and email bodies — with conversation-level
   deletion as the erasure instrument. The cost is taken seriously and stated: retention makes an
   exploratory question durable where a spoken thought would not have been. It is accepted because a
   firm that cannot see what its members asked cannot supervise the thing at all, because every
   neighbouring subsystem already keeps its records, and because a transcript with the model and
   snapshot recorded against the turn is the only useful artifact when a member relied on a wrong
   answer. What is refused is a per-conversation off-the-record mode: the question "why was that one
   off the record" is worse than any answer.

4. **Caps are structural, not tuning.** 16 KiB per member turn and 64 KiB per Magnus turn are what keep
   "a turn is not bulk content" true, and therefore what let a transcript be a D1 row rather than an R2
   object. They also mean a member cannot paste a deposition into the chat box and silently ship it to
   a provider. The window sent to the model is capped at 20 turns or 128 KiB, always ending on the
   newest member turn, and **truncation is surfaced to the member** — silent truncation produces a
   confidently wrong answer built on a premise the member believes was in scope.

5. **Consent is three fail-closed layers.** The shipped `inference.aiProcessingEligibility` is
   inherited, not re-asked. A new `magnus.enabled` (default off) is the feature-specific gate, re-read
   in the consumer so a firm switching Magnus off halts in-flight turns as a labelled refusal rather
   than a silent drop. Member access is the `magnus:converse` RBAC permission plus a **versioned**
   disclosure acknowledgement — versioned so that the day Magnus gains a capability, every member is
   re-prompted automatically. A per-member enable/disable setting is refused: it would be a second
   authorization mechanism the chokepoint does not know about.

6. **Transport reuses the shipped push-progress WebSocket, not server-sent events.** ADR-0112 requires
   off-hot-path queue dispatch, and SSE puts a multi-second model call back on the request path with no
   place to apply back-pressure. Submission returns 202; the queue consumer answers; a
   `MagnusConversation` Durable Object broadcasts, and the poll endpoint stays as a real fallback
   through one shared resolver. **The Durable Object holds no conversation content** — it reads turn
   state from the firm database and pushes it, which is exactly the constraint that made
   `AIChatAgent`-style frameworks unusable here (they persist history to their own storage with no
   redirection seam). Token streaming is deferred to a later slice as a frame-set change, not a
   re-architecture.

7. **Gateway logging stays fully off, and Guardrails must never be enabled.** `collectLog: false`
   remains pinned, so the AI Gateway dashboard shows nothing for Magnus traffic by design and the
   in-repo `token_usage_meter` is the only cost record — which ADR-0113 already requires. The
   metadata-only middle ground (`cf-aig-collect-log-payload`) is a `cf-aig-*` request header the
   binding does not read, and adopting it would mean abandoning the authenticated-binding posture for
   one convenience. Guardrails are refused outright: they log user prompts and model responses, which
   is a retention surface introduced through a dashboard toggle entirely outside the code that
   ADR-0110 makes fail closed, and they solve a problem this product does not have — a legal
   assistant's failure mode is being confidently wrong, which no hazard classifier detects.

8. **No context and no tools at the start.** Magnus sees only what the member types; retrieval attaches
   at a `MagnusContextPort` whose only implementation returns nothing. The narrow start is chosen
   because the disclosure has to be true and evaluable: "what you type is what is sent" is a sentence a
   firm can weigh under its confidentiality obligations, and "whatever our retrieval layer selected
   from your matter files" is not. Magnus takes no action at all — not a deferral but a position,
   because the platform has already decided that conflicts and docketing must be deterministic for
   defensibility, and a tool surface writing into them would contradict that.

9. **Cost is recorded twice because two different questions are asked.** The shipped
   `token_usage_meter` rollup answers what a firm spent; the turn row's own model, snapshot, and token
   columns answer what produced this specific answer and what it cost. Neither derives the other. No
   `magnus_usage` table is created — the `ai_detection_usage` precedent does not transfer, because that
   table exists only because Pangram bills by words rather than tokens.

**Considered & rejected:** _a Magnus-specific model port_ (a second confidentiality control plane with
a silent failure mode); _flattening the transcript into `prompt`_ and _a polymorphic `prompt`_ (role
boundary, and a combinatorial burden on every implementation); _the Cloudflare Agents SDK /
`AIChatAgent`_ (persists conversation history to the agent's own storage with no redirection seam,
irreconcilable with the transcript as a firm record); _server-sent events on the request path_
(ADR-0112 requires queue dispatch); _gateway metadata-only logging_ (a header the binding does not
read); _Guardrails_ (they log prompts and responses); _a `magnus_usage` table_ (duplicates the shipped
authoritative meter); _a model-generated conversation title_ (a model call over privileged content
producing a second copy of it in a column that surfaces in lists); _a per-conversation no-retention
mode_; _a per-member enable/disable setting_; _unbounded conversation history_ (quadratic cost, and a
re-transmission of privileged content every turn); _turn content in R2 from day one_ (a capped turn is
not bulk, and the escalation is a named seam).

**Consequences:** the first real AI feature ships without weakening the chokepoint that every later one
depends on, and the additive port operation plus the general-purpose stub implementation are inherited
by every future consumer. Slice 1 is buildable and mergeable with ADR-0109 still open, because both
gates default closed and the default adapter reaches no provider — but **enabling Magnus in production
requires ADR-0109 accepted and the ZDR procurement artifacts ADR-0110 names**, which is the correct
order, since the alternative is deciding consent in the abstract about a system nobody has seen. The
costs carried: no gateway-side request analytics at all, so every diagnostic question is answered from
in-repo records; a retention posture that creates discoverable material, bounded by deletion and stated
in the disclosure; a bounded context window that will sometimes truncate a long conversation; and one
task — the provider-native conversation request-body translation — that cannot be fully verified
without a live gateway call, isolated deliberately so it blocks nothing else.
