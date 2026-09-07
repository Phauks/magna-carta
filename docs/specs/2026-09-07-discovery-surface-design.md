# The discovery surface — design

**Date:** 2026-09-07
**Status:** Design proposed. No product code in this cycle. Section 11 carries the owner questions; **D-A** (the address) and **D-E** (the access-list dead end) cannot be defaulted, and the second is a correctness question that reaching the surface makes reachable.
**White paper:** _Core domain_, _Tenancy & data isolation_. **Builds on:** [`2026-08-05-discovery-5-1-design.md`](2026-08-05-discovery-5-1-design.md) (the corpus, the lanes, processing, the two record artifacts), [`2026-08-07-discovery-5-2-review-workflow.md`](2026-08-07-discovery-5-2-review-workflow.md) (coding, privilege, redaction, production), [`2026-07-17-discovery-search-index-stateful-service-design.md`](2026-07-17-discovery-search-index-stateful-service-design.md) (the keyword index and its port), [`2026-08-31-matter-consolidated-search-design.md`](2026-08-31-matter-consolidated-search-design.md) (the source registry this copies, and the corpus rule it obeys), [`2026-09-07-report-screen-design.md`](2026-09-07-report-screen-design.md) (one registry, two screens — the same shape, applied to a different library).
**Scope:** where discovery is addressed, what a person does at each address, and the four registries the whole surface renders from.
**Excludes:** every backend change. Nothing here asks for a schema migration, a new route, or a change to an existing read — the surface this design describes is built entirely on reads and writes that already exist or are already specified in the two slice designs above. The semantic half of search stays deferred on its own flag, unchanged.

---

## 1. The question, answered first: no, it is not a search box

The framing is worth taking seriously, because a large part of what discovery does really is find a document among 250,000 of them, and the product already owns a keyword engine that would serve that. Five things in the built system say the framing is nevertheless wrong, and each of them would be violated by a surface designed around a search field.

**The corpus is deliberately not the firm's own record.** `index_split` is keyed by corpus rather than by matter (migration `20260819T000000_index-split-corpus-scope`), so a matter search is structurally unable to name a review set's splits. That was not a performance choice. Material an opposing party produced is under a protective order, it is not the firm's work product, and a search that could return both in one list is the failure the key shape exists to prevent. A surface whose organizing idea is "search" invites exactly the merge the schema refuses.

**The reader is not the same person.** The per-review-set access list is fail-closed: no row means no access, the predicate composes into SQL ahead of the `LIMIT`, and a member off the list gets 404 rather than 403 — the review set does not exist for them. A contract reviewer brought in for one production has no business in the matter's trust ledger, and the responsible attorney may not be on the review set at all. A search box inherits the reader of the screen it sits on; discovery has its own.

**The corpus has a lifecycle and search does not.** A review set moves `open → locked → closed` and never back, a load moves `declared → loading → processing → complete`, with `reversed` reachable from `complete` for a clawback, and every review document ends in exactly one of `processed` or `excepted`. Closing releases the derived artifacts — the extracted text, the metadata sidecars, the index splits — for collection. There is a real object here with states, and the screen's first job is to show which state it is in.

**Its outputs are documents a court reads.** The load manifest and the exception report are already built and already written to R2 at load completion; the privilege log and the production volume with its Bates numbers, burned redactions and load files follow. These are deliverables a firm hands to another party. No search engine has an output somebody files.

**And the reviewer's actual act is not searching.** A reviewer works a queue and presses keys — responsive, not responsive, privileged, next. Search is how they get into a queue and how they answer a targeted question mid-review. It is one verb among the surface's verbs, not the surface.

So: **discovery is a second workspace over a corpus that is not the firm's own record, and search is one of the ways you narrow it.** Everything below follows from taking that sentence literally.

## 2. Three addresses, one for each reader

The backend is matter-scoped — a review set is created at `/api/v1/matters/{matterId}/review-sets` — and the sidebar already announces a firm-wide `/discovery` row (`shipped: false`, `announced: true`). Both are right, for different readers, and the Custodian register is the precedent for how they divide: a firm-wide register at `/custodian` and a matter section at `matters/[id]/custodian`, one surface each, neither a copy of the other.

