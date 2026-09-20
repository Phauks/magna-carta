// The operations the communications module registers, as the conformance suite holds them (see
// test/conformance.test.ts). Regenerate with `pnpm --filter @magna-carta/api-worker run
// emit-domain-operations`; a hand edit here is a claim the suite will check against the module.
export const OPERATIONS: readonly string[] = [
  "communications.clearDisposition",
  "communications.get",
  "communications.list",
  "communications.listForMatter",
  "communications.log",
  "communications.nextNumber",
  "communications.routeToMatter",
  "communications.setDisposition",
  "communications.unrouteFromMatter",
  "communications.unroutedCount",
  "communications.update",
];
