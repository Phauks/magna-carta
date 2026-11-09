# Magnus — the conversational assistant backend — design

**Date:** 2026-08-06
**Status:** Design proposed. Owner flags in section 12 are open; **build slice 1 is buildable and
mergeable with none of them answered** (section 11 states exactly why). No product code in this cycle.
**Scope:** The backend a firm member talks to — the conversation and turn record, the consent gate that
must be opened before a single byte leaves the platform, the path from a submitted turn to a model
answer, the transport that returns it, the audit and cost record it leaves behind, and the seams that
later slices attach retrieval, tools, and token streaming to. **Excludes:** the user interface; which
model Magnus uses; what Magnus can see; what Magnus can do; retrieval of any kind; the client portal
surface. Each is either a named owner flag (section 12) or a named seam (section 10).
**White-paper home:** _AI / inference_, with _Tenancy and data isolation_, _Authentication, access
control & encryption_, _Observability & diagnostics_, _Performance & concurrency model_, and _Settings
& configuration_ as the surrounding context.
**Governing decisions:** ADR-0109 (client consent for third-party frontier processing — **Proposed,
still open**), ADR-0110 (credential and confidentiality posture: Unified Billing, zero-data-retention
on, payload logging off, fail-closed per-request guard), ADR-0111 (`@magna-carta/inference` is the one
credential-less chokepoint), ADR-0112 (multi-tenant fairness: one gateway per environment, off-hot-path
queue dispatch **required**, firm-scoped spend rule, `firmRateGate` seam), ADR-0113 (tenant isolation:
caching off, firm metadata derived not caller-supplied, authenticated gateway, response-captured token
usage as the authoritative meter — never gateway logs), ADR-0003 (tenancy and the firm-scoped
data-access layer), ADR-0067 (route metadata and the one enforcement chokepoint), ADR-0017 / ADR-0038
(audit and redact-by-default), ADR-0039 (nothing heavy on the hot path), ADR-0064 (transactional
outbox), ADR-0068 (trusted-insider access control).
**Decision inputs:** the shipped `@magna-carta/inference` package (`port.ts`, `catalog.ts`,
`gateway.ts`, `settings.ts`); the shipped inference queue consumer and call site
(`apps/worker/src/inference/`); the shipped push-progress WebSocket contract
(`apps/worker/src/progress/job-progress-protocol.ts`) and its convention entry in
[`../conventions/api.md`](../conventions/api.md) (_Push progress over WebSocket_); the shipped
`token_usage_meter` and `ai_detection_usage` metering precedents
(`packages/data-access/src/token-usage-statements.ts`,
`packages/data-access/src/ai-detection-usage-statements.ts`); the shipped audit write path and its
metadata-redaction chokepoint (`packages/data-access/src/audit-statements.ts`,
`metadata-redaction.ts`); the PII/erasure registry (`packages/data-access/src/pii-registry.ts`); the
AI-text-detection consent precedent (`packages/ai-detection/src/settings.ts`,
`apps/worker/src/routes/files/ai-detection.ts`); the Cloudflare Agents assessment
([`../research/2026-08-04-cloudflare-agents-assessment.md`](../research/2026-08-04-cloudflare-agents-assessment.md));
and a fresh reading of the Cloudflare AI Gateway documentation on 2026-08-06 (section 4.4).

---

## 1. Why now, and what the ask actually resolves to

The owner's ask has two halves, and only one of them is a build.

_"Routing it through an AI Gateway seam"_ describes something that **already exists and is already
ratified.** `@magna-carta/inference` is the single credential-less chokepoint (ADR-0111); every model
call goes through the authenticated `AI` binding with a gateway options object pinned on every request —
caching off, logging off, firm metadata derived server-side (ADR-0113); a fail-closed
zero-data-retention guard refuses a non-eligible model before dispatch (ADR-0110); the model catalog is
validated at module load so a non-ZDR reasoning entry cannot be represented; dispatch is off the hot
path through a queue with a per-firm back-pressure seam (ADR-0112). The feature ledger records
`ai.inference` as shipped.

So the honest answer to the gateway half of the ask is: **the seam is built, and Magnus's job is to be
its first real consumer without weakening it.** The temptation this design exists to refuse is a
`MagnusModelPort` — a second port, a second set of gateway options, a second place where `skipCache`
could quietly become `false`. That is section 3.

_"The AI the user can talk to"_ is the build. Nothing in the platform holds a conversation. There is no
table a turn could go in, no route that accepts one, no record of who asked what. `ai.first-feature` is
`not-started` in the ledger with the evidence line "no feature spec or code; gated on the consent
decision." This is that spec.

And _"it will need to be opt-in"_ is the constraint that shapes everything else. Section 5.

## 2. What a legal-practice assistant is, stated before it is designed

Three properties separate this from a generic chat backend, and each one drives a structural decision
rather than a policy note.

**Every byte a member types is presumptively privileged.** Not the answer — the _question_. "Can I
still amend before the pretrial order in Judge Kim's court on the Alvarez matter" is a client
confidence before any model sees it. This is why the prompt is a firm record from the moment it is
submitted (section 4), why nothing about the conversation is ever logged through the diagnostics
pipeline (section 8), and why the gateway's own logging stays off even in its metadata-only form
(section 4.4).

**A conversation is a record, not a session.** A chat widget that forgets is a chat widget; a firm's
communications are kept. That is not a preference — it is the professional posture the rest of the
platform already takes with correspondence, custody movements, and time entries. Section 4 argues the
transcript-as-firm-record recommendation in full, because the Agents assessment named it as
architecturally load-bearing and it is the design's most consequential choice.

