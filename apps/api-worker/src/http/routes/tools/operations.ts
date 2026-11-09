// The operations the tools module registers, as the conformance suite holds them (see
// test/conformance.test.ts). Regenerate with `pnpm --filter @magna-carta/api-worker run
// emit-domain-operations`; a hand edit here is a claim the suite will check against the module.
export const OPERATIONS: readonly string[] = [
  "safeBrowse.liveClose",
  "safeBrowse.liveStream",
  "safeBrowse.locationProbe",
  "safeBrowse.post",
  "safeBrowse.sessionProbe",
  "safeBrowse.stream",
  "toolsConnection.get",
  "toolsTurnCredentials.get",
  "whois.get",
];