| Address                                | Who stands there                           | Archetype               | What it holds                                                                                                                                           |
| -------------------------------------- | ------------------------------------------ | ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `matters/[id]/discovery`               | The matter team, from inside the case      | List / Index            | This matter's review sets — state, load count, documents, exceptions outstanding — and the two things you start here: a review set, and a load into one |
| `/discovery`                           | A reviewer whose day is review, not a case | List / Index            | Every review set the member is on the access list for, across matters, with the matter named on the row                                                 |
| `/discovery/review-sets/[reviewSetId]` | Anyone working one corpus                  | Its own workspace shell | The corpus itself: its documents, its loads, its records, and the reviewer                                                                              |

**The workspace leaves the matter chrome, and that is the load-bearing part of this section.** A review set opened from the matter section navigates out of `matters/[id]/` rather than rendering inside it, for four reasons that each stand alone.

The matter header carries a consolidated search seated in `MatterHeader`'s action rail, on every section by construction. That control must never reach the review set — the corpus rule again — so on a discovery section it would be a search box, on screen, aimed at a different corpus than the documents underneath it. That is not a missing feature; it is a control that can be in the wrong position, which the matter-search design already rejected as untrustworthy for both jobs.

The matter header also carries one create control whose label is settled by the section registry before the section mounts. Inside the workspace the thing being created is a tag, a claim, a redaction or a production, none of which is the matter's.

The reader may not be a matter reader. Rendering the review set inside the matter's chrome puts the matter's identity block, its section strip and its money above a corpus that a contract reviewer is on the access list for and the matter is not their business.

And the canvas is wrong. A reviewer coding thousands of documents needs the height; a matter identity block plus a section strip plus a workspace's own chrome is three bars before the first document.

So the matter section is the **entry** and the workspace is the **destination**, and the matter section is small on purpose: a matter has a handful of review sets, not thousands, and everything expensive happens after you open one.

### 2.1 What the section registry obliges

`apps/web/src/lib/matters/sections.ts` requires every section to answer for search, for the timeline and for create, and refuses at module load and at lint otherwise. Discovery's answers are:

- **`searchSource: null`**, and the `searchWaitingOn` line is a **permanent** answer rather than an unbuilt one — the shape Overview and Activity use ("searching it would answer twice"), not the shape Tasks uses ("not wired yet"). The line to render on the disabled scope option is that a review set is a separate corpus behind its own access list, so the matter's search does not reach it. Writing "not wired yet" here would schedule work that must never be done.
- **`createNoun: CREATE_SEVERAL_KINDS`** — a review set and a load are two kinds, and the control's noun budget is seven characters, which "Review set" does not fit and should not be made to. The menu names the two.
- **`timelineSources: []`** — no federated timeline source produces discovery rows today. When one does (a load completing is the obvious first), this section owns it, and the coverage lint is what will say so.

The section's `stage` starts at `soon` and becomes `alpha` with the first build step in section 10. The `/discovery` destination's `shipped` flag flips in the same commit as the register, per the registry's own rule that a destination ships when its user-facing surface does.

## 3. The workspace: two presentations of one read

The review set has two working presentations, and they are the same read with the same criteria — not two screens.

**The list.** One table at the full width: the review-document page, keyset-ordered over `(sort_date, id)` with the undated tail last, one compact action row above it holding the primary action and one control to narrow. This is the standing list-screen shape, and discovery gets no exemption from it. In particular the classic e-discovery faceted rail down the left side is **refused**: the Custodian register kept a container tree in a left column and lost it on 2026-09-06 because a rail made that register read as a different kind of table from every other one in the product, and every narrowing discovery wants — the record custodian, the load, the family, the processing state, the exception code — is a property of the row and therefore belongs to the one narrowing control the ruling requires.

**The reviewer.** A queue on one side, the document in the middle, the panels on the other. This presentation _does_ earn its difference from a list screen, and the test the Custodian rail failed is the test it passes: the reviewer's act is not scanning rows, it is coding one document and moving to the next, so the queue is not a filter rail — it is the position marker in a walk, and the panels are where the work is written. A rail that narrows is a filter wearing the costume of navigation; a queue that advances is the task itself.

**Moving between them carries the criteria.** The narrowing you set on the list is the queue you review, because both are the same criteria set (section 5) resolved against the same read. That single property is what makes the surface feel like one place instead of two, and it is what makes "search, then review what you found" work without either presentation knowing anything about search.

