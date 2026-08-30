---
slug: a-screen-search-is-a-different-object-from-the-command-palette
status: Proposed
area: Design system
date: 2026-08-30
summary: "Searching within a screen and searching the whole application are two different objects and the product builds them as two, rather than folding the first into the second. The top bar keeps the command palette: it renders registries, answers `Ctrl K`, and goes places. Every list screen gets `ScopedSearch`, a design-system component that rests as an icon in the compact action row, expands on use, collapses when left empty, keeps itself open with an accent edge while a query is live, carries no clear button (Escape clears, a second Escape closes), seats the surface's own scope control at the field's inline start, and answers `/`. Its scope vocabulary belongs to the surface and never says \"everywhere\", because searching everything is the top bar's job. The component owns the query string and its open/closed behaviour and nothing else, so one control serves a client-side table and a server-run register alike; `DataTable.Search` becomes the one-line client-side binding over it rather than a second field. The rejected alternative is scoping the top bar per screen, which would make one object answer two questions and cost the palette its trustworthiness for both. The always-present labelled field is rejected by the standing list-screen rule it was already struck out by."
---

**Two searches that answer different questions are two controls. The moment one object answers
both, a person who searched for a matter and got a settings page stops trusting it for either.**

**Context:** the top bar carries a control labelled "Search or jump to". It is a command palette:
it renders registries — app destinations, settings sections, tools, the ecosystem sites — and it
contains no matters, no contacts, no documents and no time entries. It answers _where do I go_.

Nothing consistently answers _where is that record on this screen_. A survey of every list surface
found four different answers across eleven screens, sharing no code:

- Matters and the matter file manager expand a search from an icon in their action row, each with
  its own hand-rolled implementation.
- The directory and custodian carry an always-present labelled field with a sentence under it.
- The Time Sheet is specified as an expand-from-icon button and lives in a mockup.
- Conflicts deliberately has no search box, because a conflicts check is a record-making act.
- Matter parties, matter costs, notifications, the user administration list and the tools listing
  have no affordance at all.

`DataTable.Search` existed in the design system for exactly this job and had **zero consumers**. It
also could not have served the screens that needed it most: it bound directly to the table's global
filter, so it only ever narrowed rows already in the browser, while the directory and custodian
searches run on the server.

**Decision:** build the second object, and build it once.

**The top bar keeps the whole application.** It stays the command palette, keeps `Ctrl K`, and grows
records as their registries ship. It is never scoped to the screen behind it.

**Every screen gets `ScopedSearch`.** A design-system component carrying the shape the standing
list-screen rule already decided — everything above the data that is not the data is a single row,
with searching as an icon control that opens what it needs when it is needed:

- it rests as an icon, so a screen nobody is searching pays no vertical space for the affordance;
- it expands on use and collapses again when left empty;
- a live query keeps it open and takes a single accent hairline at the field's edge, so a narrowed
  list always carries its reason on screen;
- there is no clear button in the field: Escape clears the query, a second Escape collapses the
  control and hands focus back to the icon that opened it;
- the surface's own scope control sits at the field's inline start, and the count at its inline end;
- it answers `/`.

**The two chords are the load-bearing distinction.** `Ctrl K` goes places; `/` finds records. A
person never has to reason about which control they are in, because they reached it by a different
key, in a different place, wearing a different shape.

**The scope names the surface and never says "everywhere".** "This list", "This matter", "Files
only". The vocabulary belongs to the screen; the component supplies the seat and no words. This is
the file-manager ruling generalized: application-wide search is the top bar's job and nothing
else's.

**The component owns the query and its own open/closed behaviour, and nothing else.** Whether the
query filters rows in the browser or goes to the server is the screen's business. That is what lets
one control serve a client-side table and a server-run register with the same appearance, and it is
the specific thing the old `DataTable.Search` could not do. `DataTable.Search` survives as the
one-line client-side binding over it — it drives the table's global filter and reads the filtered
and core row models for the count — so a table inherits the shape rather than re-deciding it.

**The primary action never moves.** In a right-aligned action row, a field that expands to the
inline start of the primary action grows into empty space; a field that expands after it shoves the
button sideways on every keystroke of the first character. The search group therefore sits to the
inline start of the primary action. This is the file-manager ruling ("New keeps its place and does
not reflow when the search expands") applied to a right-aligned row rather than a left-aligned
toolbar.

**Rejected — scope the top bar to the current screen.** It costs no vertical space and needs no new
control, which is what makes it tempting. It fails on the thing that matters: the palette and the
screen search become one object answering two questions, and the failure mode is not cosmetic. A
scope that can widen to everything is a scope that can be in the wrong position, and a search that
sometimes returns a settings page when you asked for a matter is untrustworthy for both jobs. The
file-manager ledger reached this conclusion already and wrote it down as a scope vocabulary with no
"everywhere" in it.

**Rejected — an always-present labelled field.** This is what the two screens built without a ruling
reached for, and the standing list-screen rule struck it out by name on the day this decision was
taken: a labelled dropdown and a labelled search box, each with a sentence under it, cost three rows
of a screen whose subject is a list. It is permanent chrome on every list, paid whether or not
anyone searches.

**Consequences.** Matters and the file manager replace their hand-rolled implementations with the
component and lose a layout shift they had. The directory and custodian change shape, from a
labelled field to an icon in the action row. Matter parties, matter costs, notifications, user
administration and tools gain a search they do not have, at no cost in vertical space. Conflicts
deliberately stays as it is. Each of those is a screen-owner's change, not the component's.
