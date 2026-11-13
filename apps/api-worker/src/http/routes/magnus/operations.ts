// The operations the magnus module registers, as the conformance suite holds them (see
// test/conformance.test.ts). Regenerate with `pnpm --filter @magna-carta/api-worker run
// emit-domain-operations`; a hand edit here is a claim the suite will check against the module.
export const OPERATIONS: readonly string[] = [
  "magnus.acknowledge",
  "magnus.attachFile",
  "magnus.availability",
  "magnus.createFolder",
  "magnus.deleteConversation",
  "magnus.deleteFolder",
  "magnus.detachFile",
  "magnus.editTurn",
  "magnus.events",
  "magnus.getConversation",
  "magnus.getTurn",
  "magnus.listArtifacts",
  "magnus.listConversations",
  "magnus.listFolders",
  "magnus.moveConversation",
  "magnus.readArtifactVersion",
  "magnus.removeTurn",
  "magnus.renameConversation",
  "magnus.renameFolder",
  "magnus.restoreArtifactVersion",
  "magnus.setConversationPermission",
  "magnus.shelveConversation",
  "magnus.startConversation",
  "magnus.submitTurn",
];
