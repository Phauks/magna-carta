// The operations the notes-and-tasks module registers, as the conformance suite holds them (see
// test/conformance.test.ts). Regenerate with `pnpm --filter @magna-carta/api-worker run
// emit-domain-operations`; a hand edit here is a claim the suite will check against the module.
export const OPERATIONS: readonly string[] = [
  "myDay.get",
  "notes.attachNoteDocument",
  "notes.createNote",
  "notes.deleteNote",
  "notes.detachNoteDocument",
  "notes.editNote",
  "notes.getNote",
  "notes.listNotes",
  "tasks.archiveTask",
  "tasks.attachTaskDocument",
  "tasks.createTask",
  "tasks.deleteTask",
  "tasks.detachTaskDocument",
  "tasks.editTask",
  "tasks.linkExternalTask",
  "tasks.listMatterTasks",
  "tasks.listMyTasks",
  "tasks.lookupExternalTask",
  "tasks.moveTask",
  "tasks.readTaskChanges",
  "tasks.reassignTask",
  "tasks.recordExternalSync",
  "tasks.unarchiveTask",
  "tasks.unlinkExternalTask",
];
