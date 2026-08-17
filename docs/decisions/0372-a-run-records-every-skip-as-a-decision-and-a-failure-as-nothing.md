---
number: 372
slug: a-run-records-every-skip-as-a-decision-and-a-failure-as-nothing
status: Proposed
date: 2026-08-16
area: Financial Core — Billing
summary: "A scheduled or batch billing run writes one row per target, including every target nothing happened to, with a closed outcome label plus identifiers and never a sentence — so a run that touched four hundred matters and skipped twelve can say which twelve and why, months later, to somebody who was not there. The recorded skip is also the convergence: UNIQUE (schedule, period) and UNIQUE (run, matter) mean a period is decided exactly once, so a skip that wrote nothing would draft on the next pass and produce a second bill for one period. The counterpart rule is what keeps that safe: a run row records a DECISION ABOUT THE WORLD and never a failure to read it. A firm database that threw writes nothing, is quarantined by the existing per-firm catch, and is retried tomorrow — without that branch one bad afternoon becomes a permanent skip and a firm never gets that month's bills. The item row commits in the same batch as the work it describes, which is what makes a half-completed run resumable with no stored cursor: the resume predicate is the items with no outcome."
---

**A run that produced nothing for a matter has to be able to say so, and the difference between "we
decided not to" and "we could not look" is the difference between a record and a lie.**

**Context.** Billing automations act on hundreds of matters at a time with nobody watching. The
question that gets asked afterwards is never "did the run happen" — it is "why did the Hendricks matter
not bill in August", asked in October by somebody who was not there and cannot re-run the world as it
stood. A run that records only what it produced cannot answer it, and the absence of a row is
indistinguishable from a run that never reached that matter at all.

There is a second, sharper reason, and it is about correctness rather than reporting. The convergence
for a recurring bill is `UNIQUE (schedule_id, period_key)`: a period is decided once, and a redelivered
cron fire loses at the index rather than drafting again. That only works if the **skip** takes the row
too. A period skipped because the matter's fee agreement had just been superseded, with nothing written,
drafts on tomorrow's pass the moment somebody re-authorizes — and the firm has two bills for August.

**Decision, in four parts.**

**1. Every target gets a row, including the ones nothing happened to.** Four hundred targets, four
hundred `billing_batch_run_item` rows. A `recurring_bill_run` row exists for every `(schedule, period)`
the pass reached a view about, whether or not it produced an invoice.

**2. An outcome is a closed label plus identifiers, never a sentence.** `drafted`, `nothing-to-bill`,
`below-minimum`, `matter-closed`, `arrangement-superseded`, `authorizer-inactive`,
`work-in-progress-claimed-elsewhere`, `claim-ceiling-exceeded`, `suppressed-by-firm`, `already-drafted`,
`no-arrangement` — held by a CHECK, extended by a deliberate edit. Where a refusal has a subject, the
subject is its identifier: the entry that was claimed elsewhere, the arrangement version that
superseded the pinned one. This is the reasoning the notification suppression tally already carries.
Prose drifts, is written for the person writing it, and cannot be counted; a label can be filtered,
tallied, and read by somebody who has never seen the code.

**3. A run row records a decision about the world. A failure to read the world writes nothing.** When
the firm's database throws, the firm is quarantined and logged through the one telemetry pipeline
exactly as the outbox sweep quarantines a sick firm, and tomorrow's pass tries again. This branch is
explicit in the code rather than emergent, because without it the two rules above turn a transient
outage into a permanent skip: the period would carry a row saying it was decided, the UNIQUE index would
hold, and a firm would simply never get that month's bills — silently, with a record that looks correct.

**4. The item row commits in the same batch as the work it describes.** Never a run-wide batch: a run
over four hundred matters each claiming up to four hundred work-in-progress entries is unbounded against
`MAX_BATCH_STATEMENTS`, and chunking at the matter is also what gives resumption. Because outcome starts
null and is set in the same commit as the draft, **the resume predicate is the items with no outcome** —
so a run interrupted halfway continues rather than restarting, and no cursor is stored anywhere. The
ceiling and the resumption story are one decision.

**Considered and rejected.** **Recording only what was produced**, with skips inferred from the
difference between the selection and the rows — the difference cannot distinguish a decided skip from a
target the run never reached, which is the whole question. **A free-text reason** — it is what everybody
writes first and what nobody can query second. **One batch per run** — it trades the resumption story
for a ceiling nobody can discover, and a partial commit is not available to trade back. **A stored
cursor** — a second piece of state that can disagree with the items, when the items already say exactly
where the run got to.

**Consequences.** One run-record shape serves both triggers: a member-started batch and the scheduled
recurring pass differ by a `trigger` column and a nullable `started_by`, so one read and one deferred
surface answer "what did the platform do here" for both. A firm can pre-declare a month skipped by
writing the `suppressed-by-firm` run row ahead of the pass, so the suppression mechanism and the record
are the same table and no second mechanism exists. Run records are not swept in this slice: they are the
record of what the platform did on a firm's behalf, and a window can be added later on evidence where
deletion cannot be undone. Builds on **ADR-0063** (idempotency) and **ADR-0064** (the transactional
outbox).
