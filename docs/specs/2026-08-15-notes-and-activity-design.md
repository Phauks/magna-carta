# The note and activity primitive — design

**Status:** Proposed (design) · **Date:** 2026-08-15 · **Owner:** Trevor Goldsmith
**White paper:** _Tasks and workflows / matter plans_ (the follow-up spec it asks for is
[`2026-08-15-tasks-and-matter-plans-design.md`](2026-08-15-tasks-and-matter-plans-design.md); this
document is the primitive underneath it), with _Calendar and rules-based docketing_, _Client portal_,
_Discovery_, _Observability and diagnostics_ and _Tenancy and data isolation_ as the binding context.
**Raised by:** [`2026-08-15-client-intake-design.md`](2026-08-15-client-intake-design.md) flag **J6** —
"is the matter note / activity primitive built, and where?"
**Implementation plan:** [`2026-08-15-notes-and-tasks-implementation-plan.md`](2026-08-15-notes-and-tasks-implementation-plan.md)
**ADR fragments raised:** five, all `Proposed`, in `docs/decisions/pending/`.

**Not in scope:** any screen; the client portal itself (unbuilt, and this design deliberately decides
one thing ahead of it); ethical walls (an unbuilt seam this design composes against and does not
build); the erasure orchestrator (deferred; this design contributes two registry entries and nothing
else); tasks and matter plans, which are the companion spec.

---

## 1. The absence, confirmed rather than inherited

A note is the most ordinary thing a practice-management product has, so "the platform has none" is
surprising enough to verify rather than accept. It was verified four ways, and it holds.

**No table.** Every `CREATE TABLE` across `packages/database/drizzle/per-firm/` was enumerated — 175
tables. There is no `note`, no `comment`, no `annotation`, no `activity`, no `timeline`, and no
`memo`. What exists are **scalar `note` / `notes` columns** on individual records: `custody_movement`,
`custody_item`, `custody_stocktake_sighting`, `trust_movement`, `trust_reconciliation`,
`trust_unclaimed_funds_contact_attempt`, `invoice`, `matter_asset`, `firm_resource_booking` and a
handful of others. Each is one nullable free-text column on one row, attributable to nobody, editable
in place, with no history and no reader other than that row's own detail view. They are not a
primitive; they are the symptom of one being absent.

**No identifier type.** `packages/identifiers/src/types.ts` declares 166 identifier types, including
several for things nobody has built (`PortalGrantId` is reserved with no portal). There is no
`NoteId`, `CommentId`, or `ActivityId`. When this platform intends to build something, it reserves the
handle first; nothing reserved one here.

**No ledger node.** `roadmap.d/` was searched across all 27 area files. No node describes a note, a
comment, an activity stream, or a timeline entity. `intake.crm` names the absence
("the platform carries no note, comment or timeline entity on any record") and `tasks` names its own,
but no node claims the capability. **The register has no home for this and this design does not add
one** — a missing node is an owner decision about whether the register grows, not a gap to paper over
(section 12).

**The user interface already promises it.** `apps/web/src/lib/matters/sections.ts` reserves a
`notes` section at maturity stage `soon`, described as "Matter notes and memoranda — dated,
attributed, and searchable." The shell is built and the substrate is not. Separately and
significantly, `messaging` is a **different section** — "Secure messages exchanged with the client
through the portal, kept on the matter record" — which is section 5's conclusion arrived at
independently by whoever wrote that file.

The second reported gap holds too. `matter` carries `closed_at` (baseline migration
`20260704T041516_baseline.sql`, and the only later `ALTER TABLE matter` adds `system_key`) and no
reason column of any kind. Its status vocabulary is `prospective | open | closed`. A declined
engagement, a lost pitch, a matter closed because the client died, and a matter closed because the
work finished are the same row. Section 11 decides where that belongs.

---

## 2. What a note is for, stated before it is modelled

Three things a firm needs to record that nothing in this platform can hold today. They are worth
naming because they pull in different directions and the model has to serve all three.

