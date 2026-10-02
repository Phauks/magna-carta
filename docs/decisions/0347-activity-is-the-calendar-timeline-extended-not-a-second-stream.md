---
number: 347
slug: activity-is-the-calendar-timeline-extended-not-a-second-stream
status: Accepted — built
date: 2026-08-15
area: Notes and activity
summary: "A record's activity stream is the calendar's existing federated timeline read with one more declared source on it, not a new subsystem and not a projection table. packages/calendar already reads one page across fourteen sources under one comparable sort key, one shared cursor and one required visible-matter predicate, and its registry states that a source is a read-side declaration and never a write-side obligation on the subsystem that owns the rows — so a note joins it for one registry row, one statement builder, one projection and one label decision, with no change to any write path anywhere. The package's own invariant decides it: nothing is projected, copied or backfilled, which is what makes the class of bug where the timeline disagrees with the register unwritable, because the timeline IS the register. Three consequences are accepted rather than discovered: a note source declares no label and projects NULL, on the precedent that a filed email's subject line and a time entry's narrative are both refused; the source reads the note table directly and orders by when the thing it records HAPPENED, falling back to the day it was written, which is how every other record of an occurrence is ordered here; and a note on a Directory entity cannot join at all until a third visibilityAnchor with its own predicate is designed, because the firm anchor is a reviewed one-entry allowlist and reaching for it would be a silent loosening of the exemption the package guards most carefully."
---

**The activity stream already exists, it is called the timeline, and the only correct way to put notes
on it is to declare one more source.**

**Context:** two designs in one week reached for a note primitive and found none, and the obvious
shape for the feature that follows is "a note table plus an activity feed." The second half of that is
the trap. `packages/calendar` ships a federated read — `src/timeline.ts` over
`src/sources/registry.ts` — that answers one page across fourteen declared sources: matter events,
deadlines, filed email, assembled and filed documents, time and cost entries, conflicts checks, the
matter's own lifecycle over a frozen four-key audit allowlist, three custody sources, trust movements,
and firm events. Every source composes the same visible-matter predicate in SQL before the `LIMIT`,
every entry sorts on one comparable key, and the cursor is the platform's own rather than the
calendar's.

A second stream beside it would not be a duplicate feature; it would be a second answer to "what
happened on this matter," and the one people act on would be whichever surface they opened.

**Decision:** activity is that read. A note is a source on it. Adding one is the four-step recipe the
package already documents — a registry row, a statement builder through `boundedSelect`, a projection
with a deep link, and a label decision — and it is explicitly "never a change to the owning
subsystem's write path, and never a new table."

The invariant that settles it is the package's own: **nothing is projected, copied, or backfilled**. A
fact born in another subsystem is read in place. That is what makes it impossible to write the bug
where the timeline disagrees with the register, because the timeline is the register. A projection
table for activity would reintroduce exactly that class of bug and would additionally impose a
write-side obligation on every subsystem that wanted to appear on it — the obligation the registry
exists to refuse.

**Three consequences, accepted here rather than discovered at build time.**

**The note source declares no label.** A timeline entry carries identifiers, a kind, a sort key, an
actor, a deep link, and a declared non-privileged label — or it declares it has none. The precedents
are unambiguous: the filed-email source refuses a subject line because "a subject line is privileged
content, and putting one on a firm-wide read that spans every matter is precisely the disclosure the
confidentiality discipline forbids," and the time-entry source projects a duration because a
narrative is "the single most privileged free-text field in the billing corpus." A note body succeeds
that field. The source projects `NULL AS label` and the entry says a note was written, when, and by
whom.

**The source orders by when the thing happened.** A note carries the instant it was typed and,
optionally, the day and time of what it describes; the source sorts on the second falling back to the
first, so a note about Tuesday's call sits beside Tuesday's hearing rather than beside the Thursday
somebody wrote it down. That is how `matterEvent`, `matterDeadline` and `timeEntry` are all ordered,
and the one source that orders by when the ROW was written — the audit log — has that named as its
weakness rather than treated as the house style.

_(Amended 2026-09-01: this paragraph originally described reading live revision heads and excluding
retracted notes. The revision chain and the retraction state were removed by the owner's direction
the same day; a note is now one row, edited in place and deleted outright, so there is no head to
choose and no state to filter. The decision this fragment records — that activity is the calendar's
federated read with one more declared source, never a second stream — is unaffected.)_

Filtering on the status column beside
the date column is the failure the package names in its own custody constants; the filed-document
source's `deleted_at IS NULL` is the pattern.

**A Directory-entity note cannot join yet, and must not be forced in.** The registry declares two
anchors: `matter`, which composes the predicate, and `firm`, which is a reviewed allowlist of exactly
one source and composes none because a firm meeting has no matter to screen. An entity note is
neither — it can carry matter-derived confidentiality on a firm-wide record. The package's rule
governs: a new anchor comes with its own predicate, never a loosening of an existing one. Matter notes
ship first; entity notes wait for that anchor to be designed properly.

**Considered and rejected:** **an `activity` table every subsystem writes to** — the write-side
obligation, and a second source of truth that drifts the first time somebody forgets a write.
**A materialized view refreshed on a schedule** — same drift, plus staleness, plus a scheduled sweep
per firm. **Registering notes against the `firm` anchor** to get entity notes cheaply — it would read
as one more allowlist entry in review and would be a silent widening of the one exemption the package
guards; the source-fitness pass would fail it, correctly. **Building the note source but skipping the
label question** — a note source that projected the first sixty characters would be shipped by
somebody who had not read why the email source declares none.

**Consequences:** the read count per page rises by exactly one statement, and
`TimelineReadResult.statementCount` already reports the bound so a measurement asserts it rather than
inferring it. The existing table-driven source-fitness pass covers the new source with no new test
code — it proves the predicate is composed and the label declaration is honoured for every registered
source from one pass. And the platform gets an activity stream without acquiring a subsystem: the work
is a registry entry, and the design decision was made once, here.
