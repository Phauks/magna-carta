# The discovery surface — design

**Date:** 2026-09-07
**Status:** Design accepted for build; step 1 of section 10 is being built in this stream. Section 11 analyzes the six owner questions and recommends an answer to each — the build proceeds under those recommendations, and each records there what would have to change if it is corrected. **D-A** (the address) shapes the routes, so it is the one to correct first if it is going to be corrected. **D-E** is not a product decision at all: it is a correctness hole on the member-deactivation path, restated in section 11 after reading the built code, and the surface withholds the access list until it is closed.
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

The workspace's own top level is a small strip: **Documents** (the two presentations above) and **Loads** (what has arrived, each load's state and progress, the declaration form, and the two artifacts that load produced). Two, and it grows only when a deliverable exists that belongs to the review set rather than to a load — the privilege log is the first, and it brings a **Records** entry with it (D-C). What the strip never gains is an entry holding an answer the document list could give: everything excepted, everything uncoded, everything from one custodian are narrowings, not destinations, and a strip of them is the pre-set-filters-wearing-the-costume-of-destinations mistake the Custodian register's tab strip was corrected for on 2026-09-01. The exception counts read is what puts a number on the narrowing control rather than a number on a tab.

## 4. The four registries

The rest of the design is the answer to "modular and expandable", and it is not a new idea in this repository — it is the shape the sidebar destinations, the matter sections, the federated timeline sources, the matter-search sources and the report catalogue all already have: **declared data validated at module load, rendered by one screen, with a lint that makes the next addition impossible to forget.** Discovery needs four such registries, because it grows along exactly four axes.

**All four are written, and each arrived with the screen that renders it.** `criteria.ts` and `deliverables.ts` came with the list and the loads; `review-panels.ts` and `renditions.ts` came with the reviewer. None was written ahead of a consumer, which is the rule: a registry no screen reads is scaffolding, and scaffolding is what "only real things" forbids.

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

They share one declaration — what it is, what it was drawn from, when it was produced, and its formats — and the declaration's SCOPE decides where it renders: a load's records render on the load that wrote them, and a review-set-scoped record renders on the review set. That is why there is no Records strip entry yet (D-C): declaring the scope means the strip follows from the registry rather than being decided ahead of it. The privilege log becoming a deliverable is an entry, not a screen, and the first two lighting up is the cheapest real capability on this whole surface.

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

**Step 1 — the corpus becomes visible.** _Built._ The three addresses, the section registry entry, the `/discovery` row shipped. The matter section lists review sets and creates one; the workspace opens on Documents and Loads. Declare a load from the matter's own files (the internal-files lane is built and moves no bytes), watch it process, and download the load manifest and the exception report. No search, no coding, no viewer. This exercises essentially all of 5·1 — the lanes, the processing queue, deduplication, container families, both record artifacts — and it is the first time any of it has been reachable by a person.

**Step 2 — the documents become readable.** _Built._ The document list over the 5·1·4 read, the five ready criteria providers behind one narrowing control, the reviewer presentation, and the rendition registry with its four renditions. Read-only review: no writes at all. This is where the exception codes stop being a report and become a thing you can look at.

**Step 3 — the reviewer writes.** Sub-slice 5·2·1's surface: the coding panel, tag chips on the list, progress counts, the uncoded and conflict criteria providers, and bulk over a frozen criteria set with its exact undo. The backend is built; this is the panel and the criteria set meeting it.

**Step 4 — search lights up.** The deploy sequence in the deploy queue, then a stage flip.

**Steps 5 and after** — privilege, redaction, production, batches and assignment, threading and clusters: each of them a bill from section 9, in whatever order the owner's flags clear. **5·2·2 privilege review is gated on owner flags P1 and P3 today**, and steps 1 through 3 are unblocked by any of them, which is why the order above puts them first.

## 11. The owner questions, analyzed

Six, each stated as what is at stake, the options with what each costs, and a recommendation. Two of them changed shape once the built code was read rather than the ledger's description of it, and those changes are stated where they fall.

### D-A — the address

**At stake:** whether a reviewer working a 250,000-document corpus does it inside the matter's chrome. Everything else in this design is indifferent to the answer; the registries do not know what route they render under, so this is reversible as a route move with no data change. It is nonetheless the first question, because two built controls behave differently on either side of it.

