---
slice: Matter consolidated search
group: phase-1
order: 5
research: n/a
spec: done
plan: n/a
built: in-progress
ui: done
load-profile: todo
tested: done
branch: claude/matter-consolidated-search-yba72d
active-work: docs/active-work/claude/matter-consolidated-search-yba72d.md
next: the sources whose text is already in D1 (time narratives, cost descriptions, fees, calendar titles, assets, invoice numbers), measured against the load profile first
link-spec: docs/specs/2026-08-31-matter-consolidated-search-design.md
link-plan:
adrs:
blocked-by:
---

One search over everything on a matter, opening scoped to the section the reader is standing on and never widening past the matter. `@magna-carta/matter-search` is a registry of declared read-side sources on the federated timeline's pattern: a source says where its rows live, which capability gates them, and how to project one, and the shared builder composes the matter binding and the visible-matter predicate itself — so a source physically cannot search across matters, and no registered source may name a discovery review table. `GET /api/v1/matters/{matterId}/search` narrows that registry twice before building anything, by the reader's scope and by the capabilities they hold; a withheld source is reported rather than returned empty. The control is `ScreenSearch` with its `scope` seam filled, rendered from the matter layout so every section inherits it, with a panel for the fast path and a results page whose query rides in the address.

Four sources answer (files by name, parties, notes, custody) against ten sections that decline with the line saying what each waits on, and `lint:matter-search-coverage` refuses a section that answers neither way. **Built is in-progress rather than done** for two reasons that are not the same: the remaining sources are ordinary work, but the load-profile measurement is a gate in front of them — a `LIKE` scan is genuinely bounded for notes and custody packets and is not obviously bounded for time entries or files on a long-running matter, and that is measured before the high-volume sources are added rather than after. File **contents** are a separate wait: the engine, its write pipeline and its compaction are built, and the port answers `engine-not-implemented` until the search Container is deployed.

Four owner recommendations stand, each reversible and none of them reaching the registry or the route — the snippet within a matter, the `search:matter` key and its broad seeding, per-source rather than global "include deleted", and saying so when a source is withheld.
