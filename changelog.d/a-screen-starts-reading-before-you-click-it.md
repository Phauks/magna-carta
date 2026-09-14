---
category: Changed
audience: internal
---

A screen starts reading before you click it, and an empty list stops explaining itself.

Every screen used to fetch after it had mounted, which put a whole round trip after the click: chunk, parse, mount, and only then ask the server anything. `app.html` has set `data-sveltekit-preload-data="hover"` since it was written, meaning to spend the 200–400 ms between the pointer settling on a link and the click landing — but that preload runs a route's load function, and 93 of 98 screens had no load that read anything, so it bought the JavaScript and nothing else. Reads move into the load, where they start on hover and resolve out of a shared cache by the time the component mounts.

The same cache ends the re-reads. `/api/v1/me` was being read on every navigation by the (app) guard and again on mount by 38 surfaces, and it is not a cheap call — a control-plane read, a firm Durable Object wake, a permissions join, the channel and flags, the firm name and the membership state. It is now read once and shared, as are the firm's practice areas, its Locations and its roster.

What the screens read through is `@magna-carta/api-client`, the generated client ADR-0066 chose and CI has been regenerating and diff-gating all along while the app hand-wrote 12,389 lines mirroring the same contract beside it. `/matters` is migrated; the rest follow behind a ratchet that can only fall.

Empty lists now say **No Results** — two words, whether the record holds nothing or a filter excludes everything. They used to open with a definition of the domain term ("A packet is the physical thing the firm holds and moves: an envelope, a deed box, a sealed wallet…"), which is the explanatory prose the no-info-lines ruling already forbids everywhere else and whose home is the user guides. Where a filter is what emptied the table, the way back is still there — as the Clear All Filters control, not as a sentence about it. The table no longer accepts an empty state from the surface above it, so there is nothing to get wrong rather than a rule to remember.