| Option                                                                  | What it costs                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **1. Everything inside `matters/[id]/discovery`**                       | The matter's consolidated search renders in `MatterHeader`'s action rail on every section by construction — that is the mechanical guarantee its own design relies on — so a reviewer reading an opposing party's production has a search field on screen, at the top right, aimed at a corpus that is not the one underneath it. The matter's create control has the same problem: its label is settled by the section registry before the section mounts, so it reads the review-set noun while a reviewer is coding a document. And the vertical budget goes to four bands before the first row: matter identity, section strip, workspace strip, table toolbar |
| **2. Matter section as the entry, standalone workspace, firm register** | One more top-level route, and a member who wants the matter from inside the workspace needs a way back to it (the header's named back link, which is the built pattern)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| **3. Firm-level only, matter as a filter**                              | A matter team member asking "does this case have a production yet" has to leave the matter to find out. The matter is the unit of work and the unit the corpus belongs to; making the answer live somewhere else costs every reader for the benefit of one                                                                                                                                                                                                                                                                                                                                                                                                         |

**Recommendation: option 2.** The deciding argument is not the vertical budget, which is a matter of taste — it is that option 1 puts a control on screen that can be in the wrong position. The matter search design already rejected exactly that shape of control for exactly that reason, and its rejection is the standing ruling here. The section-strip fold is corroborating rather than deciding: fourteen flat sections already did not fit at 1440, which is why they are grouped.

One consequence to accept with it: **the workspace is not under the matter layout, so it has no matter chrome at all** — the way back is `ScreenHeader`'s named back link, and the workspace's own header carries the matter's name as a fact on its meta line rather than as navigation for a reader who may have no matter access.

### D-B — what the firm-wide register lists

**At stake:** whether `/discovery` is the contract reviewer's home screen or a second view of the matter team's work.

The wall is the access list, not matter access — that is the whole point of a list that answers 404 rather than 403 — so the two possible scopings are genuinely different populations, not the same one filtered twice. Scoping the register by **matter** access would hide from a contract reviewer precisely the review sets they were brought in to work, which is the one reader the screen exists for. Scoping it by the **access list** shows each of them their own work and nothing else.

**Recommendation: scope it by the access list, across every matter.** It needs one read the platform does not have — the matter-scoped visible-review-sets statement without its matter clause — which is a small, well-precedented addition beside a builder that already composes the predicate ahead of the `LIMIT`, and it must join the visibility fitness registry in the same commit.

**With one detail worth deciding here rather than discovering later:** a row names its matter, because a reviewer holding four review sets needs to tell them apart and the matter is how anyone says which is which. The name is a fact on the row; it is not a link unless the reader has matter access. A row that navigates into a matter the reader cannot open would produce a 404 they cannot interpret, and a row that hid the matter's name would be unreadable for its own audience.

### D-C — the workspace's top level

**At stake:** the standing ruling that a tab strip is not a place to keep a report. Everything excepted and everything uncoded are answers the document list gives, so they are narrowings, not destinations, and the exception counts read is what puts a number on the narrowing control rather than a number on a tab.

**This one changed on inspection.** The design proposed three entries — Documents, Loads, Records — and Records does not survive its own test in step 1. The manifest and the exception report belong to a **load**: they are written at that load's completion, they reconcile that load's declaration against what arrived, and their keys are columns on the load row (`manifestR2Key`, `exceptionReportR2Key`). A Records strip entry in step 1 would therefore be a screen that either holds those two artifacts a second time, away from the load whose record they are, or holds nothing at all. A strip entry that is always empty is the same mistake as a menu of one.

**Recommendation: two entries now — Documents and Loads — with a load's two artifacts on the load, where they were produced.** Records arrives with the first deliverable that belongs to the review set rather than to a load, which is the privilege log. The deliverable registry is unaffected: it declares what each artifact is and where it is scoped, and "where it renders" follows from the scope rather than from a strip decided in advance.

### D-D — does step 1 ship before a document can be viewed

**At stake:** whether a surface that cannot show a document is worth shipping.

**What a firm can actually do with step 1:** create a review set on a matter, name whose records are in it, declare a load, put the matter's own files into it without moving a byte, watch every document reach exactly one terminal state, and download the manifest and the exception report — the document that converts "we produced everything we could read" from an assertion into a record. That is a real, complete act, and the exception report names each document by its source name, which is findable in the File Manager, so the loop closes even with no viewer.

**The risk that comes with it, which is not the one you would guess.** It is not that the surface is thin; it is that **the model is forward-only and the surface makes it reachable.** A review set created by mistake can be locked and closed and never deleted or reopened, and a load's documents are pinned versions that a second load cannot correct — a correction is another load. So step 1 ships a set of buttons whose effects are permanent, to people meeting the vocabulary for the first time.

**Recommendation: yes, ship it, and pay for the permanence in copy rather than in a gate.** The creation control states what a review set is and that it does not reopen; the close control states what closing releases; and neither is defended by a confirmation dialog that a person clicks through, which buys nothing. Creation is already behind `discovery:manageReviewSets` and loading behind `discovery:load`, which is the real gate.

### D-E — the access-list dead end

**This one was wrong in the first pass, and the correction matters.** The feature ledger and the review-workflow design both record the last-member refusal as an open owner question with nothing built; **it is built.** `revokeReviewSetAccess` reads the list's member count and refuses at one or fewer, with a message naming the remedy, and the route's own description states the refusal. The narrow fix that was recommended is already the behaviour.

**The residual hole is a different one, and the surface makes it reachable.** The access predicate matches on `member_user_id` alone, with no active check, while the platform's member reads gate on `member.status = 'active'` and treat a deactivated member as absent. So the count that guards revocation counts **rows**, not people who can sign in. Deactivate the one member on a review set's access list — an ordinary administrative act, performed in Settings, by somebody who has never heard of that review set — and the corpus becomes unreachable by everyone, permanently, with no route refusing anything, because nothing was revoked. The guard cannot fire: it is on the wrong verb.

| Option                                                                     | What it costs                                                                                                                                                                                                            |
| -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **1. Count active members in the revoke guard, and check at deactivation** | The guard starts meaning what it says; deactivation gains a precondition that names the review sets the member is the last active holder of and refuses until somebody else is added. One read on a path that is not hot |
| **2. Deactivation-time warning only**                                      | Cheap, and it fails exactly when it matters — the administrator deactivating a departing member has no idea what a review set is                                                                                         |
| **3. An Owner bypass**                                                     | Reopens the wall for every review set forever to fix a case that proper preconditions prevent entirely                                                                                                                   |

**Option 1, built** — as far as it can be. The guard now counts members who can act rather than rows (`selectReviewSetAccessCountStatement` joins `member` on `status = 'active'`), so it means what its own message says. And `readReviewSetsHeldOnlyBy` is the precondition the deactivation path must run: every review set where a member is the only active person on the list.

**What could not be built, and why that is not a hedge.** _Nothing in the platform deactivates a member._ The column exists, every permission read gates on it, the members listing prints it — and there is no route that sets it. So the precondition has no caller, and writing a member-deactivation precondition registry with one entry and no route would be exactly the scaffolding this design refuses elsewhere. The read is therefore written, tested against the case it exists for (the list that looks populated and is not), and named at the seam: the comment beside `status` in `apps/api-worker/src/routes/session/members.ts`, which is where a person building that route will be standing. The one owner question left inside it is whether deactivation refuses outright or demands a named successor on the spot; refusing with the affected review sets named is the smaller change.

Until that route exists, the surface still does not offer the access list: administering a wall from a screen is a different thing from the wall being sound, and it can wait for the wall.

### D-F — the date-range criteria provider

**At stake:** the second thing anybody asks a corpus, and a real gap rather than a missing line of markup — `sort_date` is the read's `ORDER BY` and not a filter.

The mechanics are better than they look. The read walks two segments, the dated one and the undated tail, precisely because a single keyset predicate over a nullable column either drops the tail or degrades to an `OR` the planner cannot range-scan — measured at 0.26 ms against 10.3 ms at the ceiling. A date range **naturally selects the dated segment only**: a document with no date matches no range. So the filtered read is the dated segment alone, over the same index, with one added bounded predicate, and the undated tail is not narrowed but skipped entirely.

That is clean in SQL and dangerous on screen, because it is a silent exclusion of a population that is normal in a received production — a scan with no metadata, a file whose only date is the day it was copied. A reviewer who narrows to a date range and reads "412 documents" has not been told that some number of undated documents were not considered.

**Recommendation: build it in step 2, and make the exclusion visible rather than implied.** The control states that documents with no date are not in a range, and the narrowed result says how many were set aside — a count the read already has, since the undated tail is its own segment. That count is the whole reason this is worth building carefully rather than quickly: in discovery, a filter that quietly drops documents is the shape of a defensibility failure.

### A constraint that is not a question, but must be built to

The access list means **absence, not refusal**: a member off a review set's list gets no rows, no counts and no error naming it. So the matter section's empty state cannot say "this matter has no review sets" — for a walled-off member that sentence is false, and a false statement about whether a corpus exists is exactly the disclosure the wall prevents in the other direction. The empty state says what a review set is and how one is made, and asserts nothing about what the matter holds.

## 12. Test plan

The registries are validated at module load and at lint, on the pattern the section registry already sets: a criteria provider that declares neither a `compose` nor a reason, a panel that declares no permission, a rendition claiming a format another rendition claims, and a deliverable with no formats are all failures before anything renders. Beyond that: the authorization tests are the ones that matter, and they are server-side and already written — the surface's own obligation is that no criteria set is ever composed as an authorization, which is a source-scan over the criteria module rather than a runtime test. The load-profile obligation is the list at the 250,000-document ceiling with every criteria provider set at once, against the measurements the review-document read already records.