**The assistant is not a lawyer and the platform must not let it be mistaken for one.** This is why
Magnus takes no action (section 10.2), why nothing it says is written into any other subsystem's table,
and why the disclosure text in section 5.3 says so in words rather than gesturing at it.

## 3. The gateway seam — reused, not rebuilt

### 3.1 The refusal

**Magnus gets no port of its own.** It consumes `InferencePort` exactly as the timekeeping narrative
producer does. A `MagnusModelPort` is refused on four grounds:

1. **A second port is a second confidentiality control plane.** The guarantees in ADR-0110 and
   ADR-0113 are not policy statements — they are four literal fields on one object in one function in
   `packages/inference/src/gateway.ts`. Their strength comes entirely from there being exactly one
   place they are set. A second port is a second place, and the failure mode is silent: nothing breaks
   when `skipCache` is wrong, the answers just start coming from a cache whose key carries no firm
   dimension.
2. **The ZDR guard is pre-dispatch and fail-closed in that one function.** Reimplementing it is
   reimplementing the platform's single hardest confidentiality invariant.
3. **The catalog, the per-firm model setting, and its write-time validation are already wired to this
   port.** A second port either re-reads them or drifts from them.
4. **The owner asked for gateway routing.** The gateway routing is this port. Building a second one
   would be answering the ask by doing the opposite of it.

The fitness function that makes this structural rather than aspirational: **no module outside
`packages/inference/` may reference `env.AI` or construct a gateway options object.** Magnus receives
an `InferencePort`; it never sees a binding.

### 3.2 The one thing the port cannot express, and the additive fix

`GenerateInput` is `{ modelId, prompt: string, firmId }`. A conversation is not a string. Three ways to
close that gap, and only one is right:

- **Flatten the transcript into `prompt`.** Refused. The role boundary between what the member said and
  what the model previously answered is not decoration — a model that cannot tell them apart can be
  steered by its own prior output, and a transcript concatenated into one blob is the classic shape
  that lets pasted text act as instruction. It also puts provider-shaped formatting in the caller,
  which is exactly the vendor leakage `port.ts` opens by forbidding.
- **Make `prompt` polymorphic** (`string | Message[]`). Refused: every implementation, including every
  test double, then has to handle both, and the buffered/streaming/durable operations multiply by two.
- **Add one operation.** Recommended.

```
export type ConversationRole = "member" | "assistant";

export interface ConversationMessage {
  readonly role: ConversationRole;
  readonly content: string;
}

export interface ConversationInput {
  readonly modelId: InferenceModelId;
  readonly firmId: FirmId;
  // Platform-authored, never member-authored, never firm-authored. Structurally separate from the
  // conversation because it is the one part of the request the firm did not write.
  readonly systemPrompt: string;
  readonly messages: readonly ConversationMessage[];
}

generateConversation(input: ConversationInput): Promise<Dispatch<GenerateResult>>;
```

`GenerateResult` is unchanged — `{ text, usage, snapshotId }` — so metering, provenance, and the
`Dispatch` error taxonomy all work without a new shape. The role vocabulary is the platform's
(`member`), not a vendor's, per the port's own opening comment and golden rule 12; the mapping to
whatever the provider calls it happens inside the adapter, beside the existing `responseText()` that
already reconciles three provider response shapes.

**`systemPrompt` is a separate field on purpose.** It is the only part of the request the firm did not
author, and keeping it out of the message array means a member can never occupy the system role by
typing, and a reviewer can see at a glance which bytes are platform text and which are firm content.

### 3.3 The riskiest task in the build, named up front

`gateway.ts` sends `{ prompt: input.prompt }` to `ai.run(...)`, and its own comment concedes that "the
provider-native REQUEST-body translation … [is] pinned when the worker binding is wired in the
composition root." For a conversation the body must carry a message array and a system field in the
provider's shape. **This is the one task in the whole build that cannot be fully verified without a
live gateway call**, and the design is deliberately arranged so that it does not block anything: the
stub adapter (section 6.3) makes every other task testable and mergeable, and the gateway adapter is
selected by configuration. The build plan makes the translation its own task with its own
verification step rather than burying it inside the port change.

### 3.4 The gateway control plane, re-verified today

Checked against the Cloudflare AI Gateway documentation on 2026-08-06, because golden rule 11 does not
allow this to be asserted from memory and because ADR-0113 pins a specific surface:

| Fact                         | Current documentation                                                                                                                  | What Magnus does                                                                              |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| Binding-path gateway options | `id`, `skipCache`, `cacheTtl` (plus `collectLog` and `metadata` as used today)                                                         | Unchanged — the shipped `gatewayOptions()` is reused verbatim                                 |
| Turning logging off entirely | Gateway setting, or `cf-aig-collect-log: false` per request; "the entire log entry (including metadata) is skipped"                    | **Off.** `collectLog: false` on every request, as shipped                                     |
| Metadata-only logging        | `cf-aig-collect-log-payload: false` keeps "token counts, model, provider, status code, cost, and duration" without bodies              | **Not adopted** — see below                                                                   |
| Caching                      | On by default; `skipCache` available                                                                                                   | **Off**, as shipped and as ADR-0113 requires                                                  |
| Guardrails                   | Intercept and evaluate prompts and responses, and produce "logs of user prompts, model responses"                                      | **Off, and must stay off** — see below                                                        |
| Bring-your-own-keys          | Provider keys stored in Secrets Store, referenced by alias; falls back to Cloudflare-managed credentials billed to the account balance | Unchanged — the deferred BYOK adapter named in `packages/inference/CLAUDE.md` still owns this |
| Rate limiting                | Gateway-level request limiting                                                                                                         | Complements, does not replace, the platform's own limits (section 7.3)                        |

