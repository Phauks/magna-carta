# Cloudflare Agents — Platform Assessment

**Date:** 2026-08-04 · **Revised:** 2026-08-04 (second pass — full documentation crawl)
**Scope:** What Cloudflare's Agents platform is (the `agents` SDK, the Think harness, and the surrounding Agents Week 2026 surface), what community signal exists, and an honest fit assessment against Magna Carta's existing Durable Objects / Queues / Workflows / `@magna-carta/inference` foundation.
**Purpose:** Research prompted by an owner-supplied Reddit link. This is **research, not a spec and not a decision.** Nothing here is built or committed; everything labelled a recommendation is a recommendation only. The binding decisions in this area are already recorded — ADR-0109 through ADR-0113 (AI / inference) and ADR-0003 (tenancy) — and nothing in this document changes them.

**Method note.** The first pass of this document was written from the docs landing page, the blog posts, changelog entries, and search results. That pass **got several load-bearing things wrong.** This revision follows a complete crawl of `developers.cloudflare.com/agents/` — all 123 pages enumerated from the sitemap and read as raw markdown rather than through a summarizer. Section 2 lists every claim that changed. Where this document now contradicts the first version, this version is the correct one.

---

## 1. Summary

Cloudflare's Agents platform is **a runtime plus an optional harness on top of Durable Objects.** The docs themselves draw that line: the runtime answers "where does this agent live and how does it stay durable?", the harness answers "what does this agent do on each turn?", and **building your own harness directly on the `Agent` class is a documented, first-class path** — you are not obliged to take the opinionated chat framework to get the runtime.

The runtime gives you named-instance routing, a `setState()` store that syncs to connected clients, per-agent SQLite, four-mode scheduling multiplexed over the single Durable Object alarm, WebSocket lifecycle with hibernation, an internal FIFO task queue, sub-agents with isolated storage, email/Slack/voice/webhook channels, MCP client and server, and bidirectional Workflows integration. `@cloudflare/ai-chat` adds `AIChatAgent` — message persistence, resumable streaming, and durable chat recovery.

**The revised verdict is more favourable than the first pass, and the reason is specific.** Three of the objections in the first version do not survive contact with the documentation: AI Gateway is not absent from the model path, the client is not React-only, and agents do not have to bypass the existing worker chokepoint. What remains is narrower and sharper: **the one architectural conflict that is real is message persistence** — `AIChatAgent` writes conversation history to the agent's own SQLite, and there is no pluggable storage backend to redirect it to the firm database. There is a redaction hook, but not a redirection seam.

Set against the coordination work this codebase already does well, the SDK still buys little: the naming, alarm, single-flight, and queue-handoff patterns are written here already and are firm-scoped by construction. What it buys that does not exist here is **resumable streaming with durable recovery** — and that is now demonstrably more sophisticated than "fiddly to write yourself," with fiber-backed recovery, progress-aware budgets, and a documented per-provider recovery strategy.

So the recommendation stands where it was, but for better-understood reasons: **prototype the transport shell, adopt nothing yet, and keep the model call in `InferencePort` and the durable record in the firm database.** The difference is that this is now a _thin_ constraint on an otherwise well-fitting runtime, not the three-ADR collision the first pass described.

---

## 2. Corrections from the first pass

Recorded explicitly, because the first version of this document is in the branch history and someone may read it.

