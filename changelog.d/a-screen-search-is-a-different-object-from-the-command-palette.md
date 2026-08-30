---
category: Added
audience: internal
---

`ScreenSearch` — the product's one control for searching within a screen, distinct from the top bar's command palette.

Eleven list surfaces answered "search this screen" four different ways, sharing no code: matters and the file manager each hand-rolled an expand-from-icon search, the directory and custodian carried an always-present labelled field, the Time Sheet had the shape specified but only in a mockup, and matter parties, matter costs, notifications, user administration and tools had nothing at all. The design system's own `DataTable.Search` was built for the job and had zero consumers — because it bound straight to a table's global filter and so could only narrow rows already in the browser, which is exactly why the screens that search on a server went and built their own.

The component carries the shape the standing list-screen rule already decided. It rests as an icon, so a screen nobody is searching pays no vertical space for it; it expands on use and collapses when left empty; a live query keeps it open behind a single accent hairline, so a narrowed list carries its reason on screen. There is no clear button — Escape clears the query, a second Escape closes the control and hands focus back to the icon that opened it.

It is one component by construction: registered in the one-implementation registry, so a second file claiming the name fails the gate. And it serves either transport without the calling screen writing anything different — the screen hands over `onsearch` and says whether to run it on every keystroke, for data already here, or after a pause in typing, for a request that leaves the machine. The control owns the query, the debounce and the in-flight flag; it owns no results. `DataTable.Search` is now a thin preset over it that supplies `onsearch` from a table, so the common case stays one line.

Three things ship as seams, built and exercised in the catalog but wired to no screen: a scope control at the field's leading edge, an in-field match count, and a shortcut key. Each says in the code what will use it. The scope names the surface it searches and will never offer "everywhere" — searching everything is the top bar's job.

Adopting it on the screens is separate work, and one of those adoptions removes a defect: in a right-aligned action row the search has to sit to the leading side of the primary action, or the primary action slides sideways on the first keystroke.