Two of those rows are load-bearing and worth stating as conclusions rather than table cells.

**The metadata-only middle ground is not available to us, and that is the correct outcome.**
`cf-aig-collect-log-payload: false` would give per-request cost and token analytics in the Cloudflare
dashboard with no prompt or response bodies stored — genuinely attractive. But it is a `cf-aig-*`
request header, and ADR-0113 pins the control plane to the **binding's** options object precisely
because the binding does not read those headers. Adopting it would mean moving Magnus off the binding
onto the REST surface, which would mean re-deriving the entire authenticated-gateway posture for one
convenience. The consequence is real and should be recorded plainly rather than discovered later: **the
AI Gateway dashboard will show nothing for Magnus traffic.** There are no logs, so there are no
per-request analytics, no cost graph, and no request inspector. Everything the firm or the platform
needs to know about Magnus spend comes from the in-repo record (section 8.3), which ADR-0113 already
names as the authoritative meter for exactly this reason. The gateway's spend rule and credit alarm
(ADR-0112) still operate — they are account-level controls, not log-derived ones.

**Guardrails must never be enabled on this gateway.** The documentation states they intercept and
evaluate both prompts and responses and produce logs of user prompts and model responses. On a gateway
carrying privileged content that is a retention surface introduced through a settings toggle, entirely
outside the code that ADR-0110 makes fail closed. It also solves a problem this product does not have:
guardrails moderate for harmful content, while a legal assistant's failure mode is being confidently
wrong, which no hazard-category classifier detects. The build adds an explicit note in the deploy
runbook's gateway-configuration step and a line in `packages/inference/CLAUDE.md`, because a dashboard
toggle cannot be prevented by a fitness function.

## 4. The conversation model

### 4.1 Is the transcript a client record? — the recommendation, argued

The Agents assessment flagged this as architecturally load-bearing, not merely policy, and it is right:
the answer determines whether a transcript may live in ephemeral per-object storage or must live in the
firm's own database under the firm-scoped data-access layer.

**Recommended default: a Magnus transcript is a firm record, retained like correspondence.** It lives
in per-firm D1, is written through the firm-scoped data-access layer, is visible to its author and to
firm administrators holding a named permission, is not exposed in the client portal, and is erasable by
deleting the conversation — registered in the PII/erasure registry so that deletion is a discipline
rather than an act of memory.

The argument, and the honest cost.

**For.** A member asking Magnus about a matter is doing work on that matter. The firm's supervisory
obligations over the work of non-lawyers do not evaporate because the non-lawyer is software; a firm
that cannot see what its members asked and what they were told cannot supervise the thing at all. It is
also the only posture consistent with everything around it — the platform already keeps email it
captured, documents it assembled, movements of physical originals, and every mutation in an append-only
audit log. A subsystem that forgets, sitting in a product whose entire premise is that the firm keeps
its own records, would be an anomaly requiring justification, and there is none. There is a defensive
dimension too: if a member relies on something Magnus said and it was wrong, the useful artifact is the
transcript with the model and snapshot recorded against the turn. Without it, the firm has an assertion
and no record.

**Against, taken seriously.** Retention creates discoverable material. A member's exploratory question
— the one framing a weakness in their own case — becomes a durable record where a spoken thought would
not have been. This is a real cost and the design does not pretend otherwise. Three things bound it:
conversations are deletable by their author at any time, with the deletion audited (the record is that
a conversation existed and was deleted, never its content); the transcript is firm-internal and never
reaches the client portal, so it is not a client communication; and the disclosure in section 5.3 says
in plain words that conversations are kept, so nobody discovers this after the fact. What the design
refuses to do is make retention _optional per conversation_ — an off-the-record mode is precisely the
feature whose existence is the problem, because the question "why was that one off the record" is worse
than any answer.

**Consequences of the recommendation, stated so the flag can be answered against them:**

- Turns live in per-firm D1 under a hard size cap (section 4.3). No conversation content is ever
  written to any Durable Object's own storage, which is what would have made `AIChatAgent`-style
  frameworks unusable here regardless of anything else.
- The transcript inherits the per-firm database's isolation, backup, and export posture for free.
- Legal hold and matter-close retention are **owner flag F4b**: whether a transcript on a matter is
  swept by the same holds as correspondence is a professional-responsibility question, not an
  engineering one. The schema is built so the answer is a policy change and not a migration — the
  conversation carries an optional matter link and a lifecycle state from day one.

### 4.2 Shape

Three new per-firm tables. Names are spelled out in full per golden rule 12.

**`magnus_conversation`** — one conversation.

