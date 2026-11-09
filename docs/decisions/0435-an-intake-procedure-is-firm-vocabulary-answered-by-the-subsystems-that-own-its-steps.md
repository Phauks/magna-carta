---
number: 435
slug: an-intake-procedure-is-firm-vocabulary-answered-by-the-subsystems-that-own-its-steps
status: Accepted
date: 2026-09-03
area: Client intake
summary: "What a kind of matter must clear before it opens is a firm-authored procedure bound to a matter type (or every type), holding ordered steps whose KIND decides who answers them: the conflicts posture, the billing arrangement in force, an assembly of a named template, the matter's trust position, a custom field's value, or a member's own record. The checklist is derived at the moment it is read and never stored, so a step cannot say done after the fact it stood on has changed and editing the procedure reaches every consultation of its kind at once. Readers are registered by the composition root rather than imported by the checklist, which is what lets a kind exist ahead of the subsystem that will answer it. The opening gate refuses while a required step is outstanding and concludes nothing about the client; the override is a waiver under a named member's own permission with a mandatory rationale. Every member record is append-and-flip, every write is a person's, and the platform seeds no procedure."
---

**A firm's intake procedure is its own list, per kind of matter, and each step on it is answered by
whoever already holds the fact.**

**Context:** the owner's direction was to begin the intake procedure, build it with seams because
parts such as the conflicts check may not be complete, and recognise that the required procedures
and forms differ by the kind of matter being opened. The wider intake design of 2026-08-15 had
already settled that a lead is a prospective matter and that the conversion gate is on the firm's
procedure rather than on a verdict; what it had not said was what the procedure IS as a record, or
how a step whose subsystem is unbuilt could be part of it without a second implementation later.

**Decision:** an `intake_procedure` is firm vocabulary on the matter plan's model — bound to a
matter type or to every type, soft-deactivated, never seeded by the platform — holding ordered
`intake_procedure_step` rows. A step's `kind` is a closed vocabulary held by a CHECK and it decides
who answers the step: `conflicts-check` by the conflicts posture (checked, at the floor, every hit
answered, no re-check owed), `fee-agreement` by the billing arrangement in force, `document` and
`engagement-letter` by an assembly of the named template landing on the matter, `retainer` by client
funds held in trust, `questionnaire` by the named custom field's value, and `identity-verification`
and `acknowledgement` by a member's record. Every kind also accepts a member's record where the
platform could not see the fact, except the two whose fact it holds authoritatively, which may only
be waived.

The checklist is DERIVED on every read and stored nowhere. The readers behind the kinds are a
registry the composition root supplies to both the checklist route and the opening gate, never an
import inside the checklist, so the two cannot disagree and a kind may exist before its subsystem.
A member's answer (`matter_intake_step_record`) is append-and-flip with one live record per step per
matter; a waiver carries its rationale and is recorded as a waiver, never as a completion. The
matter shell gained an `openPreconditions` hook mirroring its close hook, and the intake gate refuses
while any required step is outstanding, naming each.

**Considered and rejected:** snapshotting the procedure onto the matter at creation (the tasks
precedent), because a procedure is the firm's current policy on what it requires before it acts and
the conflicts floor already established that raising the requirement reaches every affected matter
immediately; a hand-recordable conflicts step, because a "done" beside a posture that says otherwise
is the record the gate exists to refuse; a hard refusal with no override, because the wider design
refused only an untraced override and a traced one is a waiver; a platform-seeded default
procedure, on the matter plan's malpractice argument; a commit guard on the gate, because its facts
span several subsystems and a member's records and no single statement re-asserts them.

**Consequences:** a firm writes what its own intake requires per practice area and the platform
holds the door on it; a step whose subsystem is unbuilt is a member's word today and a system's
answer later with no schema or procedure change; the intake and conflicts vocabulary discipline
extends to the new surfaces by lint. Spec:
[`docs/specs/2026-09-03-intake-procedure-design.md`](../specs/2026-09-03-intake-procedure-design.md).
