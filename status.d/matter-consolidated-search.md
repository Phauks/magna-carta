---
slice: Matter consolidated search
group: phase-1
order: 5
research: n/a
spec: done
plan: n/a
built: in-progress
ui: done
load-profile: done
tested: done
branch: claude/matter-consolidated-search-yba72d
active-work:
next: file contents, once the search Container is deployed; the fee source is blocked on the fee store existing at all
link-spec: docs/specs/2026-08-31-matter-consolidated-search-design.md
link-plan:
adrs:
blocked-by:
---

One search over everything on a matter, opening scoped to the section the reader is standing on and never widening past the matter. `@magna-carta/matter-search` is a registry of declared read-side sources on the federated timeline's pattern: a source says where its rows live, which capability gates them, and how to project one, and the shared builder composes the matter binding and the visible-matter predicate itself — so a source physically cannot search across matters, and no registered source may name a discovery review table. `GET /api/v1/matters/{matterId}/search` narrows that registry twice before building anything, by the reader's scope and by the capabilities they hold; a withheld source is reported rather than returned empty. The control is `ScreenSearch` with its `scope` seam filled, rendered from the matter layout so every section inherits it, with a panel for the fast path and a results page whose query rides in the address.

Eight sources answer (files by name, time, costs, billing, parties, calendar, notes, custody) against six sections that decline with the line saying what each waits on, and `lint:matter-search-coverage` refuses a section that answers neither way. The registry answers in the section strip's own order, so the answer and the tabs above it never disagree about where things live.

**Since 2026-11-10 the five sections that hold writing match by word, through the record index.** Notes, time, costs, calendar and what was said in messaging read the firm database's full-text index, composed into each source's own statement so the matter binding and the visible-matter predicate still decide what comes back. A search finds a record containing every word typed, in any order, with the last word allowed to be unfinished; part of the middle of a word no longer matches. Names and numbers keep substring matching. The paragraph below describes the substring scan as it was measured before that change, and it still holds for the sources that kept it.

**The load-profile gate has run, and it found one real defect.** The measurement asks the question that decides whether the search can grow: not whether a substring match is fast — it cannot be, and no index makes it so — but whether the MATTER NARROWING is index-served, so the scan reads one case's rows rather than the firm's. The parties source, written as two LEFT JOINs onto the directory, planned a full scan of every entity the firm holds; it now drives from `matter_party` and resolves each name by primary key. Two sources materialise a sort (notes on a computed occurrence date, parties on a case-folded name); both are recorded rather than waved through, because the rows being sorted are rows the scan has already read and bounded by one matter.

**Built is in-progress rather than done, and what remains is no longer ordinary work.** Fees cannot be built at all: a fee is designed as its own dated work-in-progress record and nothing on the wire carries one, so there is nothing to search rather than a source nobody wrote. The matter-asset register is the mirror case — the query is written and reviewed, and it is unregistered because the strip's regrouping left the register with no screen for a hit to land on. File contents wait on a deploy. Everything the schema can answer today, answers. File **contents** are a separate wait — the engine, its write pipeline and its compaction are built, and the port answers `engine-not-implemented` until the search Container is deployed.

Four owner recommendations stand, each reversible and none of them reaching the registry or the route — the snippet within a matter, the `search:matter` key and its broad seeding, per-source rather than global "include deleted", and saying so when a source is withheld.
