---
category: Fixed
audience: internal
---

A draft's rate can be set, and its amount now follows every input it is computed from.

The rate chain has always ranked a per-entry override above every stored tier, and capture has always accepted one. What was missing was a way to SAY it — the record window showed the rate as a fact rather than a field — and a way to say it on an entry the firm already holds. **`PATCH /api/v1/time-entries/{id}` now takes `overrideRateE4`**: a number prices this entry, null hands it back to the chain, and absent leaves the rate exactly where it stands.

This does not weaken the rate snapshot. That rule says a rate card edited LATER never re-rates a standing entry, and it still holds; what changed is somebody's deliberate answer for one entry, not a card's answer for all of them.

**Two defects surfaced while building it, and are fixed with it.** Both are about the same thing — an entry's money columns are DERIVED, and the route was not re-deriving them:

- **Changing the time worked left the entry billed at the old figure.** The patch wrote `raw_duration_minutes` and left `duration_minutes` and `amount_minor` untouched, so an entry corrected from one hour to two was still billed as one hour and still priced as one hour. The worked time is now re-rounded on the firm's own increment and the amount recomputed. This could not be left alone alongside the change above: a settable rate whose amount is computed against a stale duration is a worse field than no field at all.
- **Correcting an entry's work date silently threw away its rate.** The date change re-asked the chain without the entry's own override, so a correction to one field put the card's answer back and quietly changed what the client is charged. A standing override now carries through.

**`GET /api/v1/time-entries/rounding-policy`** serves the increment and direction in force for a matter and a member, resolved through the same scope chain the capture uses. A screen cannot otherwise state what an entry will actually be billed at, and a screen that guesses records the wrong amount of time.