| Column                                   | Notes                                                                                                                                                                                                                                       |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`                                     | `magnusConversation_` identifier                                                                                                                                                                                                            |
| `title`                                  | Nullable, **member-supplied only.** A model-generated title is a model call over privileged content producing a second copy of it in a column that surfaces in lists — refused. A conversation with no title displays by its start instant. |
| `created_by`                             | The member. Never null; there is no system-originated conversation.                                                                                                                                                                         |
| `matter_id`                              | Nullable. **Scopes the record, not the prompt** — see section 4.5.                                                                                                                                                                          |
| `state`                                  | `active` \| `archived` \| `deleted`                                                                                                                                                                                                         |
| `created_at`, `updated_at`, `deleted_at` | Instants                                                                                                                                                                                                                                    |

**`magnus_turn`** — one message, from either speaker. One table rather than two, because the ordering
between them is the record and two tables would need a merge to reconstruct it.

| Column                          | Notes                                                                                                                                                          |
| ------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`                            | `magnusTurn_` identifier                                                                                                                                       |
| `conversation_id`               | Owning conversation                                                                                                                                            |
| `sequence`                      | Monotonic within the conversation; `UNIQUE(conversation_id, sequence)`. Ordering is explicit, never inferred from a timestamp that two rows can share.         |
| `speaker`                       | `member` \| `magnus`                                                                                                                                           |
| `content`                       | The text. Nullable while a `magnus` turn is pending.                                                                                                           |
| `status`                        | `pending` \| `complete` \| `failed` \| `refused`                                                                                                               |
| `failure_label`                 | A closed label (`model-unavailable`, `not-eligible`, `ceiling-reached`, `too-large`, `cancelled`), **never** an upstream body. Null unless `failed`/`refused`. |
| `model_id`, `snapshot_id`       | Null on a `member` turn; recorded on every `magnus` turn — the provenance answer to "what produced this".                                                      |
| `input_tokens`, `output_tokens` | Null on a `member` turn; recorded on completion                                                                                                                |
| `created_at`, `completed_at`    | Instants                                                                                                                                                       |

**`magnus_member_acknowledgement`** — one row per member who has accepted the disclosure.

| Column               | Notes                                                                        |
| -------------------- | ---------------------------------------------------------------------------- |
| `user_id`            | Primary key                                                                  |
| `disclosure_version` | The version of the disclosure text accepted. A code constant, not a setting. |
| `acknowledged_at`    | Instant                                                                      |

The `disclosure_version` column is the whole point of the table: when the disclosure changes because
Magnus gains a capability — the day it can read matter documents is the obvious one — every member is
re-prompted automatically, because their stored version no longer matches the current constant. An
acknowledgement without a version is an acknowledgement of an unknown thing.

### 4.3 Turn content in D1, and the cap that makes that correct

Golden rule 3 ends "bulk content to R2, never D1." A chat turn is not bulk, but only if something makes
it so. **A member turn is capped at 16 KiB of content and a Magnus turn at 64 KiB**, enforced at the
route schema and again at the write path. The cap is not a performance tuning knob — it is what keeps
the "not bulk" claim true, and it is the reason a conversation transcript can be a D1 row rather than
an R2 object with a pointer.

Two consequences follow, and both are features. A member cannot paste a 200-page deposition into the
chat box and silently ship it to a model provider — the request is refused with a message naming the
limit, which is a better outcome than succeeding. And the total bytes any conversation can send to a
provider are bounded by construction, which the cost model (section 8.3) depends on.

The escalation seam is named and not built: if a later slice needs long-form output, the turn row gains
an R2 content pointer alongside the inline column, exactly as the file subsystem already does. Nothing
in the read path assumes the content is inline except the read path itself.

### 4.4 Erasure

Registered in `packages/data-access/src/pii-registry.ts`:

- `magnus_conversation` on `created_by` → `pseudonymize-keep`, matching the shipped
  `ai_detection_usage.requested_by` precedent: the fact that a conversation happened is firm activity
  worth keeping; the person becomes a pseudonym.
- `magnus_turn` → delete with parent. A turn has no independent existence.
- `magnus_member_acknowledgement` on `user_id` → delete. A record of consent by a person who has been
  erased is not a record of anything.

**Free text inside a turn is out of the structured registry's scope, and this is stated rather than
finessed.** A member may type a client's name; no column knows that. This is exactly the posture the
registry already takes for `audit_log` metadata JSON and for email bodies, and the instrument is the
same one: **conversation-level deletion**, which removes the content wholesale. The erasure report
names Magnus conversations as a surface the operator reviews, rather than claiming a column-level
guarantee the design cannot honour.

### 4.5 `matter_id` scopes the record, not the prompt

The conversation carries an optional matter link. It is worth being explicit, because it is the field
most likely to be misread: **linking a conversation to a matter does not put any of that matter's
content into any prompt.** In slice 1 nothing does (section 10.1). The link answers "which matter's
file does this transcript belong to" — a record-keeping question with real consequences for retention,
for a matter-close sweep, and for the future access question of who in the firm may read it. It is
present from day one because adding a nullable column later is cheap while backfilling the association
from memory is impossible.

## 5. Consent — opt-in, in three layers

ADR-0109 is still Proposed, and the owner restated the requirement in the same breath as the ask. The
design treats opt-in as structure, not as a checkbox.

### 5.1 Firm-level: two gates, both fail-closed

Magnus reads **two** per-firm settings and refuses unless both are open:

- `inference.aiProcessingEligibility` — **already shipped**, default `false`. May this firm's content go
  to a third-party frontier model at all? Magnus does not get to re-answer a question the platform has
  already asked; it inherits the answer. This is the general gate.
- `magnus.enabled` — new, default `false`. Is this specific feature turned on? This is the specific
  gate.

Two settings rather than one, because they are genuinely different questions and collapsing them
produces a bad failure in both directions: a firm that has enabled inference for document drafting has
not thereby consented to a free-form assistant, and a firm that turns Magnus off should not thereby
disable every other AI feature. The precedent is shipped —
`packages/ai-detection/src/settings.ts` holds a feature-specific consent axis beside the general one for
exactly this reason.

