---
category: Added
audience: internal
---

**The foundation for a setting that repeats, and for saying what one would collide with.** The owner: "start recurrence… check conflicts."

**The rule and its expansion** (`apps/web/src/lib/calendar/recurrence.ts`). A repeating setting is ONE row with a rule, expanded across the window a read asks for — the alternative multiplies a firm's calendar by the length of its longest series before anybody looks at it, and turns "move the series" into fifty-two writes. The stored form is an RFC 5545 `RRULE`, because it is what every calendar product reads and writes and a firm exporting its calendar should not find this product's dialect in it. What the form offers is narrower than the standard allows, and `parseRecurrence` returns null for a rule it cannot present rather than half-showing one it would silently rewrite.

Two decisions worth stating because they are the ones a reader would argue about. **The expansion walks civil days, never instants** — so a weekly nine o'clock setting is nine o'clock on both sides of a daylight-saving change, where an instant-based walk would move half a firm's Tuesdays by an hour twice a year. And **a month with no such date is skipped, not pulled back**: a firm that said the 31st did not mean the end of the month, and February gets no occurrence rather than an invented one on the 28th.

**The schema** gains `recurrence_rule`, `recurrence_parent_id` and `recurrence_occurrence_on` on both event tables. An exception — one occurrence moved, renamed or called off — is a REAL event that knows which date of which series it replaces, so every read that already understands an event understands it, including the rule that a cancelled setting stays visible and struck. An exclusion list would have needed a second mechanism to say "and this one was cancelled". The added columns carry their own CHECK rather than the table being rebuilt, on the mechanism the task-rungs migration proved against real durable-object storage: a rebuild drops the table it replaces, and `matter_event` is a parent three tables reference.

**What a setting would collide with** (`schedule-conflicts.ts`). Recurrence is why it exists: one hearing at a bad hour is visible in the day schedule the form already draws, but a weekly setting for a year is fifty-two chances to collide and nobody scrolls a year to check. A double booking is never refused, only stated — two things at once is not something the platform knows to be wrong. Civil days and wall clocks, never instants; back-to-back is not a collision; a vacated hearing competes for nobody's Tuesday; and a series reports DAYS rather than collisions, because "three of the twelve dates" is the question a person asks.

**Not yet wired.** No service reads or writes a rule, no route carries one, no form offers one, and no read expands one — so nothing in the product repeats yet. The arithmetic and the storage are in place and asserted; the service, the contract and the form are the next slice.

Also withdrawn in the same round, before anything was built: the separate zone for a setting's END. The owner: "only have one field for time zone. always the same for start and stop." The forms already ask once, and no `end_time_zone` column exists or should.