| Claim in the first pass                                                                                    | Status                                                | What the docs actually say                                                                                                                                                                                                                                                                                                                                                       |
| ---------------------------------------------------------------------------------------------------------- | ----------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| "AI Gateway is **not** on the default model path... every one of those controls would be absent, silently" | **Wrong as stated — corrected**                       | `Using AI Models` has a dedicated **Model routing** section showing `this.env.AI.run(model, input, { gateway: { id, skipCache, cacheTtl } })` called from inside an Agent — the identical binding-plus-gateway-options shape `@magna-carta/inference` already uses, and the exact surface ADR-0113 pins. The residual risk is a _default_, not an architectural gap (see below). |
| "the ergonomic half of the SDK's pitch does not apply here" (React-only client)                            | **Overstated — corrected**                            | `AgentClient` from `agents/client` is a framework-agnostic class for "browsers, Node.js, Deno, Bun, or edge functions" with state sync, RPC plus a typed `stub` proxy, chunk streaming, auto-reconnection with exponential backoff, and event listeners; `agentFetch` covers HTTP. Only `useAgent` / `useAgentChat` / `useAgentToolEvents` are React.                            |
| "the Agents route pattern bypasses [tenancy, authn, RBAC, idempotency, rate-limit]"                        | **Wrong — corrected**                                 | `getAgentByName(env.MyAgent, name)` followed by `agent.fetch(request)` is the documented **server-side instance selection** pattern, explicitly for when "the instance name is determined server-side (for example, from auth/session)". `routeAgentRequest()` is optional. An agent can sit entirely behind the existing worker chokepoint.                                     |
| "1 GB vs 10 GB — treat 1 GB as the number until Cloudflare's own page says otherwise"                      | **Refined**                                           | Both figures are real and both are official. Agents limits: **1 GB max state per unique Agent**. Durable Objects limits: **10 GB storage per Durable Object** (SQLite-backed). The docs do not reconcile them. Plan against 1 GB.                                                                                                                                                |
| "`AIChatAgent` auto-persists ... no redaction" (implied)                                                   | **Refined — partly answered, core concern confirmed** | `sanitizeMessageForPersistence(message)` is an explicit override that runs _after_ built-in sanitization and can rewrite or redact parts before they are stored; `maxPersistedMessages` caps stored history. But a search of all 123 pages finds **no pluggable storage backend** for chat messages — you can transform what is persisted, you cannot redirect where.            |
| "the SDK's contribution here is a schedules table over one alarm" (scheduling)                             | **Accurate but incomplete**                           | Four modes: delayed (seconds), `Date`, **cron**, and interval via `scheduleEvery()`. SQLite-backed, multiplexed through the single alarm slot, and paired with `keepAlive()` for the 70–140 second inactivity eviction window.                                                                                                                                                   |
| Think described only as "experimental preview, four months old"                                            | **Confirmed, and now better documented**              | Think is still explicitly experimental ("may evolve before Think graduates out of experimental"), but it now has a full documented surface — actions, channels, client tools, lifecycle hooks, messengers, recovery, scheduled tasks, sub-agent RPC, tools, and Workflows. Defer still holds; the reason is churn, not thinness.                                                 |

**Missed entirely in the first pass**, and material: email as a channel (`onEmail`, `sendEmail`, `replyToEmail`, `routeAgentEmail` with address-based resolvers); the runtime-versus-harness split and the supported build-your-own-harness path; tracing payload privacy (payloads are **not** recorded by default); data jurisdiction pinning (`jurisdiction: "eu"` / `"fedramp"`, plus Durable Objects data-location controls); sub-agent storage isolation; the agent-internal `queue()` FIFO (per-agent SQLite, distinct from Cloudflare Queues); `AgentWorkflow` bidirectional Workflows integration with approval/rejection; chat-recovery cost budgets via `shouldKeepRecovering`; and the Slack, voice, webhook, and push-notification channels.

---

## 3. Could not read the linked thread

The owner-supplied link is `https://www.reddit.com/r/CloudFlare/s/p6AdOkBnuh`. **It could not be read.** Reddit is blocked to the fetch tool outright, and a direct request returns HTTP 403 from Reddit's edge (`old.reddit.com` likewise), so the `/s/` share slug never resolved to a thread ID. The slug is not indexed by any search engine reachable from here, so the thread could not be identified by content either.

**The community signal in section 5 is therefore substitute evidence from other sources, not the thread the owner pointed at.** If the thread matters, its text or resolved permalink is needed.

---

## 4. What the platform actually is

### 4.1 Runtime versus harness

The docs separate these deliberately:

- **The runtime** (`agents`) — identity, durability, storage, connections, scheduling, execution. This is the Durable Object plus conveniences.
- **The harness** — the turn loop: model calls, prompt construction, tool selection, stream handling, memory strategy, lifecycle hooks. Either `AIChatAgent`, or Think, or **your own**: "Build your own harness directly on the Agent class" is listed as a supported option, "the right approach when you want full control over the model call, message format, tool loop, or UI protocol."

That last sentence is the single most relevant line in the documentation for this codebase, because full control over the model call is exactly what ADR-0111 requires.

### 4.2 The Agent class

`Agent` extends `DurableObject`. Instances are globally unique by name. Beyond that:

