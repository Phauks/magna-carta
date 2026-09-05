import type {
  OpenPrecondition,
  OpenPreconditionContext,
  OpenPreconditionFailure,
} from "@magna-carta/matters/open-preconditions";
import { readIntakeChecklist, type IntakeStepReaders } from "./checklist.ts";

// THE OPENING GATE. A consultation does not open while a REQUIRED step of the procedure binding it
// has no satisfying answer — from the subsystem that owns the fact, or from a member's record.
//
// It is a gate on the firm's own procedure and never on a verdict. A conflicts-check step is
// satisfied when a check has run at the firm's floor, every surfaced hit has a reviewer's answer and
// no re-check is owed; it says nothing about whether a conflict exists, because the platform never
// does. A matter with fourteen hits, each disposed by a named partner, passes. A matter with none
// and no check does not. The override is a WAIVER: a named member with the waive permission, a
// rationale, an audit row — never a silent bypass — so a record that looks like compliance is
// always a record somebody signed.
//
// A firm with no procedure has no gate from this module. That is deliberate: the platform seeds no
// procedure (the schema says why), and a gate a firm did not write is a rule it cannot answer for.
//
// There is no commit guard. The facts this reads are derived across several subsystems and a
// member's records, and no single statement re-asserts them inside the open's own batch; the window
// between the read and the draw is the same one every derived precondition has, and a step reopened
// in it is a step the matter's Intake section will show as outstanding on an open matter, which is
// visible rather than silent.

export const INTAKE_STEP_OUTSTANDING = "intake-step-outstanding";

async function check(
  context: OpenPreconditionContext,
  readers: IntakeStepReaders,
): Promise<readonly OpenPreconditionFailure[]> {
  const checklist = await readIntakeChecklist(context.database, context.matterId, readers);
  return checklist.steps
    .filter((step) => step.required && !step.standing.satisfied)
    .map((step) => ({
      code: INTAKE_STEP_OUTSTANDING,
      message: `the intake step "${step.title}" (${step.procedureName}) is outstanding: ${step.standing.statement} Answer it on the matter's Intake section, or a member who may waive it records why the matter opens without it.`,
    }));
}

// What the composition root registers against the matter shell's open hook. The readers are the
// same registry the checklist route uses, so the gate and the screen can never answer differently.
export function matterIntakeOpenPrecondition(readers: IntakeStepReaders): OpenPrecondition {
  return { check: (context) => check(context, readers) };
}
