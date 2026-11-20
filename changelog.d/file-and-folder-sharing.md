---
category: Added
audience: public
---

**Files and folders can be shared with people outside the firm, from the File Manager.** A new
per-firm `share` table records who outside the firm can see a matter's file, folder or top level
(Home), with a role (Viewer, Commenter, Editor), a download choice, a sign-in level and an optional
end date. `GET/POST /api/v1/matters/{matterId}/shares`, `PATCH /api/v1/shares/{shareId}` and
`DELETE /api/v1/shares/{shareId}` read and write them under the new `files:share` permission (Owner,
Attorney, Paralegal). `@magna-carta/sharing` exports the read-time checks the client portal will use
(`listSharedItems`, `readFileAccess`, `canAccess`, `canAddFiles`). In the File Manager: a people mark
on shared rows and rail folders, a Shared With column, a Sharing tab in the details panel (and
sharing under a folder's details), Share on the right-click menu, and a Sharing view in the rail that
reviews every share person by person over the matter's folders.

## Public

**Share files and folders with people outside the firm.** Right-click a file or folder and choose
Share to give the client, opposing counsel, an expert or co-counsel access as a Viewer or Editor. A
Shared With column and a mark on each row show what is shared, and the new Sharing view lists
everything shared on a matter, person by person. The client portal where they open it is coming next.
