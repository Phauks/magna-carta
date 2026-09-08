# Catalogue (web) — CLAUDE.md

**Purpose.** The one framework behind every screen that lists things a member opens. A catalogue is
sections with an engraved heading, and under each a run of entries carrying a glyph, a name, one
line saying what the thing does, and a maturity mark that decides whether the entry is a link or an
honest "not yet". Two screens render through it today — **Tools** and **Reports** — and they are
identical screens by construction rather than by anybody remembering to keep them so.

**White paper:** _Tools_, _Reports_. **Archetype:** List/Index, in
[`docs/specs/2026-06-12-page-archetypes.md`](../../../../../docs/specs/2026-06-12-page-archetypes.md).

## Key files / entry points

- `catalogue.ts` — the vocabulary: `CatalogueEntry`, `CatalogueSection`, the entry count.
- `catalogue-search.ts` — the narrowing, pure: which words reach which entry, and the count that
  sits inside the search field.
- `catalogue-view.ts` / `catalogue-view-preference.svelte.ts` — the two views, and the factory that
  remembers a catalogue's choice under its own storage key.
- `catalogue-screen.svelte` — the whole assembly: the screen header, ScreenSearch and the view
  switch in its action row, the sections below in the chosen view, and the nothing-found statement.
- `catalogue-row.svelte` / `catalogue-tile.svelte` — one entry, dense and browsing.
- `catalogue-list-view.svelte` / `catalogue-tiles-view.svelte` — the grouped renderers the
  multi-view shell registers.

## Local conventions

- **A registry projects; it never renders.** Each catalogue owns a small projection module beside
  its own registry — `tools/tool-catalogue.ts`, `reports/report-catalogue.ts` — that says which of
  its facts fills which part of an entry. Nothing about a tool or a report is decided in this
  directory, and this directory cannot name either, so it cannot grow a branch per consumer.
- **`href` decides launchability, not the stage.** A projection computes it from whatever rule its
  registry holds (tools use `hasSurface`, reports use `isBuiltReport`). The row and the tile read
  only `href === null`. An entry with nowhere to go renders plain and quiet — never as a disabled
  control, which reads as broken rather than as not yet.
- **The narrowing is over the sections, never inside a view.** Both views therefore narrow
  identically, and switching views mid-search keeps the answer. A view never sees the query.
- **Searching is ScreenSearch**, the product's one screen search, in the action row — never a search
  box of this area's own. It answers on the keystroke because a catalogue is already in the browser.
- **Adding a catalogue is a projection plus a storage key.** Never a new screen, a new row
  component, or a second arrangement of the header.

## Dependencies & contracts

- Renders through `$lib/view-shell` (the multi-view shell) and `$lib/screen/screen-header.svelte`.
- Remembers its view through `$lib/preferences/persisted-preference.svelte.ts`.
- Uses the design system's `ScreenSearch`, `EmptyState`, `Card`, `FieldLabel` and the maturity
  module (`MaturityBadge`, `soonDependencySentence`).

## Gotchas

- **A projection module is exercised in the plugin-less node pool**, so it imports app-local
  modules by RELATIVE path rather than the `$lib` alias — the constraint `tool-destinations.ts`
  already carries.
- **`filterCatalogue` returns the very same array when nothing is searched**, so the resting screen
  allocates nothing and the shell's items keep their identity. Do not "normalize" that into a copy.
- **Section ids are the shell's item keys.** A projection whose two sections share an id makes the
  view render one of them; ids come from the registry's own group or family id for that reason.
