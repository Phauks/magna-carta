import { describe, expect, it } from "vitest";
import { readIntakeChecklist } from "../src/checklist.ts";
import { BUILT_STEP_READERS } from "../src/readers/index.ts";
import { INTAKE_STEP_KINDS } from "../src/types.ts";
import { CONSULTATION, firmWithProcedure } from "./support.ts";

// The built readers against a migrated database, on the cheapest seedable facts: the conflicts
// posture of a matter nobody has checked, the trust position of a matter with no ledger, the billing
// arrangement of a matter with none, an assembly row, and a custom-field value row. Each subsystem's
// own suite covers the rest of its states; what is under test here is that the reader asks the right
// question and repeats the answer in the subsystem's vocabulary.

describe("the built readers", () => {
  it("cover every kind except the two answered only by a member", () => {
    const answered = INTAKE_STEP_KINDS.filter((kind) => BUILT_STEP_READERS[kind] !== undefined);
    expect(answered).toEqual([
      "conflicts-check",
      "fee-agreement",
      "engagement-letter",
      "retainer",
      "document",
      "questionnaire",
    ]);
  });

  it("answer a fresh consultation honestly: unchecked, unagreed, unfunded", async () => {
    const database = await firmWithProcedure([
      { kind: "conflicts-check", title: "Conflicts" },
      { kind: "fee-agreement", title: "Fee" },
      { kind: "retainer", title: "Retainer" },
    ]);
    const checklist = await readIntakeChecklist(
      database.database,
      CONSULTATION,
      BUILT_STEP_READERS,
    );
    expect(
      checklist.steps.map((step) => [step.standing.satisfied, step.standing.statement]),
    ).toEqual([
      [false, "A conflicts check has not yet run on this matter."],
      [
        false,
        "No fee arrangement has been recorded on this matter. Record one from the status window.",
      ],
      [false, "The matter holds no client funds in trust."],
    ]);
  });

  it("see a document once an assembly of the named template lands on the matter", async () => {
    const database = await firmWithProcedure([
      { kind: "engagement-letter", title: "Letter", referenceId: "documentTemplate_letter" },
      { kind: "document", title: "Unnamed", required: false },
    ]);
    const before = await readIntakeChecklist(database.database, CONSULTATION, BUILT_STEP_READERS);
    expect(before.steps[0]?.standing).toMatchObject({
      satisfied: false,
      answeredBy: "subsystem",
    });
    // A step naming no template is declined by the reader and stands as nobody's.
    expect(before.steps[1]?.standing.answeredBy).toBe("nobody");

    database.raw.exec(
      `INSERT INTO document_template (id, name, matter_type_id, location_id, status, current_version_id, created_by, created_at, updated_at) VALUES ('documentTemplate_letter', 'Engagement letter', NULL, NULL, 'active', NULL, 'user_intakeTester000', '2026-08-01T00:00:00.000Z', '2026-08-01T00:00:00.000Z')`,
    );
    database.raw.exec(
      `INSERT INTO document_template_version (id, template_id, version_number, status, r2_key, created_by, created_at) VALUES ('documentTemplateVersion_letter1', 'documentTemplate_letter', 1, 'clean', 'templates/letter/1', 'user_intakeTester000', '2026-08-01T00:00:00.000Z')`,
    );
    database.raw.exec(
      `INSERT INTO document_assembly (id, matter_id, template_id, template_version_id, status, outcome, created_at, completed_at) VALUES ('documentAssembly_letter00000000000', '${CONSULTATION}', 'documentTemplate_letter', 'documentTemplateVersion_letter1', 'done', 'succeeded_with_absences', '2026-09-02T10:00:00.000Z', '2026-09-02T10:00:05.000Z')`,
    );
    const after = await readIntakeChecklist(database.database, CONSULTATION, BUILT_STEP_READERS);
    expect(after.steps[0]?.standing).toEqual({
      satisfied: true,
      answeredBy: "subsystem",
      statement: "Assembled onto the matter on 2026-09-02, with some fields left blank.",
    });
  });

  it("see a questionnaire answered once the named custom field holds a current value", async () => {
    const database = await firmWithProcedure([
      { kind: "questionnaire", title: "Date of the accident", referenceId: "customField_accident" },
    ]);
    database.raw.exec(
      `INSERT INTO custom_field (id, name, kind, target, attachment_id, required, position, archived, created_at) VALUES ('customField_accident', 'Accident date', 'date', 'matter', NULL, 0, 0, 0, '2026-08-01T00:00:00.000Z')`,
    );
    const before = await readIntakeChecklist(database.database, CONSULTATION, BUILT_STEP_READERS);
    expect(before.steps[0]?.standing.satisfied).toBe(false);
    database.raw.exec(
      `INSERT INTO custom_field_value (id, field_id, target_row_id, value_date, is_current, valid_from, created_by, created_at) VALUES ('customFieldValue_accident0000000', 'customField_accident', '${CONSULTATION}', '2026-07-04', 1, '2026-09-01T00:00:00.000Z', 'user_intakeTester000', '2026-09-01T00:00:00.000Z')`,
    );
    const after = await readIntakeChecklist(database.database, CONSULTATION, BUILT_STEP_READERS);
    expect(after.steps[0]?.standing).toEqual({
      satisfied: true,
      answeredBy: "subsystem",
      statement: "The field has been answered on this matter.",
    });
  });
});
