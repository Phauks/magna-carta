---
category: Added
audience: public
---

**The firm's editing policy: every document opened in the browser editor records its changes.** One
setting (`editing.record_changes`, on by default, `@magna-carta/file-manager/editing-policy-settings`)
behind a new permission (`firm:manageEditingPolicy`, seeded to Owner/Admin), a GET/PATCH route at
`/api/v1/firm/editing-policy` on the scan-policy pattern (audited, one idempotent batch), and a page
at Settings · Documents · Editing over the shared server-backed draft. The WOPI host reads the policy
on every CheckFileInfo and answers `DisableChangeTrackingRecord: false` while it is on — the
property is tri-state on the editor's side and an explicit false forces recording ON with the control
withheld — and omits it when off, which is the firm stepping back rather than forbidding. The launch
carries `recordsChanges`, and the editor screen sends `.uno:ShowTrackedChanges` false once the
document is showing, so the marks are recorded and not shown. The seam it leaves behind: the stored
document keeps every mark, and accepting them on every copy that leaves the platform is the
conversion container's work, not built yet.

## Public

**Every document you edit in the browser now records who changed what, and your firm decides
whether it does.** Until now a document recorded changes only if somebody turned recording on, so
the record of who wrote which words began whenever somebody remembered to. Now every document opened
in the editor records from the first edit, and the control for turning that off is not offered. The
marks stay hidden, so the page reads and types the way it always did; the editor's Review tab shows
them to anybody who asks.

It is your firm's setting, on for every firm, under **Settings › Documents › Editing**, because a
firm that files documents with the other side may decide otherwise. Switching it off asks once before
it lands and is written to the firm's audit log. For now a downloaded copy carries the marks;
producing every copy that leaves the firm with them accepted is coming.
