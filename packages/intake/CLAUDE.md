# @magna-carta/intake — CLAUDE.md

**Purpose.** The intake procedure: what a kind of matter must clear before it opens, as a
firm-authored list of steps whose answers come from the subsystems that own the facts. A procedure
binds a matter type (or every type) and holds ordered steps; a consultation's checklist is DERIVED
from the procedures binding its type at the moment of reading; a member's record answers the steps
no subsystem can; and the opening gate refuses a consultation whose required steps are outstanding.
Validates in memory and composes statements into `@magna-carta/data-access`'s `composeEffectBatch`;
holds no binding, reads no clock, and never calls an external service.

**White paper:** _Client intake / CRM_, with _Matters and File Manager_, _Conflicts Check_ and
_Tasks and workflows / matter plans_ as the surrounding context —
[`docs/Magna-Carta-White-Paper.md`](../../docs/Magna-Carta-White-Paper.md).
**Spec:** [`docs/specs/2026-09-03-intake-procedure-design.md`](../../docs/specs/2026-09-03-intake-procedure-design.md)
and [`docs/specs/2026-09-05-intake-desk-design.md`](../../docs/specs/2026-09-05-intake-desk-design.md),
against the wider intake design in
[`docs/specs/2026-08-15-client-intake-design.md`](../../docs/specs/2026-08-15-client-intake-design.md).

## Key files / entry points

- `src/types.ts` — the step-kind catalog (`INTAKE_STEP_KINDS`, a CHECK on the schema), each kind's
  profile (whether a member may record it complete by hand; what its reference names), the record
  outcomes, and the ceilings
- `src/validation.ts` — every refusal as a code the route maps to a problem type
- `src/procedure-statements.ts` / `src/procedure-service.ts` — authoring: create, edit, deactivate a
  procedure; add, edit, retire a step. Soft-deactivation throughout; a step's KIND is not editable
- `src/record-statements.ts` / `src/record-service.ts` — a member's answer to a step on a matter:
  `recordStepCompleted`, `waiveStep`, `reopenStep`. Append-and-flip: recording over an answer
  supersedes it in the same batch; reopening supersedes and writes nothing
- `src/checklist.ts` — **`readIntakeChecklist`**, the one read every intake surface and the gate
  share, and the **reader seam** (`IntakeStepReader`, `IntakeStepReaders`)
- `src/desk.ts` — **`readIntakeDesk`**: every consultation in flight, firm-wide, with the names it
  needs in one batched read each, the next scheduled event, and one checklist read per row for the
  counts; the page is capped at fifty because that last read is derived, never stored
- `src/graduation-precondition.ts` — `matterIntakeGraduationPrecondition(readers)`: the gate on
  intake -> consultation that the composition root registers against `@magna-carta/matters`'s
  graduation hook
- `src/readers/` — the built readers: conflicts posture, billing arrangement, trust position,
  document assembly, custom-field value; `BUILT_STEP_READERS` is the registry the worker registers

## Invariants that apply here

- **The checklist is derived, never stored.** Nothing caches a subsystem's answer onto the matter. A
  step cannot say "done" after the fact it stood on has changed, and editing a procedure changes
  every open checklist at once — the conflicts floor's precedent, and the one place intake departs
  from the matter plan's "nothing reconciles" (a plan describes work already accepted; a procedure
  is the firm's current policy on what it requires before it acts).
- **A kind decides who answers.** `conflicts-check` and `fee-agreement` are answered ONLY by their
  subsystem (`recordable: false`): a hand-recorded "done" beside a posture that says otherwise is the
  record the gate exists to refuse. Every kind may be WAIVED, and a waiver is recorded as a waiver,
  never as a completion, so it is never mistaken for the fact.
- **The gate is on procedure, never on a verdict.** A conflicts-check step is satisfied by the four
  posture facts (checked, at the floor, every hit answered, no re-check owed) and says nothing about
  whether a conflict exists. `tooling/lint-conflicts-vocabulary/` scans this package.
- **Every record is a person's.** No queue consumer, scheduled handler or rule imports
  `record-service.ts`; `test/no-automated-writer.test.ts` holds it on the source text.
- **The platform seeds no procedure**, on the matter plan's argument.
- **Readers are registered, never imported, by the checklist.** A kind may exist ahead of the
  subsystem that will answer it (`identity-verification`, `client-forms` and `payment` today);
  adding the reader is the whole change when the subsystem lands.
- **The desk adds no table.** An intake in flight is a matter in the `intake` status and a
  consultation is one the procedure let through; `readIntakeDesk` reads both rungs through the
  matters listing and derives the rest, so nothing here can disagree with the docket.
- **The procedure gates graduation, not opening.** `graduation-precondition.ts` is registered
  against the matter shell's `graduatePreconditions` hook (intake -> consultation); a consultation
  opens on the firm's decision with no intake gate, and a member's records are refused once the
  matter has left intake.

## Dependencies & contracts

- Depends on `@magna-carta/matters` (the open-precondition types), `@magna-carta/data-access`,
  `@magna-carta/identifiers`, and — for the readers only — `@magna-carta/conflicts`,
  `@magna-carta/billing`, `@magna-carta/trust`, `@magna-carta/document-assembly`,
  `@magna-carta/custom-fields`, `@magna-carta/money`. The checklist and the services import none of
  the reader dependencies.
- The worker registers `BUILT_STEP_READERS` with both the checklist route and the open precondition,
  so the gate and the screen cannot answer differently.

## Gotchas

- A reader returning `null` DECLINES the step (a document step naming no template); the step is
  then a member's record or nothing. `satisfied: false` is a different answer — the subsystem
  looked and the fact is not there.
- Readings are memoised per kind and reference within one checklist read; two conflicts-check steps
  cost one posture read.
- `readMatterAnchor` excludes system matters (`system_key IS NOT NULL`) — the custody holding
  matter has no intake.
