---
slug: file-sharing-recipients-roles-and-top-level
status: Accepted
area: Client portal
date: 2026-11-20
summary: "Shares (ADR-0036's grants) name any Directory person, not only the client, and carry a role (Viewer, Commenter, Editor) plus a separate download choice rather than a free capability set. Matter scope means the files in no folder (shown as Home), not every folder. A share's validity is checked when it is read: an end date, the sharer leaving or losing files:share, the matter becoming invisible, or the recipient record going all stop it without a write. Sharing is done inside the File Manager, never in a separate window."
---

**Shares are built as a per-firm `share` table in `@magna-carta/sharing`, refining the unified grant
of ADR-0036 in four places.**

**Context.** ADR-0036 set one grant record per share with a capability set. The owner asked on
2026-11-20 to share one file, a folder or many, with people beyond the client, with per-share
permissions, and later ruled out a Share window because file structure matters when sharing.

**Decision.**

- **Recipients are any Directory person.** The client, opposing counsel, experts and co-counsel alike.
  A firm member is refused. No typed addresses: every share names a record a conflicts check can run
  against.
- **Roles, not a capability list.** Viewer (view), Commenter (view, comment), Editor (view, comment,
  edit and add files), with download as its own yes/no. These are the words Google Docs uses. Upload
  is what Editor means on a folder or on Home.
- **Matter scope is Home.** It covers the files in no folder. A folder is never reached through its
  parent; matter scope does not reach folders.
- **Checked at read time.** The portal's reads re-check the end date, the sharer's standing and
  permission, matter visibility and the recipient record on every read, in SQL, so revoking and
  expiry take effect at once with no sweeper. A share whose sharer cannot share any more is repaired
  by any member changing it, which makes them its sharer.
- **No Share window.** The File Manager is the only place shares are made and reviewed: a shared mark,
  a Shared With column, a Sharing section in the details panel, Share on the right-click menu, and a
  Sharing view in the rail.

**Consequences.** The portal lane answers access with `listSharedItems`, `readFileAccess` and
`canAccess` and needs no grant index in the control plane: it finds a firm through the recipient's
portal membership and then reads that firm's shares.
