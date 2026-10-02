---
number: 419
slug: a-matter-search-is-a-registry-of-sources-and-never-leaves-the-matter
status: Proposed — placement, results surface and address settled; four recommendations standing
date: 2026-08-31
area: Core domain
summary: "Searching within a matter is built as a registry of declared read-side sources, not as a screen. Each subsystem declares where its rows live, how to read a bounded page of them, which read capability gates them, and whether it has a non-privileged snippet — the same declaration shape the federated calendar timeline already uses, and for the same reason: a federated read cannot disagree with the register it is built from, because it IS that register. One control lives in the matter LAYOUT, so every section inherits it and no section can mount a second one; it is the design system's `ScreenSearch` with its `scope` seam filled, which is the consumer that seam was built for. One route, `GET /api/v1/matters/{matterId}/search`, narrows the registry before building any statement, so the default scope — the section the reader is standing on — is also the cheapest query. Two permission gates: a new `search:matter` primary, and a per-source gate that DROPS a source the member cannot read before it runs a query rather than filtering results afterwards. The shared statement builder composes the matter binding and the visible-matter predicate itself, so a source physically cannot search across matters. Review sets are structurally excluded, because a review set is its own corpus precisely so an ordinary matter search cannot name material an opposing party produced. Adding a fourteenth searchable section costs one source module, one registry line, one section flag and one presentation entry, and changes nothing about the route, the control or the results page. Owner-settled 2026-08-31: the control sits top right, there is one results surface with the Files group drawn by the file manager's own row machinery, and the query rides in the address; four smaller recommendations stand, each reversible and none of them reaching the registry or the route."
---

**A matter is fourteen screens holding one case, and nothing can ask that case a question.** A
person who remembers "there was something about the easement" has to guess which section it was
filed under and then search that section — if it happens to have a search box, which nine of the
fourteen do not.

**Context.** The product now has two settled searches and a gap between them. The top bar is a
command palette: it renders registries and answers _where do I go_. `ScreenSearch` is the one
control for searching within a screen, and it shipped with a `scope` seam whose documentation names
the matter file manager's dropdown as the first thing that will sit in it. What has never existed is
the object between them — a search that answers _where is that on this case_, across sections,
without ever widening past the matter.

The file-manager rulings ledger has been carrying most of this design's decisions for weeks: that
the matter search searches the whole matter and not just files (S1), that its scope is a dropdown at
the field's leading edge (S4), that its vocabulary never says "everywhere" because application-wide
search is the top bar's job (S18), that it needs a real results page rather than only a hover (S8),
and where "Open full results" and the field itself sit (S9, S12, S20). Those were ruled against a
mockup. This decision is what they attach to in shipped code.

**Decision: build the read layer as a registry of declared sources, and copy the architecture rather
than invent one.** `packages/calendar/src/sources/` already solves the structurally identical
problem — many subsystems, one federated read, one visibility seam, a bounded fan-out — and states
the property worth having in its own words: a federated read cannot disagree with the register it is
built from, because it is that register. A matter-search source declares its key, its matter
section, the read capability that gates it, whether its answer is a listing or a ranked one, what it
actually matches, whether it has a non-privileged snippet or declares that it has none, and two
functions: build bounded statements, project a row. **It is never a write-path obligation on the
subsystem that owns the rows, and there is no second copy of anything** — no search table, no
denormalized index, nothing that can drift from the section a hit links into.

**The shared statement builder carries what must not be forgotten.** A source hands in the
expression naming its matter and cannot decline to; the builder composes the matter binding, the
visible-matter predicate before the `LIMIT`, the `limit + 1` probe that makes `capped` measured
rather than guessed, and the `LIKE` escaping that keeps a query about a 50% fee split from turning
every following character into a match-anything. **A source physically cannot search across
matters**, which is the single most important property this surface has, and it is a property of the
builder rather than of anyone's diligence.

**One control, in the layout.** It renders in the matter's own header, top right, to the inline
start of the overflow menu — placement the owner directed on 2026-08-31, superseding S1's "next to
the status chip" while keeping everything S1 decided about what the control searches. Living in
`+layout.svelte` is the mechanical half of "on every screen": a section inherits it and cannot mount
a different one. It opens scoped to the section the reader is standing on, widens to the whole
matter in one gesture, and lists every other section — a section with no source rendering disabled
with its Soon line rather than being omitted, because a reader who cannot find "Time" in the list
learns nothing while a reader who sees why it is not there learns exactly where they stand.

**One route, narrowed before it builds.** `GET /api/v1/matters/{matterId}/search` takes a repeatable
`in` and narrows the REGISTRY before any statement exists, so a section-scoped search issues one
statement rather than fourteen — which is what makes the default scope the cheapest query rather
than the most expensive. There is deliberately no magic value meaning "everything": absent `in`
means every source the reader may read, because the vocabulary must never grow a word that could
mean wider than this matter.