Both are `FirmSettingDefinition`s in the per-firm `setting` table, following the same pattern as
`primaryReasoningModel`: total reads with a safe default, schema validation at the write path. The
enforcement point is the route, before anything is enqueued, and the queue consumer re-reads
`magnus.enabled` before the model call — because a firm that switches Magnus off should not have queued
turns continue to reach a provider. **A refusal on the second read is a `refused` turn with the
`not-eligible` label, never a silent drop.**

### 5.2 Member-level: a permission, plus a recorded acknowledgement — not a third setting

Recommended: **`magnus:converse` in the RBAC permission registry**, granted by role, enforced at the
chokepoint like every other permission. Plus `magnus:readAllConversations` for the administrative read
in section 9.

A per-member boolean setting is refused. The platform has one access-control system, it is
role-based, and it is enforced in one place; a parallel per-member on/off switch would be a second
authorization mechanism that the chokepoint does not know about, which is how a feature ends up
enforced in a route handler by discipline. Which roles hold `magnus:converse` is **owner flag F2**.

The acknowledgement is not access control and does not gate on a role. Before a member's **first** turn
— and again whenever `disclosure_version` moves — the member sees the disclosure and accepts it, and a
row lands in `magnus_member_acknowledgement`. It exists so the firm can show that each person who used
Magnus was told what it does, which is a different fact from "the firm turned it on".

### 5.3 What the disclosure must say

The firm-admin enablement screen and the member acknowledgement show different text to different
readers with different obligations, and neither may be vague. The design fixes the required content;
wording is the user-documentation stream's.

**Firm administrator, at enablement — must state:**

1. **Content leaves the platform.** What members type into Magnus is sent to a third-party model
   provider, routed through Cloudflare AI Gateway. Naming the mechanism matters: "AI-powered" is not a
   disclosure.
2. **Which provider and model** are in effect, and that the model is restricted to the platform's
   zero-data-retention-eligible catalog — the provider does not retain the content and does not train
   on it.
3. **The residual.** ADR-0110 requires the residual classifier-retention disclosure to appear in
   firm-facing language; it appears here verbatim. A ZDR guarantee is not the same as nothing existing
   anywhere for any interval, and the firm is told the difference.
4. **What Magnus can see** — in slice 1, only what the member types in that conversation. No matter
   files, no calendar, no directory, no documents.
5. **What Magnus can do** — nothing. It answers. It cannot create, edit, file, send, or delete.
6. **Transcripts are kept** as firm records, who inside the firm can read them, and that they are not
   visible to clients.
7. **The firm's own client-consent obligations are the firm's.** The platform records the firm's
   decision; it does not and cannot decide whether this firm's engagement letters, jurisdiction, and
   matters permit it. This sentence is the one most likely to be cut for brevity and is the one that
   must not be.

**Member, at first use — must state:** items 1, 4, 5, 6 in plain language, plus the one thing an
administrator does not need told: **Magnus can be wrong, its output is not legal advice, and the member
is responsible for verifying anything they rely on.** That is the sentence the person actually typing
needs, and it belongs where they will read it.

## 6. From a submitted turn to an answer

### 6.1 The path

```
POST /api/v1/magnus/conversations/{conversationId}/turns
  chokepoint: authn -> magnus:converse -> idempotency key -> rate limit
  |
  +- read magnus.enabled AND inference.aiProcessingEligibility  -> refuse 403 if either is closed
  +- read magnus_member_acknowledgement                          -> refuse 409 if stale/absent
  +- check the daily turn ceiling                                -> refuse 429 if reached
  |
  +- ONE effect batch:
  |    member turn row (status complete)
  |    magnus turn row (status pending)      <- the thing the client polls or subscribes to
  |    audit_log row                          <- ids only, never content
  |    outbox message -> MAGNUS queue
  |
  '- 202 { conversationId, memberTurnId, magnusTurnId, status: "pending" }

MAGNUS queue consumer  (off the hot path, as ADR-0112 requires)
  |
  +- re-read magnus.enabled                  -> refused turn if closed since submission
  +- firmRateGate(firmId)                    -> the shipped back-pressure seam
  +- read the firm's reasoning model
  +- load the conversation's prior turns, bounded (section 6.2)
  +- InferencePort.generateConversation(...)
  |
  '- ONE effect batch:
       magnus turn -> complete | failed | refused (+ content, model, snapshot, tokens)
       token_usage_meter delta upsert
       inference dedup record        <- the re-bill / re-meter stop
       -> broadcast to the conversation Durable Object
```

Every write is one atomic batch through `commitEffectBatch`, with the outbox message enqueued in the
same batch as the rows it refers to (ADR-0064). A turn that exists therefore always has an audit row,
and a queued job always refers to rows that committed.

### 6.2 The context window is bounded, and the bound is a rule

The consumer sends the conversation's prior turns. Unbounded, this is the classic cost and latency
failure: turn 40 re-sends turns 1 through 39, so a long conversation's cost grows quadratically. It is
also a confidentiality fact, not only a cost one — every re-send is another transmission of the same
privileged content.

**The rule: at most the last 20 turns, and at most 128 KiB of total content, whichever binds first,
always ending on the member's newest turn.** When the window truncates, the member is told in the
response that earlier turns were not included. Silent truncation is the version of this that produces a
confidently wrong answer built on a premise the member believes was in scope.

### 6.3 The stub adapter

A second implementation of `InferencePort` — deterministic, reaching no network, echoing a fixed
transformation of its input. It is not a Magnus-specific test double; it is a **general-purpose
`InferencePort` implementation** that belongs in `@magna-carta/inference` beside the gateway one, and
every future AI feature gets it for free.

It does the load-bearing work in this design:

- The entire Magnus path — routes, consent gates, queue, batches, audit, metering, transport, the
  ceiling — is testable end to end with no provider, no credentials, and no spend.
