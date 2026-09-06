import { readCurrentValues } from "@magna-carta/custom-fields/reads";
import type { IntakeStepReader } from "../checklist.ts";

// The questionnaire step, answered by a custom field's current value on the matter. A step naming
// no field is declined and falls to a member's record. "Answered" means any value column is set:
// the engine's own value shape decides what a value is, and a checkbox left unticked is a stored
// false rather than an absence.
export const questionnaireStepReader: IntakeStepReader = async ({ database, matterId, step }) => {
  const fieldId = step.reference_id;
  if (fieldId === null) return null;
  const values = await readCurrentValues(database, matterId);
  const answered = values.some(
    (value) =>
      value.fieldId === fieldId &&
      (value.valueText !== null ||
        value.valueNumber !== null ||
        value.valueDate !== null ||
        value.valueOptionId !== null ||
        value.valueReferenceId !== null),
  );
  return answered
    ? { satisfied: true, statement: "The field has been answered on this matter." }
    : { satisfied: false, statement: "The field has not been answered on this matter." };
};
