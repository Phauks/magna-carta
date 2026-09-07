---
slice: Discovery surface — the matter's section, the firm-wide register, and the review workspace over the built 5·1 corpus
group: phase-5
order: 3
research: n/a
spec: done by="Opus 5"
plan: n/a
built: done by="Opus 5"
ui: done by="Opus 5"
load-profile: todo
tested: done by="Opus 5"
branch: claude/discovery-tab-design-mmxyul
active-work: docs/active-work/claude/discovery-tab-design-mmxyul.md
next: the reviewer presentation — the queue, the document viewer over the existing file-manager and email read paths, and the panel registry it hosts — then 5·2·1's coding panel over the criteria set this surface already carries; the date-range criterion needs the document list read to gain a `sort_date` filter; keyword narrowing is a binding plus a stage flip
link-spec: docs/specs/2026-09-07-discovery-surface-design.md
link-plan:
adrs:
blocked-by:
---

Slice 5·1 was built end to end and completely invisible — the lanes, the processing queue, deduplication, container families and both record artifacts, with no screen anywhere. This is the surface over it, and the design that answers the owner's framing question first: **discovery is not a super-powered search engine.** Five built things say so — the split catalog is keyed by corpus rather than by matter so a matter search is structurally unable to name an opposing party's production, the per-review-set access list is fail-closed and its reader is not the matter's reader, the corpus has forward-only states where a search has none, its outputs are documents a court reads, and the reviewer's act is coding a queue. Search is one criteria provider among several.

**Three addresses, one per reader.** The matter's Discovery section lists that matter's corpora and starts one; `/discovery` lists every review set the member is on the access list for, across matters; and the workspace at `/discovery/review-sets/<id>` leaves the matter chrome entirely. That last is structural rather than a layout preference: the matter header mounts a consolidated search on every section by construction, and that search must never reach a review set, so a workspace inside the matter layout would put a search field on screen aimed at a different corpus than the documents underneath it. The matter's one create control has the same problem, and the reader may hold no matter access at all — which is also why the workspace names the matter as a fact on its meta line and never as a link.

**The expandability answer is the repository's own, applied twice where it is used and refused where it is not.** `criteria.ts` declares every way the corpus can be narrowed — five served today, four (keyword, date range, coding state, near-duplicate clusters) rendered visible and disabled with what each waits on and which read it will compose into; `deliverables.ts` declares every record the corpus produces for somebody outside the firm, two written and three declared. Under both, one property does the load-bearing work: **a selection is a criteria set and never a list of identifiers**, so the day keyword narrowing lights up, bulk coding over search results composes rather than being built. A panel registry for the reviewer's working edge was deliberately NOT written: nothing renders it yet, and a registry no screen reads is scaffolding.

**Two backend additions, both small and both necessary for the surface to be honest.** A firm-wide `readVisibleReviewSets` — the matter-scoped builder without its matter clause, registered in the visibility fitness pass in the same commit — because the wall is the access list and a register scoped by matter access would hide from a contract reviewer exactly the work they were given. And `GET /api/v1/loads/{loadId}/artifacts/{artifact}`, because the manifest and the exception report were reachable only as R2 keys on a row: the two records that are the entire point of the ingest lane could not be handed to anybody. It is audited as an export, access-scoped through the same list, and offers each record in the printable form first.

**What is deliberately not here.** No document viewer, no coding, no search, no production, no filter rail (the Custodian register lost one on 2026-09-06 and the reasoning binds), and no Records strip entry — a load's two artifacts belong to the load that wrote them, so a third strip entry would today be a screen that is always empty. The workspace strip is two entries and grows only when a deliverable exists that belongs to the review set rather than to a load, which is the privilege log.

**The access-list dead end changed shape on inspection, and the correction matters.** The feature ledger and the 5·2 design both record the last-member revoke refusal as an open owner question with nothing built; it is built, and its message names the remedy. The residual hole is on a different verb: the access predicate matches `member_user_id` with no active check while the platform's member reads treat a deactivated member as absent, so deactivating the one member on a review set's list — an ordinary act in Settings by somebody who has never heard of that review set — makes the corpus permanently unreachable with no route refusing anything. The guard cannot fire because it counts rows. Until that is closed, this surface deliberately does not offer the access list at all.
