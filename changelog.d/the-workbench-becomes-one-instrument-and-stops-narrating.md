---
category: Changed
audience: public
---

**The File Workbench's fifth review round, and one duplicated surface removed.** The rail and the readings moved inside a single framed container in `workbench.svelte` and lost their own borders, so the resizable edge is the only line between them; `DataTable.GridFooter` gained `selectAllToggle` and a top rule and now sits on the rail's bottom edge; the tab strip moved above the file's header band; and the rail's name cell carries a fixed-width marker for the file the readings are reading, which the selection tint cannot express once a bulk selection holds several rows.

`FactTable` renders its `DataTable.Root` with `rounded-none border-0` — the matter file list's reasoning, since the readings panel is already the frame. The "Read by" and "Computed by" rows are gone from the type and hash panels; the masthead carries that fact once for the screen.

`DigestList` is new in the design system, with its recipe, its three stories and a `types.ts` holding `DigestEntry` (a type declared in a `.svelte` instance script is not part of that module's exports). It replaces the workbench's hand-rolled digest block AND the `<dl>` inside `file-manager/file-inspector.svelte`, which were two renderings of one reading. Copy confirmation is the control filling, per the standing 2026-08-31 ruling.

`conversion-targets.ts` now collapses reachable formats by media type plus extension and drops any target sharing the source's file type, so `searchable-pdf` never surfaces as a button and a PDF correctly offers nothing. The rule is data-driven, so a variant node added to the graph later needs no edit here. Rulings recorded in `docs/conventions/file-workbench-rulings.md` (R5, W24–W32); the generalizable half is promoted into `design-corrections.md`.

## Public

**The File Workbench reads as one tool now, and says less that you already knew.** The file list and the readings share one frame instead of floating as two separate panels, and the list keeps its own footer along the bottom — how many files there are, how many are selected, and Select all / Select none. When you have several files picked for a bulk conversion, an arrow in the list marks the one file the tabs on the right are actually reading.

**Fingerprints look and behave the same wherever you meet them.** The Hash tab on the workbench and the Hashes tab on a stored file now show digests identically, and in both places you click a fingerprint to copy it.

**Convert offers file types, not variations on one.** There is no longer a "searchable PDF" to choose beside "PDF" — anything Magna Carta produces already carries as much of the original as it can. A PDF therefore has nothing to convert to; to get selectable text out of one, use Text Recognition.
