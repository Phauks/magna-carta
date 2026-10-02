---
number: 403
slug: a-screen-search-is-a-different-object-from-the-command-palette
status: Accepted
date: 2026-08-30
area: Design system
summary: "Searching within a screen and searching the whole application are two different objects and the product builds them as two. The top bar keeps the command palette: it renders registries, answers Ctrl K, and goes places. Every list screen gets `ScreenSearch`, one centralized design-system component that rests as an icon in the compact action row, expands on use, collapses when left empty, keeps itself open with an accent edge while a query is live, and carries no clear button (Escape clears, a second Escape closes). The owner chose this shape over three alternatives and gave the reason: one component used by every screen gets better for all of them at once, where hand-rolled copies get better one at a time and drift in between. It is screen-dependent for now — each screen searches its own content — so the component owns the query string, the debounce and the in-flight flag, and owns no results and no transport: a screen hands over `onsearch` and says whether to run it on every keystroke (data already in the browser) or after a pause in typing (a request that leaves the machine), and the calling shape is identical either way. That is the specific defect being repaired: the previous table-bound search box could only narrow rows already in the browser, so the screens whose search ran on a server bypassed it, and it shipped with zero consumers. `DataTable.Search` survives as a thin preset over the shared control. Three future capabilities ship as built-and-exercised seams wired to no screen — a scope control at the field's leading edge, an in-field match count, and a shortcut key — because a screen search and a global search will meet once the palette gains matters and contacts as their registries ship, and the component should not need replacing when they do."
---

**Two searches that answer different questions are two controls. The moment one object answers
both, a person who searched for a matter and got a settings page stops trusting it for either.**

**Context:** the top bar carries a control labelled "Search or jump to". It is a command palette: it
renders registries — app destinations, settings sections, tools, the ecosystem sites — and it
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

`DataTable.Search` existed in the design system for exactly this job and had **zero consumers**. The
reason matters more than the fact: it bound directly to the table's global filter, so it could only
ever narrow rows already in the browser, while the directory and custodian searches run on the
server. The screens that most needed a shared control could not use the one that existed, so they
each built their own — which is how four shapes came to exist.

**Decision:** build the second object, build it once, and make the fact that it is built once
mechanically true.

**The top bar keeps the whole application.** It stays the command palette, keeps `Ctrl K`, and grows
records as their registries ship. It is never scoped to the screen behind it.

**Every list screen gets `ScreenSearch`**, carrying the shape the standing list-screen rule already
decided — everything above the data that is not the data is a single row, with searching as an icon
control that opens what it needs when it is needed:

- it rests as an icon, so a screen nobody is searching pays no vertical space for the affordance;
- it expands on use and collapses again when left empty;
- a live query keeps it open and takes a single accent hairline at the field's edge, so a narrowed
  list always carries its reason on screen;
- there is no clear button: Escape clears the query, a second Escape collapses the control and hands
  focus back to the icon that opened it.

**One component, enforced.** `ScreenSearch` is registered in the one-implementation registry, so a
second file claiming the name fails the gate. The owner's stated reason for choosing a centralized
component is that it gets better for eleven screens at once; a registry entry is what stops the
twelfth screen quietly starting a fifth shape.

**Screen-dependent, and the transport is the screen's business.** The component owns the query
string, the debounce, and the in-flight flag. It owns no results and knows no transport. A screen
hands over `onsearch` and says when to run it — `searchOn="keystroke"` for data already in the
browser, `searchOn="pause"` for a query that leaves the machine — and writes the same shape either
way. `DataTable.Search` becomes a thin preset that supplies `onsearch` from a table's global filter,
so the common client-side case stays one line while a screen that outgrows it reaches for
`ScreenSearch` directly with nothing on screen changing. This is the direct repair of the defect
that produced the drift.

**Three capabilities ship as seams, built and exercised in the catalog, wired to no screen.** Each
names in the code what will use it:

- **`scope`** — the surface's own scope control at the field's leading edge, the ruled position. Its
  vocabulary belongs to the surface ("Everything on this matter", "Files only", "This folder") and
  never says "everywhere", because searching everything is the top bar's job. The matter file
  manager's scope dropdown is the first thing that will sit there.
- **`matchSummary`** — a short count inside the field's trailing edge.
- **`shortcut`** — a key that expands and focuses the control from anywhere on the page, off by
  default. A chord is only worth teaching once the screen search and the palette can be confused
  with each other, which is what happens when the palette gains matters and contacts.

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

**Deferred, not rejected — shipping the scope control, the count and the shortcut now.** These were
presented together as a fourth option and the owner chose the plainer control, so they are seams
rather than features. The reasoning that survives from the rejected option is recorded above so it
does not have to be re-derived: the two-chord distinction is the cheapest way to keep the two
searches apart, and it becomes worth its teaching cost when the palette starts returning records.

**One thing the component cannot decide, and the screens must.** In a right-aligned action row, a
field that expands to the inline start of the primary action grows into empty space; a field that
expands after it shoves the primary action sideways on the first keystroke. The component always
grows toward the inline start, but the order of the row belongs to the screen. This is the
file-manager ruling ("New keeps its place and does not reflow when the search expands") applied to a
right-aligned row rather than a left-aligned toolbar, and the matters list currently has it the
other way round.

**Consequences.** Matters and the file manager replace their hand-rolled implementations with the
component and lose a layout shift they had. The directory and custodian change shape, from a
labelled field to an icon in the action row. Matter parties, matter costs, notifications, user
administration and tools gain a search they do not have, at no cost in vertical space. Conflicts
deliberately stays as it is. Each of those is a screen-owner's change, not the component's.
