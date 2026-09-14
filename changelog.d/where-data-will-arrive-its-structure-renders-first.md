---
category: Changed
audience: public
---

**Where data will arrive, the structure that will hold it renders first, empty.** The owner's
ruling of 2026-09-14: a screen that puts a sentence where its table, list or rail will stand
prepares nobody for what is coming and hides the shape a reader would use to spot a gap. The words
about the emptiness now live inside the structure's own empty state, and the structure stands from
the first paint.

Three design-system changes carry it. `EventRail` draws its frame with zero events — one hollow,
dashed marker where the first event will land and `emptyMessage` in the body beside it — and takes
a `note`, the one line a caller may hang beneath the events inside the frame for what the history
does not yet carry, instead of a paragraph loose on the canvas. `DefinitionList` is new: named
values, framed, with `DefinitionList.Row` drawing the table's empty-cell mark for a value not known
yet and `DefinitionList.Empty` as the row beneath the terms that the words about why go in.
`DataTable.GridFigures` takes a per-figure `scope`: a `whole-record` figure (a server-side count of
what is waiting, a total the loaded rows do not add up to) stands before the "In view:" sentence in
its own group, so a filter on the loaded rows never presents it as narrowed.

The gate is `pnpm run lint:structured-empty` (`tooling/lint-structured-empty/`), which reads a
Svelte file's markup tree for the two shapes the ruling named: a prose branch opposite a structure
in one conditional (and its `{#each}` and `{#await}` cousins), and a muted paragraph immediately
beneath a structure in the same block. It fires only where the prose branch's condition speaks of
absence, treats a non-breaking-space spacer as no prose, and takes an inline
`<!-- structured-empty-allow: <why> -->` whose reason sits beside the code it excuses; an allowance
that excuses nothing is itself a finding. The rule is recorded in `docs/conventions/ui-design.md`.

What it found, and what changed: the file inspector's Hashes tab, the speed test's server facts and
sample table, the matter status window's engagement list, the bill window's history and delivery
tabs, the trust-transfer dialog's ceiling, and the developer console's resource meters.

## Public

**Empty places now show their shape.** A file's Hashes tab lists every algorithm before a digest is
computed, with the reason beneath the list; a bill's Delivery tab shows the delivery record's frame
before a delivery is recorded (and says why a draft has none); every history rail stands with its
marker where the first event will go; the speed test's server facts and sample table are present
before the measurement answers. What a screen is waiting on is said inside the list or rail it
belongs to, where the values will land, rather than in a paragraph beside it.
