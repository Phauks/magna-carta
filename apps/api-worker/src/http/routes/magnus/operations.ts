// The operations the magnus module registers, as the conformance suite holds them (see
// test/conformance.test.ts). Regenerate with `pnpm --filter @magna-carta/api-worker run
// emit-domain-operations`; a hand edit here is a claim the suite will check against the module.
export const OPERATIONS: readonly string[] = [
  "magnus.acknowledge",
  "magnus.attachFile",
  "magnus.availability",
  "magnus.deleteConversation",
  "magnus.detachFile",
  "magnus.events",
  "magnus.getConversation",
  "magnus.getTurn",
  "magnus.listConversations",
  "magnus.moveConversation",
  "magnus.renameConversation",
  "magnus.startConversation",
  "magnus.submitTurn",
];