1. **"I spoke to her on Tuesday, she is thinking about it."** A contemporaneous record of something
   that happened outside the system. Its value is that it was written then, by that person. It is
   evidence, and it will be read years later by someone reconstructing what the firm knew.
2. **"Do not call this client before 10am."** A standing fact about how to work a matter, which
   accretes and gets corrected. Its value is that it is current.
3. **"Counsel's theory is that the indemnity clause survives termination."** Attorney work product,
   the most protected class of text the firm produces, deliberately written down so colleagues can
   build on it.

The first wants immutability. The second wants editing. The third wants never leaving the building.
Section 6 resolves the first two against each other; sections 7 through 9 handle the third.

---

## 3. Activity is the calendar's federated read, extended — not a second timeline

**This is the first real decision and building a second timeline would be the clearest possible
failure**, so it is settled first and on evidence.

`packages/calendar` already ships the thing an activity stream is. `src/timeline.ts` reads one page
across a registry of **fourteen declared sources** under one comparable sort key, one shared cursor
(`@magna-carta/data-access/cursor-pagination` — "the calendar mints no wire contract of its own"), and
one required visible-matter predicate composed into SQL before the `LIMIT`. `src/sources/all.ts`
declares those sources: matter events, deadlines, filed email, assembled documents, filed documents,
time entries, cost entries, conflicts checks, the matter's own lifecycle over a frozen four-key audit
allowlist, three custody sources, trust movements, and firm events. `src/sources/registry.ts` states
the contract that makes it extensible: **"a source is a read-side declaration and NEVER a write-side
obligation on the subsystem that owns the rows."**

Its own package documentation states the invariant that decides this: **"Nothing is projected, copied,
or backfilled... That is what makes the class of bug where the timeline disagrees with the register
unwritable — the timeline IS the register."**

A note primitive that shipped its own `activity` table would violate that sentence twice: it would be
a second read surface over the same matter, and it would need every subsystem to write to it, which is
exactly the write-side obligation the registry refuses to impose. **So: activity is the existing
federated read, and a note joins it as one more declared source.** The cost is one registry row, one
statement builder, one projection, and one label decision — the four-step recipe in
`packages/calendar/CLAUDE.md` under "How to add a source." Nothing in `packages/calendar` changes
structurally, and nothing in any other subsystem changes at all.

Three consequences, none of them free, all of them stated rather than discovered at build time.

**The label decision is `declaresLabel: false`, and it is not close.** The registry's discipline is
that a timeline entry carries "identifiers, a kind, a sort key, an actor, a deep link, and the
source's DECLARED non-privileged label," and where no such label exists the source declares that it
has none. The precedent is unambiguous: `emailFiled` declares no label because a subject line is
privileged; `timeEntry` projects `duration_minutes || ' min'` and never the narrative, called out in
the source as "the single most privileged free-text field in the billing corpus." A note body is that
field's successor. Its first eight words are frequently the whole disclosure. **A note source projects
`NULL AS label`**, the entry reads as "a note was written, on this matter, then, by them," and the
text is one authenticated request away behind the deep link.

**A superseded revision must not appear twice.** Section 6 makes a note a chain of revisions. The
source reads the **live head only**, on the `documentFiled` precedent (`file.deleted_at IS NULL`), and
a retracted note (section 6) is excluded from the federated read entirely while remaining on the
note's own surface. Filtering on the status column beside the date column is exactly the failure mode
`sources/all.ts` calls out in the custody constants: "a source that filters on a date column and
forgets the status column beside it."

**A note on a Directory entity has no anchor the registry can express, and that is real work.** The
registry has exactly two `visibilityAnchor` values — `matter`, which composes the visible-matter
predicate, and `firm`, which is a reviewed allowlist of exactly one source (`FIRM_ANCHORED_SOURCE_KEYS
= ["firmEvent"]`) and composes no predicate because a firm meeting has no matter to screen. A note on
a Directory entity is neither. It is not firm-visible by construction — an entity note can say "the
opposing expert in the Herrera matter is a former partner here," which is matter-derived
confidentiality attached to a firm-wide record. The registry's own rule governs: "If screening firm
events is ever needed, that is a NEW declared anchor with its own predicate — never a loosening of
this one."

