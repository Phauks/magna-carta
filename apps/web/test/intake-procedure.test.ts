/*
 * The intake procedure's model, pinned. What is worth a test here is everything a person reads on
 * a screen that decides whether the firm takes a client on:
 *
 *   - every kind the server accepts has a name, a description, and an honest account of who answers
 *     it — including the two the platform cannot see yet;
 *   - a step's mark follows its standing and its weight, so an optional unanswered step is quiet;
 *   - the one number the checklist states is about the firm's procedure and reads as a sentence;
 *   - what a member may do to a step is decided by the step, the matter's status, and their
 *     permissions, and the screen never offers what the server would refuse.
 */
import { describe, expect, it } from "vitest";
import { INTAKE_STEP_KINDS, type IntakeChecklistStep } from "../src/lib/intake/intake-api.ts";
import {
  INTAKE_STEP_KIND_VOCABULARY,
  describeIntakeRecord,
  intakeChecklistSummary,
  intakeStepActions,
  intakeStepKindLabel,
  intakeStepMark,
} from "../src/lib/intake/intake-procedure.ts";

function step(overrides: Partial<IntakeChecklistStep> = {}): IntakeChecklistStep {
  return {
    stepId: "intakeProcedureStep_a",
    procedureId: "intakeProcedure_a",
    procedureName: "Injury intake",
    kind: "acknowledgement",
    title: "Give the client the privacy notice",
    instructions: null,
    required: true,
    referenceId: null,
    position: 0,
    recordable: true,
    standing: { satisfied: false, answeredBy: "nobody", statement: "Not yet recorded." },
    record: null,
    ...overrides,
  };
}

describe("the kind vocabulary", () => {
  it("names every kind the contract accepts, once, in title case", () => {
    expect(INTAKE_STEP_KIND_VOCABULARY.map((entry) => entry.kind)).toEqual([...INTAKE_STEP_KINDS]);
    for (const kind of INTAKE_STEP_KINDS) {
      const label = intakeStepKindLabel(kind);
      expect(label).toMatch(/^[A-Z]/u);
      expect(label).not.toMatch(/—/u);
    }
  });

  it("is honest about the kinds a member answers because no subsystem can", () => {
    const identity = INTAKE_STEP_KIND_VOCABULARY.find(
      (entry) => entry.kind === "identity-verification",
    );
    expect(identity?.answeredBy).toContain("A member records");
    const conflicts = INTAKE_STEP_KIND_VOCABULARY.find((entry) => entry.kind === "conflicts-check");
    expect(conflicts?.answeredBy).toContain("can't be entered by hand");
    // The two kinds named ahead of their subsystems say so, and say which subsystem.
    const forms = INTAKE_STEP_KIND_VOCABULARY.find((entry) => entry.kind === "client-forms");
    expect(forms?.answeredBy).toContain("A member records");
    expect(forms?.answeredBy).toContain("portal");
    const payment = INTAKE_STEP_KIND_VOCABULARY.find((entry) => entry.kind === "payment");
    expect(payment?.answeredBy).toContain("A member records");
    expect(payment?.sectionSlug).toBeNull();
  });

  it("names a reference only on the kinds that are about one thing", () => {
    const withReference = INTAKE_STEP_KIND_VOCABULARY.filter(
      (entry) => entry.reference !== null,
    ).map((entry) => entry.kind);
    expect(withReference).toEqual(["engagement-letter", "document", "questionnaire"]);
  });
});

describe("the mark", () => {
  it("is the affirmative mark when satisfied, a finding when required and not, quiet when optional", () => {
    expect(
      intakeStepMark(
        step({ standing: { satisfied: true, answeredBy: "record", statement: "Done." } }),
      ),
    ).toBe("satisfied");
    expect(intakeStepMark(step())).toBe("outstanding");
    expect(intakeStepMark(step({ required: false }))).toBe("optional");
  });
});

describe("the summary line", () => {
  it("says how many required steps stand in the way, as a sentence", () => {
    const base = { matterStatus: "intake" as const, steps: [step()] };
    expect(intakeChecklistSummary({ ...base, outstandingRequired: 1 })).toBe(
      "One required step is outstanding before the intake is complete.",
    );
    expect(intakeChecklistSummary({ ...base, outstandingRequired: 3 })).toBe(
      "3 required steps are outstanding before the intake is complete.",
    );
    expect(intakeChecklistSummary({ ...base, outstandingRequired: 0 })).toContain(
      "All required steps are answered",
    );
  });

  it("says when nothing binds the matter, and when the funnel has ended", () => {
    expect(
      intakeChecklistSummary({ matterStatus: "intake", steps: [], outstandingRequired: 0 }),
    ).toContain("nothing stands between it and the consultation");
    expect(
      intakeChecklistSummary({
        matterStatus: "consultation",
        steps: [step()],
        outstandingRequired: 0,
      }),
    ).toContain("The intake is complete");
    expect(
      intakeChecklistSummary({ matterStatus: "open", steps: [step()], outstandingRequired: 0 }),
    ).toContain("The matter has opened");
  });
});

describe("what a member may do", () => {
  const record = ["intake:record"];
  const waive = ["intake:waive"];

  it("offers record only on a recordable, unanswered step to a member who may record", () => {
    expect(intakeStepActions(step(), "intake", record)).toEqual({
      record: true,
      waive: false,
      reopen: false,
    });
    expect(intakeStepActions(step({ recordable: false }), "intake", record).record).toBe(false);
    expect(intakeStepActions(step(), "intake", waive).record).toBe(false);
  });

  it("offers waive to a member who may waive, on any unanswered kind, including the unrecordable", () => {
    expect(intakeStepActions(step({ recordable: false }), "intake", waive).waive).toBe(true);
    expect(intakeStepActions(step(), "intake", record).waive).toBe(false);
  });

  it("offers reopen, and nothing else, on a step with a live record", () => {
    const answered = step({
      record: {
        id: "matterIntakeStepRecord_a",
        outcome: "completed",
        rationale: null,
        note: null,
        recordedBy: "user_a",
        recordedAt: "2026-09-03T12:00:00.000Z",
      },
    });
    expect(intakeStepActions(answered, "intake", [...record, ...waive])).toEqual({
      record: false,
      waive: false,
      reopen: true,
    });
  });

  it("offers nothing once the matter has opened", () => {
    expect(intakeStepActions(step(), "open", [...record, ...waive])).toEqual({
      record: false,
      waive: false,
      reopen: false,
    });
  });
});

describe("a record's line", () => {
  it("reads the outcome and the words left with it", () => {
    expect(describeIntakeRecord({ outcome: "completed", rationale: null, note: null })).toBe(
      "Recorded as completed.",
    );
    expect(describeIntakeRecord({ outcome: "completed", rationale: null, note: "Passport" })).toBe(
      "Recorded as completed: Passport",
    );
    expect(
      describeIntakeRecord({ outcome: "waived", rationale: "Existing client", note: null }),
    ).toBe("Waived: Existing client");
  });
});