The workspace's own top level is a small strip: **Documents** (the two presentations above), **Loads** (what has arrived, each load's state and progress, and the declaration form), and **Records** (the deliverables of section 8). Three, and the strip stays at three: a fourth entry that holds an answer the document list could give — everything excepted, everything uncoded — would be a pre-set filter wearing the costume of a destination, which the Custodian register's tab strip was corrected for on 2026-09-01. Exceptions are a narrowing, and the exception counts read is what puts the number on the narrowing control.

## 4. The four registries

The rest of the design is the answer to "modular and expandable", and it is not a new idea in this repository — it is the shape the sidebar destinations, the matter sections, the federated timeline sources, the matter-search sources and the report catalogue all already have: **declared data validated at module load, rendered by one screen, with a lint that makes the next addition impossible to forget.** Discovery needs four such registries, because it grows along exactly four axes.

The rule they share: **every declaration carries a `MaturityStage`, and an entry whose backend is not served renders visible, disabled, with the one line saying what it waits on.** That is the standing rule that a designed-but-unserved capability still renders disabled with its Soon line, and here it is what lets the surface ship now, honestly, with roughly half its entries dark — which is the only way "up and running" and "expandable" are the same sentence rather than opposite ones.

### 4.1 The narrowing registry — criteria providers

One control to narrow, as the list ruling requires, rendered from a registry of criteria providers. Each declares:

| Field     | What it decides                                                                                                                                                                                                           |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `key`     | Its slot in the criteria set, and the query parameter it rides in the address                                                                                                                                             |
| `label`   | What the reader calls it                                                                                                                                                                                                  |
| `shape`   | How it renders and what it holds: a pick from a served list, a set of enum values, a date range, a free-text query, a threshold                                                                                           |
| `options` | For a served-list shape, the read that fills it — the review set's record custodians, its loads, its tag groups                                                                                                           |
| `compose` | How it turns into the server read. **This is the whole point of the field:** most compose into `ReviewDocumentListFilters`, the keyword one composes into the search index port, and a later one may compose into neither |
| `stage`   | Ready, or the line it waits on                                                                                                                                                                                            |

What exists today, and what each waits on:

- **Custodian of Record**, **Load**, **Family**, **Processing state**, **Exception code** — ready. All five are columns on `review_document` with a sort-bearing index each, already in `ReviewDocumentListFilters`, already measured at the 250,000-document ceiling.
- **Date range** — a real gap rather than a missing line of UI: `sort_date` is the read's `ORDER BY` and not a filter. It renders disabled with that as its line until the read gains it.
- **Keyword** — the whole reason the "super-powered search engine" question gets asked, and it composes into `SearchIndexPort`, not into the list filters. It renders disabled with "the search engine is not deployed" until `SEARCH_SERVICE` is bound, and lighting it is then a binding plus a stage flip, not a screen change.
- **Tag / coding state** (including the uncoded and conflicting reads), **near-duplicate cluster**, **redacted members**, **privilege claim state** — each declared now with the sub-slice it waits on, so the control shows the shape of the finished thing on the day the surface first ships.

### 4.2 The panel registry — the reviewer's working edge

The reviewer's third region is a stack of declared panels, not markup. Each declares its `id`, `label`, `icon`, the permission it needs (`discovery:review` or `discovery:produce`), whether it is read-only when the review set is `locked` or `closed`, its `stage`, and its component.

Coding is the first and lands with the surface — the review set's groups as radio rows and flag sets, keyboard-first, because a reviewer codes thousands of documents. Then, each an entry rather than a change to the shell: the document's own facts (its custodian, its load, its dates, its extraction route and recognized-page count), its family, its occurrences — the copies a suppressed duplicate stays reachable through — its coding history off the tag event journal, its privilege claim, its redactions, and its near-duplicate cluster.

Adding a panel is one entry and one component. Nothing about the shell changes, which is the property that matters, because the panel list is where every remaining sub-slice of the review workflow lands.

### 4.3 The rendition registry — showing the document

A review document is a pointer, always, never a copy: it points at a `file_version`, an `email_message` or an `email_attachment`, and the bytes stay under the one blob store, the one scan gate, the one hold mechanism and the one destruction policy. The viewer therefore **serves content through the existing file-manager and email read paths and re-authorizes the pointer** — it does not acquire a private content path, and the safe-delivery sandbox from slice 2·3 is what it renders inside.