So this design **splits the delivery**: matter-anchored notes join the federated timeline in the first
slice; **entity notes are read on the entity's own surface only**, and join the federated read when
and if an `entity` anchor with its own visibility predicate is designed. Shipping entity notes into
the timeline through the `firm` anchor would be a silent loosening of the one exemption the package
guards, and the fitness pass in `packages/calendar/test/source-fitness.test.ts` would fail — correctly.

**Decision recorded as ADR fragment
`activity-is-the-calendar-timeline-extended-not-a-second-stream`.**

---

## 4. What a note attaches to

**Two attachment axes, not one polymorphic `subject_id`.**

`matter_note` hangs off `matter.id`. `directory_entity_note` hangs off a Directory entity handle. Two
tables, two foreign keys, two `NOT NULL` columns — rather than one `note` table with a `subject_kind`
discriminator and an untyped `subject_id`.

The argument is the audit log, and it is made in the codebase already. `audit_log.subject_id` is
untyped, and `sources/all.ts` documents what that costs: "its subject column is untyped and holds
whatever the writer thought the subject was, so most rows cannot be reached from a matter at all," and
the timeline's own read of it needs a `LIKE 'matter\_%'` prefix scan to confine itself to rows whose
subject really is a matter. That is the shape of a polymorphic key under load, in this repository,
today. A note is a first-class product record read on a hot surface; it gets a real foreign key, a
real index, and a real cascade story.

**Nothing else takes a note in the first slice.** Not a document, not a time entry, not an invoice, not
a custody packet — each of those already has its scalar `note` column, and replacing them is a
migration this design does not propose. A note on a document is the most likely third axis and it is
deliberately deferred: it is a different product (a document annotation, plausibly a PDF annotation
rather than a row) with a different privilege story, and inventing it here would be inventing the
part nobody asked for.

---

## 5. An internal note and a client-visible comment are two entities

`matter_note` is internal. A client-visible comment is `portal_comment`, and it does not exist yet
because the portal does not exist. **They are two entities. There is no visibility boolean, and there
is no path by which one becomes the other.**

The portal is unbuilt (`roadmap.d/portal.md`: every node `not-started`; `PortalGrantId` reserved and
nothing else), which makes this the cheap moment — nothing depends on the answer yet, and the answer
gets harder every month it is deferred.

**Why not one entity with a `visible_to_client` flag.** Five reasons, in descending order of how much
they would hurt.

1. **A one-character diff is a disclosure, and it is irreversible.** Flipping a boolean the wrong way
   publishes attorney work product to the party most interested in it. Flipping it back does not
   unsend it — the portal has already rendered it, and the client has already read it. There is no
   other place in this platform where a single column value is the entire barrier between privileged
   content and an external principal, and there should not be a first one.
2. **The authors are different kinds of thing.** A note's author is a `member.user_id`. A comment's
   author may be an **external principal**, which the white paper's _Client portal_ places in the
   **control-plane** database as "a distinct external principal type (never staff RBAC)," linked to a
   per-firm Directory entity. One table would need a polymorphic author column plus a check constraint
   enforcing "internal notes have member authors, client-visible ones may not" — a constraint doing,
   badly, the work two tables do for free.
3. **The grant model has nothing to say about a row.** A `PortalGrant`'s scope vocabulary is
   `matter | folder | file`. A comment is reachable through a grant because it hangs off a thread that
   hangs off a scope. A note is reachable through nothing, because there is no grant scope that names
   it. That structural unreachability is the actual protection, and merging the tables would replace
   it with a `WHERE` clause.
4. **They have different discoverability and different retention.** A comment is a communication with
   the client — the same class of record as filed email, and a firm may need to produce it. A note is
   internal work product. Section 8 turns that into two different postures, which one table would have
   to carry as a second discriminated behaviour on the same flag.
5. **The product already separated them.** `apps/web/src/lib/matters/sections.ts` has `notes` and
   `messaging` as two sections with two descriptions, and `roadmap.d/portal.md` places
   `portal.capabilities.comment` as "Comment/message capability threaded on the matter record."
   Nobody proposed one table; the merge would be a regression against a decision already visible in
   the tree.

