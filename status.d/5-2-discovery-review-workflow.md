---
slice: 5·2 — Discovery review workflow
group: phase-5
order: 2
research: n/a
spec: done by="Opus 5"
plan: n/a
built: in-progress by="Opus 5"
ui: todo
load-profile: todo
tested: in-progress by="Opus 5"
branch: main
active-work:
next: 5·2·2 — privilege review: `privilege_basis` (seeded), `privilege_claim` and its bases junction, claim editing under domain audit, the dangling-claim quality-control read, log fields derived from the metadata 5·1 extracts with per-claim overrides, and the draft privilege log as a paged read and an export
link-spec: docs/specs/2026-08-07-discovery-5-2-review-workflow.md
link-plan:
adrs:
blocked-by: The corpus index and the review-document list read (5·1·4) — the coding model and its API are built against the review documents directly, but the surface that pages through them, and criteria-driven bulk selection over search results, both sit on that read
---

**Sub-slice 5·2·1 built (backend) — tagging and coding, and the per-review-set access list the review-set model named and deliberately did not build.** Five per-firm tables in one migration (`20260808T000000_discovery-review-coding-and-access`, journal idx 51), the services and statement builders in `packages/discovery`, and fourteen routes in `apps/api-worker/src/routes/discovery/discovery-coding.ts`.

**The access list is the load-bearing half, and it is fail-closed.** No row means no access — an empty list is reachable by nobody rather than by everybody holding a discovery permission — so a bug in the seeding path hides a corpus instead of disclosing one, and only one of those two failures is the kind a person notices. **The predicate is composed in SQL, before the LIMIT, as a REQUIRED argument** to every statement builder that touches review-set content: a post-filter in the Worker would under-fill the page and turn the page size into an existence oracle for the rows it removed, and on a corpus whose whole point is that some people may not see it, that is the difference between a wall and a hint. A table-driven fitness pass enumerates every registered builder and asserts the marker is present, inside the `WHERE` clause and ahead of the `LIMIT`; a source scan proves the registry has not fallen behind the file it describes, and a behavioural pair proves the predicate actually excludes rather than merely appearing. A member not on a list gets a **404, never a 403** — "you may not see this one" names its existence. Widening a list requires `discovery:produce` and is audited; the last member cannot be removed, because under fail-closed an empty list is permanent short of a migration.

**Coding is per-document rows, always — family and bulk are scopes, not storage.** Applying to a family writes a row per member rather than one row members inherit, because inheritance resolved years later at production time is exactly where a bug becomes a produced privileged document; the event records the gesture, the rows record the result, and a production will read rows and only rows. **Single choice is structural, not guarded**: a partial unique index on `(document, group) WHERE removed_at IS NULL AND single_choice = 1`, with the group and cardinality denormalized onto the row precisely so the index can be written at all. Two concurrent writers cannot leave a document both responsive and non-responsive. **Rows are never deleted** — removal is a state with an actor and an instant, held by a CHECK that refuses half a removal. **Semantics, not names, drive the machine**: a closed vocabulary on the tag, so a firm renaming "Privileged" changes nothing, and a tag carrying one cannot be deactivated at all. Tags a firm creates carry none by design, so a renamed label can never change what a production withholds.

**Bulk freezes its selection before it writes anything** — resolved once through the access predicate, written to R2 under `selections/` (a record, not a cache, so it survives the review set closing), and walked. Criteria are recorded for humans and never re-run: a selection re-resolved per chunk tags documents the operator never saw. Chunks commit as several batches with the event in `running`, so a run that dies part-way leaves an honest partial rather than a silent one. **Undo is compensation and exact** — precisely the rows one act wrote and which are still live; a tag applied independently afterwards is untouched, a row already removed keeps its original attribution, and undoing a removal restores the original apply attribution behind two `NOT EXISTS` guards so a concurrent re-code wins rather than aborting. The undone act stays in the journal pointing at its reversal; an undo is itself an act and is not undone. **Coding writes no generic audit row**: the journal carries actor, instant, scope, criteria, frozen selection and reversal, and two homes for one fact drift. Panel and access-list changes are not coding decisions and do write one.

Progress counts and both quality-control reads ship: completion against the required questions, per-tag counts, the uncoded filter, and the **family-conflict read** — computed over the rows rather than stored, because a stored flag about two documents goes stale the moment either moves.

**Not built here and named.** The **UI is deferred to the owner** — the coding panel, tag chips on the list read, and the viewer pane are the surface this API is the backend half of, and the list read they page through is 5·1·4's. **Criteria-driven bulk at corpus scale** (everything matching a search, walked by a coordinator across turns) likewise waits on that index read; the materialized-selection contract is written so the criteria source is opaque to the executor, which is what lets it land without changing anything below it. Bulk today takes an explicit selection bounded by the same wall a load selection is. The **load profile** is 5·1·4's and stays `todo`.