A registry picks the rendition from the source kind and the identified format: the PDF viewer, the image viewer, the email reader, and the extracted-text view — which is not a fallback but a first-class rendition, because for an excepted document, or one whose native format has no viewer, the extracted text plus the named exception code is the honest answer and is what a reviewer actually needs to code it. Redaction drawing and a recognized-text overlay are capabilities a rendition declares, not new viewers.

### 4.4 The deliverable registry — what the corpus produces

Every record discovery hands to somebody else is the same kind of object: produced from the corpus at a stated instant, written once, never edited, downloadable in the formats the protocol asks for. The load manifest and the exception report already exist, are already written to R2 at load completion, are already proved byte-identical across two renders, and today nothing can reach them. The privilege log, the production manifest and the DAT/OPT load files are the same object with different builders.

They share one surface — the workspace's Records strip entry — and one declaration: what it is, what it was drawn from, when it was produced, and its formats. The privilege log becoming a deliverable is then an entry, not a screen, and the first two lighting up is the cheapest real capability on this whole surface.

## 5. The decision the whole thing turns on: a selection is criteria, not identifiers

The four registries are organizing ideas. This one is a correctness property, and it is the difference between a surface that grows and one that has to be reworked at every sub-slice.

**A selection is a criteria set — the narrowing that produced it — and never a list of document identifiers.** The review workflow design already writes the materialized-selection contract so that the criteria source is opaque to its executor; this design states the client half of the same rule and makes it the unit that moves through the interface.

Three consumers take that one object, and none of them knows where it came from: the list read pages it, a bulk coding act materializes and freezes it, and production membership resolves it. Because they take criteria rather than identifiers, the day the keyword facet lights up, bulk tagging over search results works with no change to bulk tagging — which is precisely the seam the review workflow design named as "search-driven bulk tagging at index scale", and it is named there as something that composes rather than something to be built.

It is also what makes the address shareable: the criteria set serializes into the query string, so a narrowed queue is a link a supervising attorney can send to a reviewer, and the reviewer's queue is the same walk in the same order.

The one thing it must never do is decide who may see a document. Access is the review set's list, composed into SQL ahead of the `LIMIT`, on the server, on every read. Criteria narrow; they never authorize.

## 6. Where search actually sits

Search reaches this surface in exactly two places, and the distinction between them is a standing ruling rather than a preference: a listing states how many there are; a ranked answer states that it is capped, is in the server's relevance order, and is never re-sorted on the client.

**As a criteria provider**, keyword is one narrowing among several and the result stays the document list — the reader is walking a corpus they have narrowed.

**As a ranked answer**, a query asked of the whole review set returns best matches with their snippets, capped, saying so. This is a different object from the listing and it renders as one; never fake a listing out of a search.

Both are dark until the container is deployed and `SEARCH_SERVICE` is bound. Both are declared now. The semantic half stays deferred behind its own owner flag, priced and unmeasured, and its absence changes nothing structural: reciprocal rank fusion happens behind the port, so if it is ever built, the surface does not learn about it.

## 7. The state set

Every archetype ships the full state set, and discovery's states carry more information than most surfaces' because a corpus is often mid-flight. The empty review set (declared, nothing loaded), loading and processing (a load in progress with its counts, which is a real state a reader waits in rather than an interstitial), the dense list at volume, narrowed-to-nothing as distinct from empty, the excepted document (which is a rendered state, not an error), the locked and closed review set (every write control read-only with its reason), the error with its user-facing Error ID, and the state that only this surface has: **a document that is `processed` but not yet indexed**, which is normal today with no engine deployed and must read as "not searchable yet" rather than as a failure, because `index_state` already counts it from the corpus.

## 8. What is deliberately not on this surface

No second content path, no client-side extraction, no cross-review-set search, no cross-matter corpus, no filter rail, no report tabs, no technology-assisted review, and no editing of a produced record. And no reopening of a closed review set — the absence of a path back is the design of the model, and the surface renders that absence as a state rather than offering a control that fails.

## 9. How it grows — the cost of the next thing

The test of this design is what the next five additions cost, so they are stated as a bill.

| The next thing               | What it costs on this surface                                                          |
| ---------------------------- | -------------------------------------------------------------------------------------- |
| Keyword narrowing lights up  | A binding, and one `stage` flip on a criteria provider                                 |
| Privilege review lands       | One panel entry, one criteria provider, one deliverable entry                          |
| Redaction in review lands    | One panel entry, plus a capability declared on the PDF and image renditions            |
| Near-duplicate clusters land | One criteria provider and one panel entry                                              |
| A production is built        | One workspace strip entry, and deliverable entries for the manifest and the load files |
| Email threading lands        | One panel entry over the shipped `email_thread`                                        |