- Slice 1 is **mergeable to `main` before ADR-0109 is decided**, because the default configuration
  reaches no provider and the consent gates default closed.
- The provider request-body translation (section 3.3) is isolated as the one thing the stub cannot
  prove, rather than being tangled with everything else.

The composition root resolves which implementation is in play, following three shipped precedents
exactly — `resolveScanPort`, `resolveEnginePort`, `resolveFlagEvaluator`: **absent binding or absent
configuration resolves to the stub.** The fail-safe direction is structural. A misconfigured
environment produces obviously-fake answers, never real spend on an unintended path.

## 7. Transport

### 7.1 Why not server-sent events on the request path

The natural instinct is SSE: hold the request open, stream tokens as they arrive. It is refused, and
not on taste.

**ADR-0112 requires off-hot-path queue dispatch for inference.** Not "prefers" — requires, and the
reason is multi-tenant fairness: one firm running long generations synchronously on the request path
consumes shared gateway capacity that every other firm is waiting for, with no place to apply
back-pressure. SSE puts the model call back on the hot path, which also collides with golden rule 10.
Separately, a Worker request holding a multi-second generation is exactly the shape the platform's
performance posture forbids everywhere else.

### 7.2 The shipped pattern, reused

The platform already solved "a slow job produces a result and the client wants to watch": the
push-progress WebSocket surface in [`../conventions/api.md`](../conventions/api.md), shipped on
`BundleBuildCoordinator` and `ConversionJob`, with its frame contract in one home at
`apps/worker/src/progress/job-progress-protocol.ts` — hibernation-aware so an idle subscription bills
nothing, byte-matched ping auto-response so a keepalive does not wake the object, `resync` after a
reconnect, and a poll endpoint that is a genuine fallback because both transports resolve through one
shared function.

Magnus reuses it exactly:

- `GET /api/v1/magnus/conversations/{conversationId}/turns/{turnId}` — the poll, returning
  `{ status, content?, failureLabel?, truncatedContext? }`.
- `GET /api/v1/magnus/conversations/{conversationId}/events` — the subscribe, pushing
  `{ type: "state", protocolVersion, state }` where `state` is that poll body verbatim.
- A `MagnusConversation` Durable Object keyed `firmId:conversationId`, addressed by the **session**
  firm id and never a path value, so a firm can only ever subscribe to its own conversations.

The consequential detail: **the Durable Object holds no conversation content.** It reads the turn's
state from the firm database and pushes it. This is what makes the retention posture in section 4
enforceable rather than aspirational — there is exactly one copy of a transcript, in the firm's own
database, and the transport is a view of it. It is also precisely the constraint that made the
`AIChatAgent` framework unusable here, per the Agents assessment: that framework persists conversation
history to the agent's own storage with no way to redirect it. Reusing the platform's own pattern
avoids the collision entirely rather than working around it.

### 7.3 Rate limits, three of them, doing three different jobs

- **The chokepoint's per-route limit** — the shipped `rateLimit` route metadata. Stops a client
  hammering the submit endpoint. Says nothing about cost.
- **A Magnus-specific per-firm daily turn ceiling** — `magnus.dailyTurnCeiling`, a per-firm setting
  with a real non-infinite default, counted from `magnus_turn` and checked at submission. This is the
  one that matters, because Magnus is the first surface where a single member can generate unbounded
  provider spend just by typing. A firm reaching its ceiling gets a clear message naming it, not a
  generic 429. Whether the default is a fixed number or a plan-derived one is a commercial question
  and out of scope; the setting exists either way.
- **`firmRateGate`** — the shipped per-firm back-pressure seam in the inference consumer, still a
  no-op, still the right place for a token bucket when load is measured. Magnus routes through it
  unchanged.

### 7.4 Idempotency

Two layers, both shipped patterns.

At submission, the chokepoint's idempotency key. A retried submit must not create a second turn pair
and must not enqueue a second job. This is the standard mutating-route posture and Magnus does not
deviate.

At the consumer, the dedup-record family from `token-usage-statements.ts` — namespaced
`magnus:<turnId>`, composed into the same batch as the metering write so a queue redelivery loses the
`UNIQUE(key)` race and its whole batch rolls back. The queue is at-least-once and the model spend
precedes the commit, so without this a redelivery both re-bills the provider and re-meters the firm.
The pending-status check gives the first guard for free: a redelivery finds the turn already
`complete` and returns before the model call.

### 7.5 Token streaming is deliberately not in slice 1

A member watching an answer appear is better than a member watching a spinner, and `InferencePort`
already has `generateStream`. It is still not in slice 1, because it is a genuine addition rather than
a variation: delta frames on the protocol (a `JOB_PROGRESS_PROTOCOL_VERSION` bump), partial content
accumulating somewhere before the turn row is final, and a decision about what a member sees when a
stream dies mid-answer — which is a record question, not a UI one, since a half-answer that was
displayed but not stored is a transcript that disagrees with what the member read.

The design is arranged so that adding it changes the consumer and the frame set and **nothing else**:
the record, the consent gates, the metering, the audit, the ceiling, and the socket lifecycle are all
already right. That is the whole reason for buffered-first, and it is a sequencing choice rather than a
capability judgement.

## 8. Redaction, audit, and cost

### 8.1 Nothing about a conversation is ever logged

Absolute, and enforceable in the three places it could go wrong.

