# The intake procedure — design and build record

**Status:** Built (first slice), 2026-09-03. This document is the design of the slice as built and
the plan it followed; it stands beside the wider intake design in
[`2026-08-15-client-intake-design.md`](2026-08-15-client-intake-design.md), which it does not
restate.

**White paper:** _Client intake / CRM_, read with _Matters and File Manager_, _Conflicts Check_ and
_Tasks and workflows / matter plans_. **Binding decisions:** ADR-0080 (a consultation is a
prospective matter), ADR-0079 (the number is drawn at open), ADR-0013 (the conflicts posture),
ADR-0003 (firm-scoped data access), and the six pending intake decisions recorded on 2026-08-15,
of which this slice builds against _the conversion gate is on the firm's procedure, never on a
verdict_ and _a lead is a prospective matter and conversion is one-way_.

**Owner direction, 2026-09-03.** "Let's begin making the intake procedure ... build with seams,
since certain portions like conflict check may not be complete yet", and "depending upon what type
of matter is being opened, the required procedures and forms to be filled out may differ." The
second sentence is the shape of the whole design: the procedure is **per matter type**, and it is a
**list of steps** whose answers come from whichever subsystem owns the fact, so a step can exist
ahead of the subsystem that will one day answer it.

---

## 1. What a firm actually does before it takes a matter on

The practice-management literature and the conduct rules agree on the sequence, and they agree it
varies by practice area. Before a firm acts it identifies who it is dealing with; it checks for
conflicts, first on the name and then comprehensively once the parties are known; it decides
whether to act; it agrees the fee, in writing where the rules require it (a contingency fee always;
Nevada RPC 1.5 prefers writing for the rest); it sends an engagement letter that says what the firm
will and will not do; it takes the retainer into trust; it has the client answer the questions the
practice area needs (an injury intake asks about the incident, the insurers and the treating
providers; an estate intake asks about the heirs and the assets); it collects the documents the
client brought; and it records that it did each of those, because the record is what a firm defends
with when the engagement is later questioned. A firm that declines writes a non-engagement letter.

Two things about that list decide the design. **It differs by kind of matter**, so the platform
cannot ship it. And **most of its steps are already facts the platform holds** — the conflicts
posture, the billing arrangement, an assembled document, a trust balance, a custom field's value —
so a checklist that asked a member to re-declare those facts would be a second copy of them, free
to disagree with the first.

## 2. What was built

**A procedure is firm vocabulary, per matter type.** `intake_procedure` binds a matter type (or
every type, when its `matter_type_id` is null) and holds ordered `intake_procedure_step` rows. It is
the matter plan's model — the plan proposes the work that follows an opening; the procedure gates
the opening — and it takes the plan's disciplines: soft-deactivation, no platform-seeded rows, and a
manage permission of its own.

**A step has a kind, and the kind decides who answers it.** Eight kinds, held by a CHECK:

| Kind                    | Answered by                                                        | Recordable by a member |
| ----------------------- | ------------------------------------------------------------------ | ---------------------- |
| `identity-verification` | A member's record (no verification port exists yet)                | yes                    |
| `conflicts-check`       | The conflicts posture: checked, at the floor, every hit answered, no re-check owed | no       |
| `fee-agreement`         | The billing arrangement in force                                   | no                     |
| `engagement-letter`     | An assembly of the named template landing on the matter            | yes                    |
| `retainer`              | Client funds held in trust for the matter                          | yes                    |
| `document`              | An assembly of the named template landing on the matter            | yes                    |
| `questionnaire`         | The named custom field holding a value on the matter               | yes                    |
| `acknowledgement`       | A member's record                                                  | yes                    |

Every kind may be **waived** by a member holding `intake:waive`, with a rationale; a waiver is
recorded as a waiver and never as a completion. The two kinds no member may record complete are the
two whose fact the platform holds authoritatively: a hand-recorded "done" beside a posture that says
otherwise is exactly the record the gate exists to refuse.

