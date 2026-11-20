// The operations the platform module registers, as the conformance suite holds them (see
// test/conformance.test.ts). Regenerate with `pnpm --filter @magna-carta/api-worker run
// emit-domain-operations`; a hand edit here is a claim the suite will check against the module.
export const OPERATIONS: readonly string[] = [
  "clientErrors.record",
  "firms.provision",
  "incidents.answer",
  "incidents.attachScreenshot",
  "incidents.get",
  "incidents.getMine",
  "incidents.list",
  "incidents.listMine",
  "incidents.report",
  "incidents.screenshot",
  "incidents.screenshotMine",
  "meta.databaseHealth",
  "meta.versions",
  "platform.errorLookup",
  "platform.recentErrors",
  "platform.setFirmReleaseChannel",
  "platformStatus.clearComponentOverride",
  "platformStatus.declareEvent",
  "platformStatus.postUpdate",
  "platformStatus.resolveEvent",
  "platformStatus.setComponentOverride",
];
