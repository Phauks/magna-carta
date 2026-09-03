import type { IntakeStepReaders } from "../checklist.ts";
import { feeAgreementStepReader } from "./billing.ts";
import { conflictsCheckStepReader } from "./conflicts.ts";
import { questionnaireStepReader } from "./custom-fields.ts";
import { assembledDocumentStepReader } from "./document-assembly.ts";
import { retainerStepReader } from "./trust.ts";

// The readers behind the step kinds a subsystem can answer today. The composition root registers
// this map with the checklist route and the opening gate, so the two never disagree.
//
// TWO KINDS HAVE NO READER, ON PURPOSE. `identity-verification` waits on a verification port that is
// not built, and `acknowledgement` is a member's word by definition. Both are answered by a member's
// record until a subsystem exists to answer them; adding a reader here is the whole change when one
// does.
export const BUILT_STEP_READERS: IntakeStepReaders = {
  "conflicts-check": conflictsCheckStepReader,
  "fee-agreement": feeAgreementStepReader,
  "engagement-letter": assembledDocumentStepReader,
  document: assembledDocumentStepReader,
  questionnaire: questionnaireStepReader,
  retainer: retainerStepReader,
};

export {
  assembledDocumentStepReader,
  conflictsCheckStepReader,
  feeAgreementStepReader,
  questionnaireStepReader,
  retainerStepReader,
};
