---
category: Added
audience: internal
---

**Client intake is designed, and the finding that matters most is that the subsystem it was said to be
blocked on has been waiting for it.** The feature ledger claimed `intake.conflict-check` was stuck
because "no conflicts check exists to trigger." `packages/conflicts` has been on `main` since slice 1
— the orchestrator, the reporting posture, the append-only log, the disposition stream, the
event-driven re-check ledger, its two queue consumers and the cron backstop — and better than that,
`CONFLICTS_TRIGGERS` opens with `"preliminary"` and `"comprehensive"`, two names no caller in the tree
produces. They were minted for intake and left waiting. `roadmap.d/conflicts.md` carried the same
staleness from the other side and is corrected too: its parent still said the feature "has no code or
spec" over a shipped package with two specs, and `conflicts.triggers` still said no check invocation
existed anywhere after slice 2 shipped four event producers, two consumers and a scheduled backstop.

**A prospect turns out not to be a record.** It is a reading of two the platform already has: a
Directory entity, and a matter that has not drawn a number. The Directory placement is forced rather
than chosen — the engine's four blocking channels are Directory tables, so anything stored anywhere
narrower is invisible to the check that a prospect exists to be subject to. The structural carrier of
the distinction is the **absent matter number**, not the status column, and that is stronger than it
looks: the number is the join every money subsystem reaches a matter through, so a prospective matter
has no invoice, holds no trust money and carries no portal grant — not because a permission check
refuses it, but because there is nothing to join on. A `prospect` flag would have had to be defended
separately in every one of those subsystems, forever.

**The front door does not open onto the Directory.** An enquiry lands as an `intake_submission` that
is not an entity, not a matter, and not in the conflicts corpus, and only a named member's audited act
promotes one. The boundary sits at triage rather than at conversion for a reason specific to this
Directory: it soft-deletes only, and a merged subordinate stays in the corpus **on purpose** so a
merged-away alias still surfaces a hit. There is no undo, so whatever an anonymous stranger can write
into the Directory is in the conflicts corpus permanently.

**The public form reads nothing, which is the only way it can reveal nothing.** Answering identically
after a lookup still leaks — a form that consults the Directory answers measurably slower for a name
with candidates, and a probing script takes its oracle off the clock. So the rule is structural: one
write, no read, no duplicate detection, no conflicts check, no routing refusal for an unsupported
practice area, and a source scan proving it. Every one of those reads is available a moment later on
the staff side of triage, where the caller is a member. A public form also may not collect a protected
identifier at all, enforced by the field vocabulary having no kind that maps to a `protectedField`
declaration rather than by validation.

**The conversion gate is on the firm's procedure, never on a verdict.** The engine returns no
conclusion and this design does not invent one. It gates on four conditions the posture read already
computes — never checked, scope below the firm's live floor, a surfaced hit nobody disposed, an open
re-check request — every one a fact about whether the firm looked rather than about the client. The
asymmetry is the argument: fourteen strongest-tier hits, each disposed by a named partner with a
rationale, passes; zero hits with no check does not. The scope condition costs nothing because the
shortfall is derived against the live policy row on read, so raising a firm's floor fails the gate
everywhere at once with no sweep and no stored judgement to rot.

Also settled: a lead and a prospective matter are one record, so nothing migrates at conversion;
conversion is the shipped `openMatter` transition and is one-way, because releasing a drawn number is
what the allocation primary key exists to prevent; a pipeline stage is firm vocabulary that gates
nothing, since a stage that gated conversion would let a rename move an ethics gate; and call intake
gets a reserved `telephony` source value and stops there, because the port does not exist.

Two gaps recorded rather than filled. The platform has **no note, comment or timeline entity on any
record**, so a CRM activity feed can be derived from submissions, stage changes, checks, calendar
events and filed email but cannot hold "she is thinking about it" — and a note belongs to every
matter, not only a prospective one. And `matter` has `closed_at` with no reason column, so a declined
engagement has no home on the matter today; the outcome goes on the intake record and the conflicts
report stays reproducible rather than stored, because `describeCheck` is pure over rows six database
triggers refuse to mutate.

No feature code, no schema, no migration, no route. Thirteen owner flags in a new `J` series: seven
decide what gets built, four decide how, and two are professional-conduct questions the design
analyses and answers neither — Rule 1.18 against the unbuilt ethical wall, and an erasure request from
a declined prospect against a conflicts corpus whose whole value is that it does not forget.
