// The operations the record-transfer module registers, as the conformance suite holds them (see
// test/conformance.test.ts). Regenerate with `pnpm --filter @magna-carta/api-worker run
// emit-domain-operations`; a hand edit here is a claim the suite will check against the module.
export const OPERATIONS: readonly string[] = [
  "recordTransfer.abandonRun",
  "recordTransfer.acceptRun",
  "recordTransfer.addSourceFile",
  "recordTransfer.downloadRejectedRows",
  "recordTransfer.getPass",
  "recordTransfer.getPassReport",
  "recordTransfer.getPassRules",
  "recordTransfer.getRun",
  "recordTransfer.getSourceFileMapping",
  "recordTransfer.listRuns",
  "recordTransfer.listSourceFileColumnValues",
  "recordTransfer.previewSourceFile",
  "recordTransfer.requestPass",
  "recordTransfer.saveSourceFileMapping",
  "recordTransfer.startRun",
];