None of them is a change to the workspace shell, the list, the criteria set or the authorization path. That is the claim this design makes, and it is the one to hold it to.

## 10. Build order — what "up and running" means

The ordering principle is the UI roadmap's own: maximum "humans can exercise built backends" per unit of work. Slice 5·1 is built end to end and completely invisible, so the first step is unusually cheap for what it lights up.

**Step 1 — the corpus becomes visible.** The three addresses, the section registry entry, the `/discovery` row shipped. The matter section lists review sets and creates one; the workspace opens on Loads and Records. Declare a load from the matter's own files (the internal-files lane is built and moves no bytes), watch it process, and download the load manifest and the exception report. No search, no coding, no viewer. This exercises essentially all of 5·1 — the lanes, the processing queue, deduplication, container families, both record artifacts — and it is the first time any of it has been reachable by a person.

**Step 2 — the documents become readable.** The document list over the 5·1·4 read, the five ready criteria providers behind one narrowing control, the reviewer presentation, and the rendition registry with its four renditions. Read-only review: no writes at all. This is where the exception codes stop being a report and become a thing you can look at.

**Step 3 — the reviewer writes.** Sub-slice 5·2·1's surface: the coding panel, tag chips on the list, progress counts, the uncoded and conflict criteria providers, and bulk over a frozen criteria set with its exact undo. The backend is built; this is the panel and the criteria set meeting it.

**Step 4 — search lights up.** The deploy sequence in the deploy queue, then a stage flip.

**Steps 5 and after** — privilege, redaction, production, batches and assignment, threading and clusters: each of them a bill from section 9, in whatever order the owner's flags clear. **5·2·2 privilege review is gated on owner flags P1 and P3 today**, and steps 1 through 3 are unblocked by any of them, which is why the order above puts them first.

## 11. Owner questions

| #       | Question                                                                                                                                                                                                   | Recommendation                                                                                                                                                                                                                                                                  |
| ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **D-A** | Three addresses, with the workspace outside the matter chrome — or does the whole surface live inside `matters/[id]/discovery`?                                                                            | **Three, as in section 2.** The matter's own consolidated search and create control would both be aimed at the wrong corpus inside the workspace, and the reader of a review set is not always a reader of the matter                                                           |
| **D-B** | Does `/discovery` list review sets across matters for whoever is on their access lists?                                                                                                                    | **Yes.** It is what the announced sidebar row already promises, it is the contract reviewer's only home, and the visibility read it needs is a widening of the built matter-scoped one                                                                                          |
| **D-C** | Is the workspace's top level three entries — Documents, Loads, Records?                                                                                                                                    | **Yes**, and it stays three: a fourth holding an answer the document list could give is a pre-set filter wearing the costume of a destination                                                                                                                                   |
| **D-D** | Does step 1 ship before a document can be viewed at all?                                                                                                                                                   | **Yes.** It makes the whole of 5·1 exercisable, and the record artifacts a firm hands to another party are worth more to a first firm than a viewer is                                                                                                                          |
| **D-E** | **The access-list dead end.** A review set's list can be emptied and there is no way back — no Owner bypass, no operator override. Building the surface makes this reachable by a person clicking a button | **Refuse to revoke the last member on the list.** It keeps the wall exactly as strong (nobody sees through it, no role is exempt) and forbids only emptying it. This is the same recommendation the review workflow design already carries; the surface is what makes it urgent |
| **D-F** | The date-range criteria provider needs `sort_date` as a filter, not only as the sort. In scope for step 2, or declared and dark?                                                                           | **In scope for step 2.** It is a small widening of a read that already has the index, and a date range is the second thing anyone asks a corpus for                                                                                                                             |

---

## 12. Test plan

The registries are validated at module load and at lint, on the pattern the section registry already sets: a criteria provider that declares neither a `compose` nor a reason, a panel that declares no permission, a rendition claiming a format another rendition claims, and a deliverable with no formats are all failures before anything renders. Beyond that: the authorization tests are the ones that matter, and they are server-side and already written — the surface's own obligation is that no criteria set is ever composed as an authorization, which is a source-scan over the criteria module rather than a runtime test. The load-profile obligation is the list at the 250,000-document ceiling with every criteria provider set at once, against the measurements the review-document read already records.
