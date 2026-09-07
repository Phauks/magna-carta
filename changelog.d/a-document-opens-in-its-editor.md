---
category: Added
audience: public
---

**The one Open gesture opens a document's editor, in a new tab.** The file manager's ruling that
"Open" is one gesture whose meaning is decided by the file has been built: `activate()` in
`file-manager.svelte` reads `openDestinationOf` (`apps/web/src/lib/documents/editable-documents.ts`)
and a word-processing or plain-text document with clean, committed bytes opens
`/documents/{fileId}/edit` through the `session` reason of the one new-tab gate; everything else
previews as before, and a withheld file previews the withholding. The screen behind that address is
new: for office formats it opens the editing session and loads the Collabora frame the way a WOPI
host must, by form-posting `access_token` and `access_token_ttl` into the iframe (the old unused
detail panel set the frame's `src` with no token and could never have rendered; it is deleted); for
plain text it reads the current version through the audited download path into an in-app editor
and saves through the upload ceremony as the next version (`text-document.ts`). The office frame
still fills only where the `magna-carta-edit` worker is deployed, which the screen states in
development; the text editor runs everywhere.

## Public

**Open a document and start working on it.** Double-click a Word document, or a plain-text file
such as a `.txt` or `.md`, on a matter's Files page and it opens in a new tab ready to edit. Word
documents open in the full browser editor; text files open in a simple editor with a **Save New
Version** button, and every save is kept as a new version alongside the ones before it. Everything
else still opens its preview.