**No promotion path, and this is the load-bearing half.** "Share this note with the client" is not a
state change. It is **a new comment, authored by the member, at the instant they authored it**, in the
`portal_comment` table, with its own identity. The note is untouched, because the note is a record of
what the firm thought on the day it thought it, and a publication decision made in June must not alter
a record made in January. If the member wants the note's words in the comment, they type or paste
them — a deliberate act by a person, not a data migration performed by a checkbox.

**Owner flag W3** covers the one product affordance this leaves open: whether the note surface offers
a "copy to a client message" control that pre-fills a comment composer with the note's text. That is a
convenience over the deliberate act, not a promotion path, and it is defensible — but it is one
usability step from feeling like promotion, so it is the owner's call and not the design's.

**Decision recorded as ADR fragment
`an-internal-note-and-a-client-visible-comment-are-two-entities`.**

---

## 6. Correction, retraction, and whether a note can be deleted

The platform's append-only subsystems all refuse edits and take a new row: the ledger and audit log
(`docs/conventions/invariants.md`: "Never mutate or delete a ledger or audit row; corrections are new,
balancing entries"), trust holds and transfers (append-only by database trigger; "a release is a new
linked row, never an edit or a status column"), the custody register (a `correction` movement kind
rather than an edit), and the conflicts log (six `RAISE(ABORT)` triggers across `conflicts_check`,
`conflicts_hit`, `conflicts_disposition`).

`packages/calendar` is the one deliberate departure, and its reasoning is the honest counterweight:
"a calendar is a plan and a record of a plan, hearings move, and **a firm made to record a
compensating row to fix a typo stops recording**." It draws the line at the CORRECTION/CONTINUANCE
distinction — a correction is an edit because the row misdescribed reality; a continuance is a new row
because both settings really happened.

**A note is neither case, and it needs a third answer.**

Why it is not the ledger. What makes a trust movement append-only is that **a third party relies on
it**: a bar auditor, a court, the client's accountant. Its whole value is that the firm demonstrably
could not have changed it. A note has a weaker version of that — it is discoverable, and it can be
evidence — but nobody audits a firm's notes for arithmetic, and no rule of professional conduct
requires a note to exist at all.

Why it is not the calendar. A calendar entry is a **plan**; its current value dominates its historical
value, and a hearing date that was wrong yesterday is simply wrong. A note is a **contemporaneous
record**; its evidentiary weight comes from having been written at that moment, by that person, saying
that. Editing it in place destroys exactly the property that makes it worth having.

And there is a pressure neither of those subsystems has. A note is the record a lawyer writes fastest
and least carefully. It will contain typos, the wrong client's name, and — occasionally, and this is
the case that decides the design — content that should never have been typed at all: another person's
protected health information, or a privileged communication belonging to a **different** client.

**The decision: revisions, retraction, and no delete.**

- **A note is a chain.** `matter_note` holds the identity — the matter, the original author, the
  created instant, the current state. `matter_note_revision` holds a body, its own author, and its own
  instant. An edit **appends a revision**; the head is what renders; every prior revision is retained
  and reachable from the note's own surface. This is the trust ledger's discipline applied to text: the
  correction is a new row, and the old one stays.
- **Retraction is a state, not a delete.** A retracted note stops rendering its body everywhere — the
  matter surface shows a tombstone, and the federated timeline excludes it entirely (section 3). The
  row, its revisions, its author and its instants all remain. Retraction carries its own actor,
  instant, and a required reason. This is the answer to "this should never have been written," and it
  is deliberately visible: the firm can see that a note was retracted and by whom, which is what makes
  it usable as a correction mechanism rather than a quiet erasure.
