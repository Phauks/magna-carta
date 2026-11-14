// The operations the record-transfer module registers, as the conformance suite holds them (see
// test/conformance.test.ts). Regenerate with `pnpm --filter @magna-carta/api-worker run
// emit-domain-operations`; a hand edit here is a claim the suite will check against the module.
export const OPERATIONS: readonly string[] = [
  "recordTransfer.addSourceFile",
  "recordTransfer.getPass",
  "recordTransfer.getPassReport",
  "recordTransfer.getRun",
  "recordTransfer.listRuns",
  "recordTransfer.previewSourceFile",
  "recordTransfer.requestPass",
  "recordTransfer.startRun",
];
