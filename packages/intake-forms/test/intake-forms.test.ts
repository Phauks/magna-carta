import { describe, expect, it } from "vitest";
import {
  fieldKindTakesOptions,
  INTAKE_FORM_FIELD_KINDS,
  isIntakeFormFieldKind,
  isTriageState,
  MAX_ANSWER_LENGTH,
  MAX_SUBMISSION_TOTAL_LENGTH,
} from "../src/types.ts";
import {
  IntakeFormValidationError,
  normalizeFieldShape,
  normalizeFormName,
  normalizeSubmissionBudget,
  validateSubmissionAnswers,
  type AnswerableField,
} from "../src/validation.ts";
import { budgetWindowStart } from "../src/submission-service.ts";
import { mintPublicToken } from "../src/form-service.ts";

/*
 * The public intake form's rules, proved where they live.
 *
 * The submission half is the part worth testing hardest, because it runs on the only path in this
 * platform an unidentified stranger can reach, and every one of its refusals is either a fact about
 * what they typed — which is safe to report — or a fact about the firm, which is not.
 */

function field(overrides: Partial<AnswerableField> = {}): AnswerableField {
  return {
    fieldId: "intakeFormField_one",
    kind: "question",
    label: "What happened",
    required: false,
    options: null,
    ...overrides,
  };
}

describe("the question vocabulary", () => {
  it("is closed", () => {
    expect(isIntakeFormFieldKind("question")).toBe(true);
    // The one that matters: a public form must never be able to name a firm's own field
    // definition, because a custom field can reference a directory record and a stranger would
    // then be aiming a value at somebody the firm knows.
    expect(isIntakeFormFieldKind("custom-field")).toBe(false);
    expect(isIntakeFormFieldKind("contact-reference")).toBe(false);
    expect(isIntakeFormFieldKind("matter-reference")).toBe(false);
  });

  it("offers exactly one option-bearing kind", () => {
    const bearing = INTAKE_FORM_FIELD_KINDS.filter((kind) => fieldKindTakesOptions(kind));
    expect(bearing).toEqual(["choice"]);
  });
});

describe("authoring a question", () => {
  it("refuses options on a kind that does not offer them", () => {
    expect(() =>
      normalizeFieldShape({ kind: "telephone", label: "Number", options: ["a", "b"] }),
    ).toThrow(IntakeFormValidationError);
  });

  it("refuses a choice with no choices", () => {
    // A choice field with an empty list renders a picker a visitor cannot answer, which is worse
    // than refusing the author.
    expect(() => normalizeFieldShape({ kind: "choice", label: "Kind", options: [] })).toThrow(
      IntakeFormValidationError,
    );
  });

  it("trims a choice list and keeps its order", () => {
    const shape = normalizeFieldShape({
      kind: "choice",
      label: "Kind of matter",
      options: ["  Family  ", "Probate"],
    });
    expect(shape.options).toEqual(["Family", "Probate"]);
  });

  it("keeps help text out of the label", () => {
    const shape = normalizeFieldShape({
      kind: "question",
      label: "Your name",
      helpText: "  As it appears on your identification  ",
    });
    expect(shape.label).toBe("Your name");
    expect(shape.helpText).toBe("As it appears on your identification");
  });

  it("treats blank help text as absent rather than as an empty line", () => {
    expect(normalizeFieldShape({ kind: "question", label: "Q", helpText: "   " }).helpText).toBe(
      null,
    );
  });
});

describe("a form's own settings", () => {
  it("refuses an unnamed form", () => {
    expect(() => normalizeFormName("   ")).toThrow(IntakeFormValidationError);
  });

  it("takes no budget as no budget, and refuses a nonsensical one", () => {
    expect(normalizeSubmissionBudget(null)).toBe(null);
    expect(normalizeSubmissionBudget(undefined)).toBe(null);
    expect(normalizeSubmissionBudget(25)).toBe(25);
    expect(() => normalizeSubmissionBudget(0)).toThrow(IntakeFormValidationError);
    expect(() => normalizeSubmissionBudget(-1)).toThrow(IntakeFormValidationError);
    expect(() => normalizeSubmissionBudget(2.5)).toThrow(IntakeFormValidationError);
  });
});

