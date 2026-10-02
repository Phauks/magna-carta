---
category: Fixed
audience: public
---

**Participants open their media sessions at the same time rather than one behind another.**
`sessionFor` in `apps/api-worker/src/meetings/room/room-media.ts` held `blockConcurrencyWhile`
across the call that opens a Cloudflare Realtime session, so every arrival waited for the one before
it and one slow upstream answer stalled every frame in the room. The lock now covers storage only:
a per-stay map of openings in flight makes two frames from one participant share one call while
other participants proceed, the session is written onto the record together with the first publish
or subscribe (a first publish still costs five reads), a failed opening is retried on the next frame
with the same refusal and Error ID, and a browser that reconnects or leaves mid-opening is handled
rather than merged into a record it no longer owns. The load harness gains a per-frame-type count of
storage reads beside its count of lists.

## Public

Joining a large meeting no longer queues behind everybody else who is joining at the same moment.
