---
category: Changed
audience: internal
---

The frames a meeting's two ends exchange are now one package — `@magna-carta/meeting-protocol` — imported by the `MeetingRoom` Durable Object and by the browser client alike, with the signaling room and the client each split into the concerns they had grown.

They were declared twice, and had to be: a browser bundle cannot import from a Worker, so the room stated the wire with zod and the client re-stated it by hand. Three slices added frames to both ends by prose agreement, and the drift that produces does not fail a build — it shows up as somebody's tile staying black.

The package holds the schemas, the builders, the refusal vocabulary, the version and the caps, and a fitness function asks four questions of every frame in it: the room has somewhere to put each one a browser may send, a browser sends each of them, the browser has somewhere to put each one the room may send, and the package builds each of them. Its first run found `renegotiated` — the room's acknowledgement of a browser's answer — had no handler in the browser at all, falling through the receive switch's `default` since the day it was added.

Beside it, the room is now an orchestrating Durable Object over six modules (state, roster, presence, media, lifecycle, frames), each taking the object's context explicitly so it can be driven without the runtime; the SFU client and the relay credentials moved under `meetings/sfu/`; and the browser client is the same split (signaling, negotiation, subscriptions, capture, presence) with the media-effects stage seamed in at capture as the identity. Mechanical throughout — every test passed with its assertions unchanged.