**The checklist is derived, never stored.** `readIntakeChecklist` reads the active procedures
binding the matter's type, their active steps, the matter's live records, and asks a **reader** per
kind for the rest. Nothing caches a subsystem's answer onto the matter. Editing a procedure changes
every open checklist at once — the conflicts floor's precedent, and the one place intake departs
from the matter plan's "nothing reconciles": a plan describes work already accepted, a procedure is
the firm's current policy on what it requires before it acts.

**The reader seam is the "build with seams" mechanism.** A reader is a function per kind,
registered by the composition root (`BUILT_STEP_READERS`) and never imported by the checklist. A
kind with no reader is answered by a member's record; adding the reader is the whole change when the
subsystem lands. Today `identity-verification` and `acknowledgement` have none. A reader may also
decline one step (a document step naming no template) by returning null.

**A member's record is append-and-flip.** `matter_intake_step_record` holds one live record per
step per matter (a partial unique index); recording over an answer supersedes it in the same batch,
reopening supersedes and writes nothing, and the history keeps every answer. Every write is a
person's: a source scan holds that only route modules import the writer.

**The opening gate is on procedure, never on a verdict.** `@magna-carta/matters` gained an
`openPreconditions` hook mirroring `closePreconditions`, threaded through `openMatter` before the
number draw and skipped on an idempotent retry. `matterIntakeOpenPrecondition` refuses while any
required step is outstanding, naming each step and what answers it. A conflicts-check step is
satisfied by the four posture facts and says nothing about whether a conflict exists. A firm with
no procedure has no gate from this module.

**Surfaces.** Settings · Intake Procedures authors the list, with the kind picker stating who
answers each kind. The matter's Intake section shows the checklist, each row wearing the subsystem's
or the member's own words, with Record Done, Waive and Reopen where the role allows and a link to
where a subsystem fact is made. The status window shows Requirements To Open on a consultation from
`GET /api/v1/matters/{id}/open-readiness`, and a refused open re-answers them in place.

## 3. Decisions taken against the wider design's open flags

The 2026-08-15 design left seven build-gating flags. This slice took the design's own
recommendation on the ones it touches and left the rest untouched:

- **J1** (staff-entered first, no public form): yes. Nothing here is anonymous.
- **J2** (hard refusal or override): an override, as a **waiver** — a named member with its own
  permission, a mandatory rationale, an audit row, and the record kept forever. The design refused
  only to leave an override untraced, and this one is traced.
- **J5** (may a decline be recorded before a check completes): not built here; declining a
  consultation is `closeMatter`, unchanged.
- **J7** (may a fee agreement be recorded on a prospective matter): the billing engine accepts it and
  the fee-agreement reader reads it, so a firm may, and a procedure may require it.
- **J4, J6, J8** (the pipeline board, the note primitive, seeded stages): untouched; the note
  primitive has since shipped on its own, and there is no stage here.

## 4. Fitness functions

- `packages/intake/test/schema-name-sync.test.ts` pins the three table names and the two closed
  vocabularies to the schema.
- `packages/intake/test/no-automated-writer.test.ts` holds that only route modules import the
  record writer.
- `tooling/lint-conflicts-vocabulary/` scans the intake package, its route and its web surfaces.
- The conformance suite binds `intake:*` to both the firm and the matter resource.
- `lint:list-pagination` carries the procedure list on the same argument as matter plans.

## 5. What is deliberately not here, and where the seams point

- **A verification port.** `identity-verification` is a member's word; the reader slot is empty.
- **E-signature.** `engagement-letter` reads an assembly, not a signature; the kind gains a reader
  over the signing record when one exists.
- **A questionnaire builder.** A questionnaire step names one custom field by identifier; a picker
  over the firm's field definitions waits on a list read that the custom-fields surface does not
  expose yet.
- **A non-engagement letter, the public form, the pipeline board, call intake.** The wider design's
  sections 5, 6 and 10; none is started.
- **A commit guard on the opening gate.** The facts are derived across several subsystems and a
  member's records; no single statement re-asserts them, and the window is visible rather than
  silent (an open matter's Intake section still shows the record).
- **A load-profile volume.** The checklist read is bounded by the procedure's own ceiling (fifty
  steps) and memoises subsystem readings per kind; a volume is worth adding when a firm's
  procedures are many rather than long.
