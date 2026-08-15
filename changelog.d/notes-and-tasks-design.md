---
category: Added
audience: internal
---

**The note primitive and the tasks subsystem are designed, in that order, and the first finding is that
the activity stream everyone was about to build has been shipped since the case-calendar slice.**

**Both reported gaps are real, and were verified rather than inherited.** All 176 per-firm tables were
enumerated: there is no `note`, `comment`, `annotation`, `activity` or `timeline` table. What exists
are scalar `note` / `notes` columns on a dozen individual records — custody movements, trust movements
and reconciliations, invoices, matter assets, resource bookings — each one nullable free text on one
row, attributable to nobody, editable in place, with no history and no reader beyond that row's own
detail view. They are not a primitive; they are the symptom of one being absent. Corroborated three
more ways: no `NoteId` among the 166 identifier types (this platform reserves handles before it builds
things — `PortalGrantId` is reserved with no portal); no node describing a note anywhere in
`roadmap.d/`; and `apps/web/src/lib/matters/sections.ts` already promising a Notes section at maturity
stage `soon`, "dated, attributed, and searchable," over nothing. The `matter` table carries `closed_at`
and no reason column of any kind, and the only later `ALTER TABLE matter` in the tree adds
`system_key`.

**Activity is the calendar's federated read with one more source on it, and building a second timeline
was the failure to avoid.** `packages/calendar` already reads one page across fourteen declared sources
under one comparable sort key, the platform's own cursor, and one required visible-matter predicate
composed in SQL before the `LIMIT`. Its registry states that a source is "a read-side declaration and
NEVER a write-side obligation," and its package invariant states why that matters: nothing is
projected, copied or backfilled, which is what makes the bug where the timeline disagrees with the
register unwritable, because the timeline IS the register. A note joins for one registry row, one
statement builder, one projection and one label decision — and the label decision is `declaresLabel:
false`, on the precedent that the filed-email source refuses a subject line and the time-entry source
projects a duration rather than a narrative. One thing does not come free and is stated rather than
discovered: a note on a **Directory entity** has neither anchor the registry expresses, and reaching
for the `firm` anchor — a reviewed one-entry allowlist — would be a silent loosening of the exemption
that package guards most carefully. So matter notes join the timeline first and entity notes wait for a
third anchor with its own predicate.

**An internal note and a client-visible comment are two entities, decided while the portal is still
unbuilt.** No visibility boolean, and no path by which one becomes the other. A boolean makes
publishing work product to the opposing party a one-character diff and an irreversible one — flipping
it back does not unsend what the portal rendered. Beyond that: a note's author is a member and a
comment's may be an external principal the portal places in the control-plane database as a distinct
principal type; a grant's scope vocabulary is matter, folder and file, so a comment is reachable
through a grant and a note is reachable through **nothing**, which is a structural protection a `WHERE`
clause would replace; and the tree already separates them, with `notes` and `messaging` as two matter
sections. Sharing a note is therefore a new comment authored by the member at the instant they authored
it, because a publication decision made in June must not alter a record made in January.

**A note is corrected by revision and retracted, never deleted — and it is neither the ledger nor the
calendar.** The ledger is append-only because a third party relies on it and the firm demonstrably
could not have changed it; nobody audits a firm's notes. The calendar edits in place because it records
a plan, and "a firm made to record a compensating row to fix a typo stops recording"; but a note is a
contemporaneous record whose weight is that it was written then, by that person. So: an identity row
plus revision rows, an edit appends and moves the head, every prior body retained. Retraction is a
state with its own actor, instant and reason — the body stops rendering and drops off the timeline
while the rows remain — and it exists so the case that would otherwise force a delete has an answer.
There is no hard-delete route; the one case where bytes must genuinely leave routes through the PII
registry's `report-manual` action, which is defined for exactly this and neither auto-erases free text
nor silently refuses. Authorship survives a departure: the author reference never nulls and never
repoints, because every sibling subsystem already made that choice and an unattributed contemporaneous
record is worth a fraction of an attributed one; the former-member signal is a read-time join on
`member.status`, never a column.

**Two containment rules, because both failures would look reasonable to whoever wrote them.** The
PDF scrub removes document-level surfaces and is structurally blind to merge-filled text, which is page
content — so a merge field resolving to a note body would put internal work product into a letter under
the firm's letterhead and the one machine built to stop privileged text escaping in a PDF would not see
it. **No merge field ever resolves to a note or a comment**, guarded by a source scan landing in the
same slice as the table. And `review_document.source_kind` is a three-value CHECK over file versions,
email messages and attachments, so a note is uncollectable into a review set today; that default is
**defended** rather than inherited, with export-as-document as the route if production is ever ordered,
because widening the enum puts every candid internal assessment one bulk load away from a production
set.