- **State.** `setState()` persists and pushes to every connected client; `this.sql` is per-agent SQLite. Both survive hibernation; class properties do not.
- **Scheduling.** `this.schedule(seconds | Date | cron, method, payload)` and `this.scheduleEvery(seconds, ...)`, stored in a SQLite table, executed in order, multiplexed through the one Durable Object alarm. `keepAlive()` holds an alarm-backed heartbeat against the 70–140 second inactivity eviction.
- **Queue.** `this.queue(callback, payload, { retry })` — an internal per-agent FIFO in SQLite with exponential-backoff retries. Not Cloudflare Queues; a different tool for a different job.
- **WebSockets.** `onConnect` / `onMessage` / `onClose` / `broadcast`, with per-connection state, hibernation on by default (`static options = { hibernate: false }` to disable).
- **RPC.** `@callable()` exposes methods to external clients; `@callable({ streaming: true })` streams chunks to a client with `onChunk` / `onDone` / `onError` callbacks. Within the same Worker, plain Durable Object RPC works without the decorator.
- **Sub-agents.** `subAgent()` spawns children as Durable Object facets — co-located, typed RPC, **fully isolated SQLite** per child, no separate bindings needed.
- **Email.** `onEmail()` for inbound, `sendEmail()` / `replyToEmail()` for outbound, `routeAgentEmail()` with resolvers (including address-based) to route a message to the right instance.
- **Workflows.** `AgentWorkflow` from `agents/workflows` gives bidirectional communication — `runWorkflow()`, `sendWorkflowEvent()`, `approveWorkflow()` / `rejectWorkflow()`, pause/resume/terminate/restart.

### 4.3 Routing, and why it matters here

Two documented entry points:

1. `routeAgentRequest(request, env)` — convention-based, `/agents/:agent/:instance`.
2. `getAgentByName(env.MyAgent, name)` then `agent.fetch(request)` — **server determines the instance**, explicitly for auth/session-derived names.

The second is the one that matters: it means an agent can live behind the existing `/api/v1` chokepoint with the instance name derived from the authenticated firm and user, exactly as `firmDatabaseFor(firmId, env)` already derives a Durable Object today. The first pass claimed the opposite and was wrong.

### 4.4 `AIChatAgent`

Extends `Agent`. Messages persist to SQLite; streams resume on disconnect; messages broadcast to all connected clients; row-size protection compacts messages approaching SQLite limits.