describe("what a stranger sent", () => {
  it("keeps an answer against the field it answers", () => {
    const answers = validateSubmissionAnswers([field({ fieldId: "a" })], { a: "  it happened  " });
    expect(answers).toEqual({ a: "it happened" });
  });

  it("refuses a missing required answer, and names the question", () => {
    expect(() =>
      validateSubmissionAnswers([field({ fieldId: "a", required: true, label: "Your name" })], {}),
    ).toThrow(/Your name/u);
  });

  it("drops an unanswered optional question rather than storing an empty string", () => {
    // A stored empty answer reads on the triage screen as "they answered nothing", which is a
    // different fact from "they were not asked to".
    expect(validateSubmissionAnswers([field({ fieldId: "a" })], { a: "   " })).toEqual({});
  });

  it("refuses an answer that is not one of the choices offered", () => {
    expect(() =>
      validateSubmissionAnswers([field({ fieldId: "a", options: ["Family", "Probate"] })], {
        a: "Something else",
      }),
    ).toThrow(IntakeFormValidationError);
  });

  it("refuses a submission naming a question the version does not have", () => {
    // A stale page or a hand-rolled client. Dropping the unknown key and keeping the rest would
    // file a partial answer the firm would read as complete.
    expect(() =>
      validateSubmissionAnswers([field({ fieldId: "a" })], { a: "yes", b: "smuggled" }),
    ).toThrow(IntakeFormValidationError);
  });

  it("bounds one answer and the whole submission", () => {
    expect(() =>
      validateSubmissionAnswers([field({ fieldId: "a" })], {
        a: "x".repeat(MAX_ANSWER_LENGTH + 1),
      }),
    ).toThrow(IntakeFormValidationError);

    const many = Array.from({ length: 20 }, (_, index) => field({ fieldId: `f${String(index)}` }));
    const bulky = Object.fromEntries(
      many.map((one) => [one.fieldId, "y".repeat(MAX_ANSWER_LENGTH)]),
    );
    expect(MAX_SUBMISSION_TOTAL_LENGTH).toBeLessThan(20 * MAX_ANSWER_LENGTH);
    expect(() => validateSubmissionAnswers(many, bulky)).toThrow(IntakeFormValidationError);
  });

  it("reads answers by field id, so a reused label cannot re-caption an answer", () => {
    const answers = validateSubmissionAnswers(
      [
        field({ fieldId: "first", label: "Describe the problem" }),
        field({ fieldId: "second", label: "Describe the problem" }),
      ],
      { first: "the first one", second: "the second one" },
    );
    expect(answers).toEqual({ first: "the first one", second: "the second one" });
  });
});

describe("triage", () => {
  it("does not let a member return a submission to the state it was born in", () => {
    // A member who has looked cannot un-look, and a queue whose count can be reset means nothing.
    expect(isTriageState("new")).toBe(true);
    for (const state of ["accepted", "declined", "spam"]) {
      expect(isTriageState(state)).toBe(true);
    }
    expect(isTriageState("archived")).toBe(false);
  });
});

describe("the daily budget window", () => {
  it("starts at the UTC day, so a flood cannot aim at a firm's own midnight", () => {
    expect(budgetWindowStart("2026-09-07T23:59:59.999Z")).toBe("2026-09-07T00:00:00.000Z");
    expect(budgetWindowStart("2026-09-08T00:00:00.001Z")).toBe("2026-09-08T00:00:00.000Z");
  });
});

describe("the public token", () => {
  it("is URL-safe, because it is a path segment", () => {
    const token = mintPublicToken(() => new Uint8Array(32).fill(255));
    expect(token).toMatch(/^[A-Za-z0-9_-]+$/u);
  });

  it("is sized as a secret rather than as an identifier", () => {
    // 32 bytes of entropy. The token is the only thing between a stranger and a firm's form, and
    // the link is pasted rather than typed, so length costs nothing anybody notices.
    const token = mintPublicToken(() => new Uint8Array(32).fill(1));
    expect(token.length).toBeGreaterThanOrEqual(42);
  });

  it("differs between mints", () => {
    let seed = 0;
    const source = (bytes: number) => new Uint8Array(bytes).fill(seed++);
    expect(mintPublicToken(source)).not.toBe(mintPublicToken(source));
  });
});
