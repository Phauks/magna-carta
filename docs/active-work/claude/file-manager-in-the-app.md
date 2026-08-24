---
worktree: claude/file-manager-in-the-app
area: apps/web (matter Files)
status: in-review
touches:
  - apps/web/src/lib/file-manager/
  - apps/web/src/routes/(app)/matters/[id]/files/
  - apps/web/src/lib/api/request.ts
  - apps/web/test/
---

# The file manager, in the application

The owner's call after round eight of the mockup: "I think it is good to move to the main program."

The Files screen was a flat table of every document on the matter with a detail panel underneath.
It is now the three-pane file manager: `$lib/file-manager/file-manager.svelte` composes the folder
rail, the file list and the details panel over the design system's Resizable, so both inner edges
drag with the keyboard resize and separator semantics that come with it.

**Reused, not rebuilt.** The design system already had Tree, ContextMenu, DataTable, Resizable and
a FileIcon that resolves to Lucide — the owner's icons ruling is satisfied by the component, not by
anything drawn here. `DocumentDetailPanel` and `NewDocumentDialog` carry over unchanged.

**New client work.** `folder-api.ts` (the folder endpoints had no client at all, plus the file
rename/move/delete verbs), `folder-tree.ts` (the flat adjacency list as a tree, the path, the
"is this inside that" check a move needs), and `file-columns.ts` (the column set and its
comparators).

**Nothing is inert.** Rename, Delete and Download all reach real endpoints. Rename does not put the
extension in the edit field. Delete names what a soft delete actually does rather than implying
destruction. Download points the browser at each file's own signed URL, and asking for several opens
several rather than pretending to bundle them here.

**One shared file touched:** `$lib/api/request.ts` gained `PATCH` to its method union. The folder
and file update routes are PATCH, and the helper only allowed GET/POST/DELETE.

**Not ported in this slice**, and named so nobody has to rediscover it: the File Analysis view, the
Deleted Files view, archive browsing, the icon-grid layout, folder colour and icon, pinning, and the
in-list rename field (rename is a prompt for now). Each is its own slice over endpoints that mostly
exist; the mockup at revision 5 is the reference and
[`docs/conventions/file-manager-rulings.md`](../../conventions/file-manager-rulings.md) is the
binding list of what they must do.