- **There is no hard delete in the product.** No route, no capability, no bulk action. The single case
  where bytes genuinely must leave the database is a legal one — an erasure obligation, or content
  that is another person's protected data — and that routes through the deferred erasure orchestrator,
  where `packages/data-access/src/pii-registry.ts` already has the right action for it:
  **`report-manual`**, defined as "free-text / document content — surfaced in the residue report, not
  auto-erased." A note is precisely what that action was written for. So the platform neither silently
  erases a note nor silently refuses to: it reports it, and a person decides.

**Registry entries this design contributes** (two, both `report-manual`, both on the `entity` subject
axis because a note body may name anybody): `matter_note_revision` and `directory_entity_note_revision`
on `body`. The `matter_note.author_user_id` column takes a **`pseudonymize-keep`** entry on the `user`
axis, for the reason section 9 gives.

**Owner flag W4** decides one thing this design recommends but will not impose: whether the
append-only discipline on `matter_note_revision` is **enforced by database trigger** (the conflicts-log
pattern — three `RAISE(ABORT)` triggers refusing `UPDATE`, `DELETE` and `INSERT OR REPLACE`) or by
application code alone. Trigger enforcement means a future statement builder, or a future maintenance
script, cannot quietly rewrite a note's history even if someone tries. It also means that honouring a
genuine court-ordered deletion requires a migration rather than a query. The recommendation is
**triggers on the revision table** (the body, which is the evidence) and **no trigger on the note head**
(whose state column must move for retraction) — but the cost lands on the owner, so the owner decides.

**Decision recorded as ADR fragment
`a-note-is-corrected-by-revision-and-retracted-never-deleted`.**

---

## 7. A note is privileged content — the metadata scrub and document automation

The instinct is to ask what the metadata scrub does about a note. The answer is nothing, and the
useful finding is the inverse.

`crates/pdf-core/src/scrub.rs` (design:
[`2026-06-22-pdf-document-scrub-design.md`](2026-06-22-pdf-document-scrub-design.md)) removes
**document-level surfaces from a PDF**: the Info dictionary and XMP metadata, `/Names/EmbeddedFiles`
and `/FileAttachment` annotations, XFA datasets, AcroForm field values, the Tagged-PDF structure tree,
bookmark titles, and optional-content groups — with a verification gate that decompresses and scans so
a redacted string cannot survive anywhere in the output. It operates on bytes. It reaches nothing in
the per-firm database, and a note stored as a row is not a surface it can see or needs to.

**The real exposure runs the other way, and it is a build obligation this design states now because
retrofitting it is expensive.** Document automation assembles documents from matter data through the
merge-field catalog (`packages/merge-field-catalog-contract`, and
[`2026-08-05-merge-field-catalog-system-design.md`](2026-08-05-merge-field-catalog-system-design.md)).
A merge field that resolved to a note body would put an internal, privileged, work-product note into
the body of a letter assembled under the firm's letterhead and sent to an opposing party — and the
scrub would not catch it, because merge-filled text is **page content**, not document metadata. The
one machine in the platform built to stop privileged text escaping in a PDF is structurally blind to
this route.

**So the rule: no merge field ever resolves to a note or a comment, on any record.** Not the body, not
the latest revision, not a count, not a concatenation. It is stated here as a rule rather than left to
judgement because the merge-field catalog is a data table that grows by entries, and the entry that
does this will look reasonable to whoever adds it. The implementation plan carries it as a fitness
function over the catalog, in the same spirit as the calendar's source-fitness pass — a scan that
fails when a catalog entry's resolver reaches a note table.

---

## 8. A note is privileged content — discovery collection

`review_document.source_kind` is a three-value CHECK constraint: `file_version`, `email_message`,
`email_attachment` (migration `20260806T080000_discovery-5-1-2.sql`; the review model in
[`2026-08-05-discovery-5-1-design.md`](2026-08-05-discovery-5-1-design.md)). A note is structurally
uncollectable into a review set. Nothing in `packages/discovery` can reach one.

**That default is correct, and it should be defended rather than merely inherited.** A firm's internal
notes are its own work product. They are not the client's documents, they are not what a request for
production asks for, and a collection vocabulary that could sweep them into a review set would put
every candid internal assessment one bulk-load away from a production set. The review workflow's own
QC gate would then be the only thing standing between a note and a produced document, and a QC gate is
a process control, not a structural one.

