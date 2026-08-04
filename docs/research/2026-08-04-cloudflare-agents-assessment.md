# Cloudflare Agents — Platform Assessment

**Date:** 2026-08-04
**Scope:** What Cloudflare's Agents platform is (the `agents` SDK, Project Think, and the surrounding Agents Week 2026 surface), what community signal exists, and an honest fit assessment against Magna Carta's existing Durable Objects / Queues / Workflows / `@magna-carta/inference` foundation.
**Purpose:** Research prompted by an owner-supplied Reddit link. This is **research, not a spec and not a decision.** Nothing here is built or committed; everything labelled a recommendation is a recommendation only. The binding decisions in this area are already recorded — ADR-0109 through ADR-0113 (AI / inference) and ADR-0003 (tenancy) — and nothing in this document changes them.

---

## 1. Summary

Cloudflare's Agents platform is **a harness, not a new primitive.** An Agent is a Durable Object with a curated set of conveniences layered on it: named-instance routing, a `setState()` store that syncs to connected clients, an embedded SQLite database, multiplexed scheduling over the single DO alarm, WebSocket lifecycle handlers with hibernation, first-class MCP client/server support, and — in `@cloudflare/ai-chat` — an `AIChatAgent` base class that persists conversation history and does resumable streaming. Every one of those sits on Durable Objects, Workers, and Workflows: the exact three primitives this codebase already uses across seven Durable Object classes.

The honest verdict is narrow and two-sided. **The SDK would buy Magna Carta almost nothing on the coordination side** — the naming, alarm, single-flight, and queue-handoff patterns the Agents SDK packages up are already written here, correctly, and are already firm-scoped by construction (`FirmDatabase` via `idFromName(firmId)`; `ConversionJob` keyed `firmId:jobId`; `BundleBuildCoordinator` keyed `firmId:manifestHash`). **It would buy something real on exactly one axis** — a resumable, reconnect-surviving streaming chat transport with server-side conversation persistence, which is the one piece of an AI assistant surface that does not exist anywhere in this repo and is genuinely fiddly to write.

Against that, the SDK's **defaults conflict directly with the confidentiality architecture already accepted.** `@magna-carta/inference` exists precisely so that no feature talks to a model directly (ADR-0111), with `skipCache` / `collectLog: false` / derived firm metadata / a fail-closed ZDR guard pinned on every request (ADR-0113). The Agents SDK's happy path is the opposite: the AI SDK calling a provider directly from inside the agent, with conversation history auto-persisted into the agent's own SQLite — a per-firm data store outside the firm-scoped data-access layer, outside `protected()` encryption, outside audit, retention, and legal-hold semantics. Adopting the SDK naively would route privileged content around three accepted ADRs at once.

So the shape of any adoption is constrained before it starts: **use the Agent class as a transport and session shell only, with every model call forced through `InferencePort` and every durable message written through `firmDatabaseFor(firmId, env)`.** That is a legitimate design — but it also strips away most of what the SDK is marketed for, which is why the recommendation below is _prototype behind a flag on synthetic fixtures_, not _adopt_.

---

## 2. Could not read the linked thread

The owner-supplied link is `https://www.reddit.com/r/CloudFlare/s/p6AdOkBnuh`. **It could not be read.** Reddit is blocked to the fetch tool outright, and a direct request returns HTTP 403 from Reddit's edge (`old.reddit.com` likewise; the `/s/` share slug redirects only after passing that block, so the underlying thread ID never resolved). The share slug is not indexed by any search engine reachable from here, so the thread could not be identified by its content either.

**Everything in the community-signal section below is therefore substitute evidence from other sources, not the thread the owner pointed at.** If the thread matters, the owner should paste its text or its resolved permalink.

---

## 3. What the platform actually is

### 3.1 The core: an Agent is a Durable Object

The `agents` package (npm, MIT, **latest `0.20.1`**, roughly 805,000 weekly downloads) exports an `Agent` class that extends `DurableObject`. The documentation is explicit that Durable Objects are the foundation and that each instance is "a separate micro-server that runs independently."

What the class adds over writing the DO yourself:

- **Named-instance routing.** `https://your-worker.workers.dev/agents/:agent-name/:instance-name`, with the guarantee that the same name always resolves to the same instance. This is `idFromName()` with a router in front of it — the same thing `firmDatabaseFor(firmId, env)` already does here.
- **`setState()` plus client sync.** State is persisted and pushed to every connected client. There is no equivalent in this codebase, because nothing here holds a live client connection to a coordinator.
- **Embedded SQLite via `this.sql`.** The agent's own database, separate from D1. Note that this codebase already runs its per-firm SQL inside a Durable Object (`FirmDatabase`), so DO-hosted SQLite is not itself novel or objectionable here — what matters is whether a _second_, ungoverned store appears beside it.
- **Scheduling.** `schedule()`, `scheduleEvery()`, `getScheduleById()`, `listSchedules()`. Durable Objects permit only one alarm per object; the SDK works around this by keeping schedules in a `cf_agents_schedules` table and re-arming a single alarm for whichever fires next. This is a genuine convenience, and it is also about thirty lines of code.
- **WebSocket lifecycle.** `onConnect()`, `onMessage()`, `onClose()`, `broadcast()`, riding DO WebSocket hibernation so an idle connection costs nothing in duration billing.
- **`@callable()` RPC.** Typed method exposure to clients.
- **MCP.** The agent can act as an MCP server (exposing tools to external AI clients) or an MCP client (consuming external tools). The SDK tracks the protocol closely — `2026-07-28` spec support with stateless request handling landed in `v0.20.0` on 2026-07-27.

### 3.2 `AIChatAgent` and the client hooks

`@cloudflare/ai-chat` provides `AIChatAgent`, which **automatically persists messages** and supports **resumable streaming that survives disconnection**, with server-side and client-side tool execution. On the client, `useAgent<State>()` and `useAgentChat()` are **React** hooks; a framework-neutral `AgentClient` class exists for direct calls and state updates.

That React-first client story is a concrete friction point for this codebase, which is Svelte 5 / SvelteKit with a design-system rule that forbids importing outside `@magna-carta/design-system` for UI. The vanilla `AgentClient` is usable, but the ergonomic half of the SDK's pitch does not apply here.

### 3.3 Agents Week 2026 and Project Think

Cloudflare ran **Agents Week 2026 (13–17 April)** and shipped a wide surface. Status as documented:

| Thing                      | What it is                                                                                                                                                                                                                                                                                                                      | Status                                       |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------- |
| **Project Think**          | Next edition of the SDK: durable execution via "fibers" with `stash()` checkpointing, sub-agents on Durable Object Facets with isolated SQLite and typed RPC, tree-structured persistent sessions with branching / non-destructive compaction / FTS5 search, and sandboxed execution of model-generated code in Dynamic Workers | **Experimental preview** — "APIs may change" |
| **Workflows v2**           | Rearchitected control plane, higher concurrency and creation rate limits; `step.prompt()` now runs a full agentic turn before returning structured output                                                                                                                                                                       | GA                                           |
| **Sandboxes**              | Persistent isolated environment with shell and filesystem                                                                                                                                                                                                                                                                       | GA                                           |
| **Browser Run**            | Browser Rendering successor: Live View, human-in-the-loop, CDP access, 4x concurrency                                                                                                                                                                                                                                           | Beta                                         |
| **AI Search**              | Managed retrieval primitive — dynamic instance creation, file upload, hybrid retrieval                                                                                                                                                                                                                                          | Available                                    |
| **Agent Memory**           | Managed persistent-memory service for agents                                                                                                                                                                                                                                                                                    | Launched                                     |
| **Code Mode**              | MCP token-cost reduction by generating code against tools                                                                                                                                                                                                                                                                       | Experimental                                 |
| **Voice Pipeline**         | Continuous STT/TTS agents in ~30 lines                                                                                                                                                                                                                                                                                          | Experimental                                 |
| **Agent Lee**              | In-dashboard Cloudflare agent with write operations against your account                                                                                                                                                                                                                                                        | Beta                                         |
| **`@cloudflare/computer`** | Open-source agent runtime, isolate/container orchestration                                                                                                                                                                                                                                                                      | Preview (2026-08-03)                         |

GA within the SDK itself covers Agent Skills, messengers (Telegram), timezone-aware scheduled tasks, durable chat recovery, Code Mode with resumable execution, background sub-agents, MCP elicitation, sandbox tunneling, and diagnostics-channel observability. Agent tracing across turns, model calls, tool runs, and token usage landed 2026-08-04.

### 3.4 Limits and pricing

**There is no Agents SKU.** Agents bill as Workers plus Durable Objects. The relevant numbers:

