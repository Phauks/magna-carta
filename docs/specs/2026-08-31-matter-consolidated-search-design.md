# Matter consolidated search — design

**Date:** 2026-08-31
**Status:** Slice 1 is built. M1, M2 and M4 are settled by the owner; M3, M5, M6 and M7 carry
standing recommendations the build proceeded under, each reversible and each recording in section 11
what would have to change if it is corrected.
**Scope:** Searching **within one matter** — the control in the matter header, the scope vocabulary,
the source registry the whole thing is built from, the one API route, the results surface, and the
order the sources arrive in.
**Excludes:** the top bar's command palette (a different object, ADR pending
`a-screen-search-is-a-different-object-from-the-command-palette`), firm-wide search of anything,
firm-wide note search (an open gate in [`../../ROADMAP.md`](../../ROADMAP.md)), and any change to the
discovery search index beyond consuming the port it already exposes.

**Binding inputs, in order of authority:**

- The owner's direction of 2026-08-31: _a search button at the top right of the matter screen,
  defaulting to the screen it is on, changeable to other screens and to the whole matter._
- The screen-search decision
  ([`../decisions/0403-a-screen-search-is-a-different-object-from-the-command-palette.md`](../decisions/0403-a-screen-search-is-a-different-object-from-the-command-palette.md))
  — `ScreenSearch` is the one control for searching within a screen, it already ships a `scope`
  seam, and the seam names the matter file manager's dropdown as the first thing that will sit in
  it. This design is that seam being filled.
- The file-manager rulings ledger
  ([`../conventions/file-manager-rulings.md`](../conventions/file-manager-rulings.md)) — S1, S4, S5,
  S6, S8, S9, S12, S15, S17b, S18, S19, S20, N15, A27, A28. The owner has already ruled on most of
  this surface; those rulings bind except where section 11 says the owner has superseded one.
- The standing list-screen and control rulings
  ([`../conventions/design-corrections.md`](../conventions/design-corrections.md)) — one compact
  action row, one place to narrow, a listing states how many there are while a capped answer states
  that it is capped, a designed-but-unserved capability still renders disabled with its Soon line.
- The federated timeline's source registry (`packages/calendar/src/sources/`) — the architecture
  this design copies rather than reinvents, including its visibility seam and its bounded fan-out.
- The corpus decision (`packages/search/src/corpus.ts`) — a review set is its own corpus so that a
  matter search is _structurally unable_ to name material an opposing party produced.

---

## 1. What this is, in one paragraph