- **The gateway** logs nothing: `collectLog: false` on every request (section 3.4). Guardrails off.
- **The platform's diagnostics pipeline** never receives turn content. A failure in the consumer logs
  the turn identifier, the correlation identifier, and the problem category — never the prompt, never
  the completion, never the upstream body. The shipped `gatewayFailure()` already returns a fixed
  caller-safe string for exactly this reason, and Magnus adds no path around it.
- **The audit metadata** is guarded by machinery, not by care: `refuseUnredactedMetadata` runs on every
  `audit_log` write and refuses unredacted metadata outright.

### 8.2 Audit records that a conversation happened

Events, all with identifier-only metadata:

`magnus.conversation_started` · `magnus.turn_submitted` · `magnus.turn_completed` ·
`magnus.turn_failed` (with the closed failure label) · `magnus.conversation_deleted` ·
`magnus.member_acknowledged` (with the disclosure version) · `magnus.setting_changed` (the enablement
flip, with the new value).

The last two are the ones a firm needs and would not think to ask for until it needed them: who
accepted what disclosure, and when the firm turned this on and off.

`magnus.turn_completed` carries the model id and snapshot id. That is provenance, not content, and it
is the fact that makes a specific answer traceable to a specific model version a year later.

### 8.3 Cost, two records answering two questions

**`token_usage_meter`** — the shipped per-firm rollup keyed `(day, slot, model_id)`, written by the
same delta upsert in the same batch. Magnus creates **no new usage table.** It would be a duplicate of
a shipped authoritative meter, and the `ai_detection_usage` precedent does not apply: that table exists
because Pangram bills by words rather than tokens and needed a different unit. Magnus bills in tokens
through the same gateway as every other inference call, so it uses the same meter, and the firm-usage
diagnostics surface picks it up with no change.

**The turn row's own `model_id`, `snapshot_id`, `input_tokens`, `output_tokens`** — per-turn
provenance. The meter answers "what did this firm spend in July"; the turn row answers "what produced
this specific answer, and what did this specific answer cost". Both are needed and neither derives the
other; the meter is a rollup that cannot be disaggregated, and the turn row cannot be summed across a
firm without a table scan.

Both are captured from the inference **response**, never from gateway logs — which is ADR-0113's
requirement, and which, given section 3.4, is also the only thing that could possibly work.

## 9. Who can read a transcript

Recommended default, consistent with ADR-0068's trusted-insider posture (RBAC gates actions, ethical
walls are a deferred named seam):

- **The author** reads and deletes their own conversations. `magnus:converse`.
- **A firm administrator** holding `magnus:readAllConversations` reads any conversation in the firm.
  This is the supervision surface, and it is a separate permission from using Magnus precisely so that
  "can use it" and "can read everyone's" are not the same grant.
- **Nobody else**, and **no client**. Magnus transcripts are firm-internal working material and do not
  appear in the client portal. A shipped conversation is not a communication to the client and must not
  be presented as one.
- An administrator's read of another member's conversation **writes an audit row**
  (`magnus.conversation_read_by_administrator`). The read is legitimate; it is also exactly the kind of
  access that should leave a trace, and the platform already takes that posture elsewhere.

## 10. Seams — named, and deliberately empty

### 10.1 Context: `MagnusContextPort`

**In slice 1, Magnus has no platform context at all.** The prompt is the system prompt plus the bounded
conversation window. Nothing reads a document, a matter, a calendar, or a directory entry.

The narrow start is recommended, and the reason is the disclosure. A Magnus that can read matter files
requires the firm to disclose that matter files are transmitted to a model provider — a materially
different statement under Rule 1.6 and ABA Formal Opinion 512 than "what you type is what is sent", and
one whose scope the firm cannot verify because it depends on what the retrieval layer happened to
select. The second sentence is one a firm can actually evaluate. Starting there means the first
disclosure is short, exact, and true, and it means the day retrieval arrives is the day the disclosure
changes and every member is re-prompted — which is the correct sequence, and which the
`disclosure_version` column in section 4.2 exists to make automatic.

The seam: a `MagnusContextPort` with one operation returning context fragments for a conversation, whose
only implementation returns none. When retrieval is designed it implements this port, the consumer
concatenates what it returns into the request, and **the number of other things that change is zero.**
The parallel research stream assessing Cloudflare AI Search owns what fills it; this design deliberately
does not, beyond noting that the Agents assessment already refused managed retrieval stores for the
semantic index on partitioning and index-pinning grounds, and that whatever fills this seam inherits
that argument.

The order in which the seam should be filled, recommended but not designed here: an **explicit
per-conversation context grant** — the member attaches a named document or matter and can see exactly
what was attached — before any implicit firm-wide retrieval. The grant is auditable, disclosable, and
bounded; implicit retrieval is none of the three.

### 10.2 Tools and actions: explicitly out of scope

**Magnus takes no action.** It cannot create a matter, book time, file a document, send mail, move
trust money, or edit anything. It answers, and its answer is text in a turn row that no other subsystem
reads.

This is a position, not a deferral. The platform's posture on its deterministic subsystems is already
recorded: conflicts must be deterministic for defensibility, docketing must be deterministic because
missed deadlines are the largest malpractice-claim source. A tool surface that lets a model write into
those subsystems contradicts decisions that have already been made for good reasons. And the honest
sequencing argument: the first version of a conversational assistant is where the platform learns what
members actually ask for. Building an action surface before that is building for a guess.

When it is built, the shape is known and the human-in-the-loop pattern is the one the Agents assessment
identified as the good fit: a tool proposes, a member approves, the approval is the audited act, and the
model's proposal is never itself a mutation.

### 10.3 Streaming, retrieval, model choice