- Workers Paid: $5/month account minimum, covering Workers, KV, and Durable Objects usage.
- Durable Objects: 1M requests/month included, then $0.15/M; 400,000 GB-s duration/month included, then $12.50/M GB-s. Duration is billed on wall-clock time while running **or idle-in-memory-but-unable-to-hibernate** — a hibernating idle agent is free.
- **Incoming WebSocket messages bill at 20:1** — 1M received messages counts as 50,000 DO requests.
- SQLite-backed DO storage billing switched on in January 2026.

Documented Agents limits: tens of millions of concurrent agents per account, roughly 250,000 definitions per account, **1 GB of state per unique agent**, and **30 seconds of compute per HTTP request or WebSocket message** — wall-clock waiting (for a database or an LLM) is unbounded. Note a discrepancy worth resolving before relying on it: third-party write-ups cite a 10 GB SQLite ceiling per agent (the Durable Objects figure) against the Agents docs' 1 GB state figure. Treat 1 GB as the number until Cloudflare's own page says otherwise.

### 3.5 The relationship to the model providers — the load-bearing detail

The SDK calls models through the **AI SDK**, defaulting to Workers AI, with the documentation stating you can "swap in OpenAI, Anthropic, Google Gemini, or any other provider." **AI Gateway is not on that default path.** Routing through the gateway is a deliberate wiring step (`useAIGateway`, or `env.AI.run(model, input, { gateway })`, or the gateway's REST endpoints — since May 2026 a universal `/ai/run` plus OpenAI-compatible, Responses-compatible, and **Anthropic-compatible `/ai/v1/messages`** endpoints).

This is the single most important fact in this document for Magna Carta. The entire confidentiality control plane accepted in ADR-0110 and ADR-0113 — ZDR on, `collectLog: false`, `skipCache: true`, derived firm metadata, the fail-closed ZDR guard — lives in the gateway options object passed to the `AI` binding. An Agents SDK feature written the documented way would call a provider directly from inside the agent and **every one of those controls would be absent**, silently, with no error.

---

## 4. Community signal

The linked thread is unreadable (section 2), so this is what could be gathered elsewhere. It is thinner than one would like, and that thinness is itself a signal about how much production experience is publicly written up.

**Praise.** The consistent positive is the one Cloudflare leads with and that developers independently confirm: making the agent a durable, addressable network unit removes the external-store dance. On Hacker News, discussing Project Think, a commenter singled out `runFiber()` checkpointing — "a 30-minute multi-step task survives a restart with state intact." Durable Objects generally are described by practitioners as "the missing primitive for production agents," and hibernation genuinely does make idle sessions free.

**Criticism.**

- **Novelty scepticism.** The bluntest reply on that thread argued the durability story is achievable with "any VM with SQLite + WebSockets for realtime sync of state." That is a fair critique of the marketing, and it lands even harder here, where the primitives are already in production use.
- **Context-recovery quality.** A developer noted that in local testing an agent recovering from a crash "skimmed through the context and skipped over its own findings" — durable _state_ is not durable _reasoning_. For a legal product this is the difference between a resumed job and a resumed job that quietly did less than it reported.
- **Pre-1.0 churn.** The SDK is a fast-moving 0.x — **645 published versions** on npm, with `0.17.x` through `0.20.1` inside a few weeks. Practitioner guidance is to pin versions and expect monthly change, and the repository is reported as not accepting external pull requests while the surface stabilizes. Several headline primitives are explicitly experimental or preview.
- **Durable Object constraints leak through.** One alarm per object (worked around, but the workaround is yours to understand when it misbehaves), single-threaded execution with a soft ~1,000 requests/second per object, and a documented known issue where an object that stops being current only discovers this if the event touches storage.
- **Observability.** Durable Objects observability is described as the area "in need of some love" — partly addressed by the August 2026 agent-tracing release, which is itself brand new.
- **Lock-in.** The agent-as-Durable-Object model has no drop-in AWS or GCP equivalent; porting means reintroducing the external-store pattern the model exists to avoid.

**Production readiness, fairly stated.** The _substrate_ (Durable Objects, Workflows v2, Sandboxes) is GA and mature. The _harness_ is pre-1.0 and moving weekly. Project Think — the part that is actually architecturally interesting — is an experimental preview roughly four months old.

---

## 5. Fit assessment against Magna Carta

### 5.0 The three constraints every candidate has to clear

Before the candidates, the constraints they all run into:

1. **The chokepoint (ADR-0111).** Every AI feature reaches a model through `@magna-carta/inference` and nothing else. Any SDK pattern that calls a provider directly is out, not as a style preference but because `skipCache` / `collectLog: false` / derived metadata / the fail-closed ZDR guard live only there.
2. **The firm-scoped data-access layer (golden rule 3, ADR-0003).** All business data goes through the data-access layer. `AIChatAgent`'s automatic message persistence writes privileged conversation content into the agent's own SQLite: no `protected()` encryption, no audit row, no retention policy, no legal-hold semantics, no matter-scoped access control, and invisible to discovery and to the support-access framework's permission model. This is the sharpest single conflict in the whole assessment.
3. **Consent is not yet decided (ADR-0109, still Proposed).** Whether privileged matter content may go to a third-party frontier model at all, and under what consent, is an open owner decision that the white paper states must be recorded **before the first AI feature ships**. Every candidate below is downstream of it.

### 5.1 AI matter-assistant / chat over firm data

**What the SDK would buy.** The most, of any candidate, and it is not nothing: `AIChatAgent`'s resumable streaming across disconnects, durable chat recovery (GA), server-side conversation persistence, and a WebSocket transport with hibernation so an open-but-idle assistant panel costs nothing. Nothing in this repo does resumable streaming to a browser — `LiveTimerDurableObject` is the closest live-connection precedent and it is not a streaming transport. Writing reconnect-safe token streaming correctly is real work.

**What it would not buy.** The per-firm instance story is already solved: an agent named `firmId` or `firmId:userId:sessionId` is exactly the naming discipline already enforced across seven DO classes, and the Agents router adds nothing the worker's chokepoint does not already do better (it enforces tenancy, authn, RBAC, idempotency, and rate-limit in order on every `/api/v1` route — the Agents route pattern bypasses all of it).

**The isolation story.** One agent per firm is the wrong grain: a matter assistant is per-user and per-session, and cross-matter reads raise a broader consent question than a per-matter tool. Whatever the grain, the durable content must land in the firm database through `firmDatabaseFor()`, leaving the agent's own SQLite for ephemeral coordination only. That is buildable but it means deliberately not using the SDK's headline persistence feature.

**Confidentiality and model calls.** Workable only if the agent's model call is `InferencePort` and never the AI SDK provider. A chat surface also _increases_ per-call privileged exposure — longer context, more documents retrieved per turn — which is a reason the model-choice question deserves a fresh answer rather than inheriting the drafting default.

**Cost.** Inference dominates (Unified Billing passes provider rates through plus a 5% credit-purchase fee). The DO shape is a secondary but real change: today's model is request-scoped; a chat agent is a long-lived connection billed on duration whenever it cannot hibernate, with incoming WebSocket messages at 20:1. Hibernation makes idle panels free; a chatty session is not idle.

**Assessment:** the strongest candidate, and still a **prototype**, not an adopt — because the version of it that satisfies the three constraints uses maybe a third of the SDK.

### 5.2 Document-drafting assistance over the template / merge system

**What the SDK would buy.** Less than the chat case. Drafting is a bounded generate-and-review operation, not an open-ended session. `InferencePort` already names a streaming variant _and_ a durable Workflow-invocable variant, which is what a long generation needs. `DocumentSession` already exists as a DO for collaborative editing, so the live-editing seam is present.

**What it would not buy.** Sub-agents, fibers, and tool-loop orchestration are aimed at open-ended agentic work; template merge is a structured transform where determinism is a feature.

**Assessment:** **defer.** Build against `InferencePort` streaming when slice 2·6 opens; revisit only if drafting turns out to need genuine multi-turn revision.

### 5.3 Intake triage

**What the SDK would buy.** Modest. Intake is form-shaped and event-driven; the messenger integrations (Telegram) are irrelevant to a legal intake surface, and the queue-plus-consumer pattern already handles the asynchronous half.

**The confidentiality wrinkle worth naming.** Intake data is _not_ low-sensitivity just because the person is not yet a client — prospective-client confidentiality attaches, and intake content is conflict-bearing. Treating intake as "the safe place to try AI" would be a mistake.

**Assessment:** **defer.** Slice 6·5 is Backlog and needs its own spec; nothing about the Agents SDK changes that sequencing.

### 5.4 The search subsystem's semantic half

**Assessment: refuse the managed services, specifically.** The semantic half is already designed: Vectorize with namespace-per-firm partitioning, 1024-dimension `bge-large-en-v1.5` through `InferencePort.embed`, fused with Tantivy BM25 hits. The embedding model is a platform constant pinned to the index version, and per-firm variation is deliberately unrepresentable in the type signature.

**Agent Memory** and **AI Search** are managed stores that would each duplicate that design, place firm content and embeddings in a Cloudflare-managed store outside the per-firm namespace partition, and break the embedding pin. Adopting either would be a strict regression against an accepted design for no capability gain.

### 5.5 Agentic workflows over the practice-management graph

**Conflict checks — refuse.** The conflicts design is unambiguous and the reasoning is defensibility: the engine is deterministic, shows every candidate the blocking channels surface, ranks by evidence tier plus graph path, and never suppresses by score. "No AI in the authoritative conflicts decision" is a stated property of the subsystem. An agentic conflict check is not an enhancement of that; it is a replacement of it with something that cannot be defended to a disciplinary board.

**Deadline monitoring — refuse the agentic framing; the scheduling helper does not justify the dependency.** Missed deadlines are the archetypal malpractice claim. Docketing must be deterministic, auditable, and explainable. Cron triggers plus DO alarms plus Queues already cover it, and the SDK's contribution here is a schedules table over one alarm.

**Where an agent loop could legitimately fit** is advisory, non-authoritative, human-reviewed work — the propose-only pattern the white paper already established for maintenance agents (ADR-0016, ADR-0058): draft, flag, summarize, never decide. That pattern is already in production here **without** the Agents SDK.

---

## 6. Adopt / prototype / defer / refuse

Recommendations, clearly labelled as such. None of this is a decision.

**Adopt now — nothing from the SDK.** Two zero-cost items instead:

1. Add the Agents SDK and Project Think to the Cloudflare platform-watch agent's watch list, with the trigger being **`agents` reaching 1.0 and Project Think reaching GA** — the two events that would change this assessment.
2. Re-verify ADR-0113's control-plane assumption against the AI Gateway surface as it stands after the May 2026 REST release (universal `/ai/run`, OpenAI-compatible, and **Anthropic-compatible `/ai/v1/messages`** endpoints). ADR-0113 pins the control plane to the `AI` binding's `gateway` options object specifically and rejects `cf-aig-*` string headers; that reasoning should be confirmed still current, independent of anything to do with Agents.

**Prototype — one thing, tightly fenced.** An `AIChatAgent`-based transport shell for a matter assistant, behind an alpha feature flag, **on synthetic load-profile fixtures only, with no firm data at any point**, built to the constraints in section 5.0: model calls exclusively through `InferencePort`, durable messages exclusively through `firmDatabaseFor(firmId, env)`, agent SQLite ephemeral-only. The question the prototype answers is narrow and worth answering: **does the resumable-streaming and session-recovery machinery earn a pre-1.0 dependency in a privileged path, or is a purpose-written Durable Object cheaper once the React hooks are unusable in a Svelte SPA?** A negative answer is a good outcome and cheap to reach.

**Defer.** Project Think in full (fibers, sub-agents on Facets, tree-structured sessions, sandboxed code execution) — architecturally the most interesting part and explicitly experimental with changing APIs. Likewise Code Mode, Browser Run, Voice Pipeline, and `@cloudflare/computer`. Also defer document-drafting assistance and intake triage as Agents-SDK candidates; they belong to their own slices and their own specs.

**Refuse.**

- **Agent Memory and AI Search as managed stores for firm content.** Duplicates and regresses the accepted per-firm Vectorize design and breaks the platform-fixed embedding pin.
- **Agent SQLite as a home for privileged content.** Outside the data-access layer, `protected()`, audit, retention, and hold — a golden rule 3 and ADR-0003 violation by construction.
- **Any model call that does not pass through `InferencePort`.** ADR-0111; the SDK's default path is exactly this.
- **Exposing firm data through an MCP server surface.** Not a technical decision — it is a distribution decision with confidentiality consequences, and it does not have an owner decision behind it.
- **Agentic authority over conflicts, the trust and financial ledger, or deadlines.** Advisory and human-reviewed only, per the existing propose-only pattern.
- **Agent Lee write operations against the production Cloudflare account.** A beta in-dashboard agent with write access to the infrastructure hosting privileged data is not a risk worth taking for dashboard convenience.

---

## 7. Owner questions any AI feature raises

Independent of Cloudflare Agents — these are owed before the first AI feature, and this research does not answer any of them.

1. **ADR-0109 is still Proposed.** May privileged matter content go to a third-party frontier model at all, and under what consent — engagement-letter blanket, or per-matter? The white paper states this must be recorded before the first AI feature ships. It is still the gate.
2. **Does a conversational surface change the model answer?** A chat assistant sends more privileged content per call, across more matters, than a bounded drafting aid. Should the assistant inherit the firm's primary reasoning-model setting, or should a cross-matter surface be restricted to a narrower slice of the ZDR-eligible catalog — or to the on-Cloudflare Workers AI path?
3. **Is conversation history a client record?** If an assistant thread discusses a matter, is that thread subject to retention, discovery, and legal hold; is it visible to the client through the portal; and who inside the firm may read another user's thread? This determines whether it can live anywhere other than the firm database, and it needs an answer before any transport is chosen.
4. **What consent granularity does a cross-matter assistant need?** A per-matter drafting aid and an assistant that retrieves across the whole firm corpus are different disclosures under Rule 1.6 and ABA Formal Opinion 512.
5. **Is a pre-1.0, weekly-moving dependency acceptable in a privileged path?** Golden rule 11 says build on the latest; it does not say build on the unstable. 645 npm versions and a repository not taking external pull requests is a maintenance posture the owner should accept explicitly or not at all.
6. **Does the platform want an MCP surface at all?** Being an MCP server means firm data reachable by AI clients the platform does not control. That is a product and confidentiality decision, not an engineering one.
7. **Is the cost shape acceptable?** Long-lived per-user WebSocket agent sessions bill on Durable Object duration whenever they cannot hibernate, with incoming messages at 20:1, on top of inference at provider rates plus the 5% Unified Billing fee. Worth a modelled number against the load profile before a chat surface is committed to.
8. **Data residency.** Agents inherit Durable Object placement. For a platform holding privileged material, where a firm's agent instances are permitted to run — and whether that needs to be a per-firm setting — is the same question `FirmDatabase` already raises, and it should be answered once for both.

---

## 8. Sources

- [Cloudflare Agents documentation](https://developers.cloudflare.com/agents/) · [Agent class API](https://developers.cloudflare.com/agents/api-reference/agents-api/) · [Agents limits](https://developers.cloudflare.com/agents/platform/limits/) · [Agents changelog](https://developers.cloudflare.com/changelog/product/agents/)
- [Project Think announcement](https://blog.cloudflare.com/project-think/) · [Agents Week 2026 updates](https://www.cloudflare.com/agents-week/updates/) · [Building AI agents on Cloudflare](https://blog.cloudflare.com/build-ai-agents-on-cloudflare/)
- [`cloudflare/agents` on GitHub](https://github.com/cloudflare/agents) · [`agents` on npm](https://www.npmjs.com/package/agents) (version and release cadence verified against the npm registry, 2026-08-04)
- [Durable Objects pricing](https://developers.cloudflare.com/durable-objects/platform/pricing) · [Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/) · [Durable Objects limits](https://developers.cloudflare.com/durable-objects/platform/limits/) · [Durable Objects known issues](https://developers.cloudflare.com/durable-objects/platform/known-issues/)
- [AI Gateway overview](https://developers.cloudflare.com/ai-gateway/) · [Using AI Gateway in Workers](https://developers.cloudflare.com/ai-gateway/usage/workers) · [Authenticated Gateway](https://developers.cloudflare.com/ai-gateway/configuration/authentication/)
- [Hacker News — Cloudflare's Project Think](https://news.ycombinator.com/item?id=47787772) · [InfoQ — Cloudflare introduces Project Think](https://www.infoq.com/news/2026/04/cloudflare-project-think/) · [Truvisory — the Agent is a Durable Object](https://truvisory.com/agents-mcp/agents-sdk-durable-objects/)
- In-repo: the white paper's _AI / inference_ topic; ADR-0003, ADR-0109 through ADR-0113; [`docs/research/2026-06-17-ai-inference-foundation-review.md`](2026-06-17-ai-inference-foundation-review.md); [`docs/specs/2026-07-17-discovery-search-index-stateful-service-design.md`](../specs/2026-07-17-discovery-search-index-stateful-service-design.md); `packages/inference/CLAUDE.md`; `apps/worker/CLAUDE.md`.
