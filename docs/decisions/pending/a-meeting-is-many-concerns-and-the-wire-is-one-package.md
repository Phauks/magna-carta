---
slug: a-meeting-is-many-concerns-and-the-wire-is-one-package
status: Proposed
area: Communications layer
date: 2026-09-20
summary: "As meetings grow past their first slices, the shared wire protocol becomes one package imported by the worker and the browser alike, the signaling room is split into concern modules under an orchestrating Durable Object, every resource gets its own route file and domain trio, the browser client is split the same way, and diagnosability becomes a slice of its own: a per-meeting event stream through the standard pipeline, a connection-quality signal from the browser, an operator's inspect call, and a load harness — so the feature can keep growing without one object knowing everything and without the two ends of the wire drifting apart."
---

**A meeting is many concerns, and the wire between its two ends is one package, never two
declarations.**

**Context:** Three slices in, the signaling room holds the roster, presence, media release, a grace
sweep, alarms and supersession in one class over one storage namespace, and the browser client holds
signaling, negotiation, subscriptions, capture and presence in one runes class. The frames they
exchange are declared twice — once with zod in the worker, once by hand in the browser, because a
browser bundle cannot import from a worker — and every slice so far has added frames on both sides by
prose agreement. Nothing observes a meeting beyond an Error ID on a refusal. Fifteen more slices are
on the ledger, and the next two (host controls, the waiting room) would each add a concern to the
room and frames to both ends.

**Decision:** Before those two, a structural slice: a shared `@magna-carta/meeting-protocol` package
holding schemas, builders, the refusal vocabulary and the version, with a fitness function that every
frame has a handler on both sides; the room split into concern modules under an orchestrating
Durable Object; one route file and one domain trio per resource; the client split by the same
concerns with an effects stage at capture; and diagnosability built as a slice — a per-meeting
structured event stream through the standard telemetry pipeline, a connection-quality signal sampled
from the browser and kept short-term, an operator's inspect call behind the platform-operator guard,
and a load harness driving a few hundred fake clients against the room in the test pool. Sub-features
land behind per-firm flags.

**Considered and rejected:** Keeping the frames in the worker and copying them into the browser
"carefully" — the drift is structural, and a rule a reviewer must remember is not a rule. A second
Durable Object per concern (a presence object, a lobby object) — the concerns share one roster and
one lifecycle, and splitting the state across objects would replace one god object with a
distributed one. Deferring diagnosability until something breaks — the first three-hundred-person
meeting that goes wrong is the wrong moment to discover nothing was recorded.

**Consequences:** One mechanical slice with the tests unchanged, before host controls. Every later
slice adds a module, a route file and a domain trio rather than growing existing ones. The wire is
versioned in one place. Operators can see inside a room, and a member sees why a tile is poor.