**A matter is fourteen screens holding one case, and nothing today can ask that case a question.**
A person who remembers "there was something about the easement" has to guess which section it was
filed under and search that section — if that section happens to have a search box, which five of
them do not. Consolidated matter search is one control, seated in the matter's own header so it is
on every section by construction, that runs a query against the sections the reader is permitted to
read and answers grouped by section. It opens scoped to the section the reader is standing on,
because that is the question they are most often asking, and it widens to the whole matter in one
gesture. It never widens past the matter: searching everything is the top bar's job, and a control
that could be in the wrong position is untrustworthy for both jobs (S18, and the screen-search
decision's rejected option).

## 2. The shape of the control

### 2.1 Where it lives, and why that puts it on every screen

It renders in `apps/web/src/routes/(app)/matters/[id]/+layout.svelte`, inside `MatterHeader`'s
`Masthead.Actions` — the matter's top-right action rail, beside the ⋯ overflow.

That placement is the mechanical half of "build it into every screen". The layout wraps every
section under `/matters/[id]/`, so **a section cannot forget to have the search, and a section
cannot have a different one.** The alternative — each section mounting its own — is the exact defect
the screen-search decision was taken to end: eleven copies improve one at a time and drift in
between.

Order within the rail: **the search sits to the inline start of the ⋯ overflow.** This is ruling N15
("swap New and Search so New keeps its place and does not reflow when the search expands") applied
to a right-aligned rail — `ScreenSearch` always grows toward the inline start, so a field placed
after the overflow would shove it sideways on the first keystroke.

### 2.2 The control itself

`ScreenSearch` from the design system, unmodified. The component already owns the query string, the
debounce and the in-flight flag; this surface supplies:

| Prop           | Value                                                                     |
| -------------- | ------------------------------------------------------------------------- |
| `label`        | `"Search this matter"`                                                    |
| `searchOn`     | `"pause"` — the query leaves the machine                                  |
| `scope`        | the snippet below; **this is the seam's first production consumer**       |
| `matchSummary` | the total across the answering sources, once section 10's slice 4 arms it |
| `shortcut`     | `null` for now, per the screen-search decision's reasoning                |

Its shape is already ruled: rests as an icon costing no vertical space, expands on use, collapses
when left empty, a live query keeps it open behind the accent hairline, no clear button (Escape
clears, a second Escape closes).

### 2.3 The scope dropdown

Seated at the field's leading edge — the ruled position (S4: a dropdown, not oversized circular
buttons, aligned to the field's left edge). Its vocabulary belongs to the surface and **never says
"everywhere"** (S18).

Order, top to bottom:

1. **This section: _Files_** — the section the reader is standing on, resolved from
   `page.url.pathname`. Selected by default.
2. **Everything on this matter** — every source the reader may read.
3. A rule, then **every other section**, in `matterSections` order, so the dropdown reads in the
   same order as the tab strip above it.

A section whose source does not exist yet **renders disabled, with the "Soon" badge and one honest
line naming what it waits on** — the standing rule, and the one most often skipped. It is never
omitted: a reader who cannot find "Time" in the list learns nothing, while a reader who sees "Time —
Soon: narrative search lands with the time source" learns exactly where they stand.

**When the current section has no source**, the default falls back to _Everything on this matter_
rather than opening on a disabled option. The control never opens in a state that cannot answer.

### 2.4 Two results surfaces, and why both

- **The panel** — top hits under the field, grouped by source, a few rows per group. This is the
  fast path: most searches end here.
- **The full results page** at `/matters/[id]/search?q=…&in=…` — ruling S8, because a reader may
  want to act on or download the whole result set, and a hover cannot carry that. **"Open full
  results" sits at the top of the panel, on the same line as the scope selector** (S9), and the
  results page carries the search field in its own header where the view is named (S12, S20).

## 3. The architecture: a registry of declared sources

The whole design is one idea, and it is borrowed rather than invented. `packages/calendar/src/sources/registry.ts`
already solves the structurally identical problem — many subsystems, one federated read, one
visibility seam, a bounded fan-out — and states the property worth having in its own words: _a
federated timeline cannot disagree with the register it is built from, because it is that register._
The same holds here. A matter search that reads each subsystem's own rows cannot return a stale or
divergent answer, because there is no second copy of anything.

### 3.1 `@magna-carta/matter-search` — the source declaration

A new package, exporting the registry and the bounded-select builder. A **source** is a declaration,
never a write-path obligation on the subsystem that owns the rows:

```ts
export interface MatterSearchSource {
  // Stable and a WIRE CONTRACT: it appears in responses and in the `in` filter, so it is
  // permanent once shipped.
  readonly key: string;
  // The matter section these rows belong to. Drives the scope label, the group heading and the
  // deep link, so those three can never disagree about which tab a hit opens.
  readonly sectionSlug: string;
  // The read capability this source's rows sit behind, from the access-control registry. A source
  // the member does not hold is dropped from the registry BEFORE any statement is built.
  readonly permission: KnownPermission | null;
  // Which of the two shapes a record list comes in. A LISTING is walkable and carries the size of
  // the whole answer; a RANKED answer is in the server's order and says when it is capped. The
  // wire keeps them apart because the standing ruling says a screen must not present them alike.
  readonly answerShape: "ranked" | "listing";
  // What this source actually matches, in the reader's words ("the note's current text",
  // "file names"). Rendered on the group so nobody has to guess why a hit is a hit.
  readonly matchedFields: readonly string[];
  // Whether this source projects a non-privileged excerpt, or DECLARES that it has none. Absence
  // is a decision with a reason, never an oversight — the calendar's declaresLabel idiom.
  readonly declaresSnippet: boolean;
  // Below this the source cannot answer usefully: 3 for a trigram index, 2 for a LIKE scan.
  readonly minimumQueryLength: number;
  // Bounded statements for this request. Returns an empty array when the scope cannot match, so
  // the caller issues nothing rather than a query that cannot hit.
  readonly buildStatements: (request: SourceSearchRequest) => readonly SqlStatement[];
  readonly project: (row: MatterSearchRawRow) => MatterSearchHit;
}
```

### 3.2 What the builder guarantees structurally

`boundedMatterSearchSelect` is the one place a source's SELECT is assembled, so four properties are
structural rather than remembered — the same trick `calendar/src/sources/build.ts` plays:

1. **The matter binding is composed by the builder, not by the source.** A source hands in the
   expression naming its matter and cannot decline to. **A source physically cannot search across
   matters**, which is the single most important property this surface has.
2. **The visible-matter predicate is composed into the WHERE clause before the LIMIT**, reusing
   `visibleMatterPredicate` from `@magna-carta/calendar/visibility` (already the shared seam —
   `packages/notes` imports it today). A post-filter would under-fill the page and turn the page
   size into an existence oracle.
3. **Every statement carries a LIMIT**, always `limit + 1`, so `capped` is measured rather than
   guessed.
4. **The query text arrives as a binding, escaped for `LIKE`.** The wildcards are the caller's text,
   not their instruction — the notes statement already gets this right and the escape moves into the
   shared builder so no future source gets it wrong.

### 3.3 The corpus rule, stated where it binds

`packages/search/src/corpus.ts` already records why a review set is its own corpus: material an
opposing party produced may be attorney's-eyes-only under a protective order, and a matter-scoped
query that could reach it would be a disclosure nobody authorized.

This design inherits that and makes it enforceable one level up: **no registered source reads a
review-set table.** A fitness test scans every registered source's statements for `review_` table
names and fails on a hit. The rule lives in the registry's own documentation, because the registry
is the only place a fourteenth source could be added.

### 3.4 Snippets are allowed here, and that is a real distinction

The federated timeline carries **no** privileged content, because it spans matters — an email
subject on a firm-wide read is a leak. A matter search does not span matters: every hit is inside
one matter the reader has already opened, behind a permission they already hold, and in most cases
on a screen that would render the same text in full. The notes statement records exactly this
reasoning already: _every row this can return is a note whose body the same reader is already being
shown on the same screen._

So snippets are permitted, with two constraints that keep the permission honest:

- `declaresSnippet` is per source and declared. A source over a `protected()` encrypted column, or
  over a sensitive directory identifier, declares `false` — it returns the pointer and the reader
  follows the link into the subsystem's own audited read.
- The per-source `permission` gate is what actually protects the content, and it is checked before
  any statement is built (section 4.2). A snippet never rides a source the reader could not open.

## 4. The API: one route

```
GET /api/v1/matters/{matterId}/search?q=&in=&limit=&includeDeleted=
```

### 4.1 Parameters

| Name             | Meaning                                                                                                                                                                                                                                                                                                                                                               |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `q`              | The query. 2–200 characters; a source with a higher `minimumQueryLength` reports itself skipped rather than answering emptily.                                                                                                                                                                                                                                        |
| `in`             | Repeatable source key. **Absent means every source the member may read** — there is no magic "everything" value, because the vocabulary must never grow a word that means "wider than this matter".                                                                                                                                                                   |
| `limit`          | Per-source cap. Defaults to the panel's need; the results page asks for more.                                                                                                                                                                                                                                                                                         |
| `includeDeleted` | Whether records the firm deleted join the answer. Honored only by the sources that DECLARE they can honor it. **Not built: a per-group cursor.** A group reports `hasMore` and the results page raises the limit rather than walking; paging one group without the others is a shape the surface has no use for yet, and the keyset it would need differs per source. |

`in` **narrows the registry before any statement is built** — the calendar's `select()` precedent. A
Files-only search issues one statement, not fourteen. This is what makes the default scope cheap:
the common case is the narrowest one.

### 4.2 The two permission gates, and why there are two

`RouteMeta` names exactly one permission, and this route spans a dozen subsystems with a dozen read
capabilities. Resolving that:

- **Primary gate:** a new permission `search:matter` — "run a consolidated search within a matter" —
  seeded to every default role. It is a real gate (a firm can withhold the consolidated surface
  without withholding the sections), and it is also load-bearing for the second gate: the chokepoint
  only populates the resolved permission set for a route that names a non-null permission.
- **Per-source gate:** the handler reads `requireChokepointPermissions(c)` and **drops every source
  whose `permission` the member does not hold, before the registry builds anything.** Not a
  post-filter on results — a source the reader cannot see never runs a query.

The response names which sources answered and which were withheld for want of a capability, so
**"nothing in Time matches" and "you cannot read Time" are different answers.** Conflating them
would teach a reader that the matter holds nothing when it holds something they simply cannot see.
This discloses the reader's own permission set and no firm data.

### 4.3 The response shape

One group per source — never a flat merged list:

```jsonc
{
  "query": "easement",
  "groups": [
    {
      "source": "notes",
      "section": "notes",
      "answerShape": "ranked",
      "matchedFields": ["the note's current text"],
      "hits": [
        { "id": "…", "link": "/matters/…/notes?entry=…", "snippet": "…", "recordedAt": "…" },
      ],
      "capped": true,
      "nextCursor": null,
    },
    { "source": "time", "skipped": "permission" },
    { "source": "files", "skipped": "query-too-short" },
  ],
}
```

Groups rather than one merged list, for a reason the ledger already settled: **a listing and a
ranked answer are two different objects and must not be presented alike.** A merged, re-ranked list
would put the best of an arbitrary slice at the top and read as the best of the matter's record.
Sources sort within themselves; the client renders the groups in registry order.

### 4.4 Route metadata

`operationId: "matterSearch.search"` · `surface: "app"` · `permission: "search:matter"` ·
`resource: "matter"` · `audited: false` · `idempotency: "optional"` ·
`rateLimit: "expensive"` — a fan-out is not a default-bucket read.

## 5. The client: one control, one presentation registry

Two files carry everything the browser knows about matter search:

- **`apps/web/src/lib/matters/matter-search.svelte`** — the control, the panel, the scope dropdown,
  the transport. Entirely generic: it enumerates whatever the registry returns and knows no source
  by name.
- **`apps/web/src/lib/matters/matter-search-presentation.ts`** — source key → icon, group heading,
  row snippet, href builder. **The only file on the client a new source touches.**

The results page is `apps/web/src/routes/(app)/matters/[id]/search/+page.svelte`, rendering the same
presentation registry at full size.

Transport is a same-origin `fetch` behind a hand-written seam, matching every other API call in
`apps/web` (`matters-api.ts`, `notes-api.ts`, `cost-api.ts` …) — not the generated
`@magna-carta/api-client`, which is a dependency decision the owner has not made.

## 6. How it stays on every screen — three mechanical guarantees

Conventions rot; these do not.

1. **The control is in the layout**, so a new section inherits it and cannot mount a second one.
2. **`sections.ts` gains a `search:` field on `MatterSection`** — either a source key, or `null`
   with a one-line reason. A new fitness check, `lint:matter-search-coverage` (in the
   `tooling/lint-one-ui/` family), fails when a section declares neither. **Adding a section forces
   the answer**, which is what makes forgetting impossible rather than unlikely.
3. **`ScreenSearch` is already in the one-implementation registry**, so a screen that hand-rolls a
   second search box fails the gate. Consolidated search inherits that enforcement free.

## 7. How it grows — the cost of a fourteenth source

Adding one searchable section is:

| Layer                    | The change                                       |                                                                                                                                                                                                                                                                                                       |
| ------------------------ | ------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Domain                   | one source module: `buildStatements` + `project` |                                                                                                                                                                                                                                                                                                       |
| Registry                 | one line in `sources/all.ts`                     |                                                                                                                                                                                                                                                                                                       |
| Section                  | Answers today                                    | What it matches, and what it does not                                                                                                                                                                                                                                                                 |
| ------------------------ | ------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Files                    | **names only**                                   | `file.name`. **Contents are not searchable**: the engine, write pipeline and compaction are built but none is deployed, so `SearchIndexPort` answers `engine-not-implemented` and the surface says so.                                                                                                |
| Time                     | **yes**                                          | `time_entry.narrative`, ordered by the day the work was done.                                                                                                                                                                                                                                         |
| Costs                    | **yes**                                          | `cost_entry.description`.                                                                                                                                                                                                                                                                             |
| Parties                  | **yes**                                          | The display name the firm records, and the capacity a party acts in. **Not the name corpus:** the directory keeps every name an entity has held, and its FTS5 trigram index is what finds a maiden name — this source does not read it yet, which is a deliberate later step rather than an omission. |
| Notes                    | **yes**                                          | `matter_note.body`, ordered by the day the note is about — the Notes tab's own order.                                                                                                                                                                                                                 |
| Custodian                | **yes**                                          | Packet names and custody numbers.                                                                                                                                                                                                                                                                     |
| Calendar                 | **yes**                                          | `matter_event.title` and `description`. A title the federated timeline refuses to project, allowed here because this read never leaves one matter.                                                                                                                                                    |
| Matter assets            | **yes**                                          | `matter_asset.description` only. The typed identifiers beside it are `protected()` columns, and matching them would be a decryption oracle — a member could confirm a full account number by typing it.                                                                                               |
| Billing                  | **yes**                                          | `invoice_line.description` and the invoice's number. Driven from `invoice_line`, the only table here that knows the matter — an invoice belongs to a client and may bill several of their matters.                                                                                                    |
| Fees                     | no                                               | **Not an unwritten source — an unbuilt store.** A fee is designed as its own dated work-in-progress record and nothing on the wire carries one; the billing routes serve invoices, which are what happens to a fee after a bill takes it up.                                                          |
| Trust, Messaging, Emails | no                                               | The sections themselves are stage `soon`.                                                                                                                                                                                                                                                             |
| Overview                 | never                                            | It summarises the other sections; a source here would answer the same query twice.                                                                                                                                                                                                                    |
| Discovery review sets    | **never**                                        | Corpus isolation, section 3.3.                                                                                                                                                                                                                                                                        |

Slice 1 shipped **four sources and ten declared Soons**; slice 2 took that to **nine and five.** That ratio is the point: the
surface is honest on day one and the ledger of what is missing is on screen rather than in a
backlog.

## 9. Performance

- **The fan-out scales with the registry, not with the firm's data** — the calendar's own
  distinction between a bounded fan-out and an N+1. Fourteen sources is fourteen bounded statements
  in the worst case, one in the common case.
- **`in` narrows before building**, so the default scope (one section) is the cheapest query.
- **A `LIKE` scan is bounded by the matter predicate first.** That is genuinely bounded for notes
  (counted in tens) and custody packets. It is **not** obviously bounded for time entries or files
  on a long-running matter, which run to thousands. So: each source declares its expected volume,
  and the fan-out is measured against the load-profile fixtures before slice 2 adds the high-volume
  sources. Where a scan will not hold, that source moves behind an index — the port for files
  already exists. Golden rule 10: measured, not guessed.
- **The panel's per-source limit is small.** The results page pays for depth; the panel does not.

## 10. Build order

| Slice | Contents                                                                                                                                                                                                                                                                          | Gated on                                                                                  |
| ----- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| 1     | **Built.** The package + registry + bounded builder, the route, `search:matter` and its seed, the control in the matter layout, the results page, four sources (Files-by-name, Parties, Notes, Custodian), ten declared Soons, and `lint:matter-search-coverage`                  | —                                                                                         |
| 2     | **Built.** Time narratives, cost descriptions, calendar titles, matter-asset descriptions and the billing lines — behind the load-profile gate, which ran first and found a full table scan in the parties source. Fees is the one that cannot follow: it has no store to search. | —                                                                                         |
| 3     | File **contents**: the Files source gains a second half over `SearchIndexPort` for the matter corpus, fused with the name match                                                                                                                                                   | the search Container deploy, already queued in [`../deploy-queue.md`](../deploy-queue.md) |
| 4     | The seams `ScreenSearch` already ships: `matchSummary` in-field count, and the `shortcut` chord once the palette gains records                                                                                                                                                    | slice 1                                                                                   |
| never | Review sets. A scope that says "everywhere".                                                                                                                                                                                                                                      | —                                                                                         |

## 11. Owner flags

Three are settled. Four carry a standing recommendation the build proceeds under; each is
reversible, and each says what would have to change if it is corrected.

**M1 — placement. Settled 2026-08-31: the top right of the matter screen.** File-manager ruling
**S1** put the matter search **next to the matter status chip**; the owner's direction supersedes
that placement. S1's substance — that this control searches the whole matter, billing and time
included, and is neither the app header nor the file-manager toolbar — is unchanged and is what this
design builds.

**M2 — the file manager's Search Results view. Settled 2026-08-31: one results surface.**
`/matters/[id]/search` renders every group, and the **Files group is drawn with the file manager's
own row machinery** so its right-click menu, download, restore and the S19 deleted-files option all
survive rather than being rebuilt. The rail's Search Results row navigates there pre-scoped to
Files, keeping S17b's promise that there are several ways to reach it and that clicking it with no
live query is never a dead click. This supersedes S12, S20 and S17b's placement of the field and the
view; **A27's "Filter to This File" and A28's destination-scoped refusals move with the rows** and
are not lost. Rejected: both surviving (two results surfaces for one query, free to drift), and the
file-manager view retiring outright (its file affordances would be gone until the matter page grew
them).

**M3 — snippets within a matter. Recommendation standing.** Section 3.4 argues they are permitted
here, because every row a source can return is one the same reader may already open on the section
it links into — the reasoning `packages/notes` records for its own within-a-matter search — with
`declaresSnippet: false` for any source over a `protected()` column. _If corrected:_ every
group renders pointers only (record title, actor, instant) and the reader follows the link. That is
a change to the projections and the row snippets, not to the registry or the route. This is a
narrower question than firm-wide note search, whose gate stays open in the roadmap and whose answer
is already "no snippet".

**M4 — the query in the address. Settled 2026-08-31: yes.** `/matters/[id]/search?q=easement&in=…`
— a search survives a reload and can be handed to a colleague. The trade accepted with it: a
fragment of a matter's text lands in browser history. The URL already names the matter, and the
referrer surface is same-origin.

**M5 — the new permission `search:matter`, seeded to every default role. Recommendation standing.**
It is a real gate (a firm can withhold the consolidated surface without withholding the sections)
and it is load-bearing besides: the chokepoint populates the resolved permission set only for a
route naming a non-null permission, and the per-source gate needs that set. Rejected: changing the
chokepoint to populate the set for permission-less routes — a route with no gate should not silently
receive a capability list. _If corrected:_ the alternative is reusing an existing broad key, which
would make the primary gate mean something it does not.

**M6 — how far "include deleted" generalizes. Recommendation standing: per source, declared, never
one global toggle.** Ruling **S19** gives the file source its "Include deleted files" option, off by
default, because a file is soft-deleted and its name is legitimately findable afterwards. A note is
deleted outright and has no deleted set to offer at all, so its source declares that the flag means
nothing to it and the runner never hands it one. Those are two subsystems that decided differently
for good reasons, and a global toggle would force one answer onto both.

**M7 — a source withheld for want of a permission. Recommendation standing: say so.** Section 4.2
keeps "nothing in Time matches" and "you cannot read Time" as different answers. The alternative is
silence, which teaches a reader the matter holds nothing when it holds something they simply cannot
see. What is disclosed is the reader's own permission set, never firm data. _If corrected:_ the
withheld groups are dropped from the response and the scope dropdown hides them.

## 12. What this design deliberately does not do

- **It does not touch the top bar.** The palette stays the command palette, keeps `Ctrl K`, and
  grows records as their registries ship. The two searches stay two objects.
- **It does not add a second narrowing mechanism to any section.** Ruling: one place to narrow. A
  section that gains a source loses its own hand-rolled search box in the same commit — the notes
  screen's inline field is the one that exists today.
- **It does not write a second copy of anything.** No search table, no denormalized index in D1, no
  write-path obligation on any subsystem. Each source reads the register that owns the rows, which
  is why the answer cannot disagree with the section it links into.
- **It does not rank across sources.** There is no cross-source relevance score, because there is no
  honest way to compare a note's `LIKE` hit against a directory trigram's bm25, and a false ordering
  reads as an authoritative one.
