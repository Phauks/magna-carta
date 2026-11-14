---
category: Added
audience: public
---

**Deleted files move to archive storage after the firm's trash window.** `packages/file-manager/src/deleted-file-settings.ts` defines the per-firm deleted-file policy (30, 60, 90, 180 or 365 days in Trash, then archive or keep on Standard; default 30 days then archive), stored in the key/value setting table, so there is no migration. `GET/PATCH /api/v1/firm/deleted-file-policy` reads it for any member and changes it under `matters:manageRetention`, with an audit row. The daily tiering sweep now also moves every version of a file deleted longer ago than the window to Infrequent Access (`listExpiredTrashVersions`). Settings gains **Deleted Files** under Documents, and the matter's Deleted Files view gains a **Leaves Trash** column. Nothing is destroyed.

## Public

**Deleted files say when they leave Trash.** A matter's **Deleted Files** list now shows when each file leaves Trash. After that the file moves to cheaper archive storage, and it can still be restored. Admins choose how long files wait and whether they are archived under **Settings**, **Deleted Files**. Nothing is ever destroyed.
