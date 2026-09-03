---
category: Changed
audience: internal
---

The pane system moves out of the record window into a frame both modal shells sit on.

The record window's frame — the header band and its quiet controls, the body, the primary pane that stops at its measure beside a context pane that takes the rest, the action bar of fixed geometry, and the fit-first/cap-second rule they all obey — is now `styles/recipes/modal-frame.css`, an internal recipe rather than a component. The record window keeps every class name as a hook and every pixel as it was: its four frame-bearing stories were screenshotted from the static catalog before and after, and all four are byte-identical.

Extracted because the alternative was measured. The largest panel in the app had rebuilt every one of these rules from utilities in 647 lines, quoting the record window's own doctrine in its comments, because there was nothing to reach for. A pane system that lives in one shell is a pane system every other panel rebuilds.

`ActionDialog` moves onto the same frame and gains a `context` pane — the record window's right pane, lent to a form. A context pane implies the record width whatever `width` asked for; a primary pane with no context beside it fills the frame. The notice band now sits outside the scroll, directly above the action bar, where the reader is looking when a commit comes back refused. Focus lands on the first field rather than the header's own dismiss.