**The rule this design states: notes stay outside the collection vocabulary.** If a note is ever
genuinely ordered produced, the route is to **export it as a document into the matter's file record and
collect that document** — which gives it a `file_version`, a hash, a custodian of record, and every
other property the review pipeline is built on, and which is a deliberate, attributable, single act
rather than a widened enum. Widening `source_kind` to reach notes is the change that must not be made
quietly, so it is written down here as the thing to refuse.

**Owner flag W5** puts this in front of the owner rather than treating it as settled, because it is a
professional-judgement question wearing a schema costume: a firm under a preservation obligation may
need its notes inside the same hold-and-collect machinery as everything else, and a firm that has to
export them one at a time may simply not preserve them. The design's recommendation is the export
route; the decision is not the design's to make.

---

## 9. A note has an author, and an author leaves

`member` is four columns and a status: `user_id`, `display_name`, `status` (default `active`),
`opted_out_of_usage_analytics`, `created_at`. Membership ends by a status flip;
`roadmap.d/auth.md` records the offboarding function as built and "the offboarding flow that invokes
it is its own future design."

Every append-only record in this platform names its actor as a plain foreign key to `member.user_id`
and none of them nulls it: `custody_movement.recorded_by_user_id`, `trust_movement.recorded_by`,
`matter_event.recorded_by`, `matter_deadline.recorded_by`, `conflicts_check.actor_user_id`,
`email_matter_link.linked_by`, `credit_note` and every other financial correction. `matter_assignment`
goes further and keeps ended assignments deliberately — `packages/matters/CLAUDE.md`: "Ending an
assignment stamps `valid_to` and keeps the row — who carried a file is the matter's record."

**So a note's `author_user_id` is a plain foreign key, and it never nulls, never repoints, and is not
anonymized when a member leaves.** Three reasons, and the first is decisive: an unattributed
contemporaneous record is worth a fraction of an attributed one, and the whole point of section 2's
first case is that a specific person wrote a specific thing on a specific day. Second, the foreign key
is what the timeline's `actorExpression` reads; nulling it makes the note the one entry on a matter's
history with no actor. Third, every sibling subsystem already made this choice, and making the
opposite one here would mean notes are the single record type whose provenance dissolves on a
resignation.

**What does change is presentation, and it is a read, not a column.** A note authored by a former
member must not render as a bare name that reads as current staff — a colleague reading "per Sarah
Chen" needs to know Sarah left in 2024, or they will go and ask her. That is a join on `member.status`
at read time, exactly as `packages/calendar` computes overdue at read time rather than storing it. No
`author_was_active` column, no backfill, no sweep: the fact is a join, and a fact that is a join
cannot drift from the row it joins.

**Two harder cases, both real.**

**The author is the data subject of an erasure request.** `pii-registry.ts` carries a `user` subject
axis alongside the `entity` axis. Erasing a member anonymizes the member row into a tombstone; the
note's `author_user_id` then points at a tombstone, which is the correct outcome and has a name in the
registry's vocabulary — **`pseudonymize-keep`**: "append-only rows: replace the subject reference,
never delete." This design registers `matter_note.author_user_id` and
`matter_note_revision.author_user_id` accordingly. The note body is a separate problem with a separate
entry (`report-manual`, section 6), because the body may name the departed member and no automated
pass can safely rewrite prose.

**A note that is itself about a member.** "Associate mishandled the filing deadline on this one" is a
note about a colleague, held in a matter record, discoverable in litigation and readable by whoever
can see the matter. Nothing in this design prevents it and nothing should — a firm has to be able to
record what happened. But it is worth the owner knowing that the note primitive creates a durable,
attributable, discoverable place for personnel criticism that the platform has not previously had, and
that this is a category of content the erasure registry's `report-manual` residue report will
eventually surface to somebody. Recorded as **owner flag W9** (analysis, not a build gate).

**Decision recorded as ADR fragment `a-note-outlives-its-author-and-keeps-their-name`.**

---

## 10. Search, and the one thing it costs

