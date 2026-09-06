import {
  describeArrangement,
  readBillingArrangementInForce,
} from "@magna-carta/billing/arrangements";
import type { IntakeStepReader } from "../checklist.ts";

// The fee-agreement step, answered by the billing arrangement in force on the matter. The billing
// engine accepts an arrangement on a consultation — nothing in its model asks whether the matter is
// numbered — so a firm that agrees its fee before it agrees to act records the arrangement and this
// step is satisfied; a firm that does not records nothing and the step stands outstanding. A matter
// with no arrangement is billed hourly by absence, which is a default and not an agreement, and the
// statement says so rather than counting the default as the fact.
export const feeAgreementStepReader: IntakeStepReader = async ({ database, matterId }) => {
  const inForce = await readBillingArrangementInForce(database, matterId);
  if (inForce === undefined) {
    return {
      satisfied: false,
      statement:
        "No fee arrangement has been recorded on this matter. Record one from the status window.",
    };
  }
  return {
    satisfied: true,
    statement: `In force since ${inForce.validFrom.slice(0, 10)}: ${describeArrangement(inForce)}.`,
  };
};
