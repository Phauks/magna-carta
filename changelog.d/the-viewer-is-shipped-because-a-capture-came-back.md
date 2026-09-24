---
category: Changed
audience: internal
---

**The safe website viewer is `shipped`, because a capture came back.** The feature-ledger node
stayed `partial` through the merge that repaired the render, on the rule that a capability's status
follows evidence rather than a deploy; the first successful capture against the deployed service
arrived on 2026-09-18 and the node follows it. Its `notes` no longer claim the page answers every
capture with a renderer-unavailable state, which stopped being true with that merge.

**The Browser Rendering entry in the deploy queue closes, and not the way it was written.** It had
stood open for weeks as the suspected cause of every failed capture — the one dependency no session
could verify from the repository. The entitlement had been serving the whole time. The captures were
failing on a wait for `networkidle2` that a page holding a socket never reaches, which the service
answered 422 and the route reported as a capacity outage.

The entry is closed with that correction rather than a tick, because the shape of the mistake is
what the file invites: an item naming something no session can check attracts any failure that might
plausibly be it, and the attribution is never re-tested. The renderer's own refusals were being
collapsed into a single sentence and never logged, so for weeks there was nothing to read. Make a
failure readable before blaming an open entry for it.
