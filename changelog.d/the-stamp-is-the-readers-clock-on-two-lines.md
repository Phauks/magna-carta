---
category: Changed
audience: public
---

The export generation stamp splits into two lines — the date, then the time on its own line — and
the time now names its zone (`12:57:56 PM PDT`), rendered from the reader's own clock via the two
shared helpers in `$lib/export/tabular-export.ts` that all four renderers now draw from. The stamp
was always browser-local; naming the zone is what makes that self-evident to whoever a file is
forwarded to. Verified by generating in a headless browser pinned to Pacific time on a UTC machine.

## Public

**Export timestamps read in your own time.** Every downloaded report now shows the date and the
time on their own lines, in your computer's clock with the time zone named beside it, so there is
never a question of whose afternoon a snapshot belongs to.
