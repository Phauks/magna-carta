---
category: Changed
audience: internal
---

Filling the screen is the frame's, not one shell's.

The record window's expand — the corner control, the session memory, the geometry that drops the width cap — moves beneath both modal shells as `internal/frame-expansion.svelte.ts`, and `ActionDialog` gains the same control on its Dialog kinds (`form`, `reading`; never on a question) with its own session memory, kept apart from the record window's: a reader who filled the screen with one form has said nothing about the next question they are asked. Both shells take a bindable `expanded`, which is how a panel opens expanded by design. The record window's four frame-bearing stories are byte-identical before and after.

The one panel that had rebuilt all of this by hand — the time sheet's own flag, icons and utilities inside a raw dialog — migrates with the other two full-screen surfaces in the pass that follows.
