---
category: Added
audience: internal
---

`ScopedSearch` — the one control for searching within a screen, distinct from the top bar's command palette.

Eleven list surfaces answered "search this screen" four different ways, sharing no code: matters and the file manager each hand-rolled an expand-from-icon search, the directory and custodian carried an always-present labelled field, the Time Sheet had the shape specified but only in a mockup, and matter parties, matter costs, notifications, user administration and tools had nothing at all. The design system's own `DataTable.Search` was built for the job and had zero consumers — and could not have served the two screens that most needed it, because it bound straight to the table's global filter and those searches run on the server.

The component carries the shape the standing list-screen rule already decided. It rests as an icon, so a screen nobody is searching pays no vertical space for it; it expands on use and collapses when left empty; a live query keeps it open behind a single accent hairline, so a narrowed list carries its reason on screen. There is no clear button — Escape clears the query, a second Escape closes the control and hands focus back to the icon that opened it. The surface's own scope control seats at the field's inline start and the match count at its inline end.

It owns the query string and its open/closed behaviour and nothing else, which is what lets one control serve a client-side table and a server-run register with the same appearance. `DataTable.Search` is now the one-line client-side binding over it rather than a second field, so every table inherits the shape.

The two searches are told apart by two chords: `Ctrl K` is the palette and goes places, `/` is the screen and finds records. The scope names the surface it is searching and never offers "everywhere" — searching everything is the top bar's job.

Adopting it on the screens is separate work, and one of those adoptions removes a defect: in a right-aligned action row the field has to expand to the inline start of the primary action, or the primary action slides sideways on the first keystroke.
