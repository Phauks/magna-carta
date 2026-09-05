import { describe, expect, it } from "vitest";
import {
  consultationText,
  consultationTitle,
  intakeComplete,
  intakeDeskColumns,
  intakeResumeHref,
  intakeStandingText,
  scheduleRefusal,
  EMPTY_INTAKE_DESK_VOCABULARY,
  UNNUMBERED_INTAKE,
  type IntakeDeskRow,
} from "../src/lib/intake/intake-desk.ts";

/*
 * The intake desk's model: what a row says about how far an intake is, when the consultation may be
 * scheduled from it, and what the columns are told. Sentences on a screen that decides when a firm
 * sits down with a prospective client are worth a test, and a test cannot reach a template.
 */

function row(overrides: Partial<IntakeDeskRow> = {}): IntakeDeskRow {
  return {
    matterId: "matter_1",
    title: "Chase estate consultation",
    consultationNumber: "C-0007",
    matterTypeId: "matterType_1",
    matterTypeName: "Estate planning",
    responsibleMemberId: "user_1",
    responsibleMemberName: "Ada Pemberton",
    clientEntityId: "directoryPerson_1",
    clientDisplayName: "Rosalind Chase",
    createdAt: "2026-09-05T10:00:00.000Z",
    isStale: false,
    checklist: { bound: true, steps: 5, answered: 3, outstandingRequired: 1 },
    nextConsultation: null,
    ...overrides,
  };
}

const MAY_SCHEDULE = ["calendar:manage"];

describe("how far an intake is", () => {
  it("counts the firm's own steps and what is left, never a word about the client", () => {
    expect(intakeStandingText({ bound: true, steps: 5, answered: 3, outstandingRequired: 1 })).toBe(
      "3 of 5 answered, 1 required outstanding",
    );
    expect(intakeStandingText({ bound: true, steps: 5, answered: 2, outstandingRequired: 2 })).toBe(
      "2 of 5 answered, 2 required outstanding",
    );
    expect(intakeStandingText({ bound: true, steps: 5, answered: 4, outstandingRequired: 0 })).toBe(
      "4 of 5 answered, ready to open",
    );
  });

  it("states the absence of a procedure as an absence, not as nothing outstanding", () => {
    expect(
      intakeStandingText({ bound: false, steps: 0, answered: 0, outstandingRequired: 0 }),
    ).toBe("No procedure binds this kind of matter");
  });

  it("is complete when no required step is outstanding", () => {
    expect(intakeComplete({ bound: true, steps: 2, answered: 1, outstandingRequired: 0 })).toBe(
      true,
    );
    expect(intakeComplete({ bound: true, steps: 2, answered: 1, outstandingRequired: 1 })).toBe(
      false,
    );
  });
});

describe("scheduling the consultation", () => {
  it("waits for the intake to be complete, and says how much is left", () => {
    expect(scheduleRefusal(row(), MAY_SCHEDULE)).toBe(
      "One required step is outstanding. The consultation is scheduled once the intake is complete.",
    );
    expect(
      scheduleRefusal(
        row({ checklist: { bound: true, steps: 5, answered: 1, outstandingRequired: 3 } }),
        MAY_SCHEDULE,
      ),
    ).toBe(
      "3 required steps are outstanding. The consultation is scheduled once the intake is complete.",
    );
  });

  it("is allowed once every required step is answered, and on a kind no procedure binds", () => {
    const complete = row({
      checklist: { bound: true, steps: 5, answered: 5, outstandingRequired: 0 },
    });
    expect(scheduleRefusal(complete, MAY_SCHEDULE)).toBeUndefined();
    const unbound = row({
      checklist: { bound: false, steps: 0, answered: 0, outstandingRequired: 0 },
    });
    expect(scheduleRefusal(unbound, MAY_SCHEDULE)).toBeUndefined();
  });

  it("is refused without the calendar permission, naming it, before anything about the intake", () => {
    expect(scheduleRefusal(row(), [])).toContain("calendar:manage");
  });

  it("says the session is still being read rather than claiming a permission is not held", () => {
    expect(scheduleRefusal(row(), null)).toBe("Reading your session.");
  });

  it("does not schedule a consultation that is already on the calendar", () => {
    const scheduled = row({
      checklist: { bound: true, steps: 5, answered: 5, outstandingRequired: 0 },
      nextConsultation: {
        eventId: "matterEvent_1",
        title: "Consultation with Rosalind Chase",
        startsOn: "2026-09-08",
        startsAtTime: "10:00",
        timeZone: "America/Los_Angeles",
      },
    });
    expect(scheduleRefusal(scheduled, MAY_SCHEDULE)).toContain("already");
  });

  it("titles the consultation after the client, or after the matter when there is none", () => {
    expect(consultationTitle(row())).toBe("Consultation with Rosalind Chase");
    expect(consultationTitle(row({ clientDisplayName: null }))).toBe(
      "Consultation: Chase estate consultation",
    );
  });

  it("reads the setting's date and wall-clock time, and leaves out a time nobody recorded", () => {
    expect(consultationText(null)).toBe("Not scheduled");
    expect(
      consultationText({
        eventId: "matterEvent_1",
        title: "Consultation",
        startsOn: "2026-09-08",
        startsAtTime: "10:00",
        timeZone: "America/Los_Angeles",
      }),
    ).toBe("2026-09-08 10:00");
    expect(
      consultationText({
        eventId: "matterEvent_1",
        title: "Consultation",
        startsOn: "2026-09-08",
        startsAtTime: null,
        timeZone: "America/Los_Angeles",
      }),
    ).toBe("2026-09-08");
  });
});

describe("the desk's columns", () => {
  const columns = intakeDeskColumns({
    matterTypeNames: ["Estate planning", "Personal injury"],
    memberNames: ["Ada Pemberton"],
  });
  const column = (id: string) => columns.find((candidate) => candidate.id === id);

  it("anchors the row on the consultation number and names the absence of one", () => {
    expect(columns[0]?.id).toBe("consultationNumber");
    expect(columns[0]?.anchored).toBe(true);
    expect(column("consultationNumber")?.value(row({ consultationNumber: null }))).toBe(
      UNNUMBERED_INTAKE,
    );
  });

  it("offers the firm's declared vocabularies whole, whatever the desk holds", () => {
    expect(column("matterType")?.filterValues).toEqual(["Estate planning", "Personal injury"]);
    expect(column("responsible")?.filterValues).toEqual(["Ada Pemberton"]);
    expect(
      intakeDeskColumns(EMPTY_INTAKE_DESK_VOCABULARY).find((c) => c.id === "matterType")
        ?.filterValues,
    ).toEqual([]);
  });

  it("sorts the standing by what is left to do and prints the sentence", () => {
    const standing = column("standing");
    expect(standing?.value(row())).toBe(1);
    expect(standing?.text?.(row())).toBe("3 of 5 answered, 1 required outstanding");
  });

  it("resumes an intake on the matter's own Intake section", () => {
    expect(intakeResumeHref(row())).toBe("/matters/matter_1/intake");
  });
});