**Two permission gates, and the second one runs first.** The route names a new `search:matter`
primary — a real gate a firm can withhold, and load-bearing besides, since the chokepoint populates
the resolved permission set only for a route that names a non-null permission. Then the handler
drops every source whose capability the member does not hold **before the registry builds
anything**. Not a post-filter: a source the reader cannot see never runs a query. The response says
which sources were withheld, so "nothing in Time matches" and "you cannot read Time" stay different
answers — conflating them would teach a reader the matter holds nothing when it holds something they
simply cannot see.

**Snippets are permitted here, and that is a real distinction from the timeline.** The federated
timeline carries no privileged content because it spans matters, where an email subject is a leak. A
matter search does not span matters: every hit is inside one matter the reader has already opened,
behind a capability they already hold. `packages/notes` records the same reasoning for its own
within-a-matter search — every row it can return is a note whose body the same reader is already
being shown on the same screen. So a snippet is allowed, `declaresSnippet` stays a per-source
declared decision on the calendar's `declaresLabel` idiom, and a source over a `protected()` column
declares that it has none and returns a pointer into the subsystem's own audited read.

**Review sets are structurally excluded.** `packages/search/src/corpus.ts` made a review set its own
corpus precisely so an ordinary matter search cannot name material an opposing party produced under
a protective order. The registry inherits that as a rule with a fitness test behind it: no
registered source reads a review table.

**Groups, never one merged list.** The standing ruling is that a listing and a ranked answer are two
different objects and must not be presented alike. There is also no honest way to compare a note's
`LIKE` hit against a directory trigram's bm25, and a false cross-source ordering reads as an
authoritative one. Sources sort within themselves; the client renders groups in registry order.

**Growth is the point, and it is priced.** A fourteenth searchable section costs one source module,
one line in the registry, one flag on the section, one presentation entry, and a status flip in the
feature ledger. The route, its contract, the control, the scope dropdown, the results page, the
permission plumbing and every existing source are untouched. Two gates keep that true: `sections.ts`
gains a required `search:` field — a source key, or `null` with a reason — checked by a new
`lint:matter-search-coverage` fitness function, so adding a section forces the answer; and
`ScreenSearch` is already in the one-implementation registry, so a screen that hand-rolls a second
search box fails the gate.

**Honest on day one.** Four sources exist to build against today — notes (a `LIKE` over the note's
text, ordered by the day it is about), custody, matter parties (their recorded display names, joined
through the party links) and file **names**. File **contents** are not searchable: the Tantivy engine, its write
pipeline and its compaction are built, but no engine is deployed, so the port answers
`engine-not-implemented`. That is nine declared Soons against four sources, and the ratio is the
point — the ledger of what is missing belongs on the screen, not in a backlog.

**Rejected — one route per section, fanned out from the browser.** It needs no new server
architecture and gets the permissions right for free, which is what makes it tempting. It fails on
growth: every new source is client work, there is no server-side narrowing, and the number of
requests scales with the number of sections rather than with the scope the reader chose. It also
puts the "which sections can this member read" judgment in the browser, where it is a rendering
decision rather than a gate.

**Rejected — a materialized matter search index in D1.** One table, one query, fast. It buys a
second copy of every subsystem's text, a write-path obligation on all of them, and the entire class
of bug where the search says one thing and the section says another. The registry's whole value is
that this class cannot be written.

**Rejected — scoping the top bar to the current matter.** Costs no new control, and it is the same
option the screen-search decision rejected for the same reason: a scope that can widen to everything
is a scope that can be in the wrong position, and a search that sometimes answers with a settings
page when you asked about a case is untrustworthy for both jobs.

**Settled by the owner, 2026-08-31.** The control sits at the **top right of the matter screen**,
superseding file-manager ruling S1's placement beside the status chip while keeping everything S1
decided about what the control searches. There is **one results surface**: `/matters/[id]/search`,
with the Files group drawn by the file manager's own row machinery so its right-click menu,
download, restore and deleted-files option survive rather than being rebuilt — the rail's Search
Results row navigates there pre-scoped to Files, which supersedes S12, S20 and S17b's placement
while keeping S17b's promise that clicking it is never a dead click. And **the query rides in the
address**, so a search survives a reload and can be handed to a colleague, accepting that a fragment
of a matter's text lands in browser history on a URL that already names the matter.

**Four recommendations stand, each reversible**, recorded as M3, M5, M6 and M7 in
[`docs/specs/2026-08-31-matter-consolidated-search-design.md`](../../specs/2026-08-31-matter-consolidated-search-design.md):
a hit may carry a snippet within a matter (with a source over a protected column declaring it has
none); `search:matter` is a new key seeded to every default role; "include deleted" is per source
and declared rather than one global toggle; and a source withheld for want of a permission says so
rather than reading as empty. Each names in the spec what would have to change if it is corrected,
and none of them reaches the registry or the route.
