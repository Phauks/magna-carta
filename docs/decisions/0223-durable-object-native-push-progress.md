---
number: 223
slug: durable-object-native-push-progress
status: Accepted
date: 2026-08-05
area: Worker / job coordination
summary: "Live job progress is pushed over the Durable Objects hibernation WebSocket API on the coordinator objects themselves — not the Cloudflare Agents SDK, whose addition over the native primitive is ergonomic (setState broadcast, typed RPC decorators) and does not justify a pre-1.0 dependency in the coordination layer of a privileged system. The polling endpoints REMAIN, and push and poll resolve a job through one shared function per subsystem so the fallback cannot drift from the pushed answer. The upgrade traverses the chokepoint like any other route and the object is addressed by the SESSION firm id, so subscribing is scoped exactly as polling already is. A pushed signed URL is minted against the bucket the SUBSCRIBER's session resolved, carried on the socket attachment rather than re-derived from a queue message, so a woken object signs through the same seam a poll would have."
---

**Live job progress is pushed over the Durable Objects hibernation WebSocket API, on the existing coordinator objects, with polling retained as a shared-resolver fallback.**

**Context:** `BundleBuildCoordinator` and `ConversionJob` both ran build-then-poll: a client that submitted work asked repeatedly until the answer changed. That is latency the user sees on the most visible background jobs the platform runs, and request volume for an answer that is almost always "not yet". The platform assessment of Cloudflare's Agents SDK raised the question in the form "should these objects become `Agent`s?", and answered it: the capability actually wanted — pushing progress instead of polling for it — is native, GA, and documented as the recommended approach, and what the `Agent` class adds on top is `setState()` broadcast ergonomics and `@callable()` typed RPC. That is convenience over a capability already available, weighed against taking a pre-1.0, weekly-moving dependency into the coordination layer of a system that holds privileged data.

**Decision:**

1. **The native hibernation API, on the coordinators as they stand.** `ctx.acceptWebSocket()` rather than `server.accept()`, so the runtime owns the server end and the object can be evicted with its sockets open — an idle subscriber accrues no billable duration. `setWebSocketAutoResponse()` answers keepalives without waking the object at all. No new dependency, no migration tag: both classes were already SQLite-backed.

2. **Nothing lives on the instance.** Class properties do not survive eviction, so every fact a pushed frame needs is read back from durable storage (the job state, which was already there) or from the per-socket attachment (the subscription context). The socket helper is constructed per call and holds no state of its own. This is the whole difference between a design that hibernates and one that merely happens to use WebSockets.

3. **Polling stays, and stays honest.** The poll endpoints are unchanged in shape and remain a complete answer for a client that cannot hold a socket open — desktop parity, a proxy that drops upgrades, a retried tab. Push and poll resolve a job through ONE function per subsystem and return the same object, so "fallback" describes a second transport, not a second implementation that can drift.

4. **Subscribing is scoped exactly as polling is.** The upgrade is a route registered through `defineOpenAPIRoute` and composed with the chokepoint like every other `/api/v1` route; the session is resolved and the capability checked before the object is ever addressed, and the address is `${sessionFirmId}:${jobKey}` — the same construction the poll uses. A firm can no more subscribe to another firm's job than it can poll one, and the structural gate that proves every dispatched `/api/v1` path is in the emitted contract covers the new routes too.

5. **A pushed signed URL is minted against the SUBSCRIBER's bucket.** The firm bucket is resolved from the session at upgrade time — as the polling route resolves it per request — and carried on the socket attachment, rather than re-derived inside the object from the queue message that started the build. A woken object therefore signs through the same seam a poll would have, with no ambient state to go stale. URLs are minted per push and never stored: they are short-lived by design, and a stored one would outlive the reason the caller was allowed to have it.

6. **A terminal state is pushed once and the socket closes.** `ready`/`done`/`failed`/`expired` are states the job will not leave, so holding the socket open afterwards buys nothing. `expired` counts as terminal: the artifact is gone and the way back is a new request, not a later frame.

7. **The frame contract is versioned and refusals are labels.** Every state frame carries `protocolVersion`, so a socket held across a deploy can be recognised as speaking an older contract instead of silently mis-read. A client frame that is not understood is refused with a code from a closed set and the socket stays open — a bad control frame is not a reason to drop a working subscription. The keepalive frames are pinned byte-for-byte because the runtime's auto-response matches them exactly; reformatting either would quietly cost every idle subscriber a wakeup.

**Consequences:** The Agents SDK remains unadopted for the coordinators, and the assessment's separate recommendation — a fenced, throwaway prototype for the matter-assistant transport, on synthetic data — is untouched by this. The two subsystems now have a live-connection surface where they had none, which is the shape the notifications-push seam named on the bulk-download flow was reaching for; a third coordinator (search indexing, document assembly) adopts the same helper without new design. The web client subscriber is a later slice: what ships here is the server contract plus the polling fallback the current clients already use.