Each named in its own section above with its seam already in place: section 7.5, section 10.1, section
12/F1.

## 11. Why slice 1 needs no open flag answered

Stated plainly, because it is the design's central sequencing claim.

| Open question             | Why the build does not wait                                                                                                                                                                                                        |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ADR-0109 — client consent | Both consent gates default **closed**, and the default adapter is the stub, which reaches no provider. Nothing is transmitted anywhere by a merged, unconfigured slice 1.                                                          |
| Which model               | Magnus reads the firm's existing `inference.primaryReasoningModel`, which ships with a default and a validated write path. The model is a per-turn recorded value and a gateway-side selection, never a constant in Magnus's code. |
| Who may use it            | `magnus:converse` is registered in the permission registry; **which roles hold it** is one line of role configuration, changeable without touching code.                                                                           |
| What Magnus can see       | Nothing, through a port that returns nothing. Filling it later changes the consumer and no other module.                                                                                                                           |
| Transcript retention      | The recommended default is built. A different answer changes visibility rules and a retention sweep, not the schema.                                                                                                               |

What slice 1 does **not** do, and must not be read as doing: it does not enable Magnus for any firm, and
it does not authorize sending privileged content to a provider. **Turning it on in production requires
ADR-0109 accepted and the ZDR procurement artifacts ADR-0110 names.** Slice 1 builds the thing that is
then switched on — which is the correct order, because the alternative is a consent decision made in
the abstract about a system nobody has seen.

## 12. Owner flags

Four, each with a recommended default the build implements unless the owner says otherwise.

**F1 — Model choice.** _Recommended:_ Magnus uses the firm's existing `inference.primaryReasoningModel`
(default `anthropic/claude-opus-4-8`); no Magnus-specific model setting. One firm-level model answer is
simpler to explain and to disclose. _Flagged because:_ the Agents assessment asked whether a
conversational surface should be held to a narrower catalog slice than a bounded drafting aid, since it
carries more privileged content across more matters per call. The alternative is a `magnus.modelId`
setting refined over a narrower subset, or pinning the strictest firms to the on-Cloudflare Workers AI
path. Reversible: an added setting, no schema change.

**F2 — User access scope.** _Recommended:_ firm setting off by default, plus `magnus:converse` granted
to Owner, Admin, Attorney, and Paralegal; `magnus:readAllConversations` to Owner and Admin only. _The
actual flag_ is the role list — particularly whether support staff and contract personnel are included.
Reversible: role configuration.

**F3 — Context boundary.** _Recommended:_ no platform context in slice 1; an explicit per-conversation
member-attached grant next; implicit firm-wide retrieval never, without a fresh consent decision of its
own. _Flagged because:_ it is the single largest determinant of how useful Magnus is, and the owner may
weigh usefulness differently. Section 10.1 is the full argument.

**F4 — Transcript retention.**
_F4a, recommended:_ transcripts are firm records — kept, author-and-administrator visible, never
client-visible, member-deletable with an audited delete, erasable via conversation deletion registered
in the PII registry. Section 4.1 argues it and states its cost honestly.
_F4b, the sub-question that needs a professional judgement rather than an engineering one:_ do
transcripts attached to a matter fall under the same legal holds and matter-close retention as
correspondence? The schema is built so this is a policy change, not a migration.

---

## Appendix A — What this design does not touch

`packages/inference/`'s gateway options, catalog, ZDR guard, or settings, other than the one additive
`generateConversation` operation and its request-body translation. The chokepoint order. The audit
write path or its redaction guard. The `token_usage_meter` schema. `firmRateGate`. The push-progress
frame contract, except a version bump when token streaming lands. The client portal.

## Appendix B — Rejected alternatives, in one place

| Rejected                                                     | Because                                                                                                                                               |
| ------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `MagnusModelPort` — a second model port                      | A second confidentiality control plane whose failure mode is silent (section 3.1)                                                                     |
| Flattening the transcript into `prompt: string`              | Destroys the role boundary and puts provider formatting in the caller (section 3.2)                                                                   |
| A polymorphic `prompt: string \| Message[]`                  | Every implementation and every double handles both, across three operations (section 3.2)                                                             |
| The Cloudflare Agents SDK / `AIChatAgent`                    | Persists conversation history to the agent's own storage with no redirection seam — irreconcilable with the transcript as a firm record (section 7.2) |
| Server-sent events on the request path                       | Puts the model call on the hot path; ADR-0112 requires queue dispatch (section 7.1)                                                                   |
| Gateway metadata-only logging (`cf-aig-collect-log-payload`) | A `cf-aig-*` header; ADR-0113 pins the control plane to the binding's options object (section 3.4)                                                    |
| Gateway Guardrails                                           | They log user prompts and model responses — a retention surface behind a dashboard toggle (section 3.4)                                               |
| A `magnus_usage` table                                       | `token_usage_meter` is the shipped authoritative meter and Magnus bills in the same unit (section 8.3)                                                |
| A model-generated conversation title                         | A model call over privileged content, producing a second copy of it in a column that surfaces in lists (section 4.2)                                  |
| A per-conversation "do not retain" mode                      | The question "why was that one off the record" is worse than any answer (section 4.1)                                                                 |
| A per-member enable/disable setting                          | A second authorization mechanism the chokepoint does not know about (section 5.2)                                                                     |
| Unbounded conversation history in the request                | Quadratic cost growth, and a re-transmission of privileged content on every turn (section 6.2)                                                        |
| Turn content in R2 from day one                              | A capped turn is not bulk; the cap is what keeps that true, and the R2 escalation is a named seam (section 4.3)                                       |