- **`onChatMessage(onFinish, options)`** is the method you override and the method that makes the model call. This is where an `InferencePort` call would go. `options` carries `abortSignal`, `body` (custom per-request data from the client), `requestId`, and `continuation`.
- **`sanitizeMessageForPersistence(message)`** — override to transform messages before storage, running after built-in sanitization. A redaction seam.
- **`maxPersistedMessages`** — caps stored history (storage only; use the AI SDK's `pruneMessages()` to control what reaches the model).
- **`persistMessages()`** stores without triggering a turn; **`saveMessages()`** stores and triggers one, returning `{ requestId, status }`.
- **`messageConcurrency`** — `queue` (default), `latest`, `merge`, `drop`, or debounce, for overlapping submissions.
- **`chatRecovery`** — defaults to `false` on `AIChatAgent` (Think defaults it to `true`). When enabled, each turn runs inside a fiber; if the Durable Object is evicted mid-stream the fiber row survives, the partial response is reconstructed from buffered chunks, and `onChatRecovery` fires. Bounded by `maxAttempts`, `noProgressTimeoutMs` (resets on forward progress), `maxRecoveryWork`, and a `shouldKeepRecovering(ctx)` hook explicitly intended for enforcing a token or cost budget. Turns waiting on a human are exempt from every budget.
- **Per-provider recovery strategy** is documented, and the Anthropic row is the relevant one for this codebase's catalog: _"Persist partial, send a synthetic user message to continue — medium token cost."_ Workers AI continues via assistant prefill (low cost); OpenAI's Responses API can retrieve the completed response by ID (zero wasted tokens).

There is no pluggable persistence backend. That is the real constraint.

### 4.5 Limits, pricing, residency, observability

- **Limits (Agents):** tens of millions of concurrent agents per account; ~250,000 definitions; **1 GB max state per unique Agent**; **30 seconds compute per HTTP request, scheduled task, or incoming WebSocket message**, refreshed per event; wall-clock per step unlimited.
- **Limits (Durable Objects substrate):** 10 GB storage per Durable Object, SQLite-backed. Not reconciled with the 1 GB agent figure in the docs.
- **Pricing:** no Agents SKU. Billed as Workers plus Durable Objects — $5/month account minimum; 1M DO requests included then $0.15/M; 400,000 GB-s duration included then $12.50/M GB-s; incoming WebSocket messages at **20:1**; SQLite storage billing live since January 2026. Duration is **not** billed while hibernating.
- **Residency:** `jurisdiction: "eu"` and `"fedramp"` are supported for pinning instances, on top of the general Durable Objects data-location controls.
- **Observability:** tracing shows each turn, model call, tool run, and token usage. **Payloads are not recorded by default** — Think does not store message or tool payloads unless you override the properties, and `wrapAISDK()` does not either. Recording is opt-in, with the docs warning to "only record payloads that are safe to store."

That default is the right way round for this codebase, and it is worth saying plainly: the first pass implied agent observability would be a confidentiality problem, and on the documented defaults it is not.

---

## 5. Community signal

The linked thread is unreadable (section 3), so this is substitute evidence, and it is thin — which is itself a signal about how much production experience is publicly written up.

**Praise.** The durable, addressable agent unit removes the external-store dance. On Hacker News, discussing Project Think, a commenter singled out `runFiber()` checkpointing — "a 30-minute multi-step task survives a restart with state intact." Durable Objects are described by practitioners as "the missing primitive for production agents," and hibernation genuinely does make idle sessions free.

**Criticism.**

- **Novelty scepticism.** The bluntest reply argued this is achievable with "any VM with SQLite + WebSockets for realtime sync of state." Fair against the marketing, and it lands harder here where the primitives are already in production use.
- **Context-recovery quality.** A developer reported an agent recovering from a crash "skimmed through the context and skipped over its own findings" — durable _state_ is not durable _reasoning_. For a legal product that is the difference between a resumed job and a resumed job that quietly did less than it reported. Worth noting that the documented recovery machinery has since grown transcript repair for orphaned tool calls, which addresses part of this.
- **Pre-1.0 churn.** `agents` is at **0.20.1** with **645 published versions**; practitioner guidance is to pin and expect monthly change, and the repository is reported as not accepting external pull requests while the surface stabilizes.
- **Durable Object constraints leak through.** One alarm per object (multiplexed, but yours to debug), single-threaded with a soft ~1,000 requests/second per object, and a known issue where an object that stops being current only discovers this if the event touches storage.
- **Lock-in.** No drop-in equivalent on AWS or GCP; porting means reintroducing the external-store pattern.

**Production readiness.** The substrate (Durable Objects, Workflows v2, Sandboxes) is GA. The `agents` runtime is pre-1.0 but broadly documented and widely used. Think is explicitly experimental.

---

## 6. Fit assessment against Magna Carta

### 6.0 The constraints every candidate clears — revised

The first pass listed three; the documentation dissolves one and softens another.

1. **The chokepoint (ADR-0111) — satisfiable cleanly.** `onChatMessage()` is the designated override, and `env.AI.run(model, input, { gateway })` is documented from inside an Agent. Putting `InferencePort` there is using the framework as designed, not fighting it. The residual risk is that the _quick-start default_ reaches for `createWorkersAI({ binding })` through the AI SDK, and the OpenAI and Anthropic AI-SDK adapters bypass the `AI` binding entirely — so a copy-pasted example silently loses the control plane. That is a lint-and-review problem, not an architecture problem.
2. **The firm-scoped data-access layer (golden rule 3, ADR-0003) — the one real conflict.** `AIChatAgent` persists privileged conversation content to the agent's own SQLite: no `protected()` encryption, no audit row, no retention policy, no legal-hold semantics, no matter-scoped access control, invisible to discovery and to the support-access framework's permission model. `sanitizeMessageForPersistence()` lets you redact before storage; nothing lets you redirect storage. Either the durable record is written separately through `firmDatabaseFor()` with the agent's SQLite treated as an ephemeral cache, or `AIChatAgent` is not used and the persistence layer is written against the plain `Agent` class.
3. **Consent is not yet decided (ADR-0109, still Proposed).** Unchanged, and still the gate.

### 6.1 AI matter-assistant / chat over firm data

**What the SDK buys — more than the first pass credited.** Resumable streaming across disconnects; fiber-backed durable recovery when the Durable Object is evicted mid-generation, with progress-aware budgets and a `shouldKeepRecovering` hook that maps directly onto a per-firm spend cap; message broadcast across a user's open tabs; hibernating WebSocket transport so an idle assistant panel costs nothing; client-side and approval-gated tool patterns for human-in-the-loop. None of this exists in this repo. `LiveTimerDurableObject` is the closest live-connection precedent and it is not a streaming transport.

**What it does not buy.** Per-firm instance naming — already solved and already enforced. Nor does it require giving up the request chokepoint, since `getAgentByName()` takes a server-derived name.

**The isolation story, concretely.** Instance grain is per-user-per-session, not per-firm — a firm-grain agent would serialize every user in the firm through one single-threaded object. Name it `firmId:userId:sessionId`, derive all three server-side after authentication, and the tenancy story is identical to the one already in production. The durable transcript goes to the firm database; the agent's SQLite holds the in-flight turn.

**Confidentiality.** Workable, with the model call in `InferencePort` and payload tracing left at its default (off). The open question is not mechanical: a chat surface sends more privileged content per call, across more matters, than a bounded drafting aid, and the Anthropic recovery strategy — resend a synthetic user message to continue — means an interrupted turn re-sends conversation context to the provider. That is a consent-relevant fact, not just a cost one.

**Cost.** Inference dominates. The Durable Object shape is a real secondary change: request-scoped today, versus a long-lived connection billed on duration whenever it cannot hibernate, with incoming WebSocket messages at 20:1. Recovery re-sends cost tokens, which is why `shouldKeepRecovering` exists.

**Assessment:** still the strongest candidate, still a **prototype** — but the prototype is now a smaller, better-specified piece of work than the first pass implied.

### 6.2 Document-drafting assistance over the template / merge system

Unchanged: **defer.** `InferencePort` already names streaming and durable Workflow-invocable variants; `DocumentSession` already exists for collaborative editing. Drafting is a bounded generate-and-review operation where determinism is a feature. Build against `InferencePort` when slice 2·6 opens.

### 6.3 Intake triage

Unchanged: **defer** — with one addition. The email channel (`onEmail`, `routeAgentEmail` with address-based resolvers) is a closer fit to intake and to matter-mail capture than anything the first pass considered, and it is worth remembering when slice 6·5 gets its spec. The confidentiality wrinkle stands: prospective-client confidentiality attaches, and intake content is conflict-bearing, so intake is not "the safe place to try AI."

### 6.4 The search subsystem's semantic half

Unchanged: **refuse the managed services.** The semantic half is designed — Vectorize with namespace-per-firm partitioning, 1024-dimension `bge-large-en-v1.5` through `InferencePort.embed`, fused with Tantivy BM25 hits, embedding model pinned to the index version and per-firm variation unrepresentable in the type signature. Agent Memory and AI Search would duplicate that, place content and embeddings in a managed store outside the per-firm partition, and break the pin.

### 6.5 Agentic workflows over the practice-management graph

Unchanged: **refuse the agentic framing** for conflicts (deterministic by design, for defensibility) and deadlines (malpractice surface; docketing must be deterministic, auditable, explainable). Advisory, human-reviewed, propose-only work is where an agent loop legitimately fits, and that pattern already runs here without the SDK.

One addition worth recording: `AgentWorkflow`'s `approveWorkflow()` / `rejectWorkflow()` and the tool-approval (`needsApproval`) pattern are a genuinely good fit for _human-in-the-loop_ gates — which is the shape any advisory legal feature needs. That is an argument for the pattern, not for adopting the dependency today.

---

## 7. Migrating the existing Durable Objects to the Agent class

The owner's question: at **zero conversion cost**, what would each existing class gain by becoming an `Agent`, versus simply adopting Durable-Object-native WebSocket hibernation on the classes as they stand?

**The framing answer first.** The capability actually worth having — pushing live progress to the browser instead of polling — is **not gated on the Agents SDK.** The Durable Objects Hibernation WebSocket API (`ctx.acceptWebSocket()`, `webSocketMessage()`, `getWebSockets()`, `serializeAttachment()` / `deserializeAttachment()`) is native, GA, and documented as the recommended approach, and billable GB-s do not accrue while hibernating. Any of these classes can gain push-progress without a new dependency. What the Agent class adds on top is `setState()` broadcast ergonomics and `@callable()` typed RPC — convenience over a capability you already have.

Per class, assuming conversion were free:

| Class                        | What the Agent class would add                                                                                                                                                                                                                                           | Verdict                                                                                          |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------ |
| **`FirmDatabase`**           | Nothing wanted. It is a SQL host for the firm's own database and migration lineage. The Agent class would introduce its own reserved tables (schedules, queue, fiber rows) **into that same SQLite database**, colliding with the firm schema and its migration lineage. | **Refuse.** Actively harmful, not merely useless.                                                |
| **`ConversionJob`**          | `this.schedule()` in place of the hand-rolled stuck-deadline alarm; `setState()` push-progress in place of polling. The internal `queue()` is the wrong tool — real Cloudflare Queues are needed to reach the container workers.                                         | **No migration.** Take DO-native hibernation WebSockets for progress if progress push is wanted. |
| **`SearchIndexJob`**         | Same as above; indexing progress is a plausible push-progress surface.                                                                                                                                                                                                   | **No migration.** Same route.                                                                    |
| **`BundleBuildCoordinator`** | Same as above; bundle-build progress is the most user-visible of the job coordinators.                                                                                                                                                                                   | **No migration.** Best candidate for DO-native push-progress.                                    |
| **`RecoveryJobCoordinator`** | `this.schedule()` ergonomics. Its fan-out/first-hit-cancel logic across shards is domain-specific and gains nothing. Note it deliberately holds a password hash and purges it — an opinionated framework storing state on your behalf is the wrong direction here.       | **No migration.** Confidentiality argues against added framework state.                          |
| **`LiveTimerDurableObject`** | The closest genuine fit: `setState()` with automatic client sync is close to what it hand-rolls, and hibernation is already the right model for a timer.                                                                                                                 | **No migration, but the closest call.** Revisit only if the timer grows multi-client sync needs. |
| **`DocumentSession`**        | Connection management and `broadcast()` are relevant, but collaborative editing rides Collabora's own protocol; the Agent state model does not fit a CRDT/OT session.                                                                                                    | **No migration.**                                                                                |

**Verdict.** Migration is **not worth it for any of the seven**, and is actively wrong for `FirmDatabase`. The gains are ergonomic (`schedule()` over `setAlarm()`, `setState()` over hand-rolled broadcast), and they are outweighed by taking a pre-1.0 dependency into the coordination layer of a privileged system. The valuable capability hiding inside the question — live progress push — is available natively today, and **adopting DO-native hibernation WebSockets on `BundleBuildCoordinator` and `ConversionJob` is the better version of the same idea** at a fraction of the risk.

**Does the full documentation change the calculus?** For the coordinators, no — if anything it strengthens the case against, because the Agent class's reserved SQLite tables are a concrete new hazard for `FirmDatabase`. For the _chat_ case, yes, twice over: the Svelte-usable `AgentClient` removes the client-side objection entirely, and the durable-recovery machinery (fibers, progress-aware budgets, transcript repair, per-provider strategy) is materially better than what a first implementation would produce. That is a revision in the SDK's favour, and it is confined to the assistant surface.

---

## 8. Next steps

Sequenced, sized, and labelled. Nothing here is a decision; items marked owner-decision are requests for one.

**Do now (small, no new dependency)**

1. **Add Agents, Think, and `@cloudflare/computer` to the Cloudflare platform-watch agent's watch list.** Trigger conditions: `agents` reaching 1.0, Think graduating out of experimental, and any change to the Agents limits or pricing page. _Size: under an hour._
2. **Re-verify ADR-0113's control-plane surface against the May 2026 AI Gateway REST release.** The gateway now exposes a universal `/ai/run`, OpenAI-compatible, Responses-compatible, and **Anthropic-compatible `/ai/v1/messages`** endpoints. ADR-0113 pins the control plane to the `AI` binding's `gateway` options and rejects `cf-aig-*` headers; confirm that reasoning is still current. Independent of anything to do with Agents. _Size: half a day, docs only._
3. **Record the 1 GB agent-state versus 10 GB Durable-Object-storage figures** wherever the platform's Cloudflare limits are tracked, flagged as unreconciled upstream. _Size: minutes._

**Do now (build-when-in-the-area, no Agents dependency)**

4. **Adopt Durable-Object-native hibernation WebSockets for push-progress on `BundleBuildCoordinator`, then `ConversionJob`.** This is the capability the migration question was really reaching for, it needs no new dependency, and it removes polling from the two most user-visible job surfaces. Ship behind the existing job-status contract so the polling path stays as fallback. _Size: one slice-sized piece of work per class; do one, measure, then decide on the second._

**Prototype (fenced, throwaway, synthetic data only)**

5. **A matter-assistant transport shell**, alpha-flagged, **on synthetic load-profile fixtures with no firm data at any point**. Built as: plain `Agent` (or `AIChatAgent` with persistence treated as an in-flight cache), instance named `firmId:userId:sessionId` derived server-side via `getAgentByName()` behind the existing `/api/v1` chokepoint, the model call in `onChatMessage()` going through `InferencePort` and nothing else, the durable transcript written through `firmDatabaseFor()`, `sanitizeMessageForPersistence()` used as a defence-in-depth redactor, tracing payloads left off, and a Svelte 5 wrapper around `AgentClient`. _Size: a week, deliberately throwaway._
   **The question it answers:** does fiber-backed durable recovery plus resumable streaming justify a pre-1.0 dependency in a privileged path, given the transcript has to be written twice anyway? A negative answer is a good outcome and cheap to reach.
6. **Measure the cost shape while prototyping** — Durable Object duration under a realistic session, the 20:1 WebSocket message ratio, and the token cost of an Anthropic-strategy recovery (which re-sends context). Feed the numbers to owner question 7. _Size: folded into the prototype._

**Defer**

7. Think in full (fibers, sub-agents on facets, tree-structured sessions, sandboxed code execution), Code Mode, Browser Run, Voice Pipeline, `@cloudflare/computer`, agentic payments. Revisit when Think graduates.
8. Document-drafting assistance and intake triage as Agents-SDK candidates — they belong to slices 2·6 and 6·5 and their own specs. Note the email channel when 6·5 is specced.

**Owner-decision (blocking any AI feature)**

9. **ADR-0109 — the client-consent model.** Still Proposed. Nothing in section 6 ships before it is recorded.
10. **Whether the assistant transcript is a client record** (section 9, question 3). This one is _architecturally_ blocking rather than merely policy-blocking: it determines whether the transcript can live in agent SQLite at all, and therefore whether `AIChatAgent` is usable as-is or must be replaced with a plain `Agent` plus a firm-database persistence layer. Answer it before the prototype graduates to anything real.

---

## 9. Owner questions any AI feature raises

Independent of Cloudflare Agents. This research does not answer any of them.

1. **ADR-0109 is still Proposed.** May privileged matter content go to a third-party frontier model at all, and under what consent — engagement-letter blanket, or per-matter? The white paper states this must be recorded before the first AI feature ships.
2. **Does a conversational surface change the model answer?** A chat assistant sends more privileged content per call, across more matters, than a bounded drafting aid — and under the documented Anthropic recovery strategy, an interrupted turn re-sends context to continue. Should the assistant inherit the firm's primary reasoning-model setting, or be restricted to a narrower slice of the ZDR-eligible catalog, or to the on-Cloudflare Workers AI path?
3. **Is conversation history a client record?** Subject to retention, discovery, and legal hold; visible to the client through the portal; readable by whom inside the firm? This is now known to be architecturally load-bearing, not just policy — see next step 10.
4. **What consent granularity does a cross-matter assistant need?** A per-matter drafting aid and an assistant retrieving across the whole firm corpus are different disclosures under Rule 1.6 and ABA Formal Opinion 512.
5. **Is a pre-1.0, weekly-moving dependency acceptable in a privileged path?** Golden rule 11 says build on the latest; it does not say build on the unstable. 645 published versions and a repository not taking external pull requests is a maintenance posture to accept explicitly or not at all.
6. **Does the platform want an MCP surface at all?** Being an MCP server means firm data reachable by AI clients the platform does not control. A product and confidentiality decision, not an engineering one.
7. **Is the cost shape acceptable?** Long-lived per-user WebSocket sessions bill on Durable Object duration whenever they cannot hibernate, incoming messages at 20:1, recovery re-sends cost tokens, all on top of provider rates plus the 5% Unified Billing fee. Next step 6 produces the number.
8. **Data residency.** Agents inherit Durable Object placement, and `jurisdiction: "eu"` / `"fedramp"` pinning exists. Where a firm's agent instances — and its `FirmDatabase` — are permitted to run should be answered once for both, and possibly as a per-firm setting.

---

## 10. Sources

**Primary — the full `developers.cloudflare.com/agents/` tree**, enumerated from the sitemap (123 pages) and read as raw markdown on 2026-08-04. Pages most load-bearing for this assessment:

- [Runtime: Using AI Models](https://developers.cloudflare.com/agents/runtime/operations/using-ai-models/) · [Agent class](https://developers.cloudflare.com/agents/runtime/lifecycle/agent-class/) · [State](https://developers.cloudflare.com/agents/runtime/lifecycle/state/) · [Callable methods](https://developers.cloudflare.com/agents/runtime/lifecycle/callable-methods/) · [Sessions](https://developers.cloudflare.com/agents/runtime/lifecycle/sessions/)
- [Communication: WebSockets](https://developers.cloudflare.com/agents/runtime/communication/websockets/) · [Routing](https://developers.cloudflare.com/agents/runtime/communication/routing/) · [Client SDK](https://developers.cloudflare.com/agents/communication-channels/chat/client-sdk/) · [Chat agents](https://developers.cloudflare.com/agents/communication-channels/chat/chat-agents/) · [Email](https://developers.cloudflare.com/agents/communication-channels/email/)
- [Execution: Schedule tasks](https://developers.cloudflare.com/agents/runtime/execution/schedule-tasks/) · [Queue tasks](https://developers.cloudflare.com/agents/runtime/execution/queue-tasks/) · [Durable execution](https://developers.cloudflare.com/agents/runtime/execution/durable-execution/) · [Sub-agents](https://developers.cloudflare.com/agents/runtime/execution/sub-agents/) · [Run workflows](https://developers.cloudflare.com/agents/runtime/execution/run-workflows/)
- [Operations: Configuration](https://developers.cloudflare.com/agents/runtime/operations/configuration/) · [Tracing](https://developers.cloudflare.com/agents/runtime/operations/observability/tracing/)
- [Concepts: What are agents?](https://developers.cloudflare.com/agents/concepts/what-are-agents/) · [Using Agents with Workflows](https://developers.cloudflare.com/agents/concepts/workflows/) · [Long-running agents](https://developers.cloudflare.com/agents/concepts/agentic-patterns/long-running-agents/) · [Human-in-the-loop](https://developers.cloudflare.com/agents/concepts/agentic-patterns/human-in-the-loop/)
- [Harnesses](https://developers.cloudflare.com/agents/harnesses/) · [Think](https://developers.cloudflare.com/agents/harnesses/think/) · [Platform limits](https://developers.cloudflare.com/agents/platform/limits/)

**Supporting Cloudflare documentation:** [Durable Objects limits](https://developers.cloudflare.com/durable-objects/platform/limits/) · [Durable Objects pricing](https://developers.cloudflare.com/durable-objects/platform/pricing) · [Durable Objects WebSockets and hibernation](https://developers.cloudflare.com/durable-objects/best-practices/websockets/) · [Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/) · [AI Gateway](https://developers.cloudflare.com/ai-gateway/) · [Using AI Gateway in Workers](https://developers.cloudflare.com/ai-gateway/usage/workers)

**Announcements:** [Project Think](https://blog.cloudflare.com/project-think/) · [Agents Week 2026 updates](https://www.cloudflare.com/agents-week/updates/) · [Building AI agents on Cloudflare](https://blog.cloudflare.com/build-ai-agents-on-cloudflare/)

**Package data:** [`cloudflare/agents` on GitHub](https://github.com/cloudflare/agents) · [`agents` on npm](https://www.npmjs.com/package/agents) — version `0.20.1`, MIT, 645 published versions, verified against the npm registry on 2026-08-04.

**Community:** [Hacker News — Cloudflare's Project Think](https://news.ycombinator.com/item?id=47787772) · [InfoQ — Cloudflare introduces Project Think](https://www.infoq.com/news/2026/04/cloudflare-project-think/) · [Truvisory — the Agent is a Durable Object](https://truvisory.com/agents-mcp/agents-sdk-durable-objects/)

**In-repo:** the white paper's _AI / inference_ topic; ADR-0003, ADR-0109 through ADR-0113; [`docs/research/2026-06-17-ai-inference-foundation-review.md`](2026-06-17-ai-inference-foundation-review.md); [`docs/specs/2026-07-17-discovery-search-index-stateful-service-design.md`](../specs/2026-07-17-discovery-search-index-stateful-service-design.md); `packages/inference/CLAUDE.md`; `apps/worker/CLAUDE.md`.
