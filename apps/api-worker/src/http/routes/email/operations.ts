// The operations the email module registers, as the conformance suite holds them (see
// test/conformance.test.ts). Regenerate with `pnpm --filter @magna-carta/api-worker run
// emit-domain-operations`; a hand edit here is a claim the suite will check against the module.
export const OPERATIONS: readonly string[] = [
  "emailInspector.inspect",
  "emails.accept",
  "emails.alreadyFiled",
  "emails.autoFileDecisions",
  "emails.autoFileReview",
  "emails.captureStatus",
  "emails.createAutoFileRule",
  "emails.file",
  "emails.filingContext",
  "emails.get",
  "emails.list",
  "emails.listAutoFileRules",
  "emails.listCaptureAddresses",
  "emails.mintCaptureAddress",
  "emails.mintFirmCaptureAddress",
  "emails.resumeAutoFileRule",
  "emails.revokeAutoFileRule",
  "emails.revokeCaptureAddress",
  "emails.revokeFirmCaptureAddress",
  "emails.rotateCaptureAddress",
  "emails.suggestMatters",
  "emails.suspendAutoFileRule",
  "emails.unlink",
  "emails.updateAutoFileRule",
];
