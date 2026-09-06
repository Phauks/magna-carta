---
category: Changed
audience: public
---

**The file manager's Upload dialog comes first, and nothing is sent until Upload is pressed.** `apps/web/src/lib/file-manager/upload-dialog.svelte` replaces the destination dialog: it opens on Upload, on a drop onto the list and on the empty folder's button, holds the file, files or whole folder chosen in it (the design-system Dropzone gained `onEntries`, which walks a dropped folder through the entry API instead of handing the consumer a zero-byte stub named after it), asks the Upload Location beside them, and starts the transfer only on its commit — "Upload", not "Save". A folder is recreated under the location, level by level, before its files go in. The running commentary is gone with the early transfer: no "each is uploading now" subtitle and no "closing keeps what has already landed" line, which read as something saved behind the reader's back. A file that did not go reads "Upload failed", with the stage and Error ID as before. A download that fails on the Downloads page or in the top-bar tray now states so on its own row with a Retry beside it, instead of a toast that vanished.

## Public

**Uploading now asks before it sends.** Choose Upload and a dialog opens where you pick a file, several files, or a whole folder — drag them in or use the buttons — and choose the upload location. Nothing is sent until you press **Upload**; cancelling before that sends nothing. A folder is recreated where you put it, with everything inside. If a file does not upload, its line says **Upload failed** and why. And when a download fails, a **Retry** button now appears beside it on the Downloads page and in the downloads tray.