`apps/web/src/lib/matters/sections.ts` promises notes are "searchable." `packages/search` and
`crates/search-core` build Tantivy splits and answer BM25 queries. Indexing note bodies is
straightforward and a firm will absolutely want it — the second-most-common thing anyone does with a
note is fail to find it again.

The cost is the snippet. A search result that shows matched text around the hit is the whole reason
keyword search feels useful, and it is exactly the disclosure section 3 refused for the timeline label.
A note snippet on a firm-wide search results page puts privileged fragments from every matter in front
of whoever typed a common word, filtered only by whatever visibility predicate the search read
composes.

**The design's position:** note bodies are indexed; the visibility predicate that governs the timeline
governs the search read identically; and results carry **no snippet** — matter, date, author, and a
deep link. **Owner flag W6** puts the snippet question to the owner, because refusing it has a real
usability cost and a firm-configurable answer (snippets on, within a single matter's search; off on
the firm-wide read) is defensible and is not the design's to choose.

---

## 11. The matter close-reason gap — its own thing, and why

`matter` has `closed_at` and no reason. This design's answer: **it is its own thing, it belongs to the
matter shell, and it must not be solved by writing a note.**

The temptation is obvious — a note primitive lands, and "why did this close" is text, so write a note.
That is wrong for a reason worth stating: a close reason is a **closed vocabulary that other
subsystems read**, and a note is free text that nothing reads programmatically. Reporting wants to
count declined engagements against won ones. Conflicts wants to distinguish "we declined this" from
"we finished this," because Model Rule 1.18 attaches to the first and not the second (the intake design
raises exactly this as its flag **J12**). Retention wants to know whether the file is a completed
engagement or a prospect who never became a client. None of those can read prose, and a platform that
answers "why did it close" with a free-text note has answered it for humans and for nobody else.

So the shape is small and it belongs to `packages/matters`: a `close_reason` column over a firm-visible
closed vocabulary, plus an optional free-text `close_note`, set through the existing `closeMatter` path
and carried on the `matter.closed` outbox topic that already fires. It is one column, one enum, one
parameter, and one migration in the package whose lifecycle it describes. Putting it in a notes-and-
tasks spec would file a matter-shell fact in the wrong home, which is the one thing `CLAUDE.md`'s
orientation table exists to prevent.

**Owner flag W10** names it as a gap with a recommendation and no build here: it is a candidate for the
next slice that opens `packages/matters`, and the vocabulary itself is an owner decision (the intake
design's decline outcomes, completed engagements, client-terminated, firm-withdrew, and merged or
duplicate are the obvious seeds, and which of those a firm may add to is a separate question).

---

## 12. What this design does not build

- **Any screen.** The `notes` section stub in `apps/web/src/lib/matters/sections.ts` stays at maturity
  stage `soon` until a surface slice.
- **The client portal, or `portal_comment`.** Section 5 decides the shape ahead of the portal so the
  portal inherits a decision rather than making one under delivery pressure. The table is not
  specified here.
- **Ethical walls.** An unbuilt seam. Notes compose the same visible-matter predicate every timeline
  source composes, so a wall lands on notes the day it lands anywhere.
- **A note on a document.** Deferred deliberately (section 4).
- **The erasure orchestrator.** Deferred elsewhere; this design contributes registry entries.
- **A ledger node for the note primitive.** Section 1. The register has no home for this and the owner
  decides whether it grows one.

---

## 13. Owner flags

The **W** series is fresh — `A` through `T` are variously taken across `docs/specs/`, and `I`, `O` and
`U` are avoided as confusable or reserved-looking. Flags are numbered in one series across this spec
and its companion; **W1 through W6 and W9 through W10 are raised here**, and W7, W8, W11 through W15
are raised in [`2026-08-15-tasks-and-matter-plans-design.md`](2026-08-15-tasks-and-matter-plans-design.md).

### These decide what gets built