**Then tasks, and the date finding is bigger than the modelling.** The brief assumed the calendar ships
rules-based docketing and a task due "14 days after service" reaches the same computation a deadline
does. **It does not exist.** The calendar states as a capital-letter invariant that nothing computes a
deadline date, its time-zone module says it never derives a date from another date, a test scans the
sources for date-arithmetic identifiers, and `roadmap.d/calendar.md` records the absence as "a
deliberate position, not a gap." So a task reaches what does exist and adds nothing: the deadline's
three columns (civil date, optional wall-clock time, required zone — never midnight-local-as-UTC), the
calendar's own civil-date resolver with a dateless task due at the **end** of its civil day, and
read-time overdue with no column and no sweep, which is a stronger argument for tasks than for
deadlines because tasks are numerous. A matter plan's "14 days after" is the same forbidden arithmetic
wearing a template, so a template carries an **anchor and an offset**, instantiation renders a
**proposed** date, and a member's acceptance is the write — the propose-and-confirm interaction the
calendar already reserved for the statutory catalog it has not built, reused rather than reinvented,
with the anchor vocabulary held to one real value behind a CHECK constraint so growing it costs a
reviewed migration.

**The platform ships no matter plans**, for the calendar's reason about computed dates: a plan asserts
how a firm practises in a jurisdiction, and a shipped plan with a missing step is a malpractice vector
carrying the platform's name, trusted precisely because it shipped. Instantiation is a one-time copy
with provenance columns and no live link; nothing reconciles, because a drift report is the live link
with an approval step. Sequencing is one `blocked_by` predecessor that renders and sorts and gates
nothing. Open tasks register a close **advisory** and never a precondition — the advisory file's own
reasoning is this exact case — and nothing happens to the tasks at close, because closed is
archived-but-additive; they drop out of the default read through a filter, so reopening restores them
with no backfill. Task assignment **subscribes** to the notifications registry on its existing
outbox-row-is-the-emission discipline; the comparison-shaped due-soon and overdue points are declared
and wired to nothing, beside the calendar's identical declarations, so one sweep eventually serves both.

**A stale comment worth reporting, and it is not this design's to fix.**
`packages/notifications/src/recipients.ts` resolves the `matter-team` audience with "DECLARED AND
UNRESOLVABLE TODAY: there is no per-matter team table." `matter_assignment` **is** one — matter,
member, role, and a validity interval — and it shipped two merges later (`45003814` is the
notifications slice, `8d98eca0` the assignment table). Three registered notification types today
declare `audience: "matter-team"` and quietly deliver only to the responsible member, reporting
`substituted: true` to nobody. The substitution field was built so this would be a one-resolver change
when the table landed, and it landed. Task notifications use `designated` and do not depend on it.

**Ledger corrected, and one node deliberately not added.** All four `roadmap.d/tasks.md` nodes asserted
no spec exists; their evidence now names the spec and records it as Proposed pending owner flags, with
no status moved and no `spec:` key set — the precedent `roadmap.d/intake.md` set the same day.
`tasks.workflow-model` was `researching`, which the vocabulary defines as "a named open research
workstream," and the white paper's research list names exactly two, neither of them this; corrected to
`not-started`. **No node is added for the note primitive**: there is none anywhere in `roadmap.d/`,
which is a real finding and an owner decision about whether the register grows, not a gap for a branch
to fill. The matter close-reason gap is confirmed and placed: it belongs to `packages/matters`, not
here, because a close reason is a closed vocabulary reporting, conflicts and retention all need to read
programmatically, and answering "why did it close" with a free-text note answers it for humans and for
nobody else.

No feature code, no schema, no migration, no route. Fifteen owner flags in a new **W** series: eleven
decide what gets built, two decide how, and two are professional-conduct questions the design analyses
and answers neither. Two of the eleven — whether notes may ever enter the discovery collection
vocabulary, and whether a search result may carry a snippet of privileged text — are confidentiality
questions that additionally decide a build, so they sit with the build-gating set rather than beside
the two the design refuses to answer: what it means that the platform is about to acquire its first
durable, attributable, discoverable place to criticise a colleague, and what the matter close-reason
vocabulary contains, given that "declined" and "completed" attach different obligations under Model
Rule 1.18.
