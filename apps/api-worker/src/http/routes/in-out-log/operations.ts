// The operations the in-out-log module registers, as the conformance suite holds them (see
// test/conformance.test.ts). Regenerate with `pnpm --filter @magna-carta/api-worker run
// emit-domain-operations`; a hand edit here is a claim the suite will check against the module.
export const OPERATIONS: readonly string[] = [
  "inOutLog.deleteEntry",
  "inOutLog.dropOff",
  "inOutLog.getEntry",
  "inOutLog.listEntries",
  "inOutLog.moveToCustodian",
  "inOutLog.pickUp",
];