**W1 — Is the note primitive built at all, and as a platform slice?** The question the intake design
raised as **J6**. If yes, it belongs to every matter and every Directory entity, not to intake, and
intake's activity feed becomes a consumer rather than an owner. If no, intake ships a derived-only
prospect timeline that cannot hold "she is thinking about it," `apps/web/src/lib/matters/sections.ts`
keeps promising a Notes section indefinitely, and every subsystem that needs somewhere to write a
sentence keeps growing its own scalar `note` column. Recommendation: yes, as a platform slice, and
before tasks.

**W2 — Do matter notes and Directory-entity notes ship together, or matter notes first?** Section 3.
Entity notes cannot join the federated timeline without a third `visibilityAnchor` and its own
predicate, which is genuine design work in a package whose visibility contract is its most carefully
guarded property. Shipping matter notes first gets the primitive in front of users at a fraction of
the cost. Recommendation: matter notes first; entity notes in a second slice with the anchor designed
properly.

**W3 — Does the note surface offer "copy to a client message"?** Section 5. Not a promotion path — it
pre-fills a composer and a person still authors and sends — but one usability step from feeling like
one. The design has no view; the risk is entirely about what people will believe the control does.

**W4 — Is the append-only discipline on note revisions enforced by database trigger?** Section 6. The
conflicts log's six `RAISE(ABORT)` triggers are the precedent and they have proven their worth.
Triggers make a note's history unrewritable by any future code path; they also make a genuine
court-ordered deletion a migration. Recommendation: triggers on the revision table, none on the head.

**W5 — Do notes stay outside the discovery collection vocabulary?** Section 8. The design recommends
yes, with export-as-document as the route when production is genuinely ordered. A firm under a broad
preservation obligation may need the opposite. This decides whether `review_document.source_kind` ever
grows a fourth value, and that enum is very hard to shrink again.

**W6 — Do note search results carry a snippet?** Section 10. Snippets are most of what makes search
feel like search, and a snippet on a firm-wide result page is a privileged fragment rendered outside
its matter. A per-scope answer (on within one matter, off firm-wide) is available and is a product
decision.

### These decide how it is built, not whether

None here. The two "how" flags in this series, **W14** (task priority vocabulary) and **W15** (the
scope of the default task read), belong to the companion spec.

**W5 and W6 above are also confidentiality questions**, and are listed with the build-gating flags
because each additionally decides a build: W5 decides whether an enum that is very hard to shrink ever
grows, and W6 decides what the search read is written to emit.

### These are professional-conduct and confidentiality questions the design analyses and answers neither

**W9 — A note is a durable, discoverable place to criticise a colleague.** Section 9. The platform has
not had one before. Nothing in this design prevents it, nothing should, and the firm should know the
category exists before the first one is written rather than after it is produced in discovery.

**W10 — The matter close-reason vocabulary.** Section 11. The gap is confirmed, the shape is small,
and the design's position is that it belongs to `packages/matters` and not here. What the vocabulary
contains — and whether a firm may extend it — is an owner decision with professional-conduct
consequences, because "declined" and "completed" attach different obligations under Model Rule 1.18.

---

## 14. Test plan

The design is documents only; this is what the build must prove.

- **The federated read stays bounded.** `TimelineReadResult.statementCount` and `rowsRead` already
  report the bound. Adding a note source raises the statement count by exactly one per page and must
  not change the shape; the existing measurement asserts it rather than inferring it.
- **The note source composes the visible-matter predicate.**
  `packages/calendar/test/source-fitness.test.ts` proves this for every registered source from one
  table-driven pass, and the note source joins that pass with no new test code.
- **The note source declares no label.** The same fitness pass asserts the `declaresLabel: false` /
  `NULL AS label` pairing.
- **A superseded revision and a retracted note never reach the timeline.** Two cases, on the
  `documentFiled` soft-delete precedent.
- **No merge-field catalog entry resolves to a note table.** A source-scan fitness function
  (section 7), which is the only mechanical guard against the highest-consequence leak in this design.
- **Round-tripping a revision chain preserves every prior body**, and (under W4) an `UPDATE` or
  `DELETE` against a revision aborts.
- **A note authored by a member whose status is not `active` still renders with attribution**, and
  renders the former-member signal.
