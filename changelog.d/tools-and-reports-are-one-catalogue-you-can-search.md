---
category: Changed
audience: public
---

**Tools and Reports render through one catalogue framework, and both search.**

They had always been the same screen — sections with an engraved heading, and under each a run of entries carrying a glyph, a name, one line saying what the thing does, and a maturity mark deciding whether the entry is a link — written twice. Twice had already drifted: Tools registered a tiles view and a list view with the multi-view shell, Reports hand-rolled one list and no switch, and neither could be searched.

`apps/web/src/lib/catalogue/` is now the shape, and only the shape: the entry vocabulary, the pure narrowing, the row, the tile, the two grouped renderers, and `catalogue-screen.svelte`, which assembles the screen header with ScreenSearch and the view switch in its action row over the multi-view shell. Each registry projects into it beside itself — `tools/tool-catalogue.ts`, `reports/report-catalogue.ts` — so nothing about a tool or a report moved into the shared layer, and the shared layer cannot name either. `href` decides launchability from each registry's own rule (`hasSurface`, `isBuiltReport`); the row and the tile read only whether it is null.

The narrowing runs over the sections rather than inside a view, so both views narrow identically and switching mid-search keeps the answer. It matches a word anywhere in an entry's name, descriptive line, `waitsOn` dependency, section heading, or unshown keywords, and every word of a query must match — `catalogue-search.test.ts` pins those rules. The lay search synonyms moved from `tool-destinations.ts` into the presentation layer, its own comment's stated durable home, so the palette and the catalogue cast one net.

Removed: `tool-row.svelte`, `tool-tile.svelte`, `tools-list-view.svelte`, `tools-tiles-view.svelte`, `report-row.svelte`, and the tools view-preference pair — the view choice is now one factory over the string-union codec, keyed per catalogue.

## Public

**Tools and Reports are one screen now, and both can be searched.**

Finding the metadata scrubber among twenty tools used to mean reading every heading. Both pages now carry the same search: the magnifying glass at the top right opens a field, the page narrows as you type, headings with nothing left under them drop out, and the count inside the field says how much of the whole you are looking at — "11 of 20". A word matches anywhere in an entry's name, the line describing it, the heading it sits under, or, for a report, the permission it runs under; typing a second word always narrows further. Some tools answer to words they never display, so "bandwidth" reaches the network speed test and "registrant" reaches the WHOIS lookup.

Reports also gains the card and list views Tools already had, and each page remembers your choice separately. A search that matches nothing says so instead of leaving the page blank.
